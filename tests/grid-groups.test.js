import { publishGrid, insertGrid } from './helpers/card-material.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createDocument, Element } from './helpers/dom.js';

async function fixture(count = 5) {
    const document = createDocument(), section = document.body.appendChild(new Element('section'));
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        tUi: (key, args) => key + (args?.count ? ':' + args.count : ''),
        runChunks: async (count, visit, guard) => { for (let i = 0; i < count; i++) { guard(); visit(i); } } });
    const items = Array.from({ length: count }, (_, i) => {
        const snapshot = new Element(), card = snapshot.appendChild(new Element('a'));
        card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', `https://www.netflix.com/browse?jbv=${i+1}`);
        return { videoId: String(i+1), href: card.getAttribute('href'), ariaLabel: `Title ${i+1}`, page: 0, snapshot };
    });
    const status = grid.updateStatus('My List'), mount = { section, status, layout: { gap: 8 },
        geometry: { left: 0, width: 600, columns: 6 }, assertCurrent() {} };
    await publishGrid(grid, { items, ...mount });
    const facts = new Map(items.map((item, i) => [item.videoId, { status: i === 0 ? 'complete' : 'unknown',
        type: i < 2 ? 'movie' : i < 4 ? 'series' : 'unknown', manual: false }]));
    let classifications = 0;
    const input = { items, metadata: { disabled: false, loading: false, manualFailure: false, locale: 'en', totalCount: count },
        readPlacement(item, classify) { if (classify) classifications++; const value = facts.get(item.videoId);
            return classify ? value : { manual: value.manual }; }, assertCurrent() {} };
    const sync = (changedIds = null, extra = {}) => grid.applyViewingChange({ ...input, changedIds, ...extra });
    const filter = (group, type) => grid.root.querySelector(`[data-tm-type-filter="${group}"]`)
        .querySelector(`[data-tm-filter-value="${type}"]`).dispatchEvent({ type: 'click' });
    const ids = parent => parent.children.filter(node => node.__tmMyListItem).map(node => node.__tmMyListItem.videoId);
    const watched = () => grid.root.querySelector('[data-tm-watch-grid]');
    return { grid, items, facts, sync, filter, ids, watched, mount, input, classifications: () => classifications };
}

test('group owner owns independent Films defaults, frozen scalar counts and unknown-type filtering', async () => {
    const e = await fixture(); e.sync();
    assert.deepEqual(e.grid.presentation().filters, { main: 'movie', watched: 'movie' });
    assert.equal(e.grid.presentation().completedCount, 1);
    assert.equal(e.grid.presentation().visibleCount, 1);
    assert.equal(e.grid.root.querySelector('details').open, false);
    assert.deepEqual(e.ids(e.watched()), ['1']);
    const summary = e.grid.presentation();
    assert.equal(Object.isFrozen(summary), true); assert.equal(Object.isFrozen(summary.filters), true);
    assert.equal(summary.ui, undefined); assert.equal(summary.entries, undefined);
    e.filter('main', 'series');
    assert.equal(e.grid.presentation().filters.watched, 'movie');
    assert.equal(e.grid.presentation().visibleCount, 2);
    e.filter('main', 'all'); assert.equal(e.grid.presentation().visibleCount, 4);
    assert.equal(e.classifications(), 5, 'filters reuse accepted classification');
});

test('local title changes preserve order and one-title work while unchanged synchronization reads no cards or geometry', async () => {
    const e = await fixture(500); e.sync();
    const before = e.grid.groupDiagnostics();
    e.facts.set('500', { status: 'complete', type: 'movie', manual: true }); e.sync(['500']);
    const after = e.grid.groupDiagnostics();
    assert.equal(after.cardsConsidered - before.cardsConsidered, 1);
    assert.equal(after.controlsUpdated - before.controlsUpdated, 1);
    assert.deepEqual(e.ids(e.watched()), ['1', '500']);
    const stable = e.grid.groupDiagnostics(); e.sync([]);
    assert.equal(e.grid.groupDiagnostics().cardsConsidered, stable.cardsConsidered);
    assert.equal(e.classifications(), 501);
});

test('replacement updates private grouped ownership and labels synchronously without revisiting the retired card', async () => {
    const e = await fixture(); e.sync();
    const item = e.items[0], old = e.grid.getCard(item);
    const next = e.grid.replaceCard(old, { node: old.node.cloneNode(true) });
    assert.equal(next.node.parentElement, e.watched());
    assert.equal(next.node.querySelector('button').textContent, 'moveBackToMyList');
    old.node.getAttribute = () => { throw new Error('retired card read'); };
    e.facts.set('1', { status: 'in-progress', type: 'movie', manual: true }); e.sync(['1']);
    assert.equal(next.node.parentElement, e.grid.root);
    assert.equal(e.grid.presentation().completedCount, 0);
});

