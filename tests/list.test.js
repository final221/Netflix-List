import test from 'node:test';
import assert from 'node:assert/strict';
import { createList } from '../src/list/list.js';

function fixture(extra = {}) {
    let requests = 0;
    const list = createList({ runChunks: async (count, visit, guard) => { for (let i=0; i<count; i++) { guard(); visit(i); } },
        assertSession() {}, isCancelled: error => error.code === 'CANCELLED', captureTemplate: () => ({}), assertSource() {},
        collectMounted: () => ({ items: null, reason: 'expired-proof' }),
        collectRecords: async () => { requests++; return { records: [{ videoId: '1', href: 'one' }], bootstrap: { totalCount: 1 } }; },
        ...extra });
    return { list, requests: () => requests };
}

test('list collection reuses proven mounted material without a data request and exposes copied work', async () => {
    const material = [{ videoId: '1', snapshot: {} }];
    const e = fixture({ collectMounted: () => ({ items: material }) });
    const result = await e.list.collectLogical({ bootstrap: { source: 'mounted-single-page-fast-path' }, totalCount: 1, columns: 6 });
    assert.equal(result.items, material); assert.equal(result.collectionSource, 'mounted-single-page');
    assert.equal(e.requests(), 0); assert.equal(e.list.diagnostics().membershipReuse.requestsAvoided, 1);
    assert.equal(Object.isFrozen(e.list.diagnostics().membershipReuse), true);
});

test('list collection rejects expired mounted proof and incomplete data without partial success', async () => {
    const e = fixture();
    const result = await e.list.collectLogical({ bootstrap: { source: 'mounted-single-page-fast-path' }, totalCount: 2, columns: 6, templateSource: {} });
    assert.equal(result.items, null); assert.equal(e.requests(), 1);
    assert.equal(e.list.diagnostics().membershipReuse.rejected, 1);
});

test('list collection revalidates parent after data completion and rejects obsolete material', async () => {
    let active = true;
    const e = fixture({ collectRecords: async () => { active=false; return { records: [{videoId:'1'}] }; },
        isCancelled: error => error.code === 'CANCELLED' });
    await assert.rejects(e.list.collectLogical({ bootstrap: {}, totalCount: 1, columns: 6, templateSource: {},
        assertCurrent() { if (!active) throw Object.assign(new Error('retired'), {code:'CANCELLED'}); } }), {code:'CANCELLED'});
});

test('list does not accept partial mounted material as a complete membership result', async () => {
    const e = fixture({ collectMounted: () => ({ items: [{videoId:'1'}] }) });
    const result = await e.list.collectLogical({ bootstrap: {source:'mounted-single-page-fast-path'}, totalCount:2, columns:6, templateSource:{} });
    assert.equal(result.items, null); assert.equal(e.requests(), 1);
    assert.equal(e.list.diagnostics().membershipReuse.requestsAvoided, 0);
});

test('list reuse diagnostics reset at route entry without mutating earlier copied reports', async () => {
    const e = fixture({collectMounted: () => ({items:[{videoId:'1'}]})});
    await e.list.collectLogical({bootstrap:{source:'mounted-single-page-fast-path'},totalCount:1,columns:6});
    const prior=e.list.diagnostics(); e.list.resetDiagnostics();
    assert.equal(prior.membershipReuse.reused,1); assert.equal(e.list.diagnostics().membershipReuse.reused,0);
});

test('membership owns read-only order and lookup, rejects duplicate publication and keeps counts separate', () => {
    const e=fixture(), membership=e.list.createMembership();
    const one={videoId:'1'},two={videoId:'2'};
    membership.publish([one,two], 2);
    assert.deepEqual(membership.records,[one,two]); assert.equal(Object.isFrozen(membership.records),true);
    assert.equal(membership.lookup.get('v:1'),one); assert.equal(membership.lookup.set,undefined);
    assert.throws(() => membership.publish([one,one],2), {code:'LIST_DUPLICATE_RECORD'});
    assert.equal(membership.records.length,2);
    membership.observeCount({collectedCount:1}); assert.equal(membership.expectedCount,2);assert.equal(membership.collectedCount,1);
});

