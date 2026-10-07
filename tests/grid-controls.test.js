import { publishGrid } from './helpers/card-material.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createDocument, Element } from './helpers/dom.js';

async function fixture() {
    const document = createDocument(), section = document.body.appendChild(new Element('section'));
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        tUi: key => key, runChunks: async (count, visit, guard) => { for (let i = 0; i < count; i++) { guard(); visit(i); } } });
    const snapshot = new Element(), card = snapshot.appendChild(new Element('a'));
    card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', 'https://www.netflix.com/browse?jbv=1');
    const item = { videoId: '1', href: card.getAttribute('href'), ariaLabel: 'First', page: 0, snapshot };
    const status = grid.updateStatus('My List');
    const root = await publishGrid(grid, { items: [item], section, status, layout: { gap: 8 },
        geometry: { left: 0, width: 600, columns: 6 }, assertCurrent() {} });
    const controls = node => { const root = node.querySelector('[data-tm-viewing-actions]');
        return { root, toggle: root?.querySelector('button'), marker: root?.querySelector('[data-tm-manual-choice]') }; };
    const click = target => root.dispatchEvent({ type: 'click', target, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    return { document, grid, root, item, controls, click };
}

test('grid prepares one private placement control tree before publication and copies facts into its labels', async () => {
    const e = await fixture(), handle = e.grid.getCard(e.item), controls = e.controls(handle.node);
    assert.ok(controls.toggle);
    assert.equal(handle.node.__tmViewingControls, undefined);
    e.grid.updateCardPlacement(handle, { status: 'complete', type: 'movie', manual: true, disabled: false });
    assert.equal(controls.toggle.textContent, 'moveBackToMyList');
    assert.equal(controls.toggle.getAttribute('aria-label'), 'moveBackToMyList: First');
    assert.equal(controls.marker.hidden, false);
    e.grid.updateCardPlacement(handle, { status: 'unknown', type: 'series', manual: false, disabled: true });
    assert.equal(controls.toggle.textContent, 'markCaughtUp');
    assert.equal(controls.toggle.disabled, true);
    assert.equal(controls.marker.hidden, true);
    assert.equal(handle.node.querySelectorAll('[data-tm-viewing-actions]').length, 1);
});

test('placement publication rejects retired handles and revalidates caller admission between host writes', async () => {
    const e = await fixture(), old = e.grid.getCard(e.item), controls = e.controls(old.node);
    let checks = 0;
    assert.throws(() => e.grid.updateCardPlacement(old, { status: 'complete' }, () => {
        if (++checks === 3) throw new Error('obsolete');
    }), /obsolete/);
    assert.notEqual(controls.marker.textContent, 'manualViewingChoice');
    e.grid.replaceCard(old, { node: old.node.cloneNode(true) });
    assert.throws(() => e.grid.updateCardPlacement(old, { status: 'complete' }), { code: 'GRID_CARD_RETIRED' });
});

test('delegated action requires the exact current control and visible admitted card', async () => {
    const e = await fixture(), handle = e.grid.getCard(e.item), actions = [];
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction: item => actions.push(item) });
    const { toggle } = e.controls(handle.node);
    e.click(toggle);
    assert.deepEqual(actions, [e.item]);
    const forged = handle.node.appendChild(new Element('button')); forged.setAttribute('data-tm-viewing-action', 'toggle');
    handle.node.__tmViewingControls = { toggle: forged };
    e.click(forged);
    handle.node.setAttribute('data-tm-type-hidden', 'true'); e.click(toggle);
    handle.node.removeAttribute('data-tm-type-hidden'); toggle.disabled = true; e.click(toggle);
    assert.equal(actions.length, 1);
    toggle.disabled = false;
    e.grid.replaceCard(handle, { node: handle.node.cloneNode(true) }); e.click(toggle);
    assert.equal(actions.length, 1);
    e.click(e.controls(e.grid.getCard(e.item).node).toggle);
    assert.equal(actions.length, 2);
});

test('placement into a collapsed group preserves scrolling and uses the owned summary focus fallback', async () => {
    const e = await fixture(), handle = e.grid.getCard(e.item);
    const details = e.root.appendChild(new Element('details')); details.setAttribute('data-tm-watch-section', 'true'); details.open = false;
    const summary = details.appendChild(new Element('summary')), watched = details.appendChild(new Element());
    watched.setAttribute('data-tm-watch-grid', 'true');
    let focused = 0; summary.focus = options => { assert.deepEqual(options, { preventScroll: true }); focused++; };
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction() { e.grid.moveCard(handle, watched); } });
    e.click(e.controls(handle.node).toggle);
    assert.equal(focused, 1);
    e.click(e.controls(handle.node).toggle);
    assert.equal(focused, 1, 'collapsed cards cannot admit another action');
});

