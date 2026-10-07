import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/viewing.js';

test('unknown automatic completion preserves explicit placement and private choices', () => {
    const e = fixture(), { viewing: v, watch: w } = e;
    assert.equal(v.classifyVideo({ type: 'show', watched: true }), 'unknown');
    assert.equal(v.classifyVideo({ type: 'movie', watched: null, bookmark: null, runtime: null }), 'unknown');
    assert.equal(v.place(w, '1').saved, true);
    assert.equal(v.placement(w, '1').status, 'complete');
    const choice = v.choice(w, '1');
    assert.throws(() => { choice.status = 'main'; }, TypeError);
    assert.equal(v.placement(w, '1').status, 'complete');
    assert.equal(Object.hasOwn(w, 'manualChoices'), false);
    assert.equal(Object.hasOwn(w, 'cachedResults'), false);
});

test('profile replacement during storage read rejects the old action', () => {
    const e = fixture();
    e.onRead(() => e.profile('b'));
    const result = e.viewing.place(e.watch, '1');
    assert.equal(result.saved, false);
    assert.equal(e.storage.size, 0);
    e.viewing.syncProfile(e.watch);
    assert.equal(e.viewing.placement(e.watch, '1').manual, false);
});

test('series correction expiry stays truthful when persistence fails', () => {
    const e = fixture();
    e.watch.seriesCoverage.set('1', [['10', 2]]);
    e.viewing.place(e.watch, '1');
    e.watch.seriesCoverage.set('1', [['10', 3]]);
    e.onWrite(() => { throw new Error('offline'); });
    assert.deepEqual([...e.viewing.reconcileCoverage(e.watch)], ['1']);
    assert.equal(e.viewing.placement(e.watch, '1').manual, false);
    assert.equal(e.viewing.placement(e.watch, '1').status, 'unknown');
    assert.equal(e.viewing.presentation(e.watch).manualFailure, true);
});

test('obsolete coverage expiry cannot erase a newer action after a reentrant storage failure', () => {
    const e = fixture();
    e.watch.seriesCoverage.set('1', [['10', 2]]);
    e.viewing.place(e.watch, '1');
    e.watch.seriesCoverage.set('1', [['10', 3]]);
    e.onWrite(() => {
        e.onWrite(() => {});
        assert.equal(e.viewing.place(e.watch, '1').saved, true);
        throw new Error('old write failed');
    });
    assert.equal(e.viewing.reconcileCoverage(e.watch).size, 0);
    assert.equal(e.viewing.choice(e.watch, '1').status, 'main');
    assert.equal(e.viewing.presentation(e.watch).manualFailure, false);
});

test('concurrent choice writes preserve other titles and isolate profiles', () => {
    const e = fixture();
    const other = { results: new Map(), types: new Map(), seriesCoverage: new Map() };
    e.viewing.syncProfile(other);
    e.viewing.place(e.watch, '1');
    e.viewing.place(other, '2');
    assert.deepEqual(Object.keys(e.storage.get('legacyMyListForNetflix.viewingChoices.v1.a').choices), ['1', '2']);
    e.profile('b');
    e.viewing.syncProfile(e.watch);
    e.viewing.place(e.watch, '3');
    assert.deepEqual(e.viewing.choiceIds(e.watch), ['3']);
    assert.deepEqual(Object.keys(e.storage.get('legacyMyListForNetflix.viewingChoices.v1.a').choices), ['1', '2']);
});

test('profile reset precedes storage callbacks and preserves a newer normalized publication', () => {
    const e = fixture();
    e.watch.results.set('1', 'in-progress');
    e.profile('b');
    e.onRead(() => e.watch.results.set('1', 'complete'));
    e.viewing.syncProfile(e.watch, () => {}, () => { e.watch.results = new Map(); });
    assert.equal(e.viewing.automatic(e.watch, '1'), 'complete');
});
