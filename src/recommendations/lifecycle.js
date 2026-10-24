// Passive, bounded chronology. Row identities arrive sanitized by the native adapter.
export function createLifecycleDiagnostics({ now, readIdentity }) {
    let tokens = new WeakMap(), previous = new Map(), nextToken = 0, sequence = 0, generation = 0;
    let previousCards = 0, peakRows = 0, peakCards = 0, droppedRecent = 0, droppedIncidents = 0, failures = 0, disrupted = false;
    const recent = [], incidents = [];
    const copy = value => JSON.parse(JSON.stringify(value));
    function identify(row) {
        if (!tokens.has(row)) tokens.set(row, ++nextToken);
        return { token: tokens.get(row), ...readIdentity(row) };
    }
    function record(facts, incident = false) {
        const event = { sequence: ++sequence, at: now(), ...facts };
        for (const entry of incidents) if (entry.after.length < 12) entry.after.push(event);
        if (incident) {
            incidents.push({ event, before: recent.slice(-8), after: [] });
            if (incidents.length > 3) { incidents.shift(); droppedIncidents++; }
        }
        recent.push(event);
        if (recent.length > 40) { recent.shift(); droppedRecent++; }
    }
    function population(rows, cards, detail = {}) {
        try {
            const next = new Map([...rows].map(row => { const facts = identify(row); return [facts.token, facts]; }));
            const added = [...next.values()].filter(row => !previous.has(row.token));
            const removed = [...previous.values()].filter(row => !next.has(row.token));
            const changed = [...next.values()].filter(row => previous.has(row.token) && previous.get(row.token).rowKey !== row.rowKey);
            const pages = values => [...new Set([...values].map(row => row.pageKey).filter(Boolean))].sort();
            const beforePages = pages(previous.values()), currentPages = pages(next.values());
            const pageChanged = beforePages.length > 0 && currentPages.length > 0 &&
                !beforePages.some(page => currentPages.includes(page));
            peakRows = Math.max(peakRows, next.size); peakCards = Math.max(peakCards, cards);
            const cardLoss = previousCards >= 20 && cards < previousCards / 2;
            if (added.length || removed.length || changed.length || cardLoss) {
                const loss = removed.length >= Math.max(3, previous.size / 2) ||
                    (peakRows >= 8 && next.size <= peakRows / 2) || cardLoss;
                const incident = pageChanged || changed.length >= Math.max(3, previous.size / 2) || loss && !disrupted;
                record({ kind: 'population', reason: pageChanged || changed.length ? 'row-replacement' : removed.length ? 'row-loss' : 'row-growth',
                    beforeRows: previous.size, rows: next.size, beforeCards: previousCards, cards,
                    added: added.length, removed: removed.length, reidentified: changed.length, pageChanged,
                    beforePages: beforePages.slice(0, 4), pages: currentPages.slice(0, 4),
                    addedRows: added.slice(0, 6), removedRows: removed.slice(0, 6), changedRows: changed.slice(0, 6),
                    samplesTruncated: added.length > 6 || removed.length > 6 || changed.length > 6 || currentPages.length > 4 || beforePages.length > 4,
                    ...detail }, incident);
                if (loss) disrupted = true;
            }
            if (next.size >= peakRows * .75) disrupted = false;
            previous = next; previousCards = cards;
        } catch (_) { failures++; }
    }
    function cacheObserver(row) {
        const owner = generation;
        let identity;
        try { identity = identify(row); } catch (_) { failures++; identity = {}; }
        return facts => {
            if (owner !== generation) return;
            try { record({ kind: 'cache', ...identity, ...facts }); } catch (_) { failures++; }
        };
    }
    function reset() {
        generation++; tokens = new WeakMap(); previous = new Map(); nextToken = sequence = 0;
        previousCards = peakRows = peakCards = droppedRecent = droppedIncidents = failures = 0; disrupted = false;
        recent.length = incidents.length = 0;
    }
    return Object.freeze({ population, cacheObserver, reset,
        snapshot: () => copy({ capturedAt: now(), sequence, peakRows, peakCards, rows: previous.size, cards: previousCards,
            droppedRecent, droppedIncidents, failures, recent, incidents }) });
}
