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
        this.children = [];
        this.attributes = new Map();
    }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    removeAttribute(key) { this.attributes.delete(key); }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60 }; }
    replaceWith(fresh) {
        fresh.parentElement = this.parentElement;
        fresh.hovered = this.hovered;
        this.isConnected = false;
        this.parentElement = null;
    }
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
        nativeReadScope: null, VERBOSE_INTERACTION_LOGS: false,
        BUILD_CHUNK_MAX_ITEMS: 24, BUILD_CHUNK_BUDGET_MS: 6,
        performance: { now: () => now },
        setTimeout(callback, delay) { const key = ++id; timers.set(key, { callback, due: now + delay }); return key; },
        clearTimeout(key) { timers.delete(key); },
        requestAnimationFrame(callback) { const key = ++id; frames.set(key, callback); return key; },
        cancelAnimationFrame(key) { frames.delete(key); },
        HOVER_ACTIVATION_DELAY_MS: 120, HOVER_SCROLL_QUIET_MS: 180, HOVER_RETRY_DELAY_MS: 180, CANCELLED_MOVE_POLL_MS: 80,
        HOVER_SOURCE_TIMEOUT_MS: 500, HOVER_SOURCE_INTERVAL_MS: 10, PAGE_STABLE_TIMEOUT_MS: 2000,
        hoverToken: 1, hoverSequence: 0, pendingGridHoverClone: null,
        lastTargetScrollAt: -Infinity, hoverNeedsPointerMove: false, lastPointerX: -1, lastPointerY: -1,
        activeClone: null, activeVideoId: null, activePage: null, activeSourceSlot: null, activeGeometryProxy: null,
        activeNativeHover: null,
        orderMismatchDialogOpen: false, orderMismatchReinitializing: false, responsiveRefreshPromise: null,
        routeSessionToken: 1, targetSessionActive: true,
        recentRemovedMyListItems: new Map(), undoExpiryTimer: null,
        nativeInitializationFailure: null,
        imageResourceObserver: null, IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES: 4000,
        hoverFrameDiagnosticOwner: null, startHoverFrameDiagnostics: () => {},
        isTargetPage: () => true, isRouteSessionActive: token => token === 1,
        assertRouteSession: () => {}, isRouteSessionCancelledError: () => false,
        ensureLiveNativeBinding: () => {},
        log: () => {}, warn: () => {}, tLog: value => value, itemSummary: item => item,
        initializeWatchGroups: () => {},
        ...overrides
    });
    vm.runInContext(source.match(/^    const HOVER_FRAME_DIAGNOSTIC_LIMITS = Object.freeze\([\s\S]*?\);/m)?.[0] || '', c);
    vm.runInContext(source.match(/^    const HOVER_PREVIEW_DIAGNOSTIC_LIMITS = Object.freeze\([\s\S]*?\);/m)?.[0] || '', c);
    for (const name of ['createNativeReadScope', 'withNativeReadScope', 'invalidateNativeReadScope', 'nativeRect', 'trace', 'gridOwnsClone',
        'createPerformanceDiagnostics', 'collectPerformanceDiagnostics', 'clearUndoExpiryTimer', 'clearUndoEntries', 'scheduleUndoExpiry', 'forgetUndoEntry',
        'recordHoverTiming', 'releaseNativeHover', 'nativeHoverSourceMatches',
        'finishNativePreviewDiagnostic', 'inspectNativePreviewDiagnostic', 'scheduleNativePreviewDiagnostic',
        'nativePreviewNodeVideoId', 'decodeTrackingContext', 'findNativeHoverPreview', 'retainNativeHoverForPreview', 'clearNativePreviewTransfer',
        'releaseNativePreview', 'nativePreviewOwnerMatches', 'handleTargetPreviewPointerOut', 'gridHoverReplacementUnderPointer',
        'stopHoverFrameDiagnostics', 'handleHoverDiagnosticVisibilityChange',
        'hoverReplayGuardDiagnostic', 'hoverLeaveDestinationDiagnostic', 'recordGridHoverLeave',
        'startImageResourceDiagnostics', 'stopImageResourceDiagnostics', 'recordImageResourceEntries',
        'responsiveViewportSignature', 'responsiveLayoutMatches',
        'cancelResizeHover', 'handleTargetResize', 'recoverNativeInitialization', ...names]) {
        vm.runInContext(declaration(name), c);
    }
    c.performanceDiagnostics = c.createPerformanceDiagnostics();
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
        async frame(ms = 16) {
            now += ms;
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(now);
            await flush();
        }
    };
}

const hoverFunctions = [
    'hoverPreparationCancelled', 'gridCloneFromPointerEvent', 'gridHoverSuppressed',
    'gridHoverTargetActive', 'releaseFailedGridHover', 'cancelPendingGridHover', 'handleGridClonePointerOver',
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
        findGridClone: () => clone,
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

function preparedHoverEnvironment(options = {}) {
    const calls = { preparations: 0, alignments: 0, grafts: 0, dialogs: 0 };
    const logs = [], warnings = [], events = [];
    const sourceSlot = new Element('source');
    const card = new Element('native-card', sourceSlot);
    card.href = '/watch/123';
    card.dispatchEvent = event => { events.push(event); return true; };
    sourceSlot.querySelector = () => card;
    sourceSlot.cloneNode = () => new Element('fresh');
    class NativeEvent {
        constructor(type, properties) { this.type = type; Object.assign(this, properties); }
    }
    let current = null;
    const e = hoverEnvironment([
        'activateClone', 'prepareMountedPage', 'makeLiveClone', 'associateGridHoverItem',
        'scheduleNativeHoverReplay', 'replayHoverOnNativeSource', 'sleep'
    ], {
        NETFLIX_DOM_SELECTORS: { standardCard: 'card' }, PointerEvent: NativeEvent, MouseEvent: NativeEvent,
        document: { visibilityState: 'visible', elementFromPoint: () => current?.hovered ? current : null, querySelectorAll: () => [] },
        ORDER_MISMATCH_POSITION_THRESHOLD: 10, mutationSourceRecoveryPending: false,
        selectedPage: () => 0, ensureLiveNativeBinding: () => {},
        currentPageSlots: () => [sourceSlot], visibleSignature: () => '123',
        resolveExpectedPageSourceItem: async () => {
            calls.preparations++;
            return { status: 'found', slot: sourceSlot, slots: [sourceSlot], page: 0 };
        },
        rejectLargeNativePositionDeviation: () => false,
        getCarouselDomRuntime: () => ({ profile: { pageMode: 'indicator' } }),
        itemKey: item => item?.videoId || '',
        findItemForSourceSlot: () => e.clone.__tmMyListItem,
        findActiveSourceSlot: () => sourceSlot.isConnected ? sourceSlot : null,
        findGridClone: () => current, setGridClone: (_, fresh) => { current = fresh; },
        alignSourceSlotToClone: () => {
            calls.alignments++;
            return sourceSlot.isConnected && (options.align ? options.align(calls.alignments) : true);
        },
        netflixReactHover: {
            graftTreeToClone() {
                calls.grafts++;
                return options.graftStats || { fiberAssignments: 1, propsAssignments: 1 };
            }
        },
        normalizeClone: () => {}, copyItemAttributes: () => {}, ensureGridHoverBehavior: () => {},
        videoIdFromHref: href => /\/watch\/(\d+)/.exec(href)?.[1] || '',
        slotDescriptor: () => ({}), rectSummary: () => ({}),
        showOrderMismatchDialog: () => { calls.dialogs++; e.c.orderMismatchDialogOpen = true; },
        log: (name, details) => logs.push({ name, details }),
        warn: (name, details) => warnings.push({ name, details })
    });
    current = e.clone;
    e.clone.__tmHoverActivationGeneration = 1;
    e.c.sourceState.scroller = new Element('scroller');
    e.c.sourceState.track = new Element('track', e.c.sourceState.scroller);
    e.c.sourceState.layout = { columns: 6 };
    e.c.sourceState.items = [e.clone.__tmMyListItem];
    sourceSlot.parentElement = e.c.sourceState.track;
    return {
        ...e, calls, logs, warnings, events, sourceSlot, card, current: () => current,
        start: () => e.c.activateClone(e.clone.__tmMyListItem, e.clone, pointer(e.clone), 1)
    };
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
        slotDescriptor: () => ({}), scheduleNativeHoverReplay: () => { replays++; return true; }
    });
    e.clone.setAttribute('data-tm-hover-ready', 'true');
    e.clone.setAttribute('data-tm-backed-page', '0');
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    await e.advance(119);
    assert.equal(alignments, 0);
    await e.advance(1);
    assert.equal(alignments, 0, 'alignment is deferred to the replay frame');
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
    const replay = e.c.scheduleNativeHoverReplay(new Element(), e.clone.__tmMyListItem, e.clone, pointer(e.clone), 0, 'test');
    e.c.handleTargetScroll();
    await e.frame();
    assert.equal(await replay, false);
    // No source query is implemented: stale replay must return before using it.
});

test('physical intent inside the scroll quiet period resumes without another pointer move', async () => {
    const e = hoverEnvironment();
    e.c.handleTargetScroll();
    await e.advance(100);
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove' }));
    assert.equal(e.c.hoverNeedsPointerMove, true);
    assert.equal(e.timers.size, 1);
    await e.advance(119);
    assert.equal(e.activations.length, 0);
    await e.advance(1);
    assert.equal(e.activations.length, 1);
    assert.equal(e.c.hoverNeedsPointerMove, false);
    await e.advance(1000);
    assert.equal(e.activations.length, 1);
});

test('stationary boundary events and synthetic moves never queue post-scroll intent', async () => {
    const e = hoverEnvironment();
    e.c.handleTargetScroll();
    await e.advance(50);
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove', isTrusted: false }));
    await e.advance(1000);
    assert.equal(e.activations.length, 0);
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.lastPointerX, -1);
    assert.equal(e.c.hoverNeedsPointerMove, true);
});

test('leaving, scrolling again, moving outside the grid, and resizing cancel deferred intent', async () => {
    for (const action of ['leave', 'scroll', 'outside', 'resize']) {
        const e = hoverEnvironment(['handleTargetWindowResize']);
        e.c.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
        e.c.scheduleResponsiveRefresh = () => {};
        e.c.handleTargetScroll();
        await e.advance(50);
        e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove' }));
        if (action === 'leave') e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
        if (action === 'scroll') e.c.handleTargetScroll();
        if (action === 'outside') e.c.handleTargetPointerMove(pointer(new Element(), { type: 'pointermove', clientX: 200 }));
        if (action === 'resize') e.c.handleTargetWindowResize();
        await e.advance(1000);
        assert.equal(e.activations.length, 0, action);
        assert.equal(e.timers.size, 0, action);
    }
});

test('only the latest physical target resumes after scrolling, and it must still be hovered', async () => {
    const e = hoverEnvironment();
    const next = new Element('next', e.grid);
    next.__tmMyListItem = { videoId: '456', page: 0 };
    e.c.handleTargetScroll();
    await e.advance(20);
    e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove' }));
    e.c.handleTargetPointerMove(pointer(next, { type: 'pointermove', clientX: 30 }));
    assert.equal(e.timers.size, 1);
    next.hovered = false;
    await e.advance(300);
    assert.equal(e.activations.length, 0);
    assert.equal(e.c.hoverNeedsPointerMove, true);
});

test('failed alignment follows the replacement card and retries once without another hover', async () => {
    const e = preparedHoverEnvironment({ align: count => count > 1 });
    const activation = e.start();
    await e.flush();
    const firstFresh = e.current();
    assert.equal(e.clone.isConnected, false);
    assert.equal(firstFresh.__tmHoverActivationGeneration, 1);
    assert.equal(firstFresh.getAttribute('data-tm-hover-token'), '2');
    assert.equal(firstFresh.getAttribute('data-tm-preparing'), 'true');
    assert.equal(e.events.length, 0);
    assert.equal(e.calls.preparations, 1);
    await e.frame();
    await e.advance(180);
    await e.frame();
    await activation;
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.calls.grafts, 2);
    assert.equal(e.events.length, 4);
    assert.equal(e.c.activeClone, e.current());
    assert.equal(e.current().getAttribute('data-tm-preparing'), null);
    assert.equal(e.logs.find(entry => entry.name === 'hoverNativePagePreparationResult').details.success, true);
    assert.equal(e.warnings.filter(entry => entry.details?.reason === 'source-alignment-failed').length, 1);
});

test('permanent alignment failure is reported as failure and cannot create an automatic retry loop', async () => {
    const e = preparedHoverEnvironment({ align: () => false });
    const activation = e.start();
    await e.flush();
    await e.frame();
    await e.advance(180);
    await e.frame();
    await activation;
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.events.length, 0);
    assert.equal(e.c.activeClone, null);
    assert.equal(e.current().getAttribute('data-tm-hover-token'), null);
    assert.equal(e.logs.find(entry => entry.name === 'hoverNativePagePreparationResult').details.success, false);
    await e.advance(1000);
    await e.frame();
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.timers.size, 0);
});

test('leaving the replacement while replay is pending cancels it and its recovery', async () => {
    const e = preparedHoverEnvironment();
    const activation = e.start();
    await e.flush();
    const fresh = e.current();
    assert.notEqual(fresh, e.clone);
    const token = e.c.hoverToken;
    e.c.handleGridClonePointerLeave(fresh, e.clone.__tmMyListItem);
    fresh.hovered = false;
    assert.equal(e.c.hoverToken, token + 1);
    await e.frame();
    await activation;
    await e.advance(1000);
    assert.equal(e.events.length, 0);
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.activeClone, null);
});

test('scroll, resize, route leave, and target loss stop recovery on the replacement card', async () => {
    for (const action of ['scroll', 'resize', 'route', 'target']) {
        const e = preparedHoverEnvironment({ align: () => false });
        vm.runInContext(declaration('handleTargetWindowResize'), e.c);
        e.c.window = { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 };
        e.c.scheduleResponsiveRefresh = () => {};
        const activation = e.start();
        await e.flush();
        await e.frame();
        if (action === 'scroll') e.c.handleTargetScroll();
        if (action === 'resize') e.c.handleTargetWindowResize();
        if (action === 'route') e.c.isRouteSessionActive = () => false;
        if (action === 'target') e.current().hovered = false;
        await e.advance(180);
        await activation;
        assert.equal(e.calls.preparations, 1, action);
        assert.equal(e.events.length, 0, action);
        assert.equal(e.current().getAttribute('data-tm-preparing'), null, action);
    }
});

test('a disconnected ready source clears active state and permits one recovery within the same hover', async () => {
    const e = preparedHoverEnvironment();
    e.clone.setAttribute('data-tm-hover-ready', 'true');
    e.clone.setAttribute('data-tm-backed-page', '0');
    const activation = e.start();
    await e.flush();
    assert.equal(e.c.activeClone, e.clone);
    e.sourceSlot.isConnected = false;
    await e.frame();
    assert.equal(e.c.activeClone, null);
    assert.equal(e.events.length, 0);
    e.sourceSlot.isConnected = true;
    await e.advance(180);
    await e.frame();
    await activation;
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.events.length, 4);
    assert.equal(e.c.activeClone, e.current());
});

test('replay revalidates source identity and visibility before dispatching', async () => {
    for (const changed of ['identity', 'visibility']) {
        const e = preparedHoverEnvironment();
        const activation = e.start();
        await e.flush();
        if (changed === 'identity') e.card.href = '/watch/456';
        if (changed === 'visibility') e.c.findActiveSourceSlot = () => new Element('different-source');
        await e.frame();
        assert.equal(e.c.activeClone, null, changed);
        await e.advance(180);
        await e.frame();
        await activation;
        assert.equal(e.calls.preparations, 2, changed);
        assert.equal(e.events.length, 0, changed);
        assert.equal(e.c.activeClone, null, changed);
        assert.equal(e.timers.size, 0, changed);
    }
});

test('old replay completion cannot release a newer activation even on the same clone', async () => {
    const e = preparedHoverEnvironment();
    e.c.activeClone = e.clone;
    e.c.activeVideoId = '123';
    const replay = e.c.scheduleNativeHoverReplay(e.sourceSlot, e.clone.__tmMyListItem, e.clone, pointer(e.clone), 0, 'test', 1, 1);
    e.c.hoverToken = 2;
    await e.frame();
    assert.equal(await replay, false);
    assert.equal(e.c.activeClone, e.clone);
    assert.equal(e.c.activeVideoId, '123');
    assert.equal(e.events.length, 0);
});

test('source revalidation uses original geometry and restores the grid proxy before native replay', async () => {
    const e = preparedHoverEnvironment();
    for (const name of ['pairDomTrees', 'makeClientRectList', 'restoreGeometryProxy', 'clearSourceAlignment', 'alignSourceSlotToClone']) {
        vm.runInContext(declaration(name), e.c);
    }
    e.sourceSlot.getBoundingClientRect = () => ({ left: 1000, right: 1100, top: 0, bottom: 60, width: 100, height: 60 });
    e.c.findActiveSourceSlot = () => e.sourceSlot.getBoundingClientRect().left === 1000 ? e.sourceSlot : null;
    e.clone.setAttribute('data-tm-hover-ready', 'true');
    e.clone.setAttribute('data-tm-backed-page', '0');
    const activation = e.start();
    await e.flush();
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000, 'proxy is deferred until source revalidation in the replay frame');
    await e.frame();
    await activation;
    assert.equal(e.events.length, 4);
    assert.equal(e.calls.preparations, 0);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
    assert.equal(e.c.activeGeometryProxy.clone, e.clone);
    e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.equal(e.c.activeGeometryProxy, null);
});

test('native event dispatch failure releases state and is bounded by the same recovery limit', async () => {
    const e = preparedHoverEnvironment();
    e.card.dispatchEvent = () => { throw new Error('Native dispatch failed'); };
    const activation = e.start();
    await e.flush();
    await e.frame();
    assert.equal(e.c.activeClone, null);
    await e.advance(180);
    await e.frame();
    await activation;
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.c.activeClone, null);
    assert.equal(e.current().getAttribute('data-tm-preparing'), null);
    assert.equal(e.warnings.filter(entry => entry.details?.reason === 'replay-failed').length, 2);
});

test('replay uses the latest physical coordinates, and synthetic motion cannot replace them', async () => {
    const e = preparedHoverEnvironment();
    e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove', clientX: 80, clientY: 40 }));
    e.c.handleTargetPointerMove(pointer(e.clone, { type: 'pointermove', clientX: 25, clientY: 35, isTrusted: false }));
    assert.equal(e.c.lastPointerX, 80);
    assert.equal(e.c.lastPointerY, 40);
    assert.equal(e.c.replayHoverOnNativeSource(e.sourceSlot, pointer(e.clone, { screenX: 500, screenY: 600 })), true);
    assert.equal(e.events.length, 4);
    for (const event of e.events) {
        assert.equal(event.clientX, 80);
        assert.equal(event.clientY, 40);
        assert.equal(event.screenX, 560);
        assert.equal(event.screenY, 610);
    }
    e.c.cancelPendingGridHover();
});

function liveHoverGeometry(e) {
    for (const name of ['pairDomTrees', 'makeClientRectList', 'restoreGeometryProxy', 'clearSourceAlignment', 'alignSourceSlotToClone']) {
        vm.runInContext(declaration(name), e.c);
    }
    e.sourceSlot.getBoundingClientRect = () => ({ left: 1000, right: 1100, top: 0, bottom: 60, width: 100, height: 60 });
}

test('fresh and ready hovers align once in the replay frame and export separate phase measurements', async () => {
    for (const ready of [false, true]) {
        const e = preparedHoverEnvironment();
        if (ready) {
            e.clone.setAttribute('data-tm-hover-ready', 'true');
            e.clone.setAttribute('data-tm-backed-page', '0');
        }
        const activation = e.start();
        await e.flush();
        assert.equal(e.calls.alignments, 0);
        await e.frame();
        await activation;
        assert.equal(e.calls.alignments, 1);
        assert.equal(e.calls.preparations, ready ? 0 : 1);
        assert.equal(e.calls.grafts, ready ? 0 : 1);
        const copy = e.c.collectPerformanceDiagnostics();
        assert.equal(copy.hoverLifecycle.replaysDispatched, 1);
        assert.equal(copy.hoverLifecycle.duplicateAlignmentsAvoided, 1);
        assert.equal(copy.hoverTiming.alignmentSamples, 1);
        assert.equal(copy.hoverTiming.replaySamples, 1);
        assert.equal(copy.hoverTiming.graftSamples, ready ? 0 : 1);
        assert.equal(e.events.length, 4);
    }
});

test('scroll sends one native exit before restoring geometry and cannot restart a stationary hover', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const exitPositions = [];
    e.card.dispatchEvent = event => {
        e.events.push(event);
        if (event.type.endsWith('out')) {
            exitPositions.push(e.sourceSlot.getBoundingClientRect().left);
            assert.equal(e.c.activeNativeHover, null, 'ownership is cleared before native callbacks');
            e.c.releaseNativeHover('nested-release');
        }
        return true;
    };
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
    e.c.handleTargetScroll();
    e.c.handleTargetScroll();
    assert.deepEqual(e.events.slice(4).map(event => event.type), ['pointerout', 'mouseout']);
    assert.deepEqual(exitPositions, [0, 0]);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.equal(e.c.activeGeometryProxy, null);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.scrollBursts, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.scrollExits, 1);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.exitSamples, 1);
    await e.advance(200);
    e.c.handleGridClonePointerOver(pointer(e.current()), e.current(), e.clone.__tmMyListItem);
    await e.advance(1000); await e.frame();
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.events.length, 6);
    assert.equal(e.timers.size + e.frames.size, 0);
});

test('delegated card leave carries the actual popup destination into native exits', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const handlers = new Map();
    e.grid.addEventListener = (type, handler) => handlers.set(type, handler);
    vm.runInContext(declaration('ensureGridHoverBehavior'), e.c);
    e.c.ensureGridHoverBehavior(e.grid);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const popupControl = new Element('netflix-popup-control');
    handlers.get('pointerout')({ target: e.current(), relatedTarget: popupControl });
    assert.equal(e.events.length, 6);
    assert.ok(e.events.slice(4).every(event => event.relatedTarget === popupControl));
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.lastExitReason, 'pointer-leave');
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
});

test('obsolete or recycled native sources receive no exit intended for an earlier title', async () => {
    for (const change of ['identity', 'detached', 'replacement']) {
        const e = preparedHoverEnvironment();
        liveHoverGeometry(e);
        const activation = e.start();
        await e.flush(); await e.frame(); await activation;
        if (change === 'identity') e.card.href = '/watch/456';
        if (change === 'detached') e.card.isConnected = false;
        if (change === 'replacement') e.sourceSlot.querySelector = () => new Element('replacement-card');
        e.c.handleTargetScroll();
        assert.equal(e.events.length, 4, change);
        assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitSkipped, 1, change);
        assert.equal(e.c.activeNativeHover, null);
        assert.equal(e.c.activeGeometryProxy, null);
        assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    }
});

test('failed native exits still restore geometry and are not retried on subsequent scroll events', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    e.card.dispatchEvent = () => { throw new Error('Private Netflix handler details'); };
    e.c.handleTargetScroll(); e.c.handleTargetScroll();
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitFailed, 2);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitsDispatched, 0);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.activeGeometryProxy, null);
    assert.doesNotMatch(JSON.stringify(e.c.collectPerformanceDiagnostics()), /Private Netflix/);
});

test('native source changes during exit stop remaining events from reaching a recycled card', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    e.card.dispatchEvent = event => {
        e.events.push(event);
        if (event.type === 'pointerout') e.card.href = '/watch/456';
        return true;
    };
    e.c.handleTargetScroll();
    assert.deepEqual(e.events.slice(4).map(event => event.type), ['pointerout']);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitSkipped, 1);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
});

test('native source changes during activation stop further enters for the obsolete title', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    e.card.dispatchEvent = event => {
        e.events.push(event);
        if (event.type === 'pointerover') {
            e.card.href = '/watch/456';
        }
        return true;
    };
    const activation = e.start();
    await e.flush(); await e.frame();
    assert.deepEqual(e.events.map(event => event.type), ['pointerover']);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitSkipped, 1);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    await e.advance(180); await e.frame(); await activation;
    assert.deepEqual(e.events.map(event => event.type), ['pointerover']);
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.c.activeClone, null);
});

test('scroll during native activation stops the remaining enter events and cannot reopen that popup', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    e.card.dispatchEvent = event => {
        e.events.push(event);
        if (event.type === 'pointerover') e.c.handleTargetScroll();
        return true;
    };
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    assert.deepEqual(e.events.map(event => event.type), ['pointerover', 'pointerout', 'mouseout']);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.replayCancelled, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.replaysDispatched, 0);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.activeClone, null);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    await e.advance(1000); await e.frame();
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.events.length, 3);
});

test('rapid scroll and rehover establish a new owner that obsolete replay cleanup cannot release', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const oldToken = e.c.hoverToken;
    const oldReplay = e.c.scheduleNativeHoverReplay(e.sourceSlot, e.clone.__tmMyListItem, e.current(),
        pointer(e.current()), 0, 'obsolete', oldToken, 1);
    e.c.handleTargetScroll();
    await e.advance(200);
    e.c.handleTargetPointerMove(pointer(e.current(), { type: 'pointermove', clientX: 40, clientY: 30 }));
    await e.advance(120);
    await e.frame(); await e.flush();
    assert.equal(await oldReplay, false);
    assert.equal(e.c.activeNativeHover.card, e.card);
    assert.notEqual(e.c.activeNativeHover.token, oldToken);
    assert.equal(e.c.activeClone, e.current());
    assert.deepEqual(e.events.map(event => event.type), ['pointerover', 'pointermove', 'mouseover', 'mousemove',
        'pointerout', 'mouseout', 'pointerover', 'pointermove', 'mouseover', 'mousemove']);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.exitsDispatched, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.replaysDispatched, 2);
});

test('hover phase timing cannot write into a new route diagnostic owner', async () => {
    const e = preparedHoverEnvironment();
    const old = e.c.performanceDiagnostics.hoverTiming;
    await e.advance(125);
    e.c.recordHoverTiming(old, 'queue', 0);
    assert.equal(old.queueTotalMs, 125);
    e.c.performanceDiagnostics = e.c.createPerformanceDiagnostics();
    e.c.recordHoverTiming(old, 'move', 0);
    assert.equal(old.moveSamples, 0);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.queueSamples, 0);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.moveSamples, 0);
});

test('hover leave diagnostics identify a stationary early preview transfer without exporting DOM data', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const clone = e.current();
    const popup = new Element('private-profile-123');
    popup.localName = 'div';
    popup.classList = { length: 2, item: index => ['private-profile-123', 'previewModal--wrapper'][index] };
    const control = new Element('private-title-456', popup);
    control.localName = 'button';
    for (const node of [clone, control, popup]) {
        node.getBoundingClientRect = () => { throw new Error('Diagnostic layout read'); };
        Object.defineProperty(node, 'textContent', { get() { throw new Error('Private DOM text'); } });
        Object.defineProperty(node, 'href', { get() { throw new Error('Private URL'); } });
    }
    await e.advance(420);
    e.c.handleGridClonePointerLeave(clone, clone.__tmMyListItem, control,
        pointer(clone, { type: 'pointerout', relatedTarget: control }));
    const entry = e.logs.find(log => log.name === 'hoverPointerLeaveObserved').details;
    assert.equal(entry.afterReplay, true);
    assert.equal(entry.sinceReplayMs, 420);
    assert.equal(entry.pointerDeltaPx, 0);
    assert.equal(entry.destination.previewHint, true);
    assert.equal(entry.destination.tag, 'button');
    assert.equal(entry.destination.ancestorsExamined, 2);
    assert.equal(entry.trusted, true);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.stationaryLeaves, 1);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.leavesWithin600ms, 1);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.leavesToPreviewHint, 1);
    assert.equal(e.events.length, 6, 'diagnostics preserve the existing native exit');
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.doesNotMatch(JSON.stringify(entry), /private|123|456|previewModal|href|textContent/);
});

test('unknown pointer coordinates and bounded destination hints are not treated as stationary movement', async () => {
    const e = preparedHoverEnvironment();
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const target = new Element();
    let node = target, classReads = 0;
    for (let index = 0; index < 8; index++) {
        node.localName = 'div';
        node.classList = { length: 100, item() { classReads++; return 'generic'; } };
        node.parentElement = new Element();
        node = node.parentElement;
    }
    // A preview beyond the ancestry cap is deliberately unknown.
    node.classList = { length: 1, item: () => 'previewModal' };
    const result = e.c.hoverLeaveDestinationDiagnostic(target);
    assert.equal(result.ancestorsExamined, 6);
    assert.equal(result.truncated, true);
    assert.equal(result.previewHint, false);
    assert.equal(classReads, 48);
    e.c.handleGridClonePointerLeave(e.current(), e.clone.__tmMyListItem, target);
    const entry = e.logs.find(log => log.name === 'hoverPointerLeaveObserved').details;
    assert.equal(entry.pointerDeltaPx, null);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.stationaryLeaves, 0);
});

test('a diagnostic destination failure cannot interrupt hover exit and geometry restoration', async () => {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const destination = new Element();
    Object.defineProperty(destination, 'classList', { get() { throw new Error('Private diagnostic failure'); } });
    e.c.handleGridClonePointerLeave(e.current(), e.clone.__tmMyListItem, destination, pointer(e.current()));
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.diagnosticFailures, 1);
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.events.length, 6);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.doesNotMatch(JSON.stringify(e.logs), /Private diagnostic failure/);
});

test('replay rejection reports loss of hover after insertion and leaves existing retry behavior intact', async () => {
    const e = preparedHoverEnvironment();
    const activation = e.start();
    await e.flush();
    const fresh = e.current();
    assert.equal(e.logs.find(log => log.name === 'nativePageClonesUpdated').details.targetHoveredAtInsertion, true);
    fresh.hovered = false;
    fresh.getBoundingClientRect = () => { throw new Error('Rejected target cannot be measured'); };
    await e.frame();
    const rejection = e.logs.find(log => log.name === 'hoverReplayGuardRejected').details;
    assert.equal(rejection.replacementHoveredAtInsertion, true);
    assert.equal(rejection.targetHovered, false);
    assert.equal(rejection.targetConnected, true);
    assert.equal(rejection.generationMatches, true);
    assert.equal(rejection.activeCloneMatches, true);
    assert.equal(rejection.hoverSuppressed, false);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.replayGuardRejected, 1);
    assert.equal(e.events.length, 0);
    await e.advance(180); await activation;
    assert.equal(e.calls.preparations, 1, 'a non-hovered target still fails the existing retry admission');
    assert.equal(e.c.activeClone, null);
});

function laggingHoverReplacement(e) {
    e.clone.replaceWith = fresh => {
        Element.prototype.replaceWith.call(e.clone, fresh);
        fresh.hovered = false;
    };
}

test('a fresh replacement still under the physical pointer replays on the first attempt despite delayed CSS hover', async () => {
    const e = preparedHoverEnvironment();
    laggingHoverReplacement(e);
    const points = [];
    e.c.lastPointerX = 80; e.c.lastPointerY = 40;
    e.c.document = { elementFromPoint(x, y) { points.push([x, y]); return new Element('image', e.current()); } };
    const activation = e.start();
    await e.flush();
    assert.equal(e.logs.find(log => log.name === 'nativePageClonesUpdated').details.targetHoveredAtInsertion, false);
    await e.frame(); await activation;
    assert.deepEqual(points, [[80, 40]], 'use the current physical position instead of the original event');
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.calls.grafts, 1);
    assert.equal(e.events.length, 4);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.replacementPointerAccepted, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.replayCancelled, 0);
    assert.equal(e.timers.size, 1, 'only the delayed presence diagnostic remains; there is no hover retry');
    assert.equal([...e.timers.values()][0].due, e.c.activeNativeHover.replayedAt + 900);
    assert.equal(e.c.gridHoverTargetActive(e.current(), 1, pointer(e.current())), false,
        'hit-test admission expires when preparation ends');
    assert.equal(points.length, 1);
});

test('replacement hit testing cannot admit an overlay, another card, a viewing control, or an obsolete hover', async () => {
    for (const change of ['overlay', 'card', 'control', 'missing', 'token', 'generation', 'route', 'filter', 'scroll']) {
        const e = preparedHoverEnvironment();
        laggingHoverReplacement(e);
        let checks = 0;
        const foreign = new Element('other', e.grid);
        foreign.__tmMyListItem = { videoId: '456' };
        e.c.document = { elementFromPoint() {
            checks++;
            if (change === 'overlay') return new Element('overlay');
            if (change === 'card') return foreign;
            if (change === 'missing') return null;
            const child = new Element('control', e.current());
            child.setAttribute('data-tm-viewing-actions', 'true');
            return child;
        } };
        const activation = e.start();
        await e.flush();
        if (change === 'token') e.c.hoverToken++;
        if (change === 'generation') e.current().__tmHoverActivationGeneration++;
        if (change === 'route') e.c.isRouteSessionActive = () => false;
        if (change === 'filter') e.current().setAttribute('data-tm-type-hidden', 'true');
        if (change === 'scroll') e.c.handleTargetScroll();
        await e.frame(); await e.advance(180); await activation;
        assert.equal(e.events.length, 0, change);
        assert.equal(e.calls.preparations, 1, change);
        if (['token', 'generation', 'route', 'filter', 'scroll'].includes(change)) assert.equal(checks, 0, change);
        else assert.ok(checks > 0, change);
    }
});

function matchingPreview(e, videoId = '123') {
    const root = new Element('previewModal--wrapper');
    root.classList = { length: 1, item: () => 'previewModal--wrapper' };
    const image = new Element('image', root);
    image.localName = 'img';
    const anchor = new Element('play', root);
    anchor.href = '/watch/' + videoId;
    root.querySelectorAll = () => [anchor];
    return { root, image, anchor };
}

async function openedPreview() {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    const preview = matchingPreview(e);
    const clone = e.current();
    clone.hovered = false;
    await e.advance(420);
    e.c.handleGridClonePointerLeave(clone, clone.__tmMyListItem, preview.image,
        pointer(clone, { type: 'pointerout', relatedTarget: preview.image }));
    return { ...e, preview };
}

test('the recorded stationary transfer onto a matching preview keeps positioning until the pointer leaves its controls', async () => {
    const e = await openedPreview();
    const owner = e.c.activeNativeHover;
    assert.equal(owner.previewRoot, e.preview.root);
    assert.equal(e.c.activeClone, e.current());
    assert.equal(e.events.length, 4, 'opening the preview does not send an early native exit');
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
    const button = new Element('button', e.preview.root);
    e.c.handleTargetPreviewPointerOut(pointer(e.preview.image, { type: 'pointerout', relatedTarget: button }));
    assert.equal(e.c.activeNativeHover, owner, 'movement among image and controls remains inside the preview');
    await e.advance(3000);
    const margin = new Element('margin');
    e.c.handleTargetPreviewPointerOut(pointer(button, { type: 'pointerout', relatedTarget: margin }));
    assert.equal(e.c.activeNativeHover, null);
    assert.equal(e.c.activeClone, null);
    assert.equal(owner.previewRoot, null);
    assert.equal(owner.previewClone, null);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000);
    assert.equal(e.events.length, 6);
    assert.ok(e.events.slice(4).every(event => event.relatedTarget === margin));
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewTransfers, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewReleases, 1);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.previewMaxMs, 3000);
    assert.doesNotMatch(JSON.stringify(e.logs.filter(log => log.name.startsWith('hoverPreview'))), /watch\/|123|previewModal/);
});

test('returning from a preview to its card keeps the native owner without replaying or preparing again', async () => {
    const e = await openedPreview();
    const owner = e.c.activeNativeHover;
    const image = new Element('card-image', e.current());
    e.c.handleTargetPreviewPointerOut(pointer(e.preview.image, { type: 'pointerout', relatedTarget: image }));
    assert.equal(e.c.activeNativeHover, owner);
    assert.equal(owner.previewRoot, null);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewReturns, 1);
    assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewReleases, 0);
    assert.equal(e.events.length, 4);
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
    e.c.handleGridClonePointerLeave(e.current(), e.clone.__tmMyListItem, new Element('margin'), pointer(e.current(), { type: 'pointerout' }));
    assert.equal(e.events.length, 6);
    assert.equal(e.c.activeNativeHover, null);
});

test('return to a viewing control or a card with a recycled native identity ends the preview owner', async () => {
    for (const reason of ['control', 'source']) {
        const e = await openedPreview();
        const child = new Element('return-target', e.current());
        if (reason === 'control') child.setAttribute('data-tm-viewing-actions', 'true');
        if (reason === 'source') e.card.href = '/watch/456';
        e.c.handleTargetPreviewPointerOut(pointer(e.preview.image, { type: 'pointerout', relatedTarget: child }));
        assert.equal(e.c.activeNativeHover, null, reason);
        assert.equal(e.c.activeGeometryProxy, null, reason);
        assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewReturns, 0, reason);
        assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000, reason);
    }
});

test('preview admission requires a matching bounded title reference and a trusted current source', async () => {
    for (const change of ['foreign', 'missing', 'limit', 'source', 'untrusted']) {
        const e = preparedHoverEnvironment();
        liveHoverGeometry(e);
        const activation = e.start();
        await e.flush(); await e.frame(); await activation;
        const preview = matchingPreview(e, change === 'foreign' ? '456' : '123');
        if (change === 'missing') preview.root.querySelectorAll = () => [];
        let reads = 0;
        if (change === 'limit') {
            const anchors = { length: 100 };
            for (let index = 0; index < 100; index++) Object.defineProperty(anchors, index, { get() {
                reads++; if (index >= 16) throw new Error('Unbounded preview inspection');
                const anchor = new Element();
                anchor.href = '/watch/456';
                return anchor;
            } });
            preview.root.querySelectorAll = () => anchors;
        }
        if (change === 'source') e.card.href = '/watch/456';
        e.c.handleGridClonePointerLeave(e.current(), e.clone.__tmMyListItem, preview.image,
            pointer(e.current(), { type: 'pointerout', isTrusted: change !== 'untrusted', relatedTarget: preview.image }));
        assert.equal(e.c.activeNativeHover, null, change);
        assert.equal(e.c.activeGeometryProxy, null, change);
        assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewTransfers, 0, change);
        if (change === 'limit') assert.equal(reads, 16);
    }
});

