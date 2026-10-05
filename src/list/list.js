import { createCollection } from './collection.js';
import { createMembership } from './membership.js';

// Public list boundary; final record normalization and remaining strategy follow in P13.
export function createList(options) {
    const normalized = new WeakMap();
    const text = value => value === null || value === undefined ? '' : String(value);
    function toRecord(input) {
        if (normalized.has(input)) return normalized.get(input);
        const record = Object.seal({ videoId: text(input.videoId), href: text(input.href), ariaLabel: text(input.ariaLabel),
            imageUrl: text(input.imageUrl), page: Number.isFinite(input.page) ? input.page : 0,
            graphql: Boolean(input.graphql) });
        normalized.set(input, record); normalized.set(record, record);
        return record;
    }
    const collection = createCollection({ ...options, toRecord });
    return Object.freeze({ createMembership, toRecord, prepareEntry: collection.prepareEntry, prepareRecords: collection.prepareRecords,
        waitForInitialCount: collection.waitForInitialCount,
        collectForPublication: collection.collectForPublication,
        preparePreferred: collection.preparePreferred,
        collectLogical: collection.collectLogical, buildItems: collection.buildItems,
        diagnostics: collection.diagnostics, resetDiagnostics: collection.resetDiagnostics });
}
