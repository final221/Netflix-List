import { createSessionScope } from '../src/app/session-scope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app/application.js';
import { createSettings } from '../src/app/settings.js';
import { createDocument, Element, EventTarget } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';
import { createBrowser } from './helpers/browser.js';
import { mountPopulatedMyList } from './helpers/populated-browser.js';

async function populatedApplication({count=2,drain=true,nativeAll=false,browser=null,application=null,beforeStart=()=>{}}={}) {
    const b = browser || createBrowser({ pathname: '/browse/my-list' });
    const { section, scroller, track } = mountPopulatedMyList(b, { count, nativeAll });
    beforeStart(b);
    const app=application||createApplication({environment:b.context,version:'test'});
    if(application)await b.navigate('/browse/my-list?source-mounted');else app.start();
    await b.scheduler.advance();
    if(drain)for(let i=0;i<80&&app.diagnostics().currentSession?.running;i++){await b.scheduler.advance(25);await b.scheduler.frame();}
    return {...b,app,section,scroller,track};
}
test('complete application publishes populated membership before optional viewing and owns visibility until disposal',async()=>{
    const e=await populatedApplication();
    assert.equal(e.app.diagnostics().currentSession.completed,true,e.logs.map(row=>row[2]?.error?.stack).filter(Boolean).join('\n'));
    const root=e.document.getElementById('tm-netflix-mylist-v15-grid');assert.ok(root);
    assert.equal(root.querySelectorAll('[data-tm-item-video-id]').length,2);
    [...e.menus.values()][0].callback();assert.equal(e.section.getAttribute('data-tm-original-mylist-visible'),'false');
    e.app.dispose();e.app.dispose();assert.equal(e.document.getElementById('tm-netflix-mylist-v15-grid'),null);
    assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);assert.equal(e.menus.size,0);
});
test('initial unavailable counts wait for valid membership instead of completing an empty grid', async () => {
    for (const value of [null, '', false]) {
        const b = createBrowser({ pathname: '/browse/my-list' });
        mountPopulatedMyList(b, { count: 2 });
        const row = b.window.netflix.reactContext.models.graphql.data.list;
        row.entities.totalCount = value;
        const app = createApplication({ environment: b.context, version: 'test' });
        app.start(); await b.scheduler.advance();
        assert.equal(app.diagnostics().currentSession.completed, false, String(value));
        assert.ok(!b.logs.some(entry => entry[1] === 'Empty legacy list finalized'));
        row.entities.totalCount = 2;
        for (let i = 0; i < 80 && !app.diagnostics().currentSession.completed; i++) {
            await b.scheduler.advance(25); await b.scheduler.frame();
        }
        assert.equal(app.diagnostics().currentSession.completed, true);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-grid').querySelectorAll('[data-tm-item-video-id]').length, 2);
        app.dispose(); assert.equal(b.scheduler.timers.size, 0); assert.equal(b.scheduler.frames.size, 0);
    }
});

test('cards disappearing during a positive-count collection report failure instead of a successful empty list', async () => {
    let removed = false;
    const e = await populatedApplication({ beforeStart(b) {
        const log = b.context.console.log;
        b.context.console.log = (...args) => {
            log(...args);
            if (!removed && args[1] === 'Full collection started') {
                removed = true;
                const track = b.document.querySelector('[data-uia="carousel-scroller"]').children[0];
                for (const card of [...track.children]) card.remove();
            }
        };
    } });
    assert.equal(removed, true);
    assert.equal(e.app.diagnostics().currentSession.completed, false);
    assert.equal(e.app.diagnostics().currentSession.blocked, true);
    assert.ok(!e.logs.some(entry => entry[1] === 'Empty legacy list finalized'));
    assert.ok(e.logs.some(entry => entry[1] === 'Initialization failed' && entry[2]?.code === 'NO_NATIVE_CARDS'));
    e.app.dispose(); assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
});

