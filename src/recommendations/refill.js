// Empty-row continuation delegates fetching and rendering to Netflix's own controls.
export function createRefill({ environment, dom, readChoices, admitted, onPage, log = () => {}, warn = () => {} }) {
    const rows = new Map(), counters = { moves: 0, filled: 0, stopped: 0, timeouts: 0 };
    const { setTimeout, clearTimeout } = environment;
    let generation = 0;
    function cancel(job) { if (job.timer !== null) clearTimeout(job.timer); job.timer = null; }
    function stop(job, reason) {
        cancel(job); job.stopped = true; job.reason = reason; counters.stopped++;
        if (reason === 'timeout') counters.timeouts++;
        log('Recommendation refill stopped', { reason, pages: job.moves, mountedTitles: job.signature.split(',').length });
    }
    function current(job) {
        if (job.generation !== generation || rows.get(job.row) !== job || !admitted()) return null;
        const state = dom.refillState(job.row, readChoices());
        return state?.scroller === job.scroller ? state : null;
    }
    function later(job, callback, delay = 150) {
        job.timer = setTimeout(() => { job.timer = null; callback(); }, delay);
    }
    function advance(job) {
        const state = current(job);
        if (!state || !state.inViewport) { cancel(job); return; }
        job.signature = state.signature;
        if (state.remaining) { cancel(job); return; }
        if (!state.canAdvance) { stop(job, 'no-next-control'); return; }
        if (job.seen.has(state.signature)) { stop(job, 'repeated-page'); return; }
        if (job.moves >= 24) { stop(job, 'page-budget'); return; }
        job.seen.add(state.signature); job.signature = state.signature; job.waited = 0; job.moves++;
        counters.moves++;
        // Register waiting before click: Netflix can synchronously mount the next page.
        job.waiting = true;
        try { state.next.click(); }
        catch (error) { job.waiting = false; stop(job, 'click-failed'); warn('Recommendation refill click failed', { reason: error.message }); return; }
        log('Recommendation refill page requested', { pages: job.moves });
        if (current(job)) later(job, () => settle(job));
    }
    function settle(job) {
        const state = current(job);
        if (!state) { cancel(job); return; }
        job.waited += 150;
        if ((state.signature !== job.signature || state.remaining) && job.waited >= 450) {
            onPage(job.row);
            const updated = current(job);
            if (!updated) return;
            job.waiting = false;
            if (updated.remaining) {
                counters.filled++; job.seen.clear(); job.moves = 0;
                log('Recommendation row refilled', { remaining: updated.remaining }); return;
            }
            later(job, () => advance(job), 250); return;
        }
        if (job.waited >= 3000) { job.waiting = false; stop(job, 'timeout'); return; }
        later(job, () => settle(job));
    }
    function update(currentRows) {
        for (const [row, job] of rows) if (!currentRows.has(row) || !row.isConnected) { cancel(job); rows.delete(row); }
        if (!admitted()) return;
        for (const row of currentRows) {
            const state = dom.refillState(row, readChoices());
            if (!state) continue;
            let job = rows.get(row);
            if (job && job.scroller !== state.scroller) { cancel(job); rows.delete(row); job = null; }
            if (!job) {
                job = { row, scroller: state.scroller, generation, signature: state.signature, seen: new Set(), moves: 0,
                    timer: null, waiting: false, stopped: false };
                rows.set(row, job);
            }
            if (job.waiting || job.timer !== null) continue;
            if (state.remaining) { job.stopped = false; job.seen.clear(); job.moves = 0; continue; }
            if (job.stopped && state.signature === job.signature && !(job.reason === 'no-next-control' && state.canAdvance)) continue;
            if (state.inViewport) { job.stopped = false; later(job, () => advance(job), 250); }
        }
    }
    return Object.freeze({ update, dispose() { generation++; for (const job of rows.values()) cancel(job); rows.clear(); },
        diagnostics: () => ({ ...counters, pending: [...rows.values()].filter(job => job.timer !== null).length }) });
}