test('a series preview can identify its series while its play link points to an episode', () => {
    const e = preparedHoverEnvironment();
    e.c.URL = URL;
    e.c.location = { href: 'https://www.netflix.com/browse/my-list' };
    vm.runInContext(declaration('videoIdFromHref'), e.c);
    const preview = matchingPreview(e);
    preview.anchor.href = '/watch/456';
    const detail = new Element('details', preview.root);
    detail.href = 'https://www.netflix.com/browse?jbv=123';
    preview.root.querySelectorAll = () => [preview.anchor, detail];
    assert.equal(e.c.findNativeHoverPreview(preview.image, '123').root, preview.root);
    preview.root.querySelectorAll = () => [preview.anchor];
    preview.image.setAttribute('data-ui-tracking-context', encodeURIComponent(JSON.stringify({ video_id: 123 })));
    assert.equal(e.c.findNativeHoverPreview(preview.image, '123').root, preview.root);
    preview.image.setAttribute('data-ui-tracking-context', 'x'.repeat(4097));
    assert.equal(e.c.findNativeHoverPreview(preview.image, '123').root, null,
        'an unverified episode and oversized tracking data cannot invent a series identity');
});

test('scroll, real resize, source release and route listener cleanup release a retained preview once', async () => {
    for (const reason of ['scroll', 'resize', 'source', 'route']) {
        const e = await openedPreview();
        const owner = e.c.activeNativeHover;
        if (reason === 'scroll') { e.c.handleTargetScroll(); e.c.handleTargetScroll(); }
        if (reason === 'resize') e.c.cancelResizeHover();
        if (reason === 'source') { e.c.clearSourceAlignment(); e.c.clearSourceAlignment(); }
        if (reason === 'route') {
            e.c.targetListenersActive = false; e.c.targetDocumentObserver = null;
            vm.runInContext(declaration('stopTargetEventListeners'), e.c);
            e.c.stopTargetEventListeners();
        }
        assert.equal(e.c.activeNativeHover, null, reason);
        assert.equal(owner.previewRoot, null, reason);
        assert.equal(owner.previewClone, null, reason);
        assert.equal(e.c.performanceDiagnostics.hoverLifecycle.previewReleases, 1, reason);
        assert.equal(e.events.length, 6, reason);
        assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000, reason);
    }
});

test('removed previews and missed pointer-out events recover through existing mutation and physical movement handlers', async () => {
    for (const reason of ['mutation', 'move', 'outside']) {
        const e = await openedPreview();
        const owner = e.c.activeNativeHover;
        if (reason !== 'outside') e.preview.root.isConnected = false;
        if (reason === 'mutation') {
            Object.assign(e.c, { location: { href: '/my-list' }, lastObservedUrl: '/my-list',
                targetDocumentObserver: {}, initializationBlockedSessionToken: null, completedSection: null });
            for (const name of ['mutationOnlyChangesScriptUi', 'handleTargetDocumentMutation']) vm.runInContext(declaration(name), e.c);
            e.c.handleTargetDocumentMutation([]);
        } else {
            e.c.handleTargetPointerMove(pointer(new Element('margin'), { type: 'pointermove', clientX: 40 }));
        }
        assert.equal(e.c.activeNativeHover, null, reason);
        assert.equal(owner.previewRoot, null, reason);
        assert.equal(e.events.length, 6, reason);
        assert.equal(e.c.activeClone, null, reason);
    }
});

test('a stale preview boundary or release cannot dispose of a newer native hover owner', async () => {
    const e = await openedPreview();
    const old = e.c.activeNativeHover;
    e.c.replayHoverOnNativeSource(e.sourceSlot, pointer(e.current()));
    const current = e.c.activeNativeHover;
    const events = e.events.length;
    assert.notEqual(current, old);
    assert.equal(old.previewRoot, null);
    e.c.releaseNativePreview(old, 'preview-leave');
    e.c.handleTargetPreviewPointerOut(pointer(e.preview.image, { type: 'pointerout', relatedTarget: new Element('margin') }));
    assert.equal(e.c.activeNativeHover, current);
    assert.equal(e.events.length, events);
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
});

test('dwell diagnostics distinguish cancelled intent and a target rejected when the dwell expires', async () => {
    const e = hoverEnvironment();
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.c.handleGridClonePointerLeave(e.clone, e.clone.__tmMyListItem);
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    e.clone.hovered = false;
    await e.advance(120);
    e.clone.hovered = true;
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    await e.advance(120);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.intentsQueued, 3);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.intentsCancelled, 1);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.dwellRejected, 1);
    assert.equal(e.c.performanceDiagnostics.hoverInteraction.dwellCompleted, 1);
    assert.equal(e.activations.length, 1);
});

async function diagnosedReplay() {
    const e = preparedHoverEnvironment();
    liveHoverGeometry(e);
    const activation = e.start();
    await e.flush(); await e.frame(); await activation;
    return e;
}

test('an unconfirmed replay gets one delayed presence check without another replay or explicit rectangle/style reads', async () => {
    const e = await diagnosedReplay();
    const owner = e.c.activeNativeHover;
    let hits = 0, searches = 0;
    e.c.document.elementFromPoint = () => { hits++; return e.current(); };
    e.c.document.querySelectorAll = () => { searches++; return []; };
    e.current().getBoundingClientRect = () => { throw new Error('Probe read card geometry'); };
    e.c.getComputedStyle = () => { throw new Error('Probe read computed style'); };
    await e.advance(899);
    assert.equal(hits, 0); assert.equal(searches, 0);
    await e.advance(1);
    const counters = e.c.performanceDiagnostics.hoverPreview;
    assert.equal(counters.checks, 1);
    assert.equal(counters.noPreviewRoot, 1);
    assert.equal(hits, 1); assert.equal(searches, 1);
    const observation = e.logs.find(entry => entry.name === 'hoverPreviewPresence').details;
    assert.equal(observation.result, 'no-preview-root-found');
    assert.equal(observation.pointerTarget, 'same-card');
    assert.equal(observation.sinceReplayMs, 900);
    assert.equal(owner.previewDiagnostic.clone, null);
    assert.equal(owner.previewDiagnostic.timer, null);
    assert.equal(e.events.length, 4);
    assert.equal(e.c.activeNativeHover, owner);
    await e.advance(10000);
    assert.equal(hits, 1); assert.equal(searches, 1);
});

test('an identified preview transfer completes presence diagnostics before the delayed search', async () => {
    const e = await openedPreview();
    e.c.document.elementFromPoint = () => { throw new Error('Unneeded hit test'); };
    e.c.document.querySelectorAll = () => { throw new Error('Unneeded preview search'); };
    assert.equal(e.c.performanceDiagnostics.hoverPreview.matchedTransfers, 1);
    assert.equal(e.c.performanceDiagnostics.hoverPreview.checks, 0);
    assert.equal(e.timers.size, 0);
    await e.advance(3000);
    assert.equal(e.c.performanceDiagnostics.hoverPreview.failed, 0);
    assert.equal(e.logs.filter(entry => entry.name === 'hoverPreviewPresence').length, 1);
});

test('presence checking distinguishes a matching pointer target from a matching root elsewhere without changing hover ownership', async () => {
    for (const atPointer of [true, false]) {
        const e = await diagnosedReplay();
        const owner = e.c.activeNativeHover;
        const preview = matchingPreview(e);
        let searches = 0;
        preview.root.getBoundingClientRect = () => { throw new Error('Presence was treated as visible geometry'); };
        e.c.document.elementFromPoint = () => atPointer ? preview.image : e.current();
        e.c.document.querySelectorAll = () => { searches++; return [preview.root]; };
        await e.advance(900);
        const counters = e.c.performanceDiagnostics.hoverPreview;
        assert.equal(counters.matchedAtPointer, atPointer ? 1 : 0);
        assert.equal(counters.matchedElsewhere, atPointer ? 0 : 1);
        assert.equal(searches, atPointer ? 0 : 1);
        assert.equal(e.c.activeNativeHover, owner);
        assert.equal(owner.previewRoot, undefined, 'a diagnostic observation cannot adopt a popup');
        assert.equal(e.events.length, 4);
    }
});

test('preview presence inspection caps root identity work and exports only scalar classifications', async () => {
    const e = await diagnosedReplay();
    const roots = Array.from({ length: 7 }, () => matchingPreview(e, '456').root);
    roots[6].querySelectorAll = () => { throw new Error('Root budget exceeded'); };
    e.c.document.querySelectorAll = () => roots;
    await e.advance(900);
    const observation = e.logs.find(entry => entry.name === 'hoverPreviewPresence').details;
    assert.equal(observation.result, 'preview-roots-unverified');
    assert.equal(observation.rootsExamined, 6);
    assert.equal(observation.truncated, true);
    assert.doesNotMatch(JSON.stringify(observation), /123|456|watch\/|previewModal|href|tracking/);
    assert.ok(Object.values(observation).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
});

test('grid and native source cards sharing preview classes cannot establish preview presence', async () => {
    const e = await diagnosedReplay();
    const clone = e.current();
    clone.id = 'bob-card'; clone.href = '/watch/123'; clone.querySelectorAll = () => [];
    const sourceRoot = new Element('bob-card', e.c.sourceState.scroller);
    sourceRoot.href = '/watch/123'; sourceRoot.querySelectorAll = () => [];
    e.c.document.elementFromPoint = () => clone;
    e.c.document.querySelectorAll = () => [clone, sourceRoot];
    await e.advance(900);
    const observation = e.logs.find(entry => entry.name === 'hoverPreviewPresence').details;
    assert.equal(observation.pointerTarget, 'same-card');
    assert.equal(observation.result, 'preview-roots-unverified');
    assert.equal(e.c.performanceDiagnostics.hoverPreview.matchedAtPointer, 0);
    assert.equal(e.c.performanceDiagnostics.hoverPreview.matchedElsewhere, 0);
});

test('preview presence timers are cancelled on ordinary exits, route cleanup, hidden tabs and listener shutdown', async () => {
    for (const action of ['scroll', 'resize', 'source', 'route', 'hidden', 'listeners']) {
        const e = await diagnosedReplay();
        const owner = e.c.activeNativeHover;
        if (action === 'scroll') e.c.handleTargetScroll();
        if (action === 'resize') e.c.cancelResizeHover();
        if (action === 'source') e.c.clearSourceAlignment(undefined, 'source-release');
        if (action === 'route') { e.c.isRouteSessionActive = () => false; e.c.clearSourceAlignment(undefined, 'route-leave'); }
        if (action === 'hidden') { e.c.document.visibilityState = 'hidden'; e.c.handleHoverDiagnosticVisibilityChange(); }
        if (action === 'listeners') {
            Object.assign(e.c, { targetListenersActive: false, targetDocumentObserver: null });
            vm.runInContext(declaration('stopTargetEventListeners'), e.c);
            e.c.stopTargetEventListeners();
        }
        assert.equal(e.timers.size, 0, action);
        assert.equal(owner.previewDiagnostic.clone, null, action);
        assert.equal(owner.previewDiagnostic.done, true, action);
        await e.advance(2000);
        assert.equal(e.c.performanceDiagnostics.hoverPreview.checks, 0, action);
    }
});

test('stale preview probe callbacks cannot inspect or mutate a newer hover or diagnostic route', async () => {
    for (const change of ['owner', 'route-counters', 'identity']) {
        const e = await diagnosedReplay();
        const owner = e.c.activeNativeHover;
        const callback = [...e.timers.values()][0].callback;
        if (change === 'owner') {
            e.c.replayHoverOnNativeSource(e.sourceSlot, pointer(e.current()));
            e.c.scheduleNativePreviewDiagnostic(e.c.activeNativeHover, e.current());
        }
        if (change === 'route-counters') e.c.performanceDiagnostics = e.c.createPerformanceDiagnostics();
        if (change === 'identity') e.card.href = '/watch/456';
        e.c.document.elementFromPoint = () => { throw new Error('Stale probe hit tested'); };
        const active = e.c.activeNativeHover;
        const eventCount = e.events.length;
        callback();
        assert.equal(e.c.activeNativeHover, active, change);
        assert.equal(e.events.length, eventCount, change);
        assert.equal(owner.previewDiagnostic.clone, null, change);
        assert.equal(e.c.performanceDiagnostics.hoverPreview.checks, 0, change);
        if (change === 'route-counters') assert.equal(e.c.performanceDiagnostics.hoverPreview.completed, 0);
    }
});

test('failed preview diagnostics leave native cleanup working and the route replay budget is finite', async () => {
    for (const failure of ['search', 'logging']) {
        const e = await diagnosedReplay();
        if (failure === 'search') e.c.document.querySelectorAll = () => { throw new Error('Search unavailable'); };
        else e.c.log = () => { throw new Error('Logging unavailable'); };
        await e.advance(900);
        if (failure === 'search') assert.equal(e.c.performanceDiagnostics.hoverPreview.failed, 1);
        else assert.equal(e.c.performanceDiagnostics.hoverInteraction.diagnosticFailures, 1);
        e.c.clearSourceAlignment();
        assert.equal(e.events.length, 6, failure);
        assert.equal(e.sourceSlot.getBoundingClientRect().left, 1000, failure);
    }

    const bounded = await diagnosedReplay();
    bounded.c.finishNativePreviewDiagnostic(bounded.c.activeNativeHover, { result: 'released-before-check', reason: 'test' });
    for (let index = 1; index < 50; index++) {
        const owner = { token: 1, replayedAt: 0 };
        bounded.c.activeNativeHover = owner;
        bounded.c.scheduleNativePreviewDiagnostic(owner, bounded.current());
        bounded.c.finishNativePreviewDiagnostic(owner, { result: 'released-before-check', reason: 'test' });
    }
    const counters = bounded.c.performanceDiagnostics.hoverPreview;
    assert.equal(counters.scheduled, 48);
    assert.equal(counters.completed, 48);
    assert.equal(counters.skippedAtLimit, 2);
    assert.equal(bounded.timers.size, 0);
});

test('the actual dwell delay reports a late timer rather than only its configured 120 ms', async () => {
    const e = hoverEnvironment();
    e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
    await e.advance(2400);
    assert.equal(e.activations.length, 1);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.dwellSamples, 1);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.dwellMaxMs, 2400);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.dwellTotalMs, 2400);
});

const hoverFrameFunctions = ['startHoverFrameDiagnostics', 'sampleHoverFrameDiagnostics'];

test('one bounded frame owner separates callback gaps by phase without reading DOM layout or logging each frame', async () => {
    const phases = [];
    const e = preparedHoverEnvironment();
    e.c.document = { visibilityState: 'visible', querySelector() { throw new Error('Frame DOM search'); } };
    e.c.getComputedStyle = () => { throw new Error('Frame style read'); };
    for (const name of hoverFrameFunctions) vm.runInContext(declaration(name), e.c);
    const activation = e.start();
    phases.push(e.c.hoverFrameDiagnosticOwner.phase);
    await e.flush(); await e.advance(84); await e.frame(); await activation;
    phases.push(e.c.hoverFrameDiagnosticOwner.phase);
    const counters = e.c.performanceDiagnostics.hoverFrames;
    assert.equal(counters.preparationSamples, 1);
    assert.equal(counters.preparationMaxMs, 100);
    assert.equal(counters.replaySamples, 0, 'preparation samples are not counted as popup replay samples');
    assert.equal(e.frames.size, 1, 'replay renews the preparation owner');
    const logCount = e.logs.length;
    await e.frame();
    await e.advance(44); await e.frame();
    assert.equal(counters.replaySamples, 2);
    assert.equal(counters.replayMaxMs, 60);
    assert.equal(counters.gapsOver50ms, 2);
    assert.equal(e.logs.length, logCount, 'callback samples only update scalar counters');
    e.c.handleTargetScroll();
    phases.push(e.c.hoverFrameDiagnosticOwner.phase);
    e.c.handleTargetScroll();
    assert.equal(e.frames.size, 1);
    await e.frame();
    assert.equal(counters.scrollSamples, 1);
    assert.deepEqual(phases, ['preparation', 'replay', 'scroll']);
    const copy = e.c.collectPerformanceDiagnostics();
    copy.hoverFrames.callbacks = -1;
    assert.ok(counters.callbacks > 0);
    e.c.stopHoverFrameDiagnostics();
    assert.equal(e.frames.size, 0);
    assert.equal(counters.active, false);
});

test('frame sampling stops at time, window and route limits and cannot restart an exhausted route', async () => {
    const e = environment(hoverFrameFunctions, { document: { visibilityState: 'visible' } });
    e.c.startHoverFrameDiagnostics('replay');
    await e.advance(2500); await e.frame();
    const counters = e.c.performanceDiagnostics.hoverFrames;
    assert.equal(counters.replayMaxMs, 2516, 'a delayed final callback is recorded before deadline cleanup');
    assert.equal(counters.stopReason, 'window-complete');
    assert.equal(e.frames.size, 0);
    e.c.startHoverFrameDiagnostics('preparation');
    for (let index = 0; index < counters.windowFrameLimit; index++) await e.frame(1);
    assert.equal(counters.stopReason, 'window-frame-limit');
    assert.equal(e.frames.size, 0);
    counters.callbacks = counters.routeFrameLimit - 1;
    e.c.startHoverFrameDiagnostics('scroll');
    await e.frame();
    assert.equal(counters.callbacks, counters.routeFrameLimit);
    assert.equal(counters.stopReason, 'route-frame-limit');
    for (let index = 0; index < 20; index++) e.c.startHoverFrameDiagnostics('intent');
    assert.equal(e.frames.size, 0);
    assert.equal(counters.active, false);
    assert.equal(e.timers.size, 0);
});

test('high-refresh sampling covers later hovers beyond the old 3000-callback budget while keeping one bounded owner', async () => {
    const e = environment(hoverFrameFunctions);
    for (let index = 0; index < 4000; index++) {
        if (index % 400 === 0) e.c.startHoverFrameDiagnostics('replay');
        await e.frame(4);
    }
    const counters = e.c.performanceDiagnostics.hoverFrames;
    assert.equal(counters.callbacks, 4000);
    assert.equal(counters.active, true);
    assert.equal(counters.maxGapMs, 4);
    assert.equal(e.frames.size, 1);
    assert.ok(counters.callbacks < counters.routeFrameLimit);
    e.c.stopHoverFrameDiagnostics();
    assert.equal(e.frames.size, 0);
});

test('a delayed dwell or replay transition cannot erase the pending callback stall or misattribute its phase', async () => {
    const e = environment(hoverFrameFunctions);
    e.c.startHoverFrameDiagnostics('intent');
    await e.frame();
    await e.advance(2000);
    e.c.startHoverFrameDiagnostics('preparation');
    await e.frame();
    const counters = e.c.performanceDiagnostics.hoverFrames;
    assert.equal(counters.maxGapMs, 2016);
    assert.equal(counters.mixedPhaseSamples, 1);
    assert.equal(counters.mixedPhaseMaxMs, 2016);
    assert.equal(counters.preparationSamples, 0);
    await e.frame();
    assert.equal(counters.preparationSamples, 1);
    assert.equal(counters.preparationMaxMs, 16);
    e.c.stopHoverFrameDiagnostics();
});

test('hidden tabs, route cleanup and obsolete callbacks stop diagnostics without writing into newer owners', async () => {
    const e = hoverEnvironment([...hoverFrameFunctions, 'stopTargetEventListeners'], {
        document: { visibilityState: 'visible' }, targetListenersActive: false, targetDocumentObserver: null
    });
    e.c.startHoverFrameDiagnostics('intent');
    const stale = [...e.frames.values()][0];
    const old = e.c.performanceDiagnostics.hoverFrames;
    e.c.document.visibilityState = 'hidden';
    e.c.handleHoverDiagnosticVisibilityChange();
    assert.equal(old.stopReason, 'hidden');
    assert.equal(e.frames.size, 0);
    await e.advance(5000);
    stale();
    assert.equal(old.callbacks, 0);
    e.c.document.visibilityState = 'visible';
    e.c.performanceDiagnostics = e.c.createPerformanceDiagnostics();
    e.c.startHoverFrameDiagnostics('scroll');
    stale();
    assert.equal(e.frames.size, 1);
    assert.equal(e.c.performanceDiagnostics.hoverFrames.callbacks, 0);
    e.c.stopTargetEventListeners();
    assert.equal(e.frames.size, 0, 'diagnostics stop even when normal route listeners have already stopped');
    e.c.startHoverFrameDiagnostics('preparation');
    e.c.isRouteSessionActive = () => false;
    await e.frame();
    assert.equal(e.c.performanceDiagnostics.hoverFrames.callbacks, 0);
    assert.equal(e.frames.size, 0);
});

test('unavailable or throwing sampling APIs fail safely without leaking private error details', async () => {
    for (const api of [undefined, () => { throw new Error('Private frame failure'); }]) {
        const e = environment(hoverFrameFunctions, { requestAnimationFrame: api });
        assert.doesNotThrow(() => e.c.startHoverFrameDiagnostics('intent'));
        assert.equal(e.c.performanceDiagnostics.hoverFrames.active, false);
        assert.equal(e.frames.size, 0);
        assert.equal(e.c.performanceDiagnostics.hoverFrames.stopReason, api ? 'api-failed' : 'unsupported');
        assert.doesNotMatch(JSON.stringify(e.c.collectPerformanceDiagnostics()), /Private frame failure/);
    }
});

test('a graft without React assignments is not marked ready for later clone reuse', async () => {
    const e = preparedHoverEnvironment({ graftStats: { fiberAssignments: 0, propsAssignments: 0 } });
    const activation = e.start();
    await e.flush();
    assert.equal(e.current().getAttribute('data-tm-hover-ready'), 'false');
    await e.frame();
    await activation;
    // Real-source replay can still work; absence of clone metadata does not
    // invent a fallback or incorrectly mark the clone ready for reuse.
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.events.length, 4);
});

test('an order-mismatch dialog stops preparation without an extra hover retry', async () => {
    const e = preparedHoverEnvironment();
    e.c.resolveExpectedPageSourceItem = async () => {
        e.calls.preparations++;
        return {
            status: 'mismatch', visibleIds: ['456'],
            positionMismatch: { item: e.clone.__tmMyListItem, deviation: { expectedIndex: 0, actualIndex: 20, delta: 20 } }
        };
    };
    await e.start();
    assert.equal(e.calls.dialogs, 1);
    assert.equal(e.calls.preparations, 1);
    assert.equal(e.events.length, 0);
    assert.equal(e.timers.size, 0);
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
    await e.advance(80);
    page = 1;
    acknowledgement.resolve({ page: 1, transform: 'after', signature: 'after', changed: true });
    await e.flush();
    assert.equal(clicks, 1);
    assert.equal(classes.has('fast'), true);
    await e.advance(40);
    settlement.resolve({ transform: 'after', signature: 'after', observedChange: true });
    await Promise.all([first, obsoleteQueued, latest]);
    assert.equal(clicks, 2);
    assert.equal(classes.has('fast'), false);
    assert.equal(properties.get('transition'), 'original');
    assert.equal(properties.get('animation'), 'original');
    assert.equal(restorations, 4);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.queueSamples, 3);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.queueMaxMs, 120);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.moveSamples, 2);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.acknowledgementSamples, 2);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.acknowledgementTotalMs, 80);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.settlementSamples, 2);
    assert.equal(e.c.performanceDiagnostics.hoverTiming.settlementTotalMs, 40);
});

