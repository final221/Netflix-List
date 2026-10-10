import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationDiagnostics } from '../src/recommendations/navigation.js';
import { createScheduler } from './helpers/scheduler.js';
function setup() {
    const scheduler = createScheduler(), row = { isConnected: true, id: 'row' }, control = {}, movements = [];
    let ids = ['1'], reads = 0, active = true;
    const dom = { navigationTarget: target => target === control ? { row, control, direction: 'next' } : null,
        rowDiagnostics: () => ({ rowId: 'row', ids: ids.slice(), visibleIds: ids.slice(), idsTruncated: false, mounted: ids.length }),
        navigationStart: () => ({ at: scheduler.performance.now() }),
        observeRequests: () => ({ begin() {}, read: () => ({ number: ++reads }), dispose() {} }),
        navigationRequests: (start, end, facts) => ({ start, end, number: facts?.number }), describe: () => ({ id: '1', row }) };
    const probe = createNavigationDiagnostics({ environment: scheduler, dom, readChoices: () => ({}), admitted: () => active, log: (...args) => movements.push(args) });
    return { probe, scheduler, row, control, set: values => { ids = values; }, admit: value => { active = value; } };
}
test('timed arrow samples freeze history and distinguish first-observed IDs from returning mounted cards', async () => {
    const b = setup(); b.probe.click(b.control); b.set(['1', '2']); await b.scheduler.advance(200);
    assert.equal(b.probe.snapshot().recent[0].samples[0].firstObservedCount, 1);
    b.probe.click(b.control); const first = b.probe.snapshot().recent[0];
    b.set(['1']); await b.scheduler.advance(1200);
    b.probe.click(b.control); b.set(['1', '2']); await b.scheduler.advance(200);
    const facts = b.probe.snapshot();
    assert.equal(facts.recent[2].samples[0].addedCount, 1);
    assert.equal(facts.recent[2].samples[0].firstObservedCount, 0);
    assert.deepEqual(facts.recent[0].samples, first.samples);
    assert.deepEqual(facts.recent[0].requests, first.requests); b.probe.dispose();
    assert.equal(b.scheduler.timers.size, 0);
});
test('retirement cancels sampling and rejects an old callback after a new owner starts', async () => {
    const b = setup(); b.probe.click(b.control); const callback = [...b.scheduler.timers.values()][0].callback;
    b.probe.dispose(); b.probe.click(b.control); callback();
    assert.equal(b.probe.snapshot().recent[0].samples.length, 0);
    b.admit(false); await b.scheduler.advance(5000); assert.equal(b.probe.snapshot().recent[0].samples.length, 0); b.probe.dispose();
});
test('movement history records meaningful transitions, ignores repeated hover and is bounded', () => {
    const b = setup(), card = { closest: () => ({}) };
    for (let i = 0; i < 20; i++) b.probe.movement('hover', card, { x: 10, y: 20, secret: 'omit' });
    assert.equal(b.probe.snapshot().movements.length, 1);
    for (let i = 0; i < 300; i++) b.probe.movement('action', null, { id: String(i), action: 'hide' });
    const facts = b.probe.snapshot(); assert.equal(facts.movements.length, 240);
    assert.equal(facts.movementsDropped, 61); assert.equal(facts.movements[0].id, '60'); assert.doesNotMatch(JSON.stringify(facts), /omit|secret/); b.probe.dispose();
});
