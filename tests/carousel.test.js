import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarousel } from '../src/netflix/carousel/carousel.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createCardMarkup } from '../src/netflix/card-markup.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { FAST_MOVE_CLASS } from '../src/dom-names.js';
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
