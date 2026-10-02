import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionScope } from '../src/app/session-scope.js';
import { createScheduler } from './helpers/scheduler.js';

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
