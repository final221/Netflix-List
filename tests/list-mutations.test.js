import test from 'node:test';
import assert from 'node:assert/strict';
import { createList } from '../src/list/list.js';
function fixture() {
    let now=0, token=1, next=0;const timers=new Map(), released=[];
    const owner=createList({}).createMutations({now:()=>now,readSession:()=>token,isSessionActive:t=>t===token,
        setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
        ttl:30,hasRetained:()=>true,releaseRetained:id=>released.push(id)});
    return {owner,timers,released,setNow:value=>now=value,setToken:value=>token=value};
}
test('list owns one expiry timer and exact record Undo correlation',()=>{
    const e=fixture(),one=Object.freeze({videoId:'1',ariaLabel:'One'});
    e.owner.rememberUndo(one,2,'old');assert.equal(e.timers.size,1);
    assert.equal(e.owner.correlationFor(one),'old');assert.equal(e.owner.correlationFor({videoId:'1'}),null);
    assert.equal(e.owner.latestUndo().index,2);e.setNow(30);[...e.timers.values()][0].fn();
    assert.equal(e.owner.latestUndo(),null);assert.deepEqual(e.released,['old']);
});
test('Undo expiry preserves only the exact pending record and correlation',()=>{
    const e=fixture(),one={videoId:'1'};e.owner.rememberUndo(one,0,'first');
    e.owner.observeMembership({videoId:'1',action:'add',fallbackItem:one,correlationId:'first'});e.setNow(30);e.owner.pruneUndo();
    assert.equal(e.released.length,0);assert.equal(e.owner.correlationFor(one),'first');
    e.owner.observeMembership({videoId:'1',action:'add',fallbackItem:{videoId:'1'},correlationId:'second'});
    assert.equal(e.owner.correlationFor(one),null);
});
test('obsolete expiry callbacks cannot clear a replacement Undo entry',()=>{
    const e=fixture(),one={videoId:'1'};e.owner.rememberUndo(one,0,'first');
    const stale=[...e.timers.values()][0].fn;e.owner.clearUndo();e.setToken(2);
    e.owner.rememberUndo(one,0,'second');stale();assert.equal(e.owner.latestUndo().correlationId,'second');
    assert.deepEqual(e.released,['first']);assert.equal(e.timers.size,1);
});

test('reentrant resource release cannot erase a newer same-title Undo entry',()=>{
    let owner,now=0,replace=false;const released=[],old={videoId:'1'},fresh={videoId:'1'};
    owner=createList({}).createMutations({now:()=>now,readSession:()=>1,isSessionActive:()=>true,
        setTimeout:()=>1,clearTimeout(){},ttl:30,hasRetained:()=>true,releaseRetained(id){released.push(id);if(replace){replace=false;owner.clearUndo();owner.rememberUndo(fresh,4,'new');}}});
    owner.rememberUndo(old,0,'old');now=30;replace=true;owner.pruneUndo();
    assert.equal(owner.latestUndo().item,fresh);assert.equal(owner.correlationFor(fresh),'new');
    assert.deepEqual(released,['old']);
});
test('title normalization that clears ownership cannot publish the abandoned Undo record',()=>{
    let owner,retire=false;const item={videoId:'1'};
    owner=createList({}).createMutations({now:()=>0,readSession:()=>1,isSessionActive:()=>true,
        setTimeout:()=>1,clearTimeout(){},ttl:30,hasRetained:()=>true,releaseRetained(){},
        normalizeTitle(){if(retire)owner.clearUndo();return 'title';}});
    retire=true;owner.rememberUndo(item,0,'old');assert.equal(owner.latestUndo(),null);
});

function queueFixture(extra={},list=createList({})) {
    let next=0,ticket=null;const timers=new Map(),observers=[],microtasks=[],warnings=[];
    const owner=list.createMutations({now:()=>0,readSession:()=>1,isSessionActive:()=>true,
        setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
        ttl:30,hasRetained:()=>true,releaseRetained(){},mutationTimeout:10,
        applyMutation:()=>false,
        observeChanges:fn=>{const o={fn,disconnects:0,disconnect(){this.disconnects++;}};observers.push(o);return o;},
        queueMicrotask:fn=>microtasks.push(fn),onTimeout:detail=>warnings.push(detail),...extra});
    return {owner,timers,observers,microtasks,warnings,setDeferred(value) { if(value)ticket=owner.deferReconciliation('test');else { ticket?.release({resume:false});ticket=null; } }};
}