test('Hawkins logical hover navigation avoids boundary detours while legacy cyclic navigation keeps wrapping', async () => {
    for (const [start, target, hawkins, avoided] of [[0, 6, true, 1], [6, 0, true, 1], [1, 6, true, 1], [0, 1, true, 0], [0, 6, false, 0]]) {
        let page = start;
        const directions = [];
        const e = environment(['goToPage'], {
            getCarouselDomRuntime: () => ({ profile: { navigationMode: hawkins ? 'hawkins' : 'legacy', pageMode: hawkins ? 'logical' : 'indicator' } }),
            pageCount: () => 7, selectedPage: () => page,
            moveOnePage: async (_, __, direction) => {
                directions.push(direction);
                page = hawkins ? Math.max(0, Math.min(6, page + direction)) : (page + direction + 7) % 7;
                return page;
            }
        });
        assert.equal(await e.c.goToPage({}, {}, target, 1, 1, true), target);
        assert.deepEqual(directions, hawkins ? Array(Math.abs(target - start)).fill(target > start ? 1 : -1) : [-1]);
        assert.equal(e.c.performanceDiagnostics.hoverLifecycle.boundaryDetoursAvoided, avoided);
    }
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

const nativeReadFunctions = [
    'nativeRect', 'nativeFilledSlots', 'nativeIndicatorItems', 'detectCarouselDomProfile',
    'getCarouselDomRuntime', 'resetCarouselDomRuntime', 'pageCount', 'selectedPage',
    'currentPageSlots', 'visibleSignature', 'netflixItemIndexFromSlot', 'normalizeNetflixLogicalIndex',
    'logicalSlotPositions', 'expectedLogicalIndicesForPage', 'logicalPageFromSlotPositions',
    'nativeLogicalPageState', 'forceLogicalPageSignature', 'readNativeMyListDomState',
    'nativeCarouselReadiness', 'carouselMoveButton'
];
function nativeReadEnvironment(mode = 'logical') {
    const counts = { profile: 0, indicators: 0, filled: 0, rects: 0, indices: 0 };
    const section = new Element('native-section');
    const scroller = new Element('native-scroller', section);
    let track = new Element('native-track', scroller);
    track.style = { getPropertyValue: () => '' };
    let slots = [], indicators = [], currentMode = mode;
    const control = new Element('button');
    control.setAttribute('tabindex', '0');
    section.querySelector = selector => {
        if (selector === 'scroller') return scroller;
        counts.profile++;
        if (selector.includes('button')) {
            return selector.includes('hawkins') === (currentMode === 'logical') ? control : null;
        }
        return slots[0] || null;
    };
    section.querySelectorAll = () => { counts.indicators++; return indicators; };
    scroller.querySelector = () => null;
    scroller.getBoundingClientRect = () => { counts.rects++; return { left: 0, right: 600 }; };
    const e = environment(nativeReadFunctions, {
        carouselDomRuntime: new WeakMap(),
        NETFLIX_DOM_SELECTORS: { carouselScroller: 'scroller', virtualSlot: 'slot', standardCard: 'card' },
        netflixDom: {
            findTrack: () => track,
            filledSlots: () => { counts.filled++; return slots; },
            directSlots: () => slots
        },
        netflixReactCarousel: { readItemIndex: slot => { counts.indices++; return { value: slot.index }; } },
        netflixGraphql: { readMyListTotalCount: () => 600 },
        findMyListSection: () => section, nativeCardIdentity: slot => String(slot.index),
        logicalVisibleSignature: () => '', parseSlotLayoutFormula: () => ({ columns: 6 }),
        sourceState: { section, scroller, track, totalCount: 600, layout: { columns: 6 } }
    });
    function mount(indices) {
        slots = indices.map((index, position) => {
            const slot = new Element(String(index), track);
            slot.index = index;
            slot.left = position * 100;
            slot.getBoundingClientRect = () => {
                counts.rects++;
                return { left: slot.left, width: 100, right: slot.left + 100 };
            };
            const card = new Element('card', slot);
            card.href = `/watch/${index}`;
            card.setAttribute('tabindex', '0');
            slot.querySelector = () => card;
            return slot;
        });
        return slots;
    }
    function resetCounts() { for (const key of Object.keys(counts)) counts[key] = 0; }
    return {
        ...e, counts, section, scroller, mount, resetCounts, slots: () => slots,
        setMode(value, selected = 0) {
            currentMode = value;
            indicators = value === 'indicator' ? [0, 1, 2].map(index => {
                const item = new Element();
                item.setAttribute('data-indicator-selected', String(index === selected));
                return item;
            }) : [];
        },
        replaceTrack() {
            track.isConnected = false;
            track = new Element('replacement-track', scroller);
            track.style = { getPropertyValue: () => '' };
            e.c.sourceState.track = track;
            return track;
        }
    };
}

test('one native-state sample shares profile, filled-slot, rectangle, and React-index reads', () => {
    const e = nativeReadEnvironment();
    e.mount([12, 13, 14, 15, 16, 17]);
    const state = e.c.readNativeMyListDomState();
    assert.equal(state.selectedPage, 2);
    assert.equal(state.currentPageCount, 6);
    assert.deepEqual(e.counts, { profile: 6, indicators: 1, filled: 1, rects: 7, indices: 6 });
    assert.equal(e.c.nativeReadScope, null);
    e.resetCounts();
    e.mount([18, 19, 20, 21, 22, 23]);
    assert.equal(e.c.readNativeMyListDomState().selectedPage, 3);
    assert.deepEqual(e.counts, { profile: 6, indicators: 1, filled: 1, rects: 7, indices: 6 });
});

test('indicator selection and carousel generation refresh on the next sample', () => {
    const e = nativeReadEnvironment('indicator');
    e.setMode('indicator', 1);
    e.mount([0, 1, 2, 3, 4, 5]);
    assert.equal(e.c.readNativeMyListDomState().selectedPage, 1);
    assert.equal(e.counts.indicators, 1);
    assert.equal(e.counts.profile, 6);
    e.setMode('indicator', 2);
    assert.equal(e.c.selectedPage(e.section), 2);
    e.setMode('logical');
    e.mount([6, 7, 8, 9, 10, 11]);
    assert.equal(e.c.selectedPage(e.section), 1);
    assert.equal(e.c.getCarouselDomRuntime(e.section).profile.generation, 'generation2');
});

test('readiness shares discovery and measures each active slot once even during sorting', () => {
    const e = nativeReadEnvironment();
    const slots = e.mount([5, 4, 3, 2, 1, 0]);
    slots.forEach((slot, index) => { slot.left = (5 - index) * 100; });
    const state = e.c.nativeCarouselReadiness(e.section, e.scroller, e.c.sourceState.track);
    assert.equal(state.currentCards, 6);
    assert.equal(e.counts.filled, 1);
    assert.equal(e.counts.rects, 7);
    assert.equal(e.counts.indicators, 1);
    // Six profile selectors plus the two independent button lookups.
    assert.equal(e.counts.profile, 8);
    assert.deepEqual(Array.from(e.c.currentPageSlots(e.scroller, e.c.sourceState.track), slot => slot.index), [0, 1, 2, 3, 4, 5]);
});

test('track replacement, membership changes, and resized columns use fresh state', () => {
    const e = nativeReadEnvironment();
    e.mount([12, 13, 14, 15, 16, 17]);
    assert.equal(e.c.selectedPage(e.section), 2);
    const replacement = e.replaceTrack();
    e.c.sourceState.totalCount = 19;
    e.c.sourceState.layout.columns = 4;
    e.mount([15, 16, 17, 18]);
    const state = e.c.readNativeMyListDomState();
    assert.equal(state.track, replacement);
    assert.equal(state.selectedPage, 4);
    assert.equal(state.currentPageCount, 4);
    assert.equal(state.pageSignature, '15|16|17|18');
    const slots = e.slots();
    slots.slice(1).forEach(slot => slot.querySelector().setAttribute('tabindex', '-1'));
    assert.equal(e.c.currentPageSlots(e.scroller, replacement).length, 4, 'partial tabbable hydration retains visible cards');
    slots[0].left = -200;
    slots[0].querySelector().setAttribute('tabindex', '-1');
    assert.equal(e.c.currentPageSlots(e.scroller, replacement).length, 3, 'next read observes changed geometry');
});

test('restoring a geometry proxy and resetting runtime invalidate reads inside a scope', () => {
    const e = nativeReadEnvironment();
    for (const name of ['restoreGeometryProxy', 'clearSourceAlignment']) vm.runInContext(declaration(name), e.c);
    const [slot] = e.mount([0]);
    const original = Object.getOwnPropertyDescriptor(slot, 'getBoundingClientRect');
    slot.getBoundingClientRect = () => ({ left: 900, width: 100 });
    e.c.activeGeometryProxy = { sourceSlot: slot, entries: [{ source: slot, descriptors: { getBoundingClientRect: original, getClientRects: null } }] };
    e.c.withNativeReadScope(() => {
        assert.equal(e.c.nativeRect(slot).left, 900);
        assert.equal(e.c.netflixItemIndexFromSlot(slot), 0);
        slot.index = 9;
        e.c.clearSourceAlignment();
        assert.equal(e.c.nativeRect(slot).left, 0);
        assert.equal(e.c.netflixItemIndexFromSlot(slot), 9);
        assert.equal(e.c.getCarouselDomRuntime(e.section).profile.pageMode, 'logical');
        e.setMode('indicator', 2);
        e.c.resetCarouselDomRuntime(e.section);
        assert.equal(e.c.selectedPage(e.section), 2);
    });
});

test('native read scopes end on exceptions and before asynchronous continuation', async () => {
    const e = nativeReadEnvironment();
    assert.throws(() => e.c.withNativeReadScope(() => { throw new Error('read failed'); }), /read failed/);
    assert.equal(e.c.nativeReadScope, null);
    const continuation = e.c.withNativeReadScope(async () => {
        await Promise.resolve();
        assert.equal(e.c.nativeReadScope, null);
    });
    assert.equal(e.c.nativeReadScope, null);
    await continuation;
});

test('ready hover and frame replay share reads while refreshing original geometry on each frame', async () => {
    const e = nativeReadEnvironment();
    for (const name of [...hoverFunctions, 'activateClone', 'findMountedSourceSlot', 'findActiveSourceSlot',
        'pairDomTrees', 'makeClientRectList', 'restoreGeometryProxy', 'clearSourceAlignment',
        'alignSourceSlotToClone', 'scheduleNativeHoverReplay']) vm.runInContext(declaration(name), e.c);
    const slots = e.mount([6, 7, 8, 9, 10, 11]);
    const item = { videoId: '6', href: '/watch/6', page: 1 };
    const grid = new Element('grid', e.section);
    const clone = new Element('clone', grid);
    clone.__tmHoverActivationGeneration = 1;
    clone.setAttribute('data-tm-hover-ready', 'true');
    clone.setAttribute('data-tm-backed-page', '1');
    clone.getBoundingClientRect = () => ({ left: 900, width: 100 });
    e.c.sourceState.grid = grid;
    e.c.ensureLiveNativeBinding = () => e.c.readNativeMyListDomState();
    e.c.findItemForSourceSlot = () => item;
    e.c.videoIdFromHref = href => href?.split('/').at(-1);
    e.c.prepareMountedPage = () => { throw new Error('Ready source should not prepare'); };
    e.c.replayHoverOnNativeSource = () => true;
    e.c.findGridClone = () => clone;
    // Start with the previous activation's grid proxy already installed.
    assert.equal(e.c.alignSourceSlotToClone(slots[0], clone), true);
    e.resetCounts();
    const activation = e.c.activateClone(item, clone, pointer(clone), 1);
    await e.flush();
    assert.equal(e.c.activeClone, clone);
    assert.equal(e.counts.filled, 1);
    assert.equal(e.counts.rects, 7);
    assert.equal(e.counts.indices, 6);
    assert.equal(e.counts.profile, 6);
    e.resetCounts();
    await e.frame();
    await activation;
    assert.equal(e.counts.filled, 1, 'frame validation shares both source lookups');
    assert.equal(e.counts.rects, 7, 'native geometry is sampled again in the replay frame');
    assert.equal(slots[0].getBoundingClientRect().left, 900, 'proxy is restored for Netflix popup placement');
    assert.equal(e.c.nativeReadScope, null);
});

test('binding adoption clears old grafts and does not retain reads collected before its writes', () => {
    const e = nativeReadEnvironment();
    for (const name of ['adoptLiveMyListSection', 'releaseGridReact', 'invalidateGridReact',
        'restoreGeometryProxy', 'clearSourceAlignment']) vm.runInContext(declaration(name), e.c);
    const slots = e.mount([0, 1, 2, 3, 4, 5]);
    const grid = new Element('grid'), status = new Element('status');
    grid.style = status.style = { setProperty() {} };
    const oldGraft = new Element('old-graft');
    e.c.graftedGridClones = new Set([oldGraft]);
    let cleared = 0;
    e.c.netflixReactHover = { clearClone: () => cleared++ };
    e.c.sourceState.grid = grid;
    e.c.sourceState.status = status;
    e.c.sourceState.items = [{ videoId: '0' }];
    const replacement = e.replaceTrack();
    e.c.sourceState.track = slots[0].parentElement;
    const nextScroller = new Element('next-scroller');
    nextScroller.getBoundingClientRect = e.scroller.getBoundingClientRect;
    nextScroller.insertAdjacentElement = status.insertAdjacentElement = () => {};
    e.c.sourceState.section = new Element('old-section');
    const query = e.section.querySelector;
    e.section.querySelector = selector => selector === 'scroller' ? nextScroller : query(selector);
    Object.assign(e.c, {
        STATUS_ID: 'status', GRID_ID: 'grid', SYNTHETIC_SECTION_ID: 'synthetic',
        SECTION_ATTR: 'section', document: { getElementById: () => null },
        clearLegacyEmptyState() {}, markOriginalHeader() {},
        measureVisibleLayout: () => ({ columns: 6 }), measureNativeCarouselGap: () => 0,
        parkSource() { e.mount([6, 7, 8, 9, 10, 11]); },
        applyGridGeometry: () => ({ left: 0, width: 600 }),
        syncStatusTypography() {}, applyOriginalMyListVisibility() {},
        resizeObserver: null, viewOriginalMyList: true,
        ResizeObserver: class { observe() {} }, layoutSummary: layout => layout
    });
    e.c.withNativeReadScope(() => {
        assert.equal(e.c.nativeFilledSlots(replacement)[0].index, 0);
        assert.equal(e.c.adoptLiveMyListSection({ section: e.section, scroller: nextScroller, track: replacement }), true);
        assert.equal(e.c.nativeFilledSlots(replacement)[0].index, 6);
        assert.equal(e.c.selectedPage(e.section), 1);
    });
    assert.equal(cleared, 1);
    assert.equal(e.c.graftedGridClones.size, 0);
});

test('constant-size logical candidates preserve exact pages including overlapping tails', () => {
    const e = environment(['expectedLogicalIndicesForPage', 'logicalPageFromSlotPositions']);
    const expected = e.c.expectedLogicalIndicesForPage;
    let candidates = 0;
    e.c.expectedLogicalIndicesForPage = (...args) => { candidates++; return expected(...args); };
    const positions = indices => indices.map(logicalIndex => ({ logicalIndex }));
    for (let count = 1; count <= 120; count++) {
        for (let columns = 1; columns <= 12; columns++) {
            for (let page = 0; page < Math.ceil(count / columns); page++) {
                const indices = Array.from(expected(count, columns, page));
                candidates = 0;
                assert.equal(e.c.logicalPageFromSlotPositions(positions(indices.reverse()), count, columns), page);
                assert.ok(candidates <= 2);
            }
        }
    }
    for (const count of [30, 150, 600]) {
        candidates = 0;
        const tail = Array.from(expected(count, 6, Math.ceil(count / 6) - 1));
        assert.equal(e.c.logicalPageFromSlotPositions(positions(tail), count, 6), count / 6 - 1);
        assert.equal(candidates, 1, `last page of ${count} needs one exact candidate`);
    }
    for (const indices of [[], [0, 1, 2], [0, 0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [-1, 0, 1, 2, 3, 4], [12, 13, 14, 15, 16, 17], [null, 1, 2, 3, 4, 5]]) {
        assert.equal(e.c.logicalPageFromSlotPositions(positions(indices), 12, 6), null);
    }
});

function graftEnvironment(extraNames = [], overrides = {}) {
    const cleared = [];
    const e = environment(['releaseGridReact', 'invalidateGridReact', 'findGridClone', 'setGridClone', ...extraNames], {
        graftedGridClones: new Set(), sourceState: { cloneMap: new Map() },
        itemKey: item => item.videoId,
        netflixReactHover: { clearClone: clone => { cleared.push(clone); delete clone.__reactProps$test; } },
        ...overrides
    });
    function add(id, ready = true) {
        const clone = new Element(id);
        clone.setAttribute('data-tm-hover-ready', String(ready));
        clone.setAttribute('data-tm-backed-page', '0');
        clone.setAttribute('data-tm-react-grafted', 'true');
        clone.__reactProps$test = { onMouseOver() {} };
        e.c.setGridClone({ videoId: id }, clone);
        return clone;
    }
    return { ...e, cleared, add };
}

test('graft invalidation visits only six tracked cards for 30, 150, and 600-card grids', () => {
    for (const size of [30, 150, 600]) {
        const e = graftEnvironment([], { document: { getElementById() { throw new Error('Full-grid lookup'); } } });
        for (let index = 0; index < size; index++) e.c.setGridClone({ videoId: String(index) }, new Element());
        const clones = Array.from({ length: 6 }, (_, index) => e.add(String(index)));
        e.c.invalidateGridReact(clones[0]);
        assert.equal(e.cleared.length, 5);
        assert.equal(e.c.graftedGridClones.size, 1);
        e.c.invalidateGridReact();
        assert.equal(e.cleared.length, 6);
        assert.equal(e.c.graftedGridClones.size, 0);
        e.c.invalidateGridReact();
        assert.equal(e.cleared.length, 6, 'repeated scroll invalidation has no extra work');
    }
});

test('replacement and disconnected exceptions release grafts, including non-ready metadata', () => {
    const e = graftEnvironment();
    const old = e.add('123');
    const fresh = e.add('123', false);
    assert.equal(e.c.graftedGridClones.has(old), false);
    assert.equal(old.__reactProps$test, undefined);
    assert.equal(e.c.graftedGridClones.has(fresh), true);
    fresh.isConnected = false;
    e.c.invalidateGridReact(fresh);
    assert.equal(e.c.graftedGridClones.size, 0);
    assert.equal(fresh.__reactProps$test, undefined);
    assert.equal(fresh.getAttribute('data-tm-hover-ready'), null);
});

test('removal and route cleanup release tracked metadata even if the grid is detached', () => {
    const e = graftEnvironment(['applyLegacyRemoval', 'cleanupTargetSessionDom'], {
        itemKey: item => `v:${item.videoId}`,
        rememberUndoEntry: () => {}, reindexLegacyItemsAfterDelta: () => {},
        clearSourceAlignment: () => {}, restoreActiveCarouselStyles: () => {},
        GRID_ID: 'grid', STATUS_ID: 'status', LEGACY_EMPTY_STATE_ID: 'empty',
        ORDER_MISMATCH_DIALOG_ID: 'dialog', STYLE_ID: 'style', SYNTHETIC_SECTION_ID: 'synthetic',
        document: { getElementById: () => null }
    });
    const removed = e.add('123');
    removed.remove = () => { removed.isConnected = false; };
    e.c.sourceState.items = [{ videoId: '123' }, { videoId: '456' }];
    assert.equal(e.c.applyLegacyRemoval('123'), true);
    assert.equal(removed.__reactProps$test, undefined);
    e.add('456').isConnected = false;
    e.c.sourceState = null;
    e.c.cleanupTargetSessionDom();
    assert.equal(e.c.graftedGridClones.size, 0);
});

test('live clone creation uses the resolved page without per-card native state reads', () => {
    const e = preparedHoverEnvironment();
    e.c.selectedPage = () => { throw new Error('Per-clone page read'); };
    const result = e.c.makeLiveClone(e.sourceSlot, e.clone.__tmMyListItem, e.clone, 8);
    assert.equal(result.fresh.getAttribute('data-tm-backed-page'), '8');
});

test('disabled interaction traces construct no payload while warnings remain formatted and retained', () => {
    const writes = [], investigationLog = [];
    const e = environment(['appendInvestigationLog', 'retainedInvestigationLog', 'log', 'warn'], {
        investigationLog, investigationLogStart: 0, MAX_LOG_ENTRIES: 5, LOG_PREFIX: 'test',
        formatLogValue: value => typeof value === 'string' ? value : JSON.stringify(value),
        formatSystemTimestamp: () => 'now', console: { log: (...args) => writes.push(args), warn: (...args) => writes.push(args) }
    });
    let payloads = 0;
    const payload = () => { payloads++; return ['source trace', { videoId: '123', href: '/watch/123' }]; };
    e.c.trace(payload);
    assert.equal(payloads, 0);
    assert.equal(writes.length, 0);
    e.c.warn('failed source', { videoId: '123', href: '/watch/123' });
    assert.match(e.c.retainedInvestigationLog()[0], /WARN.*123.*\/watch\/123/);
    e.c.VERBOSE_INTERACTION_LOGS = true;
    e.c.trace(payload);
    assert.equal(payloads, 1);
    assert.equal(writes.length, 2);
});

test('circular diagnostics retain the newest entries in chronological copied-report order', () => {
    const investigationLog = [];
    const e = environment(['appendInvestigationLog', 'retainedInvestigationLog'], {
        investigationLog, investigationLogStart: 0, MAX_LOG_ENTRIES: 5000,
        formatLogValue: value => value, formatSystemTimestamp: () => 'now'
    });
    investigationLog.splice = () => { throw new Error('Linear buffer maintenance'); };
    for (let index = 0; index < 10003; index++) e.c.appendInvestigationLog('INFO', [String(index)]);
    const retained = e.c.retainedInvestigationLog();
    assert.equal(retained.length, 5000);
    assert.match(retained[0], / 5003$/);
    assert.match(retained[4999], / 10002$/);
    for (let index = 1; index < retained.length; index++) {
        assert.equal(Number(retained[index].split(' ').at(-1)), 5003 + index);
    }
});

class ConstructionNode extends Element {
    constructor(id = '', parent = null) {
        super(id, parent);
        this.isConnected = false;
        this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
        this.classList = { add() {}, remove() {}, contains: () => true };
        this.listeners = new Map();
    }
    setConnected(connected) {
        this.isConnected = connected;
        for (const child of this.children) child.setConnected(connected);
    }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        return siblings[siblings.indexOf(this) + 1] || null;
    }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, before) {
        child.remove();
        const index = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(index, 0, child);
        child.parentElement = this;
        child.setConnected(this.isConnected);
        return child;
    }
    insertAdjacentElement(_, child) {
        const index = this.parentElement.children.indexOf(this);
        this.parentElement.insertBefore(child, this.parentElement.children[index + 1] || null);
    }
    remove() {
        if (this.parentElement) {
            const index = this.parentElement.children.indexOf(this);
            if (index >= 0) this.parentElement.children.splice(index, 1);
        }
        this.parentElement = null;
        this.setConnected(false);
    }
    querySelector(selector) {
        return this.querySelectorAll('*').find(node => node.id === selector) || null;
    }
    querySelectorAll(selector) {
        if (selector.startsWith(':scope')) return this.children;
        const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        return selector === '*' ? all : all.filter(node => node.id === selector);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    replaceWith(fresh) {
        const parent = this.parentElement;
        parent.insertBefore(fresh, this);
        this.remove();
    }
    cloneNode() {
        if (this.cloneCounter) this.cloneCounter.count++;
        const clone = new ConstructionNode(this.id);
        clone.cloneCounter = this.cloneCounter;
        clone.attributes = new Map(this.attributes);
        for (const key of ['href', 'src', 'markup']) clone[key] = this[key];
        for (const child of this.children) clone.appendChild(child.cloneNode(true));
        return clone;
    }
}

function constructionEnvironment() {
    const section = new ConstructionNode('section');
    section.setConnected(true);
    const scroller = section.appendChild(new ConstructionNode('scroller'));
    const track = scroller.appendChild(new ConstructionNode('track'));
    const status = section.appendChild(new ConstructionNode('status'));
    const oldGrid = section.appendChild(new ConstructionNode('grid'));
    const created = [], logs = [], warnings = [];
    const template = new ConstructionNode('slot');
    template.cloneCounter = { count: 0 };
    template.markup = 'original-template';
    template.appendChild(new ConstructionNode('card'));
    const image = template.appendChild(new ConstructionNode('img'));
    image.setAttribute('srcset', 'native-srcset');
    const layout = { columns: 6, rowGap: 10 };
    const e = environment([
        'sleep', 'runConstructionChunks', 'buildGraphqlMyListItems', 'collectFreshMyListCarouselItems', 'assertRouteSession',
        'createRouteSessionCancelledError', 'isRouteSessionCancelledError', 'initializationError',
        'buildGrid', 'normalizeClone', 'ensureManualViewingControls', 'copyItemAttributes', 'associateGridHoverItem', 'ensureGridHoverBehavior',
        'itemKey', 'clearRunningSession', 'retryPendingMyListMutations', 'tryApplyMyListMutation',
        'applyLegacyRemoval', 'applyLegacyAddition', 'disposeMyListMutation',
        'cardSourceForItem', 'createItemClone', 'releaseItemCardSnapshot',
        'rememberUndoEntry', 'pruneUndoEntries', 'normalizeNetflixUiText', 'videoIdFromHref',
        'itemFromSlot', 'visibleNativeItems', 'findNativeMyListItemByVideoId'
    ], {
        GRID_ID: 'grid', STATUS_ID: 'status', SYNTHETIC_SECTION_ID: 'synthetic', SECTION_ATTR: 'section',
        NETFLIX_DOM_SELECTORS: { standardCard: 'card', carouselScroller: 'scroller' },
        URL,
        location: { origin: 'https://www.netflix.com', href: 'https://www.netflix.com/browse/my-list' },
        document: {
            getElementById: id => [section, ...section.querySelectorAll('*')].find(node => node.id === id) || null,
            createElement: () => { const node = new ConstructionNode(); created.push(node); return node; }
        },
        sourceState: { section, scroller, track, grid: oldGrid, status, layout, items: [], cloneMap: new Map(), itemMap: new Map() },
        pendingMyListMutations: new Map(), recentRemovedMyListItems: new Map(),
        UNDO_ENTRY_TTL_MS: 30000,
        running: true, runningSessionToken: 1, responsiveRefreshing: false,
        clearLegacyEmptyState() {}, invalidateGridReact() {}, releaseGridReact() {}, clearSourceAlignment() {},
        applyGridGeometry: () => ({ left: 10, width: 600 }),
        updateStatus: () => status, formatHeaderParts: () => 'header', syncStatusTypography() {},
        responsiveSignature: () => 'geometry', responsivePageShape: () => 'pages',
        resizeObserver: null, ResizeObserver: class { observe() {} disconnect() {} }, viewOriginalMyList: true,
        layoutSummary: value => value, scheduleResponsiveRefresh() {},
        videoIdFromGraphqlNode: node => node?.id || '', firstGraphqlText: value => typeof value === 'string' ? value : '',
        firstGraphqlImageUrl: value => typeof value === 'string' ? value : '',
        refreshNativeSectionAfterDelta: () => ({}), readNativeMyListDomState: () => ({}),
        netflixDom: { directSlots: track => track.children },
        currentPageSlots: (_, track) => track.children, findAnyStandardCardItemByVideoId: () => null,
        reindexLegacyItemsAfterDelta() {},
        log: (name, details) => logs.push({ name, details }), warn: (name, details) => warnings.push({ name, details })
    });
    function edges(count) {
        return Array.from({ length: count }, (_, index) => ({ node: {
            id: String(index + 1), displayString: `Title ${index + 1}`, contextualArtwork: `https://images.test/${index + 1}.jpg`
        } }));
    }
    function items(count) {
        return Array.from({ length: count }, (_, index) => {
            const snapshot = template.cloneNode(true);
            const href = `https://www.netflix.com/browse?jbv=${index + 1}`;
            snapshot.markup = `native-markup-${index + 1}`;
            snapshot.querySelector('card').href = href;
            snapshot.querySelector('card').setAttribute('aria-label', `Native ${index + 1}`);
            snapshot.querySelector('img').src = `native-${index + 1}.jpg`;
            return {
                videoId: String(index + 1), href, ariaLabel: `Native ${index + 1}`,
                page: Math.floor(index / layout.columns), snapshot
            };
        });
    }
    async function drain() {
        await e.flush();
        let yields = 0;
        while ([...e.timers.values()].some(timer => timer.due <= e.c.performance.now())) {
            assert.ok(++yields < 200, 'construction must finish in bounded chunks');
            await e.advance(0);
        }
        await e.flush();
        return yields;
    }
    return { ...e, section, scroller, track, status, oldGrid, layout, template, created, logs, warnings, edges, items, drain };
}

test('large construction uses task yields with bounded item batches; small builds avoid timers', async () => {
    for (const count of [6, 24, 30, 150, 600]) {
        const e = constructionEnvironment();
        const built = [];
        const completion = e.c.runConstructionChunks(count, index => { built.push(index); }, () => {});
        assert.equal(built.length, Math.min(count, 24));
        assert.equal(e.timers.size, count > 24 ? 1 : 0);
        const yields = await e.drain();
        assert.equal(await completion, true);
        assert.deepEqual(built, Array.from({ length: count }, (_, index) => index));
        assert.equal(yields, Math.ceil(count / 24) - 1);
    }
});

test('construction also yields for expensive individual cards before the count cap', async () => {
    const e = constructionEnvironment();
    let elapsed = 0, built = 0;
    e.c.performance = { now: () => elapsed };
    const completion = e.c.runConstructionChunks(5, () => { built++; elapsed += 4; }, () => {});
    assert.equal(built, 2);
    assert.equal(e.timers.size, 1);
    await e.advance(0);
    assert.equal(built, 4);
    await e.advance(0);
    assert.equal(await completion, true);
    assert.equal(built, 5);
});

test('compact GraphQL items preserve exact order, labels, artwork, pages, and frozen template markup', async () => {
    const e = constructionEnvironment();
    const input = e.edges(150);
    input.splice(10, 0, {}, input[0]);
    const completion = e.c.buildGraphqlMyListItems(input, 150, 6, e.template, 1);
    e.template.markup = 'recycled-live-template';
    await e.drain();
    const items = await completion;
    assert.equal(items.length, 150);
    items.forEach((item, index) => {
        assert.equal(item.videoId, String(index + 1));
        assert.equal(item.logicalIndex, index);
        assert.equal(item.page, Math.floor(index / 6));
        assert.equal(item.ariaLabel, `Title ${index + 1}`);
        assert.equal(item.cardTemplate, items[0].cardTemplate);
        assert.equal(item.cardTemplate.markup, 'original-template');
        assert.equal(item.cardTemplate.isConnected, false);
        assert.equal(item.snapshot, undefined);
        const clone = e.c.createItemClone(item);
        assert.equal(clone.querySelector('card').href, `https://www.netflix.com/browse?jbv=${index + 1}`);
        assert.equal(clone.querySelector('img').src, `https://images.test/${index + 1}.jpg`);
        assert.equal(clone.querySelector('img').getAttribute('srcset'), null);
    });
});

test('invalid or incomplete snapshot inputs retain the native-scan fallback contract', async () => {
    const e = constructionEnvironment();
    assert.equal(await e.c.buildGraphqlMyListItems([], 1, 6, e.template, 1), null);
    assert.equal(await e.c.buildGraphqlMyListItems(null, 1, 6, e.template, 1), null);
    assert.equal(await e.c.buildGraphqlMyListItems(e.edges(2), 2, 6, new ConstructionNode('no-card'), 1), null);
    assert.equal(e.timers.size, 0);
});

test('snapshot construction cancels after a yield without reading more edges', async () => {
    const e = constructionEnvironment();
    let reads = 0;
    e.c.videoIdFromGraphqlNode = node => { reads++; return node.id; };
    const completion = e.c.buildGraphqlMyListItems(e.edges(600), 600, 6, e.template, 1);
    const rejection = assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    assert.equal(reads, 24);
    e.c.isRouteSessionActive = () => false;
    await e.drain();
    await rejection;
    assert.equal(reads, 24);
    assert.equal(e.created.length, 0);
});

test('chunked grid publishes its complete tree and maps once while preserving card interactions', async () => {
    const e = constructionEnvironment();
    const items = e.items(150), state = e.c.sourceState;
    const oldMap = state.cloneMap;
    const completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 150, 1);
    await e.flush();
    assert.equal(e.created[0].children.length, 24);
    assert.equal(e.created[0].isConnected, false);
    assert.equal(e.oldGrid.isConnected, true);
    assert.equal(state.cloneMap, oldMap);
    assert.equal(state.cloneMap.size, 0);
    await e.drain();
    const grid = await completion;
    assert.equal(grid.isConnected, true);
    assert.equal(e.oldGrid.isConnected, false);
    assert.equal(state.grid, grid);
    assert.equal(state.cloneMap.size, 150);
    assert.equal(state.itemMap.size, 150);
    assert.equal(grid.children.length, 150);
    assert.equal(e.logs.filter(entry => entry.name === 'legacyGridBuilt').length, 1);
    assert.deepEqual([...grid.listeners.keys()], ['pointerover', 'pointerout']);
    grid.children.forEach((clone, index) => {
        assert.equal(clone.__tmMyListItem, items[index]);
        assert.equal(clone.getAttribute('data-tm-item-order'), String(index));
        assert.equal(clone.getAttribute('data-tm-item-page'), String(Math.floor(index / 6)));
        assert.equal(clone.querySelector('card').tabIndex, 0);
        assert.equal(clone.querySelector('img').loading, 'lazy');
        assert.equal(clone.querySelector('img').decoding, 'async');
    });
});

test('route cancellation, state replacement, and native-source replacement cannot publish a partial grid', async () => {
    for (const change of ['route', 'state', 'section', 'track']) {
        const e = constructionEnvironment();
        const state = e.c.sourceState, oldMap = state.cloneMap;
        const completion = e.c.buildGrid(e.section, e.scroller, e.items(600), e.layout, 600, 1);
        const code = ['route', 'state'].includes(change) ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'GRID_BUILD_SOURCE_REPLACED';
        const rejection = assert.rejects(completion, { code });
        if (change === 'route') e.c.isRouteSessionActive = () => false;
        if (change === 'state') e.c.sourceState = { cloneMap: new Map(), grid: new ConstructionNode('new-session') };
        if (change === 'section') e.section.setConnected(false);
        if (change === 'track') state.track = new ConstructionNode('replacement-track');
        await e.drain();
        await rejection;
        assert.equal(e.created[0].children.length, 24);
        assert.equal(e.created[0].isConnected, false);
        assert.equal(state.cloneMap, oldMap);
        assert.equal(e.logs.filter(entry => entry.name === 'legacyGridBuilt').length, 0);
    }
});

test('an individual clone failure leaves the current frame and maps intact', async () => {
    const e = constructionEnvironment();
    const items = e.items(150);
    items[25].snapshot.cloneNode = () => { throw new Error('Clone failed'); };
    const oldMap = e.c.sourceState.cloneMap;
    const completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 150, 1);
    const rejection = assert.rejects(completion, /Clone failed/);
    await e.drain();
    await rejection;
    assert.equal(e.oldGrid.isConnected, true);
    assert.equal(e.c.sourceState.cloneMap, oldMap);
    assert.equal(e.created[0].isConnected, false);
});

test('queued add/remove deltas apply after complete publication and stay deferred during a source retry', async () => {
    const e = constructionEnvironment();
    const added = { videoId: '999', page: 0, snapshot: e.template.cloneNode(true) };
    const mutations = [
        { videoId: '2', action: 'remove' },
        { videoId: '999', action: 'add', preferredIndex: 0, fallbackItem: added }
    ];
    for (const mutation of mutations) {
        e.c.pendingMyListMutations.set(mutation.videoId, mutation);
        assert.equal(e.c.tryApplyMyListMutation(mutation), false);
        assert.equal(mutation.deferredWhileBusy, true);
    }
    e.c.clearRunningSession(1, false);
    assert.equal(e.c.pendingMyListMutations.size, 2);
    assert.equal(mutations.every(mutation => mutation.deferredWhileBusy), true);
    e.c.running = true;
    e.c.runningSessionToken = 1;
    const completion = e.c.buildGrid(e.section, e.scroller, e.items(150), e.layout, 150, 1);
    await e.drain();
    const grid = await completion;
    e.c.clearRunningSession(1);
    assert.equal(e.c.pendingMyListMutations.size, 0);
    assert.equal(e.c.sourceState.items.length, 150);
    assert.equal(e.c.sourceState.itemMap.has('v:2'), false);
    assert.equal(e.c.sourceState.itemMap.has('v:999'), true);
    assert.equal(grid.children[0].__tmMyListItem, added);
    assert.equal(grid.children.length, 150);
});

function initializationEnvironment(count = 150) {
    const e = constructionEnvironment();
    const bootstrap = { totalCount: count, graphqlEdges: e.edges(count), graphqlPageCount: 2, graphqlHasNextPage: false };
    const runtime = { profile: { pageMode: 'logical' } };
    const adapterStart = source.indexOf('    const netflixGraphql = Object.freeze({');
    const adapterEnd = source.indexOf('\n    async function waitForMyListTotalCount(', adapterStart);
    assert.ok(adapterStart >= 0 && adapterEnd > adapterStart);
    vm.runInContext(source.slice(adapterStart, adapterEnd), e.c);
    Object.assign(e.c, {
        running: false, runningSessionToken: null, completedSection: null, initializationBlockedSessionToken: null,
        targetSessionEntryKind: 'initial', waitingForNativeEmpty: false, missingSectionSince: 0,
        TOTAL_COUNT_TIMEOUT_MS: 5000, NATIVE_READY_TIMEOUT_MS: 8000,
        SOURCE_PARKED_CLASS: 'parked',
        findMyListSection: () => e.section, cleanupOldArtifacts() {}, addStyle() {}, markOriginalHeader() {},
        measureVisibleLayout: () => e.layout, measureNativeCarouselGap: () => 10,
        placeLegacyFrame: () => ({ grid: e.oldGrid, status: e.status }), applyOriginalMyListVisibility() {},
        waitForMyListTotalCount: async () => count,
        findMyListGraphqlEntry: () => ({ value: { entities: { edges: [] } } }),
        fetchFreshMyListBootstrapViaCarousel: async () => bootstrap,
        logCarouselDomProfile() {}, resetCarouselDomRuntime: () => runtime, getCarouselDomRuntime: () => runtime,
        waitForNativeCarouselReady: async () => ({ ready: true, empty: false }),
        requireNativeReactCarouselTotalCount: () => ({ totalCount: count }),
        currentPageSlots: () => [e.template],
        netflixDom: { findTrack: () => e.track, filledSlots: () => [e.template], directSlots: () => [e.template] },
        selectedPage: () => 0, pageCount: () => Math.ceil(count / 6), carouselDomProfileSummary: () => ({}),
        navigator: { language: 'en' }, window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 },
        getHtmlLanguage: () => 'en', getNetflixLanguage: () => 'en', getUiLocale: () => 'en', getLogLocale: () => 'en',
        SCRIPT_VERSION: 'test', currentGridGeometry: () => ({ left: 10, width: 600 }), parkSource() {},
        resetOrderMismatchStateAfterInitialization() {}, collectRuntimeSnapshot: () => ({}),
        formatInitializationErrorMeta: error => error.code,
        collectAllItems: () => { throw new Error('Complete GraphQL snapshots should skip native scan'); },
        cleanupTargetSessionDom() { e.oldGrid.remove(); }, scheduleRun() {}
    });
    vm.runInContext(declaration('runScript'), e.c);
    return { ...e, async flush() { await e.flush(); await e.flush(); } };
}

test('GraphQL adapter awaits snapshot chunks and initialization awaits grid publication before becoming idle', async () => {
    const e = initializationEnvironment();
    const completion = e.c.runScript(1);
    await e.flush();
    assert.equal(e.c.running, true, e.warnings.map(entry => entry.details.error?.message).join(', '));
    assert.equal(e.timers.size, 1);
    assert.equal(e.created.length, 0, 'snapshot chunks finish before grid construction starts');
    const mutation = { videoId: '2', action: 'remove' };
    e.c.pendingMyListMutations.set('2', mutation);
    assert.equal(e.c.tryApplyMyListMutation(mutation), false);
    await e.drain();
    await completion;
    assert.equal(e.c.running, false);
    assert.equal(e.c.completedSection, e.section);
    assert.equal(e.c.sourceState.grid.isConnected, true);
    assert.equal(e.c.sourceState.items.length, 149, 'queued removal runs only after publication');
    assert.equal(e.c.sourceState.itemMap.size, 149);
    assert.equal(e.c.pendingMyListMutations.size, 0);
    assert.equal(e.logs.filter(entry => entry.name === 'initializationCompleted').length, 1);
    assert.equal(e.warnings.length, 0);
    assert.equal(e.timers.size, 1, 'the queued removal leaves only its future Undo expiry timer');
    await e.advance(30000);
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(e.timers.size, 0);
});

test('route leave during snapshot chunks exits initialization cleanly and preserves a newer session owner', async () => {
    const e = initializationEnvironment();
    const completion = e.c.runScript(1);
    await e.flush();
    assert.equal(e.timers.size, 1);
    e.c.runningSessionToken = 2;
    e.c.sourceState = { newerSession: true };
    e.c.isRouteSessionActive = token => token === 2;
    await e.drain();
    await completion;
    assert.equal(e.c.runningSessionToken, 2);
    assert.equal(e.c.running, true);
    assert.equal(e.c.sourceState.newerSession, true);
    assert.equal(e.created.length, 0);
    assert.equal(e.warnings.length, 0);
});

test('native-source replacement during grid construction restarts initialization with queued deltas intact', async () => {
    const e = initializationEnvironment();
    const completion = e.c.runScript(1);
    await e.flush();
    for (let attempts = 0; attempts < 20 && e.created.length === 0 && e.timers.size; attempts++) await e.advance(0);
    assert.equal(e.created.filter(node => node.id === 'grid').length, 1, e.warnings.map(entry => entry.details.error?.message).join(', '));
    assert.equal(e.created[0].children.length, 24);
    const mutation = { videoId: '2', action: 'remove' };
    e.c.pendingMyListMutations.set('2', mutation);
    assert.equal(e.c.tryApplyMyListMutation(mutation), false);
    e.track.setConnected(false);
    let restarts = 0;
    e.c.runScript = token => {
        assert.equal(token, 1);
        assert.equal(e.c.pendingMyListMutations.size, 1);
        assert.equal(mutation.deferredWhileBusy, true);
        assert.equal(e.c.running, false);
        restarts++;
    };
    await e.drain();
    await completion;
    assert.equal(restarts, 1);
    assert.equal(e.c.initializationBlockedSessionToken, null);
    assert.equal(e.c.completedSection, null);
    assert.equal(e.created[0].isConnected, false);
    assert.equal(e.warnings.length, 0);
});

test('small builds revalidate cancellation before their awaited result can be published', async () => {
    for (const kind of ['snapshot', 'grid']) {
        const e = constructionEnvironment();
        const completion = kind === 'snapshot'
            ? e.c.buildGraphqlMyListItems(e.edges(6), 6, 6, e.template, 1)
            : e.c.buildGrid(e.section, e.scroller, e.items(6), e.layout, 6, 1);
        e.c.isRouteSessionActive = () => false;
        await assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
        assert.equal(e.timers.size, 0);
        assert.equal(e.oldGrid.isConnected, true);
        assert.equal(e.c.sourceState.cloneMap.size, 0);
    }
});

function retainedCardTrees(state, undoEntries = new Map()) {
    const roots = new Set(state.cloneMap.values());
    const items = [...state.items, ...[...undoEntries.values()].map(entry => entry.item)];
    for (const item of items) {
        if (item.snapshot) roots.add(item.snapshot);
        if (item.cardTemplate) roots.add(item.cardTemplate);
    }
    return roots;
}

test('GraphQL construction allocates one shared template and one displayed tree per title', async () => {
    for (const count of [30, 150, 600]) {
        const e = constructionEnvironment();
        const collection = e.c.buildGraphqlMyListItems(e.edges(count), count, 6, e.template, 1);
        await e.drain();
        const items = await collection;
        assert.equal(new Set(items.map(item => item.cardTemplate)).size, 1);
        assert.equal(e.template.cloneCounter.count, 1, 'collection allocates no per-title DOM');
        const completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, count, 1);
        await e.drain();
        const grid = await completion;
        assert.equal(e.template.cloneCounter.count, count + 1, 'one template plus the displayed trees');
        assert.equal(retainedCardTrees(e.c.sourceState).size, count, 'previously two trees per title');
        items.forEach((item, index) => {
            assert.equal(item.snapshot, undefined);
            assert.equal(item.cardTemplate, null);
            assert.equal(item.imageUrl, '');
            const clone = grid.children[index];
            assert.equal(clone.querySelector('card').href, item.href);
            assert.equal(clone.querySelector('card').getAttribute('aria-label'), `Title ${index + 1}`);
            assert.equal(clone.querySelector('img').src, `https://images.test/${index + 1}.jpg`);
        });
    }
});

test('native cards retain distinct markup and controls while releasing all captured trees after publication', async () => {
    const e = constructionEnvironment();
    const items = e.items(150);
    const snapshots = items.map(item => item.snapshot);
    snapshots.forEach((snapshot, index) => {
        snapshot.setAttribute('native-variant', String(index));
        snapshot.querySelector('card').setAttribute('data-uia', `native-card-${index}`);
        if (index % 2) {
            const button = snapshot.appendChild(new ConstructionNode('button'));
            button.setAttribute('aria-label', `Action ${index}`);
        }
    });
    const completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 150, 1);
    assert.equal(items.every(item => item.snapshot), true, 'unfinished builds retain their captured sources');
    await e.drain();
    const grid = await completion;
    assert.equal(retainedCardTrees(e.c.sourceState).size, 150);
    items.forEach((item, index) => {
        assert.equal(item.snapshot, null);
        const clone = grid.children[index];
        assert.notEqual(clone, snapshots[index]);
        assert.equal(clone.markup, `native-markup-${index + 1}`);
        assert.equal(clone.getAttribute('native-variant'), String(index));
        assert.equal(clone.querySelector('card').href, item.href);
        assert.equal(clone.querySelector('card').getAttribute('data-uia'), `native-card-${index}`);
        assert.equal(clone.querySelector('img').src, `native-${index + 1}.jpg`);
        assert.equal(clone.querySelector('img').getAttribute('srcset'), 'native-srcset');
        assert.equal(clone.querySelector('button')?.getAttribute('aria-label') ?? null, index % 2 ? `Action ${index}` : null);
    });
});

test('GraphQL template materialization preserves missing-artwork and missing-image behavior', async () => {
    for (const missing of ['artwork', 'image']) {
        const e = constructionEnvironment();
        e.template.querySelector('img').src = 'native-image.jpg';
        if (missing === 'image') e.template.querySelector('img').remove();
        const edges = e.edges(1);
        if (missing === 'artwork') edges[0].node.contextualArtwork = '';
        const items = await e.c.buildGraphqlMyListItems(edges, 1, 6, e.template, 1);
        const grid = await e.c.buildGrid(e.section, e.scroller, items, e.layout, 1, 1);
        const image = grid.children[0].querySelector('img');
        if (missing === 'image') assert.equal(image, null);
        else {
            assert.equal(image.src, 'native-image.jpg');
            assert.equal(image.getAttribute('srcset'), 'native-srcset');
        }
        assert.equal(grid.children[0].querySelector('card').href, items[0].href);
    }
});

test('a cancelled initial grid retains its native snapshots or shared template for a safe retry', async () => {
    for (const mode of ['native', 'graphql']) {
        const e = constructionEnvironment();
        let items = e.items(30);
        if (mode === 'graphql') {
            const collection = e.c.buildGraphqlMyListItems(e.edges(30), 30, 6, e.template, 1);
            await e.drain();
            items = await collection;
        }
        const sources = items.map(item => e.c.cardSourceForItem(item));
        const completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 30, 1);
        const rejection = assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
        e.c.isRouteSessionActive = () => false;
        await e.drain();
        await rejection;
        items.forEach((item, index) => assert.equal(e.c.cardSourceForItem(item), sources[index]));
        e.c.isRouteSessionActive = token => token === 1;
        const retry = e.c.buildGrid(e.section, e.scroller, items, e.layout, 30, 1);
        await e.drain();
        await retry;
        assert.equal(retainedCardTrees(e.c.sourceState).size, 30);
    }
});

test('rebuilding published items uses current markup and leaves the existing grid intact on cancellation', async () => {
    const e = constructionEnvironment();
    const items = e.items(30);
    let completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 30, 1);
    await e.drain();
    const originalGrid = await completion;
    const originalMap = e.c.sourceState.cloneMap;
    originalGrid.children[0].markup = 'latest-current-card';
    originalGrid.children[0].setAttribute('data-tm-hover-ready', 'true');
    completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 30, 1);
    const rejection = assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    e.c.isRouteSessionActive = () => false;
    await e.drain();
    await rejection;
    assert.equal(e.c.sourceState.cloneMap, originalMap);
    assert.equal(originalGrid.isConnected, true);
    assert.equal(items.every(item => !item.snapshot && !item.cardTemplate), true);
    e.c.isRouteSessionActive = token => token === 1;
    completion = e.c.buildGrid(e.section, e.scroller, items, e.layout, 30, 1);
    await e.drain();
    const grid = await completion;
    assert.equal(originalGrid.isConnected, false);
    assert.equal(grid.children[0].markup, 'latest-current-card');
    assert.equal(grid.children[0].getAttribute('data-tm-hover-ready'), null);
    assert.equal(retainedCardTrees(e.c.sourceState).size, 30);
});

test('remove and Undo retain only the removed tree then restore membership, order, and per-card controls', async () => {
    for (const mode of ['native', 'graphql']) {
        const e = constructionEnvironment();
        let items = e.items(6);
        if (mode === 'graphql') items = await e.c.buildGraphqlMyListItems(e.edges(6), 6, 6, e.template, 1);
        const grid = await e.c.buildGrid(e.section, e.scroller, items, e.layout, 6, 1);
        const item = items[2], removed = grid.children[2];
        removed.appendChild(new ConstructionNode('button')).setAttribute('aria-label', 'Preserved action');
        for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted',
            'data-tm-preparing', 'data-tm-hover-token']) removed.setAttribute(name, 'true');
        removed.__reactProps$test = { onMouseOver() {} };
        e.c.graftedGridClones = new Set([removed]);
        e.c.netflixReactHover = { clearClone: clone => { delete clone.__reactProps$test; } };
        vm.runInContext(declaration('releaseGridReact'), e.c);
        assert.equal(e.c.applyLegacyRemoval('3'), true);
        const entry = e.c.recentRemovedMyListItems.get('3');
        assert.equal(entry.item, item);
        assert.equal(entry.index, 2);
        assert.equal(entry.item.snapshot, removed);
        assert.equal(removed.parentElement, null);
        assert.equal(removed.__reactProps$test, undefined);
        assert.equal(e.c.graftedGridClones.size, 0);
        assert.equal(retainedCardTrees(e.c.sourceState, e.c.recentRemovedMyListItems).size, 6);
        assert.equal(e.c.applyLegacyAddition(entry.item, entry.index, 'undo'), true);
        assert.deepEqual(Array.from(e.c.sourceState.items, item => item.videoId), ['1', '2', '3', '4', '5', '6']);
        const restored = grid.children[2];
        assert.equal(restored.__tmMyListItem, item);
        assert.equal(restored.querySelector('card').href, item.href);
        assert.equal(restored.querySelector('card').tabIndex, 0);
        assert.equal(restored.querySelector('button').getAttribute('aria-label'), 'Preserved action');
        assert.equal(restored.__reactProps$test, undefined);
        for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted',
            'data-tm-preparing', 'data-tm-hover-token']) assert.equal(restored.getAttribute(name), null);
        assert.equal(item.snapshot, null);
        assert.equal(e.c.recentRemovedMyListItems.size, 0);
        assert.equal(retainedCardTrees(e.c.sourceState).size, 6);
    }
});

test('hover replacements become the sole card source for rebuild and Undo without retaining the old tree', async () => {
    const e = constructionEnvironment();
    for (const name of ['makeLiveClone', 'findGridClone', 'setGridClone', 'releaseGridReact']) {
        vm.runInContext(declaration(name), e.c);
    }
    e.c.graftedGridClones = new Set();
    e.c.netflixReactHover = {
        graftTreeToClone(_, clone) {
            clone.__reactProps$test = { onMouseOver() {} };
            clone.setAttribute('data-tm-react-grafted', 'true');
            return { fiberAssignments: 0, propsAssignments: 1 };
        },
        clearClone: clone => { delete clone.__reactProps$test; }
    };
    const items = e.items(6);
    const grid = await e.c.buildGrid(e.section, e.scroller, items, e.layout, 6, 1);
    const old = grid.children[0], item = items[0];
    const liveSource = e.template.cloneNode(true);
    liveSource.markup = 'fresh-live-markup';
    liveSource.querySelector('card').href = item.href;
    const { fresh } = e.c.makeLiveClone(liveSource, item, old, 0);
    old.replaceWith(fresh);
    e.c.setGridClone(item, fresh);
    assert.equal(e.c.cardSourceForItem(item), fresh);
    assert.equal(item.snapshot, null);
    assert.equal(item.cardTemplate, undefined);
    const rebuilt = e.c.createItemClone(item);
    assert.equal(rebuilt.markup, 'fresh-live-markup');
    assert.equal(rebuilt.getAttribute('data-tm-hover-ready'), null);
    assert.equal(rebuilt.__reactProps$test, undefined);
    assert.equal(e.c.applyLegacyRemoval('1'), true);
    assert.equal(e.c.recentRemovedMyListItems.get('1').item.snapshot, fresh);
    assert.equal(fresh.__reactProps$test, undefined);
    assert.equal(e.c.applyLegacyAddition(item, 0, 'undo'), true);
    assert.equal(grid.children[0].markup, 'fresh-live-markup');
    assert.equal(retainedCardTrees(e.c.sourceState).has(old), false);
    assert.equal(retainedCardTrees(e.c.sourceState).has(fresh), false);
});

