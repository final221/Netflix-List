import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarousel } from '../src/netflix/carousel/carousel.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { Element, createDocument } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';

function environment(overrides = {}) {
    const document = createDocument();
    const scheduler = createScheduler();
    const scope = createSessionScope({ isTargetPage: () => true, AbortController,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout });
    scope.begin();
    const host = document.body.appendChild(new Element('div'));
    host.classList.add('browse');
    const section = host.appendChild(new Element('section'));
    const scroller = section.appendChild(new Element('div'));
    const track = scroller.appendChild(new Element('div'));
    const control = scroller.appendChild(new Element('button'));
    control.setAttribute('data-uia', 'carousel-hawkins-right-button');
    const observers = [];
    class MutationObserver {
        constructor(callback) { this.callback = callback; this.observations = []; this.disconnects = 0; observers.push(this); }
        observe(...args) { this.observations.push(args); }
        disconnect() { this.disconnects++; }
    }
    const pageDom = { selectors: { browseSections: '.browse', carouselScroller: '.scroller', standardCard: 'a', virtualSlot: '.slot' },
        findMyListSection: () => section, findTrack: () => track, directSlots: () => [], filledSlots: () => [],
        nativeCardIdentity: () => 'same-title',
        videoIdFromHref: createNetflixPageDom({ document, Element, location: { origin: 'https://www.netflix.com' } }).videoIdFromHref };
    const carousel = createCarousel({ scope, pageDom, document, Element,
        window: { innerWidth: 1280 }, getComputedStyle: () => ({}), performance: scheduler.performance,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout,
        requestAnimationFrame: scheduler.requestAnimationFrame, cancelAnimationFrame: scheduler.cancelAnimationFrame,
        readListShape: () => ({ totalCount: 19, columns: 4 }), readGraphqlCount: () => 19,
        createError: (code, stage, message, details) => Object.assign(new Error(message), { code, stage, details }),
        log() {}, warn() {}, tLog: value => value, logTimeout() {}, describeSlot: () => ({}),
        MutationObserver, ...overrides });
    return { document, scheduler, scope, carousel, host, section, scroller, track, control, pageDom, observers };
}

test('binding replacement invalidates old handles even for connected sources with matching title identity', () => {
    const e = environment();
    const old = e.carousel.bind(e.section, e.scroller, e.track);
    assert.equal(e.carousel.isBindingCurrent(old), true);
    const replacement = e.scroller.appendChild(new Element('div'));
    const current = e.carousel.bind(e.section, e.scroller, replacement);
    assert.equal(e.track.isConnected, true);
    assert.equal(e.carousel.isBindingCurrent(old), false);
    assert.equal(e.carousel.isBindingCurrent(current), true);
    assert.equal(e.carousel.isBindingCurrent(e.carousel.borrowBinding(e.section, e.scroller, e.track)), false);
    assert.equal(e.carousel.isBindingCurrent({ ...current }), false);
    assert.throws(() => e.carousel.assertBinding(old), { code: 'NATIVE_SOURCE_REPLACED' });
    e.scope.begin();
    assert.equal(e.carousel.isBindingCurrent(current), false);
    assert.equal(Object.isFrozen(current), true);
});

test('page mapping has one private writer and publishes read-only signature and profile observations', () => {
    const e = environment();
    e.carousel.bind(e.section, e.scroller, e.track);
    e.carousel.registerPage(e.section, 'first', 0);
    e.carousel.registerPage(e.section, 'last', 4);
    e.carousel.completeCollection(e.section, 5);
    const view = e.carousel.model(e.section);
    assert.equal(view.currentPage, 4);
    assert.equal(view.knownPageCount, 5);
    assert.equal(view.signatureToPage.get('last'), 4);
    assert.equal(view.pageToSignature.get(0), 'first');
    assert.throws(() => { view.currentPage = 99; }, TypeError);
    assert.equal(view.signatureToPage.set, undefined);
    assert.equal(view.signatureToPage.clear, undefined);
    assert.throws(() => { view.profile.pageMode = 'indicator'; }, TypeError);
    e.carousel.forcePage(e.section, 'last', 3);
    assert.equal(view.pageToSignature.has(4), false);
    assert.equal(view.signatureToPage.get('last'), 3);
    e.carousel.anchorAfterDelta(e.section, { pageCount: 4, currentPage: 2, signature: 'new' });
    assert.equal(view.signatureToPage.has('first'), false);
    assert.equal(view.currentPage, 2);
    assert.equal(view.pageMappingStale, true);
    e.carousel.commitMapping(e.section, { pageCount: 4, currentPage: 1, signature: 'confirmed' });
    assert.equal(e.carousel.model(e.section).pageMappingStale, false);
    assert.equal(view.currentPage, 2, 'an old model view cannot become the replacement model');
});