test('observed clicks use membership rather than the advertised Netflix action and retain no DOM facts',()=>{
    let present=false;const e=queueFixture({canApply:()=>true,hasMember:()=>present});
    const facts={videoId:'1',uiaAction:'remove',uia:'remove-from-my-list',button:{},trackingContext:{}};
    const added=e.owner.observeClick(()=>({membership:facts}));
    assert.equal(added.action,'add');assert.equal(added.button,undefined);assert.equal(added.trackingContext,undefined);
    present=true;const removed=e.owner.observeClick(()=>({membership:{...facts,uiaAction:'add'}}));
    assert.equal(removed.action,'remove');assert.equal(e.observers.length,2);assert.equal(e.timers.size,1);
});

test('toast click selects the latest valid canonical Undo entry and copies its exact correlation and index',()=>{
    let now=0;const e=queueFixture({now:()=>now,canApply:()=>true,hasMember:()=>false});
    const first={videoId:'1'},second={videoId:'2'};
    e.owner.rememberUndo(first,4,'one');now=1;e.owner.rememberUndo(second,7,'two');
    assert.equal(e.owner.observeClick(()=>({toastAction:false})),null);
    const intent=e.owner.observeClick(()=>({toastAction:true}));
    assert.equal(intent.fallbackItem,second);assert.equal(intent.correlationId,'two');assert.equal(intent.preferredIndex,7);
    assert.equal(intent.undo,true);assert.equal(intent.uiaAction,'undo');
    now=31;e.owner.pruneUndo();assert.equal(e.owner.observeClick(()=>({toastAction:true})),null);
    assert.equal(e.owner.pendingMutation('2'),intent);
});

test('click admission rejects parent replacement, session retirement and newer intents during interpretation',()=>{
    let parent={},replace=false,e;
    e=queueFixture({canApply:()=>true,readParent:()=>parent,hasMember(){if(replace)parent={};return false;}});
    assert.equal(e.owner.observeClick(()=>{parent={};return {membership:{videoId:'1'}};}),null);
    replace=true;assert.equal(e.owner.observeClick(()=>({membership:{videoId:'1'}})),null);replace=false;
    assert.equal(e.owner.observeClick(()=>{e.owner.queueMutation({videoId:'2',action:'remove'});return {membership:{videoId:'1'}};}),null);
    assert.equal(e.owner.pendingMutation('2').action,'remove');assert.equal(e.owner.pendingMutation('1'),null);
    e.owner.dispose();let reads=0;assert.equal(e.owner.observeClick(()=>{reads++;return {membership:{videoId:'1'}};}),null);
    assert.equal(reads,0);
});

test('Undo click does not borrow a reentrant replacement removal during expiry cleanup',()=>{
    let now=0,replace=false,e;const old={videoId:'1'},fresh={videoId:'2'};
    e=queueFixture({now:()=>now,canApply:()=>true,releaseRetained(){if(replace){replace=false;e.owner.rememberUndo(fresh,3,'fresh');}}});
    e.owner.rememberUndo(old,0,'old');now=30;replace=true;
    assert.equal(e.owner.observeClick(()=>({toastAction:true})),null);
    assert.equal(e.owner.pendingIntents().length,0);assert.equal(e.owner.latestUndo().item,fresh);
});

test('click fallback capture cannot queue on a replacement parent and membership controls take precedence over toast facts',()=>{
    let parent={},e;
    e=queueFixture({canApply:()=>true,readParent:()=>parent,hasMember:()=>false,
        findFallback(){parent={};return {videoId:'1'};}});
    assert.equal(e.owner.observeClick(()=>({membership:{videoId:'1'}})),null);
    assert.equal(e.timers.size,0);assert.equal(e.observers.length,0);
    const valid=queueFixture({canApply:()=>true,hasMember:()=>true});
    valid.owner.rememberUndo({videoId:'2'},5,'undo');
    const intent=valid.owner.observeClick(()=>({membership:{videoId:'1',uiaAction:'add'},toastAction:true}));
    assert.equal(intent.videoId,'1');assert.equal(intent.action,'remove');assert.equal(intent.undo,false);
});

