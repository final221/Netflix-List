import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const bundled = await build({ entryPoints: ['scripts/recommendation-prototype.js'], bundle: true,
    write: false, format: 'iife', globalName: 'RecommendationExperiment' });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Recommendation refill experiment</title>
<style>body{font:16px system-ui;background:#141414;color:#eee;max-width:1050px;margin:40px auto;padding:20px}button,select{font:inherit;padding:8px;margin:4px;background:#303030;color:white;border:1px solid #777;border-radius:5px}button:disabled{opacity:.45}#cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:15px;margin:25px 0}.card{padding:20px;background:#242424;border-radius:10px}.card h2{font-size:20px}#status{padding:12px;background:#252525}small{color:#bbb}</style>
<h1>Watched, without a thumbs-down</h1><p>Offline simulation with fictional titles and finite pages. This page does not connect to Netflix or change ratings.</p>
<label>Profile <select id="profile"><option>A</option><option>B</option></select></label>
<button id="undo">Undo last dismissal</button><button id="more">Try more pages</button><button id="reset">Reset this profile</button>
<div id="cards"></div><p id="status" role="status"></p><p id="choices"></p>
<small>Each request returns four titles. Refill stops at the end of the row or a request limit. Dismissed titles recur across pages to exercise duplicate filtering. Choices persist locally per demo profile. Series/new-episode handling and Netflix hover integration are outside this experiment.</small>
<script>${bundled.outputFiles[0].text}
const names=['Northern Lights','The Last Train','Paper Kingdom','Ocean Road','Quiet City','After the Rain','Hidden Valley','Moon Garden','Winter Letters','The Long Weekend','Glass Harbour','Second Sunrise'];
const titles=names.map((title,i)=>({id:String(i+1),title}));
const pages=[titles.slice(0,4),[titles[0],...titles.slice(4,7)],titles.slice(7,11),[titles[4],titles[11]]];
const key=p=>'netflix-refill-offline-demo.'+p;
const controller=RecommendationExperiment.createRecommendationPrototype({
loadChoices:p=>JSON.parse(localStorage.getItem(key(p))||'{}'),saveChoices:(p,c)=>localStorage.setItem(key(p),JSON.stringify(c)),
getPage:async({cursor})=>{const i=cursor===null?0:Number(cursor);return {cards:pages[i],hasNextPage:i<pages.length-1,endCursor:String(i+1)}}});
const cards=document.getElementById('cards'),profile=document.getElementById('profile'),undo=document.getElementById('undo'),more=document.getElementById('more');
function render(){const s=controller.snapshot();cards.replaceChildren();for(const card of s.cards){const box=document.createElement('div');box.className='card';const h=document.createElement('h2');h.textContent=card.title;box.append(h);for(const [reason,label] of [['watched','Already watched'],['hide','Hide suggestion']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>run(()=>controller.dismiss(card.id,reason));box.append(b)}cards.append(box)}undo.disabled=!s.canUndo;more.disabled=s.busy;document.getElementById('status').textContent=s.status==='exhausted'?'Row exhausted: no further titles supplied.':s.status==='failed'?'Refill failed; current titles retained.':'Refill: '+s.status;document.getElementById('status').textContent+=' | Requests: '+s.requests+' | Cards: '+s.cards.length;document.getElementById('choices').textContent='Saved dismissals: '+Object.keys(s.choices).length+' | Ratings changed: 0';}
async function run(action){try{await action();render()}catch(e){document.getElementById('status').textContent='Could not save choice: '+e.message}}
profile.onchange=()=>run(()=>{controller.selectProfile(profile.value);return controller.refill()});undo.onclick=()=>run(()=>controller.undo());more.onclick=()=>run(()=>controller.refill());document.getElementById('reset').onclick=()=>run(()=>{localStorage.removeItem(key(profile.value));controller.selectProfile(profile.value);return controller.refill()});
run(()=>{controller.selectProfile(profile.value);return controller.refill()});
</script></html>`;
await writeFile('docs/recommendation-demo.html', html);
console.log('Created docs/recommendation-demo.html');
