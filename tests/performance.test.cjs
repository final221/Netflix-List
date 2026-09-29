'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped functions without executing Netflix startup or using a
// browser. DOM and scheduling mocks model the relevant lifecycle boundaries.
const source = fs.readFileSync(path.join(__dirname, '..', 'Legacy My List for Netflix.user.js'), 'utf8');
function declaration(name) {
    const match = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert.ok(match, `Missing userscript function ${name}`);
    const rest = source.slice(match.index);
    const next = /\n    (?:(?:async )?function\s|(?:const|let)\s)/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

class Element {
    constructor(id = '', parent = null) {
        this.nodeType = 1;
        this.id = id;
        this.parentElement = parent;
        this.isConnected = true;
        this.hovered = true;
        this.attributes = new Map();
    }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    removeAttribute(key) { this.attributes.delete(key); }
    matches(selector) { return selector === ':hover' && this.hovered; }
    contains(node) {
        for (let current = node; current; current = current.parentElement) {
            if (current === this) return true;
        }
        return false;
    }
    closest(selector) {
        const ids = selector.split(',').map(part => part.trim().slice(1));
        for (let current = this; current; current = current.parentElement) {
            if (ids.includes(current.id)) return current;
        }
        return null;
    }
}

function environment(names, overrides = {}) {
    let now = 0;
    let id = 0;
    const timers = new Map();
    const frames = new Map();
    const c = vm.createContext({
        Element, Set, Map, Promise,
        performance: { now: () => now },
        setTimeout(callback, delay) { const key = ++id; timers.set(key, { callback, due: now + delay }); return key; },
        clearTimeout(key) { timers.delete(key); },
        requestAnimationFrame(callback) { const key = ++id; frames.set(key, callback); return key; },
        cancelAnimationFrame(key) { frames.delete(key); },
        HOVER_ACTIVATION_DELAY_MS: 120, HOVER_SCROLL_QUIET_MS: 180, CANCELLED_MOVE_POLL_MS: 80,
        HOVER_SOURCE_TIMEOUT_MS: 500, HOVER_SOURCE_INTERVAL_MS: 10, PAGE_STABLE_TIMEOUT_MS: 2000,
        hoverToken: 1, hoverSequence: 0, pendingGridHoverClone: null,
        lastTargetScrollAt: -Infinity, hoverNeedsPointerMove: false, lastPointerX: -1, lastPointerY: -1,
        activeClone: null, activeVideoId: null, activePage: null,
        orderMismatchDialogOpen: false, orderMismatchReinitializing: false, responsiveRefreshPromise: null,
        routeSessionToken: 1, targetSessionActive: true,
        isTargetPage: () => true, isRouteSessionActive: token => token === 1,
        assertRouteSession: () => {}, isRouteSessionCancelledError: () => false,
        log: () => {}, warn: () => {}, tLog: value => value, itemSummary: item => item,
        ...overrides
    });
    for (const name of names) vm.runInContext(declaration(name), c);
    async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
    return {
        c, timers, frames, flush,
        async advance(ms) {
            now += ms;
            const due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
            for (const [key, timer] of due) {
                if (timers.delete(key)) timer.callback();
            }
            await flush();
        },
        async frame() {
            now += 16;
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(now);
            await flush();
        }
    };
}

const hoverFunctions = [
    'hoverPreparationCancelled', 'gridCloneFromPointerEvent', 'gridHoverSuppressed',
    'gridHoverTargetActive', 'cancelPendingGridHover', 'handleGridClonePointerOver',
    'handleGridClonePointerLeave', 'handleTargetPointerMove', 'handleTargetScroll'
];
function hoverEnvironment(extraNames = [], overrides = {}) {
    const section = new Element('section');
    const grid = new Element('grid', section);
    const clone = new Element('card', grid);
    clone.__tmMyListItem = { videoId: '123', page: 0 };
    const activations = [];
    let invalidations = 0;
    const e = environment([...hoverFunctions, ...extraNames], {
        sourceState: { section, grid },
        activateClone: (...args) => activations.push(args),
        selectedPage: () => { throw new Error('Native page read before hover intent'); },
        clearSourceAlignment: () => {}, invalidateGridReact: () => invalidations++,
        ...overrides
    });
    return { ...e, section, grid, clone, activations, invalidations: () => invalidations };
}
function pointer(clone, overrides = {}) {
    return { type: 'pointerover', target: clone, relatedTarget: null, clientX: 20, clientY: 30, isTrusted: true, ...overrides };
}

test('ready and fresh cards both require hover intent without reading native state on entry', async () => {
    for (const ready of [false, true]) {
        const e = hoverEnvironment();
        if (ready) e.clone.setAttribute('data-tm-hover-ready', 'true');
        e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
        await e.advance(119);
        assert.equal(e.activations.length, 0);
        await e.advance(1);
        assert.equal(e.activations.length, 1);
    }
});

test('intentional hover still reuses an already-mounted native card after the dwell', async () => {
    let alignments = 0, replays = 0;
    const sourceSlot = new Element();
    const e = hoverEnvironment(['activateClone'], {
        selectedPage: () => 0, findActiveSourceSlot: () => sourceSlot,
        alignSourceSlotToClone: () => { alignments++; return true; },
        slotDescriptor: () => ({}), scheduleNativeHoverReplay: () => replays++
    });
    e.clone.setAttribute('data-tm-hover-ready', 'true');
    e.clone.setAttribute('data-tm-backed-page', '0');
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    await e.advance(119);
    assert.equal(alignments, 0);
    await e.advance(1);
    assert.equal(alignments, 1);
    assert.equal(replays, 1);
    assert.equal(e.c.activeClone, e.clone);
});

test('short visits, lost hover, and superseded targets do not prepare obsolete cards', async () => {
    const e = hoverEnvironment();
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
    await e.advance(120);
    assert.equal(e.activations.length, 0);

    const next = new Element('next', e.grid);
    next.__tmMyListItem = { videoId: '456' };
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleGridClonePointerOver(pointer(next), next, next.__tmMyListItem);
    assert.equal(e.timers.size, 1);
    await e.advance(120);
    assert.equal(e.activations.length, 1);
    assert.equal(e.activations[0][1], next);

    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.clone.hovered = false;
    await e.advance(120);
    assert.equal(e.activations.length, 1);
});

test('scroll cancels pending hover and clears grafts once per burst; only later physical movement resumes intent', async () => {
    const e = hoverEnvironment();
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleTargetScroll();
    await e.advance(10);
    e.c.handleTargetScroll();
    assert.equal(e.invalidations(), 1);
    assert.equal(e.c.hoverToken, 2);
    await e.advance(200);
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleTargetPointerMove(pointer(e.clone, { isTrusted: false }));
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.hoverNeedsPointerMove, true);
    e.c.handleTargetPointerMove(pointer(e.clone, { clientX: 21, type: 'pointermove' }));
    assert.equal(e.c.hoverNeedsPointerMove, false);
    await e.advance(120);
    assert.equal(e.activations.length, 1);
});

