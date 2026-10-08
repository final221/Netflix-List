import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewing } from '../src/viewing/viewing.js';
import { createSessionScope } from '../src/app/session-scope.js';

function fixture(onChange = () => {}, count = 1) {
    const scope = createSessionScope({ isTargetPage: () => true, AbortController, setTimeout, clearTimeout });
    const token = scope.begin();
    let current = true, release, calls = 0, finishHook = () => {};
    const writes = [];
    const v = createViewing({ activeProfile: () => 'a', now: Date.now, performanceNow: () => 0,
        data: { limits: { titleBatch: 50, episodeBatch: 200, seasons: 40, episodes: 500 },
            beginRead: () => ({ profileGuid: 'a' }), readTitles(ids, context, owner) {
                calls++;
                return new Promise((resolve, reject) => {
                    owner.signal.addEventListener('abort', () => reject(scope.cancelledError()), { once: true });
                    release = () => {
                    owner.assertCurrent(); resolve(new Map(ids.map(id => [id, { type: 'movie', watched: true }])));
                }; });
            } }, beginRequest: scope.beginRequest, finishRequest(request) { scope.finishRequest(request); finishHook(); },
        getValue: () => null, setValue: (key, value) => writes.push({ key, value }),
        setRequestTimeout: scope.setRequestTimeout, isCancelled: scope.isCancelled, createCancelledError: scope.cancelledError });
    const config = { sessionToken: token, readItems: () => Array.from({ length: count }, (_, index) => ({ videoId: String(index + 1) })),
        assertCurrent() { scope.assertCurrent(token); if (!current) throw scope.cancelledError(); }, onChange };
    const session = v.createSession(config);
    return { v, session, scope, config, writes, calls: () => calls, release: () => release(), retire() { current = false; },
        onFinish(callback) { finishHook = callback; } };
}

test('finale batches preserve short-series fallback, missing references and direct repair outcomes', async () => {
    const scope = createSessionScope({ isTargetPage: () => true, AbortController, setTimeout, clearTimeout });
    const sessionToken = scope.begin(), requests = [];
    const progress = bookmark => ({ type: 'episode', watched: false, bookmark, runtime: 100, creditsOffset: null });
    const v = createViewing({ activeProfile: () => 'a', now: () => 1000, performanceNow: () => 0,
        beginRequest: scope.beginRequest, finishRequest: scope.finishRequest, setRequestTimeout: scope.setRequestTimeout,
        isCancelled: scope.isCancelled, createCancelledError: scope.cancelledError, getValue: () => null, setValue() {},
        scanLimits: { episodeBatch: 2 },
        data: { limits: { titleBatch: 50, episodeBatch: 200, seasons: 40, episodes: 500 },
            beginRead: () => ({ profileGuid: 'a' }),
            async readTitles(ids) { return new Map(ids.map(id => [id, { videoId: id, type: 'show', seasonCount: 1, episodeCount: null }])); },
            async readSeasons(records) { return records.map(({ videoId }) => ({ videoId,
                expected: ['1', '4'].includes(videoId) ? 1 : 3,
                seasons: [{ id: videoId, count: ['1', '4'].includes(videoId) ? 1 : 3 }] })); },
            async readEpisodes(segments) {
                requests.push(segments);
                return segments.map(({ seasonId, from, to }) => ({ seasonId, from, to,
                    episodes: [{ id: seasonId === '5' ? '' : seasonId + '1',
                        record: ['1', '2'].includes(seasonId) ? progress(0) : null,
                        kinds: { watched: 'missing', bookmark: 'missing', runtime: 'missing' } }] }));
            },
            async readDirectEpisodes(ids) {
                assert.deepEqual(ids, ['31', '41']);
                return new Map(ids.map(id => [id, { record: progress(id === '31' ? 25 : 0),
                    kinds: { watched: 'false', bookmark: 'zero', runtime: 'positive-number' } }]));
            } } });
    const session = v.createSession({ sessionToken, assertCurrent: () => scope.assertCurrent(sessionToken),
        readItems: () => ['1', '2', '3', '4', '5'].map(videoId => ({ videoId })) });
    await v.start(session);
    assert(requests.every(batch => batch.length <= 2 && batch.every(range => range.from === range.to)));
    assert.deepEqual(requests.flat().map(range => range.from), [0, 2, 2, 0, 2]);
    assert.deepEqual(['1', '2', '3', '4', '5'].map(id => v.freshStatus(session, id)),
        ['not-started', 'in-progress', 'unknown', 'not-started', 'unknown']);
    assert.equal(scope.requestCount(), 0);
    assert.equal(v.diagnostics(session).failure, null);
    v.dispose(session);
});

