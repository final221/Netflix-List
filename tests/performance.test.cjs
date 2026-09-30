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