test('leaving a preparing card removes its markers so re-entry can proceed', () => {
    const e = hoverEnvironment();
    e.clone.setAttribute('data-tm-preparing', 'true');
    e.clone.setAttribute('data-tm-hover-token', '1');
    e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
    assert.equal(e.clone.getAttribute('data-tm-preparing'), null);
    assert.equal(e.clone.getAttribute('data-tm-hover-token'), null);
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    assert.equal(e.timers.size, 1);
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('a hover waiting for responsive refresh revalidates its target after pointer leave', async () => {
    const refresh = deferred();
    const e = hoverEnvironment(['activateClone'], { responsiveRefreshPromise: refresh.promise });
    e.clone.__tmHoverActivationGeneration = 1;
    const activation = e.c.activateClone(e.clone.__tmMyListItem, e.clone, pointer(e.clone), 1);
    e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
    refresh.resolve();
    await activation;
    // selectedPage throws if obsolete work reaches source preparation.
    assert.equal(e.clone.getAttribute('data-tm-preparing'), null);
});

test('old async cleanup preserves a newer preparation marker on the same card', async () => {
    const preparation = deferred();
    const e = hoverEnvironment(['activateClone'], {
        selectedPage: () => 0, prepareMountedPage: () => preparation.promise
    });
    e.c.findGridClone = () => e.clone;
    e.clone.__tmHoverActivationGeneration = 1;
    const activation = e.c.activateClone(e.clone.__tmMyListItem, e.clone, pointer(e.clone), 1);
    assert.equal(e.clone.getAttribute('data-tm-hover-token'), '2');
    e.c.hoverToken = 3;
    e.clone.setAttribute('data-tm-hover-token', '3');
    preparation.resolve(null);
    await activation;
    assert.equal(e.clone.getAttribute('data-tm-hover-token'), '3');
    assert.equal(e.clone.getAttribute('data-tm-preparing'), 'true');
});

test('a scheduled native replay is suppressed if scrolling starts before its frame', async () => {
    const e = hoverEnvironment(['scheduleNativeHoverReplay']);
    e.c.activeClone = e.clone;
    e.c.activeVideoId = '123';
    e.c.scheduleNativeHoverReplay(new Element(), e.clone.__tmMyListItem, e.clone, pointer(e.clone), 0, 'test');
    e.c.handleTargetScroll();
    await e.frame();
    // No source query is implemented: stale replay must return before using it.
});

test('hover hydration stops before the next geometry read after cancellation', async () => {
    let reads = 0;
    const e = environment(['hoverPreparationCancelled', 'waitStableCurrentPage'], {
        currentPageSlots: () => { reads++; return []; }
    });
    const wait = e.c.waitStableCurrentPage({}, {}, { hoverToken: 1, sessionToken: 1 });
    e.c.hoverToken = 2;
    await e.frame();
    assert.equal((await wait).length, 0);
    assert.equal(reads, 0);
});

test('initialization stability waits remain independent of hover cancellation', async () => {
    const slots = [new Element()];
    const e = environment(['hoverPreparationCancelled', 'waitStableCurrentPage'], {
        currentPageSlots: () => slots, visibleSignature: () => 'same'
    });
    const wait = e.c.waitStableCurrentPage({}, {}, { sessionToken: 1 });
    e.c.hoverToken = 2;
    await e.frame();
    await e.frame();
    assert.equal(await wait, slots);
});

test('mounted-source polling stops after cancellation without a final binding or card scan', async () => {
    let bindings = 0, probes = 0;
    const e = environment(['hoverPreparationCancelled', 'sleep', 'waitForMountedSourceItem'], {
        sourceState: { track: new Element() },
        ensureLiveNativeBinding: () => bindings++,
        findMountedSourceSlot: () => { probes++; return null; }
    });
    const wait = e.c.waitForMountedSourceItem({}, 500, true, 1, 1);
    assert.equal(probes, 1);
    e.c.hoverToken = 2;
    await e.advance(10);
    assert.equal(await wait, null);
    assert.equal(bindings, 1);
    assert.equal(probes, 1);
});

test('cancelled expected-page and recovery retries stop before native binding work', async () => {
    const e = environment([
        'hoverPreparationCancelled', 'resolveExpectedPageSourceItem',
        'refreshStaleSourceOnPreferredPage', 'locateActiveSourceItem', 'prepareMountedPage'
    ], { ensureLiveNativeBinding: () => { throw new Error('Cancelled retry inspected native state'); } });
    e.c.hoverToken = 2;
    const item = { page: 0 };
    assert.equal((await e.c.resolveExpectedPageSourceItem(item, 0, 1, 1)).status, 'unknown');
    assert.equal(await e.c.refreshStaleSourceOnPreferredPage(item, 0, 1, 1), null);
    assert.equal(await e.c.locateActiveSourceItem(item, 0, 1, 1), null);
    assert.equal(await e.c.prepareMountedPage(0, item, null, 1, 1), null);
});

test('an obsolete clicked logical move uses coarse polling and still records native acknowledgement', async () => {
    let signature = 'before';
    const runtime = { signatureToPage: new Map() };
    const e = environment(['hoverPreparationCancelled', 'sleep', 'waitLogicalPageChange'], {
        PAGE_CHANGE_TIMEOUT_MS: 3000, getCarouselDomRuntime: () => runtime,
        currentPageSlots: () => [], visibleSignature: () => signature,
        registerLogicalPageSignature: (_section, _signature, page) => page
    });
    e.c.hoverToken = 2;
    const track = { style: { getPropertyValue: () => 'transform' } };
    const wait = e.c.waitLogicalPageChange({}, {}, track, 0, 1, 'transform', 'before', 3000, 1, 1);
    assert.equal(e.frames.size, 0);
    assert.equal([...e.timers.values()][0].due, 80);
    signature = 'after';
    await e.advance(80);
    const result = await wait;
    assert.equal(result.page, 1);
    assert.equal(result.changed, true);
    assert.equal(runtime.currentPage, 1);
});

test('an obsolete unacknowledged move expires without reporting a fresh hover failure', async () => {
    const e = environment(['hoverPreparationCancelled', 'sleep', 'waitLogicalPageChange'], {
        getCarouselDomRuntime: () => ({ signatureToPage: new Map() }),
        currentPageSlots: () => [], visibleSignature: () => 'before',
        logOperationTimeout: () => { throw new Error('Obsolete hover reported a timeout'); }
    });
    e.c.hoverToken = 2;
    const track = { style: { getPropertyValue: () => 'transform' } };
    const wait = e.c.waitLogicalPageChange({}, {}, track, 0, 1, 'transform', 'before', 80, 1, 1);
    await e.advance(80);
    assert.equal((await wait).changed, false);
});

test('cancelled indicator polling still acknowledges the clicked page at a lower cadence', async () => {
    let page = 0;
    const e = environment(['hoverPreparationCancelled', 'sleep', 'waitPageByPolling', 'waitPage'], {
        selectedPage: () => page
    });
    e.c.hoverToken = 2;
    const wait = e.c.waitPage({}, 0, 3000, 1, 1);
    assert.equal([...e.timers.values()][0].due, 80);
    page = 1;
    await e.advance(80);
    assert.equal(await wait, 1);
});

test('clicked moves remain serialized through native settlement and restore their styles', async () => {
    const acknowledgement = deferred();
    const settlement = deferred();
    let clicks = 0, page = 0, restorations = 0;
    const classes = new Set();
    const section = { classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) } };
    const properties = new Map([['transform', 'before'], ['transition', 'original'], ['animation', 'original']]);
    const track = {
        isConnected: true, offsetWidth: 100,
        style: { getPropertyValue: key => properties.get(key) || '', getPropertyPriority: () => '', setProperty: (key, value) => properties.set(key, value) }
    };
    const e = environment(['moveOnePage'], {
        carouselMoveQueue: Promise.resolve(), pageMoveSequence: 0, sourceState: { track },
        FAST_MOVE_CLASS: 'fast', PAGE_CHANGE_TIMEOUT_MS: 3000, SCRIPT_MOVE_SETTLE_TIMEOUT_MS: 260,
        selectedPage: () => page, pageCount: () => 10,
        getCarouselDomRuntime: () => ({ profile: { pageMode: 'logical' } }),
        carouselMoveButton: () => ({ button: { click: () => clicks++ } }), carouselMoveButtonDisabled: () => false,
        currentPageSlots: () => [], visibleSignature: () => 'before',
        captureInlineStyleProperty: (node, key) => ({ value: node.style.getPropertyValue(key), priority: '' }),
        restoreInlineStyleProperty: (node, key, saved) => { restorations++; node.style.setProperty(key, saved.value); },
        registerActiveCarouselStyleCleanup: () => {}, unregisterActiveCarouselStyleCleanup: () => {},
        waitLogicalPageChange: () => clicks === 1 ? acknowledgement.promise : Promise.resolve({ page: 2, transform: 'after', signature: 'after', changed: true }),
        waitForScriptMoveSettle: () => clicks === 1 ? settlement.promise : Promise.resolve({ transform: 'after', signature: 'after', observedChange: true })
    });
    const first = e.c.moveOnePage(section, {}, 1, 1, 1);
    await e.flush();
    assert.equal(clicks, 1);
    e.c.hoverToken = 2;
    const obsoleteQueued = e.c.moveOnePage(section, {}, 1, 1, 1);
    const latest = e.c.moveOnePage(section, {}, 1, 2, 1);
    page = 1;
    acknowledgement.resolve({ page: 1, transform: 'after', signature: 'after', changed: true });
    await e.flush();
    assert.equal(clicks, 1);
    assert.equal(classes.has('fast'), true);
    settlement.resolve({ transform: 'after', signature: 'after', observedChange: true });
    await Promise.all([first, obsoleteQueued, latest]);
    assert.equal(clicks, 2);
    assert.equal(classes.has('fast'), false);
    assert.equal(properties.get('transition'), 'original');
    assert.equal(properties.get('animation'), 'original');
    assert.equal(restorations, 4);
});

