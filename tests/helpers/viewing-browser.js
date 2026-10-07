import { createGrid } from '../../src/grid/grid.js';
import { createViewing } from '../../src/viewing/viewing.js';
import { createViewingData } from '../../src/netflix/viewing-data.js';
import { createNetflixContext } from '../../src/netflix/context.js';
import { createSessionScope } from '../../src/app/session-scope.js';
import { createCompletion } from '../../src/viewing/completion.js';
import { createI18n } from '../../src/i18n/i18n.js';
import { Element, createDocument } from './dom.js';
import { createScheduler } from './scheduler.js';

// Browser inputs and capability composition only. All scan, placement, cache,
// classification and rendering decisions run in the unmodified real owners.
export async function viewingEnvironment(count = 7, _existing = null, storage = new Map()) {
    const scheduler = createScheduler(), document = createDocument(), logs = [], warnings = [];
    const section = document.body.appendChild(new Element('section')), scroller = section.appendChild(new Element('div'));
    const location = { origin: 'https://www.netflix.com', href: 'https://www.netflix.com/browse/my-list' };
    const c = { ...scheduler, document, location, Date, VIEWING_REQUEST_CONCURRENCY: 2, VIEWING_MAX_REQUESTS: 32,
        VIEWING_MAX_PASSES: 3, VIEWING_TIMEOUT_MS: 30000, VIEWING_EPISODE_BATCH_SIZE: 200,
        VIEWING_CHOICES_STORAGE_KEY: 'test.viewingChoices.', VIEWING_CACHE_STORAGE_KEY: 'test.viewingCache.',
        VIEWING_CACHE_MAX_AGE_MS: 6*60*60*1000, log:(name,details)=>logs.push({name,details}),
        warn:(name,details)=>warnings.push({name,details}), active: true, isTargetPage:()=>true };
    const models = { userInfo:{guid:'owner-profile',userGuid:'active-profile',authURL:'test-auth-token'},
        services:{memberapi:{protocol:'https',hostname:'www.netflix.com',path:['/nq/website/memberapi/release']}},
        serverDefs:{BUILD_IDENTIFIER:'test-build'} };
    c.netflixModelData = name => models[name];
    c.netflixContext = createNetflixContext({ window:{netflix:{appContext:{getModelData:name=>c.netflixModelData(name)}}},document,location });
    c.sessionScope = createSessionScope({ isTargetPage:()=>c.active&&c.isTargetPage(),AbortController,...scheduler });
    c.sessionScope.begin();
    c.createRouteSessionCancelledError=c.sessionScope.cancelledError;
    c.isRouteSessionActive=c.sessionScope.isCurrent;
    c.suspendTargetSession=()=>{c.active=false;c.sessionScope.dispose();c.viewing.dispose(c.sourceState.watchStatus);};
    const i18n=createI18n({readLanguage:()=> 'en'});
    Object.assign(c,i18n);
    const created=[],createElement=document.createElement;document.createElement=(...args)=>{const node=createElement(...args);created.push(node);return node;};
    c.gridView=createGrid({document,location,tUi:i18n.tUi,formatUiNumber:i18n.formatUiNumber,formatItemCount:i18n.formatItemCount,
        runChunks:async(count,visit,guard)=>{for(let i=0;i<count;i++){guard();visit(i);}}});
    const items=Array.from({length:count},(_,i)=>{
        const snapshot=new Element('div'),card=snapshot.appendChild(new Element('a'));
        card.setAttribute('data-uia','standard-card'); card.href=`https://www.netflix.com/browse?jbv=${i+1}`;
        card.setAttribute('href',card.href);card.setAttribute('aria-label',`Native ${i+1}`);
        return {videoId:String(i+1),href:card.href,ariaLabel:`Native ${i+1}`,page:Math.floor(i/6),snapshot};
    });
    await c.gridView.publish({items,section,anchor:scroller,status:c.gridView.updateStatus('My List'),layout:{columns:6,gap:8,rowGap:10},
        geometry:{left:10,width:600,columns:6},assertCurrent(){}});
    const state=c.sourceState={items,totalCount:count,grid:c.gridView.root,cloneMap:new Map(items.map(item=>['v:'+item.videoId,c.gridView.getCard(item).node]))};
    Object.defineProperty(state,'cloneMap',{get:()=>new Map(state.items.map(item=>['v:'+item.videoId,c.gridView.getCard(item)?.node]))});
    const requests=[],storageCalls={reads:0,writes:0,cacheReads:0,cacheWrites:0};let cacheTime=Date.now(),fixtures;
    c.Date={now:()=>cacheTime};
    c.GM_getValue=(key,fallback)=>{storageCalls[key.startsWith('test.viewingCache.')?'cacheReads':'reads']++;return structuredClone(storage.get(key)??fallback);};
    c.GM_setValue=(key,value)=>{storageCalls[key.startsWith('test.viewingCache.')?'cacheWrites':'writes']++;storage.set(key,structuredClone(value));};
    c.fetch=async(url,options)=>{const paths=new URLSearchParams(options.body).getAll('path').map(JSON.parse);requests.push({url,options,paths});
        const graph=paths[0][0]==='seasons'||(Array.isArray(paths[0][2])&&!paths[0][2].includes('seasonCount'))?fixtures.episodes:paths[0][2]==='seasonList'?fixtures.seasons:fixtures.titles;
        return {ok:true,status:200,json:async()=>({jsonGraph:graph})};};
    c.viewingData=createViewingData({context:c.netflixContext,fetch:(...args)=>c.fetch(...args),createCancelledError:c.sessionScope.cancelledError});
    c.viewing=createViewing({activeProfile:()=>c.netflixContext.activeProfile(),now:()=>c.Date.now(),choicesKey:c.VIEWING_CHOICES_STORAGE_KEY,
        storageKey:c.VIEWING_CACHE_STORAGE_KEY,data:c.viewingData,performanceNow:()=>c.performance.now(),
        beginRequest:c.sessionScope.beginRequest,finishRequest:c.sessionScope.finishRequest,setRequestTimeout:c.sessionScope.setRequestTimeout,
        isCancelled:c.sessionScope.isCancelled,createCancelledError:c.sessionScope.cancelledError,log:c.log,warn:c.warn,
        scanLimits:()=>({concurrency:c.VIEWING_REQUEST_CONCURRENCY,requests:c.VIEWING_MAX_REQUESTS,passes:c.VIEWING_MAX_PASSES,timeout:c.VIEWING_TIMEOUT_MS,episodeBatch:c.VIEWING_EPISODE_BATCH_SIZE}),
        getValue:(...args)=>c.GM_getValue(...args),setValue:(...args)=>c.GM_setValue(...args)});
    function sync(changedIds=null,reason='reconcile') {
        if(!state.watchStatus)return;
        const watch=state.watchStatus,ids=c.viewing.reconcile(watch,changedIds);
        c.gridView.applyViewingChange({items:state.items,changedIds:ids,reason,assertCurrent:()=>c.viewing.assertCurrent(watch),
            metadata:{...c.viewing.presentation(watch),locale:'en',totalCount:state.totalCount},
            readPlacement:(item,classify)=>classify?c.viewing.placement(watch,item.videoId):{manual:c.viewing.hasChoice(watch,item.videoId)},
            onAction:item=>{c.lastAction=c.viewing.place(watch,item.videoId);sync(c.lastAction.changed,'manual-choice');},onRefresh:()=>c.viewing.refresh(watch),
            onRequest:reason=>sync([],reason)});
    }
    c.syncWatchGroups=()=>sync();
    c.initializeWatchGroups=()=>{state.watchStatus=c.viewing.createSession({sessionToken:c.sessionScope.token,readItems:()=>state.items,
        assertCurrent:()=>{c.sessionScope.assertCurrent(1);if(c.sourceState!==state||!c.isRouteSessionActive(1))throw c.sessionScope.cancelledError();},onChange:change=>sync(change.ids,change.reason),
        readPresentation:()=>({completed:c.gridView.presentation().completedCount,unknown:c.gridView.presentation().unknownCount})});
        c.viewing.start(state.watchStatus);};
    c.refreshViewingStatus=()=>c.viewing.refresh(state.watchStatus);
    c.collectViewingSeriesDiagnostics=()=>c.viewing.seriesDiagnostics(state.watchStatus);
    const completion=createCompletion();
    for(const [old,method] of Object.entries({classifyViewingVideo:'classifyVideo',classifyViewingSeries:'classifySeries',viewingLatestEpisode:'latestEpisode',viewingProgressSummary:'progress',viewingSeriesResult:'seriesResult'}))c[old]=completion[method];
    return {c,...scheduler,models,requests,storage,storageCalls,items,state,section,scroller,logs,warnings,created,
        fixtures:()=>fixtures,setFixtures:value=>{fixtures=value;},setCacheTime:value=>{cacheTime=value;},
        async start(){c.initializeWatchGroups();await c.viewing.settled(state.watchStatus);}};
}
