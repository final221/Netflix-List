import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePopup } from '../src/netflix/native-popup.js';
import { createGrid } from '../src/grid/grid.js';
import { createCarousel } from '../src/netflix/carousel/carousel.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from '../src/netflix/page-dom.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { createDocument, Element } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function environment(overrides = {}) {
    const document = createDocument(), scheduler = createScheduler();
    const section = document.body.appendChild(new Element('section'));
    const status = section.appendChild(new Element());
    const scroller = section.appendChild(new Element()), track = scroller.appendChild(new Element());
    const slot = track.appendChild(new Element()), nativeCard = slot.appendChild(new Element('a'));
    nativeCard.href = 'https://www.netflix.com/browse?jbv=1'; nativeCard.setAttribute('href', nativeCard.href);
    nativeCard.__reactProps$test = { onMouseEnter() {} };
    nativeCard.__reactFiber$test = { stateNode: nativeCard, return: { stateNode: slot } };
    const neighbor = track.appendChild(new Element()), neighborCard = neighbor.appendChild(new Element('a'));
    neighborCard.href = 'https://www.netflix.com/browse?jbv=2'; neighborCard.setAttribute('href', neighborCard.href);
    const control = scroller.appendChild(new Element('button')); control.setAttribute('data-uia', 'carousel-right-button');
    const indicator = scroller.appendChild(new Element()); indicator.setAttribute('data-uia', 'carousel-page-indicator-item');
    indicator.setAttribute('data-indicator-selected', 'true');
    const location = { href: 'https://www.netflix.com/browse/my-list', origin: 'https://www.netflix.com' };
    const pageDom = { ...createNetflixPageDom({ document, Element, location }),
        selectors: { ...NETFLIX_DOM_SELECTORS, standardCard: 'a' }, filledSlots: () => [slot, neighbor], directSlots: () => [slot, neighbor], findTrack: () => track };
    const scope = createSessionScope({ isTargetPage: () => true, AbortController, ...scheduler }); scope.begin();
    const carousel = createCarousel({ scope, pageDom, document, Element, window: { innerWidth: 1200 },
        getComputedStyle: () => ({}), ...scheduler, readListShape: () => ({ totalCount: 2, columns: 2 }),
        createError: (code, stage, message) => Object.assign(new Error(message), { code, stage }), log() {}, warn() {}, tLog: key => key });
    carousel.bind(section, scroller, track);
    let popup; let token = 1, active = null;
    const grid = createGrid({ document, location, runChunks: async (count, visit) => { for (let i = 0; i < count; i++) visit(i); },
        onRetire: (handle, detail) => { popup?.retire(handle); overrides.onRetire?.(handle, detail); } });
    const item = { videoId: '1', href: nativeCard.href, ariaLabel: 'One', snapshot: slot.cloneNode(true) };
    const other = { videoId: '2', href: neighborCard.href, ariaLabel: 'Two', snapshot: neighbor.cloneNode(true) };
    await grid.publish({ items: [item, other], section, status, anchor: scroller, geometry: { left: 0, width: 600, columns: 2 }, layout: { gap: 8, rowGap: 10 }, assertCurrent() {} });
    const diagnostics = Object.fromEntries(['hoverLifecycle','hoverTiming','hoverInteraction','hoverPreview','nativeRecovery'].map(key => [key, new Proxy({}, {get:(object,name)=>object[name]??0})]));
    const events = []; nativeCard.dispatchEvent = event => { events.push(event.type); overrides.dispatch?.(event); };
    class NativeEvent { constructor(type, facts) { this.type = type; Object.assign(this, facts); } }
    const source = () => carousel.mountedCard({ section, scroller, track, item, sessionToken: scope.token });
    popup = createNativePopup({ Element, Node: Element, document, PointerEvent: NativeEvent, MouseEvent: NativeEvent, ...scheduler,
        carousel, grid, pageDom, selectors: pageDom.selectors,
        readIntent: () => ({ token, sessionToken: scope.token, clone: active, videoId: '1', pointerX: 20, pointerY: 30 }),
        readEnvironment: () => ({ grid: grid.root, scroller }), readDiagnostics: () => diagnostics,
        isCancelled: value => value !== token, isSessionCurrent: value => scope.isCurrent(value),
        isTargetCurrent: clone => clone === active && clone.isConnected, gridOwnsClone: clone => clone === grid.getCard(item)?.node,
        gridCloneFromPointerEvent: event => grid.root.contains(event.target) ? grid.getCard(item)?.node : null,
        itemForSource: () => item, activeSource: () => source()?.slot, associateGridHoverItem() {},
        log() {}, warn() {}, trace() {}, tLog: key => key, onFailed: () => popup.release(),
        onPreviewRelease: (clone, reason, target, release) => { token++; release(); active = null; }, ...overrides.popup });
    const prepare = () => { const result = popup.prepare({ source: source(), card: grid.getCard(item), item, page: 0, token, sessionToken: scope.token }); active = result.fresh; return result; };
    const open = () => { active = grid.getCard(item).node; return popup.open({ source: source(), card: grid.getCard(item), item, page: 0, token, sessionToken: scope.token }); };
    return { document, scheduler, scope, carousel, grid, popup, source, slot, nativeCard, neighbor, item, other, events, diagnostics, prepare, open,
        setToken: value => { token = value; }, setActive: node => { active = node; } };
}

