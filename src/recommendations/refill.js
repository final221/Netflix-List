// Dismissal and empty-row continuation delegate fetching/rendering to Netflix's controls.
export function createRefill({ environment, dom, readChoices, admitted, onPage, log = () => {}, warn = () => {} }) {
    const rows = new Map(), counters = { moves: 0, filled: 0, stopped: 0, timeouts: 0 };
    const { setTimeout, clearTimeout } = environment;
    let generation = 0;
    function cancel(job) { if (job.timer !== null) clearTimeout(job.timer); job.timer = null; }
    function stop(job, reason) {
        cancel(job); if (reason !== 'no-next-control') job.requests.clear();
        job.stopped = true; job.reason = reason; counters.stopped++;
        if (reason === 'timeout') counters.timeouts++;
        log('Recommendation refill stopped', { reason, pages: job.moves, mountedTitles: job.signature.split(',').length });
    }
    function current(job) {
        if (job.generation !== generation || rows.get(job.row) !== job || !admitted()) return null;
        const choices = readChoices();
        for (const [id, reason] of job.requests) if (choices[id] !== reason) job.requests.delete(id);
        const state = dom.refillState(job.row, choices);
        return state?.scroller === job.scroller ? state : null;
    }
    function later(job, callback, delay = 150) {
        job.timer = setTimeout(() => { job.timer = null; callback(); }, delay);
    }
    function advance(job) {
        const state = current(job);
        if (!state || !state.inViewport) { cancel(job); return; }
        job.signature = state.signature;
        if (state.remaining && !job.requests.size) { cancel(job); return; }
        if (!state.canAdvance) { stop(job, 'no-next-control'); return; }
        if (job.seen.has(state.signature)) { stop(job, 'repeated-page'); return; }
        if (job.moves >= 24) { stop(job, 'page-budget'); return; }
        job.seen.add(state.signature); job.signature = state.signature; job.waited = 0; job.moves++;
        counters.moves++;
        // Register waiting before click: Netflix can synchronously mount the next page.
        job.waiting = true;
        try { state.next.click(); }
        catch (error) { job.waiting = false; stop(job, 'click-failed'); warn('Recommendation refill click failed', { reason: error.message }); return; }
        log('Recommendation refill page requested', { pages: job.moves, trigger: job.requests.size ? 'dismissal' : 'empty-row' });
        if (current(job)) later(job, () => settle(job));
    }
    function settle(job) {
        const state = current(job);
        if (!state) { cancel(job); return; }
        job.waited += 150;
        if ((state.signature !== job.signature || !job.requests.size && state.remaining) && job.waited >= 450) {
            onPage(job.row);
            const updated = current(job);
            if (!updated) return;
            job.waiting = false;
            if (updated.remaining) {
                counters.filled++; job.requests.clear(); job.seen.clear(); job.moves = 0;
                log('Recommendation row refilled', { remaining: updated.remaining }); return;
            }
            later(job, () => advance(job), 250); return;
        }
        if (job.waited >= 3000) { job.waiting = false; stop(job, 'timeout'); return; }
        later(job, () => settle(job));
    }
    function update(currentRows, dismissal = null) {
        for (const [row, job] of rows) if (!currentRows.has(row) || !row.isConnected) { cancel(job); rows.delete(row); }
        if (!admitted()) return;
        const choices = readChoices();
        for (const row of currentRows) {
            const state = dom.refillState(row, choices);
            if (!state) continue;
            let job = rows.get(row);
            if (job && job.scroller !== state.scroller) { cancel(job); rows.delete(row); job = null; }
            if (!job) {
                job = { row, scroller: state.scroller, generation, signature: state.signature, seen: new Set(), moves: 0,
                    timer: null, waiting: false, stopped: false, requests: new Map() };
                rows.set(row, job);
            }
            for (const [id, reason] of job.requests) if (choices[id] !== reason) job.requests.delete(id);
            if (dismissal?.row === row && choices[dismissal.id]) {
                job.requests.set(dismissal.id, choices[dismissal.id]);
                if (!job.waiting) { job.stopped = false; job.seen.clear(); job.moves = 0; }
            }
            if (job.waiting || job.timer !== null) continue;
            if (state.remaining && !job.requests.size) { job.stopped = false; job.seen.clear(); job.moves = 0; continue; }
            if (job.stopped && state.signature === job.signature && !(job.reason === 'no-next-control' && state.canAdvance)) continue;
            if (state.inViewport) { job.stopped = false; later(job, () => advance(job), 250); }
        }
    }
    return Object.freeze({ update, dispose() { generation++; for (const job of rows.values()) cancel(job); rows.clear(); },
        diagnostics: () => ({ ...counters, pending: [...rows.values()].filter(job => job.timer !== null).length }) });
}
