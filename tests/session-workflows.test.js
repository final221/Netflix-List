import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionBrowser } from './helpers/session-browser.js';
import { Element } from './helpers/dom.js';
import { viewingVideo, atom, reference, carouselPayload } from './helpers/fixtures.js';

const ids = parent => parent.children.filter(node => node.getAttribute('data-tm-item-video-id') !== null).map(node => node.getAttribute('data-tm-item-video-id'));
const groupIds = e => ({ main: ids(e.grid()), watched: ids(e.grid().querySelector('[data-tm-watch-grid]')) });

test('real session remove and native Undo preserve title order, counts and exact card ownership', async () => {
    const e = sessionBrowser(); await e.start();
    const old = e.grid().querySelector('[data-tm-item-video-id="3"]');
    e.click('3'); e.setIds(['1','2','4','5','6']); await e.scheduler.flush();
    await e.drain(() => !e.cardIds().includes('3'));
    assert.deepEqual(e.cardIds(), ['1','2','4','5','6']); assert.equal(old.isConnected, false);
    assert.equal(e.grid().querySelector('[data-tm-filter-value="all"]').querySelector('[data-tm-type-count]').textContent, '5');
    e.click('3'); e.setIds(['1','2','3','4','5','6']); await e.scheduler.flush();
    await e.drain(() => e.cardIds().includes('3'));
    assert.deepEqual(e.cardIds(), ['1','2','3','4','5','6']);
    assert.notEqual(e.grid().querySelector('[data-tm-item-video-id="3"]'), old);
    assert.equal(e.grid().querySelector('[data-tm-filter-value="all"]').querySelector('[data-tm-type-count]').textContent, '6');
    e.dispose();
});

test('real session hover prepares and replays the exact mounted title then releases on departure', async () => {
    const e = sessionBrowser(); await e.start();
    e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({ type:'click' });
    const old = e.over('2');
    await e.drain(() => e.events.some(event => event.id === '2' && event.type === 'mouseover'));
    assert.ok(e.events.every(event => event.id === '2'));
    const fresh = e.grid().querySelector('[data-tm-item-video-id="2"]');
    assert.notEqual(fresh, old); assert.equal(old.isConnected, false);
    e.leavePointer(fresh); await e.scheduler.flush();
    assert.ok(e.events.some(event => event.type === 'mouseout'));
    assert.deepEqual(e.cardIds(), ['1','2','3','4','5','6']); e.dispose();
});

test('real session last removal adopts delayed native empty content and repopulates on first addition', async () => {
    const e = sessionBrowser({ count:1 }); await e.start();
    const root = e.grid(); e.click('1'); await e.scheduler.flush();
    await e.drain(() => e.cardIds().length === 0);
    assert.equal(root.getAttribute('data-tm-empty'), 'true');
    // Native can retain its last card before replacing the carousel with an empty row.
    assert.equal(e.source.track.querySelectorAll('[data-uia="standard-card"]').length, 1);
    const empty = new Element('div'); empty.setAttribute('data-uia', 'empty-carousel-section+content');
    const message = empty.appendChild(new Element('p')); message.setAttribute('data-uia', 'empty-carousel-section+message'); message.textContent = 'Native empty list';
    e.setIds([]); e.source.scroller.remove(); e.source.section.appendChild(empty); e.deliver(e.source.section);
    await e.drain(() => e.logs.some(row => row.includes('Native empty My List section adopted')));
    assert.equal(e.grid(),root); assert.deepEqual(e.cardIds(),[]);
    assert.ok(e.document.querySelector('[data-uia="empty-carousel-section+message"]'));
    e.setIds(['1','2']); e.replaceSource();
    await e.drain(() => e.cardIds().length === 2 && e.app.diagnostics().currentSession.completed);
    assert.deepEqual(e.cardIds(),['1','2']);
    assert.equal(e.grid().getAttribute('data-tm-empty'),null); e.dispose();
});