test('toast interpretation rejects a newer removal and still admits surviving entries after normal expiry',()=>{
    let now=0;const e=queueFixture({now:()=>now,canApply:()=>true});
    e.owner.rememberUndo({videoId:'1'},0,'old');
    assert.equal(e.owner.observeClick(()=>{now=1;e.owner.rememberUndo({videoId:'2'},2,'new');return {toastAction:true};}),null);
    now=30;const intent=e.owner.observeClick(()=>({toastAction:true}));
    assert.equal(intent.videoId,'2');assert.equal(intent.correlationId,'new');
});
test('list queue owns immutable intents and replaces exact observer/timer resources',()=>{
    const e=queueFixture(),first=e.owner.queueMutation({videoId:'1',action:'remove'});
    assert.equal(Object.isFrozen(first),true);assert.equal(first.observer,undefined);assert.equal(first.timeoutId,undefined);
    const staleObserver=e.observers[0].fn,staleTimer=[...e.timers.values()][0].fn;
    const next=e.owner.queueMutation({videoId:'1',action:'add'});
    assert.equal(e.observers[0].disconnects,1);assert.equal(e.timers.size,1);
    staleObserver();staleTimer();e.owner.disposeMutation('1',first);
    assert.equal(e.owner.pendingMutation('1'),next);assert.equal(e.warnings.length,0);
});
test('busy queue timeout defers disposal and retry restarts the bounded wait',()=>{
    const e=queueFixture();e.setDeferred(true);const intent=e.owner.queueMutation({videoId:'1',action:'add'});
    const [id,timer]=[...e.timers][0];e.timers.delete(id);timer.fn();
    assert.equal(intent.deferredWhileBusy,true);assert.equal(e.owner.pendingMutation('1'),intent);
    e.setDeferred(false);e.owner.retryMutations('ready');assert.equal(e.timers.size,1);
    const [last,timeout]=[...e.timers][0];e.timers.delete(last);timeout.fn();
    assert.equal(e.owner.pendingMutation('1'),null);assert.equal(e.warnings.length,1);
});
test('queue clearing invalidates intents before observer cleanup can queue a replacement',()=>{
    let owner,reenter=true;const e=queueFixture({observeChanges:()=>({disconnect(){if(reenter){reenter=false;owner.queueMutation({videoId:'1',action:'add'});}}})});
    owner=e.owner;const old=owner.queueMutation({videoId:'1',action:'remove'});owner.clearPending();
    assert.equal(owner.isMutationCurrent(old),false);assert.equal(owner.pendingMutation('1').action,'add');
    assert.equal(e.timers.size,1);
});

test('native candidate wins over captured fallback with admitted order and no borrowed Undo correlation',()=>{
    const tree={},native={videoId:'3',snapshot:tree},fallback={videoId:'3',snapshot:{}},calls=[];
    const e=publicationFixture({applyMutation:null,
        refreshNative:()=>({track:{}}),observeNative:()=>{throw new Error('unneeded discovery');},captureNative:()=>native,
        hasMaterial:item=>item===native,assertNative:()=>calls.push('admit'),
        readVisible:()=>({ids:['3'],page:2,columns:2,available:true,assertCurrent(){}}),
        insertCard(item,{index,material,correlationId,onAccepted,releaseMaterial}){
            calls.push({index,source:material.source,correlationId});onAccepted();releaseMaterial();}});
    const intent=e.owner.observeMembership({videoId:'3',action:'add',fallbackItem:fallback,correlationId:'old'});
    assert.equal(e.owner.reconcileMutation(intent,'change'),true);assert.equal(e.owner.pendingMutation('3'),null);
    assert.deepEqual(calls,['admit',{index:2,source:tree,correlationId:null}]);
    assert.equal(e.membership.records[2],e.list.toRecord(native));assert.equal(native.snapshot,null);assert.ok(fallback.snapshot);
    assert.equal(e.events.find(event=>event.kind==='add').reason,'change-native');
});
test('reconciliation preserves intent when a candidate callback replaces the admitted parent',()=>{
    let parent={};const original=parent;let added=0;
    const e=queueFixture({applyMutation:null,readParent:()=>parent,canApply:()=>true,hasMember:()=>false,
        refreshNative:()=>({track:{}}),captureNative:()=>{parent={};return {videoId:'1'};},
        insertCard:()=>{added++;return true;}});
    const intent=e.owner.observeMembership({videoId:'1',action:'add'});
    assert.equal(e.owner.reconcileMutation(intent),false);assert.notEqual(parent,original);
    assert.equal(added,0);assert.equal(e.owner.pendingMutation('1'),intent);
});
test('failed observer setup drops its intent and leaves no timer or retained correlation',()=>{
    const released=[];const e=queueFixture({observeChanges(){throw new Error('observer setup');},releaseRetained:id=>released.push(id)});
    assert.throws(()=>e.owner.queueMutation({videoId:'1',action:'add',correlationId:'old'}),/observer setup/);
    assert.equal(e.owner.pendingMutation('1'),null);assert.equal(e.timers.size,0);assert.deepEqual(released,['old']);
});