const observerFunctions = [
    'isScriptOwnedMyListNode', 'mutationOnlyChangesScriptUi', 'mutationChangesObservedAncestorPath',
    'handleTargetDocumentMutation', 'handleRelevantTargetDocumentMutation', 'nativeBindingChanged', 'ensureLiveNativeBinding'
];
function observerEnvironment() {
    const ancestor = new Element('ancestor');
    const host = new Element('host', ancestor);
    const section = new Element('section', host);
    const scroller = new Element('scroller', section);
    const track = new Element('track', scroller);
    const grid = new Element('grid', section);
    const status = new Element('status', section);
    section.querySelector = () => scroller;
    let reads = 0, adoptions = 0;
    const runs = [];
    const e = environment(observerFunctions, {
        GRID_ID: 'grid', STATUS_ID: 'status', LEGACY_EMPTY_STATE_ID: 'empty', ORDER_MISMATCH_DIALOG_ID: 'dialog',
        NETFLIX_DOM_SELECTORS: { browseSections: 'host', carouselScroller: 'scroller' },
        location: { href: 'same' }, lastObservedUrl: 'same', targetDocumentObserver: {}, targetMutationFrame: null,
        initializationBlockedSessionToken: null, targetDocumentDiscoveryActive: false,
        targetObservedBrowseHost: host, targetObservedMyListSection: section, targetObservedAncestors: [ancestor],
        sourceState: { section, scroller, track, grid, empty: false, items: [1] }, completedSection: section,
        waitingForNativeEmpty: false, document: { getElementById: id => id === 'grid' ? grid : null, querySelector: () => host },
        findMyListSection: () => section, netflixDom: { findTrack: () => track },
        readNativeMyListDomState: () => { reads++; return { section, scroller, track }; },
        adoptLiveMyListSection: () => { adoptions++; return false; },
        bindTargetDocumentObserver: () => false, scheduleRun: (...args) => runs.push(args)
    });
    return { ...e, ancestor, host, section, scroller, track, grid, status, runs, reads: () => reads, adoptions: () => adoptions };
}
function mutation(target, addedNodes = [], removedNodes = []) { return { target, addedNodes, removedNodes }; }