test('real session pending addition waits for native material and does not publish partial membership', async () => {
    const e = sessionBrowser(); await e.start();
    e.click('7'); await e.scheduler.flush();
    assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);
    e.setIds(['7','1','2','3','4','5','6']);
    await e.drain(() => e.cardIds().includes('7'));
    assert.deepEqual(e.cardIds(),['7','1','2','3','4','5','6']);
    e.dispose();
});

test('real session native hover moves to an off-page title and preserves accepted list order', async () => {
    const e = sessionBrowser({ count:12 }); await e.start();
    e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});
    const old=e.over('9');
    await e.drain(() => e.events.some(event => event.id === '9' && event.type === 'mouseover'));
    assert.ok(e.moves.includes('right')); assert.ok(e.events.every(event=>event.id==='9'));
    assert.notEqual(e.grid().querySelector('[data-tm-item-video-id="9"]'),old);
    assert.deepEqual(e.cardIds(),Array.from({length:12},(_,i)=>String(i+1)));
    e.dispose();
});

for (const cancellation of ['leave','scroll','route']) {
    test(`real session ${cancellation} cancels pending hover before native replay`,async()=>{
        const e=sessionBrowser({count:12});await e.start();
        e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});
        const node=e.over('9');await e.scheduler.advance(120);
        if(cancellation==='leave')e.leavePointer(node);
        if(cancellation==='scroll')e.document.dispatchEvent({type:'scroll'});
        if(cancellation==='route')await e.navigate('/browse');
        for(let i=0;i<80;i++){await e.scheduler.advance(25);await e.scheduler.frame();}
        assert.deepEqual(e.events,[]);
        if(cancellation!=='route')assert.equal(e.grid().querySelector('[data-tm-item-video-id="9"]').getAttribute('data-tm-preparing'),null);
        e.dispose();
    });
}

test('real session viewport change remaps current cards and releases refresh ownership',async()=>{
    const e=sessionBrowser({count:12});await e.start();
    const root=e.grid();const cards=root.querySelectorAll('[data-tm-item-video-id]');
    e.resize(3,300);
    await e.drain(()=>root.style.getPropertyValue('--tm-cols')==='3'&&e.logs.some(row=>row.includes('Responsive refresh completed')));
    assert.equal(root.style.getPropertyValue('--tm-grid-width'),'300px');
    assert.deepEqual(cards.map(n=>n.getAttribute('data-tm-item-page')),['0','0','0','1','1','1','2','2','2','3','3','3']);
    assert.deepEqual(e.cardIds(),Array.from({length:12},(_,i)=>String(i+1)));
    assert.ok(cards.every(n=>n.isConnected));e.dispose();
});

test('real session empty startup remains truthful and accepts a later populated source',async()=>{
    const e=sessionBrowser({count:0});await e.start();
    assert.deepEqual(e.cardIds(),[]);assert.equal(e.grid().getAttribute('data-tm-empty'),'true');
    e.setIds(['1','2']);e.replaceSource();
    await e.drain(()=>e.cardIds().length===2&&e.app.diagnostics().currentSession.completed);
    assert.deepEqual(e.cardIds(),['1','2']);e.dispose();
});

test('real session initialization defers a native click until accepted membership and grid publication', async () => {
    const e = sessionBrowser({ count: 12 }); const log = e.context.console.log; let queued = false;
    e.context.console.log = (...args) => {
        log(...args);
        if (!queued && args[1] === 'Collection page stabilized') {
            queued = true; e.click('3');
            assert.equal(e.app.diagnostics().currentSession.running, true);
            assert.deepEqual(e.cardIds(), [], 'no partial grid is exposed during collection');
        }
    };
    await e.start(); await e.drain(() => !e.cardIds().includes('3'));
    assert.equal(queued, true);
    assert.deepEqual(e.cardIds(), ['1','2','4','5','6','7','8','9','10','11','12']); e.dispose();
});

