import { createMutations } from './mutations.js';
import { createCollection } from './collection.js';
import { createMembership } from './membership.js';

// Public list boundary: scalar records, authoritative membership and collection strategy.
export function createList(options) {
    const normalized = new WeakMap();
    const text = value => value === null || value === undefined ? '' : String(value);
    function toRecord(input) {
        if (normalized.has(input)) return normalized.get(input);
        const record = Object.freeze({ videoId: text(input.videoId), href: text(input.href), ariaLabel: text(input.ariaLabel),
            imageUrl: text(input.imageUrl),
            graphql: Boolean(input.graphql) });
        normalized.set(input, record); normalized.set(record, record);
        return record;
    }
    const collection = createCollection({ ...options, toRecord });
    return Object.freeze({ createMutations: mutationOptions => createMutations({ ...mutationOptions, prepareRecords: collection.prepareRecords }), createMembership, toRecord, prepareEntry: collection.prepareEntry, prepareRecords: collection.prepareRecords,
        waitForInitialCount: collection.waitForInitialCount,
        collectForPublication: collection.collectForPublication,
        preparePreferred: collection.preparePreferred,
        collectLogical: collection.collectLogical,
        diagnostics: collection.diagnostics, resetDiagnostics: collection.resetDiagnostics });
}
