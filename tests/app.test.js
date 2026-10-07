import { createSessionScope } from '../src/app/session-scope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app/application.js';
import { createSettings } from '../src/app/settings.js';
import { createDocument, Element, EventTarget } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';

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