test('real session responsive transaction defers membership then releases its exact pending action',async()=>{
    const e=sessionBrowser({count:12});await e.start();
    e.resize(3,300);await e.scheduler.advance(140);
    assert.ok(e.logs.some(row=>row.includes('Responsive refresh started')));
    e.click('3');await e.scheduler.flush();assert.ok(e.cardIds().includes('3'));
    await e.drain(()=>!e.cardIds().includes('3'));
    assert.deepEqual(e.cardIds(),['1','2','4','5','6','7','8','9','10','11','12']);
    assert.ok(e.logs.some(row=>row.includes('Responsive refresh completed')));e.dispose();
});

test('real session same-section track replacement adopts current source and preserves visibility and cards',async()=>{
    const e=sessionBrowser();await e.start();const root=e.grid();const cards=root.querySelectorAll('[data-tm-item-video-id]');
    [...e.menus.values()][0].callback();
    const old=e.replaceTrack();
    await e.drain(()=>e.logs.some(row=>row.includes('Native My List source adopted without rescan')));
    assert.equal(old.isConnected,false);assert.equal(e.grid(),root);assert.ok(cards.every(node=>node.isConnected));
    assert.equal(e.source.section.getAttribute('data-tm-original-mylist-visible'),'false');
    [...e.menus.values()][0].callback();assert.equal(e.source.section.getAttribute('data-tm-original-mylist-visible'),'true');e.dispose();
});

test('real session logical responsive remapping includes wrapped-tail indices and current card pages',async()=>{
    const e=sessionBrowser({count:13,logical:true});await e.start();e.setPage(2);
    e.resize(4,400);
    await e.drain(()=>e.grid().style.getPropertyValue('--tm-cols')==='4'&&e.logs.some(row=>row.includes('Responsive refresh completed')));
    assert.deepEqual(e.cardIds(),Array.from({length:13},(_,i)=>String(i+1)));
    assert.deepEqual(e.grid().querySelectorAll('[data-tm-item-video-id]').map(node=>node.getAttribute('data-tm-item-page')),['0','0','0','0','1','1','1','1','2','2','2','2','3']);e.dispose();
});

for(const recover of [true,false]){
    test(`real session blocked initialization ${recover?'recovers once from':'exhausts recovery after'} a replacement source`,async()=>{
        const e=sessionBrowser({count:12});e.source.track.querySelectorAll('a').forEach(node=>node.remove());
        e.app.start();await e.drain(()=>e.app.diagnostics().currentSession.blocked,240);
        const failure = e.logs.find(row => row[1] === 'Initialization failed')[2];
        assert.equal(failure.code, 'INITIALIZATION_TIMEOUT');
        assert.equal(failure.stage, 'native-carousel-readiness');
        assert.equal(failure.timeoutMs, 3000);
        assert.equal(Object.hasOwn(failure, 'details'), false, 'readiness report retains its field contract');
        assert.deepEqual(e.cardIds(),[]);e.deliver();await e.scheduler.flush();
        assert.equal(e.logs.filter(row=>row.includes('Retrying initialization with a verified native-source replacement')).length,0,'unchanged blocked source cannot retry');
        e.replaceSource();
        if(!recover)e.source.track.querySelectorAll('a').forEach(node=>node.remove());
        if(recover){await e.drain(()=>e.app.diagnostics().currentSession.completed);assert.equal(e.cardIds().length,12);}
        else{
            await e.drain(()=>e.app.diagnostics().currentSession.blocked,240);e.replaceSource();
            await e.drain(()=>e.logs.some(row=>row.includes('Native initialization replacement recovery exhausted')));
            assert.equal(e.app.diagnostics().currentSession.blocked,true);assert.deepEqual(e.cardIds(),[]);
        }
        assert.equal(e.logs.filter(row=>row.includes('Retrying initialization with a verified native-source replacement')).length,1);e.dispose();
    });
}

