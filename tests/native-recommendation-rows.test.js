import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeRows } from '../src/recommendations/native-rows.js';
import { createRecommendationDom } from '../src/netflix/recommendation-dom.js';
import { createBrowser } from './helpers/browser.js';
import { Element } from './helpers/dom.js';
import { queryFixture } from './helpers/recommendation-query.js';

function fixture(options = {}) {
    const b = createBrowser(), f = queryFixture(['1', '2'], options); let active = true, profile = 'A';
    const row = b.document.body.appendChild(new Element('section'));
    row.getBoundingClientRect = () => ({ left: 0, right: 600, width: 600 });
    for (const [index, id] of ['1', '2'].entries()) {
        const host = row.appendChild(new Element('div')); host.setAttribute('data-virtual-slot', String(index));
        host.getBoundingClientRect = () => ({ left: index * 200, width: 200 });
        const card = host.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/' + id); f.attach(card);
    }
    const choices = { 1: 'hide' };
    const owner = createNativeRows({ environment: b.context, dom: createRecommendationDom(b.context), readChoices: () => choices,
        admitted: () => active && profile === 'A', canRestore: () => profile === 'A' });
    return { ...b, ...f, row, owner, choices, routeExit() { active = false; }, profileExit() { profile = 'B'; } };
}

test('interacted rows coalesce filtering and restore owned cache data on route retirement', async () => {
    const b = fixture(); b.owner.interact(b.row); b.owner.interact(b.row); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().activated, 1); assert.equal(b.owner.diagnostics().writes, 1);
    assert.deepEqual(b.state.data.node.entities.edges.map(e => e.node.unifiedEntity.videoId), ['2']);
    b.owner.refresh(); await b.scheduler.advance(200); assert.equal(b.owner.diagnostics().writes, 1);
    b.routeExit(); b.owner.dispose();
    assert.equal(b.state.data.node.entities.edges.length, 2); assert.equal(b.scheduler.timers.size, 0);
});

test('heavily filtered lookahead continues up to six requests then reports its interaction limit', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 50 });
    for (let id = 3; id <= 8; id++) { b.choices[id] = 'hide'; b.state.pages.push(Promise.resolve({ data: b.page([String(id)], true, 50, 'c' + id) })); }
    b.owner.interact(b.row); await b.scheduler.advance(200); for (let i = 0; i < 12; i++) await b.scheduler.flush();
    assert.equal(b.state.requests.length, 6); assert.equal(b.owner.diagnostics().loads, 6);
    assert.equal(b.owner.diagnostics().rows[0].reason, 'interaction-limit');
    b.owner.refresh(); await b.scheduler.advance(200); assert.equal(b.state.requests.length, 6);
    b.owner.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('profile retirement aborts the active native query and rejects late publication', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 3 }); let resolve;
    b.state.pages.push(new Promise(done => { resolve = done; })); b.owner.interact(b.row); await b.scheduler.advance(200);
    const signal = b.state.requests[0].context.fetchOptions.signal, writes = b.state.writes.length;
    b.profileExit(); b.owner.dispose(); assert.equal(signal.aborted, true);
    resolve({ data: b.page(['3'], false, 3) }); await b.scheduler.flush();
    assert.equal(b.state.writes.length, writes); assert.equal(b.scheduler.timers.size, 0);
});

test('an unresponsive native query times out and cannot later publish into the row', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 3 }); let resolve;
    b.state.pages.push(new Promise(done => { resolve = done; })); b.owner.interact(b.row); await b.scheduler.advance(200);
    await b.scheduler.advance(8000);
    assert.equal(b.owner.diagnostics().rows[0].reason, 'query-timeout');
    const writes = b.state.writes.length;
    resolve({ data: b.page(['3'], false, 3) }); await b.scheduler.flush();
    assert.equal(b.state.writes.length, writes); b.owner.dispose(); assert.equal(b.scheduler.timers.size, 0);
});


test('real DOM adapter discovers the query from an arrow and exports page-fill and admission facts', async () => {
    const b = fixture();
    for (const card of b.row.querySelectorAll('a')) delete card.__reactFiber$queryTest;
    const arrow = b.row.appendChild(new Element('button')); arrow.setAttribute('data-uia', 'carousel-right-button'); b.attach(arrow);
    b.owner.interact(b.row); await b.scheduler.advance(200);
    const facts = b.owner.diagnostics(); assert.equal(facts.activated, 1); assert.equal(facts.writes, 1);
    assert.equal(facts.rows[0].probe.maxOverlap, 2); assert.equal(facts.rows[0].probe.cacheApi, 1);
    assert.equal(facts.rows[0].presentation.mounted, 2); assert.ok(facts.rows[0].presentation.capacity > 0);
    b.owner.dispose();
});


