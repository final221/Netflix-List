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
    const mounted = new Set(mountedIds), found = new Map(), fibers = new Set(); let pagination = null;
    const probe = { fibers: 0, hooks: 0, results: 0, namedQuery: 0, operation: 0, variables: 0, cacheApi: 0, connection: 0, maxOverlap: 0, mounted: mounted.size };
    const seen = new WeakSet(); let inspected = 0;
    function inspect(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return;
        if (inspected++ >= 2048) { probe.truncated = true; return; }
        seen.add(value);
        if (Array.isArray(value)) { for (let i = 0; i < Math.min(value.length, 4); i++) inspect(own(value, String(i)), depth + 1); return; }
        const index = own(value, 'pageIndex'), count = own(value, 'pageCount'), setter = own(value, 'setPageIndex');
        if (!pagination && Number.isSafeInteger(index) && index >= 0 && Number.isSafeInteger(count) && count > index && typeof setter === 'function')
            pagination = { index, set: setter.bind(value) };
        for (const key of ['value', 'current', 'ref', 'state']) inspect(own(value, key), depth + 1);
        if (paginationOnly) return;
        const observable = own(value, 'observable'), options = own(observable, 'options');
        const query = own(options, 'query'), variables = own(options, 'variables') || own(value, 'variables');
        if (observable) probe.results++;
        if (own(query, 'definitions')?.some(d => d?.kind === 'OperationDefinition' && d.name?.value === 'CarouselPage')) probe.namedQuery++;
        if (!carouselQuery(query)) return; probe.operation++;
        if (typeof own(variables, 'rowId') !== 'string') return; probe.variables++;
        const data = own(value, 'data'), client = own(value, 'client') || own(observable, 'client') || own(own(observable, 'queryManager'), 'client'), cache = own(client, 'cache');
        const read = method(cache, 'readQuery'), write = method(cache, 'writeQuery');
        if (!read || !write) return; probe.cacheApi++;
        if (!valid(data)) {
            const value = connection(data);
            probe.rejectedConnection = { edges: Array.isArray(value?.edges) ? value.edges.length : null, totalType: typeof value?.totalCount, pageFlagType: typeof value?.pageInfo?.hasNextPage };
            return;
        } probe.connection++;
        const ids = new Set(connection(data).edges.map(videoId).filter(Boolean));
        const overlap = [...mounted].filter(id => ids.has(id)).length; probe.maxOverlap = Math.max(probe.maxOverlap, overlap);
        if (mounted.size < 2 || overlap < Math.max(2, Math.ceil(mounted.size * .85))) return;
        found.set(observable, { observable, options, query, variables, data, read, write, client, cache, queryRead: method(client, 'query'), overlap });
    }
    for (const root of Array.isArray(card) ? card.slice(0, 3) : [card]) {
        const key = Object.getOwnPropertyNames(root || {}).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
        let fiber = key && own(root, key);
        for (let depth = 0; fiber && depth < 32 && fibers.size < 64 && !fibers.has(fiber) && !(paginationOnly && pagination); depth++, fiber = own(fiber, 'return')) {
            fibers.add(fiber); probe.fibers++; inspect(own(fiber, 'memoizedProps'));
            let hook = own(fiber, 'memoizedState'); const hooks = new Set();
            for (let i = 0; hook && i < 48 && !hooks.has(hook) && !(paginationOnly && pagination); i++, hook = own(hook, 'next')) {
                hooks.add(hook); probe.hooks++; inspect(own(hook, 'memoizedState'));
            }
        }
    }
    if (paginationOnly) return { pagination };
    if (found.size !== 1) return { reason: found.size ? 'ambiguous-query' : 'no-matching-query', probe };
    return { binding: createBinding([...found.values()][0]), pagination, probe };
}
function variableKey(variables) {
    let visited = 0;
    function normalize(value, depth = 0) {
        if (depth > 8 || ++visited > 512) throw Error('variable-limit');
        if (value === undefined || value === null) return [String(value)];
        if (['string', 'boolean'].includes(typeof value)) return [typeof value, value];
        if (typeof value === 'number' && Number.isFinite(value)) return ['number', value];
        if (!value || typeof value !== 'object') throw Error('variable-type');
        if (Array.isArray(value)) {
            if (value.length > 512) throw Error('variable-limit');
            return ['array', Array.from({ length: value.length }, (_, index) => normalize(own(value, String(index)), depth + 1))];
        }
        return ['object', Object.keys(value).sort().filter(key => depth || !['carouselAfterCursor', 'carouselPageSize'].includes(key))
            .map(key => { if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw Error('variable-accessor');
                return [key, normalize(own(value, key), depth + 1)]; })];
    }
    try { return JSON.stringify(normalize(variables)); } catch (_) { return null; }
}
function createBinding(native) {
    const { query, observable, read, write, queryRead } = native, rowId = native.variables.rowId, identity = variableKey(native.variables);
    let options = native.options, optionsRefreshes = 0, loadStop = null, lastLoad = null;
    const edges = new Map(), cursors = new Set(); let server = null, last = null, disabled = false, pendingServer = false;
    const key = edge => videoId(edge) || 'cursor:' + edge.cursor;
    const signature = data => JSON.stringify([connection(data)?.edges?.map(key), connection(data)?.totalCount, connection(data)?.pageInfo]);
    function ownership() {
        const next = own(observable, 'options'), variables = own(next, 'variables');
        return { disabled, optionsChanged: next !== options, queryChanged: own(next, 'query') !== query,
            rowChanged: own(variables, 'rowId') !== rowId, variablesChanged: identity === null || variableKey(variables) !== identity,
            cacheChanged: own(native.client, 'cache') !== native.cache };
    }
    const current = () => { const status = ownership(); return !status.disabled && !status.queryChanged && !status.rowChanged && !status.variablesChanged && !status.cacheChanged; };
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
    function access() {
        if (!current()) throw Error('query-owner-replaced');
        const next = own(observable, 'options'); if (next !== options) { optionsRefreshes++; options = next; }
        return { query, variables: options.variables };
    }
    function publish(choices, assertCurrent, anchor = null, capacity = 8, pagination = null) {
        assertCurrent(); const input = access(), data = read(input); assertCurrent(); ingest(data, !pendingServer || connection(data)?.edges.length > edges.size); pendingServer = false;
        const selected = [...edges.values()].filter(edge => !choices[videoId(edge)]);
        const totalCount = selected.length;
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
        if (!queryRead || !server?.pageInfo.hasNextPage) { loadStop = queryRead ? 'server-exhausted' : 'no-query-api'; return false; }
        const cursor = server.pageInfo.endCursor;
        if (cursors.has(cursor)) { loadStop = 'cursor-stalled'; return false; }
        cursors.add(cursor);
        const pageSize = Number.isSafeInteger(input.variables.carouselPageSize) ? Math.min(28, Math.max(1, input.variables.carouselPageSize)) : 14;
        let result;
        try { result = await queryRead({ query, variables: { ...input.variables, carouselAfterCursor: cursor, carouselPageSize: pageSize },
            fetchPolicy: 'no-cache', context: { ...options.context, fetchOptions: { ...options.context?.fetchOptions, signal } } }); }
        catch (error) { cursors.delete(cursor); throw error; }
        assertCurrent(); if (signal.aborted) throw Error('query-aborted'); access();
        if (result.error || result.errors?.length) throw Error('native-query-failed');
        const before = edges.size; ingest(result.data); pendingServer = true;
        lastLoad = { received: connection(result.data).edges.length, added: edges.size - before, cursorAdvanced: server.pageInfo.endCursor !== cursor };
        loadStop = !server.pageInfo.hasNextPage ? 'server-exhausted' : !lastLoad.cursorAdvanced ? 'cursor-stalled' : null;
        return true;
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
                hasNextPage: server.pageInfo.hasNextPage, canLoad: Boolean(queryRead), overlap: native.overlap,
                serverTotal: server.totalCount, optionsRefreshes, ownership: ownership(), loadStop, lastLoad: lastLoad && { ...lastLoad } };
        } });
}
