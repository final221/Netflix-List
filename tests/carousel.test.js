import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarousel } from '../src/netflix/carousel/carousel.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createCardMarkup } from '../src/netflix/card-markup.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { FAST_MOVE_CLASS, SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS } from '../src/dom-names.js';
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
        cardMarkup: createCardMarkup({ location: { href: 'https://www.netflix.com/browse/my-list' } }),
        window: { innerWidth: 1280 }, getComputedStyle: () => ({}), performance: scheduler.performance,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout,
        requestAnimationFrame: scheduler.requestAnimationFrame, cancelAnimationFrame: scheduler.cancelAnimationFrame,
        readListShape: () => ({ totalCount: 19, columns: 4 }), readGraphqlCount: () => 19,
        createError: (code, stage, message, details) => Object.assign(new Error(message), { code, stage, details }),
        log() {}, warn() {}, tLog: value => value, logTimeout() {},
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
    const e = environment({ ...overrides, readListShape: overrides.readListShape || (() => null), readHoverToken: () => hoverToken,
        isHoverCancelled: token => token !== null && token !== hoverToken });
    const pages = Array.from({ length: count }, (_, page) => {
        const slot = new Element('div');
        slot.classList.add('slot');
        const card = slot.appendChild(new Element('a'));
        card.href = 'https://www.netflix.com/title/' + (page + 1);
        card.setAttribute('tabindex', '0');
        return [slot];
    });
    pages.forEach(slots => slots.forEach(slot => e.track.appendChild(slot)));
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

function mountedEnvironment(overrides = {}) {
    const e = navigationEnvironment({ count: 1, overrides });
    e.pages[0].forEach(slot => slot.remove());
    e.scroller.classList.add('scroller');
    e.scroller.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300, height: 100 });
    e.track.style.setProperty('display', 'flex');
    const slots = Array.from({ length: 3 }, (_, index) => {
        const slot = e.track.appendChild(new Element('div'));
        slot.classList.add('slot');
        slot.setAttribute('native-variant', String(index));
        slot.__reactFiber$mounted = { memoizedProps: { itemIndex: index, totalCount: 3 }, return: null };
        slot.getBoundingClientRect = () => ({ left: index * 100, right: (index + 1) * 100, width: 100, height: 100 });
        const card = slot.appendChild(new Element('a'));
        card.href = 'https://www.netflix.com/title/' + (index + 1);
        card.setAttribute('data-uia', 'standard-card');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Title ' + (index + 1));
        return slot;
    });
    e.pageDom.directSlots = e.pageDom.filledSlots = () => e.track.children;
    e.pageDom.nativeCardIdentity = slot => e.pageDom.videoIdFromHref(slot.querySelector('a')?.href || '');
    const options = { section: e.section, scroller: e.scroller, track: e.track, sessionToken: e.scope.token };
    return { ...e, slots, options,
        qualify: () => e.settle(e.carousel.mountedBootstrap(options)),
        capture: bootstrap => e.carousel.collect({ ...options, mode: 'mounted-single-page', bootstrap, totalCount: 3, columns: 3 }) };
}

test('source preparation owns reset/readiness and accepts complete collection facts in both native modes', async () => {
    for (const mode of ['logical', 'indicator']) {
        const e = mode === 'logical' ? mountedEnvironment() : navigationEnvironment({ mode });
        const options = { section: e.section, scroller: e.scroller, track: e.track, sessionToken: e.scope.token };
        const before = e.carousel.model(e.section);
        const prepared = await e.settle(e.carousel.prepareSource(options));
        assert.equal(prepared.ready, true);
        assert.notEqual(e.carousel.model(e.section), before);
        assert.equal(prepared.state.pageMode, mode);
        assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.state) && Object.isFrozen(prepared.state.capabilities));
        assert.equal(e.carousel.isPreparationCurrent(prepared), true);
        assert.equal(e.carousel.isPreparationCurrent({ ...prepared }), false);
        const accepted = e.carousel.acceptCollection({ preparation: prepared, totalCount: 7, columns: 3, collectedCount: 7 });
        assert.equal(accepted.status, 'accepted');
        assert.equal(accepted.knownPageCount, 3);
        assert.equal(accepted.pageCountFinalized, true);
        assert.equal(e.carousel.isMappingCurrent(accepted), true);
        assert.equal(e.carousel.isMappingCurrent({ ...accepted }), false);
        assert.equal(e.carousel.isPreparationCurrent(prepared), true, 'own finalization retains its preparation');
        assert.deepEqual(e.directions, [], 'preparation and acceptance add no native movement');
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.scheduler.frames.size, 0);
    }
});

test('collection acceptance rejects incomplete or invalid facts before changing native mapping', async () => {
    const e = mountedEnvironment();
    const prepared = await e.settle(e.carousel.prepareSource(e.options));
    const model = e.carousel.model(e.section);
    for (const facts of [
        { totalCount: 7, columns: 3, collectedCount: 6 },
        { totalCount: null, columns: 3, collectedCount: 0 },
        { totalCount: 7, columns: 0, collectedCount: 7 },
        { totalCount: 7, columns: 1.5, collectedCount: 7 }
    ]) {
        assert.throws(() => e.carousel.acceptCollection({ preparation: prepared, ...facts }), { code: 'NATIVE_COLLECTION_COUNT_MISMATCH' });
        assert.equal(model.pageCountFinalized, false);
    }
    assert.throws(() => e.carousel.acceptCollection({ preparation: { ...prepared }, totalCount: 3, columns: 3, collectedCount: 3 }),
        { code: 'NATIVE_SOURCE_REPLACED' });
    assert.equal(model.pageCountFinalized, false);
    const accepted = e.carousel.acceptCollection({ preparation: prepared, totalCount: 3, columns: 3, collectedCount: 3 });
    assert.equal(accepted.knownPageCount, 1);
    assert.throws(() => e.carousel.acceptCollection({ preparation: prepared, totalCount: 6, columns: 3, collectedCount: 6 }),
        { code: 'NATIVE_COLLECTION_ALREADY_ACCEPTED' });
    assert.equal(model.knownPageCount, 1);
});

test('prepared observations reject source, route, mapping and preparation replacement before finalization', async () => {
    for (const change of ['binding', 'route', 'mapping', 'preparation']) {
        const e = mountedEnvironment();
        const prepared = await e.settle(e.carousel.prepareSource(e.options));
        let current = e.carousel.model(e.section);
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); current = e.carousel.model(e.section); }
        if (change === 'route') e.scope.begin();
        if (change === 'mapping') e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 6, columns: 3 });
        if (change === 'preparation') { await e.settle(e.carousel.prepareSource(e.options)); current = e.carousel.model(e.section); }
        const pages = current.knownPageCount;
        assert.equal(e.carousel.isPreparationCurrent(prepared), false);
        assert.throws(() => e.carousel.acceptCollection({ preparation: prepared, totalCount: 3, columns: 3, collectedCount: 3 }),
            { code: change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'NATIVE_SOURCE_REPLACED' });
        assert.equal(current.knownPageCount, pages);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('preparation checks its admission after profile and readiness diagnostic callbacks', async () => {
    for (const phase of ['carouselDomProfileDetected', 'waitingForNativeCarouselInitialization', 'nativeCarouselInitializationReady']) {
        let e, replaced = false;
        e = mountedEnvironment({ log(message) {
            if (message !== phase || replaced) return;
            replaced = true;
            e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
        } });
        const rejected = assert.rejects(e.carousel.prepareSource(e.options), { code: 'NATIVE_SOURCE_REPLACED' });
        await e.settle(rejected);
        assert.equal(replaced, true);
        assert.equal(e.carousel.model(e.section).pageCountFinalized, false);
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.scheduler.frames.size, 0);
    }
});

