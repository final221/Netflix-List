// Passive query-result interpretation. Raw query/cursor/identity values never leave this owner.
export function createLoaderSurvey(rowIds) {
    const mounted = new Set(rowIds), candidates = [], seen = new WeakSet();
    const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    const safeName = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,79}$/.test(value) ? value : null;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    let truncated = false;
    const items = (value, limit) => Array.isArray(value) ? Array.from({ length: Math.min(value.length, limit) }, (_, i) => own(value, String(i))) : [];
    function definitions(query) {
        const operations = [];
        for (const definition of items(own(query, 'definitions'), 4)) {
            if (own(definition, 'kind') !== 'OperationDefinition') continue;
            const variables = [];
            for (const variable of items(own(definition, 'variableDefinitions'), 20)) {
                const name = safeName(own(own(own(variable, 'variable'), 'name'), 'value'));
                if (!name || /auth|token|cookie|credential|profile|account|session/i.test(name)) continue;
                let type = own(variable, 'type'), parts = [];
                for (let i = 0; type && i < 6; i++, type = own(type, 'type')) {
                    const kind = own(type, 'kind'), name = safeName(own(own(type, 'name'), 'value'));
                    if (kind === 'NamedType' && name) parts.push(name);
                    else if (kind === 'ListType' || kind === 'NonNullType') parts.push(kind);
                }
                variables.push({ name, type: parts.join(':') });
            }
            operations.push({ name: safeName(own(own(definition, 'name'), 'value')),
                kind: ['query', 'mutation', 'subscription'].includes(own(definition, 'operation')) ? own(definition, 'operation') : null, variables });
        }
        return operations;
    }
    function inspect(result, location) {
        if (!result || typeof result !== 'object' || seen.has(result) || typeof own(result, 'fetchMore') !== 'function') return;
        seen.add(result);
        if (candidates.length >= 16) { truncated = true; return; }
        const observable = own(result, 'observable'), options = own(observable, 'options') || own(result, 'options');
        const variables = own(result, 'variables') || own(options, 'variables');
        const query = own(options, 'query') || own(result, 'query');
        const data = own(result, 'data'), node = own(data, 'node');
        const dataKeys = Object.keys(data && typeof data === 'object' ? data : {}).filter(key => safeName(key) && !/auth|token|cookie|credential|profile|account|session/i.test(key)).slice(0, 12);
        const connection = own(node, 'entities'), edges = own(connection, 'edges'), pageInfo = own(connection, 'pageInfo');
        const ids = [];
        if (Array.isArray(edges)) for (let i = 0; i < Math.min(edges.length, 200); i++) {
            const edge = own(edges, String(i)), entity = own(edge, 'node'), unified = own(entity, 'unifiedEntity');
            const id = own(unified, 'videoId') || own(entity, 'videoId') || own(entity, 'id');
            if ((typeof id === 'string' || typeof id === 'number' && Number.isSafeInteger(id)) && /^\d+$/.test(String(id))) ids.push(String(id));
        }
        const variableFacts = [];
        for (const name of Object.keys(variables || {}).slice(0, 24)) {
            if (!safeName(name) || /auth|token|cookie|credential|profile|account|session/i.test(name)) continue;
            const value = own(variables, name);
            variableFacts.push({ name, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
                ...(/^(first|last|count|limit|offset|pageSize)$/i.test(name) && count(value) !== null ? { value } : {}) });
        }
        const identity = own(node, 'id');
        const identityMatches = typeof identity === 'string' && Object.keys(variables || {}).some(key =>
            /^(id|rowId|listId|nodeId)$/i.test(key) && own(variables, key) === identity);
        const fetchPolicy = own(options, 'fetchPolicy');
        candidates.push({ ...location, dataKeys, accessors: ['data', 'variables', 'observable', 'options'].filter(key => Boolean(Object.getOwnPropertyDescriptor(result, key)?.get)), operations: definitions(query), variables: variableFacts,
            observable: Boolean(observable), observableFetchMore: typeof own(observable, 'fetchMore') === 'function',
            fetchPolicy: ['cache-first', 'cache-only', 'cache-and-network', 'network-only', 'no-cache', 'standby'].includes(fetchPolicy) ? fetchPolicy : null,
            connection: { totalCount: count(own(connection, 'totalCount')), edges: Array.isArray(edges) ? edges.length : null,
                hasNextPage: typeof own(pageInfo, 'hasNextPage') === 'boolean' ? own(pageInfo, 'hasNextPage') : null,
                cursorPresent: typeof own(pageInfo, 'endCursor') === 'string' && Boolean(own(pageInfo, 'endCursor')),
                identityMatchesVariable: identityMatches, titleIds: ids.slice(0, 12), titleIdsTruncated: ids.length > 12,
                rowOverlap: new Set(ids.filter(id => mounted.has(id))).size },
            limitation: 'candidate only; arguments and native cache/render behavior unverified' });
    }
    return Object.freeze({ inspect, snapshot() { return JSON.parse(JSON.stringify({ candidates: candidates.slice().sort((a, b) => b.connection.rowOverlap - a.connection.rowOverlap).slice(0, 4),
        truncated: truncated || candidates.length > 4 })); } });
}