test('real session wrong native order prompts reinitialization and replaces the old grid from page zero',async()=>{
    const e=sessionBrowser({count:18,logical:true});await e.start();const old=e.grid();
    e.setIds(['18',...Array.from({length:17},(_,i)=>String(i+1))]);
    e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});e.over('18');
    await e.drain(()=>Boolean(e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog')),1200);
    assert.deepEqual(e.events,[],'mismatched order cannot replay the wrong native title');
    const dialog=e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog');
    dialog.querySelector('[data-tm-order-ok]').dispatchEvent({type:'click'});
    await e.drain(()=>e.grid()!==old&&e.cardIds().length===18&&e.app.diagnostics().currentSession.completed);
    assert.equal(old.isConnected,false);assert.equal(e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog'),null);
    assert.deepEqual(e.cardIds(),['18',...Array.from({length:17},(_,i)=>String(i+1))]);e.dispose();
});

function toastButton(e){
    class Toast extends Element{
        matches(selector){return selector.split(',').some(part=>{const match=part.trim().match(/^(#[\w-]+)\s+(.+)$/);return match?super.matches(match[2])&&Boolean(this.parentElement?.closest(match[1])):super.matches(part);});}
    }
    const root=e.document.body.appendChild(new Element());root.id='toastRoot';
    const toast=root.appendChild(new Toast());toast.setAttribute('role','alert');
    return toast.appendChild(new Element('button'));
}
const action=(e,id)=>{
    const node=e.grid().querySelector(`[data-tm-item-video-id="${id}"]`);
    e.grid().dispatchEvent({type:'click',target:node.querySelector('[data-tm-viewing-action]'),preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
};
const refresh=e=>e.grid().querySelector('[data-tm-watch-controls]').querySelector('button').dispatchEvent({type:'click'});
const finished=e=>e.logs.filter(row=>row.includes('Viewing status collection completed')).length;

test('real session toast Undo restores retained markup and expiry prevents borrowing a later removal',async()=>{
    const e=sessionBrowser();await e.start();
    e.click('3');e.setIds(['1','2','4','5','6']);await e.scheduler.flush();
    await e.drain(()=>!e.cardIds().includes('3'));
    const button=toastButton(e);e.document.dispatchEvent({type:'click',target:button});await e.scheduler.flush();
    await e.drain(()=>e.cardIds().includes('3'));
    assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);
    assert.equal((await e.snapshot()).performanceWork.undoRetention.consumed,1);
    e.setIds(['1','2','3','4','5','6']);await e.scheduler.frame();assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);e.click('3');e.setIds(['1','2','4','5','6']);await e.scheduler.flush();
    await e.scheduler.advance(30000);await e.scheduler.frame();
    const before=e.cardIds();e.document.dispatchEvent({type:'click',target:button});await e.scheduler.flush();
    assert.deepEqual(e.cardIds(),before);assert.ok(!before.includes('3'));
    assert.equal((await e.snapshot()).performanceWork.undoRetention.expired,1);e.dispose();
});

test('real session unavailable addition times out truthfully and old deliveries cannot mutate a replacement visit',async()=>{
    const e=sessionBrowser();await e.start();e.click('99');await e.scheduler.flush();
    const oldCallbacks=e.observers.filter(observer=>observer.active&&observer.options?.childList).map(observer=>observer.callback);
    await e.scheduler.advance(1800);await e.scheduler.flush();assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);
    assert.ok(e.logs.some(row=>row[2]?.videoId==='99'&&row[2]?.timeoutMs===1800));
    await e.navigate('/browse');await e.navigate('/browse/my-list');await e.drain(()=>e.app.diagnostics().currentSession.completed);
    const root=e.grid();for(const callback of oldCallbacks)callback([{type:'childList',target:e.source.track,addedNodes:[],removedNodes:[]}]);await e.scheduler.frame();
    assert.equal(e.grid(),root);assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);e.dispose();
});

test('real session hidden cards and placement controls cannot prepare native hover',async()=>{
    const e=sessionBrowser();await e.start();e.over('2');
    for(let i=0;i<6;i++){await e.scheduler.advance(50);await e.scheduler.frame();}
    assert.deepEqual(e.events,[]);assert.deepEqual(e.moves,[]);
    e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});
    const control=e.grid().querySelector('[data-tm-item-video-id="2"]').querySelector('[data-tm-viewing-action]');
    e.grid().dispatchEvent({type:'pointerover',target:control,clientX:20,clientY:20});
    for(let i=0;i<6;i++){await e.scheduler.advance(50);await e.scheduler.frame();}
    assert.deepEqual(e.events,[]);assert.deepEqual(e.moves,[]);e.dispose();
});

test('real session waiting hover revalidates physical intent after responsive stability',async()=>{
    const e=sessionBrowser({count:12,logical:true});await e.start();
    e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});
    e.resize(4,400);await e.scheduler.advance(140);const old=e.over('9');await e.scheduler.advance(120);
    assert.deepEqual(e.events,[],'responsive transaction gates native replay');
    e.leavePointer(old);await e.drain(()=>e.logs.some(row=>row.includes('Responsive refresh completed')));
    assert.deepEqual(e.events,[],'leaving during the wait prevents resumed preparation');
    e.over('9');await e.drain(()=>e.events.some(event=>event.id==='9'));
    assert.ok(e.events.every(event=>event.id==='9'));e.dispose();
});

