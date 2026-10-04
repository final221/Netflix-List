import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './helpers/dom.js';

test('styles install once, keep native/owned selectors and can be removed and reinstalled', async () => {
    const { createGrid } = await import('../src/grid/grid.js');
    const names = await import('../src/dom-names.js');
    const document = createDocument();
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' }, runChunks: async () => {} });
    const first = grid.installResources();
    assert.equal(first.id, names.STYLE_ID);
    assert.equal(grid.installResources(), first);
    assert.equal(document.head.querySelectorAll('style').length, 1);
    for (const name of [names.GRID_ID, names.STATUS_ID, names.ORIGINAL_HIDDEN_CLASS, names.SOURCE_PARKED_CLASS,
        names.ORIGINAL_VISIBILITY_ATTR, names.LEGACY_EMPTY_STATE_ID]) assert.ok(first.textContent.includes(name), name);
    assert.ok(first.textContent.includes('[data-tm-watch-controls]'));
    assert.ok(first.textContent.includes('pointer-events: auto !important'));
    grid.dispose();
    grid.dispose();
    assert.equal(document.head.querySelectorAll('style').length, 0);
    const replacement = grid.installResources();
    assert.notEqual(replacement, first);
    assert.equal(replacement.textContent, first.textContent);
});

test('resource imports do not access browser state or start runtime work', async () => {
    // Node has no document/window/GM environment here: all browser work is explicit.
    const [names, styles, i18n] = await Promise.all([
        import('../src/dom-names.js'), import('../src/grid/styles.js'), import('../src/i18n/i18n.js')
    ]);
    assert.equal(typeof names.GRID_ID, 'string');
    assert.equal(typeof styles.installStyles, 'function');
    assert.equal(typeof i18n.createI18n, 'function');
});
