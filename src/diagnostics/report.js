// Providers return the existing serialized summaries; no feature state is retained here.
export function createReport({ logger, version, document, navigator, tLog, readEnvironment, writeText,
    readRuntime, readSeriesViewing, readThumbnails, readNativePopup, readHistory = () => [] }) {
    // A target for optional examples, never a ceiling on diagnostic decisions.
    const COMPACT_TARGET_CHARACTERS = 20000;
    const DIAGNOSTIC_FIELD = /status|outcome|reason|code|mode|strategy|source|phase|stage|method|failure|error|manualChoice|graphqlKey|rowId|sectionId|entryKind|generation/i;
    function diagnosticFacts(value, prefix = '', facts = [], depth = 0) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || depth >= 8) return facts;
        for (const [key, item] of Object.entries(value)) {
            const path = prefix ? prefix + '.' + key : key;
            if (typeof item === 'boolean' || (typeof item === 'string' &&
                (DIAGNOSTIC_FIELD.test(key) || /(?:^|\.)fields\./.test(path)))) facts.push([path, item]);
            else if (item && typeof item === 'object') diagnosticFacts(item, path, facts, depth + 1);
        }
        return facts.sort(([a], [b]) => a.localeCompare(b));
    }
    function numericFacts(value, numbers, prefix = '', depth = 0) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || depth >= 8) return;
        for (const [key, item] of Object.entries(value)) {
            const path = prefix ? prefix + '.' + key : key;
            if (typeof item === 'number' && Number.isFinite(item)) {
                const stat = numbers[path] ||= { count: 0, min: item, max: item,
                    ...(/Ms$/.test(key) ? { total: 0 } : {}) };
                stat.count++; stat.min = Math.min(stat.min, item); stat.max = Math.max(stat.max, item);
                if ('total' in stat) stat.total += item;
            } else if (item && typeof item === 'object') numericFacts(item, numbers, path, depth + 1);
        }
    }
    function compact(value, depth = 0, key = '') {
        if (typeof value === 'string') return value.length > 400 && !DIAGNOSTIC_FIELD.test(key)
            ? value.slice(0, 400) + ' [truncated; original characters: ' + value.length + ']' : value;
        if (!value || typeof value !== 'object') return value;
        if (depth >= 8) return { omitted: true, kind: Array.isArray(value) ? 'array' : 'object' };
        if (Array.isArray(value)) {
            if (value.length <= 3) return value.map(item => compact(item, depth + 1));
            if (value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
                const counts = new Map();
                for (const item of value) counts.set(item, (counts.get(item) || 0) + 1);
                if (counts.size <= 12) return { count: value.length, values: [...counts].map(([item, count]) => ({ value: compact(item), count })) };
            }
            const indices = new Set([0, 1, 2]), outcomes = new Set();
            value.forEach((item, index) => {
                const facts = diagnosticFacts(item);
                if (!facts.length) return;
                const signature = JSON.stringify(facts);
                if (!outcomes.has(signature)) { outcomes.add(signature); indices.add(index); }
            });
            return { count: value.length, samples: [...indices].map(index => compact(value[index], depth + 1)),
                omitted: value.length - indices.size };
        }
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item, depth + 1, key)]));
    }
    function seriesSummary(rows) {
        if (!Array.isArray(rows)) return compact(rows);
        const groups = new Map();
        for (const row of rows) {
            const key = JSON.stringify([row.status, row.reason, diagnosticFacts(row)]);
            if (!groups.has(key)) groups.set(key, { status: row.status, reason: row.reason, count: 0, samples: [] });
            const group = groups.get(key); group.count++;
            if (!group.samples.length) group.samples.push(compact(row));
        }
        return { count: rows.length, groups: [...groups.values()] };
    }
    function compactEntry(entry) {
        const offset = entry.indexOf(' {');
        if (offset < 0) return entry;
        try { return entry.slice(0, offset + 1) + logger.formatValue(compact(JSON.parse(entry.slice(offset + 1)))); }
        catch (_) { return entry; }
    }
    function groupedEntries(entries) {
        const groups = [], byOutcome = new Map();
        entries.forEach((entry, index) => {
            const match = entry.match(/^\[([^\]]+)\]\s+(\w+)\s+(.*)$/);
            const warning = !match || match[2] !== 'INFO';
            const name = match?.[3].split(' {')[0];
            let payload = null;
            try { payload = JSON.parse(entry.slice(entry.indexOf(' {') + 1)); } catch (_) {}
            const key = JSON.stringify([name, diagnosticFacts(payload)]);
            let group = warning ? null : byOutcome.get(key);
            if (!group) {
                group = { index, name, warning, count: 0, first: entry, last: entry, slowest: entry,
                    firstAt: match?.[1], lastAt: match?.[1], elapsedMs: -1, numbers: Object.create(null) };
                groups.push(group);
                if (!warning) byOutcome.set(key, group);
            }
            group.count++; group.last = entry; group.lastAt = match?.[1];
            numericFacts(payload, group.numbers);
            if (Number.isFinite(payload?.elapsedMs) && payload.elapsedMs > group.elapsedMs) {
                group.elapsedMs = payload.elapsedMs; group.slowest = entry;
            }
        });
        return groups.map(group => ({ ...group,
            // Warnings are kept verbatim. INFO payloads sample only bulk detail.
            text: (group.warning ? group.first : compactEntry(group.first)) + (group.count > 1 ?
                '\n  occurrences: ' + group.count + '\n  eventSummary: ' + logger.formatValue({
                    occurrences: group.count, firstAt: group.firstAt, lastAt: group.lastAt, numbers: group.numbers }) : ''),
            examples: [...new Set([group.last, group.slowest])].filter(entry => entry !== group.first).map(compactEntry) }));
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
            `previousPages: ${format(readHistory())}`,
            `seriesViewing: ${logger.formatValue(detailed ? readSeriesViewing() : seriesSummary(readSeriesViewing()))}`,
            `thumbnailDiagnostics: ${format(readThumbnails())}`,
            `nativePopupDiagnostics: ${format(readNativePopup())}`
        ];
        const entries = logger.entries();
        if (detailed) return [...lines, '---', ...entries].join('\n') + '\n';
        const groups = groupedEntries(entries);
        // Essential summaries always fit by allowing explicit target overflow.
        // Do not let a bulky snapshot or early routine events hide a later decision.
        const essentialSize = [...lines, '---', ...groups.map(group => group.text)].join('\n').length + 400;
        let budget = Math.max(0, COMPACT_TARGET_CHARACTERS - essentialSize), omittedExamples = 0;
        const eventLines = groups.map(group => {
            const selected = [group.text];
            for (const example of group.examples) {
                if (example.length + 1 <= budget) { selected.push(example); budget -= example.length + 1; }
                else omittedExamples++;
            }
            return selected.join('\n');
        });
        const overflow = essentialSize > COMPACT_TARGET_CHARACTERS ? '; essential summaries exceed target' : '';
        return [...lines, 'exportLimits: target ' + COMPACT_TARGET_CHARACTERS + ' characters' + overflow +
            '; omitted event groups: 0; omitted sections: 0; omitted extra examples: ' + omittedExamples +
            '; payload lists/long strings may be sampled; Shift-click CopyLogs for full detail',
            '---', ...eventLines].join('\n') + '\n';
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

    function snapshot(detailed = true) {
        const facts = { runtime: readRuntime(), seriesViewing: detailed ? readSeriesViewing() : seriesSummary(readSeriesViewing()),
            thumbnails: readThumbnails(), nativePopup: readNativePopup() };
        return JSON.parse(logger.formatValue(detailed ? facts : compact(facts)));
    }
    return Object.freeze({ copy: ({ detailed = false } = {}) => (writeText || copyTextToClipboard)(buildInvestigationLogText(detailed)), snapshot });
}