test('real session incremental viewing publishes a confirmed title before the last title batch resolves',async()=>{
    const e=sessionBrowser({count:51,logical:true,viewing:true});let resolveLast;
    const later=new Promise(resolve=>{resolveLast=resolve;});
    e.setReply(async(_url,options)=>{
        const paths=new URLSearchParams(options.body).getAll('path').map(JSON.parse);
        if(paths[0][1].includes('51'))return later;
        return {jsonGraph:{videos:Object.fromEntries(paths[0][1].map(id=>[id,viewingVideo('movie',id==='1',20)]))}};
    });
    await e.start();await e.drain(()=>groupIds(e).watched.includes('1'));
    assert.equal(finished(e),0);assert.deepEqual(groupIds(e).watched,['1']);assert.equal(e.cardIds().length,51);
    resolveLast({jsonGraph:{videos:{51:viewingVideo('movie',false,20)}}});
    await e.drain(()=>finished(e)===1);assert.deepEqual(groupIds(e).watched,['1']);e.dispose();
});

function seriesGraph(total=2){
    const episodes=Object.fromEntries(Array.from({length:total},(_,i)=>[i,reference('videos',String(200+i))]));
    return {jsonGraph:{videos:{1:viewingVideo('movie',true),2:{...viewingVideo('show',false),seasonCount:atom(1),episodeCount:atom(total),seasonList:{0:reference('seasons','20')}},
        ...Object.fromEntries(Array.from({length:total},(_,i)=>[200+i,viewingVideo('episode',total===2||i<total-1, total===2||i<total-1?100:20)]))},
        seasons:{20:{summary:atom({length:total}),episodes}}}};
}

test('real session refresh reveals a new episode and expires a remembered manual series correction',async()=>{
    const e=sessionBrowser({count:2,viewing:true});let total=2;e.setReply(async()=>seriesGraph(total));
    await e.start();await e.drain(()=>finished(e)===1);assert.deepEqual(groupIds(e).watched,['1','2']);
    total=3;refresh(e);await e.drain(()=>finished(e)===2);assert.deepEqual(groupIds(e).watched,['1']);
    const main=e.grid().querySelector('[data-tm-type-filter="main"]');main.querySelector('[data-tm-filter-value="series"]').dispatchEvent({type:'click'});
    const requests=e.requests.length;action(e,'2');await e.scheduler.flush();assert.deepEqual(groupIds(e).watched,['1','2']);assert.equal(e.requests.length,requests);
    assert.equal(e.grid().querySelector('[data-tm-item-video-id="2"]').querySelector('[data-tm-manual-choice]').hidden,false);
    total=4;refresh(e);await e.drain(()=>finished(e)===3);assert.deepEqual(groupIds(e).watched,['1']);
    assert.equal(e.grid().querySelector('[data-tm-item-video-id="2"]').querySelector('[data-tm-manual-choice]').hidden,true);
    assert.equal(main.querySelector('[data-tm-filter-value="series"]').getAttribute('aria-pressed'),'true');e.dispose();
});

