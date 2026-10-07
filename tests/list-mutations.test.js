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

function queueFixture(extra={}) {
    let next=0,ticket=null;const timers=new Map(),observers=[],microtasks=[],warnings=[];
    const owner=createList({}).createMutations({now:()=>0,readSession:()=>1,isSessionActive:()=>true,
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
    const parent={},native={videoId:'1'},fallback={videoId:'1'},calls=[];
    const e=queueFixture({applyMutation:null,readParent:()=>parent,canApply:()=>true,hasMember:()=>false,
        refreshNative:()=>({track:{}}),observeNative:()=>{throw new Error('unneeded discovery');},captureNative:()=>native,
        hasMaterial:item=>item===native,preferredIndexForNative:()=>4,assertNative:()=>calls.push('admit'),
        addMember:(item,index,reason,correlation)=>{calls.push({item,index,reason,correlation});return true;},
        alignVisible:()=>calls.push('align')});
    const intent=e.owner.observeMembership({videoId:'1',action:'add',fallbackItem:fallback,correlationId:'old'});
    assert.equal(e.owner.reconcileMutation(intent,'change'),true);assert.equal(e.owner.pendingMutation('1'),null);
    assert.deepEqual(calls,['admit',{item:native,index:4,reason:'change-native',correlation:null},'align']);
});
test('reconciliation preserves intent when a candidate callback replaces the admitted parent',()=>{
    let parent={};const original=parent;let added=0;
    const e=queueFixture({applyMutation:null,readParent:()=>parent,canApply:()=>true,hasMember:()=>false,
        refreshNative:()=>({track:{}}),captureNative:()=>{parent={};return {videoId:'1'};},
        addMember:()=>{added++;return true;}});
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
