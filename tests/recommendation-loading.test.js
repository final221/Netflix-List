import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationDom } from '../src/netflix/recommendation-dom.js';

const location = { href: 'https://www.netflix.com/browse' };
test('arrow loading survey copies bounded handler and cache shapes without executing code or exposing values', () => {
    let calls = 0;
    const props = { onClick() { calls++; }, loadMore() { calls++; }, items: ['secret-title'],
        data: { cursor: 'secret-cursor', authorization: 'secret-auth', items: ['secret-title'] }, totalCount: 42 };
    Object.defineProperty(props, 'fetchData', { enumerable: true, get() { calls++; throw Error('getter'); } });
    const control = { __reactFiber$test: { memoizedProps: props, type: { name: 'Arrow' }, return: null } };
    const dom = createRecommendationDom({ location, performance: { now: () => 10 } });
    const facts = dom.navigationStart(control);
    assert.equal(facts.at, 10); assert.equal(calls, 0);
    const fields = facts.components[0].fields;
    assert.equal(fields.find(x => x.name === 'onClick').type, 'function');
    assert.equal(fields.find(x => x.name === 'items').length, 1);
    assert.equal(fields.find(x => x.name === 'data').fields.find(x => x.name === 'items').length, 1);
    assert.equal(fields.find(x => x.name === 'totalCount').value, 42);
    assert.equal(fields.find(x => x.name === 'fetchData').type, 'accessor');
    assert.doesNotMatch(JSON.stringify(facts), /secret-/);
    let fiber = null;
    for (let i = 0; i < 30; i++) fiber = { memoizedProps: props, return: fiber };
    const bounded = dom.navigationStart({ __reactFiber$test: fiber });
    assert.equal(bounded.components.length, 10); assert.equal(bounded.truncated, true);
    fiber.return = fiber; assert.doesNotThrow(() => dom.navigationStart({ __reactFiber$test: fiber }));
});

test('resource evidence scopes request times and strips URLs without claiming row or cache attribution', () => {
    const resource = (name, startTime, initiatorType = 'fetch') => ({ name, startTime, initiatorType, duration: 12.6, transferSize: 0 });
    const entries = [resource('https://www.netflix.com/graphql?token=secret', 110),
        resource('https://www.netflix.com/api/path/12345?auth=secret', 120, 'xmlhttprequest'),
        resource('https://www.netflix.com/graphql', 90), resource('https://other.com/graphql', 130),
        resource('https://www.netflix.com/graphql', 130, 'img'), resource('https://www.netflix.com/graphql', 160)];
    const dom = createRecommendationDom({ location, performance: { now: () => 200, getEntriesByType: () => entries } });
    const facts = dom.navigationRequests(100, 150);
    assert.equal(facts.matched, 2); assert.equal(facts.windowMs, 50);
    assert.equal(facts.entries[0].offsetMs, 10); assert.equal(facts.entries[0].endpoint, 'graphql');
    assert.equal(facts.entries[1].endpoint, 'api'); assert.equal(facts.attribution, 'time-window-only');
    assert.doesNotMatch(JSON.stringify(facts), /secret|12345|https:/);
    assert.match(facts.limitation, /absent entries do not prove cached/);
    assert.equal(dom.navigationRequests(100, 10000).windowMs, 5000);
    entries.push(...Array.from({ length: 2100 }, () => resource('https://www.netflix.com/graphql', 140)));
    const bounded = dom.navigationRequests(100, 150);
    assert.equal(bounded.inspected, 2000); assert.equal(bounded.bufferTruncated, true);
    assert.equal(bounded.entries.length, 24); assert.equal(bounded.truncated, true);
    assert.deepEqual(createRecommendationDom({ location }).navigationRequests(0), { unavailable: true });
});