test('a new preparation invalidates existing card handles and supersedes a pending readiness operation', async () => {
    const e = mountedEnvironment();
    const source = e.carousel.mountedCard({ ...e.options, item: { videoId: '1' } });
    const first = e.carousel.prepareSource(e.options);
    const rejected = assert.rejects(first, { code: 'NATIVE_SOURCE_REPLACED' });
    const second = e.carousel.prepareSource(e.options);
    assert.equal(e.carousel.isSourceCurrent(source), false);
    await e.settle(rejected);
    const prepared = await e.settle(second);
    assert.equal(prepared.ready, true);
    assert.equal(e.carousel.isPreparationCurrent(prepared), true);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('source preparation preserves the fast single-page two-frame path without another wait', async () => {
    const e = mountedEnvironment();
    const prepared = await e.settle(e.carousel.prepareSource({ ...e.options, fastSinglePageTotalCount: 3 }));
    assert.equal(prepared.reason, 'fast-single-page');
    assert.equal(prepared.elapsedMs, 32);
    assert.equal(e.carousel.confirmPageCount, undefined, 'callers cannot finalize a page model directly');
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('source preparation and acceptance check the captured caller before publishing', async () => {
    for (const phase of ['pending', 'acceptance']) {
        const e = mountedEnvironment();
        let current = true;
        const operation = e.carousel.prepareSource({ ...e.options, assertCurrent() {
            if (!current) throw Object.assign(new Error('caller replaced'), { code: 'CALLER_REPLACED' });
        } });
        if (phase === 'pending') {
            const rejected = assert.rejects(operation, { code: 'CALLER_REPLACED' });
            current = false;
            await e.settle(rejected);
        } else {
            const prepared = await e.settle(operation);
            current = false;
            assert.equal(e.carousel.isPreparationCurrent(prepared), false);
            assert.throws(() => e.carousel.acceptCollection({ preparation: prepared, totalCount: 3, columns: 3, collectedCount: 3 }),
                { code: 'CALLER_REPLACED' });
        }
        assert.equal(e.carousel.model(e.section).pageCountFinalized, false);
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.scheduler.frames.size, 0);
    }
});

test('source observations expose only validated mode and remapping facts without writable model state', () => {
    const e = mountedEnvironment();
    const current = e.carousel.observeSource(e.options);
    assert.deepEqual(current, { mode: 'logical', needsRemapping: false, remapAttempts: 0 });
    assert.ok(Object.isFrozen(current));
    assert.equal(e.carousel.isObservationCurrent(current), true);
    assert.equal(e.carousel.isObservationCurrent({ ...current }), false);
    e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 6, columns: 3 });
    assert.equal(e.carousel.isObservationCurrent(current), false);
    const stale = e.carousel.observeSource(e.options);
    assert.equal(stale.needsRemapping, true);
    assert.equal(stale.profile, undefined);
    assert.equal(stale.signatureToPage, undefined);
    const indicator = navigationEnvironment({ mode: 'indicator' });
    assert.equal(indicator.carousel.observeSource({ section: indicator.section, scroller: indicator.scroller,
        track: indicator.track, sessionToken: indicator.scope.token }).mode, 'indicator');
});

test('position observations own logical and indicator page facts without exposing model commands', () => {
    const logical = mountedEnvironment();
    assert.equal(logical.carousel.observeSource(logical.options).position, undefined);
    const current = logical.carousel.observeSource({ ...logical.options, position: true });
    assert.deepEqual(current.position, { page: 0, pages: 1 });
    assert.ok(Object.isFrozen(current.position));
    assert.equal(logical.carousel.isObservationCurrent(current), true);
    assert.equal(logical.carousel.isObservationCurrent({ ...current }), false);
    logical.carousel.refreshMapping({ ...logical.options, mode: 'delta', totalCount: 9, columns: 3 });
    assert.equal(logical.carousel.isObservationCurrent(current), false);
    assert.equal(logical.carousel.observeSource({ ...logical.options, position: true }).position.pages, 3);
    const indicator = navigationEnvironment({ mode: 'indicator' });
    const options = { section: indicator.section, scroller: indicator.scroller, track: indicator.track,
        sessionToken: indicator.scope.token, position: true };
    const observed = indicator.carousel.observeSource(options);
    assert.deepEqual(observed.position, { page: 0, pages: 3 });
    indicator.setPage(2);
    assert.equal(indicator.carousel.isObservationCurrent(observed), false);
    assert.equal(indicator.carousel.observeSource(options).position.page, 2);
    assert.equal(indicator.scheduler.timers.size, 0);
});

test('fresh position admission interprets a changed logical window and rejects prior page facts', () => {
    const e = mountedEnvironment({ readListShape: () => ({ totalCount: 9, columns: 3 }) });
    const prior = e.carousel.observeSource({ ...e.options, position: true });
    e.slots.forEach((slot, index) => { slot.__reactFiber$mounted.memoizedProps.itemIndex = index + 3; });
    const fresh = e.carousel.observeSource({ ...e.options, position: true });
    assert.equal(fresh.position.page, 1);
    assert.equal(e.carousel.isObservationCurrent(prior), false);
    assert.equal(e.carousel.isObservationCurrent(fresh), true);
    assert.equal(e.scheduler.timers.size, 0);
});

test('position admission rejects parent replacement and indicator count change on the same elements', () => {
    const e = navigationEnvironment({ mode: 'indicator' });
    let current = true;
    const options = { section: e.section, scroller: e.scroller, track: e.track,
        sessionToken: e.scope.token, position: true, assertCurrent() {
            if (!current) throw Object.assign(new Error('parent replaced'), { code: 'CALLER_REPLACED' });
        } };
    const observed = e.carousel.observeSource(options);
    const queryAll = e.section.querySelectorAll.bind(e.section), extra = new Element('native-indicator');
    e.section.querySelectorAll = selector => selector === '[data-uia="carousel-page-indicator-item"]'
        ? [...queryAll(selector), extra] : queryAll(selector);
    assert.equal(e.carousel.isObservationCurrent(observed), false);
    const changed = e.carousel.observeSource(options);
    assert.equal(changed.position.pages, 4);
    current = false;
    assert.equal(e.carousel.isObservationCurrent(changed), false);
    assert.throws(() => e.carousel.observeSource(options), { code: 'CALLER_REPLACED' });
});

test('page observations own wrapped-tail inclusion and borrow current cards through source handles', () => {
    const e = mountedEnvironment();
    const indices = [6, 7, 0];
    e.slots.forEach((slot, index) => { slot.__reactFiber$mounted.memoizedProps.itemIndex = indices[index]; });
    const mapping = e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 8, columns: 3,
        pageHintForVideoId: () => 2 });
    assert.equal(mapping.currentPage, 2);
    const result = e.carousel.pageCards({ ...e.options, page: 2, totalCount: 8, columns: 3, window: 'viewport' });
    assert.equal(result.page, 2);
    assert.equal(result.mode, 'logical');
    assert.deepEqual(result.cards.map(card => card.inPage), [true, true, false]);
    assert.deepEqual(result.cards.map(card => card.source.itemIndex), indices);
    assert.deepEqual(result.cards.map(card => card.source.slot), e.slots);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.cards) && result.cards.every(Object.isFrozen));
    assert.equal(e.carousel.isObservationCurrent(result), true);
    assert.equal(e.carousel.isObservationCurrent({ ...result }), false);
    assert.deepEqual(e.directions, []);
    e.slots[2].querySelector('a').href = 'https://www.netflix.com/title/99';
    assert.equal(e.carousel.isObservationCurrent(result), false, 'buffer recycling also invalidates the observed inclusion rule');
    assert.throws(() => e.carousel.assertObservation(result), { code: 'NATIVE_SOURCE_REPLACED' });
});

test('source count observations preserve optional uncertainty and required native count truth', () => {
    const e = mountedEnvironment();
    let reads = 0;
    for (const slot of e.slots) Object.defineProperty(slot.__reactFiber$mounted.memoizedProps, 'totalCount',
        { configurable: true, get() { reads++; return 3; } });
    assert.equal(e.carousel.observeSource(e.options).count, undefined);
    assert.equal(reads, 0, 'mode/remap observation adds no count work');
    const observed = e.carousel.observeSource({ ...e.options, count: 'required', provisionalTotalCount: 999 });
    assert.deepEqual(observed.count, { totalCount: 3, readings: [3, 3, 3], slots: 3, uniqueReadings: [3] });
    assert.ok(Object.isFrozen(observed.count) && Object.isFrozen(observed.count.readings) && Object.isFrozen(observed.count.uniqueReadings));
    assert.equal(e.carousel.isObservationCurrent(observed), true);
    Object.defineProperty(e.slots[1].__reactFiber$mounted.memoizedProps, 'totalCount', { value: 4, writable: true });
    const uncertain = e.carousel.observeSource({ ...e.options, count: 'optional' });
    assert.deepEqual(uncertain.count, { totalCount: null, readings: [3, 4, 3], slots: 3, uniqueReadings: [3, 4] });
    assert.throws(() => e.carousel.observeSource({ ...e.options, count: 'required', provisionalTotalCount: 999 }), error => {
        assert.equal(error.code, 'NATIVE_TOTAL_COUNT_UNAVAILABLE');
        assert.equal(error.stage, 'native-react-total-count');
        assert.deepEqual(error.details, { provisionalTotalCount: 999, slots: 3, readings: [3, 4, 3], uniqueReadings: [3, 4] });
        return true;
    });
    for (const slot of e.slots) Object.defineProperty(slot.__reactFiber$mounted.memoizedProps, 'totalCount', { value: 0, writable: true });
    assert.equal(e.carousel.observeSource({ ...e.options, count: 'required' }).count.totalCount, 0);
    for (const slot of e.slots) slot.__reactFiber$mounted.memoizedProps.totalCount = null;
    assert.equal(e.carousel.observeSource({ ...e.options, count: 'optional' }).count.totalCount, null);
    assert.throws(() => e.carousel.observeSource({ ...e.options, count: 'required' }), { code: 'NATIVE_TOTAL_COUNT_UNAVAILABLE' });
    assert.deepEqual(e.directions, []);
    assert.equal(e.scheduler.timers.size, 0);
});

test('native count observations reject changed readings, copied results and replaced admission', () => {
    for (const change of ['count', 'binding', 'mapping', 'parent', 'route']) {
        const e = mountedEnvironment();
        let current = true;
        const options = { ...e.options, count: 'optional', assertCurrent() {
            if (!current) throw Object.assign(new Error('caller replaced'), { code: 'CALLER_REPLACED' });
        } };
        const observation = e.carousel.observeSource(options);
        assert.equal(e.carousel.isObservationCurrent({ ...observation }), false);
        if (change === 'count') e.slots[0].__reactFiber$mounted.memoizedProps.totalCount = 4;
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'mapping') e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 6, columns: 3 });
        if (change === 'parent') current = false;
        if (change === 'route') e.scope.begin();
        assert.equal(e.carousel.isObservationCurrent(observation), false, change);
        assert.throws(() => e.carousel.assertObservation(observation));
        assert.equal(observation.count.totalCount, 3, 'previous facts are copied scalars');
    }
});