test('expired Undo entries release their last retained snapshot reference when pruned', async () => {
    const e = constructionEnvironment();
    const items = e.items(6);
    await e.c.buildGrid(e.section, e.scroller, items, e.layout, 6, 1);
    e.c.applyLegacyRemoval('1');
    const removed = e.c.recentRemovedMyListItems.get('1').item.snapshot;
    assert.equal(retainedCardTrees(e.c.sourceState, e.c.recentRemovedMyListItems).has(removed), true);
    await e.advance(30001);
    e.c.pruneUndoEntries();
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(retainedCardTrees(e.c.sourceState, e.c.recentRemovedMyListItems).has(removed), false);
});

test('Undo expiry releases idle snapshots at 30 seconds using one finite timer and aggregate diagnostics', async () => {
    const e = constructionEnvironment();
    await e.c.buildGrid(e.section, e.scroller, e.items(6), e.layout, 6, 1);
    e.c.applyLegacyRemoval('1');
    const removed = e.c.recentRemovedMyListItems.get('1').item.snapshot;
    assert.equal(e.timers.size, 1);
    await e.advance(29999);
    assert.equal(e.c.recentRemovedMyListItems.size, 1);
    await e.advance(1);
    assert.equal(e.c.recentRemovedMyListItems.size, 0, 'expiry needs no later removal, Undo click or explicit prune');
    assert.equal(retainedCardTrees(e.c.sourceState, e.c.recentRemovedMyListItems).has(removed), false);
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.undoExpiryTimer, null);
    const counters = e.c.collectPerformanceDiagnostics().undoRetention;
    assert.equal(counters.expired, 1);
    assert.equal(counters.expiryCallbacks, 1);
    assert.equal(counters.schedules, 1);
    const expiry = e.logs.find(entry => entry.name === 'undoEntriesExpired');
    assert.deepEqual({ ...expiry.details }, { expired: 1, remaining: 0, pendingFallbacksPreserved: 0 });
    const work = structuredClone(e.c.collectPerformanceDiagnostics());
    await e.advance(120000);
    assert.deepEqual(structuredClone(e.c.collectPerformanceDiagnostics()), work);
});

test('Undo expiry retains a single next-expiry timer across staggered removals and consumes it after Undo', async () => {
    const e = constructionEnvironment();
    await e.c.buildGrid(e.section, e.scroller, e.items(6), e.layout, 6, 1);
    e.c.applyLegacyRemoval('1');
    const firstTimer = [...e.timers.keys()][0];
    await e.advance(5000);
    e.c.applyLegacyRemoval('2');
    assert.deepEqual([...e.timers.keys()], [firstTimer], 'a later expiry does not restart the earliest timer');
    const first = e.c.recentRemovedMyListItems.get('1');
    assert.equal(e.c.applyLegacyAddition(first.item, first.index, 'undo'), true);
    assert.equal(e.timers.size, 1);
    assert.equal([...e.timers.values()][0].due, 35000);
    assert.equal(e.c.collectPerformanceDiagnostics().undoRetention.consumed, 1);
    await e.advance(25000);
    assert.equal(e.c.recentRemovedMyListItems.size, 1);
    await e.advance(5000);
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(e.timers.size, 0);
    e.c.applyLegacyRemoval('1');
    const latest = e.c.recentRemovedMyListItems.get('1');
    assert.equal(e.c.applyLegacyAddition(latest.item, latest.index, 'undo'), true);
    assert.equal(e.timers.size, 0, 'consuming the last entry cancels its expiry timer');
});

test('Undo expiry preserves a queued mutation fallback after removing the Undo cache entry', async () => {
    const e = constructionEnvironment();
    await e.c.buildGrid(e.section, e.scroller, e.items(6), e.layout, 6, 1);
    e.c.applyLegacyRemoval('1');
    const entry = e.c.recentRemovedMyListItems.get('1');
    const snapshot = entry.item.snapshot;
    const mutation = { videoId: '1', action: 'add', fallbackItem: entry.item, preferredIndex: entry.index,
        timeoutId: null, observer: null };
    e.c.pendingMyListMutations.set('1', mutation);
    await e.advance(30000);
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(mutation.fallbackItem.snapshot, snapshot);
    assert.equal(e.c.cardSourceForItem(mutation.fallbackItem), snapshot);
    const expiry = e.logs.find(row => row.name === 'undoEntriesExpired');
    assert.equal(expiry.details.pendingFallbacksPreserved, 1);
    e.c.running = false;
    assert.equal(e.c.tryApplyMyListMutation(mutation, 'after-expiry'), true);
    assert.equal(e.c.sourceState.items.length, 6);
    assert.equal(e.c.pendingMyListMutations.size, 0);
    assert.equal(mutation.fallbackItem.snapshot, null);
    assert.equal(e.timers.size, 0);
});

test('Undo expiry clears route-owned timers and ignores an obsolete callback after a new session', async () => {
    const e = fetchEnvironment(6);
    e.routeLifecycle();
    await e.c.buildGrid(e.section, e.scroller, e.items(6), e.layout, 6, 1);
    e.c.applyLegacyRemoval('1');
    const obsoleteCallback = [...e.timers.values()][0].callback;
    e.c.suspendTargetSession('undo-test-leave');
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(e.c.undoExpiryTimer, null);
    e.c.scheduleRun = () => {};
    e.c.startTargetSession('undo-test-enter');
    e.c.isRouteSessionActive = token => e.c.targetSessionActive && token === e.c.routeSessionToken;
    e.c.rememberUndoEntry(e.items(1)[0], 0);
    const currentTimer = e.c.undoExpiryTimer;
    obsoleteCallback();
    assert.equal(e.c.undoExpiryTimer, currentTimer);
    assert.equal(e.timers.size, 1);
    assert.equal(e.c.recentRemovedMyListItems.size, 1);
    await e.advance(30000);
    assert.equal(e.c.recentRemovedMyListItems.size, 0);
    assert.equal(e.timers.size, 0);
});

test('stale same-id item objects cannot borrow another item tree', async () => {
    const e = constructionEnvironment();
    const items = e.items(1);
    await e.c.buildGrid(e.section, e.scroller, items, e.layout, 1, 1);
    const stale = { videoId: '1', href: items[0].href };
    assert.equal(e.c.cardSourceForItem(stale), null);
    assert.throws(() => e.c.createItemClone(stale), /No card markup/);
    assert.equal(e.c.cardSourceForItem(items[0]), e.c.sourceState.grid.children[0]);
});

test('native order reads allocate no card trees and native additions capture only the matching card', () => {
    const e = constructionEnvironment();
    const items = e.items(6);
    for (const item of items) e.track.appendChild(item.snapshot);
    const before = e.template.cloneCounter.count;
    const live = { scroller: e.scroller, track: e.track, selectedPage: 2 };
    assert.deepEqual(Array.from(e.c.visibleNativeItems(live), item => item.videoId), ['1', '2', '3', '4', '5', '6']);
    assert.equal(e.template.cloneCounter.count, before);
    assert.equal(e.c.findNativeMyListItemByVideoId('missing', live), null);
    assert.equal(e.template.cloneCounter.count, before);
    const found = e.c.findNativeMyListItemByVideoId('6', live);
    assert.equal(found.videoId, '6');
    assert.equal(found.page, 2);
    assert.equal(found.snapshot.markup, 'native-markup-6');
    assert.equal(e.template.cloneCounter.count, before + 1);
});

function nativeCollectionEnvironment(mode, windows, totalCount = 4) {
    const e = constructionEnvironment();
    let currentPage = 0;
    const runtime = { profile: { pageMode: mode, generation: mode === 'logical' ? 2 : 1, navigationMode: mode },
        signatureToPage: new Map(), pageToSignature: new Map(), currentPage: 0 };
    const cleanup = new Set();
    const pages = windows.map((entries, page) => entries.map(entry => {
        const slot = e.template.cloneNode(true);
        const card = slot.querySelector('card');
        card.href = entry.missingHref ? '' : `https://www.netflix.com/browse?jbv=${entry.id}`;
        card.setAttribute('aria-label', `Title ${entry.id}`);
        slot.itemIndex = entry.index;
        slot.setAttribute('native-variant', `page-${page}-title-${entry.id}`);
        return slot;
    }));
    const state = () => ({ page: currentPage, slots: pages[currentPage],
        positions: pages[currentPage].map(slot => ({ slot, itemIndex: slot.itemIndex, logicalIndex: slot.itemIndex })),
        itemIndices: pages[currentPage].map(slot => slot.itemIndex), logicalIndices: pages[currentPage].map(slot => slot.itemIndex) });
    Object.assign(e.c, {
        FAST_MOVE_CLASS: 'fast', LOGICAL_COLLECTION_TIMEOUT_MS: 120000, PAGE_STABLE_TIMEOUT_MS: 2000,
        PARTIAL_PAGE_RECOVERY_TIMEOUT_MS: 2000,
        detectCarouselDomProfile: () => runtime.profile, resetCarouselDomRuntime: () => runtime, getCarouselDomRuntime: () => runtime,
        carouselDomProfileSummary: () => ({ pageMode: mode }),
        currentPageSlots: () => pages[currentPage], pageCount: () => pages.length, selectedPage: () => currentPage,
        nativeLogicalPageState: state, requireNativeLogicalPageState: state,
        waitStableCurrentPage: async () => pages[currentPage],
        trackTransformValue: () => `page-${currentPage}`,
        goToPage: async (_, __, page) => { currentPage = page; return page; },
        moveOnePage: async () => { currentPage++; return currentPage; },
        restoreNativePageFast: async (_, __, ___, ____, _____, page) => { currentPage = page; return true; },
        forceLogicalPageSignature: (_, signature, page) => { runtime.signatureToPage.set(signature, page); },
        carouselMoveButton: () => ({ button: {}, selector: 'right' }), carouselMoveButtonDisabled: () => false,
        captureInlineStyleProperty: (node, key) => ({ value: node.style.getPropertyValue(key) }),
        restoreInlineStyleProperty: (node, key, saved) => {
            if (saved.value) node.style.setProperty(key, saved.value);
            else node.style.removeProperty(key);
        },
        registerActiveCarouselStyleCleanup: callback => cleanup.add(callback), unregisterActiveCarouselStyleCleanup: callback => cleanup.delete(callback),
        logOperationTimeout() {}, initializationTimeoutError: (stage, _, details) => e.c.initializationError('TIMEOUT', stage, 'timeout', details)
    });
    const styles = new Map(), classes = new Set();
    e.track.style = { setProperty: (key, value) => styles.set(key, value),
        getPropertyValue: key => styles.get(key) || '', removeProperty: key => styles.delete(key) };
    e.section.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
    e.c.sourceState.layout.columns = 3;
    e.track.style.setProperty('transition', 'original-transition');
    e.track.style.setProperty('animation', 'original-animation');
    for (const name of ['visibleSignature', 'itemKeyFromCard', 'collectAllItemsLogical', 'collectAllItems']) {
        vm.runInContext(declaration(name), e.c);
    }
    return { ...e, pages, runtime, cleanup, async scan() {
        const pending = e.c.collectAllItems(e.section, e.scroller, e.track, totalCount, 1);
        let settled = false;
        pending.then(() => { settled = true; }, () => { settled = true; });
        for (let attempt = 0; attempt < 20 && !settled; attempt++) {
            await e.flush();
            if (e.frames.size) await e.frame();
        }
        assert.equal(settled, true, 'modeled collection must finish within its finite windows');
        return pending;
    } };
}

const overlapCollectionWindows = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }, { id: 3, index: 2 }],
    [{ id: 2, index: 1 }, { id: 3, index: 2 }, { id: 4, index: 3 }]
];

test('native collection snapshots accepted cards once across overlapping logical and indicator windows', async () => {
    for (const mode of ['logical', 'indicator']) {
        const e = nativeCollectionEnvironment(mode, overlapCollectionWindows);
        const before = e.template.cloneCounter.count;
        const items = await e.scan();
        assert.deepEqual(Array.from(items, item => item.videoId), ['1', '2', '3', '4']);
        assert.equal(e.template.cloneCounter.count - before, 4, 'duplicate metadata must be checked before cloning');
        assert.equal(items[1].snapshot.getAttribute('native-variant'), 'page-0-title-2');
        assert.equal(items[3].snapshot.getAttribute('native-variant'), 'page-1-title-4');
        if (mode === 'logical') assert.deepEqual(Array.from(items, item => item.logicalIndex), [0, 1, 2, 3]);
        assert.deepEqual(Array.from(items, item => item.page), [0, 0, 0, 1]);
        const work = e.c.collectPerformanceDiagnostics().nativeCollection;
        assert.equal(work.metadataReads, 6);
        assert.equal(work.snapshotsCaptured, 4);
        assert.equal(work.duplicateSnapshotsAvoided, 2);
        assert.equal(work.consistencyFailures, 0);
        const completion = e.logs.find(row => row.name === 'fullCollectionCompleted');
        assert.deepEqual({ ...completion.details.snapshotWork }, { ...work });
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.track.style.getPropertyValue('animation'), 'original-animation');
        assert.equal(e.section.classList.contains('fast'), false);
        assert.equal(e.cleanup.size, 0);
    }
});

test('logical native collection rejects changed indices and moved titles before snapshotting the conflicting card', async () => {
    for (const scenario of ['changed-content', 'moved-title', 'invalid-index']) {
        const changed = scenario === 'changed-content' ? { id: 9, index: 1 }
            : { id: 2, index: scenario === 'moved-title' ? 3 : -1 };
        const e = nativeCollectionEnvironment('logical', [overlapCollectionWindows[0],
            [changed, { id: 3, index: 2 }, { id: 4, index: 3 }]]);
        const before = e.template.cloneCounter.count;
        const reason = scenario === 'changed-content' ? 'logical-index-content-changed-during-scan'
            : scenario === 'moved-title' ? 'video-id-moved-during-scan' : 'invalid-logical-index';
        await assert.rejects(e.scan(), error => error.code === 'COLLECTION_INCOMPLETE' && error.details.reason === reason);
        assert.equal(e.template.cloneCounter.count - before, 3);
        assert.equal(e.c.collectPerformanceDiagnostics().nativeCollection.consistencyFailures, 1);
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.cleanup.size, 0);
    }
});

test('native collection skips incomplete card metadata without a snapshot or loss of later valid index coverage', async () => {
    const e = nativeCollectionEnvironment('logical', [
        [{ id: 1, index: 0 }, { id: 2, index: 1 }, { id: 3, index: 2, missingHref: true }],
        overlapCollectionWindows[1]
    ]);
    const before = e.template.cloneCounter.count;
    const items = await e.scan();
    assert.equal(items.length, 4);
    assert.equal(e.template.cloneCounter.count - before, 4);
    const work = e.c.collectPerformanceDiagnostics().nativeCollection;
    assert.equal(work.invalidMetadata, 1);
    assert.equal(work.duplicateSnapshotsAvoided, 1);
    assert.equal(work.snapshotsCaptured, 4);
});

test('native collection cancellation preserves cleanup and takes no snapshots from the obsolete next window', async () => {
    for (const mode of ['logical', 'indicator']) {
        const e = nativeCollectionEnvironment(mode, overlapCollectionWindows);
        const wait = e.c.waitStableCurrentPage;
        let calls = 0;
        e.c.waitStableCurrentPage = async (...args) => {
            if (++calls === 2) e.c.isRouteSessionActive = () => false;
            return wait(...args);
        };
        const before = e.template.cloneCounter.count;
        await assert.rejects(e.scan(), error => e.c.isRouteSessionCancelledError(error));
        assert.equal(e.template.cloneCounter.count - before, 3);
        assert.equal(e.cleanup.size, 0);
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.frames.size, 0);
    }
});

test('failed addition leaves membership, maps, and retained fallback intact for retry', async () => {
    const e = constructionEnvironment();
    await e.c.buildGrid(e.section, e.scroller, e.items(1), e.layout, 1, 1);
    const added = { videoId: '99', page: 0, snapshot: e.template.cloneNode(true) };
    const snapshot = added.snapshot, cloneNode = snapshot.cloneNode;
    snapshot.cloneNode = () => { throw new Error('Clone failed'); };
    assert.throws(() => e.c.applyLegacyAddition(added), /Clone failed/);
    assert.equal(e.c.sourceState.items.length, 1);
    assert.equal(e.c.sourceState.cloneMap.size, 1);
    assert.equal(e.c.sourceState.grid.children.length, 1);
    assert.equal(added.snapshot, snapshot);
    snapshot.cloneNode = cloneNode;
    assert.equal(e.c.applyLegacyAddition(added), true);
    assert.equal(added.snapshot, null);
    assert.equal(e.c.sourceState.items.length, 2);
    assert.equal(retainedCardTrees(e.c.sourceState).size, 2);
});

function fetchDeferred() {
    let resolve, reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function abortableFetchResult(value, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function fetchEnvironment(count = 150) {
    const e = initializationEnvironment(count);
    e.c.netflixGraphql = vm.runInContext('netflixGraphql', e.c);
    const requests = [], responses = [];
    e.c.document.documentElement = { lang: 'en' };
    Object.assign(e.c, {
        AbortController, routeFetchControllers: new Map(),
        FRESH_MY_LIST_FETCH_TIMEOUT_MS: 10000, GRAPHQL_COLLECTION_PAGE_SIZE: 75, GRAPHQL_COLLECTION_MAX_PAGES: 8,
        findMyListGraphqlEntry: () => ({ key: 'MyList', value: { _id: 'row-id', entities: { totalCount: count } } }),
        netflixModelData: () => null, carouselArtworkVariables: () => ({}),
        tryMountedSinglePageFastBootstrap: async () => null,
        measureEmptyLayout: () => e.layout,
        beginSourceScan() {}, ensureFreshIndicatorPageZeroAnchor: async () => {},
        fetch: async (url, options) => {
            const request = { url, options, body: options.body ? JSON.parse(options.body) : null };
            requests.push(request);
            const next = responses.shift();
            if (!next) throw new Error('Unexpected fetch: ' + url);
            if (next.error) throw next.error;
            if (next.waitFetch) await abortableFetchResult(next.waitFetch.promise, options.signal);
            return {
                ok: (next.status || 200) === 200, status: next.status || 200, statusText: 'test', url,
                async text() {
                    request.bodyRead = true;
                    if (next.waitBody) await abortableFetchResult(next.waitBody.promise, options.signal);
                    return next.raw ?? JSON.stringify(next.payload);
                }
            };
        }
    });
    for (const name of ['isRouteSessionActive', 'createRouteFetch', 'finishRouteFetch', 'abortObsoleteRouteFetches',
        'fetchMyListCarouselPage', 'carouselFetchError', 'fetchFreshMyListBootstrapViaCarousel',
        'collectFreshMyListCarouselItems', 'fetchFreshMyListBootstrapViaPage', 'fetchFreshMyListBootstrap',
        'firstVideoIdFromCarouselNode', 'extractFreshMyListBootstrap']) vm.runInContext(declaration(name), e.c);
    function page(totalCount, ids, hasNextPage = false, endCursor = null) {
        return { payload: { data: { node: {
            __typename: 'PinotCarouselSection',
            entities: { totalCount, edges: ids.map(id => ({ node: {
                id: String(id), videoId: String(id), displayString: `Title ${id}`, contextualArtwork: `https://images.test/${id}.jpg`
            } })), pageInfo: { hasNextPage, endCursor } }
        } } } };
    }
    function collect(bootstrap, totalCount = count) {
        return e.c.netflixGraphql.collectLogicalItems({ bootstrap, totalCount, columns: 6, templateSlot: e.template, sessionToken: e.c.routeSessionToken });
    }
    function routeLifecycle() {
        Object.assign(e.c, {
            scheduled: false, scheduledRunTimer: null, resizeObserver: null, responsiveRefreshTimer: null,
            cleanupTargetSessionDom() {}, stopTargetEventListeners() {}, startTargetEventListeners() {},
            resetDetachedTargetState() {}, clearPendingMyListMutations() { e.c.pendingMyListMutations.clear(); }
        });
        for (const name of ['suspendTargetSession', 'startTargetSession']) vm.runInContext(declaration(name), e.c);
    }
    return { ...e, requests, responses, page, collect, routeLifecycle };
}

test('SPA indicator and not-yet-mounted modes bootstrap one page without optional pagination', async () => {
    for (const mounted of [true, false]) {
        const e = fetchEnvironment(150);
        e.c.targetSessionEntryKind = 'spa';
        e.c.getCarouselDomRuntime = () => ({ profile: { pageMode: 'indicator' } });
        if (!mounted) {
            e.scroller.id = 'delayed-scroller';
            e.c.waitForNativeSource = async () => ({ found: true, scroller: e.scroller, track: e.track });
        }
        let scans = 0, anchor = null;
        e.c.collectAllItems = async () => { scans++; return e.items(150); };
        e.c.ensureFreshIndicatorPageZeroAnchor = async (_, __, ___, firstVideoId) => { anchor = firstVideoId; };
        e.responses.push(e.page(150, Array.from({ length: 75 }, (_, index) => index + 1), true, 'cursor-75'));
        const completion = e.c.runScript(1);
        await e.flush();
        await e.drain();
        await completion;
        assert.equal(e.requests.length, 1, 'indicator mode never requests cursor-75');
        assert.equal(e.requests[0].body.variables.carouselAfterCursor, null);
        assert.equal(scans, 1);
        assert.equal(anchor, '1');
        assert.equal(e.c.sourceState.items.length, 150);
        assert.equal(e.c.completedSection, e.section, e.warnings.map(entry => entry.details.error?.message).join(', '));
        assert.equal(e.c.routeFetchControllers.size, 0);
    }
});

test('logical collection resumes the bootstrap cursor once and preserves complete membership/order', async () => {
    const e = fetchEnvironment(150);
    e.responses.push(e.page(150, Array.from({ length: 75 }, (_, index) => index + 1), true, 'cursor-75'));
    const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
    assert.equal(e.requests.length, 1);
    assert.equal(bootstrap.totalCount, 150);
    assert.equal(bootstrap.firstVideoId, '1');
    assert.equal(bootstrap.graphqlHasNextPage, true);
    e.c.findMyListGraphqlEntry = () => ({ value: { _id: 'recycled-row' } });
    e.responses.push(e.page(150, Array.from({ length: 75 }, (_, index) => index + 76)));
    const completion = e.collect(bootstrap);
    await e.flush();
    await e.drain();
    const result = await completion;
    assert.equal(e.requests.length, 2);
    assert.equal(e.requests[1].body.variables.carouselAfterCursor, 'cursor-75');
    assert.equal(e.requests[1].body.variables.rowId, 'row-id', 'all pages belong to the original fresh row');
    assert.equal(result.bootstrap.graphqlPageCount, 2);
    assert.equal(result.bootstrap.graphqlHasNextPage, false);
    assert.equal(result.bootstrap.graphqlRequest, null);
    assert.equal(bootstrap.graphqlEdges.length, 75, 'pagination never mutates the retained first page');
    assert.deepEqual(Array.from(result.items, item => item.videoId), Array.from({ length: 150 }, (_, index) => String(index + 1)));
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('optional pagination HTTP, parse, count, cursor, and page-limit failures preserve valid bootstrap', async () => {
    for (const failure of ['http', 'parse', 'count', 'cursor', 'repeated-cursor', 'limit']) {
        const e = fetchEnvironment(4);
        e.responses.push(e.page(4, [1, 2], true, failure === 'cursor' ? null : 'next'));
        const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
        if (failure === 'http') e.responses.push({ status: 503 });
        if (failure === 'parse') e.responses.push({ raw: '{bad json' });
        if (failure === 'count') e.responses.push(e.page(5, [3, 4]));
        if (failure === 'repeated-cursor') e.responses.push(e.page(4, [3], true, 'next'));
        if (failure === 'limit') e.c.GRAPHQL_COLLECTION_MAX_PAGES = 1;
        const result = await e.collect(bootstrap);
        assert.equal(result.bootstrap, bootstrap);
        assert.equal(result.bootstrap.totalCount, 4);
        assert.equal(result.bootstrap.firstVideoId, '1');
        assert.equal(result.bootstrap.graphqlEdges.length, 2);
        assert.equal(result.items, null);
        assert.ok(result.error?.code, failure);
        assert.equal(e.requests.every(request => request.options.method === 'POST'), true, 'optional failure cannot fetch page HTML');
        assert.ok(e.requests.length <= 2);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
    }
});

test('optional pagination timeout retains bootstrap while count-fetch timeout still uses fresh HTML fallback', async () => {
    const e = fetchEnvironment(4);
    e.responses.push(e.page(4, [1, 2], true, 'next'));
    const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
    e.responses.push({ ...e.page(4, [3, 4]), waitFetch: fetchDeferred() });
    const completion = e.collect(bootstrap);
    await e.flush();
    await e.advance(10000);
    const result = await completion;
    assert.equal(result.bootstrap, bootstrap);
    assert.equal(result.items, null);
    assert.equal(result.error.code, 'FRESH_MY_LIST_CAROUSEL_TIMEOUT');
    assert.equal(e.requests.length, 2);
    assert.equal(e.c.routeFetchControllers.size, 0);

    const f = fetchEnvironment(4);
    f.responses.push({ ...f.page(4, [1, 2]), waitFetch: fetchDeferred() }, {
        raw: '"__typename":"PinotCarouselSection","entities":{"totalCount":4,"node":"standardBoxshot_Video:1"},"notificationMessageRegex":"UPDATE_PLAYLIST"'
    });
    const fallback = f.c.netflixGraphql.fetchBootstrap(1);
    await f.advance(10000);
    const fresh = await fallback;
    assert.equal(fresh.totalCount, 4);
    assert.equal(fresh.firstVideoId, '1');
    assert.deepEqual(f.requests.map(request => request.options.method), ['POST', 'GET']);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.warnings[0].details.code, 'FRESH_MY_LIST_CAROUSEL_TIMEOUT');
    assert.equal(f.c.routeFetchControllers.size, 0);
    assert.equal(f.timers.size, 0);
});

test('invalid first-page counts and responses use the HTML fallback rather than a false empty list', async () => {
    for (const failure of [null, undefined, '', false, -1, 1.5, 'http', 'parse']) {
        const e = fetchEnvironment(4);
        const first = failure === 'http' ? { status: 500 }
            : failure === 'parse' ? { raw: 'bad json' } : e.page(failure, [1]);
        e.responses.push(first, {
            raw: '"__typename":"PinotCarouselSection","entities":{"totalCount":4,"node":"standardBoxshot_Video:7"},"notificationMessageRegex":"UPDATE_PLAYLIST"'
        });
        const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
        assert.equal(bootstrap.totalCount, 4);
        assert.equal(bootstrap.firstVideoId, '7');
        assert.deepEqual(e.requests.map(request => request.options.method), ['POST', 'GET']);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
    }
});

test('zero and complete single-page bootstraps avoid further fetches', async () => {
    for (const count of [0, 6]) {
        const e = fetchEnvironment(count);
        e.responses.push(e.page(count, Array.from({ length: count }, (_, index) => index + 1)));
        const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
        const result = await e.collect(bootstrap);
        assert.equal(bootstrap.totalCount, count);
        assert.equal(bootstrap.firstVideoId, count ? '1' : '');
        assert.equal(e.requests.length, 1);
        assert.equal(result.items.length, count);
        assert.equal(e.c.routeFetchControllers.size, 0);
    }
});

function mountedSinglePageEnvironment(count = 6) {
    const e = fetchEnvironment(count);
    Object.assign(e.c, {
        targetSessionEntryKind: 'spa', targetSessionReason: 'route:popstate', mountedCount: count,
        currentPageSlots: (_, track) => track.children,
        nativeCarouselReadiness: (section, scroller, track) => ({
            connected: section.isConnected && scroller.isConnected && track.isConnected,
            pageMode: 'logical', pages: 1, columns: 6, slots: track.children.length,
            cards: track.children.length, currentCards: track.children.length, signature: 'single-page'
        }),
        nativeReactCarouselTotalCount: (_, track) => ({ totalCount: e.c.mountedCount,
            slots: track.children.length, uniqueReadings: [e.c.mountedCount] }),
        requireNativeReactCarouselTotalCount: () => ({ totalCount: e.c.mountedCount }),
        netflixItemIndexFromSlot: slot => slot.index,
        netflixDom: { findTrack: () => e.track, directSlots: track => track.children, filledSlots: track => track.children }
    });
    for (const name of ['nativeCardIdentity', 'readMountedSinglePageMembership', 'collectMountedSinglePageItems',
        'tryMountedSinglePageFastBootstrap']) vm.runInContext(declaration(name), e.c);
    const slots = e.items(count).map((item, index) => {
        const slot = item.snapshot;
        slot.index = index;
        slot.setAttribute('native-variant', String(index));
        e.track.appendChild(slot);
        return slot;
    });
    return { ...e, slots, async qualify() {
        const pending = e.c.tryMountedSinglePageFastBootstrap(e.section, e.scroller, e.track, 1);
        await e.flush();
        await e.frame();
        await e.frame();
        return pending;
    } };
}

test('verified mounted single-page reuse skips membership fetches and preserves native card variants', async () => {
    const e = mountedSinglePageEnvironment();
    const bootstrap = await e.qualify();
    assert.equal(bootstrap.source, 'mounted-single-page-fast-path');
    assert.equal(e.frames.size, 0);
    e.responses.push(e.page(6, [1, 2, 3, 4, 5, 6]));
    const clonesBefore = e.template.cloneCounter.count;
    const result = await e.collect(bootstrap);
    assert.equal(e.requests.length, 0, 'qualified complete membership needs no redundant CarouselPage request');
    assert.equal(result.collectionSource, 'mounted-single-page');
    assert.deepEqual(Array.from(result.items, item => item.videoId), ['1', '2', '3', '4', '5', '6']);
    result.items.forEach((item, index) => {
        assert.equal(item.snapshot.getAttribute('native-variant'), String(index));
        assert.equal(item.snapshot.markup, `native-markup-${index + 1}`);
        assert.equal(item.snapshot.querySelector('img').src, `native-${index + 1}.jpg`);
    });
    assert.equal(e.template.cloneCounter.count - clonesBefore, 6, 'only the accepted native cards are snapshotted');
    const work = e.c.collectPerformanceDiagnostics().membershipReuse;
    assert.equal(work.reused, 1);
    assert.equal(work.requestsAvoided, 1);
    assert.equal(work.itemsCaptured, 6);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('verified mounted single-page reuse is integrated into initialization without native navigation or membership requests', async () => {
    const e = mountedSinglePageEnvironment();
    e.responses.push(e.page(6, [1, 2, 3, 4, 5, 6]));
    let scans = 0;
    e.c.collectAllItems = async () => { scans++; return e.items(6); };
    const completion = e.c.runScript(1);
    await e.flush();
    await e.frame();
    await e.frame();
    await e.drain();
    await completion;
    assert.equal(e.requests.length, 0);
    assert.equal(scans, 0);
    assert.equal(e.c.completedSection, e.section, e.warnings.map(row => row.details.error?.message).join(', '));
    assert.equal(e.c.sourceState.items.length, 6);
    assert.deepEqual(e.c.sourceState.grid.children.map(clone => clone.getAttribute('native-variant')),
        ['0', '1', '2', '3', '4', '5']);
    assert.ok(e.c.sourceState.items.every(item => item.snapshot === null));
    assert.ok(e.logs.some(row => row.details.collectionSource === 'mounted-single-page'));
    assert.equal(e.warnings.length, 0);
});

test('mounted single-page qualification rejects partial, duplicated, shifted and unstable native membership', async () => {
    for (const scenario of ['partial', 'duplicate', 'shifted', 'changed', 'conflicting', 'indicator', 'disconnected']) {
        const e = mountedSinglePageEnvironment();
        if (scenario === 'partial') e.c.mountedCount = 7;
        if (scenario === 'duplicate') e.slots[5].querySelector('card').href = e.slots[0].querySelector('card').href;
        if (scenario === 'shifted') e.slots.forEach(slot => slot.index++);
        if (scenario === 'conflicting') e.c.nativeReactCarouselTotalCount = () => ({ totalCount: 6, slots: 6, uniqueReadings: [6, 7] });
        if (scenario === 'indicator') {
            const readiness = e.c.nativeCarouselReadiness;
            e.c.nativeCarouselReadiness = (...args) => ({ ...readiness(...args), pageMode: 'indicator' });
        }
        if (scenario === 'disconnected') e.track.isConnected = false;
        const pending = e.c.tryMountedSinglePageFastBootstrap(e.section, e.scroller, e.track, 1);
        await e.flush();
        await e.frame();
        if (scenario === 'changed') e.slots[5].querySelector('card').href = 'https://www.netflix.com/watch/99';
        await e.frame();
        // An unstable second sample is rejected after its bounded final frame waits.
        await e.frame();
        await e.frame();
        assert.equal(await pending, null, scenario);
        assert.equal(e.requests.length, 0);
    }
});

test('mounted single-page reuse revalidates after readiness and fetches fresh data on stale proof', async () => {
    for (const scenario of ['membership', 'index', 'count', 'source', 'manual', 'missing-proof', 'layout', 'card-metadata']) {
        const e = mountedSinglePageEnvironment();
        let bootstrap = await e.qualify();
        if (scenario === 'membership') e.slots[5].querySelector('card').href = 'https://www.netflix.com/watch/99';
        if (scenario === 'index') e.slots[5].index = 0;
        if (scenario === 'count') e.c.mountedCount = 7;
        if (scenario === 'source') e.c.netflixDom.findTrack = () => new ConstructionNode('replacement');
        if (scenario === 'manual') e.c.targetSessionReason = 'order-mismatch-reinitialize';
        if (scenario === 'missing-proof') bootstrap = { ...bootstrap, mountedSinglePageProof: null };
        if (scenario === 'layout') {
            const read = e.c.nativeCarouselReadiness;
            e.c.nativeCarouselReadiness = (...args) => ({ ...read(...args), signature: 'changed-layout' });
        }
        if (scenario === 'card-metadata') {
            const read = e.c.itemFromSlot;
            e.c.itemFromSlot = (...args) => args[0] === e.slots[5] ? null : read(...args);
        }
        e.responses.push(e.page(6, [1, 2, 3, 4, 5, 6]));
        const before = e.template.cloneCounter.count;
        const result = await e.collect(bootstrap);
        assert.equal(e.requests.length, 1, scenario);
        assert.equal(result.items.length, 6);
        assert.equal(e.template.cloneCounter.count - before, 1, 'rejected native membership is not snapshotted');
        assert.equal(e.c.collectPerformanceDiagnostics().membershipReuse.rejected, 1);
        assert.ok(e.logs.some(row => row.details.reason && row.details.collectionSource === 'mounted-single-page'));
    }
});

test('initial, manual and order-mismatch entry retain the fresh membership request for single-page lists', async () => {
    for (const reason of ['route:initial', 'manual-reinitialize', 'order-mismatch-reinitialize']) {
        const e = mountedSinglePageEnvironment();
        e.c.targetSessionReason = reason;
        e.c.targetSessionEntryKind = reason === 'route:initial' ? 'initial' : 'spa';
        e.responses.push(e.page(6, [1, 2, 3, 4, 5, 6]));
        const completion = e.c.runScript(1);
        await e.flush();
        await e.drain();
        await completion;
        assert.equal(e.requests.length, 1, reason);
        assert.equal(e.c.completedSection, e.section);
        assert.equal(e.c.sourceState.items.length, 6);
        assert.equal(e.c.collectPerformanceDiagnostics().membershipReuse.attempts, 0);
        assert.ok(e.logs.some(row => row.details.collectionSource === 'graphql'));
        assert.equal(e.warnings.length, 0);
    }
});

test('manual and initial entry cannot qualify mounted reuse and a stale route cannot publish it', async () => {
    for (const kind of ['initial', 'manual']) {
        const e = mountedSinglePageEnvironment();
        e.c.targetSessionEntryKind = kind;
        assert.equal(await e.qualify(), null);
    }
    const e = mountedSinglePageEnvironment();
    const bootstrap = await e.qualify();
    const before = e.template.cloneCounter.count;
    e.c.routeSessionToken = 2;
    await assert.rejects(e.c.netflixGraphql.collectLogicalItems({ bootstrap, totalCount: 6, columns: 6,
        templateSlot: e.template, sessionToken: 1 }), error => e.c.isRouteSessionCancelledError(error));
    assert.equal(e.requests.length, 0);
    assert.equal(e.template.cloneCounter.count, before);
});

test('logical collection rejects incomplete/duplicate membership and reconciled-count mismatches', async () => {
    for (const scenario of ['missing', 'duplicate', 'reconciled']) {
        const e = fetchEnvironment(4);
        const ids = scenario === 'missing' ? [1, 2, 3] : scenario === 'duplicate' ? [1, 2, 3, 3] : [1, 2, 3, 4];
        e.responses.push(e.page(scenario === 'reconciled' ? 5 : 4, ids, scenario === 'reconciled', 'next'));
        const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
        const result = await e.collect(bootstrap, 4);
        assert.equal(result.items, null);
        assert.equal(result.bootstrap, bootstrap);
        assert.equal(e.requests.length, 1, 'a different mounted count must not paginate or accept a four-item prefix');
    }
});

test('full initialization uses native collection after optional pagination failure without losing the fresh count', async () => {
    const e = fetchEnvironment(30);
    e.c.targetSessionEntryKind = 'spa';
    e.responses.push(e.page(30, [1, 2], true, 'next'), { status: 503 });
    let nativeCount = null;
    e.c.collectAllItems = async (_, __, ___, totalCount) => { nativeCount = totalCount; return e.items(totalCount); };
    const completion = e.c.runScript(1);
    await e.flush();
    await e.drain();
    await completion;
    assert.equal(nativeCount, 30);
    assert.equal(e.c.sourceState.items.length, 30);
    assert.equal(e.c.completedSection, e.section, e.warnings.map(entry => entry.details.error?.message).join(', '));
    assert.equal(e.c.initializationBlockedSessionToken, null);
    assert.equal(e.requests.length, 2);
    assert.equal(e.requests.every(request => request.options.method === 'POST'), true);
    assert.equal(e.warnings.some(entry => /fast collection failed/.test(entry.name)), true);
    assert.equal(e.c.routeFetchControllers.size, 0);
});

test('route suspension aborts GraphQL and HTML fetches, including their response bodies, without fallback warnings', async () => {
    for (const kind of ['graphql', 'html']) {
        for (const phase of ['headers', 'body']) {
            const e = fetchEnvironment(4);
            e.routeLifecycle();
            if (kind === 'html') e.responses.push({ status: 503 });
            const waiting = kind === 'html' ? { raw: 'HTML' } : e.page(4, [1, 2]);
            waiting[phase === 'headers' ? 'waitFetch' : 'waitBody'] = fetchDeferred();
            e.responses.push(waiting);
            const completion = e.c.netflixGraphql.fetchBootstrap(1);
            const rejection = assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
            await e.flush();
            const request = e.requests.at(-1);
            assert.equal(request.options.method, kind === 'html' ? 'GET' : 'POST');
            assert.equal(e.c.routeFetchControllers.get(1).size, 1);
            const warnings = e.warnings.length;
            e.c.suspendTargetSession('test-leave');
            assert.equal(request.options.signal.aborted, true, 'abort occurs synchronously on route suspension');
            await rejection;
            assert.equal(e.warnings.length, warnings, 'route abort adds no timeout/fallback warning');
            assert.equal(e.requests.length, kind === 'html' ? 2 : 1);
            assert.equal(e.c.routeFetchControllers.size, 0);
            assert.equal(e.timers.size, 0);
        }
    }
});

test('route change during optional pagination rejects instead of returning retained bootstrap', async () => {
    const e = fetchEnvironment(4);
    e.routeLifecycle();
    e.responses.push(e.page(4, [1, 2], true, 'next'));
    const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
    e.responses.push({ ...e.page(4, [3, 4]), waitBody: fetchDeferred() });
    const completion = e.collect(bootstrap);
    const rejection = assert.rejects(completion, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    await e.flush();
    e.c.suspendTargetSession('test-leave');
    await rejection;
    assert.equal(e.requests[1].options.signal.aborted, true);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.warnings.length, 0);
    assert.equal(e.timers.size, 0);
});

test('a new route session aborts old requests and old cleanup cannot remove its active controller', async () => {
    const e = fetchEnvironment(4);
    e.routeLifecycle();
    e.responses.push({ ...e.page(4, [1, 2]), waitFetch: fetchDeferred() });
    const old = e.c.netflixGraphql.fetchBootstrap(1);
    const rejection = assert.rejects(old, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    e.c.startTargetSession('route:test');
    const currentToken = e.c.routeSessionToken;
    const release = fetchDeferred();
    e.responses.push({ ...e.page(4, [3, 4]), waitFetch: release });
    const current = e.c.netflixGraphql.fetchBootstrap(currentToken);
    await rejection;
    assert.equal(e.requests[0].options.signal.aborted, true);
    assert.equal(e.requests[1].options.signal.aborted, false);
    assert.equal(e.c.routeFetchControllers.get(currentToken).size, 1);
    release.resolve();
    const bootstrap = await current;
    assert.equal(bootstrap.firstVideoId, '3');
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
    assert.equal(e.warnings.length, 0);
});

test('the eight-page limit remains bounded and failed pagination never publishes a partial list', async () => {
    const e = fetchEnvironment(9);
    e.responses.push(e.page(9, [1], true, 'cursor-1'));
    for (let page = 2; page <= 8; page++) e.responses.push(e.page(9, [page], true, `cursor-${page}`));
    const bootstrap = await e.c.netflixGraphql.fetchBootstrap(1);
    const result = await e.collect(bootstrap, 9);
    assert.equal(e.requests.length, 8);
    assert.equal(result.bootstrap, bootstrap);
    assert.equal(result.items, null);
    assert.equal(result.error.code, 'FRESH_MY_LIST_CAROUSEL_PAGE_LIMIT');
    assert.equal(e.c.routeFetchControllers.size, 0);
});

test('logical SPA initialization waits for mode confirmation before continuing pagination and publishes the full grid', async () => {
    const e = fetchEnvironment(150);
    e.c.targetSessionEntryKind = 'spa';
    const readiness = fetchDeferred();
    e.c.waitForNativeCarouselReady = () => readiness.promise;
    e.responses.push(
        e.page(150, Array.from({ length: 75 }, (_, index) => index + 1), true, 'next'),
        e.page(150, Array.from({ length: 75 }, (_, index) => index + 76))
    );
    const completion = e.c.runScript(1);
    await e.flush();
    assert.equal(e.requests.length, 1);
    assert.equal(e.c.running, true);
    assert.equal(e.created.length, 0);
    readiness.resolve({ ready: true, empty: false });
    await e.flush();
    await e.drain();
    await completion;
    assert.equal(e.requests.length, 2);
    assert.equal(e.c.sourceState.items.length, 150);
    assert.equal(e.c.completedSection, e.section, e.warnings.map(entry => entry.details.error?.message).join(', '));
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.c.running, false);
});

test('a count result from an obsolete session cannot publish an empty grid or clear the new running owner', async () => {
    const e = initializationEnvironment(0);
    let finalized = 0;
    e.c.finalizeEmptyLegacyList = () => finalized++;
    e.c.waitForMyListTotalCount = async () => {
        e.c.isRouteSessionActive = token => token === 2;
        e.c.runningSessionToken = 2;
        e.c.sourceState = { newerSession: true };
        return 0;
    };
    await e.c.runScript(1);
    assert.equal(finalized, 0);
    assert.equal(e.c.sourceState.newerSession, true);
    assert.equal(e.c.runningSessionToken, 2);
    assert.equal(e.c.running, true);
    assert.equal(e.warnings.length, 0);
});

test('HTTP failure cleanup aborts the unread response body and releases its controller and timeout', async () => {
    const e = fetchEnvironment(4);
    e.responses.push({ status: 503, waitBody: fetchDeferred() });
    await assert.rejects(e.c.fetchFreshMyListBootstrapViaCarousel(1), { code: 'FRESH_MY_LIST_CAROUSEL_HTTP_ERROR' });
    assert.equal(e.requests[0].bodyRead, undefined);
    assert.equal(e.requests[0].options.signal.aborted, true);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

const viewingFunctions = [
    'unwrapViewingAtom', 'readViewingGraph', 'readViewingGraphReference', 'viewingNumber', 'viewingCount', 'viewingVideoRecord',
    'classifyViewingVideo', 'viewingFieldKind', 'recordViewingFieldKinds', 'viewingReferenceId', 'viewingSeasonPlan', 'classifyViewingSeries',
    'viewingRequestContext', 'assertViewingJob', 'fetchViewingGraph', 'runViewingBatches', 'collectViewingStatuses', 'collectViewingSeriesBatch',
    'createViewingNetworkDiagnostics', 'collectViewingNetworkDiagnostics',
    'readViewingCache', 'clearCachedViewingStatus', 'writeViewingCache', 'publishViewingProgress', 'viewingTitleType',
    'collectViewingEpisodePlans', 'finishViewingSeriesPlan', 'recheckViewingSeries',
    'saveViewingSeriesDetails', 'collectViewingSeriesDiagnostics',
    'viewingLatestEpisode', 'viewingProgressSummary', 'viewingSeriesResult',
    'validViewingCoverage', 'readManualViewingChoices', 'syncManualViewingProfile', 'saveManualViewingChoices', 'changedManualViewingIds', 'reconcileManualViewingCoverage',
    'effectiveViewingStatus', 'ensureManualViewingControls', 'syncManualViewingCard', 'ensureManualViewingBehavior',
    'handleGridClonePointerOver', 'handleGridClonePointerLeave',
    'gridOwnsClone', 'createWatchTypeFilter', 'syncWatchTypeFilter', 'ensureWatchGroupUi', 'syncWatchChildOrder', 'syncWatchGroups',
    'initializeWatchGroups', 'refreshViewingStatus', 'createRouteFetch', 'finishRouteFetch',
    'abortObsoleteRouteFetches', 'gridCloneFromPointerEvent', 'gridHoverTargetActive', 'gridHoverSuppressed', 'cancelPendingGridHover',
    'formatHeaderParts', 'tUi', 'tUiPlural', 'formatItemCount', 'formatMessage'
];
const atom = value => ({ $type: 'atom', value });
const reference = (kind, id) => ({ $type: 'ref', value: [kind, String(id)] });
function viewingVideo(type, watched, bookmark = 0, extra = {}) {
    return { summary: atom({ type }), watched: atom(watched), bookmarkPosition: atom(bookmark),
        runtime: atom(100), creditsOffset: atom(95), ...extra };
}
function viewingFixtures(extraEpisode = false) {
    return {
        titles: { videos: {
            1: viewingVideo('movie', true), 2: viewingVideo('movie', false, 25),
            3: viewingVideo('movie', false),
            4: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(extraEpisode ? 3 : 2) }),
            5: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(2) }),
            6: viewingVideo('show', true, 0, { seasonCount: atom(0) }), 7: viewingVideo('unexpected-type', true)
        } },
        seasons: { videos: { 4: { seasonList: { 0: reference('seasons', 40) } },
            5: { seasonList: { 0: reference('seasons', 50) } } },
            seasons: { 40: { summary: atom({ length: extraEpisode ? 3 : 2 }) },
                50: { summary: atom({ length: 2 }) } } },
        episodes: { seasons: {
            40: { episodes: { 0: reference('videos', 400), 1: reference('videos', 401),
                ...(extraEpisode ? { 2: reference('videos', 402) } : {}) } },
            50: { episodes: { 0: reference('videos', 500), 1: reference('videos', 501) } }
        }, videos: {
            400: viewingVideo('episode', true), 401: viewingVideo('episode', true),
            402: viewingVideo('episode', false), 500: viewingVideo('episode', true),
            501: viewingVideo('episode', false, 30)
        } }
    };
}
async function viewingEnvironment(count = 7, existing = null, storage = new Map()) {
    const e = existing || constructionEnvironment();
    const items = e.items(count);
    if (!existing) {
        const build = e.c.buildGrid(e.section, e.scroller, items, e.layout, count, 1);
        await e.drain();
        await build;
    }
    const models = {
        userInfo: { guid: 'owner-profile', userGuid: 'active-profile', authURL: 'test-auth-token' },
        services: { memberapi: { protocol: 'https', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] } },
        serverDefs: { BUILD_IDENTIFIER: 'test-build' }
    };
    const requests = [];
    const storageCalls = { reads: 0, writes: 0, cacheReads: 0, cacheWrites: 0 };
    let cacheTime = Date.now();
    let fixtures = viewingFixtures();
    Object.assign(e.c, {
        URLSearchParams, AbortController, FRESH_MY_LIST_FETCH_TIMEOUT_MS: 10000,
        VIEWING_TITLE_BATCH_SIZE: 50, VIEWING_EPISODE_BATCH_SIZE: 200, VIEWING_MAX_SEASONS: 40,
        VIEWING_MAX_EPISODES: 500, VIEWING_MAX_REQUESTS: 32, VIEWING_MAX_PASSES: 3, VIEWING_REQUEST_CONCURRENCY: 2,
        VIEWING_TIMEOUT_MS: 30000, VIEWING_COMPLETION_RATIO: 0.90,
        VIEWING_CHOICES_STORAGE_KEY: 'test.viewingChoices.',
        VIEWING_CACHE_STORAGE_KEY: 'test.viewingCache.', VIEWING_CACHE_MAX_AGE_MS: 6 * 60 * 60 * 1000,
        Date: class extends Date { static now() { return cacheTime; } },
        GM_getValue: (key, fallback) => {
            if (key.startsWith('test.viewingCache.')) storageCalls.cacheReads++;
            else storageCalls.reads++;
            return structuredClone(storage.get(key) ?? fallback);
        },
        GM_setValue: (key, value) => {
            if (key.startsWith('test.viewingCache.')) storageCalls.cacheWrites++;
            else storageCalls.writes++;
            storage.set(key, structuredClone(value));
        },
        routeFetchControllers: new Map(), netflixModelData: name => models[name],
        getUiLocale: () => 'en', formatUiNumber: value => String(value), formatInitializationTime: () => 'time',
        fetch: async (url, options) => {
            const body = new URLSearchParams(options.body);
            const paths = body.getAll('path').map(value => JSON.parse(value));
            requests.push({ url, options, paths });
            const graph = paths[0][0] === 'seasons' || (Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) ? fixtures.episodes
                : paths[0][2] === 'seasonList' ? fixtures.seasons : fixtures.titles;
            return { ok: true, status: 200, json: async () => ({ jsonGraph: graph }) };
        }
    });
    const uiStart = source.indexOf('    const UI_MESSAGES = {');
    const uiEnd = source.indexOf('    const LOG_MESSAGES = {', uiStart);
    vm.runInContext(source.slice(uiStart, uiEnd), e.c);
    for (const name of viewingFunctions) vm.runInContext(declaration(name), e.c);
    return { ...e, models, requests, storage, storageCalls, items, state: e.c.sourceState,
        fixtures: () => fixtures, setFixtures: value => { fixtures = value; },
        setCacheTime: value => { cacheTime = value; },
        async start() {
            e.c.initializeWatchGroups(e.c.sourceState, 1);
            await e.c.sourceState.watchStatus.promise;
        }
    };
}
function mainViewingIds(e) {
    return e.state.grid.children.filter(node => node.__tmMyListItem).map(node => node.__tmMyListItem.videoId);
}
function completedViewingIds(e) {
    return e.state.watchStatus.ui.watchedGrid.children.map(node => node.__tmMyListItem.videoId);
}

function filteredViewingIds(e, group = 'main') {
    const parent = group === 'main' ? e.state.grid : e.state.watchStatus.ui.watchedGrid;
    return parent.children.filter(node => node.__tmMyListItem && node.getAttribute('data-tm-type-hidden') !== 'true')
        .map(node => node.__tmMyListItem.videoId);
}

function clickViewingFilter(e, group, type) {
    const control = group === 'main' ? e.state.watchStatus.ui.mainFilter : e.state.watchStatus.ui.watchedFilter;
    control.buttons.get(type).button.listeners.get('click')();
}

function useCompleteSeriesResponses(e, episodeCounts = {}) {
    const countFor = id => episodeCounts[id] ?? 1;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ url, options, paths });
        const graph = { videos: {}, seasons: {} };
        if (Array.isArray(paths[0][2])) {
            for (const id of paths[0][1]) graph.videos[id] = paths[0][2].includes('seasonCount')
                ? viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(countFor(id)) })
                : viewingVideo('episode', true);
        } else if (paths[0][0] === 'videos') {
            for (const [, id] of paths) {
                const seasonId = String(10000 + Number(id));
                graph.videos[id] = { seasonList: { 0: reference('seasons', seasonId) } };
                graph.seasons[seasonId] = { summary: atom({ length: countFor(id) }) };
            }
        } else {
            for (const [, seasonId, , range] of paths) {
                const episodes = {};
                for (let index = range.from; index <= range.to; index++) {
                    const episodeId = String(Number(seasonId) * 1000 + index);
                    episodes[index] = reference('videos', episodeId);
                    graph.videos[episodeId] = viewingVideo('episode', true);
                }
                graph.seasons[seasonId] = { episodes };
            }
        }
        return { ok: true, status: 200, json: async () => ({ jsonGraph: graph }) };
    };
}

