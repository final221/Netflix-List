import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationDom } from '../src/netflix/recommendation-dom.js';
import { createBrowser } from './helpers/browser.js';
import { Element } from './helpers/dom.js';

function fixture() {
    const browser = createBrowser();
    const row = browser.document.body.appendChild(new Element('section'));
    row.setAttribute('data-uia', 'carousel-scroller');
    row.getBoundingClientRect = () => ({ left: 0, right: 100 });
    const dom = createRecommendationDom(browser.context);
    function card(id, left, width = 20) {
        const host = row.appendChild(new Element('div')); host.setAttribute('data-virtual-slot', id);
        const node = host.appendChild(new Element('a'));
        node.setAttribute('data-uia', 'standard-card'); node.setAttribute('href', '/title/' + id);
        host.getBoundingClientRect = () => ({ left, top: 10.4, width, height: 40.6 });
        return host;
    }
    return { row, dom, card };
}

test('row summaries agree on hidden, narrow, offscreen and inclusive edge cards', () => {
    const f = fixture();
    f.card('1', -10); f.card('2', 90); f.card('3', 110);
    f.card('4', 10, 1); f.card('5', 10, 0); f.card('6', 10);
    const nested = f.row.appendChild(new Element('section'));
    nested.appendChild(f.card('7', 10));
    f.row.prepend(nested);
    nested.querySelector('a').__reactFiber$test = { type: { name: 'NestedLoader' }, memoizedProps: { loadMore() {} } };
    const choices = { 6: 'hide' }, state = f.dom.refillState(f.row, choices);
    assert.deepEqual(state, { scroller: f.row, mounted: 6, remaining: 2, offscreen: 3 });
    const facts = f.dom.rowDiagnostics(f.row, choices);
    assert.equal(facts.mounted, 6); assert.equal(facts.hidden, 1);
    assert.equal(facts.visible, 2); assert.equal(facts.offscreen, 3);
    assert.deepEqual(facts.ids, ['1', '2', '3', '4', '5', '6']);
    assert.deepEqual(facts.visibleIds, ['1', '2']);
    assert.deepEqual(facts.cardPositions, [
        { id: '1', rect: [-10, 10, 20, 41] }, { id: '2', rect: [90, 10, 20, 41] },
        { id: '3', rect: [110, 10, 20, 41] }
    ]);
    assert.equal(facts.positionsTruncated, false);
    assert.equal(facts.loading[0].component, 'NestedLoader'); // The survey keeps the first scanned card, even in a nested row.
});

test('row diagnostics preserve bounds and take fresh samples after geometry or choice changes', () => {
    const f = fixture(), hosts = Array.from({ length: 125 }, (_, i) => f.card(String(i + 1), 10));
    const facts = f.dom.rowDiagnostics(f.row, {});
    assert.equal(facts.mounted, 125); assert.equal(facts.visible, 125);
    assert.equal(facts.ids.length, 120); assert.equal(facts.idsTruncated, true);
    assert.equal(facts.visibleIds.length, 120); assert.equal(facts.cardPositions.length, 24);
    assert.equal(facts.positionsTruncated, true);
    hosts.forEach(host => { host.getBoundingClientRect = () => ({ left: 10, width: 0 }); });
    const collapsed = f.dom.rowDiagnostics(f.row, {});
    assert.equal(collapsed.visible, 0); assert.equal(collapsed.offscreen, 125);
    assert.deepEqual(collapsed.cardPositions, []);
    assert.equal(collapsed.positionsTruncated, true); // Counts unhidden cards, including collapsed ones.
    assert.equal(f.dom.refillState(f.row, { 1: 'hide' }).offscreen, 124);
    f.row.remove();
    assert.equal(f.dom.refillState(f.row, {}), null);
    assert.equal(f.dom.rowDiagnostics(f.row, {}), null);
});

test('row diagnostics retain unavailable geometry fallback and empty-row behavior', () => {
    const f = fixture();
    assert.equal(f.dom.refillState(f.row, {}), null);
    assert.equal(f.dom.rowDiagnostics(f.row, {}), null);
    const host = f.card('1', 10);
    host.getBoundingClientRect = () => { throw new Error('geometry-unavailable'); };
    assert.equal(f.dom.rowDiagnostics(f.row, {}), null);
    assert.throws(() => f.dom.refillState(f.row, {}), /geometry-unavailable/);
});

test('each public row read scans once and measures only current unhidden cards once', () => {
    const f = fixture(), visible = f.card('1', 10), offscreen = f.card('2', 110), hidden = f.card('3', 10);
    let scans = 0, boundsReads = 0, visibleReads = 0, offscreenReads = 0;
    const query = f.row.querySelectorAll.bind(f.row);
    f.row.querySelectorAll = selector => {
        if (selector === 'a[data-uia="standard-card"][href], .title-card') scans++;
        return query(selector);
    };
    f.row.getBoundingClientRect = () => { boundsReads++; return { left: 0, right: 100 }; };
    visible.getBoundingClientRect = () => { visibleReads++; return { left: 10, top: 0, width: 20, height: 40 }; };
    offscreen.getBoundingClientRect = () => { offscreenReads++; return { left: 110, top: 0, width: 20, height: 40 }; };
    hidden.getBoundingClientRect = () => { throw new Error('hidden cards must not be measured'); };
    assert.equal(f.dom.rowDiagnostics(f.row, { 3: 'hide' }).visible, 1);
    assert.deepEqual([scans, boundsReads, visibleReads, offscreenReads], [1, 1, 1, 1]);
    assert.equal(f.dom.refillState(f.row, { 3: 'hide' }).remaining, 1);
    assert.deepEqual([scans, boundsReads, visibleReads, offscreenReads], [2, 2, 2, 2]);
});