test('script-owned child and frame mutations are ignored without native reads', async () => {
    const e = observerEnvironment();
    for (const target of [e.grid, new Element('image', e.grid), e.status]) {
        e.c.handleTargetDocumentMutation([mutation(target, [new Element()])]);
    }
    e.c.handleTargetDocumentMutation([mutation(e.section, [e.grid, e.status])]);
    assert.equal(e.frames.size, 0);
    assert.equal(e.reads(), 0);
});

test('native mutation batches coalesce, and an unchanged binding avoids detailed state reads', async () => {
    const e = observerEnvironment();
    for (let i = 0; i < 3; i++) e.c.handleTargetDocumentMutation([mutation(e.track, [new Element()])]);
    assert.equal(e.frames.size, 1);
    await e.frame();
    assert.equal(e.reads(), 0);
    assert.equal(e.adoptions(), 0);
});

test('track replacement retains the full binding adoption path', async () => {
    const e = observerEnvironment();
    const replacement = new Element('new-track', e.scroller);
    e.track.isConnected = false;
    e.c.netflixDom.findTrack = () => replacement;
    e.c.readNativeMyListDomState = () => ({ section: e.section, scroller: e.scroller, track: replacement });
    let adoptions = 0;
    e.c.adoptLiveMyListSection = binding => { adoptions++; Object.assign(e.c.sourceState, binding); return true; };
    e.c.handleTargetDocumentMutation([mutation(e.scroller, [replacement], [e.track])]);
    await e.frame();
    assert.equal(adoptions, 1);
    assert.equal(e.c.sourceState.track, replacement);
});

