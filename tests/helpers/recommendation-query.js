// Public Apollo cache/query boundary fixture; not evidence of Netflix's live implementation.
export function queryFixture(ids = ['1', '2', '3'], { hasNextPage = false, totalCount = ids.length } = {}) {
    const query = { definitions: [{ kind: 'OperationDefinition', operation: 'query', name: { value: 'CarouselPage' },
        variableDefinitions: ['rowId', 'carouselAfterCursor', 'carouselPageSize'].map(name => ({ variable: { name: { value: name } } })) }] };
    const variables = { rowId: 'private-row', carouselAfterCursor: '', carouselPageSize: 14 };
    const page = (ids, hasNextPage = false, totalCount = ids.length, cursor = 'private-end') => ({ node: { id: 'private-node', __typename: 'Row',
        entities: { __typename: 'Connection', edges: ids.map(id => ({ cursor: 'private-' + id, node: { unifiedEntity: { videoId: id }, untouched: id } })),
            totalCount, pageInfo: { hasNextPage, endCursor: cursor } } } });
    const state = { data: page(ids, hasNextPage, totalCount), reads: 0, writes: [], requests: [], pages: [], rejectWrites: false, onWrite: null };
    class Cache {
        readQuery(options) { if (options.query !== query || options.variables.rowId !== variables.rowId) throw Error('wrong query'); state.reads++; return state.data; }
        writeQuery(options) { state.writes.push(options); if (!options.overwrite) throw Error('overwrite required');
            if (!state.rejectWrites) { state.data = options.data; result.data = state.data; state.onWrite?.(state.data); } }
    }
    class Client {
        constructor() { this.cache = new Cache(); }
        query(options) { state.requests.push(options); return state.pages.shift() || Promise.resolve({ data: state.data }); }
    }
    const observable = { options: { query, variables, fetchPolicy: 'network-only', context: { preserve: true } } };
    const result = { observable, client: new Client(), variables, data: state.data };
    const pageIndices = [];
    function attach(card) { card.__reactFiber$queryTest = { memoizedState: { memoizedState: [result], next: {
        memoizedState: [{ pageIndex: 0, pageCount: 20, setPageIndex: index => pageIndices.push(index) }], next: null } }, return: null }; }
    return { state, query, variables, result, page, attach, pageIndices, card() { const card = {}; attach(card); return card; } };
}