test('menu registration failures preserve startup, preference delivery and route reentry', async () => {
    for (const failAt of [1, 2]) {
        let registrations = 0;
        const e = await populatedApplication({ beforeStart(b) {
            const register = b.context.GM_registerMenuCommand;
            b.context.GM_registerMenuCommand = (...args) => {
                if (++registrations === failAt) throw new Error('menu unavailable');
                return register(...args);
            };
        } });
        assert.equal(e.app.diagnostics().currentSession.completed, true);
        if (failAt === 2) {
            [...e.menus.values()][0].callback();
            assert.equal(e.section.getAttribute('data-tm-original-mylist-visible'), 'false');
        }
        assert.ok(e.logs.some(entry => entry[1] === 'Userscript menu registration failed'));
        await e.navigate('/browse');
        assert.equal(e.app.diagnostics().currentSession, null);
        await e.navigate('/browse/my-list');
        for (let i = 0; i < 80 && !e.app.diagnostics().currentSession.completed; i++) {
            await e.scheduler.advance(25); await e.scheduler.frame();
        }
        assert.equal(e.app.diagnostics().currentSession.completed, true);
        e.app.dispose(); assert.equal(e.scheduler.timers.size, 0); assert.equal(e.scheduler.frames.size, 0);
        assert.equal(e.window.listenerCount('popstate'), 0);
    }
});

test('late source arrival unblocks the real session without replacing application resources',async()=>{
    const b=createBrowser({pathname:'/browse/my-list'}),app=createApplication({environment:b.context,version:'test'});
    app.start();await b.scheduler.advance(1000);const token=app.diagnostics().currentSession.token;
    const e=await populatedApplication({browser:b,application:app});
    assert.equal(app.diagnostics().currentSession.token,token);assert.equal(app.diagnostics().currentSession.completed,true);
    assert.equal(b.window.listenerCount('popstate'),1);app.dispose();assert.equal(b.scheduler.timers.size,0);assert.equal(b.scheduler.frames.size,0);
});
test('reentrant route retirement during initialization cannot publish old work and a later visit recovers',async()=>{
    for(const trigger of ['totalCount detected','Native carousel initialization ready','Initialization started','Initial layout measured']){
        let retired=false;
        const e=await populatedApplication({beforeStart:b=>{
            const log=b.context.console.log;b.context.console.log=(...args)=>{
                log(...args);if(!retired&&args[1]===trigger){retired=true;b.history.pushState(null,'','/browse');}
            };
        }});
        assert.equal(retired,true,trigger);await e.scheduler.flush();assert.equal(e.app.diagnostics().currentSession,null);
        assert.equal(e.document.getElementById('tm-netflix-mylist-v15-grid'),null);
        await e.navigate('/browse/my-list');
        for(let i=0;i<80&&!e.app.diagnostics().currentSession.completed;i++){await e.scheduler.advance(25);await e.scheduler.frame();}
        assert.equal(e.app.diagnostics().currentSession.completed,true,trigger);
        e.app.dispose();assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
    }
});
test('retiring a page during native readiness releases its pause and prevents late partial publication',async()=>{
    const e=await populatedApplication({count:150,drain:false});
    assert.equal(e.app.diagnostics().currentSession.running,true);
    const callbacks=[...e.scheduler.timers.values()].map(timer=>timer.callback);
    const frames=[...e.scheduler.frames.values()];
    e.app.dispose();assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
    for(const callback of frames)callback();
    for(const callback of callbacks)callback();await e.scheduler.flush();
    assert.equal(e.document.getElementById('tm-netflix-mylist-v15-grid'),null);
    assert.equal(e.document.listenerCount('pointermove'),0);
    assert.ok(!e.logs.some(row=>row.includes('Initialization failed')));
});
test('retiring a chunked construction settles its task yield without publishing or touching a replacement visit',async()=>{
    const e=await populatedApplication({count:150,drain:false,nativeAll:true});
    for(let i=0;i<80&&!Array.from(e.scheduler.timers.values()).some(timer=>timer.due<=e.scheduler.performance.now());i++){
        await e.scheduler.advance(25);await e.scheduler.frame();
    }
    assert.ok(Array.from(e.scheduler.timers.values()).some(timer=>timer.due<=e.scheduler.performance.now()),JSON.stringify(e.logs.map(row=>[row[1],row[2]?.code,row[2]?.error?.stack])));
    const old=[...e.scheduler.timers.values()].map(timer=>timer.callback);
    await e.navigate('/browse');assert.equal(e.scheduler.timers.size,0);
    await e.navigate('/browse/my-list');const current=e.app.diagnostics().currentSession.token;
    for(const callback of old)callback();await e.scheduler.flush();
    assert.equal(e.app.diagnostics().currentSession.token,current);assert.equal(e.app.diagnostics().currentSession.active,true);
    e.app.dispose();assert.equal(e.scheduler.timers.size,0);
});

