import test from 'node:test';
import assert from 'node:assert/strict';
import { createHover } from '../src/hover/hover.js';
import { createScheduler } from './helpers/scheduler.js';
import { createDocument, Element } from './helpers/dom.js';

function environment(overrides = {}) {
    const scheduler = createScheduler(), document = createDocument();
    const grid = document.body.appendChild(new Element());
    const node = grid.appendChild(new Element()); node.hovered = true;
    const item = { videoId: '1' }; node.__tmMyListItem = item;
    let card = Object.freeze({ node, item }), resolutions = 0, sessionToken = 1;
    node.matches = selector => selector === ':hover' && node.hovered;
    const popup = { release() {}, invalidate() {}, retainPreview: () => false, pointerMoved: () => false, finishProbe() {}, previewPointerOut() {}, replayFacts: () => null };
    const hover = createHover({ ...scheduler, document, Element, readSessionToken: () => sessionToken, isSessionCurrent: token => token === sessionToken,
        readEnvironment: () => ({ grid }), grid: { getCard: () => card, isCardCurrent: value => value === card,
            isCardVisible: value => value === node && node.getAttribute('data-tm-type-hidden') !== 'true' },
        createPopup: () => popup, resolveReady: () => { resolutions++; return null; }, prepare: async () => null,
        log() {}, warn() {}, tLog: key => key, describeItem: value => value, isCancelledError: () => false,
        assertSession() {}, sleep: async () => {}, whenStable: () => null, ...overrides });
    hover.install(grid); hover.start();
    return { hover, scheduler, node, item, grid, document, get resolutions() { return resolutions; },
        replaceSession() { sessionToken++; }, retire() { const old = card; card = Object.freeze({ node, item }); hover.retire(old, { reason: 'source' }); } };
}

test('hover owns dwell and scroll requires new physical intent', async () => {
    const e = environment();
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    await e.scheduler.advance(119); assert.equal(e.resolutions, 0);
    e.document.dispatchEvent({ type: 'wheel' });
    await e.scheduler.advance(200); assert.equal(e.resolutions, 0);
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    await e.scheduler.advance(200); assert.equal(e.resolutions, 0);
    e.document.dispatchEvent({ type: 'pointermove', target: e.node, isTrusted: true, clientX: 10, clientY: 20 });
    await e.scheduler.advance(120); assert.ok(e.resolutions > 0);
    e.hover.dispose(); assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
});

test('matching title and node cannot rescue a retired card during dwell', async () => {
    const e = environment();
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node }); e.retire();
    await e.scheduler.advance(180); assert.equal(e.resolutions, 0);
    e.hover.dispose();
});

test('controls and hidden cards cannot start preparation', async () => {
    for (const hidden of [true, false]) {
        const e = environment(), control = e.node.appendChild(new Element());
        control.setAttribute('data-tm-viewing-actions', 'true');
        if (hidden) e.node.setAttribute('data-tm-type-hidden', 'true');
        e.grid.dispatchEvent({ type: 'pointerover', target: hidden ? e.node : control });
        await e.scheduler.advance(200); assert.equal(e.resolutions, 0);
        e.hover.dispose();
    }
});

test('a retired route cannot adopt the same title after responsive stability', async () => {
    let resolve; const stable = new Promise(done => { resolve = done; });
    const e = environment({ whenStable: () => stable });
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node }); await e.scheduler.advance(120);
    e.replaceSession(); resolve(); await e.scheduler.flush();
    assert.equal(e.resolutions, 0); e.hover.dispose();
});

test('explicit cancellation retires an intent still waiting for responsive stability', async () => {
    let resolve; const stable = new Promise(done => { resolve = done; });
    const e = environment({ whenStable: () => stable });
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node }); await e.scheduler.advance(120);
    e.hover.cancel('resize'); resolve(); await e.scheduler.flush();
    assert.equal(e.resolutions, 0); e.hover.dispose();
});

