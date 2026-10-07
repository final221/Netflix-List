import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponsive } from '../src/app/responsive.js';
import { createScheduler } from './helpers/scheduler.js';
import { createList } from '../src/list/list.js';
import { createHover } from '../src/hover/hover.js';
import { createDocument, Element, EventTarget } from './helpers/dom.js';

function transactionFixture() {
    const scheduler = createScheduler(), observers = [];
    const node = () => ({ isConnected: true });
    let state = { section: node(), scroller: node(), track: node(), grid: node(), items: [],
        layout: { columns: 6, gridWidth: 100, cardWidth: 10, gridLeft: 0, scrollerWidth: 100,scrollerHeight:60 },
        resizeViewportSignature: '', status: node() };
    let layout = { ...state.layout }, pages = 4, hoverCancels = 0, remaps = 0;
    state.grid.__tmAppliedGeometry = { width: 100, left: 0, columns: 6 };
    const list = createList({}).createMutations({ now: () => scheduler.performance.now(), readSession: () => 1,
        isSessionActive: () => true, setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout,
        readParent: () => state });
    const window = Object.assign(new EventTarget(),{ innerWidth: 100, innerHeight: 100,devicePixelRatio:1,
        visualViewport:Object.assign(new EventTarget(),{width:100,height:100,scale:1,offsetLeft:0,offsetTop:0}) });
    const carousel = { sample: fn => fn(), assertObservation() {}, isObservationCurrent: () => true };
    let hidden=false,parked=false,needsRemapping=false,geometryLeft=0;
    const observed = () => ({ layout, mode: 'indicator', position: { pages: pages }, presentation: { hidden, parked },needsRemapping });
    const owner = createResponsive({
        acceptLayoutChange: (state, layout) => { state.layout = layout; },
        acceptInitialPage: (state, page) => { state.initialPage = page; },
        acceptViewportSignature: (state, signature) => { state.resizeViewportSignature = signature; }, ...scheduler, window, ResizeObserver: class { constructor(fn) { observers.push(fn); } observe() {} disconnect() {} },
        nativeCarousel: carousel, readState: () => state, readSessionToken: () => 1, isRouteSessionActive: () => true,
        assertRouteSession() {}, createRouteSessionCancelledError: () => Object.assign(new Error('retired'), { code: 'CANCELLED' }),
        isRouteSessionCancelledError: error => error.code === 'CANCELLED',
        nativeSourceObservation: observed, nativeLayoutObservation: observed, nativeSourceDiagnostics: () => ({}),
        listMutations: list, ensureLiveNativeBinding: () => state, hover: { cancel: () => { hoverCancels++; }, hasInteraction: () => true, count() {} },
        gridView: { setRefreshing(grid, value) { grid.refreshing = value; } },
        currentGridGeometry: () => ({ width: layout.gridWidth, left: geometryLeft, columns: layout.columns }),
        applyGridGeometry: () => ({}), layoutFrameStatus() {}, updateStatus() {}, formatHeaderParts: () => '',
        measureNativeCarouselGap: () => 0, layoutSummary: value => value, collectRuntimeSnapshot: () => ({}),
        realignActiveSource() {}, sleep: ms => new Promise(resolve => scheduler.setTimeout(resolve, ms)),
        pageForItem: () => 0, setPageForItem() {}, itemKey: item => item.videoId, copyItemAttributes() {},
        readOriginalVisibility: () => false,
        log() {}, warn: (_message, detail) => assert.fail(detail.error), trace() {}, tLog: value => value, tUi: value => value });
    // Native refresh work calls the carousel directly; it has no responsive wait collaborator.
    carousel.refreshMapping = () => { remaps++; return {}; };
    owner.acceptLayout(state.layout);
    return { owner, scheduler, list, observers,window,carousel,layout,value(name,next){layout[name]=next;},
        parked(){hidden=true;parked=true;layout.scrollerHeight=1;},mapping(){needsRemapping=true;},clip(){geometryLeft=1;},
        get state() { return state; }, get cancels() { return hoverCancels; },
        get remaps() { return remaps; }, change: () => { layout = { ...layout, gridWidth: 110 }; },
        replace: () => { state = { ...state, grid: node(), section: node(), scroller: node(), track: node() }; } };
}

