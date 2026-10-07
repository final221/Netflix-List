import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createDocument, Element } from './helpers/dom.js';
import { createImageDiagnostics } from '../src/grid/image-diagnostics.js';
import { createScheduler } from './helpers/scheduler.js';

// Supplementary sampling policies consume the real grid registry and markup;
// fixture code supplies browser facts only and never instruments an owner.
function thumbnailEnvironment() {
    const document=createDocument(),scheduler=createScheduler(),section=document.body.appendChild(new Element('section'));
    const scroller=section.appendChild(new Element()),status=section.appendChild(new Element());
    const c={window:{innerWidth:1000,innerHeight:600},performance:{now:()=>100,getEntriesByType:()=>[]},
        getComputedStyle:()=>({aspectRatio:'auto',paddingTop:'0px',paddingBottom:'0px'}),isRouteSessionActive:()=>true};
    const grid=createGrid({document,location:{href:'https://www.netflix.com/browse/my-list'},runChunks:async()=>{}});
    grid.mount({section,anchor:scroller,status,layout:{},geometry:{left:0,width:600,columns:6},assertCurrent(){}});
    const oldGrid=grid.root,state={grid:oldGrid,initializationStartedAt:100,cloneMap:grid.cards};
    const reads={queries:0,rects:0,styles:0};let sequence=0;
    const provider=()=>createImageDiagnostics({window:c.window,location:{href:'https://www.netflix.com/browse/my-list'},performance:c.performance,
        getComputedStyle:typeof c.getComputedStyle==='function'?node=>{reads.styles++;return c.getComputedStyle(node);}:undefined,
        readState:()=>state,readSessionToken:()=>1,isRouteSessionActive:(...args)=>c.isRouteSessionActive(...args),
        gridOwnsClone:(node,root)=>grid.isCardVisible(node,root),readScanFinishedAt:()=>null});
    function addImage(options={}) {
        const id=String(++sequence),snapshot=new Element(),card=snapshot.appendChild(new Element('a'));
        card.setAttribute('data-uia','standard-card');card.href=`https://www.netflix.com/browse?jbv=${id}`;card.setAttribute('href',card.href);
        const input=snapshot.appendChild(new Element('img'));input.id='img';
        const item={videoId:id,href:card.href,page:0,snapshot};const clone=grid.insertCard(item).node;
        if(options.parent)options.parent.appendChild(clone);
        const image=clone.querySelector('img'),query=clone.querySelector.bind(clone);
        clone.querySelector=selector=>{reads.queries++;return query(selector);};
        const url=options.url||`https://images.test/private-${id}.jpg?signature=secret`;
        Object.assign(image,{src:url,currentSrc:url,complete:true,naturalWidth:200,naturalHeight:100,loading:'lazy',decoding:'async',...options});
        if(options.hidden)clone.setAttribute('data-tm-type-hidden','true');
        const rect=options.rect||{left:0,top:0,right:200,bottom:100,width:200,height:100};
        image.getBoundingClientRect=()=>{reads.rects++;return rect;};
        clone.getBoundingClientRect=()=>{reads.rects++;return {...rect,height:130,bottom:rect.top+130};};
        image.decode=()=>assert.fail('sampling must not decode');
        for(const node of [image,clone])node.setAttribute=node.removeAttribute=()=>assert.fail('sampling must not write DOM');
        return {clone,image,url};
    }
    c.sourceState=state;c.collectThumbnailDiagnostics=state=>provider().collect(state);
    return {c,...scheduler,section,oldGrid,reads,addImage,report:()=>provider().collect()};
}

function fixture() {
    const document = createDocument(), observers = [];
    let active = true;
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(options) { this.options = options; }
        disconnect() { this.disconnected = true; }
    }
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        runChunks: async (count, visit) => { for (let index = 0; index < count; index++) visit(index); },
        imageDiagnostics: { window: { innerWidth: 100, innerHeight: 100 }, location: { href: 'https://www.netflix.com/' },
            performance: { now: () => 10, getEntriesByType: () => [] }, PerformanceObserver: Observer,
            readSessionToken: () => 1, isRouteSessionActive: () => active, readScanFinishedAt: () => 20 } });
    return { grid, document, observers, leave: () => { active = false; } };
}

test('grid image provider owns one bounded future-entry observer and returns copied summaries', () => {
    const f = fixture(); f.grid.images.start(1); f.grid.images.start(1);
    assert.equal(f.observers.length, 1);
    assert.deepEqual(f.observers[0].options, { entryTypes: ['resource'] });
    const entry = { startTime: 30, initiatorType: 'img', duration: 4,
        get name() { assert.fail('route summaries must not read URLs'); } };
    f.observers[0].callback({ getEntries: () => Array(4005).fill(entry) });
    const snapshot = f.grid.images.diagnostics();
    assert.equal(snapshot.entriesExamined, 4000); assert.equal(snapshot.skippedAtLimit, 5);
    assert.equal(snapshot.imageEntries, 4000); assert.equal(snapshot.startedAfterViewingScan, 4000);
    assert.equal(f.observers[0].disconnected, true);
    snapshot.imageEntries = -1; assert.equal(f.grid.images.diagnostics().imageEntries, 4000);
    f.grid.images.start(1); assert.equal(f.observers.length, 1);
});

test('retired image delivery and failed reads cannot stop a replacement observer', () => {
    const f = fixture(); f.grid.images.start(1); const old = f.observers[0];
    f.grid.images.reset(); f.grid.images.start(1);
    old.callback({ getEntries: () => { assert.fail('obsolete list must not be read'); } });
    assert.equal(f.grid.images.diagnostics().active, true);
    f.observers[1].callback({ getEntries() {
        f.grid.images.reset(); f.grid.images.start(1); throw new Error('retired read');
    } });
    assert.equal(f.grid.images.diagnostics().active, true);
    f.observers[2].callback({ getEntries: () => { throw new Error('private URL'); } });
    assert.equal(f.grid.images.diagnostics().stopReason, 'read-failed');
    assert.ok(!JSON.stringify(f.grid.images.diagnostics()).includes('private URL'));
    f.grid.images.reset(); f.grid.images.start(1); f.leave();
    f.observers[3].callback({ getEntries: () => { assert.fail('retired route must not read'); } });
    f.grid.images.dispose(); assert.equal(f.observers[3].disconnected, true);
});

test('Copy Logs thumbnail sampling uses the current grid registry and rejects disposed frames', async () => {
    const f = fixture(); const section = f.document.body.appendChild(new Element('section'));
    const anchor = section.appendChild(new Element()), status = section.appendChild(new Element());
    const snapshot = new Element(), card = snapshot.appendChild(new Element('a'));
    card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', 'https://www.netflix.com/browse?jbv=1');
    const item = { videoId: '1', href: card.getAttribute('href'), snapshot };
    await f.grid.publish({ items: [item], section, anchor, status, geometry: { width: 100, left: 0, columns: 1 }, layout: {}, assertCurrent() {} });
    assert.equal(f.grid.images.collect().mappedCards, 1);
    assert.equal(f.grid.images.collect().cardsWithoutImage, 1);
    f.grid.dispose();
    assert.deepEqual(f.grid.images.collect(), { available: false, reason: 'no-current-grid' });
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
    const details = e.oldGrid.appendChild(new Element('details')); details.open = false;
    const watched = details.appendChild(new Element('watched'));
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
    e.oldGrid.remove();
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
