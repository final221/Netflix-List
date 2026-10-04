import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { Element, createDocument } from './helpers/dom.js';
import { LEGACY_EMPTY_STATE_ID, SYNTHETIC_SECTION_ID, ORIGINAL_HEADER_CLASS, SECTION_ATTR } from '../src/dom-names.js';

function fixture() {
    const document = createDocument(), location = { href: 'https://www.netflix.com/browse/my-list' };
    const pageDom = createNetflixPageDom({ document, Element, location });
    const grid = createGrid({ document, location, runChunks: async () => {}, tUi: () => 'Empty My List',
        readEmptyContent: pageDom.readEmptyContent, readEmptyShell: pageDom.readEmptyShell });
    const host = document.body.appendChild(new Element('main'));
    host.setAttribute('data-uia', 'browse-page-sections');
    const section = host.appendChild(new Element('section'));
    const anchor = section.appendChild(new Element('h2'));
    const status = grid.updateStatus('My List');
    const geometry = { left: 20, width: 600, columns: 6 }, layout = { gap: 8, rowGap: 12 };
    grid.mount({ section, anchor, status, geometry, layout, assertCurrent() {} });
    const empty = (parent = section, text = 'Native empty') => {
        const content = parent.appendChild(new Element()); content.id = 'native-content';
        content.setAttribute('data-uia', 'empty-carousel-section+content'); content.classList.add(ORIGINAL_HEADER_CLASS);
        const pictogram = content.appendChild(new Element()); pictogram.setAttribute('data-uia', 'empty-carousel-section+pictogram');
        const message = content.appendChild(new Element('p')); message.id = 'native-message';
        message.setAttribute('data-uia', 'empty-carousel-section+message'); message.textContent = text;
        return { content, message, pictogram };
    };
    const present = (allowProvisional = false, assertCurrent = () => {}) => grid.presentEmpty({ section, allowProvisional, geometry, assertCurrent });
    return { document, pageDom, grid, host, section, anchor, status, geometry, layout, empty, present };
}

test('native empty content is grid-owned, sanitized and laid out with distinct cached material', () => {
    const e = fixture(), native = e.empty(undefined, '  Native\u200b empty  ');
    assert.equal(e.present(), true);
    const shown = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.equal(e.status.nextElementSibling, shown);
    assert.equal(shown.nextElementSibling, e.grid.root);
    assert.equal(shown.getAttribute('data-tm-empty-source'), 'native');
    assert.equal(shown.getAttribute('data-uia'), null);
    assert.equal(shown.classList.contains(ORIGINAL_HEADER_CLASS), false);
    assert.equal(shown.querySelectorAll('[data-uia]').length, 0);
    assert.equal(shown.querySelectorAll('[id]').length, 0);
    assert.equal(shown.style.maxWidth, '600px');
    assert.equal(native.message.id, 'native-message');
    assert.equal(native.content.classList.contains(ORIGINAL_HEADER_CLASS), true);
    native.content.remove();
    shown.querySelector('p').textContent = 'Changed displayed clone';
    assert.equal(e.present(true), true);
    const cached = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.equal(cached.getAttribute('data-tm-empty-source'), 'provisional-cached');
    assert.equal(cached.querySelector('p').textContent, '  Native\u200b empty  ');
    assert.equal(shown.isConnected, false);
    e.grid.clearEmpty();
    assert.equal(cached.isConnected, false);
    assert.equal(e.status.nextElementSibling, e.grid.root);
});

test('provisional empty uses a foreign native shell without its pictogram and falls back without native material', () => {
    const e = fixture(), foreign = e.host.appendChild(new Element('section'));
    const native = e.empty(foreign, 'Not My List');
    assert.equal(e.present(true), true);
    let shown = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.equal(shown.getAttribute('data-tm-empty-source'), 'provisional-shell');
    assert.equal(shown.querySelector('p').textContent, 'Empty My List');
    assert.equal(shown.children.length, 1);
    assert.equal(native.content.children.length, 2);
    foreign.setAttribute(SECTION_ATTR, 'true');
    e.present(true);
    shown = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.equal(shown.getAttribute('data-tm-empty-source'), 'provisional-fallback');
    assert.equal(shown.querySelector('p').textContent, 'Empty My List');
});

test('missing native empty content does not create a provisional frame unless the caller explicitly allows it', () => {
    const e = fixture();
    assert.equal(e.present(false), false);
    assert.equal(e.document.getElementById(LEGACY_EMPTY_STATE_ID), null);
    assert.equal(e.status.nextElementSibling, e.grid.root);
    assert.equal(e.present(true), true);
    e.grid.resetEmpty();
    assert.equal(e.document.getElementById(LEGACY_EMPTY_STATE_ID), null);
});

test('replaced native content during capture cannot publish or retain obsolete material', () => {
    const e = fixture(), native = e.empty();
    const clone = native.content.cloneNode.bind(native.content);
    native.content.cloneNode = deep => { const result = clone(deep); native.content.remove(); e.empty(undefined, 'Replacement'); return result; };
    assert.throws(() => e.present(), { code: 'NATIVE_SOURCE_REPLACED' });
    assert.equal(e.document.getElementById(LEGACY_EMPTY_STATE_ID), null);
    e.grid.resetEmpty();
    e.section.querySelector('[data-uia="empty-carousel-section+content"]').remove();
    e.present(true);
    assert.equal(e.document.getElementById(LEGACY_EMPTY_STATE_ID).getAttribute('data-tm-empty-source'), 'provisional-fallback');
});