test('public checks coalesce, preserve unchanged hover and expose stability only during a real transaction', async () => {
    const f = transactionFixture();
    f.owner.requestCheck(); f.owner.requestCheck();
    assert.equal(f.scheduler.timers.size, 1);
    await f.scheduler.advance(140);
    assert.equal(f.owner.diagnostics().resize.unchanged, 1);
    assert.equal(f.cancels, 0); assert.equal(f.owner.whenStable(), null);
    f.change(); f.owner.requestCheck(); await f.scheduler.advance(140);
    const stable = f.owner.whenStable(); assert.ok(stable instanceof Promise);
    assert.equal(f.list.deferralDiagnostics().active.length, 1);
    for (let index = 0; index < 3; index++) await f.scheduler.advance(80);
    await stable;
    assert.equal(f.owner.whenStable(), null); assert.equal(f.cancels, 1);
    assert.equal(f.list.deferralDiagnostics().active.length, 0);
    assert.equal(f.state.grid.refreshing, false); assert.equal(f.remaps, 0);
});

test('retired transaction completion cannot clear a newer promise, marker or ticket', async () => {
    const f = transactionFixture(); f.change(); f.owner.requestCheck(); await f.scheduler.advance(140);
    const old = f.owner.whenStable();
    f.owner.dispose(); f.replace(); f.owner.acceptLayout(f.state.layout);
    f.change(); f.owner.requestCheck(); await f.scheduler.advance(140);
    const current = f.owner.whenStable(); assert.ok(current);
    await old;
    assert.equal(f.state.grid.refreshing, true);
    assert.equal(f.list.deferralDiagnostics().active.length, 1);
    assert.equal(f.owner.diagnostics().responsiveRefreshing, true);
    for (let index = 0; index < 3; index++) await f.scheduler.advance(80);
    await current;
    assert.equal(f.list.deferralDiagnostics().active.length, 0);
});

test('retired coalesced check cannot consume a newer scheduled check', async () => {
    const f = transactionFixture(); f.owner.requestCheck();
    const stale = [...f.scheduler.timers.values()][0].callback;
    f.owner.dispose(); f.replace(); f.owner.acceptLayout(f.state.layout); f.owner.requestCheck();
    stale(); assert.equal(f.scheduler.timers.size, 1);
    await f.scheduler.advance(140); assert.equal(f.owner.diagnostics().resize.checks, 1);
});

test('hover waits for the composed responsive transaction and revalidates pointer intent', async () => {
    for (const leave of [false, true]) {
        const f = transactionFixture(), document = createDocument();
        const grid = document.body.appendChild(new Element()), node = grid.appendChild(new Element());
        const item = { videoId: '1' }, card = Object.freeze({ node, item });
        node.__tmMyListItem = item; node.matches = selector => selector === ':hover';
        f.state.grid = grid; grid.__tmAppliedGeometry = { width: 100, left: 0, columns: 6 };
        let resolutions = 0;
        const hover = createHover({ ...f.scheduler, document, Element, readSessionToken: () => 1, isSessionCurrent: () => true,
            readEnvironment: () => ({ grid }), grid: { getCard: () => card, isCardCurrent: value => value === card,
                isCardVisible: () => true }, createPopup: () => ({ release() {}, invalidate() {}, finishProbe() {},
                retainPreview: () => false, replayFacts: () => null }),
            whenStable: () => f.owner.whenStable(), resolveReady: () => { resolutions++; return null; },
            prepare: async () => null, sleep: async () => {}, assertSession() {}, isCancelledError: () => false,
            log() {}, warn() {}, tLog: value => value, describeItem: value => value });
        hover.install(grid); hover.start();
        f.owner.acceptLayout(f.state.layout); f.change(); f.owner.requestCheck(); await f.scheduler.advance(140);
        grid.dispatchEvent({ type: 'pointerover', target: node }); await f.scheduler.advance(120);
        assert.equal(resolutions, 0);
        if (leave) grid.dispatchEvent({ type: 'pointerout', target: node });
        for (let index = 0; index < 3; index++) await f.scheduler.advance(80);
        assert.equal(resolutions > 0, !leave);
        hover.dispose(); f.owner.dispose();
    }
});

