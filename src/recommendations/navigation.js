// Passive native-arrow evidence; current row state is read when a report is exported.
export function createNavigationDiagnostics({ dom, readChoices, admitted, log }) {
    let sequence = 0, failures = 0; const recent = [];
    function click(target) {
        if (!admitted()) return;
        try {
            const navigation = dom.navigationTarget(target); if (!navigation) return;
            const before = dom.rowDiagnostics(navigation.row, readChoices()); if (!before) return;
            const loading = dom.navigationStart(navigation.control);
            const previous = recent.at(-1); if (previous) previous.until = loading.at;
            const record = { sequence: ++sequence, direction: navigation.direction, row: navigation.row, before, loading };
            recent.push(record); if (recent.length > 20) recent.shift();
            log('Native recommendation arrow clicked', { sequence: record.sequence, direction: record.direction, before });
        } catch (_) { failures++; }
    }
    function snapshot() {
        return { interactions: sequence, failures, retained: recent.length, recent: recent.map(({ sequence, direction, row, before, loading, until }) => {
            const after = admitted() && row.isConnected ? dom.rowDiagnostics(row, readChoices()) : null;
            return { sequence, direction, before, afterAtExport: after, loading,
                requests: admitted() ? dom.navigationRequests(loading.at, until) : { unavailable: true },
                addedIdSample: after ? after.ids.filter(id => !before.ids.includes(id)).slice(0, 16) : [],
                removedIdSample: after ? before.ids.filter(id => !after.ids.includes(id)).slice(0, 16) : [],
                idComparisonTruncated: Boolean(before.idsTruncated || after?.idsTruncated) };
        }) };
    }
    return Object.freeze({ click, snapshot, dispose() { recent.length = 0; sequence = 0; failures = 0; } });
}