test('empty geometry and disposal reject stale callbacks and preserve replacement nodes with the same ID', () => {
    const e = fixture(); e.empty(); e.present();
    const shown = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.throws(() => e.grid.layoutEmpty({ left: 80, width: 300 }, () => { throw new Error('obsolete'); }), /obsolete/);
    assert.equal(shown.style.width, '600px');
    const replacement = e.document.body.appendChild(new Element()); replacement.id = LEGACY_EMPTY_STATE_ID;
    e.grid.dispose();
    assert.equal(shown.isConnected, false);
    assert.equal(replacement.isConnected, true);
    assert.equal(e.grid.emptyPresentation().connected, false);
});

test('grid positions and disposes its synthetic section from read-only native placement facts', () => {
    const e = fixture(); e.section.remove();
    assert.equal(e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement()), null);
    const first = e.host.appendChild(new Element('section'));
    const synthetic = e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement());
    assert.equal(synthetic.id, SYNTHETIC_SECTION_ID);
    assert.equal(first.nextElementSibling, synthetic);
    assert.equal(e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement()), synthetic);
    const replacement = e.document.body.appendChild(new Element('section')); replacement.id = SYNTHETIC_SECTION_ID;
    e.grid.dispose();
    assert.equal(synthetic.isConnected, false);
    assert.equal(replacement.isConnected, true);
});

test('synthetic placement rejects obsolete native anchors before structural publication', () => {
    const e = fixture(), placement = e.pageDom.readSyntheticPlacement();
    placement.after.remove();
    assert.throws(() => e.grid.ensureSynthetic(placement), { code: 'NATIVE_SOURCE_REPLACED' });
    assert.equal(e.document.getElementById(SYNTHETIC_SECTION_ID), null);
    assert.throws(() => e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement(), () => { throw new Error('obsolete'); }), /obsolete/);
});

test('grid geometry consumes admitted native facts and keeps calculation separate from current-root publication', () => {
    const e = fixture(), layout = { gridLeft: 20, cardWidth: 100, gridWidth: 900, columns: 6, gap: 8 };
    const geometry = e.grid.geometry({ bounds: { left: 40, right: 900 }, viewportWidth: 800 }, layout);
    assert.deepEqual(geometry, { left: 20, width: 740, columns: 6 });
    e.grid.applyGeometry(e.grid.root, geometry, layout);
    assert.equal(e.grid.root.style.getPropertyValue('--tm-grid-width'), '740px');
    assert.throws(() => e.grid.geometry({ bounds: { left: 0, right: 900 }, viewportWidth: 800 }, layout,
        () => { throw new Error('obsolete'); }), /obsolete/);
});

test('reentrant empty cleanup preserves a newer publication and its sibling order', () => {
    const e = fixture(); e.empty(); e.present();
    const old = e.document.getElementById(LEGACY_EMPTY_STATE_ID), remove = old.remove.bind(old);
    old.remove = () => { remove(); e.present(true); };
    assert.throws(() => e.grid.clearEmpty(), { code: 'GRID_FRAME_RETIRED' });
    const current = e.document.getElementById(LEGACY_EMPTY_STATE_ID);
    assert.notEqual(current, old);
    assert.equal(e.status.nextElementSibling, current);
    assert.equal(current.nextElementSibling, e.grid.root);
});

test('reentrant synthetic publication preserves the newer section owner', () => {
    const e = fixture(), after = e.section;
    const insert = after.insertAdjacentElement.bind(after); let replacement;
    after.insertAdjacentElement = (position, node) => {
        insert(position, node);
        if (!replacement) { replacement = true; replacement = e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement()); }
    };
    assert.throws(() => e.grid.ensureSynthetic(e.pageDom.readSyntheticPlacement()), { code: 'NATIVE_SOURCE_REPLACED' });
    assert.equal(e.document.getElementById(SYNTHETIC_SECTION_ID), replacement);
    e.grid.dispose();
    assert.equal(replacement.isConnected, false);
});

test('retired and foreign roots reject frame geometry writes', () => {
    const e = fixture(), root = e.grid.root;
    e.grid.dispose();
    const geometry = { left: 20, width: 300, columns: 3 };
    assert.throws(() => e.grid.applyGeometry(root, geometry, e.layout), { code: 'GRID_FRAME_RETIRED' });
    assert.throws(() => e.grid.applyGeometry(new Element(), geometry, e.layout), { code: 'GRID_FRAME_RETIRED' });
});

test('disposal during native frame attachment cannot resurrect the retiring root', () => {
    const e = fixture(), root = e.grid.root;
    const insert = e.status.insertAdjacentElement.bind(e.status);
    e.status.insertAdjacentElement = (position, node) => { insert(position, node); e.grid.dispose(); };
    assert.throws(() => e.grid.mount({ section: e.section, status: e.status,
        geometry: { left: 10, width: 600, columns: 6 }, layout: { gap: 8 }, assertCurrent() {} }),
        { code: 'GRID_FRAME_RETIRED' });
    assert.equal(e.grid.root, null);
    assert.equal(root.isConnected, false);
});
