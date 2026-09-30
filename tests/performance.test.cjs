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
        orderMismatchDialogOpen: false, orderMismatchReinitializing: false, responsiveRefreshPromise: null,
        routeSessionToken: 1, targetSessionActive: true,
        isTargetPage: () => true, isRouteSessionActive: token => token === 1,
        assertRouteSession: () => {}, isRouteSessionCancelledError: () => false,
        ensureLiveNativeBinding: () => {},
        log: () => {}, warn: () => {}, tLog: value => value, itemSummary: item => item,
        ...overrides
    });
    for (const name of ['createNativeReadScope', 'withNativeReadScope', 'invalidateNativeReadScope', 'trace', ...names]) {
        vm.runInContext(declaration(name), c);
    }
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
    await e.advance(180);
    await e.frame();
    await activation;
    assert.equal(e.calls.preparations, 2);
    assert.equal(e.calls.grafts, 2);
    assert.equal(e.events.length, 4);
    assert.equal(e.c.activeClone, e.current());
    assert.equal(e.current().getAttribute('data-tm-preparing'), null);
    assert.equal(e.logs.find(entry => entry.name === 'hoverNativePagePreparationResult').details.success, true);
    assert.equal(e.warnings.length, 0);
});

test('permanent alignment failure is reported as failure and cannot create an automatic retry loop', async () => {
    const e = preparedHoverEnvironment({ align: () => false });
    const activation = e.start();
    await e.flush();
    await e.advance(180);
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
    assert.equal(e.sourceSlot.getBoundingClientRect().left, 0);
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
        'buildGrid', 'normalizeClone', 'copyItemAttributes', 'associateGridHoverItem', 'ensureGridHoverBehavior',
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
        while (e.timers.size) {
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
    assert.equal(e.created.length, 1, e.warnings.map(entry => entry.details.error?.message).join(', '));
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