test('membership remove and readd preserve record identity and publish revisions while obsolete commands cannot edit', () => {
    const e=fixture(),m=e.list.createMembership(),one={videoId:'1'},two={videoId:'2'};m.publish([one,two],2);
    const before=m.revision; const removed=m.remove('v:1');
    assert.equal(removed.record,one);assert.equal(removed.index,0);assert.equal(m.lookup.has('v:1'),false);
    m.insert(one,1); assert.deepEqual(m.records,[two,one]);assert.equal(m.revision,before+2);
    assert.throws(()=>m.remove('v:2',{assertCurrent(){throw new Error('obsolete');}}),/obsolete/);
    assert.equal(m.lookup.get('v:2'),two);
});

test('membership native span order is controlled and unknown titles cannot alter it', () => {
    const e=fixture(),m=e.list.createMembership(),items=['1','2','3','4'].map(videoId=>({videoId}));m.publish(items,4);
    assert.deepEqual(m.alignVisible(['4','2'],1).ordered.map(i=>i.videoId),['4','2']);assert.deepEqual(m.records.map(i=>i.videoId),['1','4','2','3']);
    const revision=m.revision;assert.equal(m.alignVisible(['9'],0),false);assert.equal(m.revision,revision);
});

test('membership validates publication before grid work and superseded staged acceptance cannot replace newer records', () => {
    const e=fixture(),m=e.list.createMembership();m.publish([{videoId:'1'}],1);
    const staged=m.preparePublication([{videoId:'2'}],1);assert.equal(m.lookup.has('v:2'),false);
    m.publish([{videoId:'3'}],1);assert.throws(()=>staged.commit(),{code:'LIST_REPLACED'});
    assert.equal(m.lookup.has('v:3'),true);assert.equal(m.lookup.has('v:2'),false);
});

test('reentrant membership admission preserves the newer publication instead of committing an obsolete removal', () => {
    const e=fixture(),m=e.list.createMembership();m.publish([{videoId:'1'}],1);let invoked=false;
    assert.throws(()=>m.remove('v:1',{assertCurrent(){if(!invoked){invoked=true;m.publish([{videoId:'2'}],1);}}}),{code:'LIST_REPLACED'});
    assert.equal(m.lookup.has('v:2'),true);
});

test('membership retirement clears owned collections and rejects old commands before invoking their callbacks', () => {
    const e=fixture(),m=e.list.createMembership();m.publish([{videoId:'1'}],1);
    const lookup=m.lookup, staged=m.preparePublication([{videoId:'2'}],1);let callbacks=0;
    m.dispose();m.dispose();assert.equal(m.records.length,0);assert.equal(lookup.size,0);
    assert.equal(m.expectedCount,null);assert.equal(m.collectedCount,0);
    assert.throws(()=>staged.commit(),{code:'LIST_RETIRED'});
    assert.throws(()=>m.insert({videoId:'3'},0,{assertCurrent(){callbacks++;}}),{code:'LIST_RETIRED'});
    assert.equal(callbacks,0);
});

test('retirement during admission cannot commit a partially prepared membership update', () => {
    const e=fixture(),m=e.list.createMembership();m.publish([{videoId:'1'}],1);
    assert.throws(()=>m.remove('v:1',{assertCurrent(){m.dispose();}}),{code:'LIST_RETIRED'});
    assert.equal(m.records.length,0);
});

test('collection transfer separates DOM material from stable scalar records and discards unaccepted material without clearing its source', () => {
    const e=fixture(),source={videoId:'1',href:'one',ariaLabel:'One',page:0,logicalIndex:42,imageUrl:'art',snapshot:{clone:true},fiber:{private:true},undoId:'untrusted'};
    const transfer=e.list.prepareRecords([source]);const record=transfer.records[0];
    assert.equal(record.snapshot,undefined);assert.equal(record.cardTemplate,undefined);assert.equal(record.fiber,undefined);
    assert.equal(Object.hasOwn(record,'undoId'),false);
    assert.equal(Object.hasOwn(record,'logicalIndex'),false);
    assert.equal(Object.hasOwn(record,'page'),false);assert.equal(transfer.readPage(record),0);
    assert.equal(record.imageUrl,'art');assert.equal(transfer.readMaterial(record).source,source.snapshot);
    transfer.discard();assert.equal(transfer.readPage(record),undefined);assert.equal(source.snapshot.clone,true);assert.equal(transfer.readMaterial(record),null);
    const next=e.list.prepareRecords([source]);assert.equal(next.records[0],record);next.release();
    assert.equal(source.snapshot,null);assert.equal(record.imageUrl,'art');
});