test('native popup owns replay resources and settles a retired pending open', async () => {
    const frames = new Map(); let sequence = 0;
    const popup = createNativePopup({ requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: key => frames.delete(key), readIntent: () => ({ token: 1, sessionToken: 1 }),
        performance: { now: () => 0 }, readDiagnostics: () => ({}) });
    const pending = popup.open({ source: {}, card: {}, item: { videoId: '1' }, token: 1, sessionToken: 1 });
    assert.equal(frames.size, 1);
    popup.release('route-leave');
    assert.equal(await pending, false);
    assert.equal(frames.size, 0);
    assert.equal(popup.diagnostics().pendingReplays, 0);
});

test('native preparation uses real grid acceptance and replaces only its admitted card', async () => {
    const e = await environment(), old = e.grid.getCard(e.item), neighbor = e.grid.getCard(e.other);
    const result = e.prepare();
    assert.equal(e.grid.isCardCurrent(old), false); e.grid.assertCard(result.handle);
    assert.equal(e.grid.getCard(e.other), neighbor);
    assert.equal(result.fresh.querySelector('a').__reactFiber$test.stateNode, result.fresh.querySelector('a'));
    assert.equal(result.fresh.querySelector('a').__reactProps$test, e.nativeCard.__reactProps$test);
    assert.equal(e.popup.diagnostics().grafts, 1);
    const pending = e.open(); await e.scheduler.frame(); assert.equal(await pending, true);
    assert.deepEqual(e.events, ['pointerover','pointermove','mouseover','mousemove']);
    e.popup.release('scroll'); assert.equal(e.scheduler.timers.size, 0);
    assert.deepEqual(e.events.slice(-2), ['pointerout','mouseout']);
    e.popup.invalidate(); assert.equal(e.popup.diagnostics().grafts, 0);
});

test('obsolete source, recycled title and replaced card cannot replay from an earlier handle', async () => {
    for (const change of ['binding','identity','card']) {
        const e = await environment(); const pending = e.open();
        if (change === 'binding') { e.carousel.clearBinding(); e.carousel.bind(e.slot.parentElement.parentElement.parentElement, e.slot.parentElement.parentElement, e.slot.parentElement); }
        if (change === 'identity') e.nativeCard.href = 'https://www.netflix.com/browse?jbv=9';
        if (change === 'card') e.grid.replaceCard(e.grid.getCard(e.item), { node: e.slot.cloneNode(true) });
        await e.scheduler.frame(); assert.equal(await pending, false, change); assert.deepEqual(e.events, []);
    }
});

test('release retires an exact geometry lease before native exit establishes a newer one', async () => {
    let e, nested = false, newer;
    e = await environment({ dispatch(event) { if (event.type === 'pointerout' && !nested) { nested = true; newer = e.open(); void e.scheduler.frame(); } } });
    e.prepare(); const first = e.open(); await e.scheduler.frame(); assert.equal(await first, true);
    const descriptor = Object.getOwnPropertyDescriptor(e.slot, 'getBoundingClientRect');
    e.popup.release('replaced'); await e.scheduler.frame(); assert.equal(await newer, true);
    assert.equal(e.popup.diagnostics().geometryOwned, true);
    assert.notEqual(Object.getOwnPropertyDescriptor(e.slot, 'getBoundingClientRect').value, descriptor.value);
    e.popup.release(); assert.equal(Object.hasOwn(e.slot, 'getBoundingClientRect'), false);
});

test('native graft retirement preserves React metadata subsequently owned by another integration', async () => {
    const e = await environment(), { handle } = e.prepare(); const card = handle.node.querySelector('a');
    const newer = { owner: 'new' }; card.__reactProps$test = newer;
    e.popup.retire(handle); assert.equal(card.__reactProps$test, newer);
    assert.equal(card.__reactFiber$test, undefined); assert.equal(e.popup.diagnostics().grafts, 0);
});

test('unaccepted native replacement releases detached graft material', async () => {
    const e = await environment(); const original = e.grid.getCard(e.item); let calls = 0;
    assert.throws(() => e.popup.prepare({ source: e.source(), card: original, item: e.item, page: 0,
        assertCurrent() { if (++calls === 4) throw new Error('retired caller'); } }));
    assert.equal(e.grid.getCard(e.item), original);
    assert.equal(e.popup.diagnostics().grafts, 0);
});

