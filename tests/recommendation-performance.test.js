import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationPerformance } from '../src/recommendations/performance.js';
import { summarizeSignals } from '../src/diagnostics/signals.js';
import { createBrowser } from './helpers/browser.js';

test('slow work and delayed callbacks retain bounded chronology, phase timings and exact counter deltas', async () => {
    const b = createBrowser(); let scans = 0;
    const timing = createRecommendationPerformance({ environment: b.context, now: b.scheduler.performance.now,
        admitted: () => true, readWork: () => ({ scans }) });
    assert.equal(b.scheduler.frames.size, 0);
    for (let index = 0; index < 9; index++) {
        const task = timing.begin('scan'); scans++;
        await b.scheduler.advance(20); task.phase('validation');
        await b.scheduler.advance(40); task.phase('paint'); task.finish({ roots: 1 });
        timing.sample('scroll'); // Must not replace the outstanding delay baseline.
        await b.scheduler.frame(50); await b.scheduler.frame(16);
    }
    const snapshot = timing.snapshot();
    assert.equal(snapshot.tasks, 9); assert.equal(snapshot.slowTasks, 9);
    assert.equal(snapshot.recentTasks.length, 6); assert.equal(snapshot.droppedTasks, 3);
    assert.deepEqual(snapshot.worstTask.phases, { validation: 20, paint: 40 });
    assert.equal(snapshot.callbacks, 18); assert.equal(snapshot.over50, 9); assert.equal(snapshot.over100, 9);
    assert.equal(snapshot.recentFrames.length, 6); assert.equal(snapshot.droppedFrames, 3);
    assert.equal(snapshot.worstFrame.waitMs, 110); assert.equal(snapshot.worstFrame.reason, 'mixed');
    assert.deepEqual(snapshot.worstFrame.work, { scans: 1 });
    assert.deepEqual(summarizeSignals({ workTiming: snapshot }).workTiming, snapshot);
    snapshot.recentTasks[0].phases.paint = -1;
    assert.equal(timing.snapshot().recentTasks[0].phases.paint, 40);
    assert.equal(b.scheduler.frames.size, 0, 'two callbacks finish without continuing in the background');
    timing.reset(); assert.equal(timing.snapshot().tasks, 0);
});

test('hidden/profile/route retirement rejects late callbacks and does not carry hidden-tab delays into a new probe', async () => {
    const b = createBrowser(); let admitted = true;
    const timing = createRecommendationPerformance({ environment: b.context, now: b.scheduler.performance.now,
        admitted: () => admitted, readWork: () => ({ scans: 0 }) });
    timing.sample('scroll'); const old = [...b.scheduler.frames.values()][0], task = timing.begin('scan');
    b.document.visibilityState = 'hidden'; b.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(b.scheduler.frames.size, 0); await b.scheduler.advance(10000); old();
    assert.equal(timing.snapshot().callbacks, 0);
    b.document.visibilityState = 'visible'; timing.sample('scroll');
    await b.scheduler.frame(16); assert.equal(timing.snapshot().over50, 0);
    admitted = false; await b.scheduler.frame(100); assert.equal(timing.snapshot().callbacks, 1);
    timing.reset(); task.finish(); old();
    assert.equal(timing.snapshot().tasks, 0); assert.equal(timing.snapshot().callbacks, 0);
    assert.equal(b.scheduler.frames.size, 0);
    admitted = true; timing.sample('scan'); timing.reset();
    assert.equal(b.scheduler.frames.size, 0);
    const unsupported = createRecommendationPerformance({ environment: { document: b.document }, now: () => 1,
        admitted: () => true, readWork: () => ({}) });
    unsupported.sample('scroll'); assert.equal(unsupported.snapshot().supported, false);
    b.context.requestAnimationFrame = () => { throw Error('unavailable'); };
    const broken = createRecommendationPerformance({ environment: b.context, now: () => 1,
        admitted: () => true, readWork: () => ({}) });
    broken.begin('scan').finish();
    assert.equal(broken.snapshot().tasks, 1); assert.equal(broken.snapshot().failures, 1);
    broken.reset();
});

test('a failed callback continuation retires its probe and later activity can sample again', async () => {
    const b = createBrowser();
    const request = b.context.requestAnimationFrame;
    let scheduled = 0;
    b.context.requestAnimationFrame = callback => {
        if (++scheduled === 2) throw Error('continuation unavailable');
        return request(callback);
    };
    const timing = createRecommendationPerformance({ environment: b.context, now: b.scheduler.performance.now,
        admitted: () => true, readWork: () => ({ scans: 0 }) });
    timing.sample('click');
    await b.scheduler.frame(60);
    assert.equal(timing.snapshot().callbacks, 1);
    assert.equal(timing.snapshot().failures, 1);
    assert.equal(timing.snapshot().pending, false);
    assert.equal(b.scheduler.frames.size, 0);
    timing.sample('scroll');
    await b.scheduler.frame(16);
    await b.scheduler.frame(16);
    assert.equal(timing.snapshot().callbacks, 3);
    assert.equal(timing.snapshot().failures, 1);
    assert.equal(timing.snapshot().pending, false);
    timing.reset();
});
