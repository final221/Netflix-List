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

test('URL fetch inputs retain native identity and expose interception versus GraphQL counts', () => {
    const promise = Promise.resolve({ clone() { throw Error('no clone'); } }); let received;
    const env = { location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 100 },
        fetch(input) { received = input; return promise; } };
    const probe = createRecommendationRequests(env); probe.begin();
    const input = new URL('https://www.netflix.com/graphql?operationName=Recommendations');
    assert.equal(env.fetch(input), promise); assert.equal(received, input);
    env.fetch('/other');
    assert.equal(probe.read().intercepted, 2); assert.equal(probe.read().graphqlCalls, 1);
    assert.equal(probe.read().records[0].operation, 'Recommendations'); probe.dispose();
});


test('saved fetch clients remain observable at response reads without changing method promise or receiver', async () => {
    const payload = { data: { titles: [{ id: 123 }], pageInfo: { hasNextPage: true, endCursor: 'secret' }, authToken: 'secret' } };
    const promise = Promise.resolve(payload); let receiver;
    class PageResponse { constructor() { this.url = 'https://www.netflix.com/graphql?auth=secret'; }
        json() { receiver = this; return promise; } text() { return Promise.resolve(JSON.stringify(payload)); } }
    const original = PageResponse.prototype.json, env = { Response: PageResponse,
        location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 100 }, fetch: () => promise };
    const probe = createRecommendationRequests(env); probe.begin(); const response = new PageResponse();
    assert.equal(response.json(), promise); assert.equal(receiver, response); await promise; await Promise.resolve();
    const facts = probe.read(); assert.equal(facts.graphqlCalls, 0); assert.equal(facts.responseReads, 1);
    assert.equal(facts.responseHooks, 2); assert.equal(facts.records[0].source, 'response-json');
    assert.deepEqual(facts.records[0].response.collections[0].ids, ['123']); assert.doesNotMatch(JSON.stringify(facts), /secret|authToken|endCursor/);
    probe.dispose(); assert.equal(PageResponse.prototype.json, original);
});

test('response leases respect window, origin, newer overrides and retired callbacks', async () => {
    let resolve, time = 0; const promise = new Promise(done => { resolve = done; });
    class PageResponse { constructor(url) { this.url = url; } json() { return promise; } text() { throw Error('native'); } }
    const env = { Response: PageResponse, location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => time } };
    const probe = createRecommendationRequests(env), response = new PageResponse('https://www.netflix.com/graphql');
    assert.equal(response.json(), promise); assert.equal(probe.read().responseReads, 0);
    probe.begin(); assert.equal(new PageResponse('https://other.com/graphql').json(), promise);
    time = 5001; response.json(); assert.equal(probe.read().responseReads, 0);
    time = 10; response.json(); assert.equal(probe.read().responseReads, 1);
    assert.throws(() => response.text(), /native/); const newer = () => {}; PageResponse.prototype.json = newer;
    probe.dispose(); resolve({ data: { titles: [{ id: 1 }] } }); await promise; await Promise.resolve();
    assert.deepEqual(probe.read().records, []); assert.equal(PageResponse.prototype.json, newer);
});


test('text response evidence copies pagination and respects its size bound without consuming another body', async () => {
    let text = JSON.stringify({ data: { items: [{ videoId: 12 }], pageInfo: { totalCount: 80 } } });
    class PageResponse { constructor() { this.url = 'https://www.netflix.com/graphql'; } text() { return Promise.resolve(text); } }
    const original = PageResponse.prototype.text;
    const env = { Response: PageResponse, window: { Response: PageResponse },
        location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 10 } };
    const probe = createRecommendationRequests(env); probe.begin();
    assert.equal(await new PageResponse().text(), text); await Promise.resolve();
    assert.equal(probe.read().responseHooks, 1); assert.equal(probe.read().records[0].source, 'response-text');
    assert.deepEqual(probe.read().records[0].response.collections[0].ids, ['12']);
    text = 'x'.repeat(256 * 1024 + 1); assert.equal((await new PageResponse().text()).length, text.length); await Promise.resolve();
    assert.equal(probe.read().dropped, 1); assert.equal(probe.read().records.length, 1);
    probe.dispose(); assert.equal(PageResponse.prototype.text, original);
});


test('native connection summaries distinguish exhaustion and copy edge video IDs', async () => {
    const payload = { data: { node: { entities: { totalCount: 36, edges: [{ node: { unifiedEntity: { videoId: 123 } }, cursor: 'secret' }], pageInfo: { hasNextPage: false } } } } };
    class PageResponse { constructor() { this.url = 'https://www.netflix.com/graphql'; } text() { return Promise.resolve(JSON.stringify(payload)); } }
    const env = { Response: PageResponse, location: { href: 'https://www.netflix.com/browse', origin: 'https://www.netflix.com' }, performance: { now: () => 10 } };
    const probe = createRecommendationRequests(env); probe.begin(); await new PageResponse().text(); await Promise.resolve();
    const facts = probe.read().records[0].response; assert.equal(facts.serverPage.exhausted, true);
    assert.equal(facts.serverPage.totalCount, 36); assert.equal(facts.serverPage.returnedItems, 1);
    assert.deepEqual(facts.collections.find(x => x.path.endsWith('edges')).ids, ['123']);
    assert.doesNotMatch(JSON.stringify(facts), /secret/); probe.dispose();
});