test('synchronous read scopes discard caches before async continuation and invalidate on replacement', async () => {
    const e = environment();
    let left = 0, reads = 0;
    e.track.getBoundingClientRect = () => { reads++; return { left }; };
    e.carousel.bind(e.section, e.scroller, e.track);
    e.carousel.sample(() => {
        assert.equal(e.carousel.rect(e.track).left, 0);
        left = 20;
        assert.equal(e.carousel.rect(e.track).left, 0);
        e.carousel.invalidateReads();
        assert.equal(e.carousel.rect(e.track).left, 20);
    });
    assert.equal(reads, 2);
    assert.throws(() => e.carousel.sample(() => { throw new Error('read'); }), /read/);
    assert.equal(e.carousel.diagnostics().readScopeActive, false);
    await e.carousel.sample(async () => {
        await Promise.resolve();
        assert.equal(e.carousel.diagnostics().readScopeActive, false);
        left = 30;
        assert.equal(e.carousel.rect(e.track).left, 30);
    });
});

test('an obsolete readiness poll cannot publish success from still-connected old binding elements', async () => {
    const e = environment();
    e.carousel.bind(e.section, e.scroller, e.track);
    const pending = e.carousel.ready(e.section, e.scroller, e.track, 1);
    const replacement = e.scroller.appendChild(new Element('div'));
    e.carousel.bind(e.section, e.scroller, replacement);
    await e.scheduler.advance(1200);
    const result = await pending;
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'detached');
    assert.equal(e.track.isConnected, true);
});

test('source discovery rejects an obsolete poll before accepting a late source on the old section', async () => {
    const e = environment();
    e.carousel.bind(e.section);
    const pending = e.carousel.waitForSource(e.section, 3000, e.scope.token);
    const replacement = e.host.appendChild(new Element('section'));
    e.carousel.bind(replacement);
    e.scroller.classList.add('scroller');
    await e.scheduler.advance(25);
    const result = await pending;
    assert.equal(result.found, false);
    assert.equal(result.empty, false);
    assert.equal(result.reason, 'detached');
    assert.equal(e.section.isConnected, true);
});

test('a missing positive-count source times out while a connected empty carousel must stabilize', async () => {
    const missing = environment();
    missing.carousel.bind(missing.section);
    const absent = missing.carousel.waitForSource(missing.section, 3000, missing.scope.token);
    await missing.scheduler.advance(3000);
    const result = await absent;
    assert.equal(result.found, false);
    assert.equal(result.empty, false);
    assert.equal(result.reason, 'timeout');
    assert.equal(result.stage, 'native-source');

    const empty = environment({ readListShape: () => ({ totalCount: 0, columns: 4 }), readGraphqlCount: () => 0 });
    empty.carousel.bind(empty.section, empty.scroller, empty.track);
    let completed = false;
    const waiting = empty.carousel.ready(empty.section, empty.scroller, empty.track, empty.scope.token);
    waiting.then(() => { completed = true; });
    await empty.scheduler.advance(1199);
    assert.equal(completed, false);
    await empty.scheduler.advance(25);
    const stable = await waiting;
    assert.equal(stable.ready, true);
    assert.equal(stable.empty, true);
    assert.equal(stable.reason, 'stable-empty-page');
});

test('discovery disposal rejects queued old observer deliveries without clearing the new owner frame', async () => {
    const deliveries = [], relevant = [];
    const e = environment({ shouldCoalesce: () => true, onMutationDelivery: () => deliveries.push('delivery'),
        onRelevantMutation: token => relevant.push(token) });
    e.carousel.startDiscovery();
    const old = e.observers[0];
    const mutations = [{ target: e.section, addedNodes: [new Element('div')], removedNodes: [] }];
    old.callback(mutations);
    assert.equal(e.carousel.diagnostics().pendingMutationFrame, true);
    e.carousel.stopDiscovery();
    assert.equal(e.carousel.diagnostics().pendingMutationFrame, false);
    e.carousel.startDiscovery();
    e.observers[1].callback(mutations);
    old.callback(mutations);
    assert.equal(deliveries.length, 2);
    assert.equal(e.carousel.diagnostics().pendingMutationFrame, true);
    await e.scheduler.frame();
    assert.deepEqual(relevant, [e.scope.token]);
    assert.equal(old.disconnects, 2);
    e.carousel.stopDiscovery();
    e.carousel.stopDiscovery();
    assert.equal(e.carousel.diagnostics().discoveryActive, false);
});

