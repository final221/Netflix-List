// Pure report projection. No feature state, observers or diagnostic reads live here.
const DIAGNOSTIC_FIELD = /status|outcome|reason|code|mode|strategy|source|phase|stage|method|failure|error|manualChoice|entryKind|generation|kind|operation|direction|action|targetGroup|placement|disposition/i;
const IDENTITY_FIELD = /^(?:rowId|sectionId|graphqlKey|videoId|id|href|title|label|name|sequence|seq|token)$/i;
const BULK_CONTEXT = /^(?:snapshot|before|afterAtExport|state|layout|performanceWork)$/;

export function diagnosticFacts(value, prefix = '', facts = [], depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth >= 8) return facts;
    for (const [key, item] of Object.entries(value)) {
        if ((IDENTITY_FIELD.test(key) && !(key === 'name' && /(?:^|\.)error$/i.test(prefix))) || BULK_CONTEXT.test(key)) continue;
        const path = prefix ? prefix + '.' + key : key;
        if (typeof item === 'boolean' || (typeof item === 'string' &&
            (DIAGNOSTIC_FIELD.test(key) || key === 'message' || (key === 'name' && /(?:^|\.)error$/i.test(prefix)) || /(?:^|\.)fields\./.test(path)))) facts.push([path, item]);
        else if (typeof item === 'number' && /^(visible|remaining|pending|failed|shortfall)$/.test(key)) facts.push([path + '.zero', item === 0]);
        else if (item && typeof item === 'object') diagnosticFacts(item, path, facts, depth + 1);
    }
    return facts.sort(([a], [b]) => a.localeCompare(b));
}

export function numericFacts(value, numbers, prefix = '', depth = 0) {
    if (!value || typeof value !== 'object' || depth >= 8) return;
    // Coordinate tuples carry useful bounds; title and payload arrays do not.
    if (Array.isArray(value) && (value.length > 4 || !value.every(Number.isFinite))) return;
    for (const [key, item] of Object.entries(value)) {
        if (BULK_CONTEXT.test(key)) continue;
        const path = prefix ? prefix + '.' + key : key;
        if (typeof item === 'number' && Number.isFinite(item)) {
            const stat = numbers[path] ||= { count: 0, min: item, max: item,
                ...(/Ms$/.test(key) ? { total: 0 } : {}) };
            stat.count++; stat.min = Math.min(stat.min, item); stat.max = Math.max(stat.max, item);
            if ('total' in stat) stat.total += item;
        } else if (item && typeof item === 'object') numericFacts(item, numbers, path, depth + 1);
    }
}

function stateChanges(before, current) {
    if (!before || !current || typeof current !== 'object') return current;
    if (current.base === 'before' && current.changes) return current;
    const changes = Object.fromEntries(Object.entries(current).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(before[key])));
    const removed = Object.keys(before).filter(key => !Object.hasOwn(current, key));
    return { base: 'before', changes, ...(removed.length ? { removed } : {}) };
}

function navigationRecord(record, depth) {
    const result = Object.fromEntries(Object.entries(record).filter(([key]) => !['samples', 'afterAtExport'].includes(key))
        .map(([key, value]) => [key, summarizeSignals(value, depth + 1, key)]));
    if (Object.hasOwn(record, 'afterAtExport')) {
        result.afterAtExport = stateChanges(result.before, summarizeSignals(record.afterAtExport, depth + 1, 'state'));
    }
    if (Array.isArray(record.samples)) result.samples = record.samples.map(sample => Object.fromEntries(
        Object.entries(sample).map(([key, value]) => [key, key === 'state'
            ? stateChanges(result.before, summarizeSignals(value, depth + 1, key))
            : summarizeSignals(value, depth + 1, key)])));
    return result;
}

function navigationSummary(value, depth) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        ['recent', 'actions'].includes(key) && Array.isArray(item)
            ? item.map(record => navigationRecord(record, depth + 1))
            : summarizeSignals(item, depth + 1, key)]));
}

function arraySummary(value, depth, key) {
    if (value.length <= 4 || key === 'visibleIds' || key === 'arrows') {
        return value.map(item => summarizeSignals(item, depth + 1));
    }
    if (value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        const counts = new Map();
        for (const item of value) counts.set(item, (counts.get(item) || 0) + 1);
        if (counts.size <= 12 && counts.size < value.length) return { count: value.length,
            values: [...counts].map(([item, count]) => ({ value: summarizeSignals(item), count })) };
        const indices = [...new Set([0, 1, 2, value.length - 3, value.length - 2, value.length - 1])];
        return { count: value.length, unique: counts.size, samples: indices
            .map(index => summarizeSignals(value[index])), omitted: value.length - indices.length };
    }
    const groups = new Map();
    for (let index = 0; index < value.length; index++) {
        const item = value[index], signature = JSON.stringify(diagnosticFacts(item));
        if (!groups.has(signature)) groups.set(signature, { count: 0, first: index, last: index,
            slowest: index, elapsedMs: -Infinity, numbers: Object.create(null) });
        const group = groups.get(signature); group.count++; group.last = index;
        numericFacts(item, group.numbers);
        if (Number.isFinite(item?.elapsedMs) && item.elapsedMs > group.elapsedMs) {
            group.elapsedMs = item.elapsedMs; group.slowest = index;
        }
    }
    const indices = new Set();
    for (const group of groups.values()) for (const index of [group.first, group.last, group.slowest]) indices.add(index);
    const ordered = [...indices].sort((a, b) => a - b);
    return { count: value.length, samples: ordered.map(index => summarizeSignals(value[index], depth + 1)),
        omitted: value.length - ordered.length,
        groups: [...groups.values()].map(group => ({ count: group.count,
            sample: ordered.indexOf(group.first), numbers: group.numbers })) };
}

export function summarizeSignals(value, depth = 0, key = '') {
    if (typeof value === 'string') {
        if (key === 'stack') {
            const lines = value.split('\n');
            return lines.length > 6 ? lines.slice(0, 6).join('\n') + `\n[${lines.length - 6} more stack lines]` : value;
        }
        return value.length > 400 && !DIAGNOSTIC_FIELD.test(key) && key !== 'message'
            ? value.slice(0, 400) + ` [truncated; original characters: ${value.length}]` : value;
    }
    if (!value || typeof value !== 'object') return value;
    // Stored page facts and upstream bounded surveys may already use this shape.
    if (Number.isSafeInteger(value.count) &&
        ((Array.isArray(value.samples) && Number.isSafeInteger(value.omitted)) ||
        (Array.isArray(value.values) && value.values.every(item => Number.isSafeInteger(item?.count) && Object.hasOwn(item, 'value'))))) return value;
    if (depth >= 16) return { omitted: true, kind: Array.isArray(value) ? 'array' : 'object', reason: 'diagnostic-depth-limit' };
    // This owner already bounds copied scalar timelines and pins disruption context.
    if (key === 'rowLifecycle' || key === 'workTiming') return value;
    if (key === 'navigation' && Array.isArray(value.recent)) return navigationSummary(value, depth);
    if (Array.isArray(value)) return arraySummary(value, depth, key);
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, summarizeSignals(item, depth + 1, name)]));
}

export function seriesSummary(rows) {
    if (!Array.isArray(rows)) return summarizeSignals(rows);
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.status, row.reason, diagnosticFacts(row)]);
        if (!groups.has(key)) groups.set(key, { status: row.status, reason: row.reason, count: 0, samples: [] });
        const group = groups.get(key); group.count++;
        if (!group.samples.length) group.samples.push(summarizeSignals(row));
    }
    return { count: rows.length, groups: [...groups.values()] };
}