test('replacement queue inherits only its exact pending record and correlation after Undo expiry',()=>{
    const released=[],e=queueFixture({releaseRetained:id=>released.push(id)}),item={videoId:'1'};
    e.owner.rememberUndo(item,0,'old');
    e.owner.queueMutation({videoId:'1',action:'add',fallbackItem:item,correlationId:'old'});
    e.owner.pruneUndo(30);assert.deepEqual(released,[]);
    const next=e.owner.queueMutation({videoId:'1',action:'add',fallbackItem:item,correlationId:'old'});
    assert.deepEqual(released,[]);assert.equal(e.owner.pendingMutation('1'),next);
    e.owner.disposeMutation('1',next);assert.deepEqual(released,['old']);
});

test('only final exact deferral release resumes deferred intents and repeated release is inert',()=>{
    let attempts=0;const e=queueFixture({applyMutation:()=>{attempts++;return false;}});
    const first=e.owner.deferReconciliation('initialization'),second=e.owner.deferReconciliation('refresh');
    const intent=e.owner.observeMembership({videoId:'1',action:'add'});
    assert.equal(e.owner.reconcileMutation(intent),false);assert.equal(attempts,0);
    first.release();first.release();assert.equal(attempts,0);second.release();assert.equal(attempts,1);
    second.release();assert.equal(attempts,1);assert.equal(e.timers.size,1);
});
test('disposed deferral cannot release or drain a replacement transaction',()=>{
    let attempts=0;const e=queueFixture({applyMutation:()=>{attempts++;return false;}});
    const old=e.owner.deferReconciliation('old');e.owner.queueMutation({videoId:'1',action:'remove'});e.owner.dispose();e.owner.start();
    const fresh=e.owner.deferReconciliation('fresh'),intent=e.owner.observeMembership({videoId:'1',action:'add'});
    e.owner.reconcileMutation(intent);old.release();assert.equal(attempts,0);assert.equal(e.owner.pendingMutation('1'),intent);
    fresh.release();assert.equal(attempts,1);
});

test('list disposal attempts every resource cleanup and old callbacks remain inert after failures',()=>{
    let cancelled=0,attempts=0;const e=queueFixture({applyMutation:()=>{attempts++;return false;},
        clearTimeout(){cancelled++;if(cancelled===1)throw new Error('timer cleanup');}});
    const first=e.owner.queueMutation({videoId:'1',action:'remove'}),second=e.owner.queueMutation({videoId:'2',action:'remove'});
    const stale=e.observers[0].fn;e.observers[0].disconnect=()=>{throw new Error('observer cleanup');};
    assert.doesNotThrow(()=>e.owner.dispose());
    assert.equal(cancelled,2);assert.equal(e.observers[1].disconnects,1);
    assert.equal(e.owner.pendingIntents().length,0);assert.equal(e.owner.isMutationCurrent(first),false);
    assert.equal(e.owner.isMutationCurrent(second),false);stale();assert.equal(attempts,0);
    assert.equal(e.owner.deferralDiagnostics().cleanupFailures,2);
});

