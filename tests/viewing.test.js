import { knowledgeSnapshot, fact } from './helpers/knowledge.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/viewing.js';

test('automatic observations persist admitted membership separately from manual state', async () => {
    const e = await fixture(); e.viewing.place(e.watch, '1');
    e.records.set('1', { type: 'movie', watched: false, bookmark: 25, runtime: 100 });
    e.records.set('9', { type: 'movie', watched: true }); await e.refresh();
    assert.equal(fact(e.storage, 'a', '1', 'metadata').type, 'movie');
    assert.equal(fact(e.storage, 'a', '9', 'completion'), undefined);
    assert.equal(e.storage.has('legacyMyListForNetflix.viewingCache.v1.a'), false);
    assert.equal(e.viewing.choice(e.watch, '1').status, 'complete');
});

test('obsolete cache initialization cannot overwrite a newer same-profile invalidation', async () => {
    const e = await fixture(); e.storage.set('legacyMyListForNetflix.viewingCache.v1.a', {
        version: 1, completionRatio: .9, savedAt: 1000, entries: { '1': ['movie', 'complete'] }
    });
    const old = e.viewing.createSession(e.config); let next;
    e.onRead(() => { e.onRead(() => {}); next = e.viewing.createSession(e.config);
        e.viewing.dispose(old); e.viewing.start(next); });
    assert.throws(() => e.viewing.start(old), /cancelled/);
    assert.equal(e.viewing.automatic(old, '1'), 'unknown');
    assert.equal(e.viewing.automatic(next, '1'), 'complete');
    await e.viewing.settled(next); e.viewing.dispose(next);
});

test('cancelled placement and cache persistence do not write or change accepted choices', async () => {
    const e = await fixture(); e.viewing.place(e.watch, '1'); const before = structuredClone([...e.storage]);
    e.retire(); assert.throws(() => e.viewing.place(e.watch, '1'), /cancelled/);
    await e.refresh(); assert.deepEqual([...e.storage], before);
    assert.equal(knowledgeSnapshot(e.storage, 'a').choices['1'].status, 'complete');
    e.viewing.dispose(e.watch);
});

test('a profile switch during initial choice loading cannot borrow cached completion', async () => {
    const e = await fixture(); e.storage.set('legacyMyListForNetflix.viewingCache.v1.a', {
        version: 1, completionRatio: .9, savedAt: 1000, entries: { '1': ['movie', 'complete'] }
    });
    const watch = e.viewing.createSession({ ...e.config, onChange() {
        if (e.viewing.presentation(watch).profile === 'a') {
            assert.equal(e.viewing.placement(watch, '1').status, 'unknown');
            assert.equal(e.viewing.presentation(watch).disabled, true);
        }
    } });
    e.onRead(key => { if (key.endsWith('.signal')) e.profile('b'); });
    await e.viewing.start(watch);
    assert.equal(e.viewing.placement(watch, '1').status, 'unknown');
    e.viewing.dispose(watch);
});