test('a reentrant newer open with the same intent retires the earlier replay', async () => {
    let e, newer, nested = false;
    e = await environment({ dispatch(event) { if (event.type === 'pointerover' && !nested) { nested = true; newer = e.open(); } } });
    const first = e.open(); await e.scheduler.frame();
    assert.equal(await first, false);
    await e.scheduler.frame(); assert.equal(await newer, true);
    assert.equal(e.popup.diagnostics().replayOwned, true);
    e.popup.release();
});

test('preview transfer and boundary dismissal preserve native positioning until actual exit', async () => {
    const e = await environment(); e.prepare(); const pending = e.open(); await e.scheduler.frame(); assert.equal(await pending, true);
    const preview = e.document.body.appendChild(new Element()); preview.classList.add('previewModal--wrapper');
    const detail = preview.appendChild(new Element('a')); detail.href = e.item.href; detail.setAttribute('href', detail.href);
    const control = preview.appendChild(new Element('button')); const clone = e.grid.getCard(e.item).node;
    assert.equal(e.popup.retainPreview(clone, detail, { type: 'pointerout', isTrusted: true }), true);
    assert.equal(e.scheduler.timers.size, 0); assert.equal(e.popup.diagnostics().previewOwned, true);
    e.popup.previewPointerOut({ target: detail, relatedTarget: control, isTrusted: true });
    assert.equal(e.popup.diagnostics().previewOwned, true);
    e.popup.previewPointerOut({ target: control, relatedTarget: null, isTrusted: true });
    assert.equal(e.popup.diagnostics().previewOwned, false); assert.equal(e.popup.diagnostics().geometryOwned, false);
    assert.deepEqual(e.events.slice(-2), ['pointerout','mouseout']);
});

test('diagnostic failures cannot reject an admitted replay or strand its cleanup', async () => {
    const e = await environment({ popup: { trace() { throw new Error('trace failed'); } } });
    e.prepare(); const pending = e.open(); await e.scheduler.frame(); assert.equal(await pending, true);
    assert.equal(e.diagnostics.hoverInteraction.diagnosticFailures, 1);
    e.popup.release(); assert.equal(e.scheduler.timers.size, 0); assert.equal(e.popup.diagnostics().geometryOwned, false);
});

test('actual residual hover retirement preserves the same-attempt grid/native handoff', async () => {
    const source = readFileSync(new URL('../src/legacy.js', import.meta.url), 'utf8');
    const declaration = source.match(/    function retireHoverCard\([\s\S]*?\n    }/)[0];
    const context = vm.createContext({ hoverToken: 1, activeClone: null, pendingGridHoverClone: null,
        isRouteSessionActive: () => true, advanceHoverToken() { throw new Error('admitted attempt cancelled'); },
        cancelPendingGridHover() { throw new Error('admitted attempt cancelled'); }, clearSourceAlignment() { throw new Error('native handoff released'); } });
    vm.runInContext(declaration, context);
    const e = await environment({ onRetire: (handle, detail) => context.retireHoverCard(handle, detail) });
    context.activeClone = e.grid.getCard(e.item).node;
    const result = e.prepare(); assert.equal(context.hoverToken, 1);
    const pending = e.open(); await e.scheduler.frame(); assert.equal(await pending, true);
    e.grid.assertCard(result.handle); assert.equal(e.events.length, 4);
    e.popup.release();
});

test('grid retirement settles only that card pending replay without waiting for its frame', async () => {
    const e = await environment(); const card = e.grid.getCard(e.item), pending = e.open();
    e.grid.removeCard(card);
    assert.equal(e.scheduler.frames.size, 0);
    assert.equal(await pending, false);
    assert.deepEqual(e.events, []);
});

test('actual native-source composition uses the current scope without a removed compatibility variable', async () => {
    const e = await environment();
    const source = readFileSync(new URL('../src/legacy.js', import.meta.url), 'utf8');
    const context = vm.createContext({ sessionScope: e.scope, nativeCarousel: e.carousel,
        sourceState: { section: e.slot.parentElement.parentElement.parentElement,
            scroller: e.slot.parentElement.parentElement, track: e.slot.parentElement },
        withNativeReadScope: callback => e.carousel.sample(callback), initializationError: (code, stage, message) => Object.assign(new Error(message), { code, stage }) });
    for (const name of ['popupSource','findMountedSourceSlot']) vm.runInContext(source.match(new RegExp('    function '+name+'\\([\\s\\S]*?\\n    }'))[0], context);
    assert.equal(context.findMountedSourceSlot(context.sourceState.track, e.item, true), e.slot);
    e.carousel.assertSource(context.popupSource(e.slot, e.item));
    e.scope.begin(); e.carousel.bind(context.sourceState.section, context.sourceState.scroller, context.sourceState.track);
    assert.equal(context.findMountedSourceSlot(context.sourceState.track, e.item, true), e.slot);
    e.carousel.assertSource(context.popupSource(e.slot, e.item));
});