function nativeReadEnvironment(mode = 'logical') {
    const shape = { totalCount: 600, columns: 6 };
    const counts = { profile: 0, indicators: 0, filled: 0, rects: 0, indices: 0 };
    const e = environment({ readListShape: () => shape, readGraphqlCount: () => shape.totalCount });
    let track = e.track, slots = [], indicators = [];
    e.scroller.classList.add('scroller');
    e.scroller.getBoundingClientRect = () => { counts.rects++; return { left: 0, right: 600, width: 600, height: 60 }; };
    const query = e.section.querySelector.bind(e.section), queryAll = e.section.querySelectorAll.bind(e.section);
    e.section.querySelector = selector => { if (selector !== '.scroller') counts.profile++; return query(selector); };
    e.section.querySelectorAll = selector => {
        if (selector === '[data-uia="carousel-page-indicator-item"]') counts.indicators++;
        return queryAll(selector);
    };
    e.pageDom.findTrack = () => track;
    e.pageDom.directSlots = () => slots;
    e.pageDom.filledSlots = () => { counts.filled++; return slots; };
    e.pageDom.nativeCardIdentity = slot => String(slot.index);
    function setMode(mode, selected = 0) {
        e.control.setAttribute('data-uia', mode === 'indicator' ? 'carousel-right-button' : 'carousel-hawkins-right-button');
        for (const node of indicators) node.remove();
        indicators = mode === 'indicator' ? [0, 1, 2].map(index => {
            const node = e.section.appendChild(new Element('span'));
            node.setAttribute('data-uia', 'carousel-page-indicator-item');
            node.setAttribute('data-indicator-selected', String(index === selected));
            return node;
        }) : [];
    }
    setMode(mode);
    e.carousel.bind(e.section, e.scroller, track);
    return { ...e, shape, counts, get track() { return track; }, slots: () => slots, setMode,
        resetCounts() { for (const key of Object.keys(counts)) counts[key] = 0; },
        mount(indices) {
            for (const slot of slots) slot.remove();
            slots = indices.map((index, position) => {
                const slot = track.appendChild(new Element('div'));
                slot.classList.add('slot');
                slot.index = index; slot.left = position * 100;
                slot.getBoundingClientRect = () => { counts.rects++; return { left: slot.left, width: 100, right: slot.left + 100 }; };
                const card = slot.appendChild(new Element('a'));
                card.setAttribute('href', '/watch/' + index); card.setAttribute('tabindex', '0');
                card.__reactFiber$test = { memoizedProps: { get itemIndex() { counts.indices++; return slot.index; } } };
                return slot;
            });
            return slots;
        },
        replaceTrack() {
            track.remove();
            track = e.scroller.appendChild(new Element('div'));
            e.carousel.bind(e.section, e.scroller, track);
            return track;
        }
    };
}

test('one native-state sample shares profile, filled-slot, rectangle, and React-index reads', () => {
    const e = nativeReadEnvironment();
    e.mount([12, 13, 14, 15, 16, 17]);
    const state = e.carousel.observe();
    assert.equal(state.selectedPage, 2);
    assert.equal(state.currentPageCount, 6);
    assert.deepEqual(e.counts, { profile: 6, indicators: 1, filled: 1, rects: 7, indices: 6 });
    assert.equal(e.carousel.diagnostics().readScopeActive, false);
    e.resetCounts();
    e.mount([18, 19, 20, 21, 22, 23]);
    assert.equal(e.carousel.observe().selectedPage, 3);
    assert.deepEqual(e.counts, { profile: 6, indicators: 1, filled: 1, rects: 7, indices: 6 });
});