function delayViewingBodies(e) {
    const mockFetch = e.c.fetch;
    const pending = [];
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        if (!response.ok) return response;
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        const gate = fetchDeferred();
        const entry = { paths, signal: options.signal, released: false,
            release() { entry.released = true; gate.resolve(); } };
        pending.push(entry);
        const json = response.json;
        response.json = async () => {
            await abortableFetchResult(gate.promise, options.signal);
            return json();
        };
        return response;
    };
    return pending;
}

function useCompleteMovieResponses(e) {
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths, options });
        return { ok: true, status: 200, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
}

test('viewing overlap publishes a later title batch promptly and preserves native order', async () => {
    const e = await viewingEnvironment(150);
    useCompleteMovieResponses(e);
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    assert.equal(pending.length, 2, 'two independent title reads start together');
    pending[1].release();
    await e.flush();
    assert.equal(e.state.watchStatus.loading, true);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 51)));
    assert.equal(pending.length, 2, 'the next bounded wave waits for both owners');
    pending[0].release();
    for (let attempt = 0; attempt < 10 && pending.length < 3; attempt++) await e.flush();
    assert.equal(pending.length, 3);
    pending[2].release();
    await e.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 150 }, (_, index) => String(index + 1)));
    assert.equal(e.storageCalls.cacheWrites, 1);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap shortens modeled network wait without increasing requests', async () => {
    const runs = [];
    for (const concurrency of [1, 2]) {
        const e = await viewingEnvironment(100);
        e.c.VIEWING_REQUEST_CONCURRENCY = concurrency;
        useCompleteMovieResponses(e);
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        for (let wave = 0; wave < 2; wave++) {
            await e.flush();
            const active = pending.filter(entry => !entry.released);
            if (!active.length) break;
            await e.advance(100);
            active.forEach(entry => entry.release());
            for (let attempt = 0; attempt < 10; attempt++) await e.flush();
        }
        await e.state.watchStatus.promise;
        assert.equal(e.requests.length, 2);
        const network = e.logs.find(entry => entry.details?.series).details.network;
        assert.equal(network.peakInFlight, concurrency);
        assert.equal(network.inFlight, 0);
        assert.equal(network.succeeded, 2);
        assert.equal(network.failed, 0);
        assert.equal(network.totalRequestMs, 200);
        assert.equal(network.maxRequestMs, 100);
        assert.equal(network.meanRequestMs, 100);
        assert.equal(network.overlapMs, concurrency === 2 ? 100 : 0);
        const copy = e.c.collectViewingNetworkDiagnostics(e.state.watchStatus.network);
        copy.succeeded = -1;
        await e.advance(60000);
        assert.equal(e.c.collectViewingNetworkDiagnostics(e.state.watchStatus.network).elapsedMs, network.elapsedMs);
        assert.equal(e.c.collectViewingNetworkDiagnostics(e.state.watchStatus.network).succeeded, 2);
        runs.push(network.elapsedMs);
    }
    assert.deepEqual(runs, [200, 100], 'fake-clock overlap is evidence of scheduling, not Netflix latency');
});

test('viewing overlap keeps series dependencies ordered and drains valid partial results after HTTP failure', async () => {
    const e = await viewingEnvironment(100);
    useCompleteSeriesResponses(e);
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    assert.equal(pending.length, 2);
    pending[1].release();
    pending[0].release();
    for (let attempt = 0; attempt < 10 && pending.length < 4; attempt++) await e.flush();
    assert.deepEqual(pending.slice(2).map(entry => entry.paths[0][1]), ['1', '51'],
        'series order follows native IDs rather than title-response arrival');
    assert.ok(pending.slice(2).every(entry => entry.paths[0][2] === 'seasonList'));
    pending[2].release();
    for (let attempt = 0; attempt < 10 && pending.length < 5; attempt++) await e.flush();
    assert.equal(pending[4].paths[0][0], 'seasons');
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] !== 'seasons' || paths[0][1] !== '10051') return mockFetch(url, options);
        e.requests.push({ paths, options });
        return { ok: false, status: 429 };
    };
    pending[3].release();
    for (let attempt = 0; attempt < 10 && !e.warnings.length; attempt++) await e.flush();
    assert.equal(e.state.watchStatus.loading, true, 'failure cannot finalize before the valid in-flight finale drains');
    pending[4].release();
    await e.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 1)));
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_429');
    const network = e.logs.find(entry => entry.details?.series).details.network;
    assert.equal(network.rateLimited, 1);
    assert.equal(network.failed, 1);
    assert.equal(network.succeeded, 5);
    assert.equal(network.peakInFlight, 2);
    assert.equal(e.requests.length, 6);
    assert.equal(e.storageCalls.cacheWrites, 1);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap aborts both owned reads after route or profile cancellation', async () => {
    for (const reason of ['route', 'profile']) {
        const e = await viewingEnvironment(100);
        useCompleteMovieResponses(e);
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        await e.flush();
        assert.equal(pending.length, 2);
        const unrelated = new AbortController();
        if (reason === 'route') {
            e.c.isRouteSessionActive = () => false;
            e.c.abortObsoleteRouteFetches();
        } else {
            e.c.routeFetchControllers.get(1).add(unrelated);
            e.models.userInfo.userGuid = 'other-profile';
            pending[0].release();
        }
        await e.state.watchStatus.promise;
        assert.ok(pending.every(entry => entry.signal.aborted));
        if (reason === 'profile') {
            assert.equal(unrelated.signal.aborted, false, 'a viewing-job cancellation leaves unrelated route requests owned');
            const controllers = e.c.routeFetchControllers.get(1);
            controllers.delete(unrelated);
            if (!controllers.size) e.c.routeFetchControllers.delete(1);
        }
        assert.equal(e.storageCalls.cacheWrites, 0);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
        assert.equal(e.warnings.length, 0);
        if (reason === 'profile') assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_PROFILE_CHANGED');
    }
});

test('viewing overlap stops allocating after a failed wave and shares the finite request cap', async () => {
    for (const fail of [false, true]) {
        const e = await viewingEnvironment(200);
        useCompleteMovieResponses(e);
        e.c.VIEWING_MAX_REQUESTS = 3;
        e.c.VIEWING_MAX_PASSES = 1;
        if (fail) {
            const mockFetch = e.c.fetch;
            e.c.fetch = async (url, options) => {
                const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
                if (paths[0][1][0] !== '51') return mockFetch(url, options);
                e.requests.push({ paths, options });
                return { ok: false, status: 503 };
            };
        }
        await e.start();
        assert.equal(e.requests.length, fail ? 2 : 3);
        assert.equal(completedViewingIds(e).length, fail ? 50 : 150);
        assert.equal(e.state.watchStatus.failure, fail ? 'VIEWING_STATUS_HTTP_503' : 'VIEWING_STATUS_BUDGET');
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
    }
});

test('viewing overlap does not start a peer finale after a known metadata failure', async () => {
    const e = await viewingEnvironment(100);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][2] !== 'seasonList' || paths[0][1] !== '1') return mockFetch(url, options);
        e.requests.push({ paths, options });
        return { ok: false, status: 503 };
    };
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    pending[0].release();
    pending[1].release();
    for (let attempt = 0; attempt < 10 && pending.length < 3; attempt++) await e.flush();
    assert.equal(pending[2].paths[0][1], '51');
    await e.flush();
    pending[2].release();
    await e.state.watchStatus.promise;
    assert.equal(e.requests.length, 4);
    assert.ok(e.requests.every(request => request.paths[0][0] !== 'seasons'));
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap honors request timeouts and the combined deadline without leaked owners or retries', async () => {
    for (const deadline of [false, true]) {
        const e = await viewingEnvironment(150);
        useCompleteMovieResponses(e);
        if (deadline) { e.c.VIEWING_TIMEOUT_MS = 5; e.c.VIEWING_MAX_PASSES = 1; }
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        await e.flush();
        assert.equal(pending.length, 2);
        await e.advance(deadline ? 5 : 8000);
        await e.state.watchStatus.promise;
        assert.equal(e.requests.length, 2);
        assert.equal(e.state.watchStatus.failure, deadline ? 'VIEWING_STATUS_BUDGET' : 'VIEWING_STATUS_FAILED');
        assert.equal(e.state.watchStatus.network.aborted, 2);
        assert.equal(e.state.watchStatus.network.failed, 2);
        assert.equal(e.state.watchStatus.network.inFlight, 0);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
        await e.advance(120000);
        assert.equal(e.requests.length, 2);
    }
});

test('viewing data resolves atoms/references safely and does not guess from missing or series flags', async () => {
    const e = await viewingEnvironment();
    const graph = { videos: { 1: viewingVideo('movie', true), 2: { $type: 'error', value: 'missing' } },
        link: reference('videos', 1), cycle: { $type: 'ref', value: ['cycle'] } };
    assert.equal(e.c.readViewingGraph(graph, ['link', 'watched']), true);
    assert.equal(e.c.readViewingGraph(graph, ['cycle']), undefined);
    assert.equal(e.c.viewingVideoRecord(graph, 2), null);
    const classify = fields => e.c.classifyViewingVideo({
        type: 'movie', bookmark: null, runtime: 100, creditsOffset: 95, ...fields
    });
    assert.equal(classify({ watched: true }), 'complete');
    assert.equal(classify({ watched: false, bookmark: 100 }), 'complete');
    assert.equal(classify({ bookmark: 90 }), 'complete');
    assert.equal(classify({ bookmark: 89 }), 'in-progress');
    assert.equal(classify({ watched: false, bookmark: 0 }), 'not-started');
    assert.equal(classify({ watched: false }), 'unknown');
    assert.equal(classify({ type: 'show', watched: true }), 'unknown');
    assert.equal(classify({}), 'unknown');
    assert.equal(e.c.viewingNumber('100'), null);
    assert.equal(e.c.viewingNumber(null), null);
    assert.equal(e.c.viewingReferenceId(['seasons', '40'], 'seasons'), '40');
    assert.equal(e.c.viewingReferenceId(['videos', '40'], 'seasons'), '');
});

test('caught-up series require exact season and episode coverage, unique IDs, and complete episodes', async () => {
    const e = await viewingEnvironment();
    const record = e.c.viewingVideoRecord(e.fixtures().titles, 4);
    const plan = e.c.viewingSeasonPlan(e.fixtures().seasons, record);
    assert.ok(plan);
    plan.seasons[0].episodes.set(0, { id: '400', status: 'complete' });
    plan.seasons[0].episodes.set(1, { id: '401', status: 'complete' });
    assert.equal(e.c.classifyViewingSeries(plan), 'complete');
    plan.seasons[0].episodes.set(1, { id: '401', status: 'not-started' });
    assert.equal(e.c.classifyViewingSeries(plan), 'in-progress');
    plan.seasons[0].episodes.set(1, { id: '400', status: 'complete' });
    assert.equal(e.c.classifyViewingSeries(plan), 'unknown');
    plan.seasons[0].episodes.delete(1);
    assert.equal(e.c.classifyViewingSeries(plan), 'unknown');
    assert.equal(e.c.viewingSeasonPlan(e.fixtures().seasons, { ...record, episodeCount: 3 }), null);
    assert.equal(e.c.viewingSeasonPlan(e.fixtures().seasons, { ...record, seasonCount: 2 }), null);
    assert.equal(e.c.viewingSeasonPlan(e.fixtures().seasons, { ...record, episodeCount: 501 }), null);
});

test('background viewing collection groups finished movies and complete series while preserving native order and counts', async () => {
    const e = await viewingEnvironment();
    const original = e.items.map(item => ({ videoId: item.videoId, page: item.page }));
    await e.start();
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.equal(e.state.watchStatus.ui.details.open, false);
    assert.equal(e.state.watchStatus.completedCount, 2);
    assert.equal(e.state.watchStatus.unknownCount, 2);
    assert.match(e.state.watchStatus.ui.note.textContent, /2 titles/);
    assert.equal(e.c.formatHeaderParts(7, 7, 10, true).meta, '2 items  time');
    assert.equal(e.state.totalCount, 7);
    assert.equal(e.state.cloneMap.size, 7);
    assert.deepEqual(e.items.map(item => ({ videoId: item.videoId, page: item.page })), original);
    assert.equal(e.requests.length, 3);
    for (const request of e.requests) {
        assert.equal(request.options.method, 'POST');
        assert.equal(request.options.credentials, 'same-origin');
        assert.equal(request.options.headers['x-netflix.request.client.user.guid'], 'active-profile');
        assert.equal(new URLSearchParams(request.options.body).get('authURL'), 'test-auth-token');
        assert.ok(request.paths.every(path => ['videos', 'seasons'].includes(path[0])));
        assert.equal(new URL(request.url).origin, 'https://www.netflix.com');
    }
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
});

test('refresh returns a caught-up series to the main list when a new unwatched episode appears', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clones = new Map(e.state.cloneMap);
    e.setFixtures(viewingFixtures(true));
    await e.c.refreshViewingStatus(e.state);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '4', '5', '6', '7']);
    assert.deepEqual(completedViewingIds(e), ['1']);
    for (const [key, clone] of clones) assert.equal(e.state.cloneMap.get(key), clone, 'grouping moves existing cards');
    assert.equal(e.items[3].page, 0, 'native page still includes the hidden first title');
});

test('expanded watched cards use delegated hover and closed groups reject hover targets', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clone = e.state.cloneMap.get('v:1');
    clone.__tmHoverActivationGeneration = 1;
    const event = { target: clone.querySelector('card') };
    assert.equal(e.c.gridCloneFromPointerEvent(event, e.state.grid), null);
    assert.equal(e.c.gridHoverTargetActive(clone, 1), false);
    const details = e.state.watchStatus.ui.details;
    details.open = true;
    details.listeners.get('toggle')();
    assert.equal(e.c.gridCloneFromPointerEvent(event, e.state.grid), clone);
    assert.equal(e.c.gridHoverTargetActive(clone, 1), true);
    details.open = false;
    details.listeners.get('toggle')();
    assert.equal(e.c.gridHoverTargetActive(clone, 1), false);
    assert.equal(e.requests.length, 3, 'toggle/hover never fetch viewing data');
});

test('group synchronization is idempotent and rebuild preserves expansion, membership, and original card metadata', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.state.watchStatus.ui.details.open = true;
    e.state.watchStatus.ui.details.listeners.get('toggle')();
    const oldUi = e.state.watchStatus.ui;
    const originalIndices = e.items.map(item => e.state.cloneMap.get('v:' + item.videoId).getAttribute('data-tm-item-order'));
    let moves = 0;
    const insert = e.state.grid.insertBefore.bind(e.state.grid);
    e.state.grid.insertBefore = (...args) => { moves++; return insert(...args); };
    e.c.syncWatchGroups(e.state);
    assert.equal(moves, 0);
    await e.c.buildGrid(e.section, e.scroller, e.items, e.layout, 7, 1);
    assert.notEqual(e.state.watchStatus.ui, oldUi);
    assert.equal(e.state.watchStatus.ui.details.open, true);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.deepEqual(e.items.map(item => e.state.cloneMap.get('v:' + item.videoId).getAttribute('data-tm-item-order')), originalIndices);
});

test('remove and Undo work inside watched groups and new titles stay visible until classified', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.c.getCarouselDomRuntime = () => ({ profile: { pageMode: 'indicator' } });
    vm.runInContext(declaration('reindexLegacyItemsAfterDelta'), e.c);
    assert.equal(e.c.applyLegacyRemoval('1'), true);
    assert.deepEqual(completedViewingIds(e), ['4']);
    assert.equal(e.state.items.length, 6);
    const entry = e.c.recentRemovedMyListItems.get('1');
    assert.equal(e.c.applyLegacyAddition(entry.item, entry.index, 'undo'), true);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    const added = e.items[0].snapshot || e.state.cloneMap.get('v:1').cloneNode(true);
    const item = { videoId: '99', page: 0, href: '/browse?jbv=99', snapshot: added };
    assert.equal(e.c.applyLegacyAddition(item, 0), true);
    assert.equal(mainViewingIds(e)[0], '99');
    assert.equal(e.state.items.length, 8);
    assert.equal(e.state.watchStatus.unknownCount, 3);
    assert.equal(e.requests.length, 3, 'list deltas do not trigger a full viewing scan');
});

test('native order alignment preserves separate group order without changing Netflix membership', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.c.getCarouselDomRuntime = () => ({ profile: { pageMode: 'indicator' } });
    e.c.visibleNativeItems = () => [{ videoId: '4' }, { videoId: '3' }, { videoId: '1' }];
    vm.runInContext(declaration('reindexLegacyItemsAfterDelta'), e.c);
    vm.runInContext(declaration('alignLegacyVisiblePageOrder'), e.c);
    assert.equal(e.c.alignLegacyVisiblePageOrder({ pageSignature: '4|3|1', selectedPage: 0 }), true);
    assert.deepEqual(completedViewingIds(e), ['4', '1']);
    assert.deepEqual(mainViewingIds(e), ['3', '2', '5', '6', '7']);
    assert.equal(e.state.items.length, 7);
    assert.equal(e.state.cloneMap.get('v:1').getAttribute('data-tm-item-order'), '2');
});

test('missing active-profile identity or unsafe endpoint leaves all titles visible without requests', async () => {
    for (const mode of ['missing-auth', 'owner-only', 'external-endpoint']) {
        const e = await viewingEnvironment();
        if (mode === 'missing-auth') delete e.models.userInfo.authURL;
        if (mode === 'owner-only') delete e.models.userInfo.userGuid;
        if (mode === 'external-endpoint') e.models.services.memberapi = 'https://example.test/api';
        await e.start();
        assert.equal(e.requests.length, 0);
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_CONTEXT');
        assert.match(e.state.watchStatus.ui.note.textContent, /7 titles/);
    }
});

test('viewing HTTP/JSON failures preserve the grid and never turn absent data into watched titles', async () => {
    for (const mode of ['http', 'json', 'shape', 'timeout']) {
        const e = await viewingEnvironment();
        e.c.fetch = async (_, options) => {
            if (mode === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort',
                () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
            return {
                ok: mode !== 'http', status: 404,
                json: async () => { if (mode === 'json') throw new SyntaxError('invalid'); return {}; }
            };
        };
        e.c.initializeWatchGroups(e.state, 1);
        if (mode === 'timeout') await e.advance(8000);
        await e.state.watchStatus.promise;
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.state.watchStatus.loading, false);
        assert.ok(e.state.watchStatus.failure);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
        assert.equal(e.state.grid.isConnected, true);
    }
});

test('viewing title requests batch large lists and grouping never schedules periodic refresh work', async () => {
    const e = await viewingEnvironment(150);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    await e.start();
    assert.equal(e.requests.length, 3);
    assert.ok(e.requests.every(request => request.paths[0][1].length === 50));
    assert.equal(completedViewingIds(e).length, 150);
    assert.equal(mainViewingIds(e).length, 0);
    assert.equal(e.state.watchStatus.ui.empty.hidden, false);
    assert.equal(e.timers.size, 0);
    e.c.syncWatchGroups(e.state);
    await e.advance(60000);
    assert.equal(e.requests.length, 3);
});

test('long seasons request only their latest episode and oversize series remain unknown', async () => {
    const e = await viewingEnvironment(2);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        let graph;
        if (Array.isArray(paths[0][2])) graph = { videos: {
            1: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(500) }),
            2: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(501) })
        } };
        else if (paths[0][0] === 'videos') graph = {
            videos: { 1: { seasonList: { 0: reference('seasons', 10) } } },
            seasons: { 10: { summary: atom({ length: 500 }) } }
        };
        else {
            const range = paths[0][3];
            const indices = Array.from({ length: range.to - range.from + 1 }, (_, index) => range.from + index);
            graph = {
                seasons: { 10: { episodes: Object.fromEntries(indices.map(index => [index, reference('videos', 1000 + index)])) } },
                videos: Object.fromEntries(indices.map(index => [1000 + index, viewingVideo('episode', true)]))
            };
        }
        return { ok: true, json: async () => ({ jsonGraph: graph }) };
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.deepEqual(mainViewingIds(e), ['2']);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons').map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
});

test('viewing request budget preserves confirmed movies and leaves unverified series visible', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_MAX_REQUESTS = 1;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(e.requests.length, 1);
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.ok(mainViewingIds(e).includes('4'));
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    assert.equal(e.c.routeFetchControllers.size, 0);
});

test('a large short-series list is fully covered within the original single-pass request budget', async () => {
    const e = await viewingEnvironment(500);
    useCompleteSeriesResponses(e);
    await e.start();
    assert.equal(e.requests.length, 30);
    assert.equal(e.state.watchStatus.failure, null);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 500 }, (_, index) => String(index + 1)));
    assert.equal(mainViewingIds(e).length, 0);
    assert.equal(e.state.watchStatus.unknownCount, 0);
    const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
    assert.deepEqual({ ...diagnostic }, { found: 500, eligible: 500, planned: 500, checked: 500, complete: 500,
        unknown: 0, incomplete: 0, unplanned: 0, episodesChecked: 500, episodesIncomplete: 0, episodesUnknown: 0,
        missingEpisodeRefs: 0, pending: 0 });
    assert.equal(e.state.totalCount, 500);
    assert.equal(e.state.cloneMap.size, 500);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('completed series results survive a budget limit inside the current episode group', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 200, 2: 1 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(e.requests.length, 3);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.deepEqual(mainViewingIds(e), ['2']);
    assert.equal(e.state.watchStatus.unknownCount, 1);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('a later series-group HTTP failure preserves fully verified series results', async () => {
    const e = await viewingEnvironment(51);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'seasons' && paths[0][1] === '10051') {
            e.requests.push({ url, options, paths });
            return { ok: false, status: 503 };
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.equal(e.requests.length, 6);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 1)));
    assert.deepEqual(mainViewingIds(e), ['51']);
    assert.equal(e.state.watchStatus.unknownCount, 1);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('route leave aborts viewing requests and stale completion cannot update a new grid', async () => {
    const e = await viewingEnvironment();
    let signal;
    e.c.fetch = (_, options) => new Promise((_, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    e.c.initializeWatchGroups(e.state, 1);
    const promise = e.state.watchStatus.promise;
    const newer = { grid: { isConnected: true }, watchStatus: { marker: 'new' } };
    e.c.sourceState = newer;
    e.c.isRouteSessionActive = token => token === 2;
    e.c.abortObsoleteRouteFetches();
    await promise;
    assert.equal(signal.aborted, true);
    assert.equal(e.c.sourceState, newer);
    assert.equal(newer.watchStatus.marker, 'new');
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
    assert.equal(e.warnings.length, 0);
});

test('profile changes during body reads discard results and refreshing a new profile clears prior completion', async () => {
    const e = await viewingEnvironment();
    await e.start();
    let completeBody;
    e.c.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { completeBody = resolve; }) });
    const promise = e.c.refreshViewingStatus(e.state);
    await e.flush();
    e.models.userInfo.userGuid = 'other-profile';
    completeBody({ jsonGraph: e.fixtures().titles });
    await promise;
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_PROFILE_CHANGED');
    assert.equal(e.state.watchStatus.loading, false);
    const next = e.c.refreshViewingStatus(e.state);
    assert.equal(completedViewingIds(e).length, 0);
    await e.flush();
    completeBody({ jsonGraph: {} });
    await next;
    assert.equal(mainViewingIds(e).length, 7);
});

test('simultaneous manual refreshes share the current viewing scan', async () => {
    const e = await viewingEnvironment();
    let release;
    let calls = 0;
    e.c.fetch = async () => {
        calls++;
        return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
    };
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    const second = e.c.refreshViewingStatus(e.state);
    assert.equal(calls, 1);
    release({ jsonGraph: {} });
    await Promise.all([e.state.watchStatus.promise, second]);
    assert.equal(calls, 1);
    assert.equal(e.state.watchStatus.ui.refresh.disabled, false);
});

test('new viewing controls have translations for every supported Netflix UI locale', async () => {
    const e = await viewingEnvironment();
    const locales = vm.runInContext('Object.keys(UI_MESSAGES)', e.c);
    const keys = ['watchedCaughtUp', 'refreshViewingStatus', 'checkingViewingStatus', 'unknownViewingStatus', 'caughtUpMessage',
        'filterFilms', 'filterSeries', 'filterAll', 'titleTypeFilter', 'noMatchingTitles', 'unknownTitleTypes',
        'markWatched', 'markCaughtUp', 'moveBackToMyList', 'useAutomaticViewingStatus', 'viewingChoiceStorageFailed'];
    for (const locale of locales) {
        e.c.getUiLocale = () => locale;
        for (const key of keys) {
            assert.equal(vm.runInContext('typeof UI_MESSAGES[' + JSON.stringify(locale) + '][' +
                JSON.stringify(key) + ']', e.c), 'string', locale + ': ' + key);
            assert.ok(e.c.tUi(key, { count: 3 }), locale + ': ' + key);
        }
    }
    e.c.getUiLocale = () => 'unsupported';
    assert.equal(e.c.tUi('watchedCaughtUp'), 'Watched / Caught up');
});