test('carousel owns passive card descriptions and isolates diagnostic failures from source authority', () => {
    const e = mountedEnvironment();
    const slot = e.slots[0], card = slot.querySelector('a');
    slot.setAttribute('data-virtual-slot', 'native-0');
    slot.style.setProperty('transform', 'translateX(5px)');
    const source = e.carousel.mountedCard({ ...e.options, item: { videoId: '1' } });
    const description = e.carousel.diagnostics({ card: slot, totalCount: 3 }).card;
    assert.equal(description.itemIndex, 0);
    assert.equal(description.logicalIndex, 0);
    assert.equal(description.slot, 'native-0');
    assert.equal(description.videoId, '1');
    assert.equal(description.href, card.href);
    assert.equal(description.ariaLabel, 'Title 1');
    assert.equal(description.tabindex, '0');
    assert.equal(description.connected, true);
    assert.equal(description.inlineTransform, 'translateX(5px)');
    assert.equal(description.rect.left, 0);
    assert.ok(Object.isFrozen(description) && Object.isFrozen(description.rect));
    assert.equal(e.carousel.isObservationCurrent(description), false, 'diagnostic facts cannot authorize publication');
    slot.__reactFiber$mounted.memoizedProps.itemIndex = 9;
    const changed = e.carousel.diagnostics({ card: slot, totalCount: 3 }).card;
    assert.equal(changed.itemIndex, 9);
    assert.equal(changed.logicalIndex, null);
    assert.equal(description.itemIndex, 0);
    slot.__reactFiber$mounted.memoizedProps.itemIndex = 0;
    slot.getBoundingClientRect = () => { throw new Error('private native diagnostic failure'); };
    assert.equal(e.carousel.diagnostics({ card: slot }).card, null);
    assert.equal(e.carousel.isSourceCurrent(source), true);
    assert.deepEqual(e.directions, []);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('carousel owns a copied passive source description with page, profile, card and marker facts', () => {
    const e = mountedEnvironment();
    e.scroller.classList.add(SOURCE_SCAN_CLASS);
    const description = e.carousel.diagnostics({ source: e.options }).source;
    assert.equal(description.selectedPage, 0);
    assert.equal(description.pageCount, 1);
    assert.equal(description.sourceSlots, 3);
    assert.equal(description.sourceCards, 3);
    assert.equal(description.currentPageCards, 3);
    assert.equal(description.sourceScan, true);
    assert.equal(description.sourceParked, false);
    assert.equal(description.carouselDom.pageMode, 'logical');
    assert.equal(description.carouselDom.navigationMode, 'hawkins');
    assert.ok(Object.isFrozen(description) && Object.isFrozen(description.carouselDom) &&
        Object.isFrozen(description.carouselDom.capabilities));
    assert.equal(description.section, undefined);
    assert.equal(description.scroller, undefined);
    assert.equal(description.track, undefined);
    assert.equal(e.carousel.isObservationCurrent(description), false, 'passive reporting is not native admission');
    e.scroller.classList.remove(SOURCE_SCAN_CLASS);
    e.scroller.classList.add(SOURCE_PARKED_CLASS);
    e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 9, columns: 3 });
    const updated = e.carousel.diagnostics({ source: e.options }).source;
    assert.equal(description.sourceScan, true, 'prior report retains copied facts');
    assert.equal(description.pageCount, 1);
    assert.equal(updated.sourceParked, true);
    assert.equal(updated.pageCount, 3);
    assert.equal(updated.carouselDom.pageMappingStale, true);
    assert.deepEqual(e.directions, []);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('source diagnostics describe incomplete discovery and isolate failure without adding default reads', () => {
    const e = environment();
    let reads = 0;
    e.pageDom.directSlots = () => { reads++; throw new Error('source description unavailable'); };
    const counters = e.carousel.diagnostics();
    assert.equal(Object.hasOwn(counters, 'source'), false);
    assert.equal(reads, 0);
    assert.equal(e.carousel.diagnostics({ source: { section: null } }).source, null);
    const incomplete = e.carousel.diagnostics({ source: { section: e.section, scroller: null, track: null } }).source;
    assert.equal(incomplete.sourceSlots, 0);
    assert.equal(incomplete.sourceCards, 0);
    assert.equal(incomplete.currentPageCards, 0);
    assert.ok(Object.isFrozen(incomplete));
    const handle = e.carousel.bind(e.section, e.scroller, e.track);
    assert.equal(e.carousel.diagnostics({ source: { section: e.section, scroller: e.scroller, track: e.track } }).source, null);
    assert.equal(e.carousel.isBindingCurrent(handle), true);
    assert.equal(e.carousel.diagnostics().readScopeActive, false);
    assert.equal(e.scheduler.timers.size, 0);
});

test('source descriptions preserve indicator page interpretation without granting observation authority', () => {
    const e = navigationEnvironment({ mode: 'indicator' });
    e.setPage(2);
    const source = { section: e.section, scroller: e.scroller, track: e.track };
    const description = e.carousel.diagnostics({ source }).source;
    assert.equal(description.selectedPage, 2);
    assert.equal(description.pageCount, 3);
    assert.equal(description.carouselDom.pageMode, 'indicator');
    assert.equal(description.carouselDom.indicatorCount, 3);
    assert.equal(e.carousel.isObservationCurrent(description), false);
    e.setPage(0);
    assert.equal(description.selectedPage, 2);
    assert.equal(e.carousel.diagnostics({ source }).source.selectedPage, 0);
    assert.equal(e.scheduler.timers.size, 0);
});

test('native recovery can publish a valid source when its card description fails', async () => {
    const traces = [];
    const e = mountedEnvironment({ trace: factory => traces.push(factory()) });
    const card = e.slots[0].querySelector('a'), attribute = card.getAttribute.bind(card);
    card.getAttribute = name => {
        if (name === 'aria-label') throw new Error('private description unavailable');
        return attribute(name);
    };
    const result = await e.settle(e.carousel.resolveCard({ ...e.options, mode: 'search', preferredPage: 0,
        maxRadius: 0, columns: 3, repairLogicalMapping: false, item: { videoId: '1' } }));
    assert.equal(result.status, 'found');
    assert.equal(e.carousel.isSourceCurrent(result.source), true);
    assert.ok(traces.some(([, details]) => details.source === null));
    assert.deepEqual(e.directions, []);
    assert.equal(e.scheduler.timers.size, 0);
});

test('page observations reject an obsolete resolved handle or admission rather than borrowing a new source', () => {
    for (const change of ['binding', 'mapping', 'caller', 'route']) {
        const e = mountedEnvironment();
        const source = e.carousel.mountedCard({ ...e.options, item: { videoId: '1' } });
        const binding = e.carousel.borrowBinding(e.section, e.scroller, e.track);
        let current = true;
        const options = { ...e.options, source, binding, totalCount: 3, columns: 3, assertCurrent() {
            if (!current) throw Object.assign(new Error('caller replaced'), { code: 'CALLER_REPLACED' });
        } };
        const observation = e.carousel.pageCards(options);
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'mapping') e.carousel.refreshMapping({ ...e.options, mode: 'delta', totalCount: 6, columns: 3 });
        if (change === 'caller') current = false;
        if (change === 'route') e.scope.begin();
        assert.equal(e.carousel.isObservationCurrent(observation), false);
        assert.throws(() => e.carousel.pageCards(options), { code: change === 'caller' ? 'CALLER_REPLACED' :
            change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'NATIVE_SOURCE_REPLACED' });
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('page observation validates its selected page and preserves current versus viewport selection', () => {
    const e = mountedEnvironment();
    e.slots[1].querySelector('a').setAttribute('tabindex', '-1');
    e.slots[1].getBoundingClientRect = () => ({ left: 1000, right: 1100, width: 100, height: 100 });
    const current = e.carousel.pageCards({ ...e.options, totalCount: 3, columns: 3, window: 'current' });
    const viewport = e.carousel.pageCards({ ...e.options, totalCount: 3, columns: 1, window: 'viewport' });
    assert.deepEqual(current.cards.map(entry => entry.source.videoId), ['1', '3']);
    assert.deepEqual(viewport.cards.map(entry => entry.source.videoId), ['1']);
    assert.throws(() => e.carousel.pageCards({ ...e.options, page: 1, totalCount: 3, columns: 3 }), { code: 'NATIVE_SOURCE_REPLACED' });
    const indicator = navigationEnvironment({ mode: 'indicator' });
    const observed = indicator.carousel.pageCards({ section: indicator.section, scroller: indicator.scroller,
        track: indicator.track, sessionToken: indicator.scope.token, totalCount: 3, columns: 1 });
    indicator.setPage(1);
    assert.equal(indicator.carousel.isObservationCurrent(observed), false);
    indicator.pageDom.filledSlots = () => [];
    const empty = indicator.carousel.pageCards({ section: indicator.section, scroller: indicator.scroller,
        track: indicator.track, sessionToken: indicator.scope.token, totalCount: 3, columns: 1 });
    assert.deepEqual(empty.cards, []);
    indicator.setPage(2);
    assert.equal(indicator.carousel.isObservationCurrent(empty), false, 'an empty window still belongs to its selected page');
});

test('page observations reject same-page window changes including cards mounting into an empty window', () => {
    const e = mountedEnvironment();
    let filled = [];
    e.pageDom.filledSlots = () => filled;
    const empty = e.carousel.pageCards({ ...e.options, totalCount: 3, columns: 3 });
    assert.deepEqual(empty.cards, []);
    filled = e.slots;
    assert.equal(e.carousel.isObservationCurrent(empty), false, 'empty membership is part of the observation');
    const populated = e.carousel.pageCards({ ...e.options, totalCount: 3, columns: 3 });
    e.slots[1].querySelector('a').setAttribute('tabindex', '-1');
    e.slots[1].getBoundingClientRect = () => ({ left: 1000, right: 1100, width: 100, height: 100 });
    assert.equal(e.slots[1].isConnected, true);
    assert.equal(e.carousel.isObservationCurrent(populated), false, 'still-connected cards can leave the current window');
    assert.deepEqual(e.carousel.pageCards({ ...e.options, totalCount: 3, columns: 3 }).cards.map(entry => entry.source.videoId), ['1', '3']);
    assert.equal(e.scheduler.timers.size, 0);
});

test('page observations own current signatures and opt-in template fallback with validated selection', () => {
    const e = mountedEnvironment();
    const options = { ...e.options, totalCount: 3, columns: 3 };
    const current = e.carousel.pageCards(options);
    assert.equal(current.signature, e.slots.map(slot => slot.querySelector('a').href).join('|'));
    assert.equal(current.template, undefined, 'ordinary page observations do not select a template');
    const selected = e.carousel.pageCards({ ...options, template: true });
    assert.equal(selected.template, selected.cards[0].source);
    e.slots.forEach((slot, index) => {
        slot.querySelector('a').setAttribute('tabindex', '-1');
        slot.getBoundingClientRect = () => ({ left: 1000 + index * 100, right: 1100 + index * 100, width: 100, height: 100 });
    });
    const fallback = e.carousel.pageCards({ ...options, template: true });
    assert.deepEqual(fallback.cards, []);
    assert.equal(fallback.signature, '');
    assert.equal(fallback.template.slot, e.slots[0]);
    assert.equal(e.carousel.isObservationCurrent(fallback), true);
    e.pageDom.filledSlots = () => e.slots.slice(1);
    assert.equal(e.carousel.isObservationCurrent(fallback), false);
    e.pageDom.filledSlots = () => [];
    const missing = e.carousel.pageCards({ ...options, template: true });
    assert.equal(missing.template, null);
    assert.equal(e.carousel.isObservationCurrent({ ...missing }), false);
    assert.deepEqual(e.directions, []);
});

test('opt-in readiness observations copy native facts and reject changed or replaced admission', () => {
    for (const change of ['cards', 'style', 'parent', 'binding', 'route']) {
        const e = mountedEnvironment();
        let current = true;
        const options = { ...e.options, readiness: true, assertCurrent() {
            if (!current) throw Object.assign(new Error('parent replaced'), { code: 'CALLER_REPLACED' });
        } };
        let readinessReads = 0;
        e.pageDom.directSlots = () => { readinessReads++; return e.track.children; };
        assert.equal(e.carousel.observeSource(e.options).readiness, undefined);
        assert.equal(readinessReads, 0, 'ordinary source observations add no readiness read');
        const observed = e.carousel.observeSource(options);
        assert.equal(observed.readiness.cards, 3);
        assert.equal(observed.readiness.pages, 1);
        assert.equal(observed.readiness.connected, true);
        assert.ok(Object.isFrozen(observed.readiness) && Object.isFrozen(observed.readiness.capabilities));
        assert.equal(e.carousel.isObservationCurrent(observed), true);
        if (change === 'cards') e.pageDom.filledSlots = () => [];
        if (change === 'style') for (const key of ['display', 'transform', 'will-change']) e.track.style.setProperty(key, '');
        if (change === 'parent') current = false;
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'route') e.scope.begin();
        assert.equal(e.carousel.isObservationCurrent(observed), false, change);
        assert.equal(observed.readiness.cards, 3);
        assert.equal(e.carousel.isObservationCurrent({ ...observed }), false);
        assert.equal(e.scheduler.timers.size, 0);
        assert.deepEqual(e.directions, []);
    }
});

test('delta mapping anchors native positions or visible title hints synchronously without rewriting membership', () => {
    const e = mountedEnvironment();
    const hints = new Map([['1', 1], ['2', 1], ['3', 0]]);
    const options = { ...e.options, mode: 'delta', totalCount: 6, columns: 3, pageHintForVideoId: id => hints.get(id) };
    const first = e.carousel.refreshMapping(options);
    assert.equal(first instanceof Promise, false);
    assert.equal(first.status, 'anchored');
    assert.equal(first.currentPage, 0, 'native indices take precedence over old membership hints');
    assert.equal(first.knownPageCount, 2);
    assert.equal(first.pageMappingStale, true);
    assert.deepEqual(first.itemIndices, [0, 1, 2]);
    assert.equal(e.carousel.isMappingCurrent(first), true);
    assert.equal(e.carousel.isMappingCurrent({ ...first }), false);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.visibleIds));
    for (const slot of e.slots) slot.__reactFiber$mounted.memoizedProps.itemIndex = null;
    const second = e.carousel.refreshMapping(options);
    assert.equal(second.currentPage, 1, 'non-canonical windows retain the dominant visible page hint');
    assert.equal(e.carousel.isMappingCurrent(first), false);
    assert.deepEqual([...hints], [['1', 1], ['2', 1], ['3', 0]]);
    const indicator = navigationEnvironment({ mode: 'indicator' });
    assert.equal(indicator.carousel.refreshMapping({ ...options, section: indicator.section,
        scroller: indicator.scroller, track: indicator.track, sessionToken: indicator.scope.token }).status, 'not-applicable');
});

test('responsive mapping commits unchanged and changed layouts with validated observations and invalidates old source handles', async () => {
    const e = mountedEnvironment();
    const source = e.carousel.mountedCard({ ...e.options, item: { videoId: '1' } });
    const first = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 3, columns: 3 });
    assert.equal(first.status, 'committed');
    assert.equal(first.countConverged, true);
    assert.equal(first.knownPageCount, 1);
    assert.equal(first.currentPage, 0);
    assert.equal(first.pageMappingStale, false);
    assert.equal(e.carousel.isSourceCurrent(source), false);
    for (const [index, slot] of e.slots.entries()) Object.assign(slot.__reactFiber$mounted.memoizedProps, { itemIndex: index + 3, totalCount: 8 });
    const changed = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 8, columns: 3 });
    assert.equal(changed.status, 'committed');
    assert.equal(changed.currentPage, 1);
    assert.equal(changed.knownPageCount, 3);
    assert.deepEqual(changed.itemIndices, [3, 4, 5]);
    assert.equal(e.carousel.isMappingCurrent(first), false);
    assert.equal(e.carousel.isMappingCurrent(changed), true);
    assert.throws(() => e.carousel.assertMapping({ ...changed }), { code: 'NATIVE_SOURCE_REPLACED' });
    e.pageDom.filledSlots = e.pageDom.directSlots = () => e.slots.slice(0, 2);
    for (const [index, slot] of e.slots.entries()) slot.__reactFiber$mounted.memoizedProps.itemIndex = index + 2;
    const resized = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 8, columns: 2 });
    assert.equal(resized.status, 'committed');
    assert.equal(resized.columns, 2);
    assert.equal(resized.currentPage, 1);
    assert.equal(resized.knownPageCount, 4);
    assert.deepEqual(resized.itemIndices, [2, 3]);
    assert.equal(e.carousel.isMappingCurrent(changed), false);
    assert.deepEqual(e.directions, []);
    assert.equal(e.scheduler.timers.size, 0);
});