test('membership rejects DOM-bearing source objects while accepting their separately prepared scalar records', () => {
    const e=fixture(),m=e.list.createMembership(),source={videoId:'1',snapshot:{tree:true}};
    assert.throws(()=>m.publish([source],1),{code:'LIST_RECORD_INVALID'});
    assert.throws(()=>m.publish([{videoId:'1',undoId:'removal'}],1),{code:'LIST_RECORD_INVALID'});
    assert.throws(()=>m.publish([{videoId:'1',logicalIndex:0}],1),{code:'LIST_RECORD_INVALID'});
    assert.throws(()=>m.publish([{videoId:'1',page:0}],1),{code:'LIST_RECORD_INVALID'});
    const transfer=e.list.prepareRecords([source]);m.publish(transfer.records,1);
    assert.equal(m.records[0],transfer.records[0]);assert.equal(Object.hasOwn(m.records[0],'snapshot'),false);
    transfer.discard();
});

test('material release closes access before host failure and still releases other inputs', () => {
    const e=fixture(),tree={},first={videoId:'1',imageUrl:'art'};
    Object.defineProperty(first,'snapshot',{get:()=>tree,set(){throw new Error('host release');}});
    const second={videoId:'2',snapshot:{},imageUrl:'second'};
    const transfer=e.list.prepareRecords([first,second]);
    assert.throws(()=>transfer.release(),/host release/);
    assert.equal(transfer.readMaterial(transfer.records[0]),null);
    assert.equal(second.snapshot,null);assert.equal(second.imageUrl,'');
    assert.equal(transfer.records[1].imageUrl,'second');transfer.release();
});

test('accepted publication remains admitted until another membership change supersedes it', () => {
    const e=fixture(),m=e.list.createMembership(),record={videoId:'1'};
    const publication=m.preparePublication([record],1);
    publication.commit();publication.assertCurrent();const revision=m.revision;
    publication.commit();assert.equal(m.revision,revision);
    m.remove('v:1');assert.throws(()=>publication.assertCurrent(),{code:'LIST_REPLACED'});
    assert.throws(()=>publication.commit(),{code:'LIST_REPLACED'});
});

test('source access cannot return a transfer after retiring its caller during capture', () => {
    const e=fixture();let active=true,reads=0;
    const source={videoId:'1'};
    Object.defineProperty(source,'imageUrl',{get(){if(++reads===2)active=false;return 'art';}});
    assert.throws(()=>e.list.prepareRecords([source],{assertCurrent(){if(!active)throw new Error('retired');}}),/retired/);
});


test('entry strategy uses initial cached count without mounted proof or fresh requests', async () => {
    const calls=[];const e=fixture({waitInitialCount:async()=>{calls.push('cached');return 3;},
        readInitialFirstId:()=> '1',fetchBootstrap:async()=>{throw new Error('unexpected fresh');}});
    const entry=await e.list.prepareEntry({entryKind:'initial',sessionToken:1,hasNativeSource:true,
        readMountedBootstrap:()=>{throw new Error('unexpected native');},readMountedCards:()=>{throw new Error('unexpected cards');}});
    assert.equal(entry.totalCount,3);assert.equal(entry.bootstrap.firstVideoId,'1');
    assert.deepEqual(calls,['cached']);let options;
    await entry.prepareReadiness(input=>{options=input;return Promise.resolve({ready:true});});
    assert.deepEqual(options,{fastSinglePageTotalCount:null});
});