test('obsolete action admission and disposal retire exact listeners without affecting a replacement root', async () => {
    const e = await fixture(), actions = [];
    let current = true;
    e.grid.attachPlacementActions({ assertCurrent() { if (!current) throw new Error('obsolete'); }, onAction: item => actions.push(item) });
    const toggle = e.controls(e.grid.getCard(e.item).node).toggle;
    current = false; e.click(toggle);
    assert.equal(actions.length, 0);
    assert.equal(e.root.listenerCount('click'), 1);
    const replacement = e.document.body.appendChild(new Element()); replacement.id = e.root.id;
    const external = () => {}; replacement.addEventListener('click', external);
    e.grid.dispose();
    assert.equal(e.root.listenerCount('click'), 0);
    assert.equal(replacement.listenerCount('click'), 1);
});

test('reentrant listener replacement preserves the newer admission and retires the interrupted action', async () => {
    const e = await fixture(), actions = [];
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction: () => actions.push('old') });
    const remove = e.root.removeEventListener.bind(e.root); let reentrant = true;
    e.root.removeEventListener = (name, listener) => {
        remove(name, listener);
        if (reentrant) { reentrant = false; e.grid.attachPlacementActions({ assertCurrent() {}, onAction: () => actions.push('new') }); }
    };
    assert.throws(() => e.grid.attachPlacementActions({ assertCurrent() {}, onAction: () => actions.push('interrupted') }),
        { code: 'GRID_FRAME_RETIRED' });
    e.click(e.controls(e.grid.getCard(e.item).node).toggle);
    assert.deepEqual(actions, ['new']);
    assert.equal(e.root.listenerCount('click'), 1);
});

test('host listener-release failure cannot keep an actionable retired resource', async () => {
    const e = await fixture(), actions = [];
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction: item => actions.push(item) });
    const toggle = e.controls(e.grid.getCard(e.item).node).toggle;
    e.root.removeEventListener = () => { throw new Error('host failure'); };
    e.grid.dispose(); e.click(toggle);
    assert.equal(actions.length, 0);
    assert.equal(e.grid.diagnostics().placementReleaseFailures, 1);
});

test('control subtree replacement during painting rejects remaining writes and grants no action identity', async () => {
    const e = await fixture(), handle = e.grid.getCard(e.item), controls = e.controls(handle.node);
    const set = controls.toggle.setAttribute.bind(controls.toggle);
    controls.toggle.setAttribute = (name, value) => { set(name, value); controls.root.remove(); };
    assert.throws(() => e.grid.updateCardPlacement(handle, { status: 'complete', manual: true }),
        { code: 'GRID_CONTROL_RETIRED' });
    assert.notEqual(controls.marker.textContent, 'manualViewingChoice');
});

test('whole-grid publication retires the old delegated listener before a new policy attaches', async () => {
    const e = await fixture(), actions = [];
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction: item => actions.push(item) });
    const next = await publishGrid(e.grid, { items: [e.item], section: e.root.parentElement, status: e.grid.status,
        layout: { gap: 8 }, geometry: { left: 0, width: 600, columns: 6 }, assertCurrent() {} });
    assert.equal(e.root.listenerCount('click'), 0);
    assert.equal(next.listenerCount('click'), 0);
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction: item => actions.push(item) });
    next.dispatchEvent({ type: 'click', target: e.controls(e.grid.getCard(e.item).node).toggle,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.deepEqual(actions, [e.item]);
});

test('placement delegation preserves captured click handling and removes the matching listener phase', async () => {
    const e = await fixture(), phases = [];
    const add = e.root.addEventListener.bind(e.root), remove = e.root.removeEventListener.bind(e.root);
    e.root.addEventListener = (name, listener, capture) => { phases.push(['add', name, capture]); add(name, listener); };
    e.root.removeEventListener = (name, listener, capture) => { phases.push(['remove', name, capture]); remove(name, listener); };
    e.grid.attachPlacementActions({ assertCurrent() {}, onAction() {} }); e.grid.dispose();
    assert.deepEqual(phases, [['add', 'click', true], ['remove', 'click', true]]);
});
