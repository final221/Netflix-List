'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Supplementary characterization uses the actual private implementation inside
// one instance. Public acceptance scenarios use the unmodified ESM capability.
const names = ['pairDomTrees','releaseGridReact','invalidateGridReact','restoreGeometryProxy','clearSourceAlignment',
    'makeClientRectList','releaseNativeHover','nativeHoverSourceMatches','finishNativePreviewDiagnostic',
    'inspectNativePreviewDiagnostic','scheduleNativePreviewDiagnostic','nativePreviewNodeVideoId','findNativeHoverPreview',
    'retainNativeHoverForPreview','clearNativePreviewTransfer','releaseNativePreview','nativePreviewOwnerMatches',
    'handleTargetPreviewPointerOut','alignSourceSlotToClone','replayHoverOnNativeSource','scheduleNativeHoverReplay','makeLiveClone'];
const fields = ['activeSourceSlot','activeGeometryProxy','activeNativeHover','graftedGridClones','netflixReactHover'];
function install(c) {
    let source = fs.readFileSync(path.join(__dirname,'../../src/netflix/native-popup.js'),'utf8')
        .replace('export function createNativePopup','function createNativePopup')
        .replace('const netflixReactHover =','let netflixReactHover =').replace('const graftedGridClones =','let graftedGridClones =');
    source = source.replace('    // Public capability:', `    options.inspect(Object.defineProperties({}, {${[...names,...fields].map(name=>`${name}: {get: () => ${name}, set: value => {${name} = value;}}`).join(',')}}));\n    // Public capability:`);
    const factory = vm.runInNewContext(source+'\ncreateNativePopup;', { Proxy, Object, Map, Set, WeakMap, Promise });
    let internals;
    const popup = factory({ Element: c.Element, Node: c.Node || c.Element,
        get document(){return c.document || {};}, get PointerEvent(){return c.PointerEvent;}, get MouseEvent(){return c.MouseEvent;},
        performance: {now:()=>c.performance.now()}, requestAnimationFrame:cb=>c.requestAnimationFrame(cb), cancelAnimationFrame:key=>c.cancelAnimationFrame(key),
        setTimeout:(...args)=>c.setTimeout(...args),clearTimeout:key=>c.clearTimeout(key),
        carousel:{sample:cb=>c.withNativeReadScope(cb),invalidateReads:()=>c.invalidateNativeReadScope()},
        grid:{ getCard:(...args)=>c.gridView.getCard(...args),assertCard:(...args)=>c.gridView.assertCard(...args),
            normalizeCard:node=>c.normalizeClone?.(node),replaceCard:(...args)=>c.gridView.replaceCard(...args)},
        get selectors(){return c.NETFLIX_DOM_SELECTORS || {};},
        pageDom:{videoIdFromHref:(...args)=>c.videoIdFromHref(...args),decodeTrackingContext:(...args)=>c.decodeTrackingContext(...args)},
        readIntent:()=>({token:c.hoverToken,sessionToken:c.sessionScope.token,clone:c.activeClone,videoId:c.activeVideoId,pointerX:c.lastPointerX,pointerY:c.lastPointerY}),
        readEnvironment:()=>({grid:c.sourceState?.grid,scroller:c.sourceState?.scroller}),readDiagnostics:()=>c.performanceDiagnostics,
        gridOwnsClone:(...args)=>c.gridOwnsClone(...args),gridCloneFromPointerEvent:(...args)=>c.gridCloneFromPointerEvent(...args),
        isCancelled:token=>c.hoverPreparationCancelled?.(token),isSessionCurrent:token=>c.isRouteSessionActive(token),isTargetCurrent:(...args)=>c.gridHoverTargetActive(...args),
        recordTiming:(...args)=>c.recordHoverTiming(...args),onReplay:phase=>c.startHoverFrameDiagnostics(phase),onFailed:(...args)=>c.releaseFailedGridHover(...args),
        rejectionDiagnostic:(...args)=>c.hoverReplayGuardDiagnostic(...args),itemForSource:slot=>c.findItemForSourceSlot(slot),activeSource:item=>c.findActiveSourceSlot(item),
        describeSource:slot=>c.slotDescriptor?.(slot),describeItem:item=>c.itemSummary(item),createError:(...args)=>c.initializationError(...args),
        log:(...args)=>c.log(...args),warn:(...args)=>c.warn(...args),trace:cb=>c.trace?.(cb),tLog:key=>c.tLog(key),
        capturePreview:(...args)=>c.popupInspection?.capturePreview(...args),ensureGridHoverBehavior:()=>c.ensureGridHoverBehavior?.(c.sourceState.grid),
        associateGridHoverItem:(...args)=>c.associateGridHoverItem?.(...args),
        onPreviewRelease:(clone,reason,target,release)=>{const token=c.advanceHoverToken('preview');release();if(c.hoverToken===token&&c.activeClone===clone){c.activeClone=null;c.activeVideoId=null;c.activePage=null;}},
        inspect:value=>{internals=value;}
    });
    c.fixturePopupOriginal = Object.fromEntries(names.map(name => [name, internals[name]]));
    for(const name of [...names,...fields]) {
        if(c[name] != null && !String(c[name]).includes('fixturePopup') && !String(c[name]).includes('nativePopup.')) internals[name]=c[name];
        Object.defineProperty(c,name,{configurable:true,get:()=>internals[name],set:value=>{internals[name]=value;}});
    }
    c.fixturePopup=internals;
    c.nativePopup={...popup,invalidate:(...args)=>c.invalidateGridReact(...args),release:(reason,target,slot)=>{
        popup.release(reason,target,slot);
    },retire:handle=>c.releaseGridReact(handle.node),finishProbe:details=>c.finishNativePreviewDiagnostic(c.activeNativeHover,details)};
    c.onGridCardReplaced=(_,next)=>{if(next.node?.getAttribute('data-tm-react-grafted')==='true') c.graftedGridClones.add(next.node);};
    return popup;
}
module.exports={install,names};