test('responsive mapping defers inconsistent native counts while preserving finalized pages and releasing its motion lease', async () => {
    const e = mountedEnvironment();
    e.carousel.completeCollection(e.section, 4);
    e.carousel.notePage(e.section, 3);
    e.track.style.setProperty('transition-duration', '75ms');
    for (const [index, slot] of e.slots.entries()) slot.__reactFiber$mounted.memoizedProps.totalCount = index === 1 ? 7 : 8;
    for (let retry = 1; retry <= 2; retry++) {
        const result = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 8, columns: 3 });
        assert.equal(result.status, 'deferred');
        assert.equal(result.reason, 'count-not-converged');
        assert.equal(result.countConverged, false);
        assert.equal(result.knownPageCount, 4);
        assert.equal(result.pageCountFinalized, true);
        assert.equal(result.retryCount, retry);
        assert.equal(e.carousel.isMappingCurrent(result), true);
    }
    assert.equal(e.track.style.getPropertyValue('transition-duration'), '75ms');
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
    assert.deepEqual(e.directions, []);
});

test('responsive mapping validates compatible wrapped tails and retains count convergence on non-canonical deferral', async () => {
    for (const compatible of [true, false]) {
        const e = mountedEnvironment();
        e.carousel.completeCollection(e.section, 4);
        e.carousel.notePage(e.section, compatible ? 3 : 0);
        for (const [index, slot] of e.slots.entries()) Object.assign(slot.__reactFiber$mounted.memoizedProps,
            { itemIndex: [6, 7, 0][index], totalCount: 8 });
        const result = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 8, columns: 3 });
        assert.equal(result.countConverged, true);
        assert.equal(result.status, compatible ? 'committed' : 'deferred');
        assert.equal(result.knownPageCount, compatible ? 3 : 4);
        assert.equal(result.currentPage, compatible ? 2 : 0);
        if (!compatible) assert.equal(result.reason, 'non-canonical-window');
        assert.deepEqual(result.itemIndices, [6, 7, 0]);
    }
});