test('full Netflix initialization publishes the ordinary grid before optional viewing collection finishes', async () => {
    const e = await viewingEnvironment(6, initializationEnvironment(6));
    const run = e.c.runScript(1);
    await e.flush();
    await run;
    const state = e.c.sourceState;
    assert.equal(e.c.running, false);
    assert.equal(e.c.completedSection, e.section);
    assert.equal(state.grid.isConnected, true);
    assert.equal(state.items.length, 6);
    assert.ok(state.watchStatus);
    await state.watchStatus.promise;
    assert.deepEqual(completedViewingIds({ state }), ['1', '4']);
    assert.deepEqual(mainViewingIds({ state }), ['2', '3', '5', '6']);
    assert.equal(e.warnings.length, 0);
});

test('viewing collection stops at its elapsed-time budget without hiding unverified series', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_TIMEOUT_MS = 5;
    e.c.VIEWING_MAX_PASSES = 1;
    const fetch = e.c.fetch;
    e.c.fetch = async (...args) => {
        const response = await fetch(...args);
        const json = response.json;
        response.json = async () => { const body = await json(); await e.advance(5); return body; };
        return response;
    };
    await e.start();
    assert.equal(e.requests.length, 1);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.ok(mainViewingIds(e).includes('4'));
    assert.equal(e.timers.size, 0);
});

test('failed refresh reveals old completion results instead of hiding titles using stale status', async () => {
    const e = await viewingEnvironment();
    await e.start();
    assert.equal(completedViewingIds(e).length, 2);
    e.c.fetch = async () => ({ ok: false, status: 503 });
    await e.c.refreshViewingStatus(e.state);
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(mainViewingIds(e).length, 7);
    assert.equal(e.state.watchStatus.unknownCount, 7);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
});

test('completion accepts 90 percent or earlier credits even when Netflix still reports unwatched', async () => {
    const e = await viewingEnvironment();
    const classify = fields => e.c.classifyViewingVideo({
        type: 'movie', watched: false, bookmark: 0, runtime: 3600, creditsOffset: null, ...fields
    });
    assert.equal(classify({ bookmark: 3060 }), 'in-progress', '85 percent remains below the selected cutoff');
    assert.equal(classify({ bookmark: 3239 }), 'in-progress');
    assert.equal(classify({ bookmark: 3240 }), 'complete', 'the 90 percent boundary is inclusive');
    assert.equal(classify({ bookmark: 3241 }), 'complete');
    assert.equal(classify({ bookmark: 3420 }), 'complete', 'previously accepted 95 percent still qualifies');
    assert.equal(classify({ bookmark: 3200, creditsOffset: 3200 }), 'complete', 'an earlier real credits boundary wins');
    assert.equal(classify({ bookmark: 3199, creditsOffset: 3200 }), 'in-progress');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 3500 }), 'complete', 'later credits do not override 90 percent');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 4000 }), 'complete', 'invalid credits use the runtime threshold');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 0 }), 'complete');
    assert.equal(classify({ watched: true, bookmark: 0 }), 'complete', 'a confirmed Netflix completion remains sufficient');
    assert.equal(classify({ type: 'show', watched: true, bookmark: 3600 }), 'unknown', 'series need episode coverage');
});

test('near-completion requires valid progress and runtime rather than treating missing values as watched', async () => {
    const e = await viewingEnvironment();
    for (const fields of [
        { bookmarkPosition: atom(undefined) },
        { bookmarkPosition: atom(null) },
        { bookmarkPosition: atom(-1) },
        { bookmarkPosition: atom(Infinity) },
        { bookmarkPosition: atom('95') },
        { runtime: atom(undefined) },
        { runtime: atom(0) },
        { runtime: atom(-100) },
        { runtime: atom(NaN) },
        { runtime: atom('100') }
    ]) {
        const record = e.c.viewingVideoRecord({ videos: {
            1: viewingVideo('movie', false, 95, { creditsOffset: atom(90), ...fields })
        } }, '1');
        assert.notEqual(e.c.classifyViewingVideo(record), 'complete');
    }
    assert.equal(e.c.classifyViewingVideo(e.c.viewingVideoRecord({ videos: {
        1: viewingVideo('movie', false, 0)
    } }, '1')), 'not-started');
});

test('viewing requests resolve structured member API addresses before fetching', async () => {
    for (const path of [['/nq/website/memberapi/release'], ['nq', 'website', 'memberapi', 'release']]) {
        const e = await viewingEnvironment();
        e.models.services.memberapi = { protocol: 'https', hostname: 'www.netflix.com', path };
        const mockFetch = e.c.fetch;
        e.c.fetch = async (url, options) => {
            if (new URL(url).pathname !== '/nq/website/memberapi/release/pathEvaluator') {
                return { ok: false, status: 400 };
            }
            return mockFetch(url, options);
        };
        await e.start();
        assert.equal(e.state.watchStatus.failure, null);
        assert.deepEqual(completedViewingIds(e), ['1', '4']);
        assert.equal(e.requests.length, 3);
        assert.equal(e.timers.size, 0);
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
    }
});

test('viewing request addresses preserve string and build fallback support', async () => {
    for (const mode of ['relative', 'absolute', 'colon-protocol', 'build']) {
        const e = await viewingEnvironment();
        let expected = '/api/shakti/test-build/pathEvaluator';
        if (mode === 'relative') e.models.services.memberapi = '/api/shakti/test-build';
        if (mode === 'absolute') e.models.services.memberapi = 'https://www.netflix.com/api/shakti/test-build/';
        if (mode === 'colon-protocol') {
            e.models.services.memberapi = { protocol: 'https:', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] };
            expected = '/nq/website/memberapi/release/pathEvaluator';
        }
        if (mode === 'build') delete e.models.services.memberapi;
        await e.start();
        assert.equal(e.state.watchStatus.failure, null);
        assert.ok(e.requests.every(request => new URL(request.url).pathname === expected));
        assert.ok(e.logs.some(entry => entry.details?.endpointPath === expected));
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('active-profile'));
    }
});

test('malformed or unsafe structured viewing endpoints do not send requests', async () => {
    for (const memberapi of [
        {}, { protocol: 'https', hostname: 'www.netflix.com', path: '/nq/website/memberapi/release' },
        { protocol: 'https', hostname: 'www.netflix.com', path: [] },
        { protocol: 'https', hostname: 'www.netflix.com', path: [null] },
        { protocol: 'https', hostname: 'example.test', path: ['/nq/website/memberapi/release'] },
        { protocol: 'http', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] },
        { protocol: '', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] },
        { protocol: 'https', hostname: 'user:password@www.netflix.com', path: ['/nq/website/memberapi/release'] },
        'https://www.netflix.com/api/shakti/build?authURL=hidden',
        'https://www.netflix.com/api/shakti/build#hidden', true, 123
    ]) {
        const e = await viewingEnvironment();
        e.models.services.memberapi = memberapi;
        await e.start();
        assert.equal(e.requests.length, 0);
        assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_CONTEXT');
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.timers.size, 0);
    }
});

test('rejected viewing batches are attempted once and stop subsequent requests with endpoint diagnostics', async () => {
    const e = await viewingEnvironment(500);
    let attempts = 0;
    const batches = [];
    e.c.fetch = async (url, options) => {
        attempts++;
        batches.push(new URLSearchParams(options.body).getAll('path')[0]);
        assert.equal(new URL(url).pathname, '/nq/website/memberapi/release/pathEvaluator');
        return { ok: false, status: 400 };
    };
    await e.start();
    assert.equal(attempts, 2, 'only the initially allocated wave is attempted');
    assert.equal(new Set(batches).size, 2, 'neither failed batch is retried');
    assert.equal(e.state.watchStatus.requests, 2);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_400');
    assert.equal(e.state.watchStatus.unknownCount, 500);
    assert.equal(mainViewingIds(e).length, 500);
    assert.equal(completedViewingIds(e).length, 0);
    const start = e.logs.find(entry => entry.details?.endpointType === 'descriptor');
    assert.equal(start.details.endpointPath, '/nq/website/memberapi/release/pathEvaluator');
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('active-profile'));
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
    e.c.syncWatchGroups(e.state);
    await e.advance(60000);
    assert.equal(attempts, 2, 'there is no repeated retry loop');
});

test('credit-tolerant completion moves movies and fully caught-up series out of the main grid', async () => {
    const e = await viewingEnvironment();
    const fixtures = e.fixtures();
    fixtures.titles.videos[1] = viewingVideo('movie', false, 90, { creditsOffset: atom(99) });
    fixtures.titles.videos[2] = viewingVideo('movie', false, 85, { creditsOffset: atom(99) });
    fixtures.episodes.videos[400] = viewingVideo('episode', false, 90, { creditsOffset: atom(99) });
    fixtures.episodes.videos[401] = viewingVideo('episode', false, 85, { creditsOffset: atom(85) });
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.equal(e.state.watchStatus.ui.details.open, false);
    assert.equal(e.c.formatHeaderParts(7, 7, 10, true).meta, '2 items  time');
    assert.equal(e.requests.length, 3, 'completion threshold adds no requests');
    assert.equal(e.timers.size, 0);
});

test('an unfinished latest episode cannot qualify by averaging its progress with older episodes', async () => {
    const e = await viewingEnvironment();
    const fixtures = e.fixtures();
    fixtures.episodes.videos[400] = viewingVideo('episode', false, 100, { creditsOffset: atom(99) });
    fixtures.episodes.videos[401] = viewingVideo('episode', false, 80, { creditsOffset: atom(99) });
    await e.start();
    assert.ok(mainViewingIds(e).includes('4'), '100 percent plus 80 percent is still not caught up');
    assert.deepEqual(completedViewingIds(e), ['1']);
    fixtures.episodes.videos[401].bookmarkPosition = atom(90);
    await e.c.refreshViewingStatus(e.state);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
});

test('film filters default independently below the heading and inside watched details with accurate counts', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const watch = e.state.watchStatus, ui = watch.ui;
    assert.equal(watch.filters.main, 'movie');
    assert.equal(watch.filters.watched, 'movie');
    assert.equal(e.state.grid.firstElementChild, ui.mainFilter.root);
    assert.equal(ui.watchedFilter.root.parentElement, ui.details);
    assert.equal(ui.details.open, false);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1']);
    assert.equal(ui.mainFilter.buttons.get('movie').count.textContent, '2');
    assert.equal(ui.mainFilter.buttons.get('series').count.textContent, '2');
    assert.equal(ui.mainFilter.buttons.get('all').count.textContent, '5');
    assert.equal(ui.watchedFilter.buttons.get('movie').count.textContent, '1');
    assert.equal(ui.watchedFilter.buttons.get('series').count.textContent, '1');
    assert.equal(ui.mainFilter.root.getAttribute('role'), 'group');
    assert.equal(ui.mainFilter.buttons.get('movie').button.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.mainFilter.buttons.get('series').button.getAttribute('aria-pressed'), 'false');
    assert.equal(e.c.formatHeaderParts(7, 7, 10, true).meta, '2 items  time');
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1']);
    ui.details.open = true;
    ui.details.listeners.get('toggle')();
    clickViewingFilter(e, 'watched', 'series');
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['4']);
    assert.equal(ui.watchedFilter.buttons.get('series').button.getAttribute('aria-pressed'), 'true');
    assert.equal(e.state.items.length, 7);
    assert.equal(e.state.cloneMap.size, 7);
    assert.equal(e.requests.length, 3);
    assert.equal(e.timers.size, 0);
});

test('All includes unknown title types without assigning them to films or series', async () => {
    const e = await viewingEnvironment();
    await e.start();
    assert.ok(!e.state.watchStatus.types.has('7'));
    assert.match(e.state.watchStatus.ui.note.textContent, /Choose All/);
    clickViewingFilter(e, 'main', 'all');
    assert.deepEqual(filteredViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.equal(e.c.formatHeaderParts(7, 7, 10, true).meta, '5 items  time');
    assert.ok(!e.state.watchStatus.ui.note.textContent.includes('Choose All'));
    clickViewingFilter(e, 'main', 'movie');
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.equal(e.requests.length, 3);
});

test('unavailable metadata keeps every title reachable through All and displays an accurate empty filter state', async () => {
    const e = await viewingEnvironment();
    let attempts = 0;
    e.c.fetch = async () => { attempts++; return { ok: false, status: 400 }; };
    await e.start();
    assert.deepEqual(filteredViewingIds(e), []);
    assert.equal(e.state.watchStatus.ui.empty.hidden, false);
    assert.equal(e.state.watchStatus.ui.empty.textContent, 'No titles match this filter.');
    assert.equal(e.state.watchStatus.ui.mainFilter.buttons.get('all').count.textContent, '7');
    clickViewingFilter(e, 'main', 'all');
    assert.deepEqual(filteredViewingIds(e), ['1', '2', '3', '4', '5', '6', '7']);
    assert.equal(e.state.watchStatus.ui.empty.hidden, true);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_400');
    assert.equal(attempts, 1);
    assert.equal(e.timers.size, 0);
});

test('filter selections survive collapse and rebuild while stale controls cannot alter the new grid', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    const details = e.state.watchStatus.ui.details;
    details.open = true;
    details.listeners.get('toggle')();
    clickViewingFilter(e, 'watched', 'series');
    details.open = false;
    details.listeners.get('toggle')();
    details.open = true;
    details.listeners.get('toggle')();
    const oldUi = e.state.watchStatus.ui;
    const order = e.items.map(item => e.state.cloneMap.get('v:' + item.videoId).getAttribute('data-tm-item-order'));
    await e.c.buildGrid(e.section, e.scroller, e.items, e.layout, 7, 1);
    assert.equal(e.state.watchStatus.filters.main, 'series');
    assert.equal(e.state.watchStatus.filters.watched, 'series');
    assert.equal(e.state.watchStatus.ui.details.open, true);
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['4']);
    oldUi.mainFilter.buttons.get('movie').button.listeners.get('click')();
    assert.equal(e.state.watchStatus.filters.main, 'series');
    assert.deepEqual(e.items.map(item => e.state.cloneMap.get('v:' + item.videoId).getAttribute('data-tm-item-order')), order);
    assert.equal(e.requests.length, 3);
});

test('filtering cancels hover on hidden cards and rejects them until they become visible again', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clone = e.state.cloneMap.get('v:2');
    clone.__tmHoverActivationGeneration = 1;
    clone.__tmHoverActivationTimer = e.c.setTimeout(() => {}, 200);
    e.c.pendingGridHoverClone = clone;
    e.c.activeClone = clone;
    e.c.activeVideoId = '2';
    const token = e.c.hoverToken;
    clickViewingFilter(e, 'main', 'movie');
    assert.equal(e.c.hoverToken, token, 'clicking the selected filter does no interaction work');
    clickViewingFilter(e, 'main', 'series');
    assert.equal(e.c.pendingGridHoverClone, null);
    assert.equal(e.c.activeClone, null);
    assert.equal(e.timers.size, 0);
    assert.equal(e.c.gridOwnsClone(clone, e.state.grid), false);
    assert.equal(e.c.gridCloneFromPointerEvent({ target: clone.querySelector('card') }, e.state.grid), null);
    assert.equal(e.c.gridHoverTargetActive(clone, clone.__tmHoverActivationGeneration), false);
    clickViewingFilter(e, 'main', 'movie');
    assert.equal(e.c.gridOwnsClone(clone, e.state.grid), true);
    assert.equal(e.c.gridHoverTargetActive(clone, clone.__tmHoverActivationGeneration), true);
    assert.equal(e.requests.length, 3);
});

test('type filtering is available while series episode requests are still loading', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][2] === 'seasonList') return new Promise(resolve => { release = () => resolve(mockFetch(url, options)); });
        return mockFetch(url, options);
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    assert.equal(typeof release, 'function');
    assert.equal(e.state.watchStatus.loading, true);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.deepEqual(completedViewingIds(e), ['1'], 'confirmed movies move before episode requests return');
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['4', '5', '6']);
    release();
    await e.state.watchStatus.promise;
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.equal(e.state.watchStatus.filters.main, 'series');
    assert.equal(e.requests.length, 3);
});

test('filtered counts and card order stay correct through removal, Undo and unknown-type additions', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.c.getCarouselDomRuntime = () => ({ profile: { pageMode: 'indicator' } });
    vm.runInContext(declaration('reindexLegacyItemsAfterDelta'), e.c);
    assert.equal(e.c.applyLegacyRemoval('2'), true);
    assert.deepEqual(filteredViewingIds(e), ['3']);
    assert.equal(e.state.watchStatus.ui.mainFilter.buttons.get('movie').count.textContent, '1');
    const entry = e.c.recentRemovedMyListItems.get('2');
    assert.equal(e.c.applyLegacyAddition(entry.item, entry.index, 'undo'), true);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    const snapshot = e.state.cloneMap.get('v:1').cloneNode(true);
    assert.equal(e.c.applyLegacyAddition({ videoId: '99', page: 0, href: '/browse?jbv=99', snapshot }, 0), true);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.equal(e.state.watchStatus.ui.mainFilter.buttons.get('all').count.textContent, '6');
    clickViewingFilter(e, 'main', 'all');
    assert.deepEqual(filteredViewingIds(e), ['99', '2', '3', '5', '6', '7']);
    assert.equal(e.requests.length, 3);
});

test('native hover replacements preserve the visibility of filtered sibling cards', async () => {
    const e = await viewingEnvironment();
    await e.start();
    vm.runInContext(declaration('makeLiveClone'), e.c);
    e.c.netflixReactHover = { graftTreeToClone: () => ({ fiberAssignments: 0, propsAssignments: 0 }) };
    const item = e.state.items.find(item => item.videoId === '5');
    const old = e.state.cloneMap.get('v:5');
    const { fresh } = e.c.makeLiveClone(e.template, item, old, item.page);
    old.replaceWith(fresh);
    e.state.cloneMap.set('v:5', fresh);
    assert.equal(fresh.getAttribute('data-tm-type-hidden'), 'true');
    assert.equal(e.c.gridOwnsClone(fresh, e.state.grid), false);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.equal(e.c.gridOwnsClone(fresh, e.state.grid), true);
    assert.equal(e.requests.length, 3);
});

test('viewing refresh preserves type selections and updates counts when a series has new episodes', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    e.state.watchStatus.ui.details.open = true;
    e.state.watchStatus.ui.details.listeners.get('toggle')();
    clickViewingFilter(e, 'watched', 'series');
    e.setFixtures(viewingFixtures(true));
    await e.c.refreshViewingStatus(e.state);
    assert.equal(e.state.watchStatus.filters.main, 'series');
    assert.equal(e.state.watchStatus.filters.watched, 'series');
    assert.deepEqual(filteredViewingIds(e), ['4', '5', '6']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), []);
    assert.equal(e.state.watchStatus.ui.mainFilter.buttons.get('series').count.textContent, '3');
    assert.equal(e.state.watchStatus.ui.watchedFilter.buttons.get('movie').count.textContent, '1');
    assert.equal(e.state.watchStatus.ui.watchedEmpty.hidden, false);
    assert.equal(e.state.watchStatus.ui.watchedEmpty.textContent, 'No titles match this filter.');
    assert.equal(e.c.formatHeaderParts(7, 7, 10, true).meta, '3 items  time');
});

test('missing series episode totals are recovered from fully covered season summaries', async () => {
    const e = await viewingEnvironment();
    delete e.fixtures().titles.videos[4].episodeCount;
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    assert.ok(!completedViewingIds(e).includes('5'), 'a partly watched series still stays in the main grid');
    assert.equal(e.requests.length, 3, 'validated season metadata allows finale checks to share a batch');
});

test('small series batches fill the existing episode allowance without cutting off later series', async () => {
    const e = await viewingEnvironment(120);
    useCompleteSeriesResponses(e);
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(completedViewingIds(e).length, 120);
    assert.equal(e.requests.length, 9);
    assert.equal(e.state.watchStatus.failure, null);
});

test('missing season and episode totals require an explicit complete season-list length and valid per-season totals', async () => {
    const e = await viewingEnvironment();
    const record = e.c.viewingVideoRecord(e.fixtures().titles, '4');
    const missingCounts = { ...record, seasonCount: null, episodeCount: null };
    const graph = e.fixtures().seasons;
    assert.equal(e.c.viewingSeasonPlan(graph, missingCounts), null, 'a returned subset is not a complete season list');
    graph.videos[4].seasonList.length = atom(1);
    delete graph.seasons[40].summary;
    graph.seasons[40].length = atom(2);
    const plan = e.c.viewingSeasonPlan(graph, missingCounts);
    assert.equal(plan.expected, 2);
    assert.equal(plan.seasons.length, 1);
    assert.equal(plan.seasons[0].count, 2);
    for (const [seasonCount, episodeCount] of [[NaN, null], [1, NaN], [0, null], [41, null], [1, 501], [1, 3]]) {
        assert.equal(e.c.viewingSeasonPlan(graph, { ...missingCounts, seasonCount, episodeCount }), null);
    }
    graph.videos[4].seasonList[1] = reference('seasons', '50');
    assert.equal(e.c.viewingSeasonPlan(graph, missingCounts), null, 'extra returned seasons reject a contradictory length');
    delete graph.videos[4].seasonList[1];
    graph.seasons[40].length = atom('2');
    assert.equal(e.c.viewingSeasonPlan(graph, missingCounts), null);
});

test('a missing-count series requires validated season coverage and a usable completed latest episode', async () => {
    const e = await viewingEnvironment();
    const title = e.fixtures().titles.videos[4];
    delete title.seasonCount;
    delete title.episodeCount;
    e.fixtures().seasons.videos[4].seasonList.length = atom(1);
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    const request = e.requests.find(request => request.paths.some(path => path[2] === 'seasonList' && path[3] === 'length'));
    assert.ok(request);
    assert.equal(request.paths[0][3].to, 39);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 20);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(!completedViewingIds(e).includes('4'));
    delete e.fixtures().episodes.seasons[40].episodes[1];
    await e.c.refreshViewingStatus(e.state);
    assert.ok(!completedViewingIds(e).includes('4'), 'a missing latest reference cannot establish completion');
});

test('count recovery never replaces invalid or contradictory totals supplied by Netflix', async () => {
    const e = await viewingEnvironment();
    for (const [field, value] of [['episodeCount', '2'], ['episodeCount', -1], ['episodeCount', 2.5],
        ['episodeCount', true], ['episodeCount', {}], ['episodeCount', 3], ['seasonCount', '1']]) {
        const title = e.fixtures().titles.videos[4];
        title.seasonCount = atom(1);
        title.episodeCount = atom(2);
        title[field] = atom(value);
        if (!e.state.watchStatus) await e.start();
        else await e.c.refreshViewingStatus(e.state);
        assert.ok(!completedViewingIds(e).includes('4'), field + ': ' + JSON.stringify(value));
        assert.ok(mainViewingIds(e).includes('4'));
    }
});

test('bounded additional passes continue the same queue without reloading title or episode data', async () => {
    const e = await viewingEnvironment(3);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 3;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '2', '3']);
    assert.equal(e.requests.length, 7);
    assert.equal(e.state.watchStatus.passes, 3);
    assert.equal(e.state.watchStatus.failure, null);
    assert.equal(e.requests.filter(request => Array.isArray(request.paths[0][2])).length, 1);
    const episodePaths = e.requests.filter(request => request.paths[0][0] === 'seasons').flatMap(request => request.paths);
    assert.equal(new Set(episodePaths.map(path => JSON.stringify(path))).size, episodePaths.length);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('a latest range can continue across a pass boundary without fetching older ranges', async () => {
    const e = await viewingEnvironment(1);
    useCompleteSeriesResponses(e, { 1: 500 });
    e.c.VIEWING_MAX_REQUESTS = 2;
    e.c.VIEWING_MAX_PASSES = 2;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.requests.length, 3);
    assert.equal(e.state.watchStatus.passes, 2);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons').map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
});

test('the total continuation request cap is finite and leaves unprocessed series visible', async () => {
    const e = await viewingEnvironment(4);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200, 4: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 2;
    await e.start();
    assert.equal(e.requests.length, 6);
    assert.equal(e.state.watchStatus.passes, 2);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1', '2']);
    assert.deepEqual(mainViewingIds(e), ['3', '4']);
    const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
    assert.equal(diagnostic.pending, 2);
    await e.advance(120000);
    assert.equal(e.requests.length, 6, 'no recurring timer restarts an exhausted scan');
    assert.equal(e.timers.size, 0);
});

test('the combined scan time cap bounds a scan even when few requests consume the entire allowance', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_TIMEOUT_MS = 5;
    e.c.VIEWING_MAX_PASSES = 2;
    const mockFetch = e.c.fetch;
    e.c.fetch = async (...args) => {
        const response = await mockFetch(...args);
        const json = response.json;
        response.json = async () => { const body = await json(); await e.advance(5); return body; };
        return response;
    };
    await e.start();
    assert.equal(e.requests.length, 2);
    assert.equal(e.state.watchStatus.passes, 1);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.timers.size, 0);
});

test('slow successful requests can use the total time allowance without aborting at the old 30-second boundary', async () => {
    const e = await viewingEnvironment(3);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    for (let wave = 0; wave < 7 && e.state.watchStatus.loading; wave++) {
        for (let attempt = 0; attempt < 10; attempt++) await e.flush();
        const active = pending.filter(entry => !entry.released);
        if (!active.length) break;
        // Parallel reads experience the same elapsed interval; advancing the
        // shared clock once per response would incorrectly double their wait.
        await e.advance(7000);
        active.forEach(entry => entry.release());
    }
    await e.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(e), ['1', '2', '3']);
    assert.equal(e.requests.length, 7);
    assert.equal(e.state.watchStatus.failure, null);
    assert.equal(e.state.watchStatus.network.totalRequestMs, 49000);
    assert.equal(e.c.collectViewingNetworkDiagnostics(e.state.watchStatus.network).elapsedMs, 35000);
    assert.equal(e.timers.size, 0);
});

test('an unfinished or unreadable latest episode saves older-range requests for later titles', async () => {
    for (const mode of ['unfinished', 'missing-fields', 'missing-ref']) {
        const e = await viewingEnvironment(2);
        useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
        const mockFetch = e.c.fetch;
        e.c.fetch = async (...args) => {
            const response = await mockFetch(...args);
            const json = response.json;
            response.json = async () => {
                const body = await json();
                if (body.jsonGraph.videos['10001499']) {
                    if (mode === 'unfinished') body.jsonGraph.videos['10001499'] = viewingVideo('episode', false, 20);
                    if (mode === 'missing-fields') body.jsonGraph.videos['10001499'] = { summary: atom({ type: 'episode' }) };
                    if (mode === 'missing-ref') delete body.jsonGraph.seasons['10001'].episodes[499];
                }
                return body;
            };
            return response;
        };
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['2'], mode);
        assert.deepEqual(mainViewingIds(e), ['1']);
        assert.equal(e.requests.length, mode === 'missing-fields' ? 4 : 3,
            'unavailable fields get one direct follow-up; unfinished episodes and missing IDs do not');
        const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons' && request.paths[0][1] === '10001');
        assert.equal(ranges.length, 1);
        const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
        assert.equal(diagnostic.episodesChecked, 2);
        assert.equal(mode === 'unfinished' ? diagnostic.incomplete : diagnostic.unknown, 1);
        assert.equal(e.timers.size, 0);
    }
});

test('verified groups appear before a later request completes while filters remain selected', async () => {
    const e = await viewingEnvironment(51);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'seasons' && paths[0][1] === '10051') {
            return new Promise(resolve => { release = () => resolve(mockFetch(url, options)); });
        }
        return mockFetch(url, options);
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && (!release || completedViewingIds(e).length !== 50); attempt++) await e.flush();
    assert.equal(typeof release, 'function');
    assert.equal(e.state.watchStatus.loading, true);
    assert.equal(completedViewingIds(e).length, 50);
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['51']);
    e.state.watchStatus.ui.details.open = true;
    e.state.watchStatus.ui.details.listeners.get('toggle')();
    clickViewingFilter(e, 'watched', 'series');
    assert.equal(filteredViewingIds(e, 'watched').length, 50);
    release();
    await e.state.watchStatus.promise;
    assert.equal(filteredViewingIds(e, 'watched').length, 51);
    assert.equal(e.state.watchStatus.filters.watched, 'series');
    assert.equal(e.state.watchStatus.filters.main, 'series');
});

test('route and profile cancellation stop an additional pass without changing a newer grid or leaking prior results', async () => {
    for (const mode of ['route', 'profile']) {
        const e = await viewingEnvironment(3);
        useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
        e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
        e.c.VIEWING_MAX_REQUESTS = 3;
        const mockFetch = e.c.fetch;
        let signal, release;
        e.c.fetch = async (url, options) => {
            const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
            if (paths[0][0] === 'seasons' && paths[0][1] === '10002') {
                signal = options.signal;
                return { ok: true, json: () => new Promise((resolve, reject) => {
                    release = () => resolve({ jsonGraph: {} });
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                }) };
            }
            return mockFetch(url, options);
        };
        e.c.initializeWatchGroups(e.state, 1);
        for (let attempt = 0; attempt < 10 && (!release || !completedViewingIds(e).includes('1')); attempt++) await e.flush();
        assert.equal(typeof release, 'function');
        assert.deepEqual(completedViewingIds(e), ['1']);
        const promise = e.state.watchStatus.promise;
        if (mode === 'route') {
            e.c.sourceState = { grid: { isConnected: true }, watchStatus: { newer: true } };
            e.c.isRouteSessionActive = token => token === 2;
            e.c.abortObsoleteRouteFetches();
        } else {
            e.models.userInfo.userGuid = 'other-profile';
            release();
        }
        await promise;
        if (mode === 'route') assert.equal(e.c.sourceState.watchStatus.newer, true);
        else {
            assert.deepEqual(completedViewingIds(e), []);
            assert.equal(e.state.watchStatus.types.size, 0);
            assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_PROFILE_CHANGED');
        }
        assert.equal(signal.aborted, true);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
    }
});

function useSparseNestedEpisodes(e, predicate, direct = null) {
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        const followUp = paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount');
        const response = await mockFetch(url, options);
        const json = response.json;
        response.json = async () => {
            const body = structuredClone(await json());
            if (paths[0][0] === 'seasons') {
                for (const [id, video] of Object.entries(body.jsonGraph.videos || {})) {
                    if (predicate(id)) body.jsonGraph.videos[id] = { summary: video.summary, runtime: video.runtime };
                }
            } else if (followUp && direct) direct(body.jsonGraph, paths[0][1]);
            return body;
        };
        return response;
    };
}

test('referenced watched and progress fields are resolved without accepting cyclic or missing references', async () => {
    const e = await viewingEnvironment();
    const graph = { videos: { 400: { summary: reference('values', 'summary'), watched: reference('values', 'watched'),
        bookmarkPosition: reference('values', 'bookmark'), runtime: reference('values', 'runtime') } },
        values: { summary: atom({ type: 'episode' }), watched: atom(false), bookmark: atom(95), runtime: atom(100) } };
    assert.equal(e.c.classifyViewingVideo(e.c.viewingVideoRecord(graph, '400')), 'complete');
    graph.values.watched = { $type: 'ref', value: ['values', 'watched'] };
    delete graph.values.bookmark;
    assert.equal(e.c.classifyViewingVideo(e.c.viewingVideoRecord(graph, '400')), 'unknown');
});

test('direct episode lookups recover caught-up series from sparse nested responses', async () => {
    const e = await viewingEnvironment();
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.equal(e.requests.length, 4);
    const direct = e.requests.at(-1).paths[0];
    assert.deepEqual(direct[1], ['401']);
    const details = e.logs.find(entry => entry.details?.recheck)?.details;
    assert.equal(details.recheck.candidates, 1);
    assert.equal(details.recheck.requests, 1);
    assert.equal(details.recheck.recoveredEpisodes, 1);
    assert.equal(details.recheck.recoveredSeries, 1);
    assert.equal(details.series.complete, 1);
    assert.equal(details.series.unknown, 0);
    assert.equal(details.recheck.initialUnknownFields.watched.missing, 1);
    assert.equal(e.timers.size, 0);
});

test('direct responses can fill missing progress fields while known unfinished episodes stay visible', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 90);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 90);
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
        delete graph.videos[400].runtime;
        delete graph.videos[401].runtime;
    });
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'), 'the nested runtime and direct bookmark together establish completion');
    assert.ok(mainViewingIds(e).includes('5'), 'a known partly watched series never enters the repair queue');
});

test('an unusable direct response is attempted once and cannot turn unknown, negative or conflicting data into watched', async () => {
    for (const mode of ['absent', 'negative', 'wrong-type']) {
        const e = await viewingEnvironment();
        useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
            if (mode === 'absent') { delete graph.videos[400]; delete graph.videos[401]; }
            else for (const id of ['400', '401']) graph.videos[id] = mode === 'negative'
                ? viewingVideo('episode', false, -1) : viewingVideo('show', true);
        });
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['1'], mode);
        assert.equal(e.requests.length, 4);
        const recheck = e.logs.find(entry => entry.details?.recheck)?.details.recheck;
        assert.equal(recheck.recoveredSeries, 0);
        assert.equal(recheck.unknownEpisodes, 1);
        if (mode === 'negative') assert.equal(recheck.remainingUnknownFields.bookmark['atom:negative-number'], 1);
        await e.advance(120000);
        assert.equal(e.requests.length, 4, 'failed rechecks never become an automatic retry loop');
        assert.equal(e.timers.size, 0);
    }
});

test('repair batches are limited to 200 unique IDs and start after all ordinary series have been checked', async () => {
    const e = await viewingEnvironment(250);
    useCompleteSeriesResponses(e, Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index + 1, 120])));
    useSparseNestedEpisodes(e, id => Number(id) < 10250000);
    const mockFetch = e.c.fetch;
    const baseCounts = [];
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
            baseCounts.push(completedViewingIds(e).slice());
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 250 }, (_, index) => String(index + 1)));
    assert.deepEqual(baseCounts[0], ['250'], 'the later known complete series is preserved before repair begins');
    const repair = e.requests.filter(request => request.paths[0][0] === 'videos' && Array.isArray(request.paths[0][2]) &&
        !request.paths[0][2].includes('seasonCount'));
    assert.deepEqual(repair.map(request => request.paths[0][1].length), [200, 49]);
    const ids = repair.flatMap(request => request.paths[0][1]);
    assert.equal(new Set(ids).size, 249);
    assert.equal(e.logs.find(entry => entry.details?.recheck)?.details.recheck.recoveredSeries, 249);
});

test('a repaired latest episode qualifies a long series without fetching older ranges or double-counting it', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
    useSparseNestedEpisodes(e, id => id === '10001499');
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '2']);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons' && request.paths[0][1] === '10001')
        .map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
    const details = e.logs.find(entry => entry.details?.recheck)?.details;
    assert.equal(details.series.checked, 2);
    assert.equal(details.series.complete, 2);
    assert.equal(details.series.unknown, 0);
    assert.equal(details.recheck.recoveredSeries, 1);
    assert.equal(e.requests.length, 4);
});

test('repair budget exhaustion preserves known series and leaves an unknown latest episode visible', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
    useSparseNestedEpisodes(e, id => id === '10001499');
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['2']);
    assert.equal(e.requests.length, 3);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_BUDGET');
    const report = e.c.collectViewingSeriesDiagnostics(e.state);
    assert.equal(report[0].checkedEpisodes, 1);
    assert.equal(report[0].expectedEpisodes, 500);
    assert.equal(report[0].reason, 'unavailable-episode-progress');
    assert.equal(e.timers.size, 0);
});

test('a failed direct request retains known watched titles and never retries the endpoint', async () => {
    const e = await viewingEnvironment();
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
            e.requests.push({ paths });
            return { ok: false, status: 503 };
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
    assert.equal(e.requests.length, 4);
    assert.equal(e.logs.find(entry => entry.details?.recheck)?.details.recheck.requests, 1);
    assert.equal(e.c.routeFetchControllers.size, 0);
    assert.equal(e.timers.size, 0);
});

test('copy-only series diagnostics explain the named cases without exporting video IDs, raw payloads or credentials', async () => {
    const e = await viewingEnvironment();
    const titles = ['Weeds', 'Ozark', 'Chilling Adventures of Sabrina', 'You'];
    titles.forEach((title, index) => { e.state.items[index + 3].ariaLabel = title; });
    e.fixtures().titles.videos[7] = viewingVideo('show', true, 0, { seasonCount: atom(0) });
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
        delete graph.videos[400]; delete graph.videos[401];
    });
    await e.start();
    const report = e.c.collectViewingSeriesDiagnostics(e.state);
    assert.deepEqual(report.map(row => row.title), titles);
    assert.equal(report[0].reason, 'unavailable-episode-progress');
    assert.equal(report[0].unknownEpisodes, 1);
    assert.equal(report[0].unknownFields.watched.missing, 1);
    assert.equal(report[1].reason, 'unfinished-episodes');
    assert.equal(report[1].unfinishedEpisodes, 1);
    for (const row of report) assert.ok(!Object.hasOwn(row, 'videoId'));
    let thumbnailReads = 0;
    Object.assign(e.c, { collectRuntimeSnapshot: () => ({}),
        collectThumbnailDiagnostics: state => { assert.equal(state, e.state); thumbnailReads++; return { available: true }; },
        formatLogValue: value => JSON.stringify(value),
        formatSystemTimestamp: () => 'now', investigationLog: [], retainedInvestigationLog: () => [],
        SCRIPT_VERSION: '1.2.2', getHtmlLanguage: () => 'en', getNetflixLanguage: () => 'en', getLogLocale: () => 'en',
        navigator: { userAgent: 'test', language: 'en' }, window: { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 } });
    vm.runInContext(declaration('buildInvestigationLogText'), e.c);
    const text = e.c.buildInvestigationLogText();
    assert.match(text, /seriesViewing: .*Weeds/);
    assert.match(text, /thumbnailDiagnostics: \{"available":true\}/);
    assert.equal(thumbnailReads, 1);
    assert.ok(!text.includes('test-auth-token'));
    assert.ok(!text.includes('active-profile'));
    assert.ok(!text.includes('jsonGraph'));
});

