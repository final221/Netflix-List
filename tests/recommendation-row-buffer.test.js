import test from 'node:test';
import assert from 'node:assert/strict';
import { createRowBuffer } from '../src/recommendations/row-buffer.js';

const items = (...ids) => ids.map(id => ({ id: String(id), title: 'Title ' + id }));

test('recycled windows retain first-observed order and deduplicate returning titles', () => {
    const row = createRowBuffer();
    row.observe(items(1, 2, 3, 4)); row.observe(items(3, 4, 5, 6)); row.observe(items(1, 2));
    const page = row.project({}, { capacity: 3, mountedIds: ['1', '2'] });
    assert.equal(page.known, 6); assert.equal(page.retainedUnmounted, 4);
    assert.deepEqual(page.page, ['1', '2', '3']); assert.deepEqual(page.next, ['4', '5', '6']);
});

test('filtered pages fill across hidden runs and retain their anchor when earlier titles are restored', () => {
    const row = createRowBuffer(); row.observe(items(1, 2, 3, 4, 5, 6, 7, 8));
    let choices = { 1: 'hide', 3: 'watched', 4: 'hide' };
    let page = row.project(choices, { capacity: 3 });
    assert.deepEqual(page.page, ['2', '5', '6']); assert.deepEqual(page.next, ['7', '8']);
    choices = { 3: 'watched', 4: 'hide' };
    page = row.project(choices, { capacity: 3 });
    assert.deepEqual(page.page, ['2', '5', '6']); assert.deepEqual(page.previous, ['1']);
    choices[2] = 'hide'; page = row.project(choices, { capacity: 3 });
    assert.deepEqual(page.page, ['5', '6', '7']);
});

test('capacity limits never evict earlier discoveries or imply server exhaustion', () => {
    const row = createRowBuffer(3); row.observe(items(1, 2, 3, 4));
    const page = row.project({ 1: 'hide', 2: 'hide', 3: 'hide' });
    assert.equal(page.known, 3); assert.equal(page.truncated, true);
    assert.equal(page.exhausted, null); assert.deepEqual(page.page, []);
});
