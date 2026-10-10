// Passive chronological evidence; never dispatches native interactions.
export function createNavigationDiagnostics({ environment, dom, readChoices, admitted, log }) {
    let sequence = 0, failures = 0, requests = null, history = new WeakMap(), lastHover = null, generation = 0, movementCount = 0;
    const recent = [], movements = [], timers = new Map();
    const now = () => environment.performance?.now() ?? Date.now();
    function remember(row, state) {
        let seen = history.get(row); if (!seen) { seen = new Set(); history.set(row, seen); }
        for (const id of state?.ids || []) if (seen.size < 1200) seen.add(id);
        return seen;
    }
    function cancel(record) { for (const [timer, owner] of timers) if (owner === record) { environment.clearTimeout(timer); timers.delete(timer); } }
    function sample(record, reason) {
        if (record.owner !== generation || !admitted() || !record.row.isConnected) return;
        const state = dom.rowDiagnostics(record.row, readChoices()); if (!state) return;
        const { loading, ...facts } = state;
        record.samples.push({ at: now(), reason, state: facts,
            addedCount: state.ids.filter(id => !record.before.ids.includes(id)).length,
            removedCount: record.before.ids.filter(id => !state.ids.includes(id)).length,
            firstObservedCount: state.ids.filter(id => !record.seenBefore.has(id)).length,
            comparisonTruncated: Boolean(state.idsTruncated || record.before.idsTruncated || record.seenBefore.size >= 1200) });
        remember(record.row, state);
    }
    function close(record, reason) {
        if (record.closed || record.owner !== generation) return;
        sample(record, reason); cancel(record); record.closed = true;
        record.requestFacts = dom.navigationRequests(record.loading.at, now(), requests?.read());
    }
    function movement(kind, target, detail = {}) {
        if (!admitted()) return;
        try {
            const card = target?.closest?.('a[data-uia="standard-card"], .title-card'), value = card && dom.describe(card), id = value?.id;
            const arrow = !card && dom.navigationTarget(target), row = value?.row || arrow?.row;
            const rowId = (row?.id || row?.getAttribute?.('data-uia') || '').slice(0, 160), hoverKey = `${rowId}:${id || arrow?.direction || ''}`;
            if (kind === 'hover' && !id && !arrow) { lastHover = null; return; }
            if (kind === 'hover' && lastHover === hoverKey) return;
            if (kind === 'hover') lastHover = hoverKey;
            if (!id && !arrow && kind !== 'scroll' && kind !== 'action') return;
            movements.push({ at: now(), kind, ...(id ? { id, rowId } : arrow ? { rowId, direction: arrow.direction } : {}),
                scrollY: Math.round(environment.scrollY || environment.window?.scrollY || 0),
                ...Object.fromEntries(Object.entries(detail).filter(([key, value]) => ['x', 'y', 'action', 'id'].includes(key) && ['string', 'number'].includes(typeof value))) });
            movementCount++; if (movements.length > 240) movements.shift();
        } catch (_) { failures++; }
    }
    function click(target) {
        if (!admitted()) return;
        try {
            const navigation = dom.navigationTarget(target); if (!navigation) return;
            const before = dom.rowDiagnostics(navigation.row, readChoices()); if (!before) return;
            const previous = recent.at(-1); if (previous) close(previous, 'before-next-arrow');
            requests ||= dom.observeRequests(); requests.begin();
            const loading = dom.navigationStart(navigation.control);
            const record = { sequence: ++sequence, direction: navigation.direction, row: navigation.row, before, loading,
                owner: generation, seenBefore: new Set(remember(navigation.row, before)), samples: [], closed: false };
            recent.push(record); if (recent.length > 20) cancel(recent.shift());
            for (const delay of [200, 1200, 5000]) {
                const timer = environment.setTimeout(() => { timers.delete(timer);
                    try { if (delay === 5000) close(record, '5000ms'); else sample(record, `${delay}ms`); } catch (_) { failures++; }
                }, delay); timers.set(timer, record);
            }
            log('Native recommendation arrow clicked', { sequence: record.sequence, direction: record.direction, before });
        } catch (_) { failures++; }
    }
    function snapshot() {
        const capture = admitted() ? requests?.read() : null;
        return { interactions: sequence, failures, retained: recent.length, movements: movements.slice(), movementCount, movementsDropped: movementCount - movements.length, pendingSamples: timers.size,
            recent: recent.map(record => {
                const { sequence, direction, row, before, loading, samples, requestFacts, seenBefore } = record;
                const after = admitted() && row.isConnected ? dom.rowDiagnostics(row, readChoices()) : null;
                return { sequence, direction, before, afterAtExport: after, loading, samples: samples.slice(),
                    requests: requestFacts || (admitted() ? dom.navigationRequests(loading.at, now(), capture) : { unavailable: true }),
                    addedCount: after ? after.ids.filter(id => !before.ids.includes(id)).length : null,
                    firstObservedCount: after ? after.ids.filter(id => !seenBefore.has(id)).length : null,
                    addedIdSample: after ? after.ids.filter(id => !before.ids.includes(id)).slice(0, 16) : [],
                    removedIdSample: after ? before.ids.filter(id => !after.ids.includes(id)).slice(0, 16) : [],
                    idComparisonTruncated: Boolean(before.idsTruncated || after?.idsTruncated), historyTruncated: seenBefore.size >= 1200 };
            }) };
    }
    return Object.freeze({ click, movement, snapshot, dispose() {
        generation++; for (const timer of timers.keys()) environment.clearTimeout(timer); timers.clear();
        requests?.dispose(); requests = null; recent.length = 0; movements.length = 0;
        history = new WeakMap(); lastHover = null; sequence = 0; failures = 0; movementCount = 0;
    } });
}