function publicationFixture(extra={}) {
    const list=createList({}),membership=list.createMembership({items:[list.toRecord({videoId:'1'}),list.toRecord({videoId:'2'})],totalCount:2});
    let parent={},layout={mode:'indicator',columns:2},visible={ids:['2','1'],page:0,columns:2,available:true,assertCurrent(){}};
    const retained=new Map(),cards=new Set(membership.records),hints=new Map(),events=[];
    const options={readParent:()=>parent,readMembership:()=>membership,canApply:()=>true,hasMember:id=>membership.lookup.has('v:'+id),
        hasRetained:(id,item)=>retained.get(id)===item,releaseRetained:id=>retained.delete(id),
        hasMaterial:(item,id)=>Boolean(item?.snapshot)||retained.get(id)===item,
        hasCard:item=>cards.has(item),retireCard(item,{correlationId,assertCurrent,onAccepted}){assertCurrent();cards.delete(item);retained.set(correlationId,item);onAccepted();},
        canInsertCard:()=>true,insertCard(item,{onAccepted,releaseMaterial,assertCurrent}){assertCurrent();cards.add(item);onAccepted();releaseMaterial();},
        readLayout:()=>({...layout,assertCurrent(){}}),readPage:item=>hints.get(item),writePage:(item,page)=>hints.set(item,page),
        updateCard(){},sample:fn=>fn(),readVisible:()=>visible,
        refreshMapping:()=>false,onOrder:(change)=>events.push({kind:'order',ids:change.ordered.map(item=>item.videoId)}),
        onReindexed:facts=>events.push({kind:'presentation',count:facts.count,empty:facts.empty}),
        onChanged:facts=>events.push(facts),...extra};
    const e=queueFixture(options,list);
    return {...e,list,membership,retained,cards,hints,events,replaceParent(){parent={};},setLayout:value=>layout=value,setVisible:value=>visible=value};
}

test('list publication owns removal, exact Undo reinsertion, count/order and separate material release',()=>{
    const e=publicationFixture(),original=e.membership.records[0];
    assert.equal(e.owner.remove('1'),true);const entry=e.owner.latestUndo();
    assert.equal(entry.item,original);assert.equal(entry.index,0);assert.equal(e.membership.expectedCount,1);
    assert.equal(e.owner.add(original,entry.index,'undo',entry.correlationId),true);
    assert.equal(e.membership.records[0],original);assert.equal(e.membership.expectedCount,2);assert.equal(e.owner.latestUndo(),null);
    const input={videoId:'3',page:9,snapshot:{}};
    assert.equal(e.owner.add(input,99),true);assert.equal(input.snapshot,null);assert.equal(e.membership.records[2].videoId,'3');
    assert.equal(Object.hasOwn(e.membership.records[2],'snapshot'),false);assert.equal(Object.hasOwn(e.membership.records[2],'page'),false);
    assert.equal(e.owner.add({videoId:'3',snapshot:{}},0),false);assert.equal(e.owner.remove('unknown'),false);
    assert.equal(e.hints.get(e.membership.records[2]),1);
});

test('list visible-order policy chooses admitted insertion positions and preserves logical hints on alignment',()=>{
    const e=publicationFixture();e.setLayout({mode:'logical',columns:2});
    const original=[...e.membership.records];for(const item of original)e.hints.set(item,9);
    assert.equal(e.owner.preferredIndex('1',{}),1);assert.equal(e.owner.preferredIndex('missing',{}),0);
    assert.equal(e.owner.reconcileOrder({}),true);assert.deepEqual(e.membership.records.map(item=>item.videoId),['2','1']);
    assert.equal(e.hints.get(original[0]),9);assert.equal(e.owner.reconcileOrder({}),false);
    e.setVisible({ids:['1','1'],page:0,columns:2,available:true,assertCurrent(){}});assert.equal(e.owner.reconcileOrder({}),false);
    e.setVisible({ids:['unknown'],page:0,columns:2,available:true,assertCurrent(){}});assert.equal(e.owner.reconcileOrder({}),false);
    e.owner.reindex('mutation-reindex');assert.equal(e.hints.get(original[0]),0);
});

test('publication rejects parent replacement and releases cancelled transfer without accepting membership',()=>{
    let e,staged;const input={videoId:'3',snapshot:{}};
    e=publicationFixture({readLayout(){e.replaceParent();return {columns:2,assertCurrent(){}};},insertCard(){throw new Error('obsolete insert');}});
    assert.throws(()=>e.owner.add(input),{code:'NATIVE_SOURCE_REPLACED'});
    assert.equal(e.membership.records.length,2);assert.ok(input.snapshot);assert.equal(e.owner.undoEntries().length,0);
    e=publicationFixture({insertCard(item,operations){staged=operations;e.replaceParent();operations.assertCurrent();}});
    assert.throws(()=>e.owner.add(input),{code:'NATIVE_SOURCE_REPLACED'});assert.equal(staged.material.source,input.snapshot);
    assert.equal(e.membership.records.length,2);assert.ok(input.snapshot);
});

