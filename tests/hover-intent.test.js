import test from 'node:test';
import assert from 'node:assert/strict';
import { createHover } from '../src/hover/hover.js';
import { createHoverTiming } from '../src/hover/timing.js';
import { createScheduler } from './helpers/scheduler.js';
import { createDocument, Element } from './helpers/dom.js';

function timingFixture(extra={}) {
    const scheduler=createScheduler(),document=createDocument();let token=1;
    const timing=createHoverTiming({...scheduler,document,sessionScope:{get token(){return token;}},
        isRouteSessionActive:value=>value===token,probeLimits:{delayMs:900,routeReplays:48,roots:6},...extra});
    return {timing,scheduler,document,retire:()=>{token++;}};
}
test('private timing owner preserves pending stalls across phase changes without layout reads', async()=>{
    const e=timingFixture();e.timing.start('intent');await e.scheduler.advance(130);e.timing.start('preparation');
    assert.equal(e.scheduler.frames.size,1);await e.scheduler.frame(0);
    const facts=e.timing.diagnostics().hoverFrames;
    assert.equal(facts.mixedPhaseSamples,1);assert.equal(facts.maxGapMs,130);assert.equal(facts.gapsOver100ms,1);
    e.timing.stop('done');assert.equal(e.scheduler.frames.size,0);
});
test('timing phase deadlines include the last delayed callback and then release the one frame', async()=>{
    for(const [phase,deadline] of Object.entries({intent:600,preparation:6000,replay:2000,scroll:1000})){
        const e=timingFixture();e.timing.start(phase);await e.scheduler.frame(deadline+40);
        const facts=e.timing.diagnostics().hoverFrames;
        assert.equal(facts.callbacks,1);assert.equal(facts.maxGapMs,deadline+40);assert.equal(facts.stopReason,'window-complete');
        assert.equal(e.scheduler.frames.size,0);
    }
});
test('high-refresh windows stop at 1800 frames and the route exhausts at 12000 without restart', async()=>{
    const e=timingFixture();
    for(let window=0;window<7;window++){
        e.timing.start('preparation');for(let frame=0;frame<1800;frame++)await e.scheduler.frame(1);
        assert.equal(e.scheduler.frames.size,0);
    }
    const facts=e.timing.diagnostics().hoverFrames;assert.equal(facts.callbacks,12000);assert.equal(facts.stopReason,'route-frame-limit');
    e.timing.start('intent');assert.equal(e.scheduler.frames.size,0);
});
test('retired timing callbacks cannot mutate a reset diagnostic owner or inspect a later route', async()=>{
    const e=timingFixture();e.timing.start('intent');const old=[...e.scheduler.frames.values()][0];
    e.timing.reset();e.timing.start('replay');old();assert.equal(e.timing.diagnostics().hoverFrames.callbacks,0);
    e.retire();await e.scheduler.frame();assert.equal(e.scheduler.frames.size,0);
    assert.equal(e.timing.diagnostics().hoverFrames.stopReason,'owner-replaced');
});
test('hidden and unsupported timing APIs retire resources and disclose only bounded scalar outcomes', async()=>{
    const hidden=timingFixture();hidden.timing.start('intent');hidden.document.visibilityState='hidden';await hidden.scheduler.frame();
    assert.equal(hidden.timing.diagnostics().hoverFrames.stopReason,'hidden');assert.equal(hidden.scheduler.frames.size,0);
    for(const requestAnimationFrame of [undefined,()=>{throw new Error('private diagnostic detail');}]){
        const e=timingFixture({requestAnimationFrame});e.timing.start('intent');
        assert.ok(['unsupported','api-failed'].includes(e.timing.diagnostics().hoverFrames.stopReason));
        assert.ok(!JSON.stringify(e.timing.diagnostics()).includes('private diagnostic detail'));
    }
});

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

