import { diagnosticFacts, numericFacts, summarizeSignals, seriesSummary } from './signals.js';
import { encodeDiagnostic, utf8Bytes } from './encoding.js';

// Providers return the existing serialized summaries; no feature state is retained here.
export function createReport({ logger, version, readEnvironment, writeText,
    readRuntime, readSeriesViewing, readThumbnails, readNativePopup, readHistory = () => [] }) {
    // A target for optional examples, never a ceiling on diagnostic decisions.
    const TARGET_BYTES = 32 * 1024;
    function summarizeEntry(entry) {
        const offset = entry.indexOf(' {');
        if (offset < 0) return entry;
        try { return entry.slice(0, offset + 1) + logger.formatValue(summarizeSignals(JSON.parse(entry.slice(offset + 1)))); }
        catch (_) { return entry; }
    }
    function groupedEntries(entries) {
        const groups = [], byOutcome = new Map();
        entries.forEach((entry, index) => {
            const match = entry.match(/^\[([^\]]+)\]\s+(\w+)\s+(.*)$/);
            const name = match?.[3].split(' {')[0];
            let payload = null;
            try { payload = JSON.parse(entry.slice(entry.indexOf(' {') + 1)); } catch (_) {}
            const key = JSON.stringify([match?.[2], name, diagnosticFacts(payload)]);
            let group = byOutcome.get(key);
            if (!group) {
                group = { index, name, count: 0, first: entry, last: entry, slowest: entry,
                    firstAt: match?.[1], lastAt: match?.[1], elapsedMs: -1, numbers: Object.create(null) };
                groups.push(group);
                byOutcome.set(key, group);
            }
            group.count++; group.last = entry; group.lastAt = match?.[1];
            numericFacts(payload, group.numbers);
            if (Number.isFinite(payload?.elapsedMs) && payload.elapsedMs > group.elapsedMs) {
                group.elapsedMs = payload.elapsedMs; group.slowest = entry;
            }
        });
        return groups.map(group => ({ ...group,
            // Repetition is summarized for every level; distinct failures stay separate.
            text: summarizeEntry(group.first) + (group.count > 1 ?
                '\n  occurrences: ' + group.count + '\n  eventSummary: ' + logger.formatValue({
                    occurrences: group.count, firstAt: group.firstAt, lastAt: group.lastAt, numbers: group.numbers }) : '') +
                (group.slowest !== group.first ? '\n' + summarizeEntry(group.slowest) : ''),
            examples: group.last !== group.first && group.last !== group.slowest ? [summarizeEntry(group.last)] : [] }));
    }
    function normalize(value) {
        return value && typeof value === 'object' ? JSON.parse(logger.formatValue(value)) : value;
    }
    const project = value => summarizeSignals(normalize(value));
    function buildInvestigationLogText() {
        const snapshot = readRuntime();
        const environment = readEnvironment();
        const sizes = {};
        const encode = (value, section) => {
            const result = encodeDiagnostic(value);
            sizes[section] = { plainBytes: result.plainBytes, bytes: result.bytes, packed: result.packed };
            return result.text;
        };
        const format = (value, section) => encode(project(value), section);
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
            'exportMode: signals; grouped outcomes; navigation states with base:before encode field changes',
            'jsonEncoding: plain JSON or shared-json-v1; [index] references values; [schema,members] records; null schema means array; schemas list object keys',
            `entries: ${logger.size()}`,
            `snapshot: ${format(snapshot, 'snapshot')}`,
            `previousPages: ${format(readHistory(), 'previousPages')}`,
            `seriesViewing: ${encode(seriesSummary(normalize(readSeriesViewing())), 'seriesViewing')}`,
            `thumbnailDiagnostics: ${format(readThumbnails(), 'thumbnailDiagnostics')}`,
            `nativePopupDiagnostics: ${format(readNativePopup(), 'nativePopupDiagnostics')}`,
            `exportSizes: ${JSON.stringify(sizes)}`
        ];
        const entries = logger.entries();
        const groups = groupedEntries(entries);
        // Essential summaries always fit by allowing explicit target overflow.
        // Do not let a bulky snapshot or early routine events hide a later decision.
        const essentialSize = utf8Bytes([...lines, '---', ...groups.map(group => group.text)].join('\n')) + 400;
        let budget = Math.max(0, TARGET_BYTES - essentialSize), omittedExamples = 0;
        const eventLines = groups.map(group => {
            const selected = [group.text];
            for (const example of group.examples) {
                const bytes = utf8Bytes(example) + 1;
                if (bytes <= budget) { selected.push(example); budget -= bytes; }
                else omittedExamples++;
            }
            return selected.join('\n');
        });
        const overflow = essentialSize > TARGET_BYTES ? '; essential summaries exceed target' : '';
        return [...lines, 'exportLimits: target ' + TARGET_BYTES + ' UTF-8 bytes' + overflow +
            '; omitted event groups: 0; omitted sections: 0; omitted extra examples: ' + omittedExamples +
            '; repetitions and bulk payloads summarized; depth/string omissions explicit',
            '---', ...eventLines].join('\n') + '\n';
    }

    function snapshot() {
        return project({ runtime: readRuntime(), seriesViewing: seriesSummary(normalize(readSeriesViewing())),
            thumbnails: readThumbnails(), nativePopup: readNativePopup() });
    }
    return Object.freeze({ copy: () => writeText(buildInvestigationLogText()), snapshot, summarize: project });
}
