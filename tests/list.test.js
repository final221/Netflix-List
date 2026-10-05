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