function thumbnailEnvironment() {
    const e = constructionEnvironment();
    e.c.window = { innerWidth: 1000, innerHeight: 600 };
    e.c.getComputedStyle = () => ({ aspectRatio: 'auto', paddingTop: '0px', paddingBottom: '0px' });
    e.c.sourceState.initializationStartedAt = 100;
    e.c.performance.getEntriesByType = () => [];
    vm.runInContext(source.match(/^    const THUMBNAIL_DIAGNOSTIC_LIMITS = Object\.freeze\(\{[^]*?^    \}\);/m)?.[0] || '', e.c);
    for (const name of ['collectThumbnailDiagnostics', 'sampleThumbnailGeometry', 'collectThumbnailResourceTiming']) {
        vm.runInContext(declaration(name), e.c);
    }
    const reads = { queries: 0, rects: 0, styles: 0 };
    const computedStyle = e.c.getComputedStyle;
    e.c.getComputedStyle = node => { reads.styles++; return computedStyle(node); };
    function addImage(options = {}) {
        const parent = options.parent || e.oldGrid;
        const clone = parent.appendChild(new ConstructionNode('slot'));
        const image = clone.appendChild(new ConstructionNode('img'));
        const query = clone.querySelector.bind(clone);
        clone.querySelector = selector => { reads.queries++; return query(selector); };
        const url = options.url || `https://images.test/private-${e.c.sourceState.cloneMap.size}.jpg?signature=secret`;
        Object.assign(image, { src: url, currentSrc: url, complete: true, naturalWidth: 200, naturalHeight: 100,
            loading: 'lazy', decoding: 'async', ...options });
        if (options.hidden) clone.setAttribute('data-tm-type-hidden', 'true');
        const rect = options.rect || { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
        image.getBoundingClientRect = () => { reads.rects++; return rect; };
        clone.getBoundingClientRect = () => { reads.rects++; return { ...rect, height: 130, bottom: rect.top + 130 }; };
        // The measurement must not start requests, decode images, or change the DOM.
        image.decode = () => { throw new Error('Image decode was induced'); };
        for (const node of [image, clone]) {
            node.setAttribute = node.removeAttribute = () => { throw new Error('Diagnostic DOM mutation'); };
        }
        e.c.sourceState.cloneMap.set(String(e.c.sourceState.cloneMap.size), clone);
        return { clone, image, url };
    }
    return { ...e, reads, addImage, report: () => e.c.collectThumbnailDiagnostics(e.c.sourceState) };
}

function imageResourceEnvironment() {
    const observers = [];
    class Observer {
        static supportedEntryTypes = ['resource'];
        constructor(callback) { this.callback = callback; this.disconnections = 0; observers.push(this); }
        observe(options) { this.options = structuredClone(options); }
        disconnect() { this.disconnections++; }
        emit(entries) { this.callback({ getEntries: () => entries }); }
    }
    const e = environment(['startImageResourceDiagnostics', 'stopImageResourceDiagnostics', 'recordImageResourceEntries'], {
        PerformanceObserver: Observer, imageResourceObserver: null,
        sourceState: { watchStatus: { network: { finishedAt: 100 } } }
    });
    vm.runInContext(source.match(/^    const IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES = \d+;/m)?.[0] || '', e.c);
    return { ...e, observers, Observer, start: () => e.c.startImageResourceDiagnostics(e.c.routeSessionToken),
        report: () => e.c.collectPerformanceDiagnostics().imageResources };
}

test('image resource observations continue beyond full history using scalar counters without reading URLs or DOM', () => {
    const e = imageResourceEnvironment();
    e.c.performance.getEntriesByType = () => { throw new Error('Saved resource history was queried'); };
    e.c.performance.clearResourceTimings = e.c.performance.setResourceTimingBufferSize = () => { throw new Error('Global timing buffer changed'); };
    e.start();
    assert.deepEqual(e.observers[0].options, { entryTypes: ['resource'] });
    const entries = Array.from({ length: 300 }, (_, index) => {
        const entry = { initiatorType: 'img', startTime: index + 1, duration: 8, transferSize: 0, deliveryType: '' };
        Object.defineProperty(entry, 'name', { get() { throw new Error('Resource URL read'); } });
        return entry;
    });
    e.observers[0].emit([{ initiatorType: 'img', startTime: -10 }, { initiatorType: 'fetch', startTime: 1 }, ...entries]);
    const report = e.report();
    assert.equal(report.active, true);
    assert.equal(report.entriesExamined, 302);
    assert.equal(report.beforeRouteOrInvalid, 1);
    assert.equal(report.imageEntries, 300);
    assert.equal(report.startedAfterViewingScan, 201);
    assert.equal(report.totalFetchMs, 2400);
    assert.equal(report.maxFetchMs, 8);
    assert.equal(report.lastImageStartOffsetMs, 300);
    assert.equal(report.zeroTransferSizeEntries, 300);
    assert.equal(report.cacheDelivery, 0, 'zero transfer size alone cannot establish cache delivery');
    report.imageEntries = -1;
    assert.equal(e.report().imageEntries, 300);
    assert.equal(e.timers.size + e.frames.size, 0);
    assert.equal(e.c.imageResourceObserver.observer, e.observers[0]);
});

test('image resource diagnostics stop at their route budget and ignore obsolete callbacks', () => {
    const e = imageResourceEnvironment();
    e.start(); e.start();
    assert.equal(e.observers.length, 1);
    e.observers[0].emit(Array.from({ length: 4005 }, () => ({ initiatorType: 'img', startTime: 10, duration: 1 })));
    const stopped = e.report();
    assert.equal(stopped.imageEntries, 4000);
    assert.equal(stopped.entriesExamined, 4000);
    assert.equal(stopped.skippedAtLimit, 5);
    assert.equal(stopped.active, false);
    assert.equal(stopped.stopReason, 'entry-limit');
    assert.equal(e.observers[0].disconnections, 1);
    e.observers[0].emit([{ initiatorType: 'img', startTime: 10 }]);
    e.start();
    assert.equal(e.observers.length, 1);
    assert.deepEqual(e.report(), stopped);
    e.c.performanceDiagnostics = e.c.createPerformanceDiagnostics();
    e.start();
    const next = e.report();
    e.observers[0].emit([{ initiatorType: 'img', startTime: 10 }]);
    assert.deepEqual(e.report(), next);
    e.c.isRouteSessionActive = () => false;
    e.observers[1].emit([{ initiatorType: 'img', startTime: 10 }]);
    assert.deepEqual(e.report(), next);
});

test('image resource observation failures remain private and route lifecycle disconnects the observer', () => {
    const e = imageResourceEnvironment();
    e.c.PerformanceObserver = undefined;
    e.start();
    assert.equal(e.report().stopReason, 'unsupported');
    e.c.PerformanceObserver = class { static supportedEntryTypes = ['mark']; };
    e.start();
    assert.equal(e.report().stopReason, 'unsupported');
    e.c.PerformanceObserver = class { static get supportedEntryTypes() { throw new Error('private-support-details'); } };
    e.start();
    assert.equal(e.report().stopReason, 'observe-failed');
    assert.ok(!JSON.stringify(e.report()).includes('private-support-details'));
    e.c.PerformanceObserver = class extends e.Observer { observe() { throw new Error('private-api-details'); } };
    e.start();
    assert.equal(e.report().stopReason, 'observe-failed');
    assert.equal(e.c.imageResourceObserver, null);
    assert.equal(e.observers[0].disconnections, 1);
    assert.ok(!JSON.stringify(e.report()).includes('private-api-details'));
    e.c.PerformanceObserver = e.Observer;
    e.start();
    e.observers[1].callback({ getEntries() { throw new Error('private-resource-information'); } });
    assert.equal(e.report().stopReason, 'read-failed');
    assert.equal(e.observers[1].disconnections, 1);
    const live = fetchEnvironment(6);
    live.routeLifecycle();
    live.c.PerformanceObserver = e.Observer;
    live.c.startImageResourceDiagnostics(live.c.routeSessionToken);
    live.c.suspendTargetSession('resource-test-leave');
    assert.equal(e.observers[2].disconnections, 1);
    assert.equal(live.c.collectPerformanceDiagnostics().imageResources.active, false);
    live.c.startTargetSession('resource-test-enter');
    assert.equal(live.c.collectPerformanceDiagnostics().imageResources.active, true);
    assert.equal(live.c.collectPerformanceDiagnostics().imageResources.imageEntries, 0);
    assert.equal(e.observers.length, 4);
    live.c.suspendTargetSession('resource-test-done');
    assert.equal(e.observers[3].disconnections, 1);
});

test('thumbnail diagnostics distinguish the selected image from script-assigned artwork without exposing either URL', () => {
    const e = thumbnailEnvironment();
    const same = e.addImage();
    const different = e.addImage({ src: 'https://images.test/assigned-secret.jpg', currentSrc: 'https://images.test/selected-secret.jpg' });
    const unselected = e.addImage({ currentSrc: '', complete: false, naturalWidth: 0, naturalHeight: 0 });
    for (const row of [same, different, unselected]) row.image.attributes.set('data-tm-graphql-image', 'true');
    const report = e.report();
    assert.equal(report.sourceSelection.graphqlAssigned, 3);
    assert.equal(report.sourceSelection.graphqlSelectionMatches, 1);
    assert.equal(report.sourceSelection.graphqlSelectionDiffers, 1);
    assert.equal(report.sourceSelection.graphqlSelectionUnresolved, 1);
    assert.ok(!JSON.stringify(report).includes('secret'));
});

test('copy-only thumbnail measurements separate pending, hidden and current geometry without exposing sources', () => {
    const e = thumbnailEnvironment();
    const ready = e.addImage();
    const pending = e.addImage({ complete: false, naturalWidth: 0, naturalHeight: 0,
        rect: { left: 0, top: 900, right: 200, bottom: 900, width: 200, height: 0 } });
    pending.image.attributes.set('width', '200'); pending.image.attributes.set('height', '100');
    e.addImage({ loading: 'eager', decoding: 'sync', hidden: true });
    const details = e.oldGrid.appendChild(new ConstructionNode('details')); details.open = false;
    const watched = details.appendChild(new ConstructionNode('watched'));
    watched.setAttribute('data-tm-watch-grid', 'true');
    e.addImage({ parent: watched });
    e.addImage({ naturalWidth: 0, naturalHeight: 0 });
    e.addImage({ src: '', currentSrc: '', complete: true, naturalWidth: 0, naturalHeight: 0 });
    e.c.performance.getEntriesByType = type => {
        assert.equal(type, 'resource');
        return [
            { name: ready.url, initiatorType: 'img', startTime: 20, duration: 500, transferSize: 12345 },
            { name: ready.url, initiatorType: 'img', startTime: 110, duration: 12, transferSize: 240, deliveryType: '' },
            { name: pending.url, initiatorType: 'img', startTime: 120, duration: 8, transferSize: 0, deliveryType: 'cache' },
            { name: 'https://unrelated.test/auth-token', initiatorType: 'img', startTime: 130, duration: 900 },
            { name: ready.url, initiatorType: 'fetch', startTime: 140, duration: 99 }
        ];
    };
    const report = e.report();
    assert.equal(report.available, true);
    assert.equal(report.images, 6);
    assert.deepEqual({ ...report.pixels }, { ready: 3, pending: 1, completeWithoutPixels: 1, noSource: 1 });
    assert.deepEqual({ ...report.visibility }, { renderEligible: 4, filterHidden: 1, collapsedWatched: 1, otherHidden: 0 });
    assert.equal(report.loading.lazy, 5); assert.equal(report.loading.eager, 1);
    assert.equal(report.decoding.async, 5); assert.equal(report.decoding.sync, 1);
    assert.equal(report.dimensionAttributes.paired, 1);
    assert.equal(report.geometry.sampleCount, 4);
    assert.equal(report.geometry.zeroArea.pending, 1);
    assert.equal(report.geometry.pendingWithImageBox, 0);
    assert.equal(report.geometry.pendingWithParentBox, 1);
    assert.equal(report.resourceTiming.matchedEntries, 2);
    assert.equal(report.resourceTiming.entriesBeforeInitializationSkipped, 1);
    assert.equal(report.resourceTiming.uniqueSourceMatches, 2);
    assert.equal(report.resourceTiming.fetchDurationMs.total, 20);
    assert.equal(report.resourceTiming.zeroTransferSizeEntries, 1);
    assert.equal(report.resourceTiming.cacheDelivery, 1);
    assert.equal(report.resourceTiming.positionAtRequestKnown, false);
    assert.equal(report.resourceTiming.imageDecodeMeasured, false);
    assert.equal(report.resourceTiming.layoutShiftsMeasured, false);
    const text = JSON.stringify(report);
    for (const secret of ['https:', 'private-', 'signature', 'secret', 'auth-token']) assert.ok(!text.includes(secret));
    assert.equal(e.reads.rects, 8);
    assert.equal(e.timers.size + e.frames.size, 0);
});

test('thumbnail copy work is bounded and discloses incomplete sampling and resource history', () => {
    const e = thumbnailEnvironment();
    for (let index = 0; index < 605; index++) e.addImage({ complete: false, naturalWidth: 0, naturalHeight: 0 });
    const entries = Array.from({ length: 2100 }, () => ({ name: 'unrelated', initiatorType: 'img', startTime: 110 }));
    e.c.performance.getEntriesByType = () => entries;
    const report = e.report();
    assert.equal(report.mappedCards, 605);
    assert.equal(report.cardsExamined, 600);
    assert.equal(report.truncated, true);
    assert.equal(e.reads.queries, 600);
    assert.equal(report.geometry.eligibleImages, 600);
    assert.equal(report.geometry.sampleCount, 24);
    assert.equal(e.reads.rects, 48);
    assert.equal(e.reads.styles, 48);
    assert.equal(report.resourceTiming.bufferedEntries, 2100);
    assert.equal(report.resourceTiming.examinedEntries, 2000);
    assert.equal(report.resourceTiming.truncated, true);
    assert.equal(report.resourceTiming.sourcesWithoutEntry, 600);
    assert.equal(e.timers.size + e.frames.size, 0);
});

test('thumbnail diagnostics handle unavailable APIs and obsolete ownership without failing Copy Logs', () => {
    const e = thumbnailEnvironment();
    e.addImage();
    e.c.performance.getEntriesByType = undefined;
    e.c.getComputedStyle = undefined;
    let report = e.report();
    assert.equal(report.resourceTiming.available, false);
    assert.equal(report.resourceTiming.reason, 'unsupported');
    assert.equal(report.geometry.sampleCount, 1);
    assert.equal(report.geometry.styleAvailable, false);
    e.c.performance.getEntriesByType = () => { throw new Error('private-image-url'); };
    report = e.report();
    assert.equal(report.resourceTiming.reason, 'read-failed');
    assert.ok(!JSON.stringify(report).includes('private-image-url'));
    const queries = e.reads.queries;
    assert.equal(e.c.collectThumbnailDiagnostics({ grid: e.oldGrid, cloneMap: new Map() }).available, false);
    e.c.isRouteSessionActive = () => false;
    assert.equal(e.report().available, false);
    assert.equal(e.reads.queries, queries);
    e.c.isRouteSessionActive = () => true;
    e.oldGrid.setConnected(false);
    assert.equal(e.report().available, false);
    assert.equal(e.reads.queries, queries);
});

test('thumbnail geometry accounts for visual viewport offsets and native dimension hints without changing layout', () => {
    const e = thumbnailEnvironment();
    e.c.window.visualViewport = { offsetLeft: 100, offsetTop: 50, width: 500, height: 300 };
    const images = [
        { left: 150, top: 100, right: 350, bottom: 200, width: 200, height: 100 },
        { left: 150, top: 400, right: 350, bottom: 500, width: 200, height: 100 },
        { left: 150, top: -100, right: 350, bottom: 0, width: 200, height: 100 },
        { left: 700, top: 100, right: 900, bottom: 200, width: 200, height: 100 }
    ].map(rect => e.addImage({ rect, complete: false, naturalWidth: 0, naturalHeight: 0 }));
    e.c.getComputedStyle = node => ({ aspectRatio: node.id === 'img' ? 'auto 2 / 1' : '2 / 1',
        paddingTop: '0px', paddingBottom: node.id === 'img' ? '0px' : '25px' });
    const report = e.report();
    for (const position of ['inViewport', 'belowViewport', 'aboveViewport', 'outsideViewport']) {
        assert.equal(report.geometry[position].pending, 1);
    }
    assert.equal(report.geometry.pendingWithImageBox, 4);
    assert.equal(report.geometry.imageAspectRatioHint, 4);
    assert.equal(report.geometry.parentAspectRatioHint, 4);
    assert.equal(report.geometry.parentBlockPadding, 4);
    for (const { image } of images) {
        assert.equal(image.loading, 'lazy'); assert.equal(image.decoding, 'async');
        assert.equal(image.naturalHeight, 0);
    }
    images[0].image.getBoundingClientRect = () => { throw new Error('private-layout-information'); };
    const failed = e.report();
    assert.equal(failed.available, true);
    assert.equal(failed.geometry.available, false);
    assert.equal(failed.geometry.reason, 'read-failed');
    assert.ok(!JSON.stringify(failed).includes('private-layout-information'));
});

test('thumbnail inventory rejects retained stale trees and handles malformed or unresolved image URLs', () => {
    const e = thumbnailEnvironment();
    e.addImage({ url: 'http://%' });
    const srcset = e.addImage({ src: '', currentSrc: '', complete: false, naturalWidth: 0, naturalHeight: 0 });
    srcset.image.attributes.set('srcset', 'https://images.test/secret 1x');
    const missing = e.addImage(); missing.image.remove();
    const stale = e.addImage(); stale.clone.remove();
    const foreign = e.addImage(); e.section.appendChild(foreign.clone);
    const report = e.report();
    assert.equal(report.available, true);
    assert.equal(report.images, 2);
    assert.equal(report.cardsWithoutImage, 1);
    assert.equal(report.detachedCards, 2);
    assert.equal(report.sourceSelection.invalidUrl, 1);
    assert.equal(report.sourceSelection.unresolved, 1);
    assert.equal(report.pixels.pending, 1, 'a srcset-only lazy image has a source even before currentSrc is selected');
    assert.equal(report.resourceTiming.sourcesConsidered, 0);
    assert.equal(report.geometry.sampleCount, 2);
    assert.equal(e.reads.queries, 3);
});

test('profile and route changes cancel direct episode reads and discard profile-specific diagnostic summaries', async () => {
    for (const mode of ['profile', 'route']) {
        const e = await viewingEnvironment();
        useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
        const mockFetch = e.c.fetch;
        let release, signal;
        e.c.fetch = async (url, options) => {
            const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
            if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
                signal = options.signal;
                return { ok: true, json: () => new Promise((resolve, reject) => {
                    release = () => resolve({ jsonGraph: e.fixtures().episodes });
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                }) };
            }
            return mockFetch(url, options);
        };
        e.c.initializeWatchGroups(e.state, 1);
        for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
        assert.equal(typeof release, 'function');
        assert.deepEqual(completedViewingIds(e), ['1']);
        const promise = e.state.watchStatus.promise;
        if (mode === 'profile') { e.models.userInfo.userGuid = 'different-profile'; release(); }
        else {
            e.c.sourceState = { watchStatus: { newer: true } };
            e.c.isRouteSessionActive = token => token === 2;
            e.c.abortObsoleteRouteFetches();
        }
        await promise;
        if (mode === 'profile') {
            assert.equal(e.state.watchStatus.seriesDetails.size, 0);
            assert.equal(e.state.watchStatus.types.size, 0);
            assert.equal(completedViewingIds(e).length, 0);
        } else assert.equal(e.c.sourceState.watchStatus.newer, true);
        assert.equal(signal.aborted, true);
        assert.equal(e.c.routeFetchControllers.size, 0);
        assert.equal(e.timers.size, 0);
    }
});

function clickManualViewing(e, id, action = 'toggle', grid = e.state.grid, button = null) {
    const clone = e.state.cloneMap.get('v:' + id);
    button ||= clone.__tmViewingControls[action === 'reset' ? 'reset' : 'toggle'];
    const events = [];
    grid.listeners.get('click')({ target: button, preventDefault: () => events.push('prevent'),
        stopPropagation: () => events.push('stop'), stopImmediatePropagation: () => events.push('immediate') });
    return events;
}

test('a completed latest episode outweighs reset older progress and the copy report identifies the inference', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 20);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 90);
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    const row = e.c.collectViewingSeriesDiagnostics(e.state)[0];
    assert.equal(row.reason, 'latest-episode-complete');
    assert.equal(row.unfinishedEpisodes, 0, 'older episode progress is no longer fetched');
    assert.equal(row.checkedEpisodes, 1);
    assert.deepEqual({ ...row.latestEpisode }, { season: 1, episode: 2, status: 'complete', percent: 90,
        thresholdPercent: 90, watched: false, creditsReached: false, reason: 'completion-threshold' });
    assert.equal(e.requests.length, 3);
});

test('latest episode diagnostics distinguish below 90 percent, earlier credits, flags and absent progress', async () => {
    for (const [record, expected, percent, reason] of [
        [viewingVideo('episode', false, 89.8), false, 89.8, 'below-completion-threshold'],
        [viewingVideo('episode', false, 85, { creditsOffset: atom(85) }), true, 85, 'credits-reached'],
        [viewingVideo('episode', true, -1), true, null, 'watched-flag'],
        [{ summary: atom({ type: 'episode' }), bookmarkPosition: atom(-1), runtime: atom(100) }, false, null, 'progress-unavailable']
    ]) {
        const e = await viewingEnvironment();
        e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 0);
        e.fixtures().episodes.videos[401] = record;
        await e.start();
        const latest = e.c.collectViewingSeriesDiagnostics(e.state)[0].latestEpisode;
        assert.equal(completedViewingIds(e).includes('4'), expected);
        assert.equal(latest.percent, percent);
        assert.equal(latest.reason, reason);
        if (percent === null && !expected) assert.equal(latest.fields.bookmark, 'atom:negative-number');
    }
});

test('an unknown finale receives a direct follow-up even when older episodes are unfinished', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 20);
    useSparseNestedEpisodes(e, id => id === '401');
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    assert.deepEqual(e.requests.at(-1).paths[0][1], ['401']);
    assert.equal(e.c.collectViewingSeriesDiagnostics(e.state)[0].latestEpisode.reason, 'watched-flag');
});

test('the latest nonempty season is checked before older unfinished seasons', async () => {
    const e = await viewingEnvironment(1);
    e.fixtures().titles.videos[1] = viewingVideo('show', true, 0, { seasonCount: atom(3), episodeCount: atom(202) });
    e.fixtures().seasons = { videos: { 1: { seasonList: { 0: reference('seasons', '10'),
        1: reference('seasons', '11'), 2: reference('seasons', '12') } } },
        seasons: { 10: { summary: atom({ length: 200 }) }, 11: { summary: atom({ length: 2 }) }, 12: { summary: atom({ length: 0 }) } } };
    e.fixtures().episodes = { seasons: { 11: { episodes: { 0: reference('videos', '110'), 1: reference('videos', '111') } } },
        videos: { 110: viewingVideo('episode', false, 0), 111: viewingVideo('episode', false, 90) } };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.requests.length, 3);
    assert.deepEqual(e.requests[2].paths.map(path => path[1]), ['11']);
    const row = e.c.collectViewingSeriesDiagnostics(e.state)[0];
    assert.equal(row.latestEpisode.season, 2);
    assert.equal(row.checkedEpisodes, 1);
    assert.equal(row.expectedEpisodes, 202);
});

test('malformed season plans, invalid finale references and wrong video types cannot establish the latest hint', async () => {
    for (const mode of ['count', 'wrong-ref', 'wrong-type']) {
        const e = await viewingEnvironment();
        if (mode === 'count') e.fixtures().titles.videos[4].episodeCount = atom(3);
        if (mode === 'wrong-ref') e.fixtures().episodes.seasons[40].episodes[1] = reference('seasons', '400');
        if (mode === 'wrong-type') e.fixtures().episodes.videos[401] = viewingVideo('show', true);
        await e.start();
        assert.ok(!completedViewingIds(e).includes('4'), mode);
        assert.ok(mainViewingIds(e).includes('4'), mode);
    }
});

test('manual choices move cards immediately, update filters and counts, and perform no Netflix request', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const requests = e.requests.length;
    const itemOrder = e.state.items.map(item => item.videoId);
    const mainBefore = e.state.watchStatus.visibleCount;
    assert.deepEqual(clickManualViewing(e, '2'), ['prevent', 'stop', 'immediate']);
    assert.deepEqual(completedViewingIds(e), ['1', '2', '4']);
    assert.equal(e.state.watchStatus.completedCount, 3);
    assert.equal(e.state.watchStatus.visibleCount, mainBefore - 1);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1', '2']);
    assert.equal(e.state.watchStatus.filters.main, 'movie');
    assert.equal(e.requests.length, requests);
    assert.deepEqual(e.state.items.map(item => item.videoId), itemOrder);
    assert.equal(e.state.totalCount, 7);
    assert.equal(e.storageCalls.writes, 1);
    assert.equal(e.state.cloneMap.get('v:2').__tmViewingControls.toggle.textContent, 'Move back to My List');
});

test('manual choices survive reloads and automatic refresh and can be reversed or cleared', async () => {
    const first = await viewingEnvironment();
    await first.start();
    clickManualViewing(first, '2');
    const next = await viewingEnvironment(7, null, first.storage);
    await next.start();
    assert.ok(completedViewingIds(next).includes('2'));
    await next.c.refreshViewingStatus(next.state);
    assert.ok(completedViewingIds(next).includes('2'));
    next.state.watchStatus.ui.details.open = true;
    clickManualViewing(next, '2');
    assert.ok(mainViewingIds(next).includes('2'));
    next.fixtures().titles.videos[2] = viewingVideo('movie', true);
    await next.c.refreshViewingStatus(next.state);
    assert.ok(mainViewingIds(next).includes('2'), 'an explicit main-list choice outweighs automatic completion');
    clickManualViewing(next, '2', 'reset');
    assert.ok(completedViewingIds(next).includes('2'));
    assert.equal(next.state.watchStatus.manualChoices.has('2'), false);
    assert.equal(next.state.cloneMap.get('v:2').__tmViewingControls.reset.hidden, true);
});

test('manual corrections remain available when optional viewing requests fail', async () => {
    const e = await viewingEnvironment();
    e.c.fetch = async () => ({ ok: false, status: 503 });
    await e.start();
    clickViewingFilter(e, 'main', 'all');
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(e.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
});

test('a manual series correction expires for an added episode and the change is persisted', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    assert.ok(completedViewingIds(e).includes('5'));
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('5'));
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    e.fixtures().seasons.seasons[50].summary = atom({ length: 3 });
    e.fixtures().episodes.seasons[50].episodes[2] = reference('videos', '502');
    e.fixtures().episodes.videos[502] = viewingVideo('episode', false, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(e.state.watchStatus.manualChoices.has('5'), false);
    assert.equal(Object.hasOwn(e.storage.get('test.viewingChoices.active-profile').choices, '5'), false);
});

test('manual series corrections detect a new season without relying on a larger total count', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].seasonCount = atom(2);
    e.fixtures().seasons.videos[5].seasonList[1] = reference('seasons', '51');
    e.fixtures().seasons.seasons[50].summary = atom({ length: 1 });
    e.fixtures().seasons.seasons[51] = { summary: atom({ length: 1 }) };
    e.fixtures().episodes.seasons[51] = { episodes: { 0: reference('videos', '510') } };
    e.fixtures().episodes.videos[510] = viewingVideo('episode', false, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(e.state.watchStatus.manualChoices.has('5'), false);
});

test('unavailable or conflicting season metadata preserves a manual correction until reliable new coverage arrives', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('5'));
    assert.deepEqual(structuredClone(e.state.watchStatus.manualChoices.get('5').coverage), [['50', 2]]);
    assert.equal(e.storageCalls.writes, 1);
});

test('a correction made before season metadata arrives captures its first reliable baseline once', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const json = response.json;
        if (e.requests.length === 2) response.json = () => new Promise(resolve => { release = async () => resolve(await json()); });
        return response;
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    assert.equal(e.state.watchStatus.manualChoices.get('5').coverage, null);
    await release();
    await e.state.watchStatus.promise;
    assert.deepEqual(structuredClone(e.state.watchStatus.manualChoices.get('5').coverage), [['50', 2]]);
    assert.equal(e.storageCalls.writes, 2);
    for (let i = 0; i < 10; i++) e.c.syncWatchGroups(e.state);
    assert.equal(e.storageCalls.writes, 2, 'stable synchronization performs no repeated writes');
});

test('profile switching isolates manual choices and stale controls cannot write to the new profile', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    e.models.userInfo.userGuid = 'second-profile';
    clickManualViewing(e, '3');
    assert.equal(e.storageCalls.writes, 1, 'the click on the previous profile is rejected');
    assert.equal(e.state.watchStatus.manualChoices.size, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('2'));
    clickManualViewing(e, '3');
    assert.ok(completedViewingIds(e).includes('3'));
    e.models.userInfo.userGuid = 'active-profile';
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('2'));
    assert.ok(mainViewingIds(e).includes('3'));
    assert.deepEqual(Object.keys(e.storage.get('test.viewingChoices.second-profile').choices), ['3']);
});

test('storage read/write failures surface without pretending a correction was remembered', async () => {
    for (const mode of ['read', 'write']) {
        const e = await viewingEnvironment();
        if (mode === 'read') e.c.GM_getValue = () => { throw new Error('denied'); };
        await e.start();
        if (mode === 'write') e.c.GM_setValue = () => { throw new Error('denied'); };
        clickManualViewing(e, '2');
        assert.ok(mainViewingIds(e).includes('2'));
        assert.equal(e.state.watchStatus.manualChoices.has('2'), false);
        assert.equal([...e.storage.keys()].filter(key => key.startsWith('test.viewingChoices.')).length, 0);
        assert.match(e.state.watchStatus.ui.note.textContent, /Could not save viewing choices/);
        assert.equal(e.state.cloneMap.get('v:2').__tmViewingControls.toggle.disabled, true);
    }
});

test('malformed persisted choices are ignored and missing profile identity never writes a correction', async () => {
    const storage = new Map([['test.viewingChoices.active-profile', { version: 1, choices: {
        2: { status: 'complete', type: 'movie', coverage: null },
        3: { status: 'complete', type: 'movie', coverage: 'bad' },
        5: { status: 'complete', type: 'series', coverage: [['50', -1]] },
        garbage: { status: 'complete', type: 'movie', coverage: null }
    } }]]);
    const e = await viewingEnvironment(7, null, storage);
    await e.start();
    assert.deepEqual([...e.state.watchStatus.manualChoices.keys()], ['2']);
    const writes = e.storageCalls.writes;
    delete e.models.userInfo.userGuid;
    e.c.syncWatchGroups(e.state);
    clickManualViewing(e, '3');
    assert.equal(e.storageCalls.writes, writes);
    assert.equal(e.state.watchStatus.manualChoices.size, 0);
});

test('rebuilds and card replacements keep one working action row and reject obsolete controls', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const oldGrid = e.state.grid;
    const oldButton = e.state.cloneMap.get('v:2').__tmViewingControls.toggle;
    await e.c.buildGrid(e.section, e.scroller, e.items, e.layout, 7, 1);
    clickManualViewing(e, '2', 'toggle', oldGrid, oldButton);
    assert.equal(e.storageCalls.writes, 0);
    const clone = e.state.cloneMap.get('v:2');
    assert.equal(clone.children.filter(child => child.getAttribute('data-tm-viewing-actions') === 'true').length, 1);
    const replacement = clone.cloneNode(true);
    e.c.normalizeClone(replacement);
    replacement.__tmMyListItem = clone.__tmMyListItem;
    clone.replaceWith(replacement);
    e.state.cloneMap.set('v:2', replacement);
    e.c.syncWatchGroups(e.state);
    assert.equal(replacement.children.filter(child => child.getAttribute('data-tm-viewing-actions') === 'true').length, 1);
    clickManualViewing(e, '2', 'toggle', e.state.grid, clone.__tmViewingControls.toggle);
    assert.equal(e.storageCalls.writes, 0);
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
});

test('viewing controls cancel pending popup preparation and ordinary artwork can regain hover intent', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clone = e.state.cloneMap.get('v:2');
    const card = clone.querySelector('card');
    const handler = e.state.grid.listeners.get('pointerover');
    handler({ target: card, relatedTarget: null });
    assert.equal(e.c.pendingGridHoverClone, clone);
    const button = clone.__tmViewingControls.toggle;
    handler({ target: button, relatedTarget: card });
    assert.equal(e.c.pendingGridHoverClone, null);
    assert.equal(e.c.gridCloneFromPointerEvent({ target: button }, e.state.grid), null);
    assert.equal(e.c.gridHoverTargetActive(clone, clone.__tmHoverActivationGeneration), false);
    handler({ target: card, relatedTarget: null });
    assert.equal(clone.__tmViewingControlHovered, false);
    assert.equal(e.c.pendingGridHoverClone, clone);
    e.c.cancelPendingGridHover();
    assert.equal(e.timers.size, 0);
});

test('manual grouping survives removal and Undo and detailed logs omit stored profile and season IDs', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.c.applyLegacyRemoval('5');
    e.c.syncWatchGroups(e.state);
    const entry = e.c.recentRemovedMyListItems.get('5');
    assert.equal(e.c.applyLegacyAddition(entry.item, entry.index, 'undo'), true);
    e.c.syncWatchGroups(e.state);
    assert.ok(completedViewingIds(e).includes('5'));
    const row = e.c.collectViewingSeriesDiagnostics(e.state).find(row => row.manualChoice === 'complete');
    assert.equal(row.status, 'complete');
    assert.equal(row.automaticStatus, 'in-progress');
    const report = JSON.stringify(row);
    assert.ok(!report.includes('active-profile'));
    assert.ok(!report.includes('test-auth-token'));
    assert.ok(!report.includes('coverage'));
    assert.ok(!report.includes('videoId'));
});

test('saving from an older tab preserves unrelated corrections already saved by another tab', async () => {
    const first = await viewingEnvironment();
    const second = await viewingEnvironment(7, null, first.storage);
    await first.start();
    await second.start();
    clickManualViewing(first, '2');
    clickManualViewing(second, '3');
    assert.deepEqual(Object.keys(first.storage.get('test.viewingChoices.active-profile').choices), ['2', '3']);
    assert.ok(completedViewingIds(second).includes('2'));
    clickViewingFilter(first, 'main', 'series');
    clickManualViewing(first, '5');
    assert.deepEqual(Object.keys(first.storage.get('test.viewingChoices.active-profile').choices), ['2', '3', '5']);
});

test('stable manual card synchronization performs no storage calls, allocations or attribute writes', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    const before = { ...e.storageCalls, created: e.created.length, requests: e.requests.length };
    for (const clone of e.state.cloneMap.values()) {
        for (const button of [clone.__tmViewingControls.toggle, clone.__tmViewingControls.reset]) {
            button.setAttribute = () => { throw new Error('unchanged button attribute write'); };
        }
    }
    for (let index = 0; index < 10; index++) e.c.syncWatchGroups(e.state);
    assert.deepEqual({ ...e.storageCalls, created: e.created.length, requests: e.requests.length }, before);
});

test('new episodes are revealed in the current grid even if saving manual expiry fails', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    e.fixtures().seasons.seasons[50].summary = atom({ length: 3 });
    e.fixtures().episodes.seasons[50].episodes[2] = reference('videos', '502');
    e.fixtures().episodes.videos[502] = viewingVideo('episode', false, 0);
    let attempts = 0;
    e.c.GM_setValue = key => {
        if (key.startsWith('test.viewingChoices.')) attempts++;
        throw new Error('storage failure');
    };
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(e.state.watchStatus.manualChoices.has('5'), false);
    assert.equal(attempts, 1);
    assert.equal(e.state.watchStatus.manualFailure, true);
    for (let index = 0; index < 5; index++) e.c.syncWatchGroups(e.state);
    assert.equal(attempts, 1, 'failed persistence does not create a repeated write loop');
});

test('native hover clone replacement publishes correctly labeled manual controls before another group sync', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.c.graftedGridClones = new Set();
    e.c.netflixReactHover = { graftTreeToClone: () => ({ fiberAssignments: 0, propsAssignments: 0 }) };
    for (const name of ['makeLiveClone', 'findGridClone', 'setGridClone']) vm.runInContext(declaration(name), e.c);
    const item = e.state.items.find(item => item.videoId === '2');
    const old = e.state.cloneMap.get('v:2');
    const { fresh } = e.c.makeLiveClone(e.template, item, old, item.page);
    old.replaceWith(fresh);
    e.c.setGridClone(item, fresh);
    assert.equal(fresh.__tmViewingControls.toggle.textContent, 'Mark watched');
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(fresh.__tmViewingControls.toggle.textContent, 'Move back to My List');
});

test('late automatic baseline capture preserves a newer manual choice saved in another tab', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const json = response.json;
        if (e.requests.length === 2) response.json = () => new Promise(resolve => { release = async () => resolve(await json()); });
        return response;
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    const next = await viewingEnvironment(7, null, e.storage);
    await next.start();
    next.state.watchStatus.ui.details.open = true;
    clickViewingFilter(next, 'watched', 'series');
    clickManualViewing(next, '5');
    await release();
    await e.state.watchStatus.promise;
    assert.equal(e.state.watchStatus.manualChoices.get('5').status, 'main');
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(e.storage.get('test.viewingChoices.active-profile').choices[5].status, 'main');
});

test('marking titles into the collapsed watched section preserves the viewport while handing off focus', async () => {
    const e = await viewingEnvironment();
    await e.start();
    let viewport = { x: 40, y: 2400 };
    let focused = 0;
    e.state.watchStatus.ui.summary.focus = options => {
        focused++;
        if (!options?.preventScroll) viewport = { x: 0, y: 7600 };
    };
    const before = { ...viewport };
    const requests = e.requests.length;
    for (const id of ['2', '3']) {
        clickManualViewing(e, id);
        assert.ok(completedViewingIds(e).includes(id));
        assert.deepEqual(viewport, before, 'a completed card must not pull the viewport down to the watched heading');
        assert.equal(e.state.watchStatus.ui.details.open, false);
    }
    assert.equal(focused, 2, 'keyboard focus still leaves controls that became hidden');
    assert.equal(e.storageCalls.writes, 2);
    assert.equal(e.requests.length, requests);
});

test('reversing and resetting a correction preserve the viewport when the destination filter hides the card', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    e.state.watchStatus.ui.details.open = true;
    clickViewingFilter(e, 'main', 'series');
    let viewport = { x: 0, y: 6500 };
    e.state.watchStatus.ui.summary.focus = options => {
        if (!options?.preventScroll) viewport = { x: 0, y: 7900 };
    };
    clickManualViewing(e, '2');
    assert.deepEqual(viewport, { x: 0, y: 6500 });
    assert.ok(mainViewingIds(e).includes('2'));
    assert.equal(e.state.cloneMap.get('v:2').getAttribute('data-tm-type-hidden'), 'true');
    e.fixtures().titles.videos[2] = viewingVideo('movie', true);
    await e.c.refreshViewingStatus(e.state);
    clickViewingFilter(e, 'main', 'movie');
    clickViewingFilter(e, 'watched', 'series');
    viewport = { x: 0, y: 2200 };
    clickManualViewing(e, '2', 'reset');
    assert.deepEqual(viewport, { x: 0, y: 2200 });
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(e.state.watchStatus.manualChoices.has('2'), false);
});