test('visible rows activate on the original page and retire their exact observer on disposal', async () => {
    const b = fixture(); let deliver, disconnected = false, target;
    b.context.IntersectionObserver = class {
        constructor(callback) { deliver = callback; }
        observe(row) { target = row; } unobserve() {} disconnect() { disconnected = true; }
    };
    b.owner.observe(new Set([b.row])); assert.equal(target, b.row);
    deliver([{ target: b.row, isIntersecting: true }]); await b.scheduler.advance(200);
    const facts = b.owner.diagnostics(); assert.equal(facts.automatic, 1); assert.equal(facts.writes, 1);
    assert.equal(facts.rows[0].source, 'visible'); assert.equal(facts.rows[0].reason, 'server-exhausted');
    b.owner.dispose(); assert.equal(disconnected, true);
    deliver([{ target: b.row, isIntersecting: true }]); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().activated, 1); assert.equal(b.scheduler.timers.size, 0);
});


test('shared request budget reports a timed wait and resumes without another arrow click', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 100 });
    for (let id = 3; id <= 40; id++) { b.choices[id] = 'hide'; b.state.pages.push(Promise.resolve({ data: b.page([String(id)], true, 100, 'c' + id) })); }
    for (let turn = 0; turn < 5; turn++) {
        b.owner.interact(b.row); await b.scheduler.advance(200); for (let i = 0; i < 12; i++) await b.scheduler.flush();
    }
    assert.equal(b.state.requests.length, 24);
    assert.equal(b.owner.diagnostics().rows[0].reason, 'request-budget');
    assert.ok(b.owner.diagnostics().rows[0].retryInMs > 0);
    await b.scheduler.advance(60000); for (let i = 0; i < 12; i++) await b.scheduler.flush();
    assert.equal(b.state.requests.length, 30); b.owner.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('owner continues publication and lookahead when a native cache broadcast refreshes options', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 4 });
    b.state.onWrite = () => { b.result.observable.options = { ...b.result.observable.options,
        variables: { ...b.result.observable.options.variables } }; b.owner.refresh(); };
    b.state.pages.push(Promise.resolve({ data: b.page(['3', '4'], false, 4, 'c2') }));
    b.owner.interact(b.row); await b.scheduler.advance(200); for (let i = 0; i < 4; i++) await b.scheduler.flush();
    await b.scheduler.advance(200);
    const facts = b.owner.diagnostics(); assert.equal(facts.failures, 0); assert.equal(facts.loads, 1);
    assert.ok(facts.rows[0].optionsRefreshes > 0); assert.equal(facts.rows[0].reason, 'server-exhausted');
    assert.deepEqual(b.state.data.node.entities.edges.map(e => e.node.unifiedEntity.videoId), ['2', '3', '4']);
    b.owner.dispose();
});


test('meeting the buffer target on the last allowed read reports ready rather than a loading wall', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 100 });
    for (let index = 0; index < 6; index++) b.state.pages.push(Promise.resolve({ data: b.page(
        index === 5 ? ['8', '9', '10'] : [String(index + 3)], true, 100, 'c' + index) }));
    b.owner.interact(b.row); await b.scheduler.advance(200); for (let i = 0; i < 12; i++) await b.scheduler.flush();
    assert.equal(b.state.requests.length, 6); assert.equal(b.owner.diagnostics().rows[0].reason, 'buffer-ready');
    b.owner.dispose();
});


test('disabled cache bindings retain the rejection reason without retrying them as owner changes', async () => {
    const b = fixture(); b.state.rejectWrites = true;
    b.owner.interact(b.row); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().rows[0].reason, 'cache-projection-rejected');
    b.owner.interact(b.row); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().failures, 1); assert.equal(b.owner.diagnostics().blockedRetries, 1);
    assert.equal(b.owner.diagnostics().rows[0].reason, 'cache-projection-rejected');
    b.row.id = 'replacement'; b.state.rejectWrites = false;
    b.owner.interact(b.row); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().writes, 1); assert.equal(b.owner.diagnostics().activated, 2);
    b.owner.dispose();
});

test('unsupported visible rows back off after eviction while manual navigation may rediscover them', async () => {
    const b = fixture(); for (const card of b.row.querySelectorAll('a')) delete card.__reactFiber$queryTest;
    b.owner.interact(b.row, 'visible'); await b.scheduler.advance(200);
    b.owner.refresh(); await b.scheduler.advance(200); assert.equal(b.owner.diagnostics().attempts, 1);
    for (let index = 0; index < 4; index++) {
        const row = b.document.body.appendChild(new Element('section'));
        for (const id of ['1', '2']) {
            const host = row.appendChild(new Element('div')); host.setAttribute('data-virtual-slot', id);
            const card = host.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/' + id);
        }
        b.owner.interact(row, 'visible'); await b.scheduler.advance(200);
    }
    b.owner.interact(b.row, 'visible'); await b.scheduler.advance(200);
    assert.equal(b.owner.diagnostics().automaticSuppressed, 1); assert.equal(b.owner.diagnostics().attempts, 5);
    b.owner.interact(b.row); await b.scheduler.advance(200); assert.equal(b.owner.diagnostics().attempts, 6);
    b.owner.dispose();
});