test('indicator selection and carousel generation refresh on the next sample', () => {
    const e = nativeReadEnvironment('indicator');
    assert.equal(e.carousel.selectedPage(e.section), 0);
    assert.equal(e.counts.indicators, 1);
    assert.equal(e.counts.profile, 6);
    e.setMode('indicator', 2);
    assert.equal(e.carousel.selectedPage(e.section), 2);
    e.setMode('logical');
    e.mount([6, 7, 8, 9, 10, 11]);
    assert.equal(e.carousel.selectedPage(e.section), 1);
    assert.equal(e.carousel.model(e.section).profile.generation, 'generation2');
});

test('readiness shares discovery and measures each active slot once even during sorting', () => {
    const e = nativeReadEnvironment();
    const slots = e.mount([5, 4, 3, 2, 1, 0]);
    slots.forEach((slot, index) => { slot.left = (5 - index) * 100; });
    const state = e.carousel.readiness(e.section, e.scroller, e.track);
    assert.equal(state.currentCards, 6);
    assert.equal(e.counts.filled, 1);
    assert.equal(e.counts.rects, 7);
    assert.equal(e.counts.indicators, 1);
    assert.equal(e.counts.profile, 8);
    assert.deepEqual(e.carousel.currentSlots(e.scroller, e.track).map(slot => slot.index), [0, 1, 2, 3, 4, 5]);
});

test('track replacement, membership changes, and resized columns use fresh state', () => {
    const e = nativeReadEnvironment();
    e.mount([12, 13, 14, 15, 16, 17]);
    assert.equal(e.carousel.selectedPage(e.section), 2);
    const replacement = e.replaceTrack();
    e.shape.totalCount = 19; e.shape.columns = 4;
    e.mount([15, 16, 17, 18]);
    const state = e.carousel.observe();
    assert.equal(state.track, replacement);
    assert.equal(state.selectedPage, 4);
    assert.equal(state.currentPageCount, 4);
    assert.equal(state.pageSignature, '15|16|17|18');
    const slots = e.slots();
    slots.slice(1).forEach(slot => slot.querySelector('a').setAttribute('tabindex', '-1'));
    assert.equal(e.carousel.currentSlots(e.scroller, replacement).length, 4);
    slots[0].left = -200;
    slots[0].querySelector('a').setAttribute('tabindex', '-1');
    assert.equal(e.carousel.currentSlots(e.scroller, replacement).length, 3);
});

test('logical page windows preserve exact membership and overlapping tails across list sizes', () => {
    const e = environment();
    let reads = 0;
    const positions = indices => indices.map(index => ({ get logicalIndex() { reads++; return index; } }));
    for (let count = 1; count <= 120; count++) {
        for (let columns = 1; columns <= 12; columns++) {
            for (let page = 0; page < Math.ceil(count / columns); page++) {
                const indices = e.carousel.expectedPageIndices(count, columns, page).reverse();
                reads = 0;
                assert.equal(e.carousel.pageForPositions(positions(indices), count, columns), page);
                assert.ok(reads <= indices.length * 2);
            }
        }
    }
    for (const count of [30, 150, 600]) {
        const tail = e.carousel.expectedPageIndices(count, 6, Math.ceil(count / 6) - 1);
        assert.equal(e.carousel.pageForPositions(positions(tail), count, 6), count / 6 - 1);
    }
    for (const indices of [[], [0, 1, 2], [0, 0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [-1, 0, 1, 2, 3, 4], [12, 13, 14, 15, 16, 17], [null, 1, 2, 3, 4, 5]]) {
        assert.equal(e.carousel.pageForPositions(positions(indices), 12, 6), null);
    }
});

function motionFixture(e) {
    const values = new Map([['transition', { value: 'transform 200ms', priority: 'important' }],
        ['animation', { value: 'pulse 1s', priority: '' }]]);
    const writes = [];
    e.track.style = {
        getPropertyValue: key => values.get(key)?.value || '',
        getPropertyPriority: key => values.get(key)?.priority || '',
        setProperty(key, value, priority = '') { writes.push([key, value, priority]); values.set(key, { value, priority }); },
        removeProperty(key) { writes.push([key, '', '']); values.delete(key); }
    };
    e.carousel.bind(e.section, e.scroller, e.track);
    return { values, writes };
}

test('shared motion suppression restores original priorities only after its last lease releases', () => {
    const e = environment();
    motionFixture(e);
    const scan = e.carousel.suppressMotion(e.section, e.track);
    const move = e.carousel.suppressMotion(e.section, e.track);
    assert.equal(e.track.style.getPropertyValue('transition'), 'none');
    assert.equal(e.track.style.getPropertyPriority('animation'), 'important');
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 2);
    scan.release(); scan.release();
    assert.equal(e.track.style.getPropertyValue('transition'), 'none');
    move.release();
    assert.equal(e.track.style.getPropertyValue('transition'), 'transform 200ms');
    assert.equal(e.track.style.getPropertyPriority('transition'), 'important');
    assert.equal(e.track.style.getPropertyValue('animation'), 'pulse 1s');
    assert.equal(e.track.style.getPropertyPriority('animation'), '');
    assert.equal(move.restored(), true);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
});

