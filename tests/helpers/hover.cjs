'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Transitional characterization exposes the actual private instance only in the
// test loader. Composed acceptance tests import the unchanged public capability.
const names = ['hoverPreparationCancelled','hoverScrollElapsed','recordHoverCancellation','advanceHoverToken','hoverIntentDiagnosticSnapshot','hoverScrollStateSnapshot','hoverReplayGuardDiagnostic','hoverLeaveDestinationDiagnostic','recordGridHoverLeave','retireHoverCard','releaseFailedGridHover','activateClone','gridCloneFromPointerEvent','gridHoverSuppressed','gridHoverReplacementUnderPointer','gridHoverTargetActive','cancelPendingGridHover','handleGridClonePointerOver','handleGridClonePointerLeave','associateGridHoverItem','ensureGridHoverBehavior','handleTargetPointerMove','handleTargetScroll','handleHoverDiagnosticVisibilityChange'];
const timingNames = ['recordHoverTiming','stopHoverFrameDiagnostics','startHoverFrameDiagnostics','sampleHoverFrameDiagnostics'];
const fields = ['hoverToken','activeVideoId','activePage','activeClone','lastPointerX','lastPointerY','lastTargetScrollAt','hoverNeedsPointerMove','pendingGridHoverClone','pendingGridHoverDiagnostic','activeHoverPreparationDiagnostic','hoverSequence'];
const descriptors = entries => entries.map(name => `${name}: {get: () => ${name}, set: value => {${name} = value;}}`).join(',');
function install(c) {
    let timingSource = fs.readFileSync(path.join(__dirname,'../../src/hover/timing.js'),'utf8').replace('export function','function');
    timingSource = timingSource.replace('    return Object.freeze({', `    options.inspect(Object.defineProperties({}, {${descriptors([...timingNames,'hoverFrameDiagnosticOwner','performanceDiagnostics','createCounters'])}}));\n    return Object.freeze({`);
    const createHoverTiming = vm.runInNewContext(timingSource+'\ncreateHoverTiming;', { Object, Map, Set, Promise });
    let source = fs.readFileSync(path.join(__dirname,'../../src/hover/hover.js'),'utf8').replace(/^import .*;\r?\n/m,'').replace('export function','function');
    source = source.replace('    // Public capability:', `    options.inspect(Object.defineProperties({}, {${descriptors([...names,...fields,'performanceDiagnostics','activeAttempt','listenersActive'])}}));\n    // Public capability:`);
    const factory = vm.runInNewContext(source+'\ncreateHover;', { createHoverTiming: options => {const timing=createHoverTiming({...options,inspect:value=>{c.fixtureTiming=value;}});return {...timing,start:(...args)=>c.startHoverFrameDiagnostics(...args),stop:(...args)=>c.stopHoverFrameDiagnostics(...args),record:(...args)=>c.recordHoverTiming(...args)};}, Object, Map, Set, Promise });
    let internals;
    const hover = factory({
        Element:c.Element, document:new Proxy({}, {get:(_,key)=>typeof c.document?.[key]==='function'?c.document[key].bind(c.document):['removeEventListener','addEventListener'].includes(key)?()=>{}:c.document?.[key]}), performance:{now:()=>c.performance.now()},
        setTimeout:(...args)=>c.setTimeout(...args),clearTimeout:key=>c.clearTimeout(key),get requestAnimationFrame(){return c.requestAnimationFrame?cb=>c.requestAnimationFrame(cb):undefined;},get cancelAnimationFrame(){return c.cancelAnimationFrame?key=>c.cancelAnimationFrame(key):undefined;},
        sample:callback=>c.withNativeReadScope(callback),readSessionToken:()=>c.sessionScope.token,isSessionCurrent:token=>c.isRouteSessionActive(token),
        readEnvironment:()=>({grid:c.sourceState?.grid,blockedReason:c.orderMismatchDialogOpen?'order-mismatch-dialog-open':c.orderMismatchReinitializing?'order-mismatch-reinitializing':''}),
        grid:{getCard:(...args)=>c.gridView.getCard(...args),isCardCurrent:(...args)=>c.gridView.isCardCurrent(...args)},gridOwnsClone:(...args)=>c.gridOwnsClone(...args),
        createPopup:()=>({ release:(...args)=>c.nativePopup.release(...args),invalidate:()=>c.nativePopup.invalidate(),open:input=>c.scheduleNativeHoverReplay(input.source.slot,input.item,input.card.node,input.event,input.page,input.reason,input.token,input.sessionToken),
            pointerMoved:(...args)=>c.nativePopup.pointerMoved(...args),retainPreview:(...args)=>c.nativePopup.retainPreview(...args),finishProbe:(...args)=>c.nativePopup.finishProbe(...args),
            previewPointerOut:(...args)=>c.nativePopup.previewPointerOut(...args),replayFacts:(...args)=>c.nativePopup.replayFacts(...args)}),
        resolveReady:(...args)=>c.fixtureResolveReady?.(...args) ?? c.resolveReadyHover?.(...args),prepare:(item,card,event,token,sessionToken)=>c.prepareHoverCard?.(item,card,event,token,sessionToken),
        whenStable:()=>c.responsiveRefreshPromise?.catch(()=>{}) || null,sleep:(...args)=>c.sleep(...args),
        assertSession:(...args)=>c.assertRouteSession(...args),isCancelledError:(...args)=>c.isRouteSessionCancelledError(...args),describeItem:item=>c.itemSummary(item),
        log:(...args)=>c.log(...args),warn:(...args)=>c.warn(...args),tLog:key=>c.tLog(key),inspect:value=>{internals=value;}
    });
    c.fixtureHoverOriginal=Object.fromEntries([...names,...timingNames].map(name=>[name,(timingNames.includes(name)?c.fixtureTiming:internals)[name]]));
    for (const name of [...names,...fields,...timingNames,'hoverFrameDiagnosticOwner']) {
        const owner=timingNames.includes(name)||name==='hoverFrameDiagnosticOwner'?c.fixtureTiming:internals;
        if(c[name]!=null && !fields.includes(name) && name!=='hoverFrameDiagnosticOwner') owner[name]=c[name];
        if(fields.includes(name)&&c[name]!=null) owner[name]=c[name];
        Object.defineProperty(c,name,{configurable:true,get:()=>owner[name],set:value=>{owner[name]=value;}});
    }
    let diagnostics=c.performanceDiagnostics || c.fixtureTiming.createCounters();
    Object.defineProperty(c,'performanceDiagnostics',{configurable:true,get:()=>diagnostics,set:value=>{diagnostics=value;internals.performanceDiagnostics=value;c.fixtureTiming.performanceDiagnostics=value;}});
    c.hover={...hover, intent:()=>Object.freeze({token:c.hoverToken,sessionToken:c.sessionScope.token,clone:c.activeClone,videoId:c.activeVideoId,page:c.activePage,pointerX:c.lastPointerX,pointerY:c.lastPointerY}),
        diagnostics:()=>Object.freeze({...hover.diagnostics(),hoverPreparation:{...c.performanceDiagnostics?.hoverPreparation}})};
    c.createHoverCounters=()=>c.fixtureTiming.createCounters();
    internals.listenersActive = true;
    c.fixtureHover=internals;
    return hover;
}
module.exports={install,names,timingNames};