test('entry strategy reuses proven mounted SPA bootstrap without starting parallel readiness or fresh data', async () => {
    const bootstrap={source:'mounted-single-page-fast-path',totalCount:2,firstVideoId:'1',elapsedMs:7};
    const detections=[];const e=fixture({fetchBootstrap:async()=>{throw new Error('unexpected fresh');}});
    const entry=await e.list.prepareEntry({entryKind:'spa',sessionToken:1,hasNativeSource:true,
        readMountedBootstrap:async()=>bootstrap,readMountedCards:()=>{throw new Error('unexpected cards');},
        startReadiness:()=>{throw new Error('unexpected parallel readiness');},onCount:detail=>detections.push(detail)});
    assert.equal(entry.bootstrap,bootstrap);assert.equal(entry.mountedSinglePage,true);
    let count;await entry.prepareReadiness(input=>{count=input.fastSinglePageTotalCount;return Promise.resolve({ready:true});});
    assert.equal(count,2);assert.equal(detections[0].detectionReason,bootstrap.source);
});

test('entry strategy overlaps native readiness with fresh SPA data and exposes early readiness failure safely', async () => {
    const calls=[];let completeData;
    const failure=new Error('native failed');
    const e=fixture({fetchBootstrap:()=>{calls.push('fresh');return new Promise(resolve=>{completeData=resolve;});}});
    const pending=e.list.prepareEntry({entryKind:'spa',sessionToken:1,hasNativeSource:true,
        readMountedBootstrap:async()=>null,readMountedCards:()=>2,
        startReadiness:()=>{calls.push('ready');return Promise.reject(failure);}});
    await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['ready','fresh']);
    completeData({totalCount:4,firstVideoId:'2'});const entry=await pending;
    assert.equal(entry.totalCount,4);assert.equal(entry.mountedSinglePage,false);
    await assert.rejects(entry.prepareReadiness(()=>{throw new Error('unexpected restart');}),error=>error===failure);
});

test('entry strategy rejects retired data completion and retired readiness before publication', async () => {
    let active=true;const guard=()=>{if(!active)throw Object.assign(new Error('retired'),{code:'CANCELLED'});};
    const e=fixture({assertSession:guard,fetchBootstrap:async()=>{active=false;return {totalCount:2};}});
    await assert.rejects(e.list.prepareEntry({entryKind:'spa',sessionToken:1,hasNativeSource:false}),{code:'CANCELLED'});
    active=true;const current=fixture({assertSession:guard,waitInitialCount:async()=>1,readInitialFirstId:()=> '1'});
    const entry=await current.list.prepareEntry({entryKind:'initial',sessionToken:1,hasNativeSource:false});
    await assert.rejects(entry.prepareReadiness(async()=>{active=false;return {ready:true};}),{code:'CANCELLED'});
});


test('entry count policy admits mounted logical count and keeps indicator count without a native read', async () => {
    const e=fixture({waitInitialCount:async()=>5,readInitialFirstId:()=> '1'});
    const entry=await e.list.prepareEntry({entryKind:'initial',sessionToken:1});
    assert.equal(entry.confirmCount({mode:'indicator',readNativeCount(){throw new Error('unexpected read');}}),null);
    const facts=entry.confirmCount({mode:'logical',readNativeCount:()=>({totalCount:7,readings:[7]})});
    assert.equal(facts.totalCount,7);assert.equal(facts.changed,true);assert.equal(facts.provisionalSource,'graphql-cache');
    assert.equal(entry.confirmCount({mode:'logical',readNativeCount:()=>({totalCount:5,readings:[5]})}).changed,false);
});

test('entry count policy rejects invalid bootstrap and invalid or obsolete native confirmation', async () => {
    const invalid=fixture({fetchBootstrap:async()=>({totalCount:NaN})});
    await assert.rejects(invalid.list.prepareEntry({entryKind:'spa'}),{code:'LIST_COUNT_INVALID'});
    let active=true;const e=fixture({waitInitialCount:async()=>2,readInitialFirstId:()=> '1'});
    const entry=await e.list.prepareEntry({entryKind:'initial',assertCurrent(){if(!active)throw new Error('retired');}});
    assert.throws(()=>entry.confirmCount({mode:'logical',readNativeCount:()=>({totalCount:-1})}),{code:'LIST_COUNT_INVALID'});
    assert.throws(()=>entry.confirmCount({mode:'logical',readNativeCount:()=>{active=false;return {totalCount:4};}}),/retired/);
});