test('old queue and motion cleanup cannot affect a replacement using the same connected elements', async () => {
    const e = navigationEnvironment({ onClick() {} });
    const { writes } = motionFixture(e);
    const first = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    await e.scheduler.flush();
    const queued = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    const rejected = [assert.rejects(first, { code: 'NATIVE_SOURCE_REPLACED' }), assert.rejects(queued, { code: 'NATIVE_SOURCE_REPLACED' })];
    e.carousel.resetSource();
    e.carousel.bind(e.section, e.scroller, e.track);
    const newStyles = e.carousel.suppressMotion(e.section, e.track);
    const latest = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    await e.scheduler.flush();
    const writeCount = writes.length;
    await Promise.all(rejected);
    assert.equal(writes.length, writeCount, 'late cleanup cannot restore newer styles');
    assert.equal(e.track.isConnected, true);
    assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 1);
    let idle = false;
    const pendingIdle = e.carousel.whenNavigationIdle().then(() => { idle = true; });
    await e.scheduler.flush();
    assert.equal(idle, false, 'old release cannot unlock the new queue');
    e.setPage(1);
    await e.settle(latest);
    await pendingIdle;
    newStyles.release();
    assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
    assert.equal(e.track.style.getPropertyValue('transition'), 'transform 200ms');
});

test('motion release attempts every restoration and releases ownership when one style write fails', () => {
    const e = environment();
    motionFixture(e);
    const lease = e.carousel.suppressMotion(e.section, e.track);
    const write = e.track.style.setProperty;
    e.track.style.setProperty = (key, value, priority) => {
        if (key === 'transition' && value !== 'none') throw new Error('restore failed');
        write(key, value, priority);
    };
    assert.throws(() => lease.release(), /restore failed/);
    assert.equal(e.track.style.getPropertyValue('animation'), 'pulse 1s');
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
    assert.doesNotThrow(() => lease.release());
});

function navigationEnvironment({ mode = 'logical', count = 3, onClick = null, overrides = {} } = {}) {
    let hoverToken = 1;
    const e = environment({ ...overrides, readListShape: () => null, readHoverToken: () => hoverToken,
        isHoverCancelled: token => token !== null && token !== hoverToken });
    const pages = Array.from({ length: count }, (_, page) => {
        const slot = new Element('div');
        slot.classList.add('slot');
        const card = slot.appendChild(new Element('a'));
        card.href = 'https://www.netflix.com/title/' + (page + 1);
        card.setAttribute('tabindex', '0');
        return [slot];
    });
    let page = 0;
    const directions = [];
    const indicators = mode === 'indicator' ? pages.map(() => {
        const indicator = e.section.appendChild(new Element('li'));
        indicator.setAttribute('data-uia', 'carousel-page-indicator-item');
        return indicator;
    }) : [];
    const setPage = next => {
        page = next;
        e.track.style.setProperty('transform', 'page-' + next);
        indicators.forEach((indicator, index) => indicator.setAttribute('data-indicator-selected', String(index === next)));
    };
    e.pageDom.filledSlots = () => pages[page];
    e.pageDom.directSlots = () => pages[page];
    e.control.setAttribute('data-uia', mode === 'indicator' ? 'carousel-right-button' : 'carousel-hawkins-right-button');
    const left = e.scroller.appendChild(new Element('button'));
    left.setAttribute('data-uia', mode === 'indicator' ? 'carousel-left-button' : 'carousel-hawkins-left-button');
    const click = direction => {
        directions.push(direction);
        if (onClick) onClick({ direction, page, setPage, e });
        else setPage((page + direction + count) % count);
    };
    e.control.click = () => click(1); left.click = () => click(-1);
    setPage(0);
    e.carousel.bind(e.section, e.scroller, e.track);
    pages.forEach((slots, index) => e.carousel.forcePage(e.section, slots[0].querySelector('a').href, index));
    e.carousel.completeCollection(e.section, count);
    e.carousel.notePage(e.section, 0);
    return { ...e, pages, indicators, directions, setPage, page: () => page,
        cancelHover: () => { hoverToken++; },
        async settle(promise, limit = 80) {
            let done = false;
            promise.then(() => { done = true; }, () => { done = true; });
            for (let i = 0; i < limit && !done; i++) {
                await e.scheduler.flush();
                if (!done) { await e.scheduler.frame(); await e.scheduler.advance(0); }
            }
            assert.equal(done, true, 'native operation settles within the controlled frames');
            return promise;
        } };
}

