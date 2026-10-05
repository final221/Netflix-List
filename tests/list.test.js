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