test('remapping admission rejects replaced owners and supersedes already-stale work before another native scan', async () => {
    for (const change of ['binding', 'model', 'route', 'caller', 'delta', 'new-remap']) {
        const e = mountedEnvironment();
        let current = true, scans = 0;
        const filled = e.pageDom.filledSlots;
        e.pageDom.filledSlots = (...args) => { scans++; return filled(...args); };
        const options = { ...e.options, mode: 'responsive', totalCount: 3, columns: 3,
            assertCurrent() { if (!current) throw Object.assign(new Error('caller replaced'), { code: 'CALLER_REPLACED' }); } };
        const pending = e.carousel.refreshMapping(options);
        const rejected = assert.rejects(pending, { code: change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' :
            change === 'caller' ? 'CALLER_REPLACED' : 'NATIVE_SOURCE_REPLACED' });
        const before = scans;
        let latest = null;
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'model') e.carousel.resetModel(e.section);
        if (change === 'route') e.scope.begin();
        if (change === 'caller') current = false;
        if (change === 'delta') e.carousel.refreshMapping({ ...options, mode: 'delta' });
        if (change === 'new-remap') latest = e.carousel.refreshMapping(options);
        const afterReplacement = scans;
        await rejected;
        if (latest) assert.equal((await latest).status, 'committed');
        else assert.equal(scans, afterReplacement, 'obsolete remapping performs no further native scan');
        if (!['delta', 'new-remap'].includes(change)) assert.equal(scans, before);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('remapping queued behind real navigation cannot commit after a membership delta', async () => {
    const e = navigationEnvironment({ onClick() {} });
    for (const [index, slots] of e.pages.entries()) slots[0].__reactFiber$remap = {
        memoizedProps: { itemIndex: index, totalCount: 3 }, return: null };
    const movement = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    const outcome = movement.catch(error => error);
    await e.scheduler.flush();
    const options = { section: e.section, scroller: e.scroller, track: e.track,
        sessionToken: e.scope.token, totalCount: 3, columns: 1 };
    const pending = e.carousel.refreshMapping({ ...options, mode: 'responsive' });
    const rejected = assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
    const delta = e.carousel.refreshMapping({ ...options, mode: 'delta', totalCount: 4 });
    e.setPage(1);
    e.observers.forEach(observer => observer.callback([]));
    await e.settle(outcome);
    await e.settle(rejected);
    assert.equal(e.carousel.model(e.section).knownPageCount, 4);
    assert.equal(e.carousel.model(e.section).pageMappingStale, true);
    assert.equal(e.carousel.isMappingCurrent(delta), false, 'navigation has changed the observed page');
    assert.deepEqual(e.directions, [1]);
    assert.equal(e.scheduler.timers.size, 0);
});

test('native remapping diagnostics cannot commit or publish after replacing their source', async () => {
    let e, replacementLease;
    e = mountedEnvironment({ log(message) {
        if (message === 'Logical My List wrapped tail accepted for current-page recovery') {
            e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
            replacementLease = e.carousel.suppressMotion(e.section, e.track);
        }
    } });
    e.carousel.completeCollection(e.section, 4);
    e.carousel.notePage(e.section, 3);
    e.track.style.setProperty('transition', '125ms');
    for (const [index, slot] of e.slots.entries()) Object.assign(slot.__reactFiber$mounted.memoizedProps,
        { itemIndex: [6, 7, 0][index], totalCount: 8 });
    await assert.rejects(e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 8, columns: 3 }),
        { code: 'NATIVE_SOURCE_REPLACED' });
    assert.equal(e.carousel.model(e.section).knownPageCount, null);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 1);
    assert.equal(e.track.style.getPropertyValue('transition'), 'none', 'old finally cannot restore over a replacement lease');
    replacementLease.release();
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
    assert.equal(e.track.style.getPropertyValue('transition'), '125ms');
});

test('responsive mapping defers a canonical window with no title signature and preserves count convergence', async () => {
    const e = mountedEnvironment();
    for (const slot of e.slots) slot.querySelector('a').href = '';
    const result = await e.carousel.refreshMapping({ ...e.options, mode: 'responsive', totalCount: 3, columns: 3 });
    assert.equal(result.status, 'deferred');
    assert.equal(result.reason, 'signature-unavailable');
    assert.equal(result.countConverged, true);
    assert.equal(result.pageMappingStale, true);
    assert.equal(result.retryCount, 1);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
});

test('mounted borrowing preserves synchronous active filtering and validated identity fallback', () => {
    for (const mode of ['logical', 'indicator']) {
        const e = navigationEnvironment({ mode });
        const slot = e.pages[0][0], card = slot.querySelector('a');
        const options = { section: e.section, scroller: e.scroller, track: e.track,
            item: { videoId: '1', href: 'https://www.netflix.com/watch/1' }, activeOnly: true, sessionToken: e.scope.token };
        const source = e.carousel.mountedCard(options);
        assert.equal(source.slot, slot);
        assert.equal(source instanceof Promise, false);
        assert.equal(e.carousel.isSourceCurrent({ ...source }), false);
        e.pageDom.filledSlots = () => [...e.pages[0], ...e.pages[1]];
        const hidden = e.pages[1][0];
        hidden.getBoundingClientRect = () => ({ left: 3000, width: 100, right: 3100 });
        hidden.querySelector('a').setAttribute('tabindex', '-1');
        assert.equal(e.carousel.mountedCard({ ...options, item: { videoId: '2' } }), null);
        assert.equal(e.carousel.mountedCard({ ...options, item: { videoId: '2' }, activeOnly: false }).slot, hidden);
        card.href = 'https://www.netflix.com/browse';
        assert.equal(e.carousel.mountedCard({ ...options, item: { href: card.href } }).slot, slot);
        card.href = '';
        assert.equal(e.carousel.mountedCard({ ...options, item: {} }), null, 'an absent identity cannot match an empty href');
        assert.equal(source.isCurrent(), false, 'recycling invalidates the borrowed identity');
        e.carousel.clearBinding();
        assert.throws(() => source.slot, { code: 'NATIVE_SOURCE_REPLACED' });
        assert.equal(e.scheduler.timers.size, 0);
        assert.deepEqual(e.directions, []);
    }
});

test('mounted resolution owns bounded polling and copies identity before waiting for hydration', async () => {
    const e = mountedEnvironment();
    let reads = 0;
    e.pageDom.filledSlots = () => { reads++; return e.track.children; };
    const item = { videoId: '99' };
    const pending = e.carousel.resolveCard({ ...e.options, mode: 'mounted', item, activeOnly: true, hoverToken: 1 });
    assert.equal(reads, 1, 'admission and first lookup share one native sample');
    assert.equal(e.scheduler.timers.size, 1);
    assert.equal([...e.scheduler.timers.values()][0].due - e.scheduler.performance.now(), 10);
    item.videoId = '3';
    await e.scheduler.advance(10);
    assert.equal(e.scheduler.timers.size, 1, 'changing caller data cannot retarget the admitted wait');
    e.slots[2].querySelector('a').href = 'https://www.netflix.com/title/99';
    await e.scheduler.advance(10);
    const result = await pending;
    assert.equal(result.status, 'found');
    assert.equal(result.source.slot, e.slots[2]);
    assert.equal(result.source.videoId, '99');
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.carousel.diagnostics().mountedSourceWaits, 0);
    assert.deepEqual(e.directions, []);

    reads = 0;
    const missing = e.carousel.resolveCard({ ...e.options, mode: 'mounted', item: { videoId: '100' }, timeout: 25 });
    for (let i = 0; i < 3; i++) await e.scheduler.advance(10);
    assert.equal((await missing).reason, 'target-not-mounted');
    assert.equal(reads, 4, 'sample at admission and every existing 10-ms tick, including the final deadline sample');
    assert.equal(e.scheduler.timers.size, 0);
});

test('mounted polling rejects obsolete binding, mapping, page and route before another card scan', async () => {
    for (const change of ['binding', 'mapping', 'page', 'route', 'disconnected', 'hover']) {
        const e = navigationEnvironment({ mode: 'indicator' });
        let reads = 0;
        e.pageDom.filledSlots = () => { reads++; return e.pages[e.page()]; };
        const options = { section: e.section, scroller: e.scroller, track: e.track,
            mode: 'mounted', item: { videoId: '99' }, hoverToken: 1, sessionToken: e.scope.token };
        const pending = e.carousel.resolveCard(options);
        const outcome = pending.then(value => ({ value }), error => ({ error }));
        const before = reads;
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'mapping') e.carousel.anchorAfterDelta(e.section, { pageCount: 3, currentPage: 0, signature: 'new' });
        if (change === 'page') e.setPage(1);
        if (change === 'route') e.scope.begin();
        if (change === 'disconnected') e.track.remove();
        if (change === 'hover') e.cancelHover();
        await e.scheduler.advance(10);
        const result = await outcome;
        if (change === 'hover') assert.equal(result.value.reason, 'hover-cancelled');
        else assert.equal(result.error.code, change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'NATIVE_SOURCE_REPLACED');
        assert.equal(reads, before, change + ' cannot scan a replacement window');
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.carousel.diagnostics().mountedSourceWaits, 0);
    }
});

test('retired polling callbacks cannot release or resume replacement waits', async () => {
    const e = mountedEnvironment();
    const options = { ...e.options, mode: 'mounted', item: { videoId: '99' } };
    const old = e.carousel.resolveCard(options);
    const rejected = assert.rejects(old, { code: 'NATIVE_SOURCE_REPLACED' });
    const retiredTick = [...e.scheduler.timers.values()][0].callback;
    e.carousel.clearBinding();
    e.carousel.bind(e.section, e.scroller, e.track);
    const replacement = e.carousel.resolveCard(options);
    retiredTick();
    await e.scheduler.flush();
    await rejected;
    assert.equal(e.scheduler.timers.size, 1);
    assert.equal(e.carousel.diagnostics().mountedSourceWaits, 1);
    e.slots[0].querySelector('a').href = 'https://www.netflix.com/title/99';
    await e.scheduler.advance(10);
    assert.equal((await replacement).source.slot, e.slots[0]);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.carousel.diagnostics().mountedSourceWaits, 0);
});

test('expected-page resolution returns native handles and truthful incomplete or mismatched observations', async () => {
    for (const mode of ['logical', 'indicator']) {
        const e = navigationEnvironment({ mode });
        for (const [page, slots] of e.pages.entries()) {
            slots[0].__reactFiber$source = { memoizedProps: { itemIndex: page, totalCount: 3 }, return: null };
        }
        const options = { section: e.section, scroller: e.scroller, track: e.track,
            item: { videoId: '2', href: 'https://www.netflix.com/title/2' }, expectedPage: 1,
            totalCount: 3, columns: 1, pageItemCount: 1, sessionToken: e.scope.token };
        const found = await e.settle(e.carousel.resolveCard(options));
        assert.equal(found.status, 'found');
        assert.equal(found.source.slot, e.pages[1][0]);
        assert.equal(found.source.itemIndex, 1);
        assert.equal(found.source.isCurrent(), true);
        assert.equal(Object.isFrozen(found.source), true);
        assert.deepEqual(e.directions, [1]);
        assert.equal(e.carousel.isSourceCurrent({ ...found.source }), false);
        const mismatch = await e.settle(e.carousel.resolveCard({ ...options, item: { videoId: '99' } }), 100);
        assert.equal(mismatch.status, 'mismatch');
        assert.deepEqual(mismatch.visibleIds, ['2']);
        assert.equal(mismatch.visibleCards[0].itemIndex, 1);
        assert.equal((await e.carousel.resolveCard({ ...options, totalCount: 4 })).reason, 'page-count-not-converged');
        const href = 'https://www.netflix.com/browse?native-card=unknown';
        e.pages[1][0].querySelector('a').href = href;
        const byHref = await e.settle(e.carousel.resolveCard({ ...options, item: { href } }));
        assert.equal(byHref.status, 'found');
        assert.equal(byHref.source.href, href);
        assert.equal(byHref.source.videoId, '');
        e.pageDom.filledSlots = () => [];
        assert.equal((await e.settle(e.carousel.resolveCard(options), 100)).reason, 'expected-page-not-fully-mounted');
        assert.equal(e.carousel.diagnostics().navigation.pendingWaits, 0);
    }
});