test('carousel movement and strict restoration run through the native navigation owner', async () => {
    const e = navigationEnvironment();
    const moved = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    assert.equal(await e.settle(moved), 1);
    assert.deepEqual(e.directions, [1]);
    assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    const restored = e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { mode: 'strict', sessionToken: e.scope.token });
    assert.equal((await e.settle(restored)).complete, true);
    assert.equal(e.page(), 0);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
});

test('an obsolete indicator acknowledgement cannot read or publish a replacement binding', async () => {
    const e = navigationEnvironment({ mode: 'indicator', onClick() {} });
    const pending = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    await e.scheduler.flush();
    const oldObserver = e.observers[0];
    const rejected = assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
    e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
    e.setPage(1);
    oldObserver.callback([]);
    await e.scheduler.flush();
    await rejected;
    assert.equal(oldObserver.disconnects, 1);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
});


test('hover hydration stops before the next geometry read after cancellation', async () => {
    const e = navigationEnvironment();
    let reads = 0;
    const filled = e.pageDom.filledSlots;
    e.pageDom.filledSlots = () => { reads++; return filled(); };
    const pending = e.carousel.stablePage(e.scroller, e.track, { hoverToken: 1, sessionToken: e.scope.token });
    e.cancelHover();
    await e.scheduler.frame();
    assert.deepEqual(await pending, []);
    assert.equal(reads, 0);
});

test('initialization stability waits remain independent of hover cancellation', async () => {
    const e = navigationEnvironment();
    const pending = e.carousel.stablePage(e.scroller, e.track, { sessionToken: e.scope.token });
    e.cancelHover();
    await e.scheduler.frame(); await e.scheduler.frame();
    const slots = await pending;
    assert.equal(slots.length, 1); assert.equal(slots[0], e.pages[0][0]);
});

test('route cancellation stops pending and queued native work and releases owned waits', async () => {
    const e = navigationEnvironment({ onClick() {} });
    const first = e.carousel.movePage(e.section, e.scroller, 1, 1, e.scope.token);
    await e.scheduler.flush();
    const queued = e.carousel.movePage(e.section, e.scroller, 1, 1, e.scope.token);
    const rejected = [first, queued].map(pending => assert.rejects(pending, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' }));
    e.scope.dispose(); e.carousel.clearBinding();
    await Promise.all(rejected);
    assert.equal(e.directions.length, 1);
    assert.equal(e.scheduler.frames.size, 0); assert.equal(e.scheduler.timers.size, 0);
    assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
});


test('fast restoration preserves the single right-cycle shortcut and verified target content', async () => {
    const e = navigationEnvironment({ count: 4 });
    e.setPage(3); e.carousel.notePage(e.section, 3);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    const pending = e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { canonicalTransform: 'page-0', sessionToken: e.scope.token });
    assert.equal(await e.settle(pending), true);
    assert.deepEqual(e.directions, [1]);
    assert.equal(e.page(), 0);
    assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
});

test('fast restoration repairs a transform and content phase mismatch before its verification timeout', async () => {
    let wrongPhase = true;
    const logs = [];
    const e = navigationEnvironment({ mode: 'indicator', onClick({ direction, page, setPage, e }) {
        if (page === 2 && direction === 1) { setPage(0); e.track.style.setProperty('transform', 'wrong-phase'); }
        else { wrongPhase = false; setPage((page + direction + 3) % 3); }
    }, overrides: { log: (name, detail) => logs.push({ name, detail }) } });
    e.pageDom.filledSlots = () => wrongPhase && e.page() === 0 ? e.pages[2] : e.pages[e.page()];
    e.setPage(2);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    const pending = e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { canonicalTransform: 'page-0', sessionToken: e.scope.token });
    assert.equal(await e.settle(pending), true);
    assert.deepEqual(e.directions, [1, 1, -1]);
    const result = logs.find(entry => entry.name === 'nativeFastRestorationCompleted').detail;
    assert.equal(result.completionPath, 'phase-repair-before-timeout');
    assert.equal(result.initialVerificationWaitSkipped, true);
    assert.equal(result.mountedKeys, 1);
    assert.equal(result.missingKeys.length, 0);
});