test('real session manual placement persists per profile, restores automation, and preserves focus position',async()=>{
    const e=sessionBrowser({count:2,viewing:true});await e.start();await e.drain(()=>finished(e)===1);
    e.window.scrollY=320;const node=e.grid().querySelector('[data-tm-item-video-id="1"]');e.document.activeElement=node.querySelector('button');
    const requests=e.requests.length;action(e,'1');await e.scheduler.flush();assert.deepEqual(groupIds(e).watched,['1']);
    assert.equal(e.window.scrollY,320);assert.equal(e.document.activeElement,e.grid().querySelector('summary'));assert.equal(e.requests.length,requests);
    const key='legacyMyListForNetflix.viewingChoices.v1.profile-a';assert.equal(e.storage.get(key).choices['1'].status,'complete');
    refresh(e);await e.drain(()=>finished(e)===2);assert.deepEqual(groupIds(e).watched,['1']);
    e.models.userInfo.userGuid='profile-b';refresh(e);await e.drain(()=>finished(e)===3);assert.deepEqual(groupIds(e).watched,[]);
    e.models.userInfo.userGuid='profile-a';refresh(e);await e.drain(()=>finished(e)===4);assert.deepEqual(groupIds(e).watched,['1']);
    const details=e.grid().querySelector('details');details.open=true;details.dispatchEvent({type:'toggle'});
    action(e,'1');await e.scheduler.flush();assert.deepEqual(groupIds(e).watched,[]);assert.equal(e.storage.get(key).choices['1'],undefined);
    assert.equal(e.window.scrollY,320);e.dispose();
});

test('real session profile replacement during a viewing body read discards old results and persistence',async()=>{
    const e=sessionBrowser({count:2,viewing:true});let resolveBody;
    e.setReply(()=>new Promise(resolve=>{resolveBody=resolve;}));await e.start();
    await e.drain(()=>typeof resolveBody==='function');e.models.userInfo.userGuid='profile-b';
    resolveBody({jsonGraph:{videos:{1:viewingVideo('movie',true),2:viewingVideo('movie',true)}}});
    for(let i=0;i<6;i++){await e.scheduler.advance(25);await e.scheduler.frame();}
    assert.deepEqual(groupIds(e).watched,[]);assert.ok(![...e.storage.keys()].some(key=>key.includes('viewingCache')&&key.endsWith('profile-a')));
    e.setReply(async()=>({jsonGraph:{videos:{1:viewingVideo('movie',false,20),2:viewingVideo('movie',true)}}}));refresh(e);
    await e.drain(()=>finished(e)===1);assert.deepEqual(groupIds(e).watched,['2']);e.dispose();
});


for (const converge of [true, false]) {
    test(`real session logical remapping ${converge ? 'converges on' : 'stops after'} its single bounded retry`, async () => {
        const e = sessionBrowser({ count: 12, logical: true }); await e.start();
        const starts = [], completions = [], log = e.context.console.log;
        e.context.console.log = (...args) => {
            log(...args);
            if (args[1] === 'Responsive refresh started') starts.push(e.scheduler.performance.now());
            if (args[1] === 'Responsive refresh completed') completions.push(e.scheduler.performance.now());
        };
        e.resize(3, 300);
        const slots = e.source.track.children;
        slots[1].__reactFiber$input.memoizedProps.totalCount = 13;
        await e.drain(() => e.logs.some(row => row.includes('Responsive logical page remap deferred')));
        const oldPages = e.grid().querySelectorAll('[data-tm-item-video-id]').map(node => node.getAttribute('data-tm-item-page'));
        assert.deepEqual(oldPages, [...Array(6).fill('0'), ...Array(6).fill('1')]);
        if (converge) slots[1].__reactFiber$input.memoizedProps.totalCount = 12;
        await e.drain(() => e.logs.filter(row => row.includes('Responsive refresh completed')).length === 2);
        for (let i = 0; i < 100; i++) { await e.scheduler.advance(25); await e.scheduler.frame(); }
        assert.equal(e.logs.filter(row => row.includes('Responsive refresh started')).length, 2);
        assert.ok(starts[1] - completions[0] >= 400, 'the retry waits at least its 400 ms delay');
        assert.deepEqual(e.grid().querySelectorAll('[data-tm-item-video-id]').map(node => node.getAttribute('data-tm-item-page')),
            converge ? ['0','0','0','1','1','1','2','2','2','3','3','3'] : oldPages);
        assert.deepEqual(e.cardIds(), Array.from({ length: 12 }, (_, i) => String(i + 1))); e.dispose();
    });
}