test('preferred-page recovery preserves direct hits and the normal adjacent-page pulse', async () => {
    for (const mode of ['logical', 'indicator']) {
        let returned = false;
        const moves = [];
        const e = navigationEnvironment({ mode, overrides: { log(name, facts) {
            if (name === 'carouselMoveStarted') moves.push(facts);
        } }, onClick({ direction, page, setPage }) {
            setPage((page + direction + 3) % 3);
            if (direction < 0) {
                returned = true;
                e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/1';
            }
        } });
        const options = { section: e.section, scroller: e.scroller, track: e.track,
            mode: 'preferred-refresh', item: Object.freeze({ videoId: '1', page: 0 }), preferredPage: 0,
            sessionToken: e.scope.token, hoverToken: 1 };
        const immediate = await e.settle(e.carousel.resolveCard(options));
        assert.equal(immediate.status, 'found');
        assert.equal(immediate.refreshed, false);
        assert.deepEqual(e.directions, []);
        e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
        const refreshed = await e.settle(e.carousel.resolveCard(options), 140);
        assert.equal(returned, true);
        assert.equal(refreshed.status, 'found');
        assert.equal(refreshed.refreshed, true);
        assert.equal(refreshed.page, 0);
        assert.equal(refreshed.source.slot, e.pages[0][0]);
        assert.deepEqual(e.directions, [1, -1]);
        assert.equal(e.scheduler.timers.size, 0);
        assert.deepEqual(moves.map(move => move.sharedFastMode), [false, false]);
        assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
    }
});

test('preferred-page recovery keeps the 700-ms deadline and cancelled searches stop before another sample', async () => {
    const e = navigationEnvironment({ count: 1 });
    const options = { section: e.section, scroller: e.scroller, track: e.track, item: { videoId: '99' },
        preferredPage: 0, sessionToken: e.scope.token, hoverToken: 1 };
    const start = e.scheduler.performance.now();
    const failed = await e.settle(e.carousel.resolveCard({ ...options, mode: 'preferred-refresh' }), 70);
    assert.equal(failed.reason, 'target-not-mounted');
    const elapsed = e.scheduler.performance.now() - start;
    assert.ok(elapsed >= 700 && elapsed < 730, 'the existing single-page recovery deadline is bounded');
    assert.deepEqual(e.directions, []);
    let reads = 0;
    e.pageDom.filledSlots = () => { reads++; return e.pages[0]; };
    const pending = e.carousel.resolveCard({ ...options, mode: 'search' });
    await e.scheduler.flush();
    const before = reads;
    e.cancelHover();
    await e.scheduler.advance(10);
    assert.equal((await pending).reason, 'hover-cancelled');
    assert.equal(reads, before);
    assert.equal(e.scheduler.timers.size, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('native source search preserves ordered radius bounds and returns observations without record writes', async () => {
    for (const mode of ['logical', 'indicator']) for (const scenario of ['nearby', 'zero-radius', 'full']) {
        const attempts = [];
        const e = navigationEnvironment({ mode, count: 5, overrides: { log(name, detail) {
            if (name === 'hoverSourceSearchPage') attempts.push(detail.page);
        } } });
        e.setPage(2); e.carousel.notePage(e.section, 2);
        const target = scenario === 'nearby' ? '2' : scenario === 'full' ? '1' : '99';
        const item = Object.freeze({ videoId: target, href: 'https://www.netflix.com/title/' + target, page: 77, ariaLabel: 'Title' });
        const result = await e.settle(e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            mode: 'search', item, preferredPage: 2, maxRadius: scenario === 'nearby' ? 1 : scenario === 'zero-radius' ? 0 : null,
            repairLogicalMapping: true, columns: 1, hoverToken: 1, sessionToken: e.scope.token }), 600);
        assert.deepEqual(attempts, scenario === 'nearby' ? [2, 3, 1] : scenario === 'zero-radius' ? [2] : [2, 3, 1, 4, 0]);
        if (scenario === 'zero-radius') assert.equal(result.reason, 'source-search-exhausted');
        else {
            assert.equal(result.status, 'found');
            assert.equal(result.page, scenario === 'nearby' ? 1 : 0);
            assert.equal(result.source.isCurrent(), true, 'signature repair finishes before handle publication');
            assert.equal(result.sources[0].isCurrent(), true);
            assert.deepEqual(Object.keys(result.visibleCards[0]).sort(), ['href', 'itemIndex', 'videoId']);
            assert.equal(result.visibleCards[0].videoId, target);
            assert.equal(Object.isFrozen(result.visibleCards), true);
        }
        assert.equal(item.page, 77);
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
    }
});

test('queued recovery cannot click after mapping or route replacement', async () => {
    for (const mode of ['preferred-refresh', 'search']) for (const change of ['mapping', 'route']) {
        let e;
        e = navigationEnvironment({ onClick() {} });
        const first = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
        const firstOutcome = first.catch(error => error);
        await e.scheduler.flush();
        const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            mode, item: { videoId: '3' }, preferredPage: 2, maxRadius: 0, hoverToken: 1, sessionToken: e.scope.token });
        const rejected = assert.rejects(pending, { code: change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'NATIVE_SOURCE_REPLACED' });
        await e.scheduler.flush();
        if (change === 'mapping') e.carousel.anchorAfterDelta(e.section, { pageCount: 3, currentPage: 0, signature: 'new' });
        else e.scope.begin();
        e.setPage(1);
        e.observers.forEach(observer => observer.callback([]));
        await e.settle(firstOutcome);
        await e.settle(rejected);
        assert.deepEqual(e.directions, [1]);
        assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('source-search diagnostic callbacks cannot admit a replacement source or publish stale handles', async () => {
    for (const callback of ['page-log', 'found-trace']) {
        let e;
        e = navigationEnvironment({ overrides: {
            log(name) { if (callback === 'page-log' && name === 'hoverSourceSearchPage') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); } },
            trace(event) { if (callback === 'found-trace') { event(); e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); } }
        } });
        const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            mode: 'search', item: { videoId: '1' }, preferredPage: 0, maxRadius: 0, sessionToken: e.scope.token });
        await assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
        assert.deepEqual(e.directions, []);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('search hydration fallback finds a late title but rejects mapping replacement before another scan', async () => {
    for (const change of ['hydrate', 'remap']) {
        const e = navigationEnvironment({ count: 1 });
        let replaced = false, obsoleteReads = 0;
        e.pageDom.filledSlots = () => { if (replaced) obsoleteReads++; return e.pages[0]; };
        e.scheduler.setTimeout(() => {
            if (change === 'hydrate') e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
            else {
                replaced = true;
                e.carousel.anchorAfterDelta(e.section, { pageCount: 1, currentPage: 0, signature: 'replacement' });
            }
        }, 600);
        const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            mode: 'search', item: { videoId: '99' }, preferredPage: 0, maxRadius: 0, sessionToken: e.scope.token });
        if (change === 'hydrate') {
            const result = await e.settle(pending, 100);
            assert.equal(result.source.videoId, '99');
            assert.equal(result.source.isCurrent(), true);
            assert.ok(e.scheduler.performance.now() >= 600);
        } else await e.settle(assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' }), 100);
        assert.equal(obsoleteReads, 0);
        assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.scheduler.frames.size, 0);
        assert.deepEqual(e.directions, []);
    }
});

test('source handles reject native recycling and mapping replacement without invalidating repeated observations', async () => {
    for (const change of ['identity', 'index', 'mapping', 'binding', 'route']) {
        const e = mountedEnvironment();
        const result = await e.settle(e.carousel.resolveCard({ ...e.options, item: { videoId: '1' },
            expectedPage: 0, totalCount: 3, columns: 3, pageItemCount: 3 }));
        const source = result.source;
        e.carousel.forcePage(e.section, e.carousel.signatureOf(e.slots), 0);
        // The first forced observation can establish mapping; borrow after it.
        const current = (await e.settle(e.carousel.resolveCard({ ...e.options, item: { videoId: '1' },
            expectedPage: 0, totalCount: 3, columns: 3, pageItemCount: 3 }))).source;
        e.carousel.forcePage(e.section, e.carousel.signatureOf(e.slots), 0);
        assert.equal(current.isCurrent(), true, 'an identical observation retains ownership');
        if (change === 'identity') e.slots[0].querySelector('a').href = 'https://www.netflix.com/title/99';
        if (change === 'index') e.slots[0].__reactFiber$mounted.memoizedProps.itemIndex = 2;
        if (change === 'mapping') e.carousel.anchorAfterDelta(e.section, { pageCount: 1, currentPage: 0, signature: e.carousel.signatureOf(e.slots) });
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'route') e.scope.dispose();
        assert.equal(current.isCurrent(), false, change);
        assert.equal(source.isCurrent(), false, change);
        assert.throws(() => current.slot, { code: 'NATIVE_SOURCE_REPLACED' });
    }
});