test('generic UI ancestors do not crowd out loader facts and linked hooks expose bounded array shapes', () => {
    let calls = 0;
    const values = [Array.from({ length: 30 }, () => 1), () => { calls++; }];
    Object.defineProperty(values, '0', { get() { calls++; throw Error('getter'); } });
    const loader = { memoizedProps: { totalCount: 80, fetchMore() { calls++; } },
        memoizedState: { memoizedState: values, next: { memoizedState: { items: Array(40), hasNextPage: true }, next: null } } };
    let fiber = loader;
    for (let i = 0; i < 15; i++) fiber = { memoizedProps: { 'data-uia': 'generic', tabIndex: 0 }, return: fiber };
    const facts = createRecommendationDom({ location }).navigationStart({ __reactFiber$test: fiber });
    assert.equal(calls, 0); assert.equal(facts.truncated, false);
    assert.ok(facts.components.some(c => c.depth === 15 && c.fields.some(f => f.name === 'fetchMore')));
    assert.equal(facts.components.find(c => c.source === 'hookState:0').fields[0].elements[0].type, 'accessor');
    assert.equal(facts.components.find(c => c.source === 'hookState:1').fields.find(f => f.name === 'items').length, 40);
});

test('future request observation drains queued delivery, bounds sanitized records and rejects retired callbacks', () => {
    let callback, queued = [], disconnected = 0, options;
    class Observer {
        constructor(fn) { callback = fn; }
        observe(value) { options = value; }
        takeRecords() { const result = queued; queued = []; return result; }
        disconnect() { disconnected++; }
    }
    const dom = createRecommendationDom({ location, PerformanceObserver: Observer, performance: { now: () => 300 } });
    const capture = dom.observeRequests(); assert.deepEqual(options, { type: 'resource', buffered: false });
    const entry = { name: 'https://www.netflix.com/graphql?auth=secret', startTime: 120, initiatorType: 'fetch', duration: 5, transferSize: 10 };
    queued = [entry]; const facts = dom.navigationRequests(100, 200, capture.read());
    assert.equal(facts.source, 'future-observer'); assert.equal(facts.matched, 1);
    assert.doesNotMatch(JSON.stringify(facts), /secret|https:/);
    callback({ getEntries: () => Array(205).fill(entry) });
    const bounded = capture.read(); assert.equal(bounded.records.length, 200); assert.equal(bounded.dropped, 6);
    callback({ getEntries() { throw Error('unavailable'); } }); assert.equal(capture.read().failures, 1);
    capture.dispose(); callback({ getEntries() { throw Error('retired'); } });
    assert.equal(disconnected, 1); assert.equal(capture.read().available, false); assert.equal(capture.read().records.length, 0);
    assert.equal(dom.observeRequests().read().available, true);
    assert.equal(createRecommendationDom({ location }).observeRequests().read().available, false);
});

test('timing-only GraphQL facts distinguish another origin while omitting query values', () => {
    const entries = ['https://www.netflix.com/graphql?operationName=Row&variables=secret&auth=secret',
        'https://api.netflix.com/graphql?operationName=More&cursor=secret'].map(name => ({ name, initiatorType: 'fetch', startTime: 120, duration: 8, transferSize: 12 }));
    const dom = createRecommendationDom({ location, performance: { getEntriesByType: () => entries } });
    const facts = dom.navigationRequests(100, 200);
    assert.deepEqual(facts.entries.map(x => x.sameOrigin), [true, false]);
    assert.deepEqual(facts.entries.map(x => x.operation), ['Row', 'More']);
    assert.deepEqual(facts.entries[0].queryKeys, ['operationName', 'variables']);
    assert.doesNotMatch(JSON.stringify(facts), /secret|api\.netflix|auth/);
});


test('loader survey reads late hooks and nested pagination contexts without getters or private string values', () => {
    let calls = 0;
    const params = { name: 'CarouselPaginationQuery', operationKind: 'query', authToken: 'secret' };
    const relay = { environment: { fragment: { params, variables: { cursor: 'secret', first: 14 } } }, pagination: { loadNext() { calls++; }, hasNext: true } };
    Object.defineProperty(relay.environment, 'fetchData', { enumerable: true, get() { calls++; throw Error('getter'); } });
    let state = { memoizedState: [() => {}, [relay]], next: null };
    for (let i = 0; i < 20; i++) state = { memoizedState: 0, next: state };
    const control = { __reactFiber$test: { memoizedProps: {}, memoizedState: state,
        dependencies: { firstContext: { memoizedValue: relay, next: null } }, return: null } };
    const facts = createRecommendationDom({ location }).navigationStart(control), text = JSON.stringify(facts);
    assert.equal(calls, 0); assert.match(text, /hookState:20/); assert.match(text, /loadNext/);
    assert.match(text, /CarouselPaginationQuery/); assert.doesNotMatch(text, /secret|authToken/);
});
