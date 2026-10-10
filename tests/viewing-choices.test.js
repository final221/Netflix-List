import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletion } from '../src/viewing/completion.js';
import { fixture } from './helpers/viewing.js';
import { createBrowsingViewing } from '../src/viewing/viewing.js';

test('browsing and My List use one manual choice store in both directions', async () => {
    const e = await fixture();
    const browsing = createBrowsingViewing({ environment: globalThis, context: { activeProfile: () => 'a' },
        userscript: { getValue: (key, fallback) => e.storage.get(key) ?? fallback, setValue: (key, value) => e.storage.set(key, value) },
        isCurrent: () => true, onChange() {} });
    browsing.reset(); browsing.observe([{ id: '1', typeHint: 'movie' }]); assert.equal(browsing.mark('1').saved, true);
    const next = e.viewing.createSession(e.config); await e.viewing.start(next);
    assert.equal(e.viewing.placement(next, '1').status, 'complete'); assert.equal(e.viewing.placement(next, '1').manual, true);
    assert.equal(e.viewing.place(next, '1').saved, true);
    browsing.reset(); assert.equal(browsing.complete('1'), false);
    assert.equal(e.storage.get('legacyMyListForNetflix.viewingChoices.v1.a').choices['1'].status, 'main');
    browsing.dispose(); e.viewing.dispose(next); e.viewing.dispose(e.watch);
});

test('unknown automatic completion preserves explicit placement and private choices', async () => {
    const e = await fixture(), { viewing: v, watch: w } = e;
    assert.equal(createCompletion().classifyVideo({ type: 'show', watched: true }), 'unknown');
    assert.equal(createCompletion().classifyVideo({ type: 'movie', watched: null, bookmark: null, runtime: null }), 'unknown');
    assert.equal(v.place(w, '1').saved, true);
    assert.equal(v.placement(w, '1').status, 'complete');
    const choice = v.choice(w, '1');
    assert.throws(() => { choice.status = 'main'; }, TypeError);
    assert.equal(v.placement(w, '1').status, 'complete');
    assert.equal(Object.hasOwn(w, 'manualChoices'), false);
    assert.equal(Object.hasOwn(w, 'cachedResults'), false);
});

test('profile replacement during storage read rejects the old action', async () => {
    const e = await fixture(); e.onRead(() => e.profile('b'));
    assert.equal(e.viewing.place(e.watch, '1').saved, false);
    assert.equal(e.storage.size, 0);
    e.viewing.reconcile(e.watch);
    assert.equal(e.viewing.placement(e.watch, '1').manual, false);
});

test('series correction expiry stays truthful when persistence fails', async () => {
    const e = await fixture(); e.coverage.set('1', [['10', 2]]); await e.refresh();
    e.viewing.place(e.watch, '1'); e.coverage.set('1', [['10', 3]]);
    e.onWrite(() => { throw new Error('offline'); }); await e.refresh();
    assert.ok(e.changes.some(change => change.ids?.includes('1')));
    assert.equal(e.viewing.placement(e.watch, '1').manual, false);
    assert.equal(e.viewing.placement(e.watch, '1').status, 'unknown');
    assert.equal(e.viewing.presentation(e.watch).manualFailure, true);
});

test('obsolete coverage expiry cannot erase a newer action after a reentrant storage failure', async () => {
    const e = await fixture(); e.coverage.set('1', [['10', 2]]); await e.refresh();
    e.viewing.place(e.watch, '1'); e.coverage.set('1', [['10', 3]]);
    e.onWrite(() => { e.onWrite(() => {});
        assert.equal(e.viewing.place(e.watch, '1').saved, true); throw new Error('old write failed'); });
    await e.refresh();
    assert.equal(e.viewing.reconcile(e.watch, []).size, 0);
    assert.equal(e.viewing.choice(e.watch, '1').status, 'main');
    assert.equal(e.viewing.presentation(e.watch).manualFailure, false);
});

test('concurrent choice writes preserve other titles and isolate profiles', async () => {
    const e = await fixture(), other = e.viewing.createSession(e.config); await e.viewing.start(other);
    e.viewing.place(e.watch, '1'); e.viewing.place(other, '2');
    assert.deepEqual(Object.keys(e.storage.get('legacyMyListForNetflix.viewingChoices.v1.a').choices), ['1', '2']);
    e.profile('b'); e.viewing.reconcile(e.watch); e.viewing.place(e.watch, '3');
    assert.deepEqual(e.viewing.choiceIds(e.watch), ['3']);
    assert.deepEqual(Object.keys(e.storage.get('legacyMyListForNetflix.viewingChoices.v1.a').choices), ['1', '2']);
    e.viewing.dispose(other);
});

test('profile reset precedes storage callbacks and preserves a newer normalized publication', async () => {
    const e = await fixture(); e.profile('b');
    e.onRead(() => { e.onRead(() => {}); e.records.set('1', { type: 'movie', watched: true }); e.refresh(); });
    e.viewing.reconcile(e.watch); await e.viewing.settled(e.watch);
    assert.equal(e.viewing.automatic(e.watch, '1'), 'complete');
});