test('source resolution stops old waits and never adopts a replacement with the same title', async () => {
    for (const change of ['binding', 'route', 'hover']) {
        const e = navigationEnvironment();
        const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            item: { videoId: '99' }, expectedPage: 0, totalCount: 3, columns: 1,
            pageItemCount: 1, hoverToken: 1, sessionToken: e.scope.token });
        const expected = change === 'hover' ? pending : assert.rejects(pending, {
            code: change === 'route' ? 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' : 'NATIVE_SOURCE_REPLACED' });
        await e.scheduler.flush();
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (change === 'route') e.scope.dispose();
        if (change === 'hover') e.cancelHover();
        const result = await e.settle(expected, 100);
        if (change === 'hover') assert.equal(result.status, 'unknown');
        assert.deepEqual(e.directions, []);
        assert.equal(e.scheduler.frames.size, 0);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('source resolution accepts late hydration but rejects a remapped source during that wait', async () => {
    for (const change of ['hydrate', 'anchor', 'model']) {
        const e = navigationEnvironment();
        const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
            item: { videoId: '99' }, expectedPage: 0, totalCount: 3, columns: 1,
            pageItemCount: 1, sessionToken: e.scope.token });
        const expected = change === 'hydrate' ? pending : assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
        await e.scheduler.flush();
        if (change === 'hydrate') e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
        if (change === 'anchor') e.carousel.anchorAfterDelta(e.section, { pageCount: 3, currentPage: 0, signature: e.pages[0][0].querySelector('a').href });
        if (change === 'model') e.carousel.resetModel(e.section);
        let reads = 0;
        const filled = e.pageDom.filledSlots;
        e.pageDom.filledSlots = () => { reads++; return filled(); };
        const result = await e.settle(expected, 100);
        if (change === 'hydrate') { assert.equal(result.status, 'found'); assert.equal(result.source.videoId, '99'); }
        else assert.equal(reads, 0, 'obsolete hydration must stop before another card read');
        assert.deepEqual(e.directions, []);
        assert.equal(e.scheduler.frames.size, 0);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('a queued source-resolution move rejects a changed mapping before issuing another click', async () => {
    let clicks = 0;
    const e = navigationEnvironment({ mode: 'indicator', onClick({ page, direction, setPage }) {
        if (++clicks > 1) setPage((page + direction + 3) % 3);
    } });
    const first = e.carousel.movePage(e.section, e.scroller, 1, null, e.scope.token);
    await e.scheduler.flush();
    const pending = e.carousel.resolveCard({ section: e.section, scroller: e.scroller, track: e.track,
        item: { videoId: '3' }, expectedPage: 2, totalCount: 3, columns: 1,
        pageItemCount: 1, sessionToken: e.scope.token });
    const rejected = assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
    e.carousel.anchorAfterDelta(e.section, { pageCount: 3, currentPage: 0, signature: 'new-mapping' });
    e.setPage(1);
    e.observers.forEach(observer => observer.callback([]));
    await e.settle(first);
    await e.settle(rejected);
    assert.deepEqual(e.directions, [1]);
    assert.equal(e.carousel.diagnostics().navigation.pendingMoves, 0);
    assert.equal(e.carousel.diagnostics().navigation.pendingWaits, 0);
});

test('mounted bootstrap and capture use opaque native proof without navigation or extra snapshots', async () => {
    const e = mountedEnvironment();
    let clones = 0;
    for (const slot of e.slots) {
        const clone = slot.cloneNode.bind(slot);
        slot.cloneNode = deep => { clones++; return clone(deep); };
    }
    const bootstrap = await e.qualify();
    assert.equal(Object.isFrozen(bootstrap), true);
    assert.deepEqual(Object.keys(bootstrap).sort(), ['elapsedMs', 'firstVideoId', 'source', 'totalCount']);
    assert.equal(bootstrap.firstVideoId, '1');
    assert.equal(bootstrap.totalCount, 3);
    assert.equal(clones, 0);
    const result = await e.capture(bootstrap);
    assert.equal(result.reason, null);
    assert.deepEqual(result.items.map(item => item.videoId), ['1', '2', '3']);
    assert.deepEqual(result.items.map(item => item.snapshot.getAttribute('native-variant')), ['0', '1', '2']);
    assert.equal(clones, 3);
    assert.deepEqual(e.directions, []);
    assert.equal(e.carousel.diagnostics().collectionOperations, 0);
    assert.equal(e.scheduler.frames.size, 0);
});

test('mounted proof rejects forgery, recycling and replacement before capturing material', async () => {
    for (const scenario of ['copy', 'binding', 'membership', 'index', 'count', 'columns', 'discovered-track']) {
        const e = mountedEnvironment();
        let bootstrap = await e.qualify();
        if (scenario === 'copy') bootstrap = { ...bootstrap };
        if (scenario === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
        if (scenario === 'membership') e.slots[2].querySelector('a').href = 'https://www.netflix.com/title/99';
        if (scenario === 'index') e.slots[2].__reactFiber$mounted.memoizedProps.itemIndex = 0;
        if (scenario === 'count') e.slots[2].__reactFiber$mounted.memoizedProps.totalCount = 4;
        if (scenario === 'discovered-track') e.pageDom.findTrack = () => new Element('div');
        for (const slot of e.slots) slot.cloneNode = () => { throw new Error('rejected proof must not clone'); };
        const result = await e.carousel.collect({ ...e.options, mode: 'mounted-single-page', bootstrap,
            totalCount: 3, columns: scenario === 'columns' ? 2 : 3 });
        assert.equal(result.items, null, scenario);
        assert.ok(result.reason, scenario);
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
    }
});

test('replacement closes mounted qualification frames and a late callback cannot complete the new proof', async () => {
    const e = mountedEnvironment();
    const pending = e.carousel.mountedBootstrap(e.options);
    const rejected = assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
    const oldFrame = [...e.scheduler.frames.values()][0];
    e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
    const replacement = e.carousel.mountedBootstrap(e.options);
    let completed = false;
    replacement.then(() => { completed = true; });
    oldFrame();
    await e.scheduler.flush();
    await rejected;
    assert.equal(completed, false);
    assert.equal(e.scheduler.frames.size, 1);
    assert.equal((await e.settle(replacement)).totalCount, 3);
    assert.equal(e.scheduler.frames.size, 0);
    assert.equal(e.carousel.diagnostics().collectionOperations, 0);
});

test('mounted capture releases unpublished snapshots after clone failure or binding replacement', async () => {
    for (const scenario of ['clone-failure', 'replacement']) {
        const captured = [];
        const markup = createCardMarkup({ location: { href: 'https://www.netflix.com/browse/my-list' } });
        const e = mountedEnvironment({ cardMarkup: { capture(...args) {
            const item = markup.capture(...args); captured.push(item); return item;
        } } });
        const bootstrap = await e.qualify();
        const clone = e.slots[1].cloneNode.bind(e.slots[1]);
        e.slots[1].cloneNode = deep => {
            if (scenario === 'clone-failure') throw new Error('clone failed');
            e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
            return clone(deep);
        };
        assert.throws(() => e.capture(bootstrap), scenario === 'clone-failure'
            ? /clone failed/ : { code: 'NATIVE_SOURCE_REPLACED' });
        assert.ok(captured.every(item => item.snapshot === null));
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
    }
});

test('mounted qualification rejects incomplete and unstable windows and stops at route cancellation', async () => {
    for (const scenario of ['duplicate', 'partial', 'disconnected', 'changed', 'route']) {
        const e = mountedEnvironment();
        if (scenario === 'duplicate') e.slots[2].querySelector('a').href = e.slots[0].querySelector('a').href;
        if (scenario === 'partial') for (const slot of e.slots) slot.__reactFiber$mounted.memoizedProps.totalCount = 4;
        if (scenario === 'disconnected') e.track.remove();
        const pending = e.carousel.mountedBootstrap(e.options);
        const expected = scenario === 'route' ? assert.rejects(pending, { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' }) : pending;
        await e.scheduler.frame();
        if (scenario === 'changed') e.slots[2].querySelector('a').href = 'https://www.netflix.com/title/99';
        if (scenario === 'route') e.scope.dispose();
        await e.scheduler.frame();
        if (scenario === 'route') await expected;
        else assert.equal(await e.settle(expected), null, scenario);
        assert.equal(e.scheduler.frames.size, 0);
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
        assert.deepEqual(e.directions, []);
    }
});

test('page-zero anchoring confirms the native first title and repairs a shifted indicator window', async () => {
    const current = navigationEnvironment({ mode: 'indicator' });
    const options = e => ({ section: e.section, scroller: e.scroller, track: e.track,
        firstVideoId: '1', columns: 1, sessionToken: e.scope.token });
    assert.equal(await current.carousel.anchorPageZero(options(current)), true);
    assert.deepEqual(current.directions, []);
    current.setPage(2);
    assert.equal(await current.settle(current.carousel.anchorPageZero(options(current))), true);
    assert.equal(current.page(), 0);
    const moves = [];
    const shifted = navigationEnvironment({ mode: 'indicator', overrides: { log(message, facts) {
        if (message === 'carouselMoveStarted') moves.push(facts);
    } }, onClick({ direction, page, setPage, e }) {
        const next = (page + direction + 3) % 3;
        setPage(next);
        if (direction === -1 && next === 0) e.pageDom.filledSlots()[0].querySelector('a').href = 'https://www.netflix.com/title/1';
    } });
    shifted.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
    assert.equal(await shifted.settle(shifted.carousel.anchorPageZero(options(shifted))), true);
    assert.deepEqual(shifted.directions, [1, -1]);
    assert.deepEqual(moves.map(move => move.sharedFastMode), [false, false]);
    assert.equal(shifted.section.classList.contains(FAST_MOVE_CLASS), false);
    assert.equal(shifted.page(), 0);
    assert.equal(shifted.carousel.diagnostics().navigation.pendingWaits, 0);
    assert.equal(shifted.carousel.diagnostics().collectionOperations, 0);
});

test('page-zero anchoring rejects unresolved first-title mismatch and obsolete native work', async () => {
    for (const scenario of ['mismatch', 'replacement', 'route']) {
        const e = navigationEnvironment({ mode: 'indicator', onClick({ direction, page, setPage, e }) {
            setPage((page + direction + 3) % 3);
            if (scenario === 'replacement') { e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track); }
            if (scenario === 'route') e.scope.dispose();
        } });
        e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
        const pending = e.carousel.anchorPageZero({ section: e.section, scroller: e.scroller, track: e.track,
            firstVideoId: '1', columns: 1, sessionToken: e.scope.token });
        const rejected = assert.rejects(pending, { code: scenario === 'mismatch' ? 'NATIVE_PAGE_ZERO_ANCHOR_MISMATCH'
            : scenario === 'replacement' ? 'NATIVE_SOURCE_REPLACED' : 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
        await e.settle(rejected, 150);
        assert.equal(e.carousel.diagnostics().navigation.pendingWaits, 0);
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
        assert.equal(e.scheduler.frames.size, 0);
        assert.equal(e.scheduler.timers.size, 0);
        if (scenario !== 'mismatch') assert.equal(e.directions.length, 1);
    }
});

test('page-zero anchoring cannot confirm or start recovery after a diagnostic replaces its source', async () => {
    for (const shifted of [false, true]) {
        let e;
        e = navigationEnvironment({ mode: 'indicator', overrides: { log(message) {
            if (message.startsWith('Fresh Netflix My List page-0 anchor')) {
                e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
            }
        } } });
        if (shifted) e.pages[0][0].querySelector('a').href = 'https://www.netflix.com/title/99';
        await assert.rejects(e.carousel.anchorPageZero({ section: e.section, scroller: e.scroller, track: e.track,
            firstVideoId: '1', columns: 1, sessionToken: e.scope.token }), { code: 'NATIVE_SOURCE_REPLACED' });
        assert.deepEqual(e.directions, []);
    }
});

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

function traversalEnvironment({ mode = 'logical', totalCount = 4, onClick = null, overrides = {} } = {}) {
    const e = navigationEnvironment({ mode, count: 2, onClick, overrides });
    const windows = [[0, 1, 2], [1, 2, 3]].map((indices, page) => indices.map((index, position) => {
        const slot = new Element('div');
        slot.classList.add('slot');
        slot.setAttribute('native-variant', 'page-' + page + '-title-' + (index + 1));
        slot.getBoundingClientRect = () => ({ left: position * 100, width: 100, right: (position + 1) * 100 });
        slot.__reactFiber$test = { memoizedProps: { itemIndex: index, totalCount } };
        const card = slot.appendChild(new Element('a'));
        card.href = 'https://www.netflix.com/title/' + (index + 1);
        card.setAttribute('data-uia', 'standard-card'); card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Title ' + (index + 1));
        return slot;
    }));
    e.scroller.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 });
    e.pageDom.filledSlots = () => windows[e.page()];
    e.pageDom.directSlots = () => windows[e.page()];
    e.track.style.setProperty('transition', 'original-transition');
    e.track.style.setProperty('animation', 'original-animation');
    return { ...e, windows, collect(options = {}) {
        return e.carousel.collect({ section: e.section, scroller: e.scroller, track: e.track,
            totalCount, columns: 3, sessionToken: e.scope.token, ...options });
    } };
}

test('native traversal commands collect overlapping windows in both modes and restore the starting page', async () => {
    for (const mode of ['logical', 'indicator']) {
        const e = traversalEnvironment({ mode });
        const progress = [];
        const result = await e.settle(e.collect({ onProgress: facts => progress.push(facts) }));
        assert.equal(result.complete, true);
        assert.equal(result.initialPage, 0); assert.equal(e.page(), 0);
        assert.deepEqual(result.items.map(item => item.videoId), ['1', '2', '3', '4']);
        assert.deepEqual(result.items.map(item => item.page), [0, 0, 0, 1]);
        assert.equal(result.items[1].snapshot.getAttribute('native-variant'), 'page-0-title-2');
        assert.equal(result.items[3].snapshot.getAttribute('native-variant'), 'page-1-title-4');
        assert.deepEqual(progress.filter(facts => facts.collectedCount !== undefined).map(facts => facts.collectedCount), [3, 4]);
        const work = e.carousel.diagnostics().collection;
        assert.deepEqual(work, { metadataReads: 6, snapshotsCaptured: 4, duplicateSnapshotsAvoided: 2,
            invalidMetadata: 0, consistencyFailures: 0 });
        work.metadataReads = 999;
        assert.equal(e.carousel.diagnostics().collection.metadataReads, 6);
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.track.style.getPropertyValue('animation'), 'original-animation');
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
        assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
    }
});

test('native traversal cancellation releases captured material and cannot return a successful partial collection', async () => {
    for (const mode of ['logical', 'indicator']) {
        const captured = [];
        const markup = createCardMarkup({ location: { href: 'https://www.netflix.com/browse/my-list' } });
        const e = traversalEnvironment({ mode, overrides: { cardMarkup: { capture(...args) {
            const item = markup.capture(...args); captured.push(item); return item;
        } } }, onClick({ setPage, e }) {
            setPage(1); e.scope.dispose(); e.carousel.clearBinding();
        } });
        const rejected = assert.rejects(e.collect(), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
        await e.settle(rejected);
        assert.equal(captured.length, 3);
        assert(captured.every(item => item.snapshot === null));
        assert.equal(e.directions.length, 1);
        assert.equal(e.scheduler.frames.size, 0); assert.equal(e.scheduler.timers.size, 0);
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
    }
});

test('collection progress cannot admit old native work or restore over a replacement style lease', async () => {
    const e = traversalEnvironment();
    let replacement;
    const pending = e.collect({ onProgress(facts) {
        if (facts.collectedCount !== 3) return;
        e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
        replacement = e.carousel.suppressMotion(e.section, e.track);
    } });
    await e.settle(assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' }));
    assert.equal(e.directions.length, 0);
    assert.equal(e.track.style.getPropertyValue('transition'), 'none');
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 1);
    replacement.release();
    assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
    assert.equal(e.carousel.diagnostics().collectionOperations, 0);
});

test('incomplete indicator traversal returns an explicit unsuccessful result', async () => {
    const e = traversalEnvironment({ mode: 'indicator', totalCount: 5 });
    const result = await e.settle(e.collect(), 300);
    assert.equal(result.complete, false);
    assert.equal(result.items.length, 3);
    assert.equal(e.carousel.diagnostics().collectionOperations, 0);
    assert.equal(e.carousel.diagnostics().navigation.motionLeases, 0);
});

test('native capture failure releases earlier snapshots and traversal resources in both modes', async () => {
    for (const mode of ['logical', 'indicator']) {
        const captured = [];
        const markup = createCardMarkup({ location: { href: 'https://www.netflix.com/browse/my-list' } });
        const e = traversalEnvironment({ mode, overrides: { cardMarkup: { capture(...args) {
            const item = markup.capture(...args); captured.push(item);
            if (captured.length === 3) throw new Error('capture failed');
            return item;
        } } } });
        await e.settle(assert.rejects(e.collect(), /capture failed/));
        assert(captured.every(item => item.snapshot === null));
        assert.equal(e.directions.length, 0);
        assert.equal(e.carousel.diagnostics().collectionOperations, 0);
        assert.equal(e.carousel.diagnostics().collection.snapshotsCaptured, 2);
        assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
        assert.equal(e.track.style.getPropertyValue('animation'), 'original-animation');
        assert.deepEqual(e.carousel.diagnostics().navigation, { pendingMoves: 0, pendingWaits: 0, motionLeases: 0 });
    }
});

test('source replacement closes collection paint waits and rejects their obsolete callback', async () => {
    const captured = [];
    const markup = createCardMarkup({ location: { href: 'https://www.netflix.com/browse/my-list' } });
    const e = traversalEnvironment({ mode: 'indicator', overrides: { cardMarkup: { capture(...args) {
        const item = markup.capture(...args); captured.push(item); return item;
    } } } });
    const pending = e.collect();
    for (let attempt = 0; attempt < 60; attempt++) {
        await e.scheduler.flush();
        if (e.directions.length === 2 && e.carousel.diagnostics().navigation.pendingWaits === 0 && e.scheduler.frames.size === 1) break;
        await e.scheduler.frame(); await e.scheduler.advance(0);
    }
    assert.equal(e.directions.length, 2);
    assert.equal(e.carousel.diagnostics().navigation.pendingWaits, 0);
    assert.equal(e.scheduler.frames.size, 1);
    const obsoleteFrame = [...e.scheduler.frames.values()][0];
    const rejected = assert.rejects(pending, { code: 'NATIVE_SOURCE_REPLACED' });
    e.carousel.clearBinding(); e.carousel.bind(e.section, e.scroller, e.track);
    const replacement = e.carousel.suppressMotion(e.section, e.track);
    obsoleteFrame(100);
    await e.scheduler.flush(); await rejected;
    assert(captured.every(item => item.snapshot === null));
    assert.equal(e.scheduler.frames.size, 0);
    assert.equal(e.carousel.diagnostics().collectionOperations, 0);
    assert.equal(e.track.style.getPropertyValue('transition'), 'none');
    replacement.release();
    assert.equal(e.track.style.getPropertyValue('transition'), 'original-transition');
});

test('collection diagnostics belong to the current route scope and retain copied history', async () => {
    const e = traversalEnvironment();
    await e.settle(e.collect());
    const previous = e.carousel.diagnostics().collection;
    assert.equal(previous.metadataReads, 6);
    e.scope.begin();
    assert.deepEqual(e.carousel.diagnostics().collection, { metadataReads: 0, snapshotsCaptured: 0,
        duplicateSnapshotsAvoided: 0, invalidMetadata: 0, consistencyFailures: 0 });
    e.carousel.bind(e.section, e.scroller, e.track);
    await e.settle(e.collect());
    assert.equal(e.carousel.diagnostics().collection.metadataReads, 6);
    assert.equal(previous.metadataReads, 6);
});