function fixture() {
    const callbacks = [], listeners = new Map();
    const window = { innerWidth: 100, innerHeight: 100, addEventListener: (key, fn) => listeners.set(key, fn),
        removeEventListener: key => listeners.delete(key) };
    let current = { grid: { isConnected: true }, section: {}, resizeViewportSignature: 'old' };
    const owner = createResponsive({
        acceptLayoutChange: (state, layout) => { state.layout = layout; },
        acceptInitialPage: (state, page) => { state.initialPage = page; },
        acceptViewportSignature: (state, signature) => { state.resizeViewportSignature = signature; }, window, ResizeObserver: class { constructor(fn) { callbacks.push(fn); } observe() {} disconnect() {} },
        readState: () => current, readSessionToken: () => 1, isRouteSessionActive: () => true,
        setTimeout: fn => { callbacks.push(fn); return callbacks.length; }, clearTimeout: () => {},
        hover: { cancel() {} }, log() {}, tLog: value => value });
    return { owner, callbacks, listeners, replace: () => { current = { ...current }; } };
}

test('responsive activation and disposal own one viewport listener set', () => {
    const f = fixture();
    f.owner.start(); f.owner.start();
    assert.equal(f.listeners.size, 1);
    f.owner.dispose(); f.owner.dispose();
    assert.equal(f.listeners.size, 0);
    assert.equal(f.owner.whenStable(), null);
});

test('retired observer delivery cannot schedule against a replacement source', () => {
    const f = fixture();
    f.owner.observe(); const delivery = f.callbacks[0];
    f.replace(); delivery();
    assert.equal(f.callbacks.length, 1);
});

test('retired viewport delivery cannot change replacement counters', () => {
    const f = fixture(); f.owner.start(); const delivery = f.listeners.get('resize');
    f.owner.dispose(); f.owner.start(); delivery();
    assert.equal(f.owner.diagnostics().resize.events, 0);
});

test('parked height observations preserve interaction only under every source, viewport, mapping and clipping guard',async()=>{
    const mutations=[null,f=>{f.window.innerWidth++;},f=>{f.window.innerHeight++;},f=>{f.window.devicePixelRatio++;},
        f=>{f.window.visualViewport.scale++;},f=>{f.window.visualViewport.offsetLeft++;},f=>f.mapping(),f=>f.clip(),
        f=>f.value('columns',7),f=>f.value('scrollerWidth',101),f=>f.value('gridLeft',1)];
    for(const mutate of mutations){
        const f=transactionFixture();f.parked();mutate?.(f);f.owner.requestCheck(0,'ResizeObserver');await f.scheduler.advance();
        if(!mutate){
            assert.equal(f.cancels,0);assert.equal(f.owner.diagnostics().resize.parkedHeightChangesIgnored,1);
            f.owner.requestCheck(0,'ResizeObserver');await f.scheduler.advance();
            assert.equal(f.owner.diagnostics().resize.parkedHeightChangesIgnored,1);
            assert.equal(f.state.layout.scrollerHeight,1);
        }else{
            assert.equal(f.owner.diagnostics().resize.parkedHeightChangesIgnored,0);
            assert.ok(f.cancels>0);
        }
        f.owner.dispose();await f.scheduler.advance(160);assert.equal(f.list.deferralDiagnostics().active.length,0);
    }
});
test('duplicate viewport events coalesce while real zoom, dimensions and offsets cancel immediately',async()=>{
    const f=transactionFixture();f.owner.start();
    f.window.dispatchEvent({type:'resize'});f.window.visualViewport.dispatchEvent({type:'resize'});
    assert.equal(f.cancels,0);assert.equal(f.scheduler.timers.size,1);await f.scheduler.advance(140);
    assert.equal(f.owner.diagnostics().resize.checks,1);
    for(const [object,key] of [[f.window,'innerWidth'],[f.window,'innerHeight'],[f.window,'devicePixelRatio'],
        [f.window.visualViewport,'scale'],[f.window.visualViewport,'offsetTop']]){
        const before=f.cancels;object[key]++;f.window.dispatchEvent({type:'resize'});assert.equal(f.cancels,before+1);
    }
    f.owner.dispose();assert.equal(f.scheduler.timers.size,0);
});
