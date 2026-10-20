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

test('lookahead is bounded to two read-only requests per interaction', async () => {
    const b = fixture({ hasNextPage: true, totalCount: 50 });
    b.state.pages.push(Promise.resolve({ data: b.page(['3', '4'], true, 50, 'c2') }),
        Promise.resolve({ data: b.page(['5', '6'], true, 50, 'c3') }));
    b.owner.interact(b.row); await b.scheduler.advance(200); for (let i = 0; i < 4; i++) await b.scheduler.flush();
    assert.equal(b.state.requests.length, 2); assert.equal(b.owner.diagnostics().loads, 2);
    b.owner.refresh(); await b.scheduler.advance(200); assert.equal(b.state.requests.length, 2);
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
