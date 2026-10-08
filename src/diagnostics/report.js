// Providers return the existing serialized summaries; no feature state is retained here.
export function createReport({ logger, version, document, navigator, tLog, readEnvironment,
    readRuntime, readSeriesViewing, readThumbnails, readNativePopup }) {
    // 20,000 UTF-16 code units occupy at most 60,000 UTF-8 bytes.
    const MAX_COMPACT_CHARACTERS = 20000;
    function compact(value, depth = 0) {
        if (typeof value === 'string') return value.length > 400 ? value.slice(0, 400) + ' [truncated]' : value;
        if (!value || typeof value !== 'object') return value;
        if (depth >= 8) return { omitted: true, kind: Array.isArray(value) ? 'array' : 'object' };
        if (Array.isArray(value)) return value.length <= 3 ? value.map(item => compact(item, depth + 1))
            : { count: value.length, samples: value.slice(0, 3).map(item => compact(item, depth + 1)), omitted: value.length - 3 };
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item, depth + 1)]));
    }
    function seriesSummary(rows) {
        if (!Array.isArray(rows)) return compact(rows);
        const groups = new Map();
        for (const row of rows) {
            const key = JSON.stringify([row.status, row.reason]);
            if (!groups.has(key)) groups.set(key, { status: row.status, reason: row.reason, count: 0, samples: [] });
            const group = groups.get(key); group.count++;
            if (!group.samples.length) group.samples.push(compact(row));
        }
        return { count: rows.length, groups: [...groups.values()] };
    }
    function compactEntry(entry) {
        const offset = entry.indexOf(' {');
        if (offset < 0) return compact(entry);
        try { return entry.slice(0, offset + 1) + logger.formatValue(compact(JSON.parse(entry.slice(offset + 1)))); }
        catch (_) { return compact(entry); }
    }
    function groupedEntries(entries) {
        const groups = [], byName = new Map();
        entries.forEach((entry, index) => {
            const match = entry.match(/^\[([^\]]+)\]\s+(\w+)\s+(.*)$/);
            const warning = !match || match[2] !== 'INFO';
            const name = match?.[3].split(' {')[0];
            let group = warning ? null : byName.get(name);
            if (!group) {
                group = { index, name, warning, count: 0, first: entry, last: entry, slowest: entry, elapsedMs: -1 };
                groups.push(group);
                if (!warning) byName.set(name, group);
            }
            group.count++; group.last = entry;
            try {
                const elapsed = JSON.parse(entry.slice(entry.indexOf(' {') + 1)).elapsedMs;
                if (Number.isFinite(elapsed) && elapsed > group.elapsedMs) { group.elapsedMs = elapsed; group.slowest = entry; }
            } catch (_) {}
        });
        return groups.map(group => ({ ...group, text: [...new Set([group.first, group.last, group.slowest])]
            .map(compactEntry).join('\n') + (group.count > 1 ? '\n  occurrences: ' + group.count : '') }));
    }
    function buildInvestigationLogText(detailed) {
        const snapshot = readRuntime();
        const environment = readEnvironment();
        const format = value => logger.formatValue(detailed ? value : compact(value));
        const lines = [
            'My List for Netflix Diagnostic Log',
            `version: ${version}`,
            `copiedAt: ${logger.formatTimestamp()}`,
            `url: ${environment.url}`,
            `userAgent: ${environment.userAgent}`,
            `browserLanguage: ${environment.browserLanguage || ''}`,
            `htmlLanguage: ${environment.htmlLanguage}`,
            `netflixLanguage: ${environment.netflixLanguage}`,
            `displayLanguage: ${environment.displayLanguage}`,
            `logLanguage: ${environment.logLanguage}`,
            `viewport: ${environment.viewport}`,
            `devicePixelRatio: ${environment.devicePixelRatio}`,
            `exportMode: ${detailed ? 'detailed' : 'compact; sampled lists and grouped events'}`,
            `entries: ${logger.size()}`,
            `snapshot: ${format(snapshot)}`,
            `seriesViewing: ${logger.formatValue(detailed ? readSeriesViewing() : seriesSummary(readSeriesViewing()))}`,
            `thumbnailDiagnostics: ${format(readThumbnails())}`,
            `nativePopupDiagnostics: ${format(readNativePopup())}`
        ];
        const entries = logger.entries();
        if (detailed) return [...lines, '---', ...entries].join('\n') + '\n';
        // Reserve room for the omission notice. Select warnings first, then restore
        // chronological order among selected groups; no hidden partial JSON lines.
        const groups = groupedEntries(entries), selected = [];
        let budget = MAX_COMPACT_CHARACTERS - 200;
        const retainedLines = [];
        const takeLine = line => { if (line.length + 1 <= budget) { retainedLines.push(line); budget -= line.length + 1; } };
        const takeGroup = group => { if (group.text.length + 1 <= budget) { selected.push(group); budget -= group.text.length + 1; } };
        lines.slice(0, -3).forEach(takeLine);
        groups.filter(group => group.warning).reverse().forEach(takeGroup);
        const eventCountsLine = 'eventCounts: ' + logger.formatValue(groups.map(group => ({ event: compact(group.name),
            occurrences: group.count, warning: group.warning, maxElapsedMs: group.elapsedMs < 0 ? null : group.elapsedMs })));
        takeLine(eventCountsLine);
        lines.slice(-3).forEach(takeLine);
        groups.filter(group => !group.warning).forEach(takeGroup);
        const omittedGroups = groups.length - selected.length;
        const omittedSections = [...lines, eventCountsLine].filter(line => !retainedLines.includes(line)).length;
        return [...retainedLines, `exportLimits: ${MAX_COMPACT_CHARACTERS} characters; omitted event groups: ${omittedGroups}; omitted sections: ${omittedSections}; Shift-click CopyLogs for full detail`,
            '---', ...selected.sort((a, b) => a.index - b.index).map(group => group.text)].join('\n') + '\n';
    }

    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return 'navigator.clipboard';
            } catch (error) {
                logger.warn(tLog('clipboardFallback'), error);
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-100000px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        try {
            textarea.select();
            const ok = document.execCommand('copy');
            if (!ok) throw new Error(tLog('execCommandCopyFailed'));
            return 'execCommand';
        } finally { textarea.remove(); }
    }

    return Object.freeze({ copy: ({ detailed = false } = {}) => copyTextToClipboard(buildInvestigationLogText(detailed)) });
}
