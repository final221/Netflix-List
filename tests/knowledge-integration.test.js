import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/viewing.js';
import { createBrowsingViewing } from '../src/viewing/viewing.js';

test('an active browsing owner sees a My List decision without reopening', async () => {
 const e=await fixture();
 const browsing=createBrowsingViewing({environment:globalThis,context:{activeProfile:()=> 'a'},userscript:{getValue:(k,f)=>e.storage.get(k)??f,setValue:(k,v)=>e.storage.set(k,v),listValues:()=>[...e.storage.keys()]},isCurrent:()=>true,onChange(){}});
 try { browsing.reset(); e.viewing.place(e.watch,'1'); assert.equal(browsing.complete('1'),true); }
 finally { browsing.dispose();e.viewing.dispose(e.watch);e.retire(); }
});

test('acknowledged film completion survives a later unknown scan', async () => {
 const e=await fixture();
 try { e.records.set('1',{type:'movie',watched:true});await e.refresh();assert.equal(e.viewing.placement(e.watch,'1').status,'complete');
 e.records.delete('1');await e.refresh();assert.equal(e.viewing.placement(e.watch,'1').status,'complete'); }
 finally {e.viewing.dispose(e.watch);e.retire();}
});
