import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleDiagnostics } from '../src/recommendations/lifecycle.js';

function fixture() {
    let at = 0;
    const trace = createLifecycleDiagnostics({ now: () => ++at, readIdentity: row => ({ rowKey: row.key, pageKey: row.page }) });
    const rows = (count, page = 'old') => new Set(Array.from({ length: count }, (_, key) => ({ key: String(key), page })));
    return { trace, rows };
}
test('pinned loss context survives later cache traffic and bounded recent eviction', () => {
    const { trace, rows } = fixture(), old = rows(35), next = rows(5, 'new');
    trace.population(old, 455);
    const observe = trace.cacheObserver([...old][0]);
    observe({ operation: 'publish', stage: 'verified', edges: 12 }); trace.population(next, 65, { disconnected: 390 });
    for (let i = 0; i < 100; i++) observe({ operation: 'restore', stage: 'returned', edges: i });
    const facts = trace.snapshot(), incident = facts.incidents[0];
    assert.equal(facts.recent.length, 40); assert.ok(facts.droppedRecent > 0);
    assert.equal(incident.event.removed, 35); assert.equal(incident.event.rows, 5); assert.equal(incident.event.pageChanged, true);
    assert.equal(incident.before.at(-1).operation, 'publish'); assert.equal(incident.after.length, 12);
    assert.ok(incident.event.sequence > incident.before.at(-1).sequence);
    assert.ok(incident.after[0].sequence > incident.event.sequence);
    facts.incidents[0].event.rows = 999; assert.equal(trace.snapshot().incidents[0].event.rows, 5);
});
test('unchanged populations are silent, same-node reidentification is visible and reset rejects old callbacks', () => {
    const { trace, rows } = fixture(), current = rows(4);
    trace.population(current, 52); const sequence = trace.snapshot().sequence;
    trace.population(current, 55); assert.equal(trace.snapshot().sequence, sequence);
    for (const row of current) { row.key += '-replacement'; row.page = 'new'; }
    trace.population(current, 52);
    assert.equal(trace.snapshot().recent.at(-1).reidentified, 4);
    const stale = trace.cacheObserver([...current][0]); trace.reset(); stale({ operation: 'restore', stage: 'returned' });
    assert.equal(trace.snapshot().recent.length, 0); assert.equal(trace.snapshot().rows, 0);
});
test('gradual population loss pins the threshold crossing without flooding incident retention', () => {
    const { trace, rows } = fixture(), current = rows(20);
    trace.population(current, 260);
    for (const row of [...current].slice(0, 18)) { current.delete(row); trace.population(current, current.size * 13); }
    assert.equal(trace.snapshot().incidents.length, 1);
    assert.equal(trace.snapshot().incidents[0].event.rows, 10);
});
test('incident limits are explicit and snapshots never reread native identities', () => {
    let reads = 0, time = 0;
    const trace = createLifecycleDiagnostics({ now: () => ++time, readIdentity: row => { reads++; return { rowKey: row.key, pageKey: row.key }; } });
    for (let i = 0; i < 6; i++) trace.population(new Set([{ key: String(i) }]), 13);
    const before = reads, facts = trace.snapshot();
    assert.equal(reads, before); assert.equal(facts.incidents.length, 3); assert.equal(facts.droppedIncidents, 2);
    assert.ok(facts.capturedAt > facts.recent.at(-1).at);
});