test('real session route exit retires a pending responsive transaction and its queued membership', async () => {
    const e = sessionBrowser({ count: 12 }); await e.start();
    e.resize(3, 300); await e.scheduler.advance(140); e.click('3'); await e.scheduler.flush();
    const old = e.grid(); await e.navigate('/browse');
    assert.equal(old.isConnected, false);
    assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
    await e.navigate('/browse/my-list'); await e.drain(() => e.app.diagnostics().currentSession.completed);
    assert.notEqual(e.grid(), old); assert.deepEqual(e.cardIds(), Array.from({ length: 12 }, (_, i) => String(i + 1)));
    assert.equal(e.grid().style.getPropertyValue('--tm-cols'), '3'); e.dispose();
});

test('real session mismatch cancellation preserves the grid and obsolete acceptance cannot affect reentry', async () => {
    const e = sessionBrowser({ count: 18, logical: true }); await e.start(); const old = e.grid();
    e.setIds(['18', ...Array.from({ length: 17 }, (_, i) => String(i + 1))]);
    old.querySelector('[data-tm-filter-value="all"]').dispatchEvent({ type: 'click' }); e.over('18');
    await e.drain(() => Boolean(e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog')), 1200);
    const dialog = e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog');
    const accept = dialog.querySelector('[data-tm-order-ok]');
    dialog.querySelector('[data-tm-order-cancel]').dispatchEvent({ type: 'click' });
    assert.equal(e.grid(), old); assert.equal(dialog.isConnected, false); assert.deepEqual(e.events, []);
    await e.navigate('/browse'); await e.navigate('/browse/my-list'); await e.drain(() => e.app.diagnostics().currentSession.completed);
    const fresh = e.grid(); accept.dispatchEvent({ type: 'click' }); await e.scheduler.flush();
    assert.equal(e.grid(), fresh); assert.deepEqual(e.cardIds(), ['18', ...Array.from({ length: 17 }, (_, i) => String(i + 1))]); e.dispose();
});

test('real session settings changed during source replacement apply to the admitted current source', async () => {
    const e = sessionBrowser({ count: 12 }); await e.start();
    e.resize(3, 300); await e.scheduler.advance(140);
    const old = e.replaceSource(); [...e.menus.values()][0].callback();
    await e.drain(() => e.source.section.getAttribute('data-tm-original-mylist-visible') === 'false' &&
        e.logs.filter(row => row.includes('Initialization completed')).length === 2);
    assert.equal(old.section.isConnected, false); assert.deepEqual(e.cardIds(), Array.from({ length: 12 }, (_, i) => String(i + 1)));
    [...e.menus.values()][0].callback(); assert.equal(e.source.section.getAttribute('data-tm-original-mylist-visible'), 'true'); e.dispose();
});

for (const nativeMoves of [true, false]) {
    test(`real session failed fresh requests ${nativeMoves ? 'fall back to a complete native collection' : 'stop with truthful bounded native failure'}`, async () => {
        const e = sessionBrowser({ count: 12, logical: true });
        e.setPostStatus(503);
        e.window.netflix.reactContext.models.graphql.data.list._id = 'my-list-wire';
        e.setGetReply(async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) }));
        if (!nativeMoves) e.source.section.querySelector('[data-uia="carousel-right-button"]').click = () => {};
        e.app.start();
        await e.drain(() => e.app.diagnostics().currentSession.completed || e.app.diagnostics().currentSession.blocked, 1200);
        if (nativeMoves) {
            assert.equal(e.app.diagnostics().currentSession.completed, true);
            assert.deepEqual(e.cardIds(), Array.from({ length: 12 }, (_, i) => String(i + 1))); assert.ok(e.moves.includes('right'));
        } else {
            assert.equal(e.app.diagnostics().currentSession.blocked, true); assert.deepEqual(e.cardIds(), []);
            assert.ok(e.logs.some(row => row[2]?.code && row.includes('Initialization failed')));
        }
        assert.ok(e.requests.length > 0); assert.ok(e.requests.length <= 3);
        assert.ok(e.logs.some(row => row[2]?.code === 'FRESH_MY_LIST_CAROUSEL_HTTP_ERROR')); e.dispose();
    });
}


