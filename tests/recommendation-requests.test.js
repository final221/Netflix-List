import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationRequests } from '../src/netflix/recommendation-requests.js';

test('native GraphQL observation forwards the exact promise and copies bounded pagination evidence without credentials', async () => {
    const response = new Response(JSON.stringify({ data: { videos: [{ id: 123 }, { id: 456 }], pageInfo: { hasNextPage: true, totalCount: 40, endCursor: 'secret' } } }));
    const promise = Promise.resolve(response); let receiver, argumentsSeen;
    const env = { location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 100 },
        fetch(...args) { receiver = this; argumentsSeen = args; return promise; } };
    const original = env.fetch, probe = createRecommendationRequests(env); probe.begin();
    const init = { body: JSON.stringify({ operationName: 'Recommendations', variables: { first: 20, cursor: 'secret', authToken: 'secret' } }) };
    assert.equal(env.fetch('/graphql', init), promise); assert.equal(receiver, env); assert.equal(argumentsSeen[1], init);
    for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
    const facts = probe.read(); assert.equal(facts.records[0].operation, 'Recommendations');
    assert.deepEqual(facts.records[0].response.collections[0].ids, ['123', '456']);
    assert.doesNotMatch(JSON.stringify(facts), /secret|endCursor/);
    assert.equal(await response.text(), JSON.stringify({ data: { videos: [{ id: 123 }, { id: 456 }], pageInfo: { hasNextPage: true, totalCount: 40, endCursor: 'secret' } } }));
    probe.dispose(); assert.equal(env.fetch, original);
});

test('request probes stop outside the arrow window and preserve a later fetch replacement on retirement', () => {
    let time = 10;
    const env = { location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => time }, fetch: () => Promise.resolve({}) };
    const probe = createRecommendationRequests(env); env.fetch('/graphql'); assert.equal(probe.read().records.length, 0);
    probe.begin(); time = 6000; env.fetch('/graphql'); assert.equal(probe.read().records.length, 0);
    const later = () => {}; env.fetch = later; probe.dispose(); assert.equal(env.fetch, later);
});

test('response-size limits are explicit and queued reader retirement cannot publish late facts', async () => {
    let bytes = 0, cancelled = false;
    const env = { location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 10 },
        fetch: () => Promise.resolve({ clone: () => ({ body: { getReader: () => ({
            async read() { bytes += 65536; return { value: new Uint8Array(65536), done: false }; },
            async cancel() { cancelled = true; }, releaseLock() {} }) } }) }) };
    const probe = createRecommendationRequests(env); probe.begin(); env.fetch('/graphql');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(probe.read().records[0].responseTruncated, true); assert.equal(cancelled, true); assert.equal(bytes, 327680);
    probe.dispose(); assert.deepEqual(probe.read().records, []);
});

test('a diagnostic clock failure cannot replace the native fetch promise with a throw', () => {
    const promise = Promise.resolve({});
    const env = { location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' },
        performance: { now() { throw Error('clock unavailable'); } }, fetch: () => promise };
    const probe = createRecommendationRequests(env); assert.doesNotThrow(() => probe.begin());
    assert.equal(env.fetch('/graphql'), promise); assert.equal(probe.read().failures, 2); probe.dispose();
});
