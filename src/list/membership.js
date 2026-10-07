// Private membership/order/count state; callers borrow collections and request changes.
export function createMembership({ items = [], totalCount = null, collectedCount = 0 } = {}) {
    let records = Object.freeze([]), map = new Map(), lookup;
    let expectedCount = totalCount, collected = collectedCount, revision = 0, disposed = false;
    const keyFor = record => record.videoId ? 'v:' + record.videoId : 'h:' + record.href;
    const error = (code, message) => Object.assign(new Error(message), { code });
    function assertRecord(record) {
        if (!record || typeof record !== 'object' || 'snapshot' in record || 'cardTemplate' in record ||
            'undoId' in record || 'logicalIndex' in record || 'page' in record ||
            Object.values(record).some(value => value !== null && (typeof value === 'object' || typeof value === 'function'))) {
            throw error('LIST_RECORD_INVALID', 'Membership requires scalar records and separate material');
        }
    }
    function view() {
        return Object.freeze({ get size() { return map.size; }, get: key => map.get(key), has: key => map.has(key),
            *values() { yield* records; },
            *entries() { for (const record of records) yield [keyFor(record), record]; },
            [Symbol.iterator]() { return this.entries(); } });
    }
    function guardFor({ assertCurrent = () => {} } = {}) {
        const owner = revision;
        return () => {
            if (disposed) throw error('LIST_RETIRED', 'Membership parent was retired');
            assertCurrent();
            if (disposed) throw error('LIST_RETIRED', 'Membership parent was retired');
            if (owner !== revision) throw error('LIST_REPLACED', 'Membership command was superseded');
        };
    }
    function preparePublication(items, totalCount, admission = {}) {
        let guard = guardFor(admission); guard();
        const next = [...items], nextMap = new Map();
        for (const record of next) {
            assertRecord(record); guard();
            const key = keyFor(record);
            if (nextMap.has(key)) throw error('LIST_DUPLICATE_RECORD', 'Duplicate membership: ' + key);
            nextMap.set(key, record); guard();
        }
        guard();
        const accepted = Object.freeze(next);
        let committed = false;
        return Object.freeze({ records: accepted, assertCurrent: () => guard(), commit() {
            guard(); if (committed) return records;
            guard(); records = accepted; map = nextMap; expectedCount = totalCount; collected = next.length;
            revision++; lookup = view(); committed = true; guard = guardFor(admission); return records;
        } });
    }
    function publish(items, totalCount, admission = {}) {
        return preparePublication(items, totalCount, admission).commit();
    }
    function remove(key, admission = {}) {
        const guard = guardFor(admission); guard();
        const record = map.get(key); if (!record) return null;
        const index = records.indexOf(record), next = records.filter(item => item !== record); guard();
        records = Object.freeze(next); map.delete(key); expectedCount = records.length; collected = records.length;
        revision++; lookup = view(); return Object.freeze({ record, index });
    }
    function insert(record, position = 0, admission = {}) {
        const guard = guardFor(admission); guard();
        assertRecord(record); guard();
        const key = keyFor(record); guard(); if (map.has(key)) return false;
        const index = Math.max(0, Math.min(records.length, Number.isFinite(position) ? Math.floor(position) : 0));
        const next = [...records.slice(0, index), record, ...records.slice(index)]; guard();
        records = Object.freeze(next); map.set(key, record); expectedCount = records.length; collected = records.length;
        revision++; lookup = view(); return true;
    }
    function alignVisible(ids, base, admission = {}) {
        const guard = guardFor(admission); guard();
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !map.has('v:' + id))) return false;
        base = Math.min(records.length, Math.max(0, base));
        if (records.slice(base, base + ids.length).map(item => item.videoId).join('|') === ids.join('|')) return false;
        const selected = new Set(ids), ordered = ids.map(id => map.get('v:' + id));
        const remaining = records.filter(item => !selected.has(item.videoId)), insertion = Math.min(base, remaining.length);
        const next = [...remaining.slice(0, insertion), ...ordered, ...remaining.slice(insertion)]; guard();
        records = Object.freeze(next); revision++; lookup = view();
        return Object.freeze({ records, ordered: Object.freeze(ordered), index: insertion });
    }
    function observeCount(facts, admission = {}) {
        const guard = guardFor(admission); guard();
        const expected = facts.totalCount, progress = facts.collectedCount; guard();
        if (expected !== undefined && expected !== expectedCount) { expectedCount = expected; revision++; }
        if (progress !== undefined && progress !== collected) { collected = progress; revision++; }
    }
    publish(items, totalCount); collected = collectedCount;
    function dispose() {
        if (disposed) return;
        disposed = true; revision++;
        records = Object.freeze([]); map.clear(); expectedCount = null; collected = 0;
    }
    function positionDeviation(item, actualIndex) {
        if (disposed || !item || !records.length) return null;
        const expectedIndex = records.indexOf(item);
        if (expectedIndex < 0 || !Number.isSafeInteger(actualIndex) || actualIndex < 0) return null;
        const delta = actualIndex - expectedIndex;
        return Object.freeze({ expectedIndex, actualIndex, delta, absoluteDelta: Math.abs(delta) });
    }
    function firstPositionMismatch(cards, threshold) {
        if (disposed) return null;
        for (const card of cards || []) {
            const item = card.videoId ? map.get('v:' + card.videoId) : records.find(record => record.href === card.href);
            const deviation = positionDeviation(item, card.itemIndex);
            if (deviation && deviation.absoluteDelta >= threshold) return Object.freeze({ item, deviation });
        }
        return null;
    }
    return Object.freeze({ preparePublication, publish, remove, insert, alignVisible, observeCount, dispose,
        positionDeviation, firstPositionMismatch,
        get records() { return records; }, get lookup() { return lookup; }, get expectedCount() { return expectedCount; },
        get collectedCount() { return collected; }, get revision() { return revision; } });
}