test('reentrant retirement or order publication cannot change the replacement membership',()=>{
    let e;const before=[];
    e=publicationFixture({retireCard(){e.replaceParent();}});before.push(...e.membership.records);
    assert.throws(()=>e.owner.remove('1'),{code:'NATIVE_SOURCE_REPLACED'});assert.deepEqual(e.membership.records,before);
    e=publicationFixture({onOrder(){e.replaceParent();}});
    assert.throws(()=>e.owner.reconcileOrder({}),{code:'NATIVE_SOURCE_REPLACED'});
    assert.deepEqual(e.membership.records.map(item=>item.videoId),['2','1']);
    assert.equal(e.events.length,0,'obsolete presentation does not run after accepted order');
});

test('last removal publishes truthful empty count and disposed publication cannot start collaborators',()=>{
    const e=publicationFixture();e.owner.remove('1');e.owner.remove('2');
    assert.equal(e.membership.expectedCount,0);assert.equal(e.membership.collectedCount,0);
    assert.ok(e.events.some(fact=>fact.kind==='presentation'&&fact.empty&&fact.count===0));
    e.owner.dispose();const count=e.events.length;
    assert.equal(e.owner.remove('1'),false);assert.equal(e.owner.add({videoId:'3',snapshot:{}}),false);
    assert.equal(e.owner.reconcileOrder({}),false);assert.equal(e.events.length,count);
});

test('publication requires exact card acceptance and rejects stale layout before consuming captured material',()=>{
    let e=publicationFixture({insertCard(){return false;}}),input={videoId:'3',snapshot:{}};
    assert.throws(()=>e.owner.add(input),{code:'LIST_PUBLICATION_REJECTED'});assert.equal(e.membership.records.length,2);assert.ok(input.snapshot);
    e=publicationFixture({readLayout:()=>({columns:2,assertCurrent(){throw Object.assign(new Error('stale'),{code:'NATIVE_SOURCE_REPLACED'});}})});
    assert.throws(()=>e.owner.add(input),{code:'NATIVE_SOURCE_REPLACED'});assert.equal(e.membership.records.length,2);assert.ok(input.snapshot);
});

test('accepted retirement precedes resource callbacks and cannot repaint over a reentrant newer publication',()=>{
    let e,once=true;const input={videoId:'3',snapshot:{}};
    e=publicationFixture({retireCard(record,{onAccepted}){onAccepted();assert.equal(e.membership.lookup.has('v:1'),false);
        if(once){once=false;e.owner.add(input,0,'new');}}});
    assert.throws(()=>e.owner.remove('1'),{code:'NATIVE_SOURCE_REPLACED'});
    assert.deepEqual(e.membership.records.map(item=>item.videoId),['3','2']);
    assert.equal(e.membership.expectedCount,2);assert.equal(e.owner.latestUndo(),null);
    assert.equal(e.events.filter(event=>event.kind==='remove').length,0);
    assert.equal(e.events.filter(event=>event.kind==='add').length,1);
});

test('unaccepted Undo insertion preserves the accepted hint and abandoned removal releases only its own correlation',()=>{
    let accept=true,e=publicationFixture({insertCard(item,{onAccepted,releaseMaterial}){if(accept){onAccepted();releaseMaterial();}}});
    const record=e.membership.records[0];e.owner.remove('1');const entry=e.owner.latestUndo();e.hints.set(record,9);accept=false;
    assert.throws(()=>e.owner.add(record,0,'undo',entry.correlationId),{code:'LIST_PUBLICATION_REJECTED'});
    assert.equal(e.hints.get(record),9);assert.equal(e.retained.get(entry.correlationId),record);
    let abandoned;
    e=publicationFixture({retireCard(record,{onAccepted,correlationId}){e.retained.set(correlationId,record);abandoned=correlationId;onAccepted();e.replaceParent();}});
    assert.throws(()=>e.owner.remove('1'),{code:'NATIVE_SOURCE_REPLACED'});assert.equal(e.retained.has(abandoned),false);
});


test('pre-publication click uses explicit native action without treating an accepted absent title as removal', () => {
    let present = null; const e = queueFixture({ canApply: () => true, hasMember: () => present });
    const membership = { videoId: '1', uiaAction: 'remove', uia: 'remove-from-my-list-with-undo' };
    assert.equal(e.owner.observeClick(() => ({ membership })).action, 'remove');
    present = false;
    assert.equal(e.owner.observeClick(() => ({ membership })).action, 'add');
    present = null;
    assert.equal(e.owner.observeClick(() => ({ membership: { ...membership, uiaAction: 'add' } })).action, 'add');
    e.owner.dispose();
});