test('frame replacement preserves selections and expansion while reset restores defaults and releases exact old listeners', async () => {
    const e = await fixture(); e.sync(); e.filter('main', 'series');
    const details = e.grid.root.querySelector('details'); details.open = true; details.dispatchEvent({ type: 'toggle' });
    const oldFilter = e.grid.root.querySelector('[data-tm-filter-value="series"]');
    await publishGrid(e.grid, { items: e.items, ...e.mount }); e.sync();
    assert.equal(oldFilter.listenerCount('click'), 0);
    assert.equal(details.listenerCount('toggle'), 0);
    assert.equal(e.grid.presentation().filters.main, 'series');
    assert.equal(e.grid.root.querySelector('details').open, true);
    e.grid.resetViewing(); e.sync();
    assert.equal(e.grid.presentation().filters.main, 'movie');
    assert.equal(e.grid.root.querySelector('details').open, false);
});

test('a rejected stale command cannot supersede the current grouped publication', async () => {
    const e = await fixture(); e.sync();
    const summary = e.grid.root.querySelector('summary'); let value = summary.textContent, invoked = false;
    Object.defineProperty(summary, 'textContent', { get: () => value, set(next) {
        value = next;
        if (!invoked) { invoked = true; assert.throws(() => e.sync([], { assertCurrent() { throw new Error('obsolete'); } }), /obsolete/); }
    } });
    e.facts.set('2', { status: 'complete', type: 'movie', manual: true });
    e.sync(['2']);
    assert.equal(e.grid.presentation().completedCount, 2);
    assert.deepEqual(e.ids(e.watched()), ['1', '2']);
});

test('reentrant grouping during structural ordering preserves the newer counts and card placement', async () => {
    const e = await fixture(); e.sync();
    const root = e.grid.root, insert = root.insertBefore.bind(root); let invoked = false;
    root.insertBefore = (node, before) => {
        const result = insert(node, before);
        if (!invoked) { invoked = true; e.facts.set('2', { status: 'in-progress', type: 'movie', manual: true }); e.sync(); }
        return result;
    };
    e.facts.set('2', { status: 'complete', type: 'movie', manual: true });
    assert.throws(() => e.sync(), { code: 'GRID_FRAME_RETIRED' });
    assert.equal(e.grid.presentation().completedCount, 1);
    assert.equal(e.grid.getCard(e.items[1]).node.parentElement, root);
    assert.deepEqual(e.ids(e.watched()), ['1']);
});

test('queued filter, refresh and toggle callbacks cannot act on a replacement group owner', async () => {
    const e = await fixture(); let refreshes = 0; e.sync(null, { onRefresh() { refreshes++; } });
    const details = e.grid.root.querySelector('details'), filter = e.grid.root.querySelector('[data-tm-filter-value="series"]');
    const refresh = e.grid.root.querySelector('[data-tm-watch-controls]').querySelector('button');
    const oldFilter = [...filter.listeners.get('click')][0], oldRefresh = [...refresh.listeners.get('click')][0], oldToggle = [...details.listeners.get('toggle')][0];
    await publishGrid(e.grid, { items: e.items, ...e.mount }); e.sync(null, { onRefresh() { refreshes++; } });
    details.open = true; oldFilter(); oldRefresh(); oldToggle();
    assert.deepEqual(e.grid.presentation().filters, { main: 'movie', watched: 'movie' });
    assert.equal(e.grid.presentation().expanded, false); assert.equal(refreshes, 0);
});

test('reentrant listener cleanup on disposal preserves a newly mounted card, controls and group owner', async () => {
    const e = await fixture(); e.sync();
    const oldRoot = e.grid.root, remove = oldRoot.removeEventListener.bind(oldRoot); let newer, actions = 0, invoked = false;
    oldRoot.removeEventListener = (type, listener, capture) => {
        remove(type, listener, capture);
        if (invoked) return; invoked = true;
        const status = e.grid.updateStatus('New'); e.grid.mount({ ...e.mount, status });
        const snapshot = new Element(), card = snapshot.appendChild(new Element('a'));
        card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', 'https://www.netflix.com/browse?jbv=99');
        const item = { videoId: '99', href: card.getAttribute('href'), page: 0, snapshot };
        newer = insertGrid(e.grid, item);
        e.grid.applyViewingChange({ ...e.input, items: [item], readPlacement: () => ({ status: 'unknown', type: 'movie', manual: false }),
            onAction() { actions++; } });
    };
    e.grid.dispose();
    e.grid.assertCard(newer);
    assert.equal(e.grid.presentation().visibleCount, 1);
    assert.equal(e.grid.root.listenerCount('click'), 1);
    e.grid.root.dispatchEvent({ type: 'click', target: newer.node.querySelector('button'),
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.equal(actions, 1);
});