function holdViewingResponse(e, matches = () => true) {
    const mockFetch = e.c.fetch;
    let held = false;
    const gate = { release: null };
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (!held && matches(paths)) {
            held = true;
            const json = response.json;
            response.json = () => new Promise(resolve => { gate.release = async () => resolve(await json()); });
        }
        return response;
    };
    return gate;
}

test('confirmed movies publish after the first title batch while later title responses are pending', async () => {
    const e = await viewingEnvironment(120);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    const gate = holdViewingResponse(e, paths => paths[0][1][0] === '51');
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await e.flush();
    assert.equal(typeof gate.release, 'function');
    assert.equal(e.state.watchStatus.loading, true);
    assert.equal(completedViewingIds(e).length, 50);
    assert.equal(e.state.watchStatus.publications, 1);
    assert.equal(e.state.watchStatus.requests, 2, 'the pending independent peer has already reserved its request');
    assert.equal(mainViewingIds(e).length, 70);
    assert.equal(e.storageCalls.cacheWrites, 0, 'batch publication does not write storage');
    await gate.release();
    await e.state.watchStatus.promise;
    assert.equal(completedViewingIds(e).length, 120);
    assert.equal(e.requests.length, 3);
    assert.equal(e.storageCalls.cacheWrites, 1);
});

test('500 long series use 500 finale records and 30 bounded requests instead of downloading older progress', async () => {
    const e = await viewingEnvironment(500);
    useCompleteSeriesResponses(e, Object.fromEntries(Array.from({ length: 500 }, (_, index) => [index + 1, 500])));
    await e.start();
    assert.equal(completedViewingIds(e).length, 500);
    assert.equal(e.requests.length, 30);
    const episodePaths = e.requests.filter(request => request.paths[0][0] === 'seasons').flatMap(request => request.paths);
    assert.equal(episodePaths.length, 500);
    assert.ok(episodePaths.every(path => path[3].from === 499 && path[3].to === 499));
    assert.ok(e.requests.filter(request => request.paths[0][2] === 'seasonList').every(request => request.paths.length <= 50));
    const details = e.logs.find(entry => entry.details?.series)?.details;
    assert.equal(details.series.episodesChecked, 500);
    assert.equal(details.series.pending, 0);
    assert.equal(details.failure, null);
    assert.equal(e.state.totalCount, 500);
    assert.equal(e.state.cloneMap.size, 500);
});

test('a recent same-profile cache groups titles before the first response and remains read-only during browsing', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const next = await viewingEnvironment(7, null, first.storage);
    const gate = holdViewingResponse(next);
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    assert.deepEqual(filteredViewingIds(next), ['2', '3']);
    assert.equal(next.state.watchStatus.ui.details.open, false);
    assert.equal(next.state.watchStatus.cachedTitles, 6);
    const row = next.c.collectViewingSeriesDiagnostics(next.state)[0];
    assert.equal(row.automaticStatus, 'complete');
    assert.equal(row.cachedStatus, true);
    for (let index = 0; index < 10; index++) next.c.syncWatchGroups(next.state);
    assert.equal(next.storageCalls.cacheReads, 1);
    assert.equal(next.storageCalls.cacheWrites, 0);
    await next.flush();
    await gate.release();
    await next.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    assert.equal(next.state.watchStatus.cachedResults.size, 0);
    assert.equal(next.c.collectViewingSeriesDiagnostics(next.state)[0].cachedStatus, false);
    assert.equal(next.storageCalls.cacheWrites, 1);
    assert.equal(next.requests.length, first.requests.length, 'startup reuse adds no requests and still revalidates');
    const calls = { ...next.storageCalls };
    for (let index = 0; index < 10; index++) next.c.syncWatchGroups(next.state);
    await next.advance(60000);
    assert.deepEqual(next.storageCalls, calls);
    assert.equal(next.requests.length, 3);
});

test('fresh movies replace cache immediately and a newly unfinished finale returns a cached series to My List', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const next = await viewingEnvironment(7, null, first.storage);
    next.setFixtures(viewingFixtures(true));
    next.fixtures().titles.videos[1] = viewingVideo('movie', false);
    const gate = holdViewingResponse(next, paths => paths[0][0] === 'seasons');
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await next.flush();
    assert.equal(typeof gate.release, 'function');
    assert.deepEqual(completedViewingIds(next), ['4'], 'show-level progress does not prematurely remove a cached finale result');
    assert.equal(next.state.watchStatus.results.get('1'), 'not-started');
    await gate.release();
    await next.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(next), []);
    assert.ok(mainViewingIds(next).includes('4'));
    assert.equal(next.c.collectViewingSeriesDiagnostics(next.state)[0].latestEpisode.episode, 3);
    assert.equal(next.storage.get('test.viewingCache.active-profile').entries[4][1], 'in-progress');
});

test('manual main-list choices outweigh initial cached completion and never enter the automatic cache', async () => {
    const first = await viewingEnvironment();
    await first.start();
    first.state.watchStatus.ui.details.open = true;
    clickManualViewing(first, '1');
    const next = await viewingEnvironment(7, null, first.storage);
    const gate = holdViewingResponse(next);
    next.c.initializeWatchGroups(next.state, 1);
    assert.ok(mainViewingIds(next).includes('1'));
    assert.deepEqual(completedViewingIds(next), ['4']);
    await next.flush();
    await gate.release();
    await next.state.watchStatus.promise;
    assert.ok(mainViewingIds(next).includes('1'));
    assert.equal(next.storage.get('test.viewingCache.active-profile').entries[1][1], 'complete');
    assert.equal(next.storage.get('test.viewingChoices.active-profile').choices[1].status, 'main');
});

test('a failed verification reveals cached automatic titles but retains explicit manual watched choices', async () => {
    const first = await viewingEnvironment();
    await first.start();
    clickManualViewing(first, '2');
    const next = await viewingEnvironment(7, null, first.storage);
    next.c.fetch = async () => ({ ok: false, status: 503 });
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '2', '4']);
    await next.state.watchStatus.promise;
    assert.deepEqual(completedViewingIds(next), ['2']);
    assert.equal(next.state.watchStatus.cachedResults.size, 0);
    assert.equal(next.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
    assert.deepEqual(Object.keys(next.storage.get('test.viewingCache.active-profile').entries), []);
    assert.equal(next.storage.get('test.viewingChoices.active-profile').choices[2].status, 'complete');
});

test('startup cache validates age, schema, cutoff and membership without trusting malformed entries', async () => {
    const e = await viewingEnvironment();
    e.setCacheTime(100000000);
    const valid = { version: 1, completionRatio: 0.9, savedAt: 100000000,
        entries: { 1: ['movie', 'complete'], 4: ['series', 'complete'], 999: ['movie', 'complete'] } };
    const key = 'test.viewingCache.active-profile';
    e.storage.set(key, valid);
    assert.deepEqual([...e.c.readViewingCache(e.state, 'active-profile').results.keys()], ['1', '4']);
    for (const invalid of [
        { ...valid, version: 2 }, { ...valid, completionRatio: 0.95 }, { ...valid, savedAt: 0 },
        { ...valid, savedAt: 100000001 }, { ...valid, savedAt: NaN }, { ...valid, entries: [] },
        { ...valid, entries: Object.fromEntries(Array.from({ length: 5001 }, (_, index) => [index, ['movie', 'complete']])) }
    ]) {
        e.storage.set(key, invalid);
        assert.equal(e.c.readViewingCache(e.state, 'active-profile').results.size, 0);
    }
    e.storage.set(key, { ...valid, entries: { 1: ['movie', 'complete'], 2: ['movie', true],
        3: ['movie', 'complete', 'extra'], 4: ['episode', 'complete'], 5: null } });
    assert.deepEqual([...e.c.readViewingCache(e.state, 'active-profile').results.keys()], ['1']);
});

test('optional cache storage errors preserve fresh grouping and working manual corrections', async () => {
    for (const mode of ['read', 'write']) {
        const e = await viewingEnvironment();
        const method = mode === 'read' ? 'GM_getValue' : 'GM_setValue';
        const original = e.c[method];
        e.c[method] = (key, value) => {
            if (key.startsWith('test.viewingCache.')) throw new Error('cache denied');
            return original(key, value);
        };
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['1', '4']);
        assert.equal(e.state.watchStatus.failure, null);
        assert.equal(e.state.watchStatus.manualFailure, false);
        clickManualViewing(e, '2');
        assert.ok(completedViewingIds(e).includes('2'));
        assert.equal(e.storage.get('test.viewingChoices.active-profile').choices[2].status, 'complete');
    }
});

test('cache reuse is isolated by the active profile and a cancelled response cannot publish or save it', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const other = await viewingEnvironment(7, null, first.storage);
    other.models.userInfo.userGuid = 'other-profile';
    const otherGate = holdViewingResponse(other);
    other.c.initializeWatchGroups(other.state, 1);
    assert.deepEqual(completedViewingIds(other), []);
    assert.equal(other.state.watchStatus.cachedTitles, 0);
    await other.flush();
    await otherGate.release();
    await other.state.watchStatus.promise;
    assert.equal(other.storageCalls.cacheWrites, 1);
    assert.ok(other.storage.has('test.viewingCache.other-profile'));
    for (const mode of ['profile', 'route']) {
        const next = await viewingEnvironment(7, null, first.storage);
        const gate = holdViewingResponse(next);
        next.c.initializeWatchGroups(next.state, 1);
        assert.deepEqual(completedViewingIds(next), ['1', '4']);
        await next.flush();
        if (mode === 'profile') next.models.userInfo.userGuid = 'third-profile';
        else {
            next.c.sourceState = { grid: { isConnected: true }, watchStatus: { newer: true } };
            next.c.isRouteSessionActive = token => token === 2;
        }
        await gate.release();
        await next.state.watchStatus.promise;
        assert.equal(next.storageCalls.cacheWrites, 0);
        if (mode === 'profile') {
            assert.deepEqual(completedViewingIds(next), []);
            assert.equal(next.state.watchStatus.cachedResults.size, 0);
            assert.equal(next.state.watchStatus.failure, 'VIEWING_STATUS_PROFILE_CHANGED');
        } else assert.equal(next.c.sourceState.watchStatus.newer, true);
        assert.equal(next.c.routeFetchControllers.size, 0);
        assert.equal(next.timers.size, 0);
    }
});

test('a later startup failure preserves fresh movie results and drops only unverified cached titles', async () => {
    const first = await viewingEnvironment(60);
    first.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        first.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    await first.start();
    const next = await viewingEnvironment(60, null, first.storage);
    next.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        next.requests.push({ paths });
        return paths[0][1][0] === '51' ? { ok: false, status: 503 } : {
            ok: true, json: async () => ({ jsonGraph: {
                videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
            } })
        };
    };
    next.c.initializeWatchGroups(next.state, 1);
    assert.equal(completedViewingIds(next).length, 60);
    await next.state.watchStatus.promise;
    assert.equal(completedViewingIds(next).length, 50);
    assert.deepEqual(mainViewingIds(next), Array.from({ length: 10 }, (_, index) => String(index + 51)));
    assert.equal(Object.keys(next.storage.get('test.viewingCache.active-profile').entries).length, 50);
    assert.equal(next.storageCalls.cacheWrites, 1);
    assert.equal(next.state.watchStatus.failure, 'VIEWING_STATUS_HTTP_503');
});

test('refresh keeps the current series grouping until its new finale result arrives without rereading storage', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.setFixtures(viewingFixtures(true));
    const gate = holdViewingResponse(e, paths => paths[0][0] === 'seasons');
    const promise = e.c.refreshViewingStatus(e.state);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await e.flush();
    assert.equal(typeof gate.release, 'function');
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.equal(e.storageCalls.cacheReads, 1);
    assert.equal(e.storageCalls.cacheWrites, 1);
    await gate.release();
    await promise;
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.storageCalls.cacheWrites, 2);
    assert.equal(e.state.watchStatus.cachedResults.size, 0);
});

test('a warm 500-series scan initializes card controls once and performs no further work while browsing', async () => {
    const first = await viewingEnvironment(500);
    useCompleteSeriesResponses(first);
    await first.start();
    const e = await viewingEnvironment(500, null, first.storage);
    useCompleteSeriesResponses(e);
    let controls = 0, visibilityReads = 0;
    for (const clone of e.state.cloneMap.values()) {
        const getAttribute = clone.getAttribute.bind(clone);
        clone.getAttribute = key => {
            if (key === 'data-tm-type-hidden') visibilityReads++;
            return getAttribute(key);
        };
    }
    const syncCard = e.c.syncManualViewingCard;
    e.c.syncManualViewingCard = (...args) => { controls++; return syncCard(...args); };
    await e.start();
    assert.equal(controls, 500, 'the previous warm scan revisited controls 11,500 times');
    assert.equal(visibilityReads, 500, 'unchanged batches avoid card attribute reads after initial grouping');
    assert.equal(e.requests.length, 30);
    assert.equal(e.state.watchStatus.publications, 20);
    assert.equal(completedViewingIds(e).length, 500);
    const work = e.c.collectPerformanceDiagnostics();
    assert.equal(work.viewingGroups.fullSyncs, 1);
    assert.equal(work.viewingGroups.cardsConsidered, 1500);
    assert.equal(work.viewingGroups.controlsUpdated, controls);
    assert.deepEqual(structuredClone(e.logs.find(entry => entry.details?.series).details.work), structuredClone(work));
    await e.advance(60000);
    assert.deepEqual(structuredClone(e.c.collectPerformanceDiagnostics()), structuredClone(work));
    assert.equal(e.timers.size, 0);
});

async function unfinishedMovieGrid(count = 500) {
    const e = await viewingEnvironment(count);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', false)]))
        } }) };
    };
    await e.start();
    return e;
}

test('one manual movie move touches one of 500 controls and preserves an unrelated stationary hover', async () => {
    const e = await unfinishedMovieGrid();
    const first = e.state.cloneMap.get('v:1');
    e.c.activeClone = first;
    e.c.activeVideoId = '1';
    e.c.activeSourceSlot = new Element('source');
    e.c.pendingGridHoverClone = first;
    let controls = 0, invalidations = 0;
    const syncCard = e.c.syncManualViewingCard;
    e.c.syncManualViewingCard = (...args) => { controls++; return syncCard(...args); };
    e.c.invalidateGridReact = () => invalidations++;
    const token = e.c.hoverToken;
    const before = e.c.collectPerformanceDiagnostics().viewingGroups.cardsConsidered;
    const requests = e.requests.length;
    clickManualViewing(e, '500');
    assert.equal(controls, 1);
    assert.equal(e.c.collectPerformanceDiagnostics().viewingGroups.cardsConsidered - before, 1);
    assert.equal(e.c.activeClone, first);
    assert.equal(e.c.pendingGridHoverClone, first);
    assert.equal(e.c.hoverToken, token);
    assert.equal(invalidations, 0);
    assert.equal(e.requests.length, requests);
    assert.deepEqual(completedViewingIds(e), ['500']);
    assert.equal(e.state.watchStatus.completedCount, 1);
    const action = e.logs.find(entry => entry.name === 'viewingChoiceApplied');
    assert.equal(action.details.saved, true);
    assert.equal(action.details.work.controlsUpdated, 1);
    assert.equal(action.details.work.hoverPreserved, 1);
});

test('moving a preceding card cancels hover when the protected card actually changes position', async () => {
    const e = await unfinishedMovieGrid(10);
    const protectedCard = e.state.cloneMap.get('v:10');
    protectedCard.getBoundingClientRect = () => ({ left: 0, top: mainViewingIds(e).indexOf('10') * 60, width: 100, height: 60 });
    e.c.activeClone = protectedCard;
    e.c.activeVideoId = '10';
    e.c.pendingGridHoverClone = protectedCard;
    const token = e.c.hoverToken;
    clickManualViewing(e, '1');
    assert.equal(e.c.activeClone, null);
    assert.equal(e.c.pendingGridHoverClone, null);
    assert.equal(e.c.hoverToken, token + 1);
    assert.equal(e.c.performanceDiagnostics.viewingGroups.hoverCancelled, 1);
});

test('unchanged publication avoids card and layout reads, and filters reuse stored classifications', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clone = e.state.cloneMap.get('v:2');
    e.c.activeClone = clone;
    clone.getBoundingClientRect = () => { throw new Error('Unchanged synchronization must not measure layout'); };
    const before = e.c.collectPerformanceDiagnostics().viewingGroups;
    e.c.syncWatchGroups(e.state, [], 'unchanged-batch');
    assert.equal(e.c.performanceDiagnostics.viewingGroups.cardsConsidered, before.cardsConsidered);
    assert.equal(e.c.activeClone, clone);
    e.c.activeClone = null;
    const controls = e.c.performanceDiagnostics.viewingGroups.controlsUpdated;
    e.c.effectiveViewingStatus = () => { throw new Error('A filter must reuse established status'); };
    e.c.viewingTitleType = () => { throw new Error('A filter must reuse established type'); };
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.equal(e.c.performanceDiagnostics.viewingGroups.controlsUpdated, controls);
});

test('incremental groups follow hover replacement ownership without retaining or revisiting the old card', async () => {
    const e = await unfinishedMovieGrid(10);
    for (const name of ['findGridClone', 'setGridClone']) vm.runInContext(declaration(name), e.c);
    e.c.graftedGridClones = new Set();
    const item = e.state.items[9];
    const old = e.state.cloneMap.get('v:10');
    const fresh = old.cloneNode(true);
    fresh.__tmMyListItem = item;
    old.replaceWith(fresh);
    e.c.setGridClone(item, fresh);
    assert.equal(e.state.watchStatus.groupIndex.entries.get('10').clone, fresh);
    clickManualViewing(e, '10');
    assert.equal(fresh.parentElement, e.state.watchStatus.ui.watchedGrid);
    assert.equal(old.isConnected, false);
    assert.equal(e.state.watchStatus.groupIndex.entries.get('10').clone, fresh);
});

function configureInitializationRecovery(e) {
    const scheduled = [];
    e.c.document.querySelector = () => null;
    e.c.bindTargetDocumentObserver = () => {};
    e.c.scheduleRun = (...args) => scheduled.push(args);
    e.c.responsiveRefreshTimer = null;
    e.c.LEGACY_EMPTY_STATE_ID = 'empty';
    e.c.ORDER_MISMATCH_DIALOG_ID = 'dialog';
    e.c.tryMountedSinglePageFastBootstrap = async () => null;
    for (const name of ['cancelPendingGridHover', 'initializationTimeoutError', 'fetchFreshMyListBootstrap']) {
        vm.runInContext(declaration(name), e.c);
    }
    return scheduled;
}

test('readiness detachment retries one verified replacement and preserves queued mutations until publication', async () => {
    const e = initializationEnvironment(6);
    const scheduled = configureInitializationRecovery(e);
    const replacement = new ConstructionNode('replacement');
    let readinessCalls = 0;
    e.c.waitForNativeCarouselReady = async () => {
        if (++readinessCalls > 1) return { ready: true, empty: false };
        e.track.setConnected(false);
        e.scroller.appendChild(replacement);
        e.c.netflixDom.findTrack = () => replacement;
        return { ready: false, reason: 'detached' };
    };
    const mutation = { videoId: '2', action: 'remove' };
    e.c.pendingMyListMutations.set('2', mutation);
    await e.c.runScript(1);
    assert.deepEqual(scheduled, [[40, 1]]);
    assert.equal(e.c.initializationBlockedSessionToken, null);
    assert.equal(e.c.sourceState, null);
    assert.equal(e.c.pendingMyListMutations.size, 1);
    const retry = e.c.runScript(1);
    await e.drain();
    await retry;
    assert.equal(readinessCalls, 2, e.warnings.map(entry => entry.details.error?.message).join(', '));
    assert.equal(e.c.sourceState.track, replacement);
    assert.equal(e.c.completedSection, e.section);
    assert.equal(e.c.sourceState.items.length, 5);
    assert.equal(e.c.pendingMyListMutations.size, 0);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.attempts, 1);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.completed, 1);
    const recovery = e.logs.find(entry => entry.name === 'nativeInitializationRecovered');
    assert.equal(recovery.details.pendingMutations, 1);
    assert.equal(e.warnings.length, 0);
});

test('a replacement mounted after a readiness timeout can unblock through the native observer', async () => {
    const e = initializationEnvironment(6);
    const scheduled = configureInitializationRecovery(e);
    e.c.waitForNativeCarouselReady = async () => ({ ready: false, reason: 'timeout', elapsedMs: 8000 });
    await e.c.runScript(1);
    assert.equal(e.c.initializationBlockedSessionToken, 1);
    assert.equal(scheduled.length, 0);
    assert.equal(e.c.recoverNativeInitialization(1, 'same-source'), false);
    const queued = { videoId: '2', action: 'remove' };
    e.c.pendingMyListMutations.set('2', queued);
    assert.equal(e.c.tryApplyMyListMutation(queued), false);
    assert.equal(queued.deferredWhileBusy, true);
    assert.equal(e.c.pendingMyListMutations.size, 1);
    const replacement = e.scroller.appendChild(new ConstructionNode('replacement'));
    e.c.netflixDom.findTrack = () => replacement;
    e.c.targetDocumentObserver = {};
    e.c.lastObservedUrl = e.c.location.href;
    for (const name of ['isScriptOwnedMyListNode', 'mutationOnlyChangesScriptUi', 'handleTargetDocumentMutation']) {
        vm.runInContext(declaration(name), e.c);
    }
    e.c.handleTargetDocumentMutation([mutation(e.scroller, [replacement])]);
    assert.deepEqual(scheduled, [[40, 1]]);
    assert.equal(e.c.initializationBlockedSessionToken, null);
});

test('native initialization replacement recovery stops after one attempt and ignores obsolete sessions', async () => {
    const e = initializationEnvironment(6);
    const scheduled = configureInitializationRecovery(e);
    e.c.waitForNativeCarouselReady = async () => ({ ready: false, reason: 'timeout', elapsedMs: 8000 });
    await e.c.runScript(1);
    const replacement = e.scroller.appendChild(new ConstructionNode('replacement'));
    e.c.netflixDom.findTrack = () => replacement;
    e.c.isRouteSessionActive = () => false;
    assert.equal(e.c.recoverNativeInitialization(1, 'obsolete'), false);
    assert.equal(scheduled.length, 0);
    e.c.isRouteSessionActive = token => token === 1;
    assert.equal(e.c.recoverNativeInitialization(1, 'replacement'), true);
    await e.c.runScript(1);
    assert.equal(e.c.initializationBlockedSessionToken, 1);
    const third = e.scroller.appendChild(new ConstructionNode('third'));
    e.c.netflixDom.findTrack = () => third;
    for (let i = 0; i < 20; i++) assert.equal(e.c.recoverNativeInitialization(1, 'replacement-again'), false);
    assert.equal(scheduled.length, 1);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.attempts, 1);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.exhausted, 1);
});

test('detached reset restores original geometry descriptors before dropping source and clone references', () => {
    const e = constructionEnvironment();
    const slot = e.track.appendChild(new ConstructionNode('source'));
    const originalRects = () => ['native'];
    Object.defineProperty(slot, 'getClientRects', { value: originalRects, configurable: true, writable: false });
    const descriptors = { getBoundingClientRect: null, getClientRects: Object.getOwnPropertyDescriptor(slot, 'getClientRects') };
    Object.defineProperty(slot, 'getBoundingClientRect', { value: () => e.oldGrid.getBoundingClientRect(), configurable: true });
    Object.defineProperty(slot, 'getClientRects', { value: () => [e.oldGrid.getBoundingClientRect()], configurable: true });
    slot.setAttribute('data-tm-source-proxied', 'true');
    Object.assign(e.c, {
        completedSection: e.section, activeSourceSlot: slot,
        LEGACY_EMPTY_STATE_ID: 'empty',
        activeGeometryProxy: { sourceSlot: slot, clone: e.oldGrid, entries: [{ source: slot, descriptors }] },
        responsiveRefreshTimer: null, restoreActiveCarouselStyles() {}, clearPendingMyListMutations() {}
    });
    for (const name of ['restoreGeometryProxy', 'clearSourceAlignment', 'cancelPendingGridHover', 'resetDetachedTargetState']) {
        vm.runInContext(declaration(name), e.c);
    }
    e.section.setConnected(false);
    e.c.resetDetachedTargetState();
    assert.equal(Object.hasOwn(slot, 'getBoundingClientRect'), false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(slot, 'getClientRects'), descriptors.getClientRects);
    assert.equal(slot.getAttribute('data-tm-source-proxied'), null);
    assert.equal(e.c.activeGeometryProxy, null);
    assert.equal(e.c.activeSourceSlot, null);
    assert.equal(e.c.sourceState, null);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.alignmentRestores, 1);
});

test('six mounted cards rebuild only the hover target, and another card prepares on its own later hover', async () => {
    const e = preparedHoverEnvironment();
    const items = Array.from({ length: 6 }, (_, i) => i ? { videoId: String(123 + i), page: 0 } : e.clone.__tmMyListItem);
    const slots = items.map((item, i) => {
        if (!i) return e.sourceSlot;
        const slot = new Element('source-' + i, e.c.sourceState.track);
        const card = new Element('card-' + i, slot);
        card.href = '/watch/' + item.videoId;
        card.dispatchEvent = () => true;
        slot.querySelector = () => card;
        slot.cloneNode = () => new Element('fresh-' + i);
        return slot;
    });
    const clones = new Map(items.map((item, i) => [item.videoId, i ? new Element('clone-' + i, e.grid) : e.clone]));
    const originals = new Map(clones);
    for (const item of items) clones.get(item.videoId).__tmMyListItem = item;
    e.c.sourceState.items = items;
    e.c.currentPageSlots = () => slots;
    e.c.resolveExpectedPageSourceItem = async item => ({ status: 'found', slot: slots[items.indexOf(item)], slots, page: 0 });
    e.c.findItemForSourceSlot = slot => items[slots.indexOf(slot)];
    e.c.findActiveSourceSlot = item => slots[items.indexOf(item)];
    e.c.findGridClone = item => clones.get(item.videoId);
    e.c.setGridClone = (item, clone) => clones.set(item.videoId, clone);
    for (const index of [0, 4]) {
        const item = items[index];
        const task = e.c.prepareMountedPage(0, item, pointer(clones.get(item.videoId)), e.c.hoverToken, 1);
        await e.flush();
        await e.frame();
        assert.ok(await task);
        assert.notEqual(clones.get(item.videoId), originals.get(item.videoId));
    }
    for (const index of [1, 2, 3, 5]) assert.equal(clones.get(items[index].videoId), originals.get(items[index].videoId));
    assert.equal(e.calls.grafts, 2);
    assert.equal(e.c.performanceDiagnostics.hoverPreparation.clonesRebuilt, 2);
    assert.equal(e.c.performanceDiagnostics.hoverPreparation.neighborsSkipped, 10);
    assert.ok(e.logs.filter(entry => entry.name === 'nativePageClonesUpdated')
        .every(entry => entry.details.refreshedCount === 1 && entry.details.preparationScope === 'target-card'));
});

function resizeEnvironment() {
    const viewport = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
        visualViewport: { width: 1280, height: 800, scale: 1, offsetLeft: 0, offsetTop: 0 } };
    const calls = { measures: 0, styles: 0, refreshes: 0 };
    let pages = 4;
    const runtime = { pageMappingStale: false };
    const layout = { columns: 6, cardWidth: 100, gridWidth: 640, gridLeft: 20, sidePadding: 20,
        scrollerWidth: 680, scrollerHeight: 60, gap: 8, rowGap: 10 };
    const measured = { ...layout };
    const e = hoverEnvironment(['handleTargetWindowResize', 'handleTargetVisualViewportResize', 'scheduleResponsiveRefresh',
        'responsiveSignature', 'responsivePageShape', 'realignActiveSource'], {
        window: viewport, responsiveRefreshTimer: null, responsiveRefreshing: false,
        getCarouselDomRuntime: () => runtime, pageCount: () => pages, layoutSummary: value => value,
        measureVisibleLayout: () => { calls.measures++; return { ...measured }; },
        measureNativeCarouselGap: () => 10, updateResponsiveStatus: () => calls.styles++,
        currentGridGeometry: () => ({ width: 640, left: 20, columns: 6 }),
        refreshResponsiveLayout: () => { calls.refreshes++; e.c.cancelResizeHover(); }
    });
    Object.assign(e.c.sourceState, { layout, scroller: new Element('scroller'), track: new Element('track'),
        resizeViewportSignature: e.c.responsiveViewportSignature() });
    e.c.lastResponsiveSignature = e.c.responsiveSignature(layout);
    e.grid.__tmAppliedGeometry = { width: 640, left: 20, columns: 6 };
    e.c.lastPageShape = e.c.responsivePageShape(layout);
    e.c.activeClone = e.clone;
    return { ...e, viewport, calls, measured, runtime, setPages: value => { pages = value; } };
}

test('duplicate window and visual-viewport events coalesce to one check and preserve hover without style writes', async () => {
    const e = resizeEnvironment();
    const token = e.c.hoverToken;
    for (let i = 0; i < 20; i++) {
        e.c.handleTargetWindowResize();
        e.c.handleTargetVisualViewportResize();
    }
    assert.equal(e.c.activeClone, e.clone);
    assert.equal(e.c.hoverToken, token);
    assert.equal(e.timers.size, 1);
    await e.advance(140);
    assert.deepEqual(e.calls, { measures: 1, styles: 0, refreshes: 0 });
    assert.equal(e.c.activeClone, e.clone);
    assert.equal(e.c.performanceDiagnostics.resize.events, 40);
    assert.equal(e.c.performanceDiagnostics.resize.checks, 1);
    assert.equal(e.c.performanceDiagnostics.resize.unchanged, 1);
    assert.equal(e.c.performanceDiagnostics.resize.hoverPreserved, 1);
});

test('real viewport bounds, zoom, pixel ratio and offset changes still cancel hover immediately', async () => {
    for (const mutate of [v => v.innerWidth++, v => v.innerHeight++, v => v.devicePixelRatio++,
        v => v.visualViewport.scale++, v => v.visualViewport.offsetTop++, v => v.visualViewport.width++]) {
        const e = resizeEnvironment();
        e.c.handleGridClonePointerOver(pointer(e.clone), e.clone, e.clone.__tmMyListItem);
        mutate(e.viewport);
        e.c.handleTargetVisualViewportResize();
        assert.equal(e.c.activeClone, null);
        assert.equal(e.c.pendingGridHoverClone, null);
        assert.equal(e.c.performanceDiagnostics.resize.hoverCancelled, 1);
        await e.advance(140);
        assert.equal(e.activations.length, 0);
        assert.equal(e.calls.refreshes, 0, 'unchanged card geometry needs no relayout');
    }
});

test('same-viewport geometry changes or stale page mapping still trigger responsive refresh', async () => {
    for (const change of [e => e.measured.columns++, e => e.measured.gap += 4,
        e => e.measured.scrollerHeight += 20, e => { e.runtime.pageMappingStale = true; }]) {
        const e = resizeEnvironment();
        change(e);
        e.c.handleTargetWindowResize();
        assert.equal(e.c.activeClone, e.clone, 'the coalesced geometry check owns this decision');
        await e.advance(140);
        assert.equal(e.calls.refreshes, 1);
        assert.equal(e.c.activeClone, null);
    }
});

test('page-count convergence and obsolete scheduled checks avoid relayout and preserve current owners', async () => {
    const e = resizeEnvironment();
    e.setPages(5);
    e.c.scheduleResponsiveRefresh(140, 'ResizeObserver');
    await e.advance(140);
    assert.equal(e.calls.refreshes, 0);
    assert.equal(e.calls.styles, 0);
    assert.equal(e.c.activeClone, e.clone);
    assert.match(e.c.lastResponsiveSignature, /^6\|5\|/);
    e.c.handleTargetWindowResize();
    e.c.sourceState = { ...e.c.sourceState };
    await e.advance(140);
    assert.equal(e.calls.measures, 1);
    e.c.handleTargetWindowResize();
    e.c.isRouteSessionActive = () => false;
    await e.advance(140);
    assert.equal(e.calls.measures, 1);
});

test('copied performance counters are independent snapshots without title, profile or DOM data', () => {
    const e = environment([]);
    const copy = e.c.collectPerformanceDiagnostics();
    copy.viewingGroups.controlsUpdated = 100;
    assert.equal(e.c.performanceDiagnostics.viewingGroups.controlsUpdated, 0);
    assert.ok(Object.values(copy).every(group => Object.values(group).every(value => value === null ||
        ['number', 'string', 'boolean'].includes(typeof value))));
    assert.doesNotMatch(JSON.stringify(copy), /videoId|profileGuid|authURL|sourceSlot|cloneMap/);
});

test('target-only hover preparation still rejects a target in the wrapped tail buffer', async () => {
    const e = preparedHoverEnvironment();
    const otherItems = Array.from({ length: 5 }, (_, i) => ({ videoId: String(200 + i), page: 6 }));
    const slots = otherItems.map((_, i) => new Element('tail-' + i, e.c.sourceState.track));
    slots.push(e.sourceSlot);
    e.c.getCarouselDomRuntime = () => ({ profile: { pageMode: 'logical' } });
    e.c.logicalSlotPositions = () => [32, 33, 34, 35, 36, 0];
    e.c.wrappedTailLogicalPageInfo = () => ({ page: 6, wrapIndex: 5 });
    e.c.resolveExpectedPageSourceItem = async () => ({ status: 'found', slot: e.sourceSlot, slots, page: 6 });
    e.c.findItemForSourceSlot = slot => slot === e.sourceSlot ? e.clone.__tmMyListItem : otherItems[slots.indexOf(slot)];
    assert.equal(await e.c.prepareMountedPage(6, e.clone.__tmMyListItem, pointer(e.clone), 1, 1), null);
    assert.equal(e.calls.grafts, 0);
    assert.equal(e.c.performanceDiagnostics.hoverPreparation.clonesRebuilt, 0);
    assert.equal(e.warnings.at(-1).details.reason, 'target-not-in-current-page-slots');
});

test('grid clipping changes require refresh even when carousel geometry signatures are identical', async () => {
    const e = resizeEnvironment();
    e.c.currentGridGeometry = () => ({ width: 620, left: 20, columns: 6 });
    e.c.handleTargetWindowResize();
    await e.advance(140);
    assert.equal(e.calls.refreshes, 1);
    assert.equal(e.c.activeClone, null);
});

test('one responsive sample shares the section rectangle between native layout and grid geometry', () => {
    const section = new Element('section'), scroller = new Element('scroller'), track = new Element('track');
    let sectionReads = 0, scrollerReads = 0;
    section.getBoundingClientRect = () => { sectionReads++; return { left: 0, right: 1280, width: 1280 }; };
    scroller.getBoundingClientRect = () => { scrollerReads++; return { left: 0, width: 680, height: 60 }; };
    const e = environment(['measureVisibleLayout', 'currentGridGeometry'], {
        window: { innerWidth: 1280 },
        parseSlotLayoutFormula: () => ({ columns: 6, gap: 8, paddingLeft: 20, paddingRight: 20, formulaSidePadding: 20 })
    });
    e.c.withNativeReadScope(() => {
        const layout = e.c.measureVisibleLayout(section, scroller, track);
        assert.equal(e.c.currentGridGeometry(section, layout).width, 640);
    });
    assert.equal(sectionReads, 1);
    assert.equal(scrollerReads, 1);
});

test('unrestorable native geometry overrides produce a bounded failure diagnostic', () => {
    const slot = new Element('source');
    const warnings = [];
    Object.defineProperty(slot, 'getClientRects', { value: () => [], configurable: false });
    const e = environment(['restoreGeometryProxy'], {
        activeGeometryProxy: { sourceSlot: slot, entries: [{ source: slot,
            descriptors: { getBoundingClientRect: null, getClientRects: null } }] },
        warn: (name, details) => warnings.push({ name, details })
    });
    e.c.restoreGeometryProxy();
    e.c.restoreGeometryProxy();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].name, 'sourceAlignmentRestoreFailed');
    assert.equal(warnings[0].details.methods, 1);
    assert.equal(e.c.performanceDiagnostics.nativeRecovery.alignmentRestoreFailures, 1);
});

test('obsolete responsive refreshes cannot update replacement grids or clear a newer refresh owner', async () => {
    for (const replacement of ['state', 'track', 'route']) {
        const e = resizeEnvironment();
        const gate = fetchDeferred();
        const warnings = [];
        Object.assign(e.c, {
            responsiveSequence: 0, lastResponsiveReason: 'window.resize', activeResponsiveReason: '',
            selectedPage: () => 0, waitResponsiveLayoutSettled: () => gate.promise,
            retryPendingMyListMutations: () => { throw new Error('An obsolete owner cannot resume mutations'); },
            warn: (...args) => warnings.push(args)
        });
        for (const name of ['createRouteSessionCancelledError', 'isRouteSessionCancelledError', 'assertRouteSession', 'refreshResponsiveLayout']) {
            vm.runInContext(declaration(name), e.c);
        }
        const refresh = e.c.refreshResponsiveLayout(1);
        if (replacement === 'state') e.c.sourceState = { ...e.c.sourceState };
        if (replacement === 'track') e.c.sourceState.track = new Element('replacement-track');
        if (replacement === 'route') e.c.isRouteSessionActive = () => false;
        e.c.responsiveSequence = 2;
        e.c.responsiveRefreshing = true;
        e.c.activeResponsiveReason = 'new-owner';
        gate.resolve({ ...e.measured });
        await refresh;
        assert.equal(e.calls.styles, 0, replacement);
        assert.equal(e.c.responsiveRefreshing, true, replacement);
        assert.equal(e.c.activeResponsiveReason, 'new-owner', replacement);
        assert.equal(warnings.length, 0, replacement);
    }
});

test('responsive settling stops before another native read when its source owner is replaced', async () => {
    const e = resizeEnvironment();
    e.c.measureVisibleLayout = () => { throw new Error('An obsolete carousel must not be measured'); };
    for (const name of ['sleep', 'createRouteSessionCancelledError', 'isRouteSessionCancelledError', 'assertRouteSession', 'waitResponsiveLayoutSettled']) {
        vm.runInContext(declaration(name), e.c);
    }
    const settling = e.c.waitResponsiveLayoutSettled(1200, 1);
    const rejected = assert.rejects(settling, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    e.c.sourceState = { ...e.c.sourceState };
    await e.advance(80);
    await rejected;
    assert.equal(e.timers.size, 0);
});