test('fast restoration waits for verification before repairing content with the canonical transform', async () => {
    let wrongPhase = true;
    const logs = [];
    const e = navigationEnvironment({ mode: 'indicator', onClick({ direction, page, setPage }) {
        if (page === 2 && direction === 1) setPage(0);
        else { wrongPhase = false; setPage((page + direction + 3) % 3); }
    }, overrides: { log: (name, detail) => logs.push({ name, detail }) } });
    e.pageDom.filledSlots = () => wrongPhase && e.page() === 0 ? e.pages[2] : e.pages[e.page()];
    e.setPage(2);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    const pending = e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { canonicalTransform: 'page-0', sessionToken: e.scope.token });
    assert.equal(await e.settle(pending), true);
    assert.deepEqual(e.directions, [1, 1, -1]);
    const result = logs.find(entry => entry.name === 'nativeFastRestorationCompleted').detail;
    assert.equal(result.completionPath, 'phase-repair-after-verification');
    assert.equal(result.initialVerificationWaitSkipped, false);
    assert.equal(result.complete, true);
    assert(result.elapsedMs >= 260);
});

test('fast restoration falls back to strict verification and truthfully rejects unmounted target content', async () => {
    const logs = [];
    const e = navigationEnvironment({ mode: 'indicator', overrides: { log: (name, detail) => logs.push({ name, detail }),
        warn: (name, detail) => logs.push({ name, detail }) } });
    e.control.setAttribute('aria-disabled', 'true');
    e.pageDom.filledSlots = () => e.pages[2];
    e.setPage(2);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    const pending = e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { sessionToken: e.scope.token });
    assert.equal(await e.settle(pending, 400), false);
    assert(logs.some(entry => entry.name === 'fastRestorationVerificationFailedUsingV49PageByPageFallback'));
    assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
});


test('fast restoration cannot inspect a replacement binding from its move failure handler', async () => {
    const e = navigationEnvironment({ mode: 'indicator' });
    e.control.click = () => {
        e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
        for (const indicator of e.indicators) indicator.getAttribute = () => { throw new Error('replacement read'); };
    };
    e.setPage(2);
    const items = e.pages.map((slots, page) => ({ videoId: String(page + 1), page }));
    await assert.rejects(e.carousel.restorePage(e.section, e.scroller, e.track, items, 1, 0,
        { sessionToken: e.scope.token }), { code: 'NATIVE_SOURCE_REPLACED' });
    assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
});


test('navigation retries one genuine timeout at the existing delay without adding a retry loop', async () => {
    let clicks = 0;
    const logs = [];
    const e = navigationEnvironment({ count: 2, onClick({ setPage }) {
        clicks++; if (clicks === 2) setPage(1);
    }, overrides: { log: (name, detail) => logs.push({ name, detail }) } });
    const pending = e.carousel.navigateTo(e.section, e.scroller, 1, null, e.scope.token);
    assert.equal(await e.settle(pending, 240), 1);
    assert.deepEqual(e.directions, [1, 1]);
    assert.equal(logs.filter(entry => entry.name === 'Retrying logical page move after transient timeout').length, 1);
    assert(e.scheduler.performance.now() >= 3120);
    assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
});


test('failed navigation diagnostic callbacks cannot reject or retry an admitted native move', async () => {
    for (const factoryFailure of [true, false]) {
        const e = navigationEnvironment({ overrides: { navigationDiagnostics() {
            if (factoryFailure) throw new Error('diagnostic factory');
            return { bump() { throw new Error('diagnostic counter'); }, record() { throw new Error('diagnostic timing'); } };
        } } });
        const pending = e.carousel.movePage(e.section, e.scroller, 1, 1, e.scope.token);
        assert.equal(await e.settle(pending), 1);
        assert.deepEqual(e.directions, [1]);
        assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
    }
});
