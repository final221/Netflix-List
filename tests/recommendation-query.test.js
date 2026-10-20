import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecommendationQuery } from '../src/netflix/recommendation-query.js';
import { queryFixture } from './helpers/recommendation-query.js';

const ids = data => data.node.entities.edges.map(edge => edge.node.unifiedEntity.videoId);
test('matched native data is filtered before paging, preserves raw edges, and restores without server writes', () => {
    const f = queryFixture(['1', '2', '3', '4']), original = f.state.data;
    const { binding, pagination } = findRecommendationQuery(f.card(), ['1', '2']);
    assert.equal(binding.publish({ 1: 'hide', 3: 'watched' }, () => {}, '2', 2, pagination), true);
    assert.deepEqual(ids(f.state.data), ['2', '4']); assert.equal(f.state.data.node.entities.totalCount, 2);
    assert.deepEqual(ids(original), ['1', '2', '3', '4']); assert.deepEqual(f.pageIndices, [0]);
    assert.equal(binding.publish({ 1: 'hide', 3: 'watched' }, () => {}), false);
    assert.equal(f.state.writes.length, 1); assert.equal(f.state.requests.length, 0);
    assert.equal(binding.restore(() => {}), true); assert.deepEqual(ids(f.state.data), ids(original));
});

test('new native pages merge in order and hidden records can be restored after incoming cache updates', () => {
    const f = queryFixture(['1', '2', '3'], { hasNextPage: true, totalCount: 5 });
    const { binding } = findRecommendationQuery(f.card(), ['1', '2']); binding.publish({ 2: 'hide' }, () => {});
    f.state.data = f.page(['1', '3', '4', '5'], false, 5);
    binding.publish({ 2: 'hide', 5: 'hide' }, () => {});
    assert.deepEqual(ids(f.state.data), ['1', '3', '4']);
    assert.equal(f.state.data.node.entities.pageInfo.endCursor, 'private-end');
    binding.publish({}, () => {}); assert.deepEqual(ids(f.state.data), ['1', '2', '3', '4', '5']);
    assert.equal(f.state.data.node.entities.totalCount, 5);
});

test('lookahead uses the matched read-only query and keeps network results private until guarded publication', async () => {
    const f = queryFixture(['1', '2'], { hasNextPage: true, totalCount: 4 });
    const { binding } = findRecommendationQuery(f.card(), ['1', '2']);
    f.state.pages.push(Promise.resolve({ data: f.page(['3', '4'], false, 4, 'next-cursor') }));
    const controller = new AbortController(); await binding.load(controller.signal, () => {});
    assert.deepEqual(ids(f.state.data), ['1', '2']);
    assert.equal(f.state.requests[0].fetchPolicy, 'no-cache');
    assert.equal(f.state.requests[0].context.fetchOptions.signal, controller.signal);
    assert.equal(f.state.requests[0].context.preserve, true);
    binding.publish({ 2: 'hide' }, () => {}); assert.deepEqual(ids(f.state.data), ['1', '3', '4']);
    assert.equal(binding.state({}, '1').hasNextPage, false);
    assert.doesNotMatch(JSON.stringify(binding.state({}, '1')), /private-|next-cursor/);
});

test('ambiguous or unrelated query candidates and changed query owners cannot write', () => {
    const f = queryFixture(), card = f.card(), other = queryFixture();
    card.__reactFiber$queryTest.return = { memoizedState: { memoizedState: [other.result], next: null }, return: null };
    assert.equal(findRecommendationQuery(card, ['1', '2']).reason, 'ambiguous-query'); assert.equal(f.state.reads, 0);
    f.query.definitions[0].name.value = 'DifferentQuery';
    assert.equal(findRecommendationQuery(f.card(), ['1', '2']).reason, 'no-matching-query');
    f.query.definitions[0].name.value = 'CarouselPage';
    const { binding } = findRecommendationQuery(f.card(), ['1', '2']); f.result.observable.options.variables = { rowId: 'other' };
    assert.throws(() => binding.publish({ 1: 'hide' }, () => {}), /owner-replaced/); assert.equal(f.state.writes.length, 0);
});

test('readback rejection rolls back and retirement during a network read prevents stale publication', async () => {
    const f = queryFixture(), { binding } = findRecommendationQuery(f.card(), ['1', '2']);
    f.state.rejectWrites = true;
    assert.throws(() => binding.publish({ 1: 'hide' }, () => {}), /projection-rejected/);
    assert.deepEqual(ids(f.state.data), ['1', '2', '3']);
    const later = queryFixture(['1', '2'], { hasNextPage: true, totalCount: 3 }); let resolve, current = true;
    const { binding: active } = findRecommendationQuery(later.card(), ['1', '2']);
    later.state.pages.push(new Promise(done => { resolve = done; }));
    const work = active.load(new AbortController().signal, () => { if (!current) throw Error('retired'); });
    current = false; resolve({ data: later.page(['3'], false, 3) }); await assert.rejects(work, /retired/);
    assert.equal(active.state({}, '1').known, 2); assert.equal(later.state.writes.length, 0);
});


test('bounded arrow discovery finds wrapped query results when the card path has no binding', () => {
    const f = queryFixture(), arrow = f.card();
    arrow.__reactFiber$queryTest.memoizedState.memoizedState = { current: { value: [f.result] } };
    const found = findRecommendationQuery([{}, arrow], ['1', '2']);
    assert.ok(found.binding); assert.equal(found.probe.cacheApi, 1); assert.equal(found.probe.maxOverlap, 2);
    found.binding.publish({ 1: 'hide' }, () => {}); assert.deepEqual(ids(f.state.data), ['2', '3']);
    const client = f.result.client; delete f.result.client;
    const missing = findRecommendationQuery([{}, arrow], ['2', '3']);
    assert.equal(missing.reason, 'no-matching-query'); assert.equal(missing.probe.operation, 1);
    assert.equal(missing.probe.cacheApi, 0); assert.doesNotMatch(JSON.stringify(missing.probe), /private/);
    f.result.observable.queryManager = { client };
    assert.ok(findRecommendationQuery([{}, arrow], ['2', '3']).binding);
});
