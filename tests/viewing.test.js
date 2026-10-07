import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/viewing.js';

test('automatic cache writes fresh membership only, separately from manual state', () => {
    const e = fixture();
    e.viewing.place(e.watch, '1');
    e.viewing.writeCache({ profile: 'a', items: [{ videoId: '1' }],
        results: new Map([['1', 'in-progress'], ['2', 'complete']]), types: new Map([['1', 'movie'], ['2', 'movie']]), assertCurrent() {} });
    const saved = e.storage.get('legacyMyListForNetflix.viewingCache.v1.a');
    assert.deepEqual(saved.entries, { '1': ['movie', 'in-progress'] });
    assert.equal(saved.savedAt, 1000);
});

test('obsolete cache initialization cannot overwrite a newer same-profile invalidation', () => {
    const e = fixture();
    e.storage.set('legacyMyListForNetflix.viewingCache.v1.a', {
        version: 1, completionRatio: .9, savedAt: 1000, entries: { '1': ['movie', 'complete'] }
    });
    e.onRead(() => e.viewing.clearCache(e.watch));
    assert.equal(e.viewing.initialize(e.watch, [{ videoId: '1' }], 'a'), 0);
    assert.equal(e.viewing.automatic(e.watch, '1'), 'unknown');
});

test('cancelled placement and cache persistence do not write or change accepted choices', () => {
    const e = fixture();
    e.viewing.place(e.watch, '1');
    const before = structuredClone([...e.storage]);
    const assertCurrent = () => { throw new Error('retired'); };
    assert.throws(() => e.viewing.place(e.watch, '1', { assertCurrent }), /retired/);
    assert.equal(e.viewing.writeCache({ profile: 'a', items: [{ videoId: '1' }], results: e.watch.results,
        types: e.watch.types, assertCurrent }), false);
    assert.deepEqual([...e.storage], before);
    assert.equal(e.viewing.choice(e.watch, '1').status, 'complete');
});

test('a profile switch during initial choice loading cannot borrow cached completion', () => {
    const e = fixture();
    e.storage.set('legacyMyListForNetflix.viewingCache.v1.a', {
        version: 1, completionRatio: .9, savedAt: 1000, entries: { '1': ['movie', 'complete'] }
    });
    const watch = { results: new Map(), types: new Map(), seriesCoverage: new Map() };
    e.viewing.initialize(watch, [{ videoId: '1' }], 'a');
    e.onRead(() => e.profile('b'));
    e.viewing.syncProfile(watch);
    assert.equal(e.viewing.placement(watch, '1').status, 'unknown');
    assert.equal(e.viewing.presentation(watch).disabled, true);
    assert.equal(e.viewing.place(watch, '1').saved, false);
});
