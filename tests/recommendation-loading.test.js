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
