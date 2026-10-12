import test from 'node:test';
import assert from 'node:assert/strict';
import { createMyListDisplay } from '../src/app/my-list-display.js';

// Public display calls and admitted feature protocols; no private-source access.
function displayFixture() {
    let label = 'old', onDispose = () => {}, onViewingDispose = () => {}, onUpdate = () => {}, hintOwners = 0;
    const hints = new Map(), cards = new Map(), writes = [], copies = [], gaps = [];
    const display = createMyListDisplay({
        environment: { document: {}, window: { innerWidth: 600 }, performance: { now: () => 1 } },
        settings: { preferences: () => ({ viewOriginalMyList: false }) }, logger: { log() {} },
        i18n: { tUi: value => value, formatItemCount: () => '', formatInitializationTime: () => '' },
        session: { scope: { token: 1 }, assertRouteSession() {},
            createRouteSessionCancelledError: () => Object.assign(new Error('retired'), { code: 'CANCELLED' }) },
        viewportSignature: () => '600', viewing: { dispose() { onViewingDispose(); } },
        netflixDom: { readHeadingTypography: () => ({}) },
        nativeCarousel: { bind: (section, scroller, track) => ({ section, scroller, track }),
            presentSource: () => null, sample: operation => operation(),
            measureLayout: () => ({ bounds: {}, viewportWidth: 600 }), assertObservation() {},
            preferredPage: ({ record, hints: owner }) => owner?.get(record) ?? 0,
            createPageHints({ assertCurrent }) { hintOwners++; return {
                get: record => hints.get(record), set(record, page) { assertCurrent(); hints.set(record, page); writes.push(page); }, dispose() {} }; } },
        gridView: { geometry: () => ({}), updateStatus: () => label, mount: () => ({ isConnected: true }),
            applyGeometry: () => ({}), layoutStatus(_status, _geometry, gap, assertCurrent) { assertCurrent(); gaps.push(gap); },
            applyStatusTypography() {}, getCard: item => cards.get(item),
            updateCard(card, item) { copies.push(item.videoId); onUpdate(); } },
        listView: { createMembership(facts) {
            const ownerLabel = label; let disposed = false;
            return { records: facts.items, lookup: new Map(), expectedCount: facts.totalCount,
                collectedCount: facts.collectedCount, dispose() { if (!disposed) { disposed = true; onDispose(ownerLabel); } } };
        } }
    });
    function publish(next = label, layout = { columns: 6 }) {
        label = next;
        display.showProvisional({ section: {}, scroller: {}, track: {}, layout,
            initializationStarted: 0, assertCurrent() {} });
        return display.captureSource();
    }
    return { display, publish, cards, writes, copies, gaps, get hintOwners() { return hintOwners; },
        onDispose(callback) { onDispose = callback; }, onViewingDispose(callback) { onViewingDispose = callback; },
        onUpdate(callback) { onUpdate = callback; } };
}

test('display receipts hide owned resources, preserve accepted facts and reject stale layout updates', () => {
    const e = displayFixture(), layout = { columns: 6 }, first = e.publish('old', layout);
    assert.throws(() => { first.layout = { columns: 9 }; }, TypeError);
    for (const field of ['itemMap', 'cloneMap', 'listMembership', 'nativePageHints', 'watchStatus']) assert.equal(field in first, false);
    assert.equal(first.cardCount, 0, 'provisional diagnostics count accepted cards rather than borrowing a grid registry');
    assert.equal(e.display.bindSource(first, first.section, first.scroller, first.track), first,
        'binding acceptance must return the public receipt rather than its private parent');
    e.display.applyLayout(first, { columns: 3 });
    assert.equal(first.layout.columns, 3);
    const second = e.publish('replacement', { columns: 2 });
    assert.throws(() => e.display.applyLayout(first, { columns: 9 }), { code: 'CANCELLED' });
    assert.equal(second.layout.columns, 2);
});

test('display retirement publishes replacement first and cannot overwrite a newer reentrant source', () => {
    const e = displayFixture(); e.publish();
    let retirements = 0;
    e.onDispose(() => {
        e.onDispose(() => {}); retirements++;
        assert.equal(e.display.captureSource().status, 'replacement');
        e.publish('newer');
    });
    e.publish('replacement');
    assert.equal(retirements, 1);
    assert.equal(e.display.captureSource().status, 'newer');
});

test('display diagnostic item projections never create page-hint resources', () => {
    const e = displayFixture(); e.publish();
    const item = { videoId: '1', href: '/watch/1' };
    assert.equal(e.display.itemSummary(item).page, 0);
    assert.equal(e.display.itemSummary(item).videoId, '1');
    assert.equal(e.hintOwners, 0);
});

test('display cleanup releases captured resources without borrowing a reentrant replacement', () => {
    const e = displayFixture(), retired = []; e.publish();
    e.onDispose(label => retired.push(label));
    e.onViewingDispose(() => {
        e.onViewingDispose(() => {}); e.publish('replacement');
    });
    e.display.retireAcceptedResources();
    assert.deepEqual(retired, ['old']);
    assert.equal(e.display.captureSource().status, 'replacement');
});

test('display layout keeps native header spacing at zero when the original list is hidden', () => {
    const e = displayFixture(), parent = e.publish();
    e.display.applyLayout(parent, { columns: 3, rowGap: 20 }, { mode: 'status' });
    assert.deepEqual(e.gaps, [0]);
});

test('display hover repair skips unchanged mappings and rejects replacement during card publication', () => {
    const e = displayFixture(), parent = e.publish(), item = { videoId: '1' };
    e.cards.set(item, { node: { isConnected: true } });
    assert.equal(e.display.repairPageMapping(item, 0, parent), 0);
    assert.deepEqual(e.writes, []); assert.deepEqual(e.copies, []);
    e.onUpdate(() => e.publish('replacement'));
    assert.throws(() => e.display.repairPageMapping(item, 1, parent), { code: 'CANCELLED' });
    assert.deepEqual(e.writes, [1]); assert.deepEqual(e.copies, ['1']);
    assert.equal(e.display.captureSource().status, 'replacement');
    assert.throws(() => e.display.repairPageMapping(item, 2, parent), { code: 'CANCELLED' });
    assert.deepEqual(e.writes, [1]);
});