test('entry readiness is shared and its early rejection remains handled when fresh bootstrap fails', async () => {
    const failure=new Error('fresh failed');const e=fixture({fetchBootstrap:async()=>{throw failure;}});
    await assert.rejects(e.list.prepareEntry({entryKind:'spa',hasNativeSource:true,readMountedBootstrap:async()=>null,
        readMountedCards:()=>1,startReadiness:()=>Promise.reject(new Error('readiness failed'))}),error=>error===failure);
    await Promise.resolve();
    const current=fixture({waitInitialCount:async()=>1,readInitialFirstId:()=> '1'});
    const entry=await current.list.prepareEntry({entryKind:'initial'});let calls=0;
    const first=entry.prepareReadiness(async()=>{calls++;return {ready:true};});
    const second=entry.prepareReadiness(()=>{throw new Error('duplicate readiness');});
    assert.equal(await first,await second);assert.equal(calls,1);
});


test('initial count polling stays bounded, accepts authoritative zero and revalidates after adapter reads', async () => {
    const e=fixture();let time=0,reads=0;
    const count=await e.list.waitForInitialCount({timeout:20,now:()=>time,pause:async()=>{time+=5;},
        read:()=>({available:true,count:++reads===3?0:null})});
    assert.equal(count,0);assert.equal(reads,3);assert.equal(time,10);
    let active=true;
    await assert.rejects(e.list.waitForInitialCount({timeout:20,now:()=>time,pause:async()=>{},
        read:()=>{active=false;return {available:true,count:2};},assertCurrent(){if(!active)throw new Error('retired');}}),/retired/);
});

test('initial count timeout reports the last availability once through the existing diagnostic adapter', async () => {
    const e=fixture();let time=0,reports=0;const error=new Error('timeout');
    await assert.rejects(e.list.waitForInitialCount({timeout:20,now:()=>time,pause:async()=>{time+=5;},
        read:()=>({available:time>=10,count:null}),onTimeout(facts){reports++;assert.equal(facts.available,true);return error;}}),value=>value===error);
    assert.equal(time,20);assert.equal(reports,1);
});


test('publication collection uses complete preferred material and otherwise performs one native fallback', async () => {
    const e=fixture(),preferred=[{videoId:'1'},{videoId:'2'}];let scans=0,preferredUses=0;
    const first=await e.list.collectForPublication({preferred,totalCount:2,onPreferred(){preferredUses++;},
        beforeNative(){throw new Error('unexpected scan');},collectNative(){throw new Error('unexpected native');}});
    assert.equal(first.items,preferred);assert.equal(first.status,'complete');assert.equal(preferredUses,1);
    const fallback=await e.list.collectForPublication({preferred:preferred.slice(0,1),totalCount:2,
        beforeNative(){scans++;},collectNative:async()=>preferred});
    assert.equal(fallback.items,preferred);assert.equal(scans,1);
});

test('publication collection confirms native empty truthfully and rejects unproven empty or mismatched counts', async () => {
    const e=fixture();const empty=await e.list.collectForPublication({totalCount:2,collectNative:async()=>[],
        readEmpty:()=>({pages:1,cards:0})});
    assert.equal(empty.status,'empty');assert.equal(empty.items.length,0);
    await assert.rejects(e.list.collectForPublication({totalCount:2,collectNative:async()=>[],
        readEmpty:()=>({pages:2,cards:0})}),{code:'NO_NATIVE_CARDS'});
    await assert.rejects(e.list.collectForPublication({totalCount:2,collectNative:async()=>[{videoId:'1'}]}),
        {code:'COLLECTION_COUNT_MISMATCH',stage:'validate-count'});
});

