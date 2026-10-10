// Observe native reflow/loading without navigating away from the current page.
export function createRefill({ environment, dom, readChoices, admitted, onPage, log = () => {} }) {
    const rows = new Map(), counters = { checks: 0, buffered: 0, unavailable: 0 };
    const { setTimeout, clearTimeout } = environment;
    function cancel(job) { if (job.timer !== null) clearTimeout(job.timer); job.timer = null; }
    function prune(job, choices) {
        for (const [id, reason] of job.requests) if (choices[id] !== reason) job.requests.delete(id);
    }
    function check(job) {
        job.timer = null;
        if (rows.get(job.row) !== job || !admitted()) return;
        const choices = readChoices(); prune(job, choices);
        const state = dom.refillState(job.row, choices);
        if (!job.requests.size || state?.scroller !== job.scroller) return;
        job.requests.clear();
        // Netflix may have mounted more cards in response to its own layout observers.
        onPage(job.row);
        if (rows.get(job.row) !== job || !admitted()) return;
        const updated = dom.refillState(job.row, readChoices());
        if (updated?.scroller !== job.scroller) return;
        counters.checks++;
        if (updated.offscreen) counters.buffered++; else counters.unavailable++;
        log('Stationary recommendation refill checked', { remaining: updated.remaining, mounted: updated.mounted,
            offscreen: updated.offscreen, targetAhead: Math.max(1, updated.remaining) * 2,
            bufferShortfall: Math.max(0, Math.max(1, updated.remaining) * 2 - updated.offscreen),
            independentLoader: 'unverified', loading: dom.loadingFacts(job.row) });
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
            if (!job) { job = { row, scroller: state.scroller, timer: null, requests: new Map() }; rows.set(row, job); }
            prune(job, choices);
            if (dismissal?.row === row && choices[dismissal.id]) job.requests.set(dismissal.id, choices[dismissal.id]);
            if (!job.requests.size) cancel(job);
            else if (job.timer === null) job.timer = setTimeout(() => check(job), 250);
        }
    }
    return Object.freeze({ update, dispose() { for (const job of rows.values()) cancel(job); rows.clear(); },
        diagnostics: () => ({ ...counters, pending: [...rows.values()].filter(job => job.timer !== null).length }) });
}
