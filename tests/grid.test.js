import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './helpers/dom.js';

test('styles install once, keep native/owned selectors and can be removed and reinstalled', async () => {
    const { installStyles, removeStyles } = await import('../src/grid/styles.js');
    const names = await import('../src/dom-names.js');
    const document = createDocument();
    const first = installStyles(document);
    assert.equal(first.id, names.STYLE_ID);
    assert.equal(installStyles(document), first);
    assert.equal(document.head.querySelectorAll('style').length, 1);
    for (const name of [names.GRID_ID, names.STATUS_ID, names.ORIGINAL_HIDDEN_CLASS, names.SOURCE_PARKED_CLASS,
        names.ORIGINAL_VISIBILITY_ATTR, names.LEGACY_EMPTY_STATE_ID]) assert.ok(first.textContent.includes(name), name);
    assert.ok(first.textContent.includes('[data-tm-watch-controls]'));
    assert.ok(first.textContent.includes('pointer-events: auto !important'));
    removeStyles(document);
    removeStyles(document);
    assert.equal(document.head.querySelectorAll('style').length, 0);
    const replacement = installStyles(document);
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