test('unchanged coordinates and synthetic events cannot rearm scroll intent', async () => {
    const e = environment();
    e.document.dispatchEvent({ type: 'pointermove', target: e.node, isTrusted: true, clientX: 20, clientY: 30 });
    e.document.dispatchEvent({ type: 'scroll' }); await e.scheduler.advance(200);
    for (const event of [{isTrusted:true,clientX:20,clientY:30},{isTrusted:false,clientX:21,clientY:30}]) {
        e.document.dispatchEvent({ type: 'pointermove', target: e.node, ...event });
    }
    await e.scheduler.advance(200); assert.equal(e.resolutions, 0);
    assert.equal(e.hover.diagnostics().hoverScrollState.needsPointerMove, true); e.hover.dispose();
});

test('disposed dwell and timing callbacks cannot affect the next route owner', async () => {
    const e = environment(); e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    const dwell = [...e.scheduler.timers.values()][0].callback, frame = [...e.scheduler.frames.values()][0];
    e.hover.dispose(); e.replaceSession(); e.hover.resetDiagnostics(); e.hover.install(e.grid); e.hover.start();
    dwell(); frame(); await e.scheduler.flush();
    assert.equal(e.resolutions, 0); assert.equal(e.hover.diagnostics().hoverFrames.callbacks, 0);
    assert.equal(e.document.listenerCount('pointermove'), 1); e.hover.dispose();
    assert.equal(e.document.listenerCount('pointermove'), 0); assert.equal(e.grid.listenerCount('pointerover'), 0);
});

test('an obsolete dwell callback cannot clear a newly queued timer on the same card', async () => {
    const e = environment(); e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    const obsolete = [...e.scheduler.timers.values()][0].callback;
    e.hover.dispose(); e.hover.install(e.grid); e.hover.start();
    e.grid.dispatchEvent({ type: 'pointerover', target: e.node }); const timer = e.node.__tmHoverActivationTimer;
    obsolete(); assert.equal(e.node.__tmHoverActivationTimer, timer); assert.equal(e.resolutions, 0);
    await e.scheduler.advance(120); assert.ok(e.resolutions > 0); e.hover.dispose();
});

test('timing windows include late gaps and stop on visibility without polling', async () => {
    const e = environment(); e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    await e.scheduler.frame(700);
    assert.equal(e.hover.diagnostics().hoverFrames.maxGapMs, 700);
    assert.equal(e.hover.diagnostics().hoverFrames.stopReason, 'window-complete');
    e.document.visibilityState = 'hidden'; e.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(e.scheduler.frames.size, 0); e.hover.dispose();
});

test('counter and pointer observations are copies rather than mutation authority', () => {
    const e = environment(); const snapshot = e.hover.diagnostics(); snapshot.hoverScroll.wheelEvents = 123;
    assert.equal(e.hover.diagnostics().hoverScroll.wheelEvents, 0);
    assert.ok(Object.isFrozen(e.hover.intent())); e.hover.dispose();
});

test('retired delegated and document listeners cannot start a new route attempt', async () => {
    const e = environment(), over = [...e.grid.listeners.get('pointerover')][0], move = [...e.document.listeners.get('pointermove')][0];
    e.hover.dispose(); e.hover.install(e.grid); e.hover.start();
    over({ type: 'pointerover', target: e.node });
    move({ type: 'pointermove', target: e.node, isTrusted: true, clientX: 21, clientY: 30 });
    await e.scheduler.advance(120); assert.equal(e.resolutions, 0);
    e.hover.dispose();
});

test('disposal cancels the one bounded retry wait rather than leaving a route timer', async () => {
    const e = environment(); e.grid.dispatchEvent({ type: 'pointerover', target: e.node });
    await e.scheduler.advance(120); assert.equal(e.scheduler.timers.size, 1);
    e.hover.dispose(); await e.scheduler.flush();
    assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
    assert.equal(e.resolutions, 1);
});
