import { createCollection } from './collection.js';

// List's collection boundary; membership/order transfer follows in P13.
export function createList(options) {
    const collection = createCollection(options);
    return Object.freeze({ collectLogical: collection.collectLogical, buildItems: collection.buildItems,
        diagnostics: collection.diagnostics, resetDiagnostics: collection.resetDiagnostics });
}
