import { createCollection } from './collection.js';
import { createMembership } from './membership.js';

// Public list boundary; final record normalization and remaining strategy follow in P13.
export function createList(options) {
    const collection = createCollection(options);
    return Object.freeze({ createMembership, collectLogical: collection.collectLogical, buildItems: collection.buildItems,
        diagnostics: collection.diagnostics, resetDiagnostics: collection.resetDiagnostics });
}