test('real session fresh logical collection publishes complete authoritative wire order without native paging', async () => {
    const e = sessionBrowser({ count: 12, logical: true });
    e.window.netflix.reactContext.models.graphql.data.list._id = 'my-list-wire';
    e.setReply(async () => carouselPayload(12, Array.from({ length: 12 }, (_, i) => String(i + 1))));
    await e.start();
    assert.deepEqual(e.cardIds(), Array.from({ length: 12 }, (_, i) => String(i + 1)));
    assert.equal(e.requests.length, 1); assert.deepEqual(e.moves, []);
    assert.ok(e.logs.some(row => row.includes('GraphQL My List fast collection used'))); e.dispose();
});


test('real session schedules early source arrival once and ignores obsolete or later timer delivery', async () => {
    const e=sessionBrowser(),section=e.source.section,host=section.parentElement;
    section.remove();e.app.start();await e.scheduler.advance();
    const fallback=[...e.scheduler.timers.values()].find(timer=>timer.due-e.scheduler.performance.now()===1200);
    assert.ok(fallback,'missing-source startup waits 1200 ms');
    host.appendChild(section);e.deliver(host);
    const early=[...e.scheduler.timers.entries()].find(([,timer])=>timer.due-e.scheduler.performance.now()===40);
    assert.ok(early,'native source arrival pulls initialization forward');
    fallback.callback();
    assert.equal(e.app.diagnostics().currentSession.running,false,'obsolete delivery cannot initialize ahead of its replacement');
    assert.equal(e.logs.filter(row=>row.includes('Initialization started')).length,0);
    assert.equal(e.scheduler.timers.get(early[0]),early[1],'obsolete delivery cannot clear replacement work');
    await e.scheduler.advance(10);e.deliver(host);
    assert.equal(e.scheduler.timers.get(early[0]),early[1],'later DOM delivery cannot postpone initialization');
    await e.drain(()=>e.app.diagnostics().currentSession.completed);
    assert.deepEqual(e.cardIds(),['1','2','3','4','5','6']);
    assert.equal(e.logs.filter(row=>row.includes('Initialization started')).length,1);e.dispose();
});

for(const replacement of [false,true]){
    test(`real session ${replacement?'source replacement':'pointer departure'} between expected-page failure and recovery cannot replay old work`,async()=>{
        const e=sessionBrowser({count:12});await e.start();
        e.setIds(['1','2','3','4','5','7','6','8','9','10','11','12']);
        let interrupted=false;const log=e.context.console.log;let card;
        e.context.console.log=(...args)=>{
            log(...args);
            if(!interrupted&&args[1]==='Hover expected-page mapping is stale; searching live native source'){
                interrupted=true;if(replacement)e.replaceTrack();else e.leavePointer(card);
            }
        };
        e.grid().querySelector('[data-tm-filter-value="all"]').dispatchEvent({type:'click'});
        e.moves.length=0;card=e.over('6');await e.drain(()=>interrupted,200);
        await e.scheduler.advance(500);await e.scheduler.frame();await e.scheduler.flush();
        assert.deepEqual(e.events,[],'obsolete attempt cannot replay native hover');
        assert.deepEqual(e.moves,[],'obsolete recovery cannot navigate');
        assert.equal(e.document.getElementById('tm-netflix-mylist-order-mismatch-dialog'),null);
        assert.deepEqual(e.cardIds(),Array.from({length:12},(_,i)=>String(i+1)));e.dispose();
    });
}
