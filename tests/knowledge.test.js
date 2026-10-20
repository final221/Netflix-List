import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledge } from '../src/viewing/knowledge.js';
import { fact, storageClient } from './helpers/knowledge.js';

function setup(storage = new Map()) {
    let profile = 'A';
    const api = storageClient(storage), knowledge = createKnowledge({ ...api, activeProfile: () => profile, now: () => 100 });
    const view = knowledge.view(); view.sync();
    return { storage, api, knowledge, view, profile: value => { profile = value; view.sync(); } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('remote bursts reload storage once and publish only changed titles', async () => {
    const prefix = 'legacyMyListForNetflix.knowledge.v2.A.', storage = new Map([[prefix + 'migrated', true]]);
    for (let id = 1; id <= 1000; id++) storage.set(prefix + id + '.label', { name: 'Old ' + id });
    const writer = setup(storage), api = storageClient(storage);
    let reads = 0, enumerations = 0;
    const reader = createKnowledge({ ...api, activeProfile: () => 'A',
        getValue(key, fallback) { reads++; return api.getValue(key, fallback); },
        listValues() { enumerations++; return api.listValues(); } });
    const view = reader.view(); view.sync(); reads = enumerations = 0;
    const deliveries = []; reader.subscribe(change => deliveries.push(change.ids));
    for (let id = 1; id <= 50; id++) writer.knowledge.remember(String(id), { name: 'New ' + id });
    await settle();
    assert.equal(enumerations, 1); assert.ok(reads <= 1010, 'one bounded reload, not one per signal');
    assert.deepEqual(deliveries, [Array.from({ length: 50 }, (_, i) => String(i + 1))]);
    assert.equal(reader.name('50'), 'New 50'); assert.equal(reader.name('51'), 'Old 51');
    reader.resync(); await settle(); assert.equal(deliveries.length, 1, 'unchanged focus recovery does not repaint');
    assert.ok(reader.diagnostics().coalescedInvalidations >= 49);
    writer.knowledge.dispose(); reader.dispose();
});

test('loading retained evidence does not notify unchanged series after an unrelated remote update', async () => {
    const storage = new Map(), first = setup(storage);
    first.knowledge.remember('1', { type: 'series', coverage: [['10', 2]], status: 'complete' });
    await settle();
    const second = setup(storage), deliveries = []; first.knowledge.subscribe(change => deliveries.push(change.ids));
    second.knowledge.remember('2', { name: 'Other title' }); await settle();
    assert.deepEqual(deliveries, [['2']]);
    assert.equal(first.view.complete('1'), true);
    first.knowledge.dispose(); second.knowledge.dispose();
});

test('queued remote reload cannot read or notify after profile replacement or disposal', async () => {
    for (const dispose of [false, true]) {
        const storage = new Map(), writer = setup(storage), api = storageClient(storage), pending = [];
        let profile = 'A', reads = 0, delivered = 0;
        const reader = createKnowledge({ ...api, activeProfile: () => profile, queueMicrotask: fn => pending.push(fn),
            getValue(key, fallback) { reads++; return api.getValue(key, fallback); } });
        reader.view().sync(); reader.subscribe(() => delivered++);
        writer.knowledge.remember('1', { name: 'Remote' }); await settle();
        assert.equal(pending.length, 1);
        if (dispose) reader.dispose(); else profile = 'B';
        reads = 0; pending.shift()();
        assert.equal(reads, 0); assert.equal(delivered, 0);
        reader.dispose(); writer.knowledge.dispose();
    }
});

test('incidental title history cannot block new decisions, hides or acknowledged completion', () => {
    const prefix = 'legacyMyListForNetflix.knowledge.v2.A.', storage = new Map([[prefix + 'migrated', true]]);
    for (let id = 1; id <= 5000; id++) storage.set(prefix + id + '.label', { name: 'Encountered ' + id });
    let e = setup(storage);
    e.knowledge.remember('6001', { name: 'Incidental', type: 'movie' });
    assert.equal(fact(storage, 'A', '6001', 'label'), undefined, 'new incidental retention stops at its bound');
    assert.equal(e.view.choose('6001', { status: 'complete', type: 'movie', coverage: null, name: 'Chosen' }).saved, true);
    e.knowledge.setHidden('6002', true, 'Hidden');
    e.knowledge.remember('6003', { type: 'series', coverage: [['60', 2]], status: 'complete', name: 'Acknowledged' });
    assert.equal(e.view.presentation().disabled, false); assert.equal(e.view.complete('6003'), true);
    e.knowledge.remember('6003', { type: 'series', coverage: [['60', 3]] });
    assert.equal(e.view.complete('6003'), false, 'retained series can still expire after an expansion');
    e.knowledge.dispose(); e = setup(storage);
    assert.equal(e.view.complete('6001'), true); assert.equal(e.knowledge.name('6001'), 'Chosen');
    assert.deepEqual(e.knowledge.hidden(), { 6002: 'hide' }); assert.equal(e.view.complete('6003'), false);
    assert.equal(e.view.choose('6001', { status: 'main', type: 'movie', coverage: null }).saved, true);
    e.knowledge.setHidden('6002', false); assert.deepEqual(e.knowledge.hidden(), {});
    assert.equal(fact(storage, 'A', '1', 'label').name, 'Encountered 1', 'existing names are preserved');
    e.profile('B'); assert.equal(e.view.complete('6001'), false); assert.deepEqual(e.knowledge.hidden(), {});
    assert.equal(e.view.choose('6001', { status: 'complete', type: 'movie', coverage: null }).saved, true);
    e.profile('A'); assert.equal(e.view.complete('6001'), false); e.knowledge.dispose();
});

test('semantic summaries are immutable, reused for unchanged facts and invalidated by choices and expansion', () => {
    const e = setup(); e.knowledge.remember('1', { type: 'movie', status: 'complete' });
    e.view.choose('2', { type: 'series', status: 'complete', coverage: [['20', 2]] });
    const first = e.view.summary();
    assert.equal(e.view.summary(), first); assert.deepEqual(first.completeIds, ['1', '2']);
    assert.deepEqual(first.seriesIds, ['2']); assert.equal(first.saved.length, 2);
    assert.throws(() => first.completeIds.push('3'), TypeError);
    assert.throws(() => { first.saved[0].type = 'unknown'; }, TypeError);
    e.knowledge.remember('2', { type: 'series', coverage: [['20', 3]] });
    assert.deepEqual(e.view.summary().completeIds, ['1']); assert.deepEqual(first.completeIds, ['1', '2']);
    e.view.choose('1', { type: 'movie', status: 'main', coverage: null });
    assert.deepEqual(e.view.summary().completeIds, []);
    e.profile('B'); assert.deepEqual(e.view.summary().saved, []); e.knowledge.dispose();
});

test('legacy import preserves decisions, labels, hides, stale completion and both profile sources', () => {
    const manual = { version: 1, choices: { 1: {status:'complete',type:'series',coverage:[['10',2]]}, 2: {status:'main',type:'movie',coverage:null} } };
    const cache = {version:1,completionRatio:.9,savedAt:0,entries:{3:['movie','complete'],4:['series','complete'],5:['movie','unknown']}};
    const storage = new Map([['legacyMyListForNetflix.viewingChoices.v1.A',manual],['legacyMyListForNetflix.viewingCache.v1.A',cache],
        ['legacyMyListForNetflix.recommendationChoices.v1.A',{version:1,choices:{6:'hide'},titles:{1:'Named series',6:'Hidden'}}],
        ['legacyMyListForNetflix.viewingCache.v1.B',{...cache,entries:{7:['movie','complete']}}]]);
    const before=structuredClone([...storage]); const e=setup(storage);
    assert.equal(e.view.complete('1'),true); assert.equal(e.view.complete('2'),false); assert.equal(e.view.complete('3'),true);
    assert.equal(e.view.complete('4'),false,'legacy series retain evidence without invented episode coverage');
    assert.equal(fact(storage,'A','4','completion').source,'legacy-cache');
    assert.equal(e.knowledge.name('1'),'Named series'); assert.deepEqual(e.knowledge.hidden(),{6:'hide'});
    for(const [key,value] of before) assert.deepEqual(storage.get(key),value);
    e.profile('B'); assert.equal(e.view.complete('7'),true); assert.equal(e.view.complete('1'),false);
    e.knowledge.dispose(); const next=setup(storage); assert.equal(next.view.complete('3'),true); next.knowledge.dispose();
});

test('unknown observations and unrelated scans preserve completion and available names', () => {
    const e=setup(); e.knowledge.remember('1',{type:'movie',status:'complete',name:'Visible name'});
    e.knowledge.remember('1',{type:'movie',status:'unknown',name:''}); e.knowledge.remember('2',{type:'movie',status:'unknown'});
    assert.equal(e.view.complete('1'),true);assert.equal(e.knowledge.name('1'),'Visible name');
    e.view.choose('1',{status:'main',type:'movie',coverage:null});
    assert.equal(e.view.complete('1'),false);assert.equal(e.view.choice('1').name,'Visible name');
    e.knowledge.dispose();
});

test('series expansion invalidates current completion without deleting the remembered evidence', () => {
    const e=setup();e.knowledge.remember('1',{type:'series',status:'complete',coverage:[['10',2]],name:'Series'});
    assert.equal(e.view.complete('1'),true); e.knowledge.remember('1',{type:'series',coverage:[['10',3]]});
    assert.equal(e.view.complete('1'),false);assert.deepEqual(fact(e.storage,'A','1','completion').coverage,[['10',2]]);
    e.knowledge.remember('1',{type:'series',status:'complete',coverage:[['10',2]]});assert.equal(e.view.complete('1'),false);
    e.knowledge.remember('1',{type:'series',status:'complete',coverage:[['10',3]]});assert.equal(e.view.complete('1'),true);e.knowledge.dispose();
});

test('two active clients converge and independent title/manual/automatic writes survive', async () => {
    const storage=new Map(), a=setup(storage), b=setup(storage);let changes=[];
    const stop=b.knowledge.subscribe(value=>changes.push(value));
    a.view.choose('1',{status:'complete',type:'movie',coverage:null,name:'First'});
    b.view.choose('2',{status:'complete',type:'movie',coverage:null,name:'Second'});
    a.knowledge.remember('2',{type:'movie',status:'complete'});
    await settle(); assert.equal(a.view.complete('2'),true);assert.equal(b.view.complete('1'),true);assert.ok(changes.length);
    a.view.choose('1',{status:'main',type:'movie',coverage:null});await settle();assert.equal(b.view.complete('1'),false);
    b.profile('B');a.knowledge.remember('3',{type:'movie',status:'complete'});await settle();assert.equal(b.view.complete('3'),false);
    stop();a.knowledge.dispose();b.knowledge.dispose();assert.equal(a.knowledge.diagnostics().listeners,0);
});

test('interrupted migration resumes without changing originals or replacing a newer decision', () => {
    const key='legacyMyListForNetflix.viewingChoices.v1.A', original={version:1,choices:{1:{status:'complete',type:'movie',coverage:null},2:{status:'complete',type:'movie',coverage:null}}};
    const storage=new Map([[key,original]]),api=storageClient(storage);let deny=true;
    const e=createKnowledge({...api,activeProfile:()=> 'A',setValue(k,v){if(deny&&k.endsWith('2.manual'))throw new Error('denied');api.setValue(k,v);}});
    const view=e.view();view.sync();assert.equal(view.presentation().manualFailure,true);assert.deepEqual(storage.get(key),original);
    storage.set('legacyMyListForNetflix.knowledge.v2.A.1.manual',{status:'main',type:'movie',coverage:null,name:'Corrected'});
    deny=false;view.sync();assert.equal(view.complete('1'),false);assert.equal(view.complete('2'),true);assert.deepEqual(storage.get(key),original);e.dispose();
});

test('profile replacement inside storage cannot publish the old action', () => {
    const storage=new Map(),api=storageClient(storage);let profile='A', replace=false;
    const knowledge=createKnowledge({...api,activeProfile:()=>profile,setValue(k,v){api.setValue(k,v);if(replace&&k.endsWith('.manual'))profile='B';}});
    const view=knowledge.view();view.sync();replace=true;
    assert.equal(view.choose('1',{status:'complete',type:'movie',coverage:null}).saved,false);
    view.sync();assert.equal(view.complete('1'),false);assert.equal(fact(storage,'B','1','manual'),undefined);knowledge.dispose();
});


test('missed notifications recover through explicit resynchronization without losing the saved action', () => {
    const storage = new Map(), api = storageClient(storage);
    const writer = createKnowledge({ ...api, activeProfile: () => 'A', setValue(key, value) {
        if (key.endsWith('.signal')) throw new Error('notification denied');
        api.setValue(key, value);
    } });
    const reader = setup(storage), view = writer.view(); view.sync();
    assert.equal(view.choose('1', { status: 'complete', type: 'movie', coverage: null, name: 'Saved' }).saved, true);
    assert.equal(reader.view.complete('1'), false);
    reader.knowledge.resync();
    assert.equal(reader.view.complete('1'), true);
    assert.equal(writer.diagnostics().notificationFailures, 1);
    writer.dispose(); reader.knowledge.dispose();
});

test('a later manual action writes despite a delayed conflicting notification', async () => {
    const storage = new Map(), first = setup(storage), second = setup(storage);
    first.view.choose('1', { status: 'main', type: 'movie', coverage: null }); await settle();
    second.view.choose('1', { status: 'complete', type: 'movie', coverage: null });
    first.view.choose('1', { status: 'main', type: 'movie', coverage: null });
    await settle();
    assert.equal(first.view.complete('1'), false); assert.equal(second.view.complete('1'), false);
    first.knowledge.dispose(); second.knowledge.dispose();
});

test('distinct episode evidence survives a later stale base record and manual coverage is immutable', () => {
    const e = setup();
    e.knowledge.remember('1', { type: 'series', coverage: [['10', 2]], status: 'complete' });
    e.knowledge.remember('1', { type: 'series', coverage: [['10', 3]] });
    const key = 'legacyMyListForNetflix.knowledge.v2.A.1.metadata';
    e.storage.set(key, { type: 'series', coverage: [['10', 2]], baseline: [['10', 2]] });
    e.knowledge.resync(); assert.equal(e.view.complete('1'), false);
    e.view.choose('2', { type: 'series', status: 'complete', coverage: [['20', 2]] });
    assert.throws(() => { e.view.choice('2').coverage[0][1] = 99; }, TypeError);
    e.knowledge.dispose();
});


test('failed listener removal cannot reactivate an obsolete callback after same-profile restart', async () => {
    const storage = new Map(), api = storageClient(storage), callbacks = [];
    const knowledge = createKnowledge({ ...api, activeProfile: () => 'A',
        addValueChangeListener(key, callback) { callbacks.push(callback); return callbacks.length; },
        removeValueChangeListener() { throw new Error('host failure'); } });
    knowledge.view().sync(); const old = callbacks[0]; knowledge.dispose();
    knowledge.view().sync(); let deliveries = 0;
    knowledge.subscribe(() => { deliveries++; });
    old('signal', null, { sequence: 1 }, true); await settle();
    assert.equal(deliveries, 0); assert.equal(knowledge.diagnostics().listeners, 1);
    knowledge.dispose();
});