test('viewing sessions hide scan maps/controllers and share an exact refresh promise', async () => {
    const e = fixture();
    e.v.start(e.session);
    const first = e.v.settled(e.session), second = e.v.refresh(e.session);
    assert.equal(first, second);
    assert.equal(e.v.start(e.session), first);
    assert.deepEqual(Object.keys(e.session), []);
    assert.equal(e.calls(), 1);
    e.release(); await first;
    assert.equal(e.v.placement(e.session, '1').status, 'complete');
    assert.equal(e.scope.requestCount(), 0);
    e.v.dispose(e.session);
});

test('reentrant scan-start refresh joins the reserved promise without allocating another job', async () => {
    let e, joined;
    e = fixture(change => { if (change.reason === 'scan-start') joined = e.v.refresh(e.session); });
    e.v.start(e.session);
    assert.equal(joined, e.v.settled(e.session));
    assert.equal(e.calls(), 1);
    e.release(); await joined;
    e.v.dispose(e.session);
});

test('retired sessions reject delayed results and release their requests', async () => {
    const e = fixture();
    e.v.start(e.session);
    const pending = e.v.settled(e.session);
    e.retire();
    assert.throws(() => e.release(), /cancelled/);
    e.v.dispose(e.session);
    assert.equal(e.scope.requestCount(), 0);
    await pending;
    assert.equal(e.v.diagnostics(e.session).loading, false);
    assert.equal(e.v.placement(e.session, '1').status, 'unknown');
});

test('completion callback can start a newer refresh without old cleanup or cache saving over it', async () => {
    let e, next;
    e = fixture(change => { if (change.reason === 'scan-complete' && !next) next = e.v.refresh(e.session); });
    const first = e.v.start(e.session); e.release(); await first;
    assert.equal(e.calls(), 2);
    assert.equal(e.v.settled(e.session), next);
    assert.equal(e.v.diagnostics(e.session).loading, true);
    assert.equal(e.writes.length, 0);
    e.release(); await next;
    assert.equal(e.writes.length, 1);
    assert.equal(e.scope.requestCount(), 0);
    e.v.dispose(e.session);
});

test('scan-start retirement prevents dispatch and completion publication', async () => {
    let e; const reasons = [];
    e = fixture(change => { reasons.push(change.reason); if (change.reason === 'scan-start') e.v.dispose(e.session); });
    await e.v.start(e.session);
    assert.equal(e.calls(), 0);
    assert.equal(e.scope.requestCount(), 0);
    assert.deepEqual(reasons, ['reconcile', 'scan-start']);
});

test('replacement session keeps accepted classification and retires the in-flight owner', async () => {
    const e = fixture(); const first = e.v.start(e.session); e.release(); await first;
    const pending = e.v.refresh(e.session);
    const next = e.v.createSession({ ...e.config, previous: e.session });
    e.v.dispose(e.session); await pending;
    assert.equal(e.v.placement(next, '1').status, 'complete');
    assert.equal(e.v.diagnostics(next).loading, false);
    assert.equal(e.v.diagnostics(next).network, null, 'old in-flight counters have no owner in the new session');
    assert.equal(e.scope.requestCount(), 0);
    assert.throws(() => e.v.place(e.session, '1'), /cancelled/);
    const refresh = e.v.refresh(next); e.release(); await refresh;
    assert.equal(e.v.placement(next, '1').status, 'complete'); e.v.dispose(next);
});

test('request cleanup failure cannot strand another owned request', async () => {
    const e = fixture(() => {}, 51), pending = e.v.start(e.session);
    assert.equal(e.scope.requestCount(), 2);
    e.onFinish(() => { e.onFinish(() => {}); throw new Error('host cleanup'); });
    e.v.dispose(e.session); await pending;
    assert.equal(e.scope.requestCount(), 0);
    assert.equal(e.v.diagnostics(e.session).cleanupFailures, 1);
    assert.equal(e.v.diagnostics(e.session).network.inFlight, 0);
});