test('public preparation interruptions keep the fixed reason vocabulary and 48-log route budget', async () => {
    const logs=[], pending=[];
    const e=environment({prepare:()=>new Promise(resolve=>pending.push(resolve)),log:(name,detail)=>{
        if(name==='Hover preparation interrupted')logs.push(detail);
    }});
    for(let i=0;i<60;i++){
        e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);
        e.hover.cancel(i===0?'private unknown reason':'scroll');e.hover.cancel('resize');
        pending.shift()?.(null);await e.scheduler.flush();
    }
    const counters=e.hover.diagnostics().hoverScroll;
    assert.equal(counters.preparationInterruptions,60);assert.equal(counters.preparationCancelledOther,1);
    assert.equal(counters.preparationCancelledScroll,59);assert.equal(counters.preparationCancelledResize,0);
    assert.equal(counters.interruptionLogs,48);assert.equal(counters.interruptionLogsSkipped,12);
    assert.equal(logs.length,48);assert.equal(logs[0].reason,'other');
    assert.ok(!JSON.stringify(logs).includes('private unknown reason'));
    const scalar=value=>value===null||['number','string','boolean'].includes(typeof value)||
        (typeof value==='object'&&Object.values(value).every(scalar));
    assert.ok(logs.every(scalar));e.hover.dispose();assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
});

test('failed replay recovers once in the same intent and permanent failure never starts a retry loop', async () => {
    for(const recover of [true,false]){
        let opens=0,preparations=0;
        const popup={release(){},invalidate(){},open:async()=>++opens===2&&recover};
        const e=environment({createPopup:()=>popup,prepare:async(item,card)=>{preparations++;return {source:{},card,page:0};}});
        e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);
        assert.equal(opens,1);await e.scheduler.advance(180);assert.equal(opens,2);assert.equal(preparations,2);
        await e.scheduler.advance(1000);assert.equal(opens,2);assert.equal(e.node.getAttribute('data-tm-preparing'),null);
        e.hover.dispose();assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
    }
});

test('leave, scroll, resize, route and target loss prevent the one pending hover recovery', async () => {
    for(const reason of ['leave','scroll','resize','route','target']){
        let opens=0;
        const e=environment({createPopup:()=>({release(){},invalidate(){},open:async()=>{opens++;return false;}}),
            prepare:async(item,card)=>({source:{},card,page:0})});
        e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);assert.equal(opens,1);
        if(reason==='target')e.node.hovered=false;else e.hover.cancel(reason);
        await e.scheduler.advance(180);assert.equal(opens,1,reason);e.hover.dispose();assert.equal(e.scheduler.timers.size,0);
    }
});

test('leaving preparation permits reentry and older completion cannot clear the newer marker', async () => {
    const pending=[];
    const e=environment({prepare:()=>new Promise(resolve=>pending.push(resolve))});
    e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);
    e.hover.cancel('leave');e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);
    assert.equal(pending.length,2);const token=e.node.getAttribute('data-tm-hover-token');
    pending[0](null);await e.scheduler.flush();assert.equal(e.node.getAttribute('data-tm-preparing'),'true');
    assert.equal(e.node.getAttribute('data-tm-hover-token'),token);
    e.hover.dispose();pending[1](null);await e.scheduler.flush();assert.equal(e.node.getAttribute('data-tm-preparing'),null);
});

test('failed interruption diagnostics still retire the pending preparation and restore its markers', async () => {
    let resolve;
    const e=environment({prepare:()=>new Promise(done=>{resolve=done;}),log:name=>{
        if(name==='Hover preparation interrupted')throw new Error('logger denied');
    }});
    e.grid.dispatchEvent({type:'pointerover',target:e.node});await e.scheduler.advance(120);
    assert.doesNotThrow(()=>e.hover.cancel('scroll'));resolve(null);await e.scheduler.flush();
    assert.equal(e.hover.diagnostics().hoverInteraction.diagnosticFailures,1);
    assert.equal(e.node.getAttribute('data-tm-preparing'),null);e.hover.dispose();assert.equal(e.scheduler.timers.size,0);
});

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