test('removal of the script grid still schedules recovery', async () => {
    const e = observerEnvironment();
    e.grid.isConnected = false;
    e.grid.parentElement = null;
    e.c.handleTargetDocumentMutation([mutation(e.section, [], [e.grid])]);
    await e.frame();
    assert.equal(e.runs.length, 1);
    assert.deepEqual(e.runs[0], [40, 1]);
});

test('native empty transitions bypass the identity-only shortcut', async () => {
    const e = observerEnvironment();
    e.c.waitingForNativeEmpty = true;
    e.c.sourceState.empty = true;
    e.c.sourceState.items = [];
    e.c.readNativeMyListDomState = () => ({ section: e.section, scroller: null, track: null });
    let adoptedEmpty = 0;
    e.c.adoptLiveEmptyMyListSection = () => adoptedEmpty++;
    e.c.handleTargetDocumentMutation([mutation(e.section, [new Element('native-empty')], [e.scroller])]);
    await e.frame();
    assert.equal(adoptedEmpty, 1);
});

test('host replacement along the ancestor path is not filtered', async () => {
    const e = observerEnvironment();
    let bindings = 0;
    e.c.bindTargetDocumentObserver = () => { bindings++; return true; };
    e.c.handleTargetDocumentMutation([mutation(e.ancestor, [new Element('new-host')], [e.host])]);
    assert.equal(bindings, 1);
    assert.equal(e.frames.size, 1);
    await e.frame();
});

test('route listener cleanup cancels pending hover and observer work', async () => {
    const e = hoverEnvironment(['stopTargetEventListeners']);
    const removed = [];
    e.c.targetListenersActive = true;
    e.c.targetDocumentObserver = { disconnect() {} };
    e.c.handleObservedMyListToggleClick = () => {};
    e.c.handleTargetWindowResize = () => {};
    e.c.handleTargetVisualViewportResize = () => {};
    e.c.document = { removeEventListener: type => removed.push(type) };
    e.c.window = { removeEventListener() {}, visualViewport: { removeEventListener() {} } };
    e.c.targetMutationFrame = e.c.requestAnimationFrame(() => { throw new Error('Stale observer ran'); });
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.stopTargetEventListeners();
    await e.advance(200);
    await e.frame();
    assert.equal(e.activations.length, 0);
    assert.equal(e.c.targetMutationFrame, null);
    assert.equal(e.c.pendingGridHoverClone, null);
    assert.ok(removed.includes('wheel') && removed.includes('scroll'));
});
