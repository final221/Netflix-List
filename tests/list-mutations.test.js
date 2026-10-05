import test from 'node:test';
import assert from 'node:assert/strict';
import { createList } from '../src/list/list.js';
function fixture() {
    let now=0, token=1, next=0;const timers=new Map(), released=[], pending=new Map();
    const owner=createList({}).createMutations({now:()=>now,readSession:()=>token,isSessionActive:t=>t===token,
        setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
        ttl:30,hasRetained:()=>true,releaseRetained:id=>released.push(id),readPending:id=>pending.get(id)});
    return {owner,timers,released,pending,setNow:value=>now=value,setToken:value=>token=value};
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
    e.pending.set('1',{fallbackItem:one,correlationId:'first'});e.setNow(30);e.owner.pruneUndo();
    assert.equal(e.released.length,0);assert.equal(e.owner.correlationFor(one),'first');
    e.pending.set('1',{fallbackItem:{videoId:'1'},correlationId:'second'});
    assert.equal(e.owner.correlationFor(one),null);
});
test('obsolete expiry callbacks cannot clear a replacement Undo entry',()=>{
    const e=fixture(),one={videoId:'1'};e.owner.rememberUndo(one,0,'first');
    const stale=[...e.timers.values()][0].fn;e.owner.clearUndo();e.setToken(2);
    e.owner.rememberUndo(one,0,'second');stale();assert.equal(e.owner.latestUndo().correlationId,'second');
    assert.deepEqual(e.released,['first']);assert.equal(e.timers.size,1);
});

test('reentrant pending inspection cannot erase a newer same-title Undo entry',()=>{
    let owner,now=0,replace=false;const released=[],old={videoId:'1'},fresh={videoId:'1'};
    owner=createList({}).createMutations({now:()=>now,readSession:()=>1,isSessionActive:()=>true,
        setTimeout:()=>1,clearTimeout(){},ttl:30,hasRetained:()=>true,releaseRetained:id=>released.push(id),
        readPending(){if(replace){replace=false;owner.clearUndo();owner.rememberUndo(fresh,4,'new');}return null;}});
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
