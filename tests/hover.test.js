import { publishGrid } from './helpers/card-material.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePopup } from '../src/netflix/native-popup.js';
import { createGrid } from '../src/grid/grid.js';
import { createCarousel } from '../src/netflix/carousel/carousel.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from '../src/netflix/page-dom.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { createHover } from '../src/hover/hover.js';
import { createDocument, Element } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';

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
    let popup, hover; let token = 1, active = null;
    const grid = createGrid({ document, location, runChunks: async (count, visit) => { for (let i = 0; i < count; i++) visit(i); },
        onRetire: (handle, detail) => { popup?.retire(handle); hover?.retire(handle, detail); overrides.onRetire?.(handle, detail); } });
    const item = { videoId: '1', href: nativeCard.href, ariaLabel: 'One', snapshot: slot.cloneNode(true) };
    const other = { videoId: '2', href: neighborCard.href, ariaLabel: 'Two', snapshot: neighbor.cloneNode(true) };
    await publishGrid(grid, { items: [item, other], section, status, anchor: scroller, geometry: { left: 0, width: 600, columns: 2 }, layout: { gap: 8, rowGap: 10 }, assertCurrent() {} });
    const diagnostics = Object.fromEntries(['hoverLifecycle','hoverTiming','hoverInteraction','hoverPreview','nativeRecovery'].map(key => [key, new Proxy({}, {get:(object,name)=>object[name]??0})]));
    const events = []; nativeCard.dispatchEvent = event => { events.push(event.type); overrides.dispatch?.(event); };
    class NativeEvent { constructor(type, facts) { this.type = type; Object.assign(this, facts); } }
    const source = () => carousel.mountedCard({ section, scroller, track, item, sessionToken: scope.token });
    const popupOptions = { Element, Node: Element, document, PointerEvent: NativeEvent, MouseEvent: NativeEvent, ...scheduler,
        carousel, grid, pageDom, selectors: pageDom.selectors,
        readIntent: () => ({ token, sessionToken: scope.token, clone: active, videoId: '1', pointerX: 20, pointerY: 30 }),
        readEnvironment: () => ({ grid: grid.root, scroller }), readDiagnostics: () => diagnostics,
        isCancelled: value => value !== token, isSessionCurrent: value => scope.isCurrent(value),
        isTargetCurrent: clone => clone === active && clone.isConnected, gridOwnsClone: clone => clone === grid.getCard(item)?.node,
        gridCloneFromPointerEvent: event => grid.root.contains(event.target) ? grid.getCard(item)?.node : null,
        itemForSource: () => item, activeSource: () => source()?.slot, associateGridHoverItem() {},
        log() {}, warn() {}, trace() {}, tLog: key => key, onFailed: () => popup.release(),
        onPreviewRelease: (clone, reason, target, release) => { token++; release(); active = null; }, ...overrides.popup };
    if (overrides.withHover) {
        for (const record of [item, other]) grid.getCard(record).node.matches = selector => selector === ':hover';
        hover = createHover({ ...scheduler, Element, document, grid, readSessionToken: () => scope.token, isSessionCurrent: scope.isCurrent,
            readEnvironment: () => ({ grid: grid.root }), sample: callback => carousel.sample(callback), whenStable: () => null,
            sleep: delay => new Promise(resolve => scheduler.setTimeout(resolve, delay)), assertSession: token => scope.assertCurrent(token),
            isCancelledError: scope.isCancelled, log() {}, warn() {}, tLog: key => key, describeItem: value => value,
            resolveReady: (record, card) => card.node.getAttribute('data-tm-hover-ready') === 'true' ? { source: source(), card, page: 0 } : null,
            prepare: async (record, previous, event, token, sessionToken) => {
                const result = popup.prepare({ source: source(), card: previous, item: record, page: 0, token, sessionToken });
                result.fresh.matches = selector => selector === ':hover';
                assert.equal(hover.acceptReplacement(previous, result.handle, token, sessionToken), true);
                return { source: source(), card: result.handle, page: 0 };
            }, createPopup: policy => (popup = createNativePopup({ ...popupOptions, ...policy })) });
        hover.install(grid.root); hover.start();
    } else popup = createNativePopup(popupOptions);
    const prepare = () => { const result = popup.prepare({ source: source(), card: grid.getCard(item), item, page: 0, token, sessionToken: scope.token }); active = result.fresh; return result; };
    const open = () => { active = grid.getCard(item).node; return popup.open({ source: source(), card: grid.getCard(item), item, page: 0, token, sessionToken: scope.token }); };
    return { document, scheduler, scope, carousel, grid, popup, hover, source, section, status, scroller, slot, nativeCard, neighbor, item, other, events, diagnostics, prepare, open,
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

test('graft retirement visits only prepared cards in 30, 150 and 600-card registries', async () => {
    for(const size of [30,150,600]){
        const e=await environment(), records=[e.item,e.other,...Array.from({length:size-2},(_,i)=>({
            videoId:String(i+3),href:`https://www.netflix.com/browse?jbv=${i+3}`,ariaLabel:`Title ${i+3}`,
            snapshot:e.neighbor.cloneNode(true)
        }))];
        await publishGrid(e.grid, {items:records,section:e.section,status:e.status,
            anchor:e.scroller,geometry:{left:0,width:600,columns:6},layout:{gap:8,rowGap:10},assertCurrent(){}});
        const prepared=e.prepare();assert.equal(e.popup.diagnostics().grafts,1);
        for(const record of records.slice(1))e.grid.getCard(record).node.removeAttribute=()=>{throw new Error('Unprepared card visited');};
        e.popup.invalidate(prepared.fresh);assert.equal(e.popup.diagnostics().grafts,1);
        prepared.fresh.remove();e.popup.invalidate(prepared.fresh);
        assert.equal(e.popup.diagnostics().grafts,0);assert.equal(prepared.fresh.querySelector('a').__reactProps$test,undefined);
        e.popup.invalidate();assert.equal(e.popup.diagnostics().grafts,0);
    }
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

test('composed hover, real grid and native popup transfer exactly one admitted replacement', async () => {
    const e = await environment({ withHover: true }), previous = e.grid.getCard(e.item);
    e.grid.root.dispatchEvent({ type: 'pointerover', target: previous.node });
    await e.scheduler.advance(120); await e.scheduler.frame();
    const current = e.grid.getCard(e.item);
    assert.equal(e.grid.isCardCurrent(previous), false); e.grid.assertCard(current);
    assert.equal(e.hover.intent().clone, current.node); assert.equal(e.events.length, 4);
    e.grid.replaceCard(current, { node: current.node.cloneNode(true) });
    assert.equal(e.hover.intent().clone, null); assert.equal(e.popup.diagnostics().replayOwned, false);
    e.hover.dispose(); assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
});

test('grid retirement settles only that card pending replay without waiting for its frame', async () => {
    const e = await environment(); const card = e.grid.getCard(e.item), pending = e.open();
    e.grid.removeCard(card);
    assert.equal(e.scheduler.frames.size, 0);
    assert.equal(await pending, false);
    assert.deepEqual(e.events, []);
});

test('native source admission follows the current scope and rejects the retired source handle', async () => {
    const e = await environment();
    const previous=e.source(),track=e.slot.parentElement,scroller=track.parentElement,section=scroller.parentElement;
    e.carousel.assertSource(previous);assert.equal(previous.slot,e.slot);
    e.scope.begin();e.carousel.bind(section,scroller,track);
    assert.throws(()=>e.carousel.assertSource(previous),error=>error.code==='NATIVE_SOURCE_REPLACED');
    const current=e.source();e.carousel.assertSource(current);assert.equal(current.slot,e.slot);
});

test('failed native dispatch and source recycling restore geometry and stop the remaining enters/exits', async()=>{
    for(const stage of ['enter-throw','enter-recycle','exit-throw','exit-recycle']){
        const e=await environment({dispatch(event){
            if(stage==='enter-throw'&&['pointerover','mouseover'].includes(event.type))throw new Error('host dispatch failed');
            if(stage==='exit-throw'&&['pointerout','mouseout'].includes(event.type))throw new Error('host dispatch failed');
            if(event.type===(stage.startsWith('enter')?'pointerover':'pointerout')){
                if(stage.endsWith('throw'))throw new Error('host dispatch failed');
                e.nativeCard.href='https://www.netflix.com/browse?jbv=9';
            }
        }});
        const pending=e.open();await e.scheduler.frame();const opened=await pending;
        if(stage.startsWith('exit')){assert.equal(opened,true);e.popup.release('scroll');}
        else assert.equal(opened,false);
        assert.equal(e.popup.diagnostics().geometryOwned,false);assert.equal(e.popup.diagnostics().replayOwned,false);
        if(stage.endsWith('recycle'))assert.equal(e.events.includes(stage.startsWith('enter')?'mouseover':'mouseout'),false);
        const count=e.events.length;e.popup.release();assert.equal(e.events.length,count);
        assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
    }
});
test('native preview rejection excludes unrelated roots, controls, recycled identity and retired source', async()=>{
    for(const kind of ['other-title','source-recycled','binding-retired','disconnected','grid-card']){
        const e=await environment();e.prepare();const pending=e.open();await e.scheduler.frame();assert.equal(await pending,true);
        const preview=e.document.body.appendChild(new Element());preview.classList.add('previewModal--wrapper');
        const link=preview.appendChild(new Element('a'));link.href=kind==='other-title'?'https://www.netflix.com/browse?jbv=9':e.item.href;link.setAttribute('href',link.href);
        if(kind==='source-recycled')e.nativeCard.href='https://www.netflix.com/browse?jbv=9';
        if(kind==='binding-retired')e.carousel.clearBinding();
        if(kind==='disconnected')preview.remove();
        const target=kind==='grid-card'?e.grid.getCard(e.item).node:link;
        assert.equal(e.popup.retainPreview(e.grid.getCard(e.item).node,target,{type:'pointerout',isTrusted:true}),false,kind);
        assert.equal(e.popup.diagnostics().previewOwned,false);e.popup.release();
    }
});
test('preview return preserves one replay and physical departure or removal releases its exact owner', async()=>{
    for(const removed of [false,true]){
        const e=await environment();e.prepare();const pending=e.open();await e.scheduler.frame();assert.equal(await pending,true);
        const clone=e.grid.getCard(e.item).node,preview=e.document.body.appendChild(new Element());preview.classList.add('previewModal--wrapper');
        const link=preview.appendChild(new Element('a'));link.href=e.item.href;link.setAttribute('href',link.href);
        assert.equal(e.popup.retainPreview(clone,link,{type:'pointerout',isTrusted:true}),true);
        e.popup.pointerMoved({target:clone});assert.equal(e.popup.diagnostics().previewOwned,false);assert.equal(e.popup.diagnostics().geometryOwned,true);
        assert.equal(e.events.filter(type=>type==='pointerover').length,1);
        assert.equal(e.popup.retainPreview(clone,link,{type:'pointerout',isTrusted:true}),true);
        if(removed)preview.remove();e.popup.pointerMoved({target:e.document.body});
        assert.equal(e.popup.diagnostics().geometryOwned,false);assert.equal(e.scheduler.timers.size,0);
    }
});
test('preview presence probes are copy-only, delayed once, bounded to six roots and never replay',async()=>{
    const e=await environment();const pending=e.open();await e.scheduler.frame();assert.equal(await pending,true);
    assert.equal(e.scheduler.timers.size,1);assert.equal(e.diagnostics.hoverPreview.scheduled,1);
    let reads=0;
    for(let i=0;i<12;i++){
        const preview=e.document.body.appendChild(new Element());preview.classList.add('previewModal--wrapper');
        const attribute=preview.getAttribute.bind(preview);preview.getAttribute=name=>{if(['href','data-ui-tracking-context'].includes(name))reads++;return attribute(name);};
        const link=preview.appendChild(new Element('a'));link.href='https://www.netflix.com/browse?jbv=9';link.setAttribute('href',link.href);
    }
    const count=e.events.length;
    await e.scheduler.advance(900);
    assert.equal(e.events.length,count);assert.equal(e.diagnostics.hoverPreview.completed,1);
    assert.equal(e.diagnostics.hoverPreview.rootSearches,1);assert.ok(reads>0&&reads<=6*3);
    assert.equal(e.scheduler.timers.size,0);assert.ok(!JSON.stringify(e.diagnostics.hoverPreview).includes('https:'));
    e.popup.release();
});
test('retired preview probe cannot inspect a newer replay and route sampling stops after 48 replays',async()=>{
    const e=await environment();let pending=e.open();await e.scheduler.frame();await pending;
    const old=[...e.scheduler.timers.values()][0].callback;e.popup.release();
    pending=e.open();await e.scheduler.frame();await pending;
    const currentTimer=[...e.scheduler.timers.keys()][0],before=e.diagnostics.hoverPreview.checks;
    old();assert.equal(e.diagnostics.hoverPreview.checks,before);assert.ok(e.scheduler.timers.has(currentTimer));
    e.popup.release();
    for(let i=2;i<49;i++){pending=e.open();await e.scheduler.frame();assert.equal(await pending,true);e.popup.release();}
    assert.equal(e.diagnostics.hoverPreview.scheduled,48);assert.equal(e.diagnostics.hoverPreview.skippedAtLimit,1);
    assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
});
