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
    assert.equal(record.imageUrl,'art');assert.equal(transfer.readMaterial(record).source,source.snapshot);
    transfer.discard();assert.equal(source.snapshot.clone,true);assert.equal(transfer.readMaterial(record),null);
    const next=e.list.prepareRecords([source]);assert.equal(next.records[0],record);next.release();
    assert.equal(source.snapshot,null);assert.equal(record.imageUrl,'art');
});

test('membership rejects DOM-bearing source objects while accepting their separately prepared scalar records', () => {
    const e=fixture(),m=e.list.createMembership(),source={videoId:'1',snapshot:{tree:true}};
    assert.throws(()=>m.publish([source],1),{code:'LIST_RECORD_INVALID'});
    assert.throws(()=>m.publish([{videoId:'1',undoId:'removal'}],1),{code:'LIST_RECORD_INVALID'});
    assert.throws(()=>m.publish([{videoId:'1',logicalIndex:0}],1),{code:'LIST_RECORD_INVALID'});
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
