// Deferred work for interacted rows only. Native cache/query operations stay in the adapter.
export function createNativeRows({ environment, dom, admitted, canRestore = admitted, readChoices }) {
    const rows = new Map(), requests = [], stats = { attempts: 0, activated: 0, writes: 0, loads: 0, restored: 0, failures: 0 };
    let generation = 0;
    const now = () => environment.performance?.now() ?? Date.now();
    const identity = row => [row.id, row.getAttribute('data-list-id'), row.querySelector('h2, .rowTitle')?.textContent].join('|');
    function guard(job) { if (job.generation !== generation || rows.get(job.row) !== job || !job.row.isConnected || identity(job.row) !== job.identity || !admitted()) throw Error('native-row-retired'); }
    function schedule(job, delay = 200) {
        if (job.failed || !job.binding && job.lookups <= 0) return;
        if (job.running) { job.dirty = true; return; }
        if (job.timer !== null) return;
        job.timer = environment.setTimeout(() => { job.timer = null; void run(job); }, delay);
    }
    async function run(job) {
        job.running = true; job.dirty = false;
        const intent = job.intent;
        const check = () => { guard(job); if (intent !== job.intent) throw Error('native-row-retired'); };
        try {
            check(); stats.attempts++;
            const values = dom.scan(job.row).filter(value => value.row === job.row);
            if (!values.length) return;
            if (!job.binding) {
                job.lookups--;
                const found = dom.queryBinding(values[0].card, values.map(value => value.id)); check();
                job.probe = found.probe;
                if (!found.binding) { job.reason = found.reason; return; }
                job.binding = found.binding; job.pagination = found.pagination; stats.activated++;
            }
            job.pagination = dom.queryPage?.(values[0].card) || job.pagination;
            const selected = readChoices(), snapshot = dom.rowDiagnostics(job.row, selected); check();
            const anchor = snapshot?.visibleIds[0], capacity = snapshot?.pageCapacity || job.capacity || 8; job.capacity = capacity;
            if (job.binding.publish(selected, check, anchor, capacity, job.pagination)) stats.writes++;
            job.reason = 'active';
            while (job.credit > 0) {
                check(); const choices = readChoices(), state = job.binding.state(choices, anchor);
                job.summary = state;
                const index = anchor ? state.anchorIndex : (job.pagination?.index || 0) * capacity;
                if (!state.hasNextPage || !state.canLoad || state.filtered - index >= capacity * 3) break;
                while (requests.length && now() - requests[0] >= 60000) requests.shift();
                if (requests.length >= 24) { job.reason = 'request-budget'; break; }
                job.credit--; requests.push(now()); job.controller = new environment.AbortController();
                const controller = job.controller;
                const deadline = new Promise((_, reject) => { job.deadline = environment.setTimeout(() => { controller.abort(); reject(Error('query-timeout')); }, 8000); });
                let loaded;
                try { loaded = await Promise.race([job.binding.load(controller.signal, check), deadline]); }
                finally { environment.clearTimeout(job.deadline); job.deadline = null; if (job.controller === controller) job.controller = null; }
                check(); if (!loaded) break;
                stats.loads++;
                if (job.binding.publish(readChoices(), check, anchor, capacity)) stats.writes++;
            }
            job.summary = job.binding.state(readChoices(), anchor);
        } catch (error) {
            try { check(); job.reason = ['cache-projection-rejected', 'row-capacity', 'query-timeout', 'invalid-connection', 'query-owner-replaced'].includes(error.message) ? error.message : 'native-query-failed'; stats.failures++; job.credit = 0; job.failed = true;
                try { if (job.binding?.restore(check)) stats.restored++; } catch (_) {} }
            catch (_) { /* Retired work cannot publish. */ }
        } finally {
            job.running = false;
            if (job.dirty) try { guard(job); schedule(job); } catch (_) {}
        }
    }
    function presentation(row) {
        const snapshot = dom.rowDiagnostics(row, readChoices());
        return snapshot ? { visible: snapshot.visible, capacity: snapshot.pageCapacity, hidden: snapshot.hidden, mounted: snapshot.mounted, pageIndex: snapshot.pageIndex } : null;
    }
    function interact(row) {
        if (!row || !admitted()) return;
        let job = rows.get(row);
        if (job && identity(row) !== job.identity) { retire(job); job = null; }
        if (!job) {
            if (rows.size >= 4) retire(rows.values().next().value);
            job = { row, identity: identity(row), generation, timer: null, deadline: null, controller: null, binding: null, pagination: null,
                credit: 0, lookups: 0, intent: 0, dirty: false, failed: false, reason: 'pending', running: false }; rows.set(row, job);
        }
        job.intent++; job.credit = 2; job.lookups = 3; job.failed = false;
        job.controller?.abort(); schedule(job);
    }
    function retire(job) {
        environment.clearTimeout(job.timer); environment.clearTimeout(job.deadline); job.controller?.abort();
        const restoreGuard = () => { if (job.generation !== generation || rows.get(job.row) !== job || !canRestore()) throw Error('native-row-retired'); };
        try { if (job.binding?.restore(restoreGuard)) stats.restored++; } catch (_) {}
        rows.delete(job.row);
    }
    function refresh() { if (admitted()) for (const job of rows.values()) {
        if (!job.row.isConnected || identity(job.row) !== job.identity) retire(job); else schedule(job);
    } }
    function dispose() {
        for (const job of rows.values()) retire(job);
        generation++; rows.clear(); requests.length = 0;
    }
    return Object.freeze({ interact, refresh, dispose, diagnostics: () => ({ ...stats, rows: [...rows.values()].map(job => ({ reason: job.reason,
        running: job.running, pageContext: Boolean(job.pagination), probe: job.probe, presentation: presentation(job.row), ...job.summary })) }) });
}