test('construction yields below 24 items when measured work exhausts the six-millisecond quantum', async () => {
    let measuredCost=0;
    const e=await populatedApplication({count:7,drain:false,nativeAll:true,beforeStart:b=>{
        const now=b.context.performance.now;
        b.context.performance={...b.context.performance,now:()=>now()+(measuredCost+=7)};
    }});
    for(let i=0;i<80&&!Array.from(e.scheduler.timers.values()).some(timer=>timer.due<=e.scheduler.performance.now());i++){
        await e.scheduler.advance(25);await e.scheduler.frame();
    }
    assert.equal(e.app.diagnostics().currentSession.running,true);
    assert.ok(Array.from(e.scheduler.timers.values()).some(timer=>timer.due<=e.scheduler.performance.now()));
    assert.equal(e.document.getElementById('tm-netflix-mylist-v15-grid')?.querySelectorAll('[data-tm-item-video-id]').length||0,0);
    e.app.dispose();await e.scheduler.flush();assert.equal(e.scheduler.timers.size,0);assert.equal(e.scheduler.frames.size,0);
});

test('settings publishes semantic preference changes and retires old menu callbacks', () => {
    const callbacks = [], changes = [], writes = [];
    const settings = createSettings({ storage: { getItem: () => '{"viewOriginalMyList":false,"obsolete":true}', setItem: (_key, value) => writes.push(value) },
        registerMenu: (_label, fn) => { callbacks.push(fn); return callbacks.length; }, unregisterMenu() {},
        tUi: key => key, onChange: value => changes.push(value) });
    assert.equal(callbacks.length, 0);
    settings.start(); settings.start(); assert.equal(callbacks.length, 1);
    assert.deepEqual(settings.preferences(), { viewOriginalMyList: false });
    callbacks[0](); assert.deepEqual(changes, [{ viewOriginalMyList: true }]);
    callbacks[0](); assert.equal(changes.length, 1);
    settings.dispose(); callbacks[1](); assert.equal(changes.length, 1);
    assert.deepEqual(JSON.parse(writes[0]), { viewOriginalMyList: false });
});

test('application retires exact page sessions and restores its navigation hooks on repeated disposal', async () => {
    const document = createDocument(), window = new EventTarget(), scheduler = createScheduler();
    const location = { origin: 'https://www.netflix.com', pathname: '/browse', href: 'https://www.netflix.com/browse' };
    const history = { pushState(_state, _title, url) { const next = new URL(url, location.href); location.pathname = next.pathname; location.href = next.href; }, replaceState() {} };
    const original = history.pushState, instances = [];
    const application = createApplication({ environment: { ...scheduler, document, window, location, history, Element,
        navigator: { language: 'en' }, console: { log() {}, warn() {} }, AbortController, queueMicrotask,
        localStorage: { getItem: () => null, setItem() {} } }, createSession: options => {
        const instance = { starts: 0, disposals: 0, checks: 0, start() { this.starts++; }, dispose() { this.disposals++; }, check() { this.checks++; }, preferencesChanged() {}, diagnostics: () => ({}) };
        instance.navigate = options.onNavigation; instances.push(instance); return instance;
    } });
    assert.equal(window.listenerCount('popstate'), 0); application.start(); application.start();
    history.pushState(null, '', '/browse/my-list'); await scheduler.flush();
    assert.equal(instances.length, 1);
    history.pushState(null, '', '/browse'); await scheduler.flush();
    assert.equal(instances[0].disposals, 1);
    history.pushState(null, '', '/browse/my-list'); await scheduler.flush(); assert.equal(instances.length, 2);
    location.pathname = '/browse'; location.href = 'https://www.netflix.com/browse';
    instances[0].navigate('retired-native-observer'); assert.equal(instances[1].disposals, 0);
    const stale = history.pushState;
    application.dispose(); application.dispose();
    assert.equal(instances[1].disposals, 1); assert.equal(history.pushState, original);
    stale(null, '', '/browse'); await scheduler.flush(); assert.equal(instances.length, 2);
    assert.equal(window.listenerCount('popstate'), 0); assert.equal(window.listenerCount('hashchange'), 0);
});

test('denied settings storage and absent menu grants still expose the original-source preference', () => {
    const settings = createSettings({ storage: { getItem() { throw new Error('denied'); }, setItem() { assert.fail('failed read cannot write'); } } });
    settings.start(); assert.deepEqual(settings.preferences(), { viewOriginalMyList: true });
    assert.throws(() => { settings.preferences().viewOriginalMyList = false; }, TypeError);
    settings.dispose(); settings.dispose();
});

