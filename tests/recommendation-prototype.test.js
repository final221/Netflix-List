import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationPrototype } from '../scripts/recommendation-prototype.js';
const cards = (...ids) => ids.map(id => ({ id: String(id), title: 'Title ' + id }));
test('recommendation experiment refills from later pages, deduplicates, saves reasons and preserves Undo order', async () => {
    const stored = {}, calls = [];
    const pages = [{ cards: cards(1,2), hasNextPage: true, endCursor: 'next' },
        { cards: cards(1,3,4), hasNextPage: false, endCursor: null }];
    const p = createRecommendationPrototype({ capacity: 2, loadChoices: profile => stored[profile],
        saveChoices: (profile, value) => { stored[profile] = value; },
        getPage: async input => { calls.push(input); return pages[input.cursor === null ? 0 : 1]; } });
    p.selectProfile('A'); await p.refill(); await p.dismiss('1', 'watched');
    assert.deepEqual(p.snapshot().cards, cards(2,3)); assert.deepEqual(stored.A, { 1: 'watched' });
    assert.equal(calls.length, 2); assert.equal(calls[1].cursor, 'next');
    p.undo(); assert.deepEqual(p.snapshot().cards, cards(1,2)); assert.deepEqual(stored.A, {});
    await p.dismiss('2', 'hide'); assert.deepEqual(p.snapshot().cards, cards(1,3));
    assert.deepEqual(stored.A, { 2: 'hide' }); assert.equal(calls.length, 2);
    p.selectProfile('B'); await p.refill(); assert.deepEqual(p.snapshot().cards, cards(1,2));
    p.selectProfile('A'); await p.refill(); assert.deepEqual(p.snapshot().cards, cards(1,3));
});
test('recommendation experiment does not request past row exhaustion or repeated cursors', async () => {
    let calls = 0;
    const p = createRecommendationPrototype({ capacity: 2, getPage: async () => {
        calls++; return { cards: cards(1), hasNextPage: false, endCursor: null }; } });
    p.selectProfile('A'); await p.refill(); await p.dismiss('1', 'hide'); await p.refill();
    assert.equal(calls, 1); assert.equal(p.snapshot().status, 'exhausted');
    const q = createRecommendationPrototype({ getPage: async () => ({ cards: cards(1), hasNextPage: true, endCursor: 'same' }) });
    q.selectProfile('A'); await q.refill(); assert.equal(q.snapshot().status, 'failed');
    assert.equal(q.snapshot().requests, 2); assert.deepEqual(q.snapshot().cards, cards(1));
});
test('recommendation experiment bounds empty-page fetching per refill and across the session', async () => {
    const p = createRecommendationPrototype({ pageBudget: 2, totalBudget: 3,
        getPage: async ({ cursor }) => ({ cards: [], hasNextPage: true, endCursor: String(Number(cursor || 0) + 1) }) });
    p.selectProfile('A'); await p.refill(); assert.equal(p.snapshot().requests, 2);
    assert.equal(p.snapshot().status, 'budget'); await p.refill(); await p.refill();
    assert.equal(p.snapshot().requests, 3); assert.equal(p.snapshot().busy, false);
});
test('recommendation experiment rejects malformed pages and retains a card when storage fails', async () => {
    const p = createRecommendationPrototype({ getPage: async () => ({ cards: cards(1), hasNextPage: false }),
        saveChoices: () => { throw new Error('denied'); } });
    p.selectProfile('A'); await p.refill(); assert.throws(() => p.dismiss('1', 'watched'), /denied/);
    assert.deepEqual(p.snapshot().cards, cards(1)); assert.deepEqual(p.snapshot().choices, {});
    const q = createRecommendationPrototype({ getPage: async () => ({ cards: [{ id: 'bad', title: 'bad' }], hasNextPage: false }) });
    q.selectProfile('A'); await q.refill(); assert.equal(q.snapshot().status, 'failed');
    assert.equal(q.snapshot().cards.length, 0);
});
test('recommendation experiment aborts obsolete work on profile switch or disposal', async () => {
    let resolve, signal;
    const p = createRecommendationPrototype({ getPage: input => {
        signal = input.signal; return new Promise(done => { resolve = done; }); } });
    p.selectProfile('A'); const pending = p.refill(); p.selectProfile('B'); assert.equal(signal.aborted, true);
    resolve({ cards: cards(1), hasNextPage: false }); await pending;
    assert.equal(p.snapshot().profile, 'B'); assert.equal(p.snapshot().cards.length, 0);
    const later = p.refill(); p.dispose(); assert.equal(signal.aborted, true);
    resolve({ cards: cards(2), hasNextPage: false }); await later; assert.equal(p.snapshot(), null);
});
