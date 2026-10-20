// Native query/cache data stays private. The feature receives operations and copied counts only.
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function method(value, key) {
    for (let i = 0, node = value; node && i < 5; i++, node = Object.getPrototypeOf(node)) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (descriptor) return typeof descriptor.value === 'function' ? descriptor.value.bind(value) : null;
    }
    return null;
}
const connection = data => data?.node?.entities;
function videoId(edge) {
    const value = edge?.node?.unifiedEntity?.videoId ?? edge?.node?.videoId ?? edge?.node?.id;
    return (typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) ? String(value) : null;
}
function valid(data) {
    const value = connection(data);
    return value && Array.isArray(value.edges) && value.edges.length <= 500 &&
        value.edges.every(edge => edge && typeof edge === 'object' && (videoId(edge) || typeof edge.cursor === 'string')) &&
        Number.isSafeInteger(value.totalCount) && value.totalCount >= value.edges.length &&
        typeof value.pageInfo?.hasNextPage === 'boolean' &&
        (!value.pageInfo.hasNextPage || typeof value.pageInfo.endCursor === 'string' && value.pageInfo.endCursor.length > 0);
}
function carouselQuery(query) {
    const definitions = own(query, 'definitions');
    const operations = Array.isArray(definitions) ? definitions.filter(d => d?.kind === 'OperationDefinition') : [];
    const operation = operations[0], variables = operation?.variableDefinitions;
    return operations.length === 1 && operation.operation === 'query' && operation.name?.value === 'CarouselPage' &&
        Array.isArray(variables) && ['rowId', 'carouselAfterCursor', 'carouselPageSize'].every(name => variables.some(v => v?.variable?.name?.value === name));
}
export function findRecommendationQuery(card, mountedIds, { paginationOnly = false } = {}) {
    const mounted = new Set(mountedIds), found = new Map(); let pagination = null;
    const key = Object.getOwnPropertyNames(card || {}).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    let fiber = key && own(card, key); const fibers = new Set();
    function inspect(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 2) return;
        if (Array.isArray(value)) { for (let i = 0; i < Math.min(value.length, 4); i++) inspect(own(value, String(i)), depth + 1); return; }
        const index = own(value, 'pageIndex'), count = own(value, 'pageCount'), setter = own(value, 'setPageIndex');
        if (!pagination && Number.isSafeInteger(index) && index >= 0 && Number.isSafeInteger(count) && count > index && typeof setter === 'function')
            pagination = { index, set: setter.bind(value) };
        if (paginationOnly) { inspect(own(value, 'value'), depth + 1); return; }
        const observable = own(value, 'observable'), options = own(observable, 'options');
        const query = own(options, 'query'), variables = own(options, 'variables') || own(value, 'variables');
        if (!carouselQuery(query) || typeof own(variables, 'rowId') !== 'string') { inspect(own(value, 'value'), depth + 1); return; }
        const data = own(value, 'data'), client = own(value, 'client'), cache = own(client, 'cache');
        const read = method(cache, 'readQuery'), write = method(cache, 'writeQuery');
        if (!read || !write || !valid(data)) return;
        const ids = new Set(connection(data).edges.map(videoId).filter(Boolean));
        const overlap = [...mounted].filter(id => ids.has(id)).length;
        if (mounted.size < 2 || overlap < Math.max(2, Math.ceil(mounted.size * .85))) return;
        found.set(observable, { observable, options, query, variables, data, read, write, queryRead: method(client, 'query'), overlap });
    }
    for (let depth = 0; fiber && depth < 24 && !fibers.has(fiber) && !(paginationOnly && pagination); depth++, fiber = own(fiber, 'return')) {
        fibers.add(fiber); inspect(own(fiber, 'memoizedProps'));
        let hook = own(fiber, 'memoizedState'); const hooks = new Set();
        for (let i = 0; hook && i < 48 && !hooks.has(hook) && !(paginationOnly && pagination); i++, hook = own(hook, 'next')) {
            hooks.add(hook); inspect(own(hook, 'memoizedState'));
        }
    }
    if (paginationOnly) return { pagination };
    if (found.size !== 1) return { reason: found.size ? 'ambiguous-query' : 'no-matching-query' };
    return { binding: createBinding([...found.values()][0]), pagination };
}
function createBinding(native) {
    const { query, options, observable, read, write, queryRead } = native, rowId = native.variables.rowId;
    const edges = new Map(), cursors = new Set(); let server = null, last = null, disabled = false, pendingServer = false;
    const key = edge => videoId(edge) || 'cursor:' + edge.cursor;
    const signature = data => JSON.stringify([connection(data)?.edges?.map(key), connection(data)?.totalCount, connection(data)?.pageInfo]);
    const current = () => !disabled && own(observable, 'options') === options && own(options, 'query') === query && own(own(options, 'variables'), 'rowId') === rowId;
    function ingest(data, updateServer = true) {
        if (!valid(data)) throw Error('invalid-connection');
        const value = connection(data);
        if (edges.size + value.edges.filter(edge => !edges.has(key(edge))).length > 500) throw Error('row-capacity');
        for (const edge of value.edges) if (updateServer || !edges.has(key(edge))) edges.set(key(edge), edge);
        if (updateServer && signature(data) !== last) server = { totalCount: value.totalCount, pageInfo: { ...value.pageInfo } };
    }
    function copy(data, selected, metadata) {
        return { ...data, node: { ...data.node, entities: { ...connection(data), edges: selected, ...metadata } } };
    }
    function access() { if (!current()) throw Error('query-owner-replaced'); return { query, variables: options.variables }; }
    function publish(choices, assertCurrent, anchor = null, capacity = 8, pagination = null) {
        assertCurrent(); const input = access(), data = read(input); assertCurrent(); ingest(data, !pendingServer || connection(data)?.edges.length > edges.size); pendingServer = false;
        const selected = [...edges.values()].filter(edge => !choices[videoId(edge)]);
        const totalCount = selected.length + (server.pageInfo.hasNextPage ? Math.max(0, server.totalCount - edges.size) : 0);
        const output = copy(data, selected, { totalCount, pageInfo: server.pageInfo });
        if (signature(output) === signature(data)) return false;
        const original = data; last = signature(output);
        assertCurrent(); write({ ...input, data: output, overwrite: true }); assertCurrent();
        const observed = read(input); assertCurrent();
        if (signature(observed) !== last) {
            write({ ...input, data: original, overwrite: true }); disabled = true; throw Error('cache-projection-rejected');
        }
        const index = selected.findIndex(edge => videoId(edge) === anchor);
        if (pagination) {
            const position = index >= 0 ? index : Math.min(pagination.index * capacity, Math.max(0, selected.length - 1));
            assertCurrent(); pagination.set(Math.floor(position / capacity));
        }
        return true;
    }
    async function load(signal, assertCurrent) {
        assertCurrent(); const input = access();
        if (!queryRead || !server?.pageInfo.hasNextPage) return false;
        const cursor = server.pageInfo.endCursor;
        if (cursors.has(cursor)) return false;
        cursors.add(cursor);
        const pageSize = Number.isSafeInteger(input.variables.carouselPageSize) ? Math.min(28, Math.max(1, input.variables.carouselPageSize)) : 14;
        let result;
        try { result = await queryRead({ query, variables: { ...input.variables, carouselAfterCursor: cursor, carouselPageSize: pageSize },
            fetchPolicy: 'no-cache', context: { ...options.context, fetchOptions: { ...options.context?.fetchOptions, signal } } }); }
        catch (error) { cursors.delete(cursor); throw error; }
        assertCurrent(); if (signal.aborted) throw Error('query-aborted'); access();
        if (result.error || result.errors?.length) throw Error('native-query-failed');
        ingest(result.data); pendingServer = true; return true;
    }
    function restore(assertCurrent) {
        if (!last || !current()) return false;
        assertCurrent(); const input = access(), data = read(input); assertCurrent();
        if (signature(data) !== last) return false;
        write({ ...input, data: copy(data, [...edges.values()], server), overwrite: true }); last = null; return true;
    }
    ingest(native.data);
    return Object.freeze({ publish, load, restore, current,
        state(choices, anchor) {
            const ids = [...edges.values()].map(videoId).filter(id => id && !choices[id]);
            return { known: edges.size, filtered: ids.length, anchorIndex: Math.max(0, ids.indexOf(anchor)),
                hasNextPage: server.pageInfo.hasNextPage, canLoad: Boolean(queryRead), overlap: native.overlap };
        } });
}