test('separate page scopes cannot retire a newer page during an old cleanup callback', () => {
    const scheduler = createScheduler(); let epoch = 0;
    const options = { isTargetPage: () => true, AbortController, setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout, nextToken: () => ++epoch };
    const previous = createSessionScope(options), current = createSessionScope(options);
    const oldToken = previous.begin(), oldRequest = previous.beginRequest(oldToken);
    const token = current.begin(), request = current.beginRequest(token);
    previous.dispose(); previous.finishRequest(oldRequest); previous.dispose();
    assert.equal(current.isCurrent(token), true); assert.equal(request.controller.signal.aborted, false);
    assert.equal(previous.isCurrent(oldToken), false); assert.notEqual(oldToken, token);
    current.dispose(); assert.equal(request.controller.signal.aborted, true);
});


function environment() {
    const scheduler = createScheduler();
    let onRoute = true;
    const scope = createSessionScope({ isTargetPage: () => onRoute, AbortController,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout });
    return { scope, scheduler, leave: () => { onRoute = false; } };
}

test('a replacement session aborts old requests and stale cleanup cannot release the new owner', () => {
    const { scope, scheduler } = environment();
    assert.equal(scope.token, 0);
    assert.equal(scheduler.timers.size, 0);
    const oldToken = scope.begin();
    const oldRequest = scope.beginRequest(oldToken);
    const currentToken = scope.begin();
    const currentRequest = scope.beginRequest(currentToken);
    assert.equal(oldRequest.controller.signal.aborted, true);
    assert.equal(currentRequest.controller.signal.aborted, false);
    assert.equal(scope.requestCount(), 1);
    assert.equal(scheduler.timers.size, 1);
    scope.finishRequest(oldRequest);
    scope.finishRequest(oldRequest);
    assert.equal(scope.requestCount(currentToken), 1);
    assert.equal(currentRequest.controller.signal.aborted, false);
    scope.dispose();
    assert.equal(currentRequest.controller.signal.aborted, true);
    assert.equal(scope.requestCount(), 0);
    assert.equal(scheduler.timers.size, 0);
    scope.finishRequest(currentRequest);
    assert.equal(scope.isCurrent(currentToken), false);
});

test('request deadlines and job cancellation release only the admitted request', async () => {
    const { scope, scheduler } = environment();
    const token = scope.begin();
    const viewing = scope.beginRequest(token);
    const unrelated = scope.beginRequest(token);
    scope.setRequestTimeout(viewing, 8000);
    assert.equal(scheduler.timers.size, 2);
    await scheduler.advance(7999);
    assert.equal(viewing.controller.signal.aborted, false);
    await scheduler.advance(1);
    assert.equal(viewing.controller.signal.aborted, true);
    assert.equal(unrelated.controller.signal.aborted, false);
    scope.finishRequest(viewing);
    assert.equal(scope.requestCount(token), 1);
    assert.equal(scope.setRequestTimeout(viewing, 1000), false);
    await scheduler.advance(2000);
    assert.equal(unrelated.controller.signal.aborted, true);
    scope.finishRequest(unrelated);
    assert.equal(scope.requestCount(), 0);
    assert.equal(scheduler.timers.size, 0);
});

test('stale route guards reject dispatch and publication without exposing mutable scope state', () => {
    const { scope, scheduler, leave } = environment();
    const token = scope.begin();
    const request = scope.beginRequest(token);
    assert.equal(Object.isFrozen(scope), true);
    assert.equal(Object.isFrozen(request), true);
    assert.equal('timeoutId' in request, false);
    assert.equal('controllers' in scope, false);
    assert.throws(() => { scope.token = 90; }, TypeError);
    assert.equal(scope.finishRequest({ controller: new AbortController(), sessionToken: token }), false);
    assert.equal(scope.requestCount(), 1);
    leave();
    assert.throws(() => scope.assertCurrent(token), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    assert.throws(() => scope.beginRequest(token), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    scope.abortObsoleteRequests();
    assert.equal(request.controller.signal.aborted, true);
    assert.equal(scope.requestCount(), 0);
    assert.equal(scheduler.timers.size, 0);
    scope.assertCurrent(null);
    scope.assertCurrent(undefined);
});

test('a queued callback from a replaced deadline cannot abort the current deadline owner', async () => {
    const { scope, scheduler } = environment();
    const token = scope.begin();
    const request = scope.beginRequest(token);
    const staleCallback = [...scheduler.timers.values()][0].callback;
    scope.setRequestTimeout(request, 8000);
    staleCallback();
    assert.equal(request.controller.signal.aborted, false);
    assert.equal(scheduler.timers.size, 1);
    await scheduler.advance(8000);
    assert.equal(request.controller.signal.aborted, true);
    scope.finishRequest(request);
    assert.equal(scope.requestCount(), 0);
});