test('publication collection rejects retired preferred callbacks and completed native reads before acceptance', async () => {
    const e=fixture();let active=true,scans=0;
    const guard=()=>{if(!active)throw new Error('retired');};
    await assert.rejects(e.list.collectForPublication({preferred:[{videoId:'1'}],totalCount:1,assertCurrent:guard,
        onPreferred(){active=false;},collectNative:async()=>{scans++;return [];}}),/retired/);
    assert.equal(scans,0);active=true;
    await assert.rejects(e.list.collectForPublication({totalCount:1,assertCurrent:guard,
        collectNative:async()=>{active=false;return [{videoId:'1'}];}}),/retired/);
});

test('publication collection preserves diagnostic error adapters and revalidates after failure presentation', async () => {
    const e=fixture();let active=true,calls=0;const failure=new Error('custom count');
    await assert.rejects(e.list.collectForPublication({totalCount:2,collectNative:async()=>[{videoId:'1'}],
        createFailure(facts){calls++;assert.equal(facts.collected,1);assert.equal(facts.totalCount,2);return failure;}}),error=>error===failure);
    assert.equal(calls,1);
    await assert.rejects(e.list.collectForPublication({totalCount:2,collectNative:async()=>[{videoId:'1'}],
        assertCurrent(){if(!active)throw new Error('retired');},createFailure(){active=false;return failure;}}),/retired/);
});


test('preferred collection strategy skips indicator work and prepares complete logical material', async () => {
    const e=fixture();const bootstrap={};
    const skipped=await e.list.preparePreferred({mode:'indicator',bootstrap,
        readInput(){throw new Error('unexpected logical reads');}});
    assert.equal(skipped.items,null);assert.equal(skipped.bootstrap,bootstrap);
    let prepared=0;
    const result=await e.list.preparePreferred({mode:'logical',bootstrap,
        readInput:()=>({totalCount:1,columns:6,templateSource:{}}),onPrepared(){prepared++;}});
    assert.equal(result.items.length,1);assert.equal(prepared,1);
});

test('preferred collection strategy reports ordinary failure for native fallback and rejects obsolete acceptance', async () => {
    const error=new Error('optional pagination');let failures=0;
    const e=fixture({collectRecords:async()=>{throw error;}});
    const result=await e.list.preparePreferred({mode:'logical',bootstrap:{},readInput:()=>({totalCount:1,columns:6,templateSource:{}}),
        onFailure(value){failures++;assert.equal(value,error);}});
    assert.equal(result.items,null);assert.equal(failures,1);
    const replaced=Object.assign(new Error('native replaced'),{code:'NATIVE_SOURCE_REPLACED'});
    const stale=fixture({collectRecords:async()=>{throw replaced;}});
    await assert.rejects(stale.list.preparePreferred({mode:'logical',bootstrap:{},
        readInput:()=>({totalCount:1,columns:6,templateSource:{}}),onFailure(){throw new Error('unexpected fallback');}}),error=>error===replaced);
    let active=true;const current=fixture();
    await assert.rejects(current.list.preparePreferred({mode:'logical',bootstrap:{},readInput:()=>({totalCount:1,columns:6,templateSource:{}}),
        assertCurrent(){if(!active)throw new Error('retired');},onPrepared(){active=false;}}),/retired/);
});


test('entry strategy anchors only fresh SPA indicator sources and revalidates after movement', async () => {
    const e=fixture({waitInitialCount:async()=>2,readInitialFirstId:()=> '1',fetchBootstrap:async()=>({totalCount:2,firstVideoId:'2'})});
    const initial=await e.list.prepareEntry({entryKind:'initial'});
    assert.equal(await initial.prepareAnchor({mode:'indicator',normalize(){throw new Error('unexpected initial movement');}}),false);
    const spa=await e.list.prepareEntry({entryKind:'spa'});let anchors=0;
    assert.equal(await spa.prepareAnchor({mode:'logical',normalize(){throw new Error('unexpected logical movement');}}),false);
    assert.equal(await spa.prepareAnchor({mode:'indicator',normalize:async id=>{assert.equal(id,'2');anchors++;}}),true);
    assert.equal(anchors,1);
    let active=true;const current=await e.list.prepareEntry({entryKind:'spa',assertCurrent(){if(!active)throw new Error('retired');}});
    await assert.rejects(current.prepareAnchor({mode:'indicator',normalize:async()=>{active=false;}}),/retired/);
});
