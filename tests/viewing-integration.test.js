import { createReport } from '../src/diagnostics/report.js';
import { createLogger } from '../src/diagnostics/logger.js';
import { Element } from './helpers/dom.js';
import { createCache } from '../src/viewing/cache.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletion } from '../src/viewing/completion.js';
import { atom, reference, viewingVideo } from './helpers/fixtures.js';
import { viewingEnvironment as createBrowserViewing } from './helpers/viewing-browser.js';
async function viewingEnvironment(...args) { const e=await createBrowserViewing(...args); e.setFixtures(viewingFixtures()); return e; }
const viewingUiForTests = new WeakMap();
async function unfinishedMovieGrid(count = 500) {
    const e = await viewingEnvironment(count);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', false)]))
        } }) };
    };
    await e.start();
    return e;
}

function viewingFixtures(extraEpisode = false) {
    return {
        titles: { videos: {
            1: viewingVideo('movie', true), 2: viewingVideo('movie', false, 25),
            3: viewingVideo('movie', false),
            4: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(extraEpisode ? 3 : 2) }),
            5: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(2) }),
            6: viewingVideo('show', true, 0, { seasonCount: atom(0) }), 7: viewingVideo('unexpected-type', true)
        } },
        seasons: { videos: { 4: { seasonList: { 0: reference('seasons', 40) } },
            5: { seasonList: { 0: reference('seasons', 50) } } },
            seasons: { 40: { summary: atom({ length: extraEpisode ? 3 : 2 }) },
                50: { summary: atom({ length: 2 }) } } },
        episodes: { seasons: {
            40: { episodes: { 0: reference('videos', 400), 1: reference('videos', 401),
                ...(extraEpisode ? { 2: reference('videos', 402) } : {}) } },
            50: { episodes: { 0: reference('videos', 500), 1: reference('videos', 501) } }
        }, videos: {
            400: viewingVideo('episode', true), 401: viewingVideo('episode', true),
            402: viewingVideo('episode', false), 500: viewingVideo('episode', true),
            501: viewingVideo('episode', false, 30)
        } }
    };
}

async function viewingRecords(e, graph, ids) {
    e.c.fetch = async () => ({ ok: true, json: async () => ({ jsonGraph: graph }) });
    return e.c.viewingData.readTitles(ids, e.c.viewingData.beginRead(),
        { signal: new AbortController().signal, assertCurrent() {} });
}

function viewingUi(e) {
    const grid = e.state.grid, details = grid.querySelector('[data-tm-watch-section]');
    if (!details) return null;
    if (viewingUiForTests.has(details)) return viewingUiForTests.get(details);
    const filter = group => {
        const root = grid.querySelector('[data-tm-type-filter="' + group + '"]');
        return { root, buttons: new Map(root.children.map(button => [button.getAttribute('data-tm-filter-value'),
            { button, count: button.querySelector('[data-tm-type-count]') }])) };
    };
    const controls = grid.querySelector('[data-tm-watch-controls]');
    const value = { grid, details, summary: details.querySelector('summary'), watchedGrid: details.querySelector('[data-tm-watch-grid]'),
        mainFilter: filter('main'), watchedFilter: filter('watched'), watchedEmpty: details.querySelector('p'),
        empty: grid.children.find(node => node.getAttribute('data-tm-watch-empty') === 'true'),
        controls, refresh: controls.querySelector('button'), note: controls.querySelector('span') };
    viewingUiForTests.set(details, value); return value;
}

function observeControlLabels(e, changed) {
    for (const clone of e.state.cloneMap.values()) {
        const toggle = viewingControls(clone).toggle; let value = toggle.textContent;
        Object.defineProperty(toggle, 'textContent', { configurable: true, get: () => value, set(next) { value = next; changed(); } });
    }
}

function mainViewingIds(e) {
    return e.state.grid.children.filter(node => node.__tmMyListItem).map(node => node.__tmMyListItem.videoId);
}

function completedViewingIds(e) {
    return viewingUi(e).watchedGrid.children.map(node => node.__tmMyListItem.videoId);
}

function filteredViewingIds(e, group = 'main') {
    const parent = group === 'main' ? e.state.grid : viewingUi(e).watchedGrid;
    return parent.children.filter(node => node.__tmMyListItem && node.getAttribute('data-tm-type-hidden') !== 'true')
        .map(node => node.__tmMyListItem.videoId);
}

function clickViewingFilter(e, group, type) {
    const control = group === 'main' ? viewingUi(e).mainFilter : viewingUi(e).watchedFilter;
    control.buttons.get(type).button.dispatchEvent({ type: 'click' });
}

function useCompleteSeriesResponses(e, episodeCounts = {}) {
    const countFor = id => episodeCounts[id] ?? 1;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ url, options, paths });
        const graph = { videos: {}, seasons: {} };
        if (Array.isArray(paths[0][2])) {
            for (const id of paths[0][1]) graph.videos[id] = paths[0][2].includes('seasonCount')
                ? viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(countFor(id)) })
                : viewingVideo('episode', true);
        } else if (paths[0][0] === 'videos') {
            for (const [, id] of paths) {
                const seasonId = String(10000 + Number(id));
                graph.videos[id] = { seasonList: { 0: reference('seasons', seasonId) } };
                graph.seasons[seasonId] = { summary: atom({ length: countFor(id) }) };
            }
        } else {
            for (const [, seasonId, , range] of paths) {
                const episodes = {};
                for (let index = range.from; index <= range.to; index++) {
                    const episodeId = String(Number(seasonId) * 1000 + index);
                    episodes[index] = reference('videos', episodeId);
                    graph.videos[episodeId] = viewingVideo('episode', true);
                }
                graph.seasons[seasonId] = { episodes };
            }
        }
        return { ok: true, status: 200, json: async () => ({ jsonGraph: graph }) };
    };
}

function delayViewingBodies(e) {
    const mockFetch = e.c.fetch;
    const pending = [];
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        if (!response.ok) return response;
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        const gate = fetchDeferred();
        const entry = { paths, signal: options.signal, released: false,
            release() { entry.released = true; gate.resolve(); } };
        pending.push(entry);
        const json = response.json;
        response.json = async () => {
            await abortableFetchResult(gate.promise, options.signal);
            return json();
        };
        return response;
    };
    return pending;
}

function useCompleteMovieResponses(e) {
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths, options });
        return { ok: true, status: 200, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
}

function useSparseNestedEpisodes(e, predicate, direct = null) {
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        const followUp = paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount');
        const response = await mockFetch(url, options);
        const json = response.json;
        response.json = async () => {
            const body = structuredClone(await json());
            if (paths[0][0] === 'seasons') {
                for (const [id, video] of Object.entries(body.jsonGraph.videos || {})) {
                    if (predicate(id)) body.jsonGraph.videos[id] = { summary: video.summary, runtime: video.runtime };
                }
            } else if (followUp && direct) direct(body.jsonGraph, paths[0][1]);
            return body;
        };
        return response;
    };
}

function viewingControls(node) {
    const root = node.children.find(child => child.getAttribute('data-tm-viewing-actions') === 'true');
    return root && { root, toggle: root.children.find(child => child.getAttribute('data-tm-viewing-action') === 'toggle'),
        marker: root.children.find(child => child.getAttribute('data-tm-manual-choice') === 'true') };
}

function clickManualViewing(e, id, action = 'toggle', grid = e.state.grid, button = null) {
    const clone = e.state.cloneMap.get('v:' + id);
    assert.equal(action, 'toggle');
    button ||= viewingControls(clone).toggle;
    const events = [];
    grid.dispatchEvent({ type: 'click', target: button, preventDefault: () => events.push('prevent'),
        stopPropagation: () => events.push('stop'), stopImmediatePropagation: () => events.push('immediate') });
    return events;
}

function holdViewingResponse(e, matches = () => true) {
    const mockFetch = e.c.fetch;
    let held = false;
    const gate = { release: null };
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (!held && matches(paths)) {
            held = true;
            const json = response.json;
            response.json = () => new Promise(resolve => { gate.release = async () => resolve(await json()); });
        }
        return response;
    };
    return gate;
}

function fetchDeferred() {
    let resolve, reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function abortableFetchResult(value, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

test('viewing overlap publishes a later title batch promptly and preserves native order', async () => {
    const e = await viewingEnvironment(150);
    useCompleteMovieResponses(e);
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    assert.equal(pending.length, 2, 'two independent title reads start together');
    pending[1].release();
    await e.flush();
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, true);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 51)));
    assert.equal(pending.length, 2, 'the next bounded wave waits for both owners');
    pending[0].release();
    for (let attempt = 0; attempt < 10 && pending.length < 3; attempt++) await e.flush();
    assert.equal(pending.length, 3);
    pending[2].release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 150 }, (_, index) => String(index + 1)));
    assert.equal(e.storageCalls.cacheWrites, 1);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap shortens modeled network wait without increasing requests', async () => {
    const runs = [];
    for (const concurrency of [1, 2]) {
        const e = await viewingEnvironment(100);
        e.c.VIEWING_REQUEST_CONCURRENCY = concurrency;
        useCompleteMovieResponses(e);
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        for (let wave = 0; wave < 2; wave++) {
            await e.flush();
            const active = pending.filter(entry => !entry.released);
            if (!active.length) break;
            await e.advance(100);
            active.forEach(entry => entry.release());
            for (let attempt = 0; attempt < 10; attempt++) await e.flush();
        }
        await e.c.viewing.settled(e.state.watchStatus);
        assert.equal(e.requests.length, 2);
        const network = e.logs.find(entry => entry.details?.series).details.network;
        assert.equal(network.peakInFlight, concurrency);
        assert.equal(network.inFlight, 0);
        assert.equal(network.succeeded, 2);
        assert.equal(network.failed, 0);
        assert.equal(network.totalRequestMs, 200);
        assert.equal(network.maxRequestMs, 100);
        assert.equal(network.meanRequestMs, 100);
        assert.equal(network.overlapMs, concurrency === 2 ? 100 : 0);
        const copy = e.c.viewing.diagnostics(e.state.watchStatus).network;
        assert.throws(() => { copy.succeeded = -1; }, TypeError);
        await e.advance(60000);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.elapsedMs, network.elapsedMs);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.succeeded, 2);
        runs.push(network.elapsedMs);
    }
    assert.deepEqual(runs, [200, 100], 'fake-clock overlap is evidence of scheduling, not Netflix latency');
});

test('viewing overlap keeps series dependencies ordered and drains valid partial results after HTTP failure', async () => {
    const e = await viewingEnvironment(100);
    useCompleteSeriesResponses(e);
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    assert.equal(pending.length, 2);
    pending[1].release();
    pending[0].release();
    for (let attempt = 0; attempt < 10 && pending.length < 4; attempt++) await e.flush();
    assert.deepEqual(pending.slice(2).map(entry => entry.paths[0][1]), ['1', '51'],
        'series order follows native IDs rather than title-response arrival');
    assert.ok(pending.slice(2).every(entry => entry.paths[0][2] === 'seasonList'));
    pending[2].release();
    for (let attempt = 0; attempt < 10 && pending.length < 5; attempt++) await e.flush();
    assert.equal(pending[4].paths[0][0], 'seasons');
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] !== 'seasons' || paths[0][1] !== '10051') return mockFetch(url, options);
        e.requests.push({ paths, options });
        return { ok: false, status: 429 };
    };
    pending[3].release();
    for (let attempt = 0; attempt < 10 && !e.warnings.length; attempt++) await e.flush();
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, true, 'failure cannot finalize before the valid in-flight finale drains');
    pending[4].release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 1)));
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_429');
    const network = e.logs.find(entry => entry.details?.series).details.network;
    assert.equal(network.rateLimited, 1);
    assert.equal(network.failed, 1);
    assert.equal(network.succeeded, 5);
    assert.equal(network.peakInFlight, 2);
    assert.equal(e.requests.length, 6);
    assert.equal(e.storageCalls.cacheWrites, 1);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap aborts both owned reads after route or profile cancellation', async () => {
    for (const reason of ['route', 'profile']) {
        const e = await viewingEnvironment(100);
        useCompleteMovieResponses(e);
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        await e.flush();
        assert.equal(pending.length, 2);
        const unrelated = reason === 'profile' ? e.c.sessionScope.beginRequest(1) : null;
        if (reason === 'route') {
            e.c.isRouteSessionActive = () => false;
            e.c.sessionScope.dispose();
        } else {
            e.models.userInfo.userGuid = 'other-profile';
            pending[0].release();
        }
        await e.c.viewing.settled(e.state.watchStatus);
        assert.ok(pending.every(entry => entry.signal.aborted));
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.aborted, reason === 'route' ? 2 : 1,
            'transport aborts remain visible even when their session is obsolete');
        if (reason === 'profile') {
            assert.equal(unrelated.controller.signal.aborted, false, 'a viewing-job cancellation leaves unrelated route requests owned');
            e.c.sessionScope.finishRequest(unrelated);
        }
        assert.equal(e.storageCalls.cacheWrites, 0);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
        assert.equal(e.warnings.length, 0);
        if (reason === 'profile') assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_PROFILE_CHANGED');
    }
});

test('viewing overlap stops allocating after a failed wave and shares the finite request cap', async () => {
    for (const fail of [false, true]) {
        const e = await viewingEnvironment(200);
        useCompleteMovieResponses(e);
        e.c.VIEWING_MAX_REQUESTS = 3;
        e.c.VIEWING_MAX_PASSES = 1;
        if (fail) {
            const mockFetch = e.c.fetch;
            e.c.fetch = async (url, options) => {
                const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
                if (paths[0][1][0] !== '51') return mockFetch(url, options);
                e.requests.push({ paths, options });
                return { ok: false, status: 503 };
            };
        }
        await e.start();
        assert.equal(e.requests.length, fail ? 2 : 3);
        assert.equal(completedViewingIds(e).length, fail ? 50 : 150);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, fail ? 'VIEWING_STATUS_HTTP_503' : 'VIEWING_STATUS_BUDGET');
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
    }
});

test('viewing overlap does not start a peer finale after a known metadata failure', async () => {
    const e = await viewingEnvironment(100);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][2] !== 'seasonList' || paths[0][1] !== '1') return mockFetch(url, options);
        e.requests.push({ paths, options });
        return { ok: false, status: 503 };
    };
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    pending[0].release();
    pending[1].release();
    for (let attempt = 0; attempt < 10 && pending.length < 3; attempt++) await e.flush();
    assert.equal(pending[2].paths[0][1], '51');
    await e.flush();
    pending[2].release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.equal(e.requests.length, 4);
    assert.ok(e.requests.every(request => request.paths[0][0] !== 'seasons'));
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('viewing overlap honors request timeouts and the combined deadline without leaked owners or retries', async () => {
    for (const deadline of [false, true]) {
        const e = await viewingEnvironment(150);
        useCompleteMovieResponses(e);
        if (deadline) { e.c.VIEWING_TIMEOUT_MS = 5; e.c.VIEWING_MAX_PASSES = 1; }
        const pending = delayViewingBodies(e);
        e.c.initializeWatchGroups(e.state, 1);
        await e.flush();
        assert.equal(pending.length, 2);
        await e.advance(deadline ? 5 : 8000);
        await e.c.viewing.settled(e.state.watchStatus);
        assert.equal(e.requests.length, 2);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, deadline ? 'VIEWING_STATUS_BUDGET' : 'VIEWING_STATUS_FAILED');
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.aborted, 2);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.failed, 2);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.inFlight, 0);
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
        await e.advance(120000);
        assert.equal(e.requests.length, 2);
    }
});

test('viewing completion does not guess from missing progress or series flags', async () => {
    const e = await viewingEnvironment();
    const classify = fields => e.c.classifyViewingVideo({
        type: 'movie', bookmark: null, runtime: 100, creditsOffset: 95, ...fields
    });
    assert.equal(classify({ watched: true }), 'complete');
    assert.equal(classify({ watched: false, bookmark: 100 }), 'complete');
    assert.equal(classify({ bookmark: 90 }), 'complete');
    assert.equal(classify({ bookmark: 89 }), 'in-progress');
    assert.equal(classify({ watched: false, bookmark: 0 }), 'not-started');
    assert.equal(classify({ watched: false }), 'unknown');
    assert.equal(classify({ type: 'show', watched: true }), 'unknown');
    assert.equal(classify({}), 'unknown');
});

test('caught-up series require exact season and episode coverage, unique IDs, and complete episodes', async () => {
    const e = await viewingEnvironment();
    const plan = { videoId: '4', expected: 2, seasons: [{ id: '40', count: 2, episodes: new Map() }] };
    assert.ok(plan);
    plan.seasons[0].episodes.set(0, { id: '400', status: 'complete' });
    plan.seasons[0].episodes.set(1, { id: '401', status: 'complete' });
    assert.equal(e.c.classifyViewingSeries(plan), 'complete');
    plan.seasons[0].episodes.set(1, { id: '401', status: 'not-started' });
    assert.equal(e.c.classifyViewingSeries(plan), 'in-progress');
    plan.seasons[0].episodes.set(1, { id: '400', status: 'complete' });
    assert.equal(e.c.classifyViewingSeries(plan), 'unknown');
    plan.seasons[0].episodes.delete(1);
    assert.equal(e.c.classifyViewingSeries(plan), 'unknown');
});

test('background viewing collection groups finished movies and complete series while preserving native order and counts', async () => {
    const e = await viewingEnvironment();
    const original = e.items.map(item => ({ videoId: item.videoId, page: item.page }));
    await e.start();
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.equal(viewingUi(e).details.open, false);
    assert.equal(e.c.gridView.presentation().completedCount, 2);
    assert.equal(e.c.gridView.presentation().unknownCount, 2);
    assert.match(viewingUi(e).note.textContent, /2 titles/);
    assert.equal(e.state.totalCount, 7);
    assert.equal(e.state.cloneMap.size, 7);
    assert.deepEqual(e.items.map(item => ({ videoId: item.videoId, page: item.page })), original);
    assert.equal(e.requests.length, 3);
    for (const request of e.requests) {
        assert.equal(request.options.method, 'POST');
        assert.equal(request.options.credentials, 'same-origin');
        assert.equal(request.options.headers['x-netflix.request.client.user.guid'], 'active-profile');
        assert.equal(new URLSearchParams(request.options.body).get('authURL'), 'test-auth-token');
        assert.ok(request.paths.every(path => ['videos', 'seasons'].includes(path[0])));
        assert.equal(new URL(request.url).origin, 'https://www.netflix.com');
    }
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
});

test('refresh returns a caught-up series to the main list when a new unwatched episode appears', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const clones = new Map(e.state.cloneMap);
    e.setFixtures(viewingFixtures(true));
    await e.c.refreshViewingStatus(e.state);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '4', '5', '6', '7']);
    assert.deepEqual(completedViewingIds(e), ['1']);
    for (const [key, clone] of clones) assert.equal(e.state.cloneMap.get(key), clone, 'grouping moves existing cards');
    assert.equal(e.items[3].page, 0, 'native page still includes the hidden first title');
});







test('missing active-profile identity or unsafe endpoint leaves all titles visible without requests', async () => {
    for (const mode of ['missing-auth', 'owner-only', 'external-endpoint']) {
        const e = await viewingEnvironment();
        if (mode === 'missing-auth') delete e.models.userInfo.authURL;
        if (mode === 'owner-only') delete e.models.userInfo.userGuid;
        if (mode === 'external-endpoint') e.models.services.memberapi = 'https://example.test/api';
        await e.start();
        assert.equal(e.requests.length, 0);
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_CONTEXT');
        assert.match(viewingUi(e).note.textContent, /7 titles/);
    }
});

test('viewing HTTP/JSON failures preserve the grid and never turn absent data into watched titles', async () => {
    for (const mode of ['http', 'json', 'shape', 'timeout']) {
        const e = await viewingEnvironment();
        e.c.fetch = async (_, options) => {
            if (mode === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort',
                () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
            return {
                ok: mode !== 'http', status: 404,
                json: async () => { if (mode === 'json') throw new SyntaxError('invalid'); return {}; }
            };
        };
        e.c.initializeWatchGroups(e.state, 1);
        if (mode === 'timeout') await e.advance(8000);
        await e.c.viewing.settled(e.state.watchStatus);
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, false);
        assert.ok(e.c.viewing.diagnostics(e.state.watchStatus).failure);
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
        assert.equal(e.state.grid.isConnected, true);
    }
});

test('viewing title requests batch large lists and grouping never schedules periodic refresh work', async () => {
    const e = await viewingEnvironment(150);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    await e.start();
    assert.equal(e.requests.length, 3);
    assert.ok(e.requests.every(request => request.paths[0][1].length === 50));
    assert.equal(completedViewingIds(e).length, 150);
    assert.equal(mainViewingIds(e).length, 0);
    assert.equal(viewingUi(e).empty.hidden, false);
    assert.equal(e.timers.size, 0);
    e.c.syncWatchGroups(e.state);
    await e.advance(60000);
    assert.equal(e.requests.length, 3);
});

test('long seasons request only their latest episode and oversize series remain unknown', async () => {
    const e = await viewingEnvironment(2);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        let graph;
        if (Array.isArray(paths[0][2])) graph = { videos: {
            1: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(500) }),
            2: viewingVideo('show', true, 0, { seasonCount: atom(1), episodeCount: atom(501) })
        } };
        else if (paths[0][0] === 'videos') graph = {
            videos: { 1: { seasonList: { 0: reference('seasons', 10) } } },
            seasons: { 10: { summary: atom({ length: 500 }) } }
        };
        else {
            const range = paths[0][3];
            const indices = Array.from({ length: range.to - range.from + 1 }, (_, index) => range.from + index);
            graph = {
                seasons: { 10: { episodes: Object.fromEntries(indices.map(index => [index, reference('videos', 1000 + index)])) } },
                videos: Object.fromEntries(indices.map(index => [1000 + index, viewingVideo('episode', true)]))
            };
        }
        return { ok: true, json: async () => ({ jsonGraph: graph }) };
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.deepEqual(mainViewingIds(e), ['2']);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons').map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
});

test('viewing request budget preserves confirmed movies and leaves unverified series visible', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_MAX_REQUESTS = 1;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(e.requests.length, 1);
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.ok(mainViewingIds(e).includes('4'));
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    assert.equal(e.c.sessionScope.requestCount(), 0);
});

test('a large short-series list is fully covered within the original single-pass request budget', async () => {
    const e = await viewingEnvironment(500);
    useCompleteSeriesResponses(e);
    await e.start();
    assert.equal(e.requests.length, 30);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 500 }, (_, index) => String(index + 1)));
    assert.equal(mainViewingIds(e).length, 0);
    assert.equal(e.c.gridView.presentation().unknownCount, 0);
    const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
    assert.deepEqual({ ...diagnostic }, { found: 500, eligible: 500, planned: 500, checked: 500, complete: 500,
        unknown: 0, incomplete: 0, unplanned: 0, episodesChecked: 500, episodesIncomplete: 0, episodesUnknown: 0,
        missingEpisodeRefs: 0, pending: 0 });
    assert.equal(e.state.totalCount, 500);
    assert.equal(e.state.cloneMap.size, 500);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('completed series results survive a budget limit inside the current episode group', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 200, 2: 1 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(e.requests.length, 3);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.deepEqual(mainViewingIds(e), ['2']);
    assert.equal(e.c.gridView.presentation().unknownCount, 1);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('a later series-group HTTP failure preserves fully verified series results', async () => {
    const e = await viewingEnvironment(51);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'seasons' && paths[0][1] === '10051') {
            e.requests.push({ url, options, paths });
            return { ok: false, status: 503 };
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.equal(e.requests.length, 6);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 50 }, (_, index) => String(index + 1)));
    assert.deepEqual(mainViewingIds(e), ['51']);
    assert.equal(e.c.gridView.presentation().unknownCount, 1);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('route leave aborts viewing requests and stale completion cannot update a new grid', async () => {
    const e = await viewingEnvironment();
    let signal;
    e.c.fetch = (_, options) => new Promise((_, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    e.c.initializeWatchGroups(e.state, 1);
    const promise = e.c.viewing.settled(e.state.watchStatus);
    const newer = { grid: { isConnected: true }, watchStatus: { marker: 'new' } };
    e.c.sourceState = newer;
    e.c.isRouteSessionActive = token => token === 2;
    e.c.sessionScope.dispose();
    await promise;
    assert.equal(signal.aborted, true);
    assert.equal(e.c.sourceState, newer);
    assert.equal(newer.watchStatus.marker, 'new');
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
    assert.equal(e.warnings.length, 0);
});

test('profile changes during body reads discard results and refreshing a new profile clears prior completion', async () => {
    const e = await viewingEnvironment();
    await e.start();
    let completeBody;
    e.c.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { completeBody = resolve; }) });
    const promise = e.c.refreshViewingStatus(e.state);
    await e.flush();
    e.models.userInfo.userGuid = 'other-profile';
    completeBody({ jsonGraph: e.fixtures().titles });
    await promise;
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_PROFILE_CHANGED');
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, false);
    const next = e.c.refreshViewingStatus(e.state);
    assert.equal(completedViewingIds(e).length, 0);
    await e.flush();
    completeBody({ jsonGraph: {} });
    await next;
    assert.equal(mainViewingIds(e).length, 7);
});

test('simultaneous manual refreshes share the current viewing scan', async () => {
    const e = await viewingEnvironment();
    let release;
    let calls = 0;
    e.c.fetch = async () => {
        calls++;
        return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
    };
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    const second = e.c.refreshViewingStatus(e.state);
    assert.equal(calls, 1);
    release({ jsonGraph: {} });
    await Promise.all([e.c.viewing.settled(e.state.watchStatus), second]);
    assert.equal(calls, 1);
    assert.equal(viewingUi(e).refresh.disabled, false);
});

test('viewing collection stops at its elapsed-time budget without hiding unverified series', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_TIMEOUT_MS = 5;
    e.c.VIEWING_MAX_PASSES = 1;
    const fetch = e.c.fetch;
    e.c.fetch = async (...args) => {
        const response = await fetch(...args);
        const json = response.json;
        response.json = async () => { const body = await json(); await e.advance(5); return body; };
        return response;
    };
    await e.start();
    assert.equal(e.requests.length, 1);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.ok(mainViewingIds(e).includes('4'));
    assert.equal(e.timers.size, 0);
});

test('failed refresh reveals old completion results instead of hiding titles using stale status', async () => {
    const e = await viewingEnvironment();
    await e.start();
    assert.equal(completedViewingIds(e).length, 2);
    e.c.fetch = async () => ({ ok: false, status: 503 });
    await e.c.refreshViewingStatus(e.state);
    assert.equal(completedViewingIds(e).length, 0);
    assert.equal(mainViewingIds(e).length, 7);
    assert.equal(e.c.gridView.presentation().unknownCount, 7);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
});

test('completion accepts 90 percent or earlier credits even when Netflix still reports unwatched', async () => {
    const e = await viewingEnvironment();
    const classify = fields => e.c.classifyViewingVideo({
        type: 'movie', watched: false, bookmark: 0, runtime: 3600, creditsOffset: null, ...fields
    });
    assert.equal(classify({ bookmark: 3060 }), 'in-progress', '85 percent remains below the selected cutoff');
    assert.equal(classify({ bookmark: 3239 }), 'in-progress');
    assert.equal(classify({ bookmark: 3240 }), 'complete', 'the 90 percent boundary is inclusive');
    assert.equal(classify({ bookmark: 3241 }), 'complete');
    assert.equal(classify({ bookmark: 3420 }), 'complete', 'previously accepted 95 percent still qualifies');
    assert.equal(classify({ bookmark: 3200, creditsOffset: 3200 }), 'complete', 'an earlier real credits boundary wins');
    assert.equal(classify({ bookmark: 3199, creditsOffset: 3200 }), 'in-progress');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 3500 }), 'complete', 'later credits do not override 90 percent');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 4000 }), 'complete', 'invalid credits use the runtime threshold');
    assert.equal(classify({ bookmark: 3240, creditsOffset: 0 }), 'complete');
    assert.equal(classify({ watched: true, bookmark: 0 }), 'complete', 'a confirmed Netflix completion remains sufficient');
    assert.equal(classify({ type: 'show', watched: true, bookmark: 3600 }), 'unknown', 'series need episode coverage');
});

test('near-completion requires valid progress and runtime rather than treating missing values as watched', async () => {
    const e = await viewingEnvironment();
    for (const fields of [
        { bookmarkPosition: atom(undefined) },
        { bookmarkPosition: atom(null) },
        { bookmarkPosition: atom(-1) },
        { bookmarkPosition: atom(Infinity) },
        { bookmarkPosition: atom('95') },
        { runtime: atom(undefined) },
        { runtime: atom(0) },
        { runtime: atom(-100) },
        { runtime: atom(NaN) },
        { runtime: atom('100') }
    ]) {
        const records = await viewingRecords(e, { videos: {
            1: viewingVideo('movie', false, 95, { creditsOffset: atom(90), ...fields })
        } }, ['1']);
        const record = records.get('1');
        assert.notEqual(e.c.classifyViewingVideo(record), 'complete');
    }
    const records = await viewingRecords(e, { videos: {
        1: viewingVideo('movie', false, 0)
    } }, ['1']);
    assert.equal(e.c.classifyViewingVideo(records.get('1')), 'not-started');
});

test('viewing requests resolve structured member API addresses before fetching', async () => {
    for (const path of [['/nq/website/memberapi/release'], ['nq', 'website', 'memberapi', 'release']]) {
        const e = await viewingEnvironment();
        e.models.services.memberapi = { protocol: 'https', hostname: 'www.netflix.com', path };
        const mockFetch = e.c.fetch;
        e.c.fetch = async (url, options) => {
            if (new URL(url).pathname !== '/nq/website/memberapi/release/pathEvaluator') {
                return { ok: false, status: 400 };
            }
            return mockFetch(url, options);
        };
        await e.start();
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
        assert.deepEqual(completedViewingIds(e), ['1', '4']);
        assert.equal(e.requests.length, 3);
        assert.equal(e.timers.size, 0);
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
    }
});

test('viewing request addresses preserve string and build fallback support', async () => {
    for (const mode of ['relative', 'absolute', 'colon-protocol', 'build']) {
        const e = await viewingEnvironment();
        let expected = '/api/shakti/test-build/pathEvaluator';
        if (mode === 'relative') e.models.services.memberapi = '/api/shakti/test-build';
        if (mode === 'absolute') e.models.services.memberapi = 'https://www.netflix.com/api/shakti/test-build/';
        if (mode === 'colon-protocol') {
            e.models.services.memberapi = { protocol: 'https:', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] };
            expected = '/nq/website/memberapi/release/pathEvaluator';
        }
        if (mode === 'build') delete e.models.services.memberapi;
        await e.start();
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
        assert.ok(e.requests.every(request => new URL(request.url).pathname === expected));
        assert.ok(e.logs.some(entry => entry.details?.endpointPath === expected));
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
        assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('active-profile'));
    }
});

test('malformed or unsafe structured viewing endpoints do not send requests', async () => {
    for (const memberapi of [
        {}, { protocol: 'https', hostname: 'www.netflix.com', path: '/nq/website/memberapi/release' },
        { protocol: 'https', hostname: 'www.netflix.com', path: [] },
        { protocol: 'https', hostname: 'www.netflix.com', path: [null] },
        { protocol: 'https', hostname: 'example.test', path: ['/nq/website/memberapi/release'] },
        { protocol: 'http', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] },
        { protocol: '', hostname: 'www.netflix.com', path: ['/nq/website/memberapi/release'] },
        { protocol: 'https', hostname: 'user:password@www.netflix.com', path: ['/nq/website/memberapi/release'] },
        'https://www.netflix.com/api/shakti/build?authURL=hidden',
        'https://www.netflix.com/api/shakti/build#hidden', true, 123
    ]) {
        const e = await viewingEnvironment();
        e.models.services.memberapi = memberapi;
        await e.start();
        assert.equal(e.requests.length, 0);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_CONTEXT');
        assert.equal(mainViewingIds(e).length, 7);
        assert.equal(completedViewingIds(e).length, 0);
        assert.equal(e.timers.size, 0);
    }
});

test('rejected viewing batches are attempted once and stop subsequent requests with endpoint diagnostics', async () => {
    const e = await viewingEnvironment(500);
    let attempts = 0;
    const batches = [];
    e.c.fetch = async (url, options) => {
        attempts++;
        batches.push(new URLSearchParams(options.body).getAll('path')[0]);
        assert.equal(new URL(url).pathname, '/nq/website/memberapi/release/pathEvaluator');
        return { ok: false, status: 400 };
    };
    await e.start();
    assert.equal(attempts, 2, 'only the initially allocated wave is attempted');
    assert.equal(new Set(batches).size, 2, 'neither failed batch is retried');
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).requests, 2);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_400');
    assert.equal(e.c.gridView.presentation().unknownCount, 500);
    assert.equal(mainViewingIds(e).length, 500);
    assert.equal(completedViewingIds(e).length, 0);
    const start = e.logs.find(entry => entry.details?.endpointType === 'descriptor');
    assert.equal(start.details.endpointPath, '/nq/website/memberapi/release/pathEvaluator');
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('test-auth-token'));
    assert.ok(!JSON.stringify([...e.logs, ...e.warnings]).includes('active-profile'));
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
    e.c.syncWatchGroups(e.state);
    await e.advance(60000);
    assert.equal(attempts, 2, 'there is no repeated retry loop');
});

test('credit-tolerant completion moves movies and fully caught-up series out of the main grid', async () => {
    const e = await viewingEnvironment();
    const fixtures = e.fixtures();
    fixtures.titles.videos[1] = viewingVideo('movie', false, 90, { creditsOffset: atom(99) });
    fixtures.titles.videos[2] = viewingVideo('movie', false, 85, { creditsOffset: atom(99) });
    fixtures.episodes.videos[400] = viewingVideo('episode', false, 90, { creditsOffset: atom(99) });
    fixtures.episodes.videos[401] = viewingVideo('episode', false, 85, { creditsOffset: atom(85) });
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.equal(viewingUi(e).details.open, false);
    assert.equal(e.requests.length, 3, 'completion threshold adds no requests');
    assert.equal(e.timers.size, 0);
});

test('an unfinished latest episode cannot qualify by averaging its progress with older episodes', async () => {
    const e = await viewingEnvironment();
    const fixtures = e.fixtures();
    fixtures.episodes.videos[400] = viewingVideo('episode', false, 100, { creditsOffset: atom(99) });
    fixtures.episodes.videos[401] = viewingVideo('episode', false, 80, { creditsOffset: atom(99) });
    await e.start();
    assert.ok(mainViewingIds(e).includes('4'), '100 percent plus 80 percent is still not caught up');
    assert.deepEqual(completedViewingIds(e), ['1']);
    fixtures.episodes.videos[401].bookmarkPosition = atom(90);
    await e.c.refreshViewingStatus(e.state);
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
});

test('film filters default independently below the heading and inside watched details with accurate counts', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const ui = viewingUi(e);
    assert.equal(e.c.gridView.presentation().filters.main, 'movie');
    assert.equal(e.c.gridView.presentation().filters.watched, 'movie');
    assert.equal(e.state.grid.children[0], ui.mainFilter.root);
    assert.equal(ui.watchedFilter.root.parentElement, ui.details);
    assert.equal(ui.details.open, false);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1']);
    assert.equal(ui.mainFilter.buttons.get('movie').count.textContent, '2');
    assert.equal(ui.mainFilter.buttons.get('series').count.textContent, '2');
    assert.equal(ui.mainFilter.buttons.get('all').count.textContent, '5');
    assert.equal(ui.watchedFilter.buttons.get('movie').count.textContent, '1');
    assert.equal(ui.watchedFilter.buttons.get('series').count.textContent, '1');
    assert.equal(ui.mainFilter.root.getAttribute('role'), 'group');
    assert.equal(ui.mainFilter.buttons.get('movie').button.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.mainFilter.buttons.get('series').button.getAttribute('aria-pressed'), 'false');
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1']);
    ui.details.open = true;
    ui.details.dispatchEvent({ type: 'toggle' });
    clickViewingFilter(e, 'watched', 'series');
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['4']);
    assert.equal(ui.watchedFilter.buttons.get('series').button.getAttribute('aria-pressed'), 'true');
    assert.equal(e.state.items.length, 7);
    assert.equal(e.state.cloneMap.size, 7);
    assert.equal(e.requests.length, 3);
    assert.equal(e.timers.size, 0);
});

test('All includes unknown title types without assigning them to films or series', async () => {
    const e = await viewingEnvironment();
    await e.start();
    assert.ok(!e.c.viewing.freshType(e.state.watchStatus, '7'));
    assert.match(viewingUi(e).note.textContent, /Choose All/);
    clickViewingFilter(e, 'main', 'all');
    assert.deepEqual(filteredViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.ok(!viewingUi(e).note.textContent.includes('Choose All'));
    clickViewingFilter(e, 'main', 'movie');
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.equal(e.requests.length, 3);
});

test('unavailable metadata keeps every title reachable through All and displays an accurate empty filter state', async () => {
    const e = await viewingEnvironment();
    let attempts = 0;
    e.c.fetch = async () => { attempts++; return { ok: false, status: 400 }; };
    await e.start();
    assert.deepEqual(filteredViewingIds(e), []);
    assert.equal(viewingUi(e).empty.hidden, false);
    assert.equal(viewingUi(e).empty.textContent, 'No titles match this filter.');
    assert.equal(viewingUi(e).mainFilter.buttons.get('all').count.textContent, '7');
    clickViewingFilter(e, 'main', 'all');
    assert.deepEqual(filteredViewingIds(e), ['1', '2', '3', '4', '5', '6', '7']);
    assert.equal(viewingUi(e).empty.hidden, true);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_400');
    assert.equal(attempts, 1);
    assert.equal(e.timers.size, 0);
});

test('type filtering is available while series episode requests are still loading', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][2] === 'seasonList') return new Promise(resolve => { release = () => resolve(mockFetch(url, options)); });
        return mockFetch(url, options);
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    assert.equal(typeof release, 'function');
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, true);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    assert.deepEqual(completedViewingIds(e), ['1'], 'confirmed movies move before episode requests return');
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['4', '5', '6']);
    release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.equal(e.c.gridView.presentation().filters.main, 'series');
    assert.equal(e.requests.length, 3);
});

test('native hover replacements preserve the visibility of filtered sibling cards', async () => {
    const e = await viewingEnvironment();
    await e.start();

    const item = e.state.items.find(item => item.videoId === '5');
    const old = e.state.cloneMap.get('v:5');
    const fresh = e.c.gridView.replaceCard(e.c.gridView.getCard(item), {node:old.cloneNode(true)}).node;

    assert.equal(fresh.getAttribute('data-tm-type-hidden'), 'true');
    assert.equal(e.c.gridView.isCardVisible(fresh, e.state.grid), false);
    assert.deepEqual(filteredViewingIds(e), ['2', '3']);
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['5', '6']);
    assert.equal(e.c.gridView.isCardVisible(fresh, e.state.grid), true);
    assert.equal(e.requests.length, 3);
});

test('viewing refresh preserves type selections and updates counts when a series has new episodes', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    viewingUi(e).details.open = true;
    viewingUi(e).details.dispatchEvent({ type: 'toggle' });
    clickViewingFilter(e, 'watched', 'series');
    e.setFixtures(viewingFixtures(true));
    await e.c.refreshViewingStatus(e.state);
    assert.equal(e.c.gridView.presentation().filters.main, 'series');
    assert.equal(e.c.gridView.presentation().filters.watched, 'series');
    assert.deepEqual(filteredViewingIds(e), ['4', '5', '6']);
    assert.deepEqual(filteredViewingIds(e, 'watched'), []);
    assert.equal(viewingUi(e).mainFilter.buttons.get('series').count.textContent, '3');
    assert.equal(viewingUi(e).watchedFilter.buttons.get('movie').count.textContent, '1');
    assert.equal(viewingUi(e).watchedEmpty.hidden, false);
    assert.equal(viewingUi(e).watchedEmpty.textContent, 'No titles match this filter.');
});

test('missing series episode totals are recovered from fully covered season summaries', async () => {
    const e = await viewingEnvironment();
    delete e.fixtures().titles.videos[4].episodeCount;
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    assert.ok(!completedViewingIds(e).includes('5'), 'a partly watched series still stays in the main grid');
    assert.equal(e.requests.length, 3, 'validated season metadata allows finale checks to share a batch');
});

test('small series batches fill the existing episode allowance without cutting off later series', async () => {
    const e = await viewingEnvironment(120);
    useCompleteSeriesResponses(e);
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.equal(completedViewingIds(e).length, 120);
    assert.equal(e.requests.length, 9);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
});

test('a missing-count series requires validated season coverage and a usable completed latest episode', async () => {
    const e = await viewingEnvironment();
    const title = e.fixtures().titles.videos[4];
    delete title.seasonCount;
    delete title.episodeCount;
    e.fixtures().seasons.videos[4].seasonList.length = atom(1);
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    const request = e.requests.find(request => request.paths.some(path => path[2] === 'seasonList' && path[3] === 'length'));
    assert.ok(request);
    assert.equal(request.paths[0][3].to, 39);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 20);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(!completedViewingIds(e).includes('4'));
    delete e.fixtures().episodes.seasons[40].episodes[1];
    await e.c.refreshViewingStatus(e.state);
    assert.ok(!completedViewingIds(e).includes('4'), 'a missing latest reference cannot establish completion');
});

test('count recovery never replaces invalid or contradictory totals supplied by Netflix', async () => {
    const e = await viewingEnvironment();
    for (const [field, value] of [['episodeCount', '2'], ['episodeCount', -1], ['episodeCount', 2.5],
        ['episodeCount', true], ['episodeCount', {}], ['episodeCount', 3], ['seasonCount', '1']]) {
        const title = e.fixtures().titles.videos[4];
        title.seasonCount = atom(1);
        title.episodeCount = atom(2);
        title[field] = atom(value);
        if (!e.state.watchStatus) await e.start();
        else await e.c.refreshViewingStatus(e.state);
        assert.ok(!completedViewingIds(e).includes('4'), field + ': ' + JSON.stringify(value));
        assert.ok(mainViewingIds(e).includes('4'));
    }
});

test('bounded additional passes continue the same queue without reloading title or episode data', async () => {
    const e = await viewingEnvironment(3);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 3;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '2', '3']);
    assert.equal(e.requests.length, 7);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).passes, 3);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
    assert.equal(e.requests.filter(request => Array.isArray(request.paths[0][2])).length, 1);
    const episodePaths = e.requests.filter(request => request.paths[0][0] === 'seasons').flatMap(request => request.paths);
    assert.equal(new Set(episodePaths.map(path => JSON.stringify(path))).size, episodePaths.length);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('a latest range can continue across a pass boundary without fetching older ranges', async () => {
    const e = await viewingEnvironment(1);
    useCompleteSeriesResponses(e, { 1: 500 });
    e.c.VIEWING_MAX_REQUESTS = 2;
    e.c.VIEWING_MAX_PASSES = 2;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.requests.length, 3);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).passes, 2);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons').map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
});

test('the total continuation request cap is finite and leaves unprocessed series visible', async () => {
    const e = await viewingEnvironment(4);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200, 4: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 2;
    await e.start();
    assert.equal(e.requests.length, 6);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).passes, 2);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1', '2']);
    assert.deepEqual(mainViewingIds(e), ['3', '4']);
    const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
    assert.equal(diagnostic.pending, 2);
    await e.advance(120000);
    assert.equal(e.requests.length, 6, 'no recurring timer restarts an exhausted scan');
    assert.equal(e.timers.size, 0);
});

test('the combined scan time cap bounds a scan even when few requests consume the entire allowance', async () => {
    const e = await viewingEnvironment();
    e.c.VIEWING_TIMEOUT_MS = 5;
    e.c.VIEWING_MAX_PASSES = 2;
    const mockFetch = e.c.fetch;
    e.c.fetch = async (...args) => {
        const response = await mockFetch(...args);
        const json = response.json;
        response.json = async () => { const body = await json(); await e.advance(5); return body; };
        return response;
    };
    await e.start();
    assert.equal(e.requests.length, 2);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).passes, 1);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.timers.size, 0);
});

test('slow successful requests can use the total time allowance without aborting at the old 30-second boundary', async () => {
    const e = await viewingEnvironment(3);
    useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
    e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
    const pending = delayViewingBodies(e);
    e.c.initializeWatchGroups(e.state, 1);
    for (let wave = 0; wave < 7 && e.c.viewing.diagnostics(e.state.watchStatus).loading; wave++) {
        for (let attempt = 0; attempt < 10; attempt++) await e.flush();
        const active = pending.filter(entry => !entry.released);
        if (!active.length) break;
        // Parallel reads experience the same elapsed interval; advancing the
        // shared clock once per response would incorrectly double their wait.
        await e.advance(7000);
        active.forEach(entry => entry.release());
    }
    await e.c.viewing.settled(e.state.watchStatus);
    assert.deepEqual(completedViewingIds(e), ['1', '2', '3']);
    assert.equal(e.requests.length, 7);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.totalRequestMs, 49000);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).network.elapsedMs, 35000);
    assert.equal(e.timers.size, 0);
});

test('an unfinished or unreadable latest episode saves older-range requests for later titles', async () => {
    for (const mode of ['unfinished', 'missing-fields', 'missing-ref']) {
        const e = await viewingEnvironment(2);
        useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
        const mockFetch = e.c.fetch;
        e.c.fetch = async (...args) => {
            const response = await mockFetch(...args);
            const json = response.json;
            response.json = async () => {
                const body = await json();
                if (body.jsonGraph.videos['10001499']) {
                    if (mode === 'unfinished') body.jsonGraph.videos['10001499'] = viewingVideo('episode', false, 20);
                    if (mode === 'missing-fields') body.jsonGraph.videos['10001499'] = { summary: atom({ type: 'episode' }) };
                    if (mode === 'missing-ref') delete body.jsonGraph.seasons['10001'].episodes[499];
                }
                return body;
            };
            return response;
        };
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['2'], mode);
        assert.deepEqual(mainViewingIds(e), ['1']);
        assert.equal(e.requests.length, mode === 'missing-fields' ? 4 : 3,
            'unavailable fields get one direct follow-up; unfinished episodes and missing IDs do not');
        const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons' && request.paths[0][1] === '10001');
        assert.equal(ranges.length, 1);
        const diagnostic = e.logs.find(entry => entry.details?.series)?.details.series;
        assert.equal(diagnostic.episodesChecked, 2);
        assert.equal(mode === 'unfinished' ? diagnostic.incomplete : diagnostic.unknown, 1);
        assert.equal(e.timers.size, 0);
    }
});

test('verified groups appear before a later request completes while filters remain selected', async () => {
    const e = await viewingEnvironment(51);
    useCompleteSeriesResponses(e);
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'seasons' && paths[0][1] === '10051') {
            return new Promise(resolve => { release = () => resolve(mockFetch(url, options)); });
        }
        return mockFetch(url, options);
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && (!release || completedViewingIds(e).length !== 50); attempt++) await e.flush();
    assert.equal(typeof release, 'function');
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, true);
    assert.equal(completedViewingIds(e).length, 50);
    clickViewingFilter(e, 'main', 'series');
    assert.deepEqual(filteredViewingIds(e), ['51']);
    viewingUi(e).details.open = true;
    viewingUi(e).details.dispatchEvent({ type: 'toggle' });
    clickViewingFilter(e, 'watched', 'series');
    assert.equal(filteredViewingIds(e, 'watched').length, 50);
    release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.equal(filteredViewingIds(e, 'watched').length, 51);
    assert.equal(e.c.gridView.presentation().filters.watched, 'series');
    assert.equal(e.c.gridView.presentation().filters.main, 'series');
});

test('route and profile cancellation stop an additional pass without changing a newer grid or leaking prior results', async () => {
    for (const mode of ['route', 'profile']) {
        const e = await viewingEnvironment(3);
        useCompleteSeriesResponses(e, { 1: 200, 2: 200, 3: 200 });
        e.c.VIEWING_EPISODE_BATCH_SIZE = 1;
        e.c.VIEWING_MAX_REQUESTS = 3;
        const mockFetch = e.c.fetch;
        let signal, release;
        e.c.fetch = async (url, options) => {
            const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
            if (paths[0][0] === 'seasons' && paths[0][1] === '10002') {
                signal = options.signal;
                return { ok: true, json: () => new Promise((resolve, reject) => {
                    release = () => resolve({ jsonGraph: {} });
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                }) };
            }
            return mockFetch(url, options);
        };
        e.c.initializeWatchGroups(e.state, 1);
        for (let attempt = 0; attempt < 10 && (!release || !completedViewingIds(e).includes('1')); attempt++) await e.flush();
        assert.equal(typeof release, 'function');
        assert.deepEqual(completedViewingIds(e), ['1']);
        const promise = e.c.viewing.settled(e.state.watchStatus);
        if (mode === 'route') {
            e.c.sourceState = { grid: { isConnected: true }, watchStatus: { newer: true } };
            e.c.isRouteSessionActive = token => token === 2;
            e.c.sessionScope.dispose();
        } else {
            e.models.userInfo.userGuid = 'other-profile';
            release();
        }
        await promise;
        if (mode === 'route') assert.equal(e.c.sourceState.watchStatus.newer, true);
        else {
            assert.deepEqual(completedViewingIds(e), []);
            assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).typeCount, 0);
            assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_PROFILE_CHANGED');
        }
        assert.equal(signal.aborted, true);
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
    }
});

test('referenced watched and progress fields are resolved without accepting cyclic or missing references', async () => {
    const e = await viewingEnvironment();
    const graph = { videos: { 400: { summary: reference('values', 'summary'), watched: reference('values', 'watched'),
        bookmarkPosition: reference('values', 'bookmark'), runtime: reference('values', 'runtime') } },
        values: { summary: atom({ type: 'episode' }), watched: atom(false), bookmark: atom(95), runtime: atom(100) } };
    assert.equal(e.c.classifyViewingVideo((await viewingRecords(e, graph, ['400'])).get('400')), 'complete');
    graph.values.watched = { $type: 'ref', value: ['values', 'watched'] };
    delete graph.values.bookmark;
    assert.equal(e.c.classifyViewingVideo((await viewingRecords(e, graph, ['400'])).get('400')), 'unknown');
});

test('direct episode lookups recover caught-up series from sparse nested responses', async () => {
    const e = await viewingEnvironment();
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.deepEqual(mainViewingIds(e), ['2', '3', '5', '6', '7']);
    assert.equal(e.requests.length, 4);
    const direct = e.requests.at(-1).paths[0];
    assert.deepEqual(direct[1], ['401']);
    const details = e.logs.find(entry => entry.details?.recheck)?.details;
    assert.equal(details.recheck.candidates, 1);
    assert.equal(details.recheck.requests, 1);
    assert.equal(details.recheck.recoveredEpisodes, 1);
    assert.equal(details.recheck.recoveredSeries, 1);
    assert.equal(details.series.complete, 1);
    assert.equal(details.series.unknown, 0);
    assert.equal(details.recheck.initialUnknownFields.watched.missing, 1);
    assert.equal(e.timers.size, 0);
});

test('direct responses can fill missing progress fields while known unfinished episodes stay visible', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 90);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 90);
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
        delete graph.videos[400].runtime;
        delete graph.videos[401].runtime;
    });
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'), 'the nested runtime and direct bookmark together establish completion');
    assert.ok(mainViewingIds(e).includes('5'), 'a known partly watched series never enters the repair queue');
});

test('an unusable direct response is attempted once and cannot turn unknown, negative or conflicting data into watched', async () => {
    for (const mode of ['absent', 'negative', 'wrong-type']) {
        const e = await viewingEnvironment();
        useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
            if (mode === 'absent') { delete graph.videos[400]; delete graph.videos[401]; }
            else for (const id of ['400', '401']) graph.videos[id] = mode === 'negative'
                ? viewingVideo('episode', false, -1) : viewingVideo('show', true);
        });
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['1'], mode);
        assert.equal(e.requests.length, 4);
        const recheck = e.logs.find(entry => entry.details?.recheck)?.details.recheck;
        assert.equal(recheck.recoveredSeries, 0);
        assert.equal(recheck.unknownEpisodes, 1);
        if (mode === 'negative') assert.equal(recheck.remainingUnknownFields.bookmark['atom:negative-number'], 1);
        await e.advance(120000);
        assert.equal(e.requests.length, 4, 'failed rechecks never become an automatic retry loop');
        assert.equal(e.timers.size, 0);
    }
});

test('repair batches are limited to 200 unique IDs and start after all ordinary series have been checked', async () => {
    const e = await viewingEnvironment(250);
    useCompleteSeriesResponses(e, Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index + 1, 120])));
    useSparseNestedEpisodes(e, id => Number(id) < 10250000);
    const mockFetch = e.c.fetch;
    const baseCounts = [];
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
            baseCounts.push(completedViewingIds(e).slice());
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), Array.from({ length: 250 }, (_, index) => String(index + 1)));
    assert.deepEqual(baseCounts[0], ['250'], 'the later known complete series is preserved before repair begins');
    const repair = e.requests.filter(request => request.paths[0][0] === 'videos' && Array.isArray(request.paths[0][2]) &&
        !request.paths[0][2].includes('seasonCount'));
    assert.deepEqual(repair.map(request => request.paths[0][1].length), [200, 49]);
    const ids = repair.flatMap(request => request.paths[0][1]);
    assert.equal(new Set(ids).size, 249);
    assert.equal(e.logs.find(entry => entry.details?.recheck)?.details.recheck.recoveredSeries, 249);
});

test('a repaired latest episode qualifies a long series without fetching older ranges or double-counting it', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
    useSparseNestedEpisodes(e, id => id === '10001499');
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1', '2']);
    const ranges = e.requests.filter(request => request.paths[0][0] === 'seasons' && request.paths[0][1] === '10001')
        .map(request => request.paths[0][3]);
    assert.deepEqual(ranges, [{ from: 499, to: 499 }]);
    const details = e.logs.find(entry => entry.details?.recheck)?.details;
    assert.equal(details.series.checked, 2);
    assert.equal(details.series.complete, 2);
    assert.equal(details.series.unknown, 0);
    assert.equal(details.recheck.recoveredSeries, 1);
    assert.equal(e.requests.length, 4);
});

test('repair budget exhaustion preserves known series and leaves an unknown latest episode visible', async () => {
    const e = await viewingEnvironment(2);
    useCompleteSeriesResponses(e, { 1: 500, 2: 1 });
    useSparseNestedEpisodes(e, id => id === '10001499');
    e.c.VIEWING_MAX_REQUESTS = 3;
    e.c.VIEWING_MAX_PASSES = 1;
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['2']);
    assert.equal(e.requests.length, 3);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_BUDGET');
    const report = e.c.collectViewingSeriesDiagnostics(e.state);
    assert.equal(report[0].checkedEpisodes, 1);
    assert.equal(report[0].expectedEpisodes, 500);
    assert.equal(report[0].reason, 'unavailable-episode-progress');
    assert.equal(e.timers.size, 0);
});

test('a failed direct request retains known watched titles and never retries the endpoint', async () => {
    const e = await viewingEnvironment();
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
    const mockFetch = e.c.fetch;
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
            e.requests.push({ paths });
            return { ok: false, status: 503 };
        }
        return mockFetch(url, options);
    };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
    assert.equal(e.requests.length, 4);
    assert.equal(e.logs.find(entry => entry.details?.recheck)?.details.recheck.requests, 1);
    assert.equal(e.c.sessionScope.requestCount(), 0);
    assert.equal(e.timers.size, 0);
});

test('profile and route changes cancel direct episode reads and discard profile-specific diagnostic summaries', async () => {
    for (const mode of ['profile', 'route']) {
        const e = await viewingEnvironment();
        useSparseNestedEpisodes(e, id => ['400', '401'].includes(id));
        const mockFetch = e.c.fetch;
        let release, signal;
        e.c.fetch = async (url, options) => {
            const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
            if (paths[0][0] === 'videos' && Array.isArray(paths[0][2]) && !paths[0][2].includes('seasonCount')) {
                signal = options.signal;
                return { ok: true, json: () => new Promise((resolve, reject) => {
                    release = () => resolve({ jsonGraph: e.fixtures().episodes });
                    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                }) };
            }
            return mockFetch(url, options);
        };
        e.c.initializeWatchGroups(e.state, 1);
        for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
        assert.equal(typeof release, 'function');
        assert.deepEqual(completedViewingIds(e), ['1']);
        const promise = e.c.viewing.settled(e.state.watchStatus);
        if (mode === 'profile') { e.models.userInfo.userGuid = 'different-profile'; release(); }
        else {
            e.c.sourceState = { watchStatus: { newer: true } };
            e.c.isRouteSessionActive = token => token === 2;
            e.c.sessionScope.dispose();
        }
        await promise;
        if (mode === 'profile') {
            assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).seriesDetailsCount, 0);
            assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).typeCount, 0);
            assert.equal(completedViewingIds(e).length, 0);
        } else assert.equal(e.c.sourceState.watchStatus.newer, true);
        assert.equal(signal.aborted, true);
        assert.equal(e.c.sessionScope.requestCount(), 0);
        assert.equal(e.timers.size, 0);
    }
});

test('a completed latest episode outweighs reset older progress and the copy report identifies the inference', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 20);
    e.fixtures().episodes.videos[401] = viewingVideo('episode', false, 90);
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    const row = e.c.collectViewingSeriesDiagnostics(e.state)[0];
    assert.equal(row.reason, 'latest-episode-complete');
    assert.equal(row.unfinishedEpisodes, 0, 'older episode progress is no longer fetched');
    assert.equal(row.checkedEpisodes, 1);
    assert.deepEqual({ ...row.latestEpisode }, { season: 1, episode: 2, status: 'complete', percent: 90,
        thresholdPercent: 90, watched: false, creditsReached: false, reason: 'completion-threshold' });
    assert.equal(e.requests.length, 3);
});

test('latest episode diagnostics distinguish below 90 percent, earlier credits, flags and absent progress', async () => {
    for (const [record, expected, percent, reason] of [
        [viewingVideo('episode', false, 89.8), false, 89.8, 'below-completion-threshold'],
        [viewingVideo('episode', false, 85, { creditsOffset: atom(85) }), true, 85, 'credits-reached'],
        [viewingVideo('episode', true, -1), true, null, 'watched-flag'],
        [{ summary: atom({ type: 'episode' }), bookmarkPosition: atom(-1), runtime: atom(100) }, false, null, 'progress-unavailable']
    ]) {
        const e = await viewingEnvironment();
        e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 0);
        e.fixtures().episodes.videos[401] = record;
        await e.start();
        const latest = e.c.collectViewingSeriesDiagnostics(e.state)[0].latestEpisode;
        assert.equal(completedViewingIds(e).includes('4'), expected);
        assert.equal(latest.percent, percent);
        assert.equal(latest.reason, reason);
        if (percent === null && !expected) assert.equal(latest.fields.bookmark, 'atom:negative-number');
    }
});

test('an unknown finale receives a direct follow-up even when older episodes are unfinished', async () => {
    const e = await viewingEnvironment();
    e.fixtures().episodes.videos[400] = viewingVideo('episode', false, 20);
    useSparseNestedEpisodes(e, id => id === '401');
    await e.start();
    assert.ok(completedViewingIds(e).includes('4'));
    assert.deepEqual(e.requests.at(-1).paths[0][1], ['401']);
    assert.equal(e.c.collectViewingSeriesDiagnostics(e.state)[0].latestEpisode.reason, 'watched-flag');
});

test('the latest nonempty season is checked before older unfinished seasons', async () => {
    const e = await viewingEnvironment(1);
    e.fixtures().titles.videos[1] = viewingVideo('show', true, 0, { seasonCount: atom(3), episodeCount: atom(202) });
    e.fixtures().seasons = { videos: { 1: { seasonList: { 0: reference('seasons', '10'),
        1: reference('seasons', '11'), 2: reference('seasons', '12') } } },
        seasons: { 10: { summary: atom({ length: 200 }) }, 11: { summary: atom({ length: 2 }) }, 12: { summary: atom({ length: 0 }) } } };
    e.fixtures().episodes = { seasons: { 11: { episodes: { 0: reference('videos', '110'), 1: reference('videos', '111') } } },
        videos: { 110: viewingVideo('episode', false, 0), 111: viewingVideo('episode', false, 90) } };
    await e.start();
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.requests.length, 3);
    assert.deepEqual(e.requests[2].paths.map(path => path[1]), ['11']);
    const row = e.c.collectViewingSeriesDiagnostics(e.state)[0];
    assert.equal(row.latestEpisode.season, 2);
    assert.equal(row.checkedEpisodes, 1);
    assert.equal(row.expectedEpisodes, 202);
});

test('malformed season plans, invalid finale references and wrong video types cannot establish the latest hint', async () => {
    for (const mode of ['count', 'wrong-ref', 'wrong-type']) {
        const e = await viewingEnvironment();
        if (mode === 'count') e.fixtures().titles.videos[4].episodeCount = atom(3);
        if (mode === 'wrong-ref') e.fixtures().episodes.seasons[40].episodes[1] = reference('seasons', '400');
        if (mode === 'wrong-type') e.fixtures().episodes.videos[401] = viewingVideo('show', true);
        await e.start();
        assert.ok(!completedViewingIds(e).includes('4'), mode);
        assert.ok(mainViewingIds(e).includes('4'), mode);
    }
});

test('manual choices move cards immediately, update filters and counts, and perform no Netflix request', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const requests = e.requests.length;
    const itemOrder = e.state.items.map(item => item.videoId);
    const mainBefore = e.c.gridView.presentation().visibleCount;
    assert.deepEqual(clickManualViewing(e, '2'), ['prevent', 'stop', 'immediate']);
    assert.deepEqual(completedViewingIds(e), ['1', '2', '4']);
    assert.equal(e.c.gridView.presentation().completedCount, 3);
    assert.equal(e.c.gridView.presentation().visibleCount, mainBefore - 1);
    assert.deepEqual(filteredViewingIds(e, 'watched'), ['1', '2']);
    assert.equal(e.c.gridView.presentation().filters.main, 'movie');
    assert.equal(e.requests.length, requests);
    assert.deepEqual(e.state.items.map(item => item.videoId), itemOrder);
    assert.equal(e.state.totalCount, 7);
    assert.equal(e.storageCalls.writes, 1);
    assert.equal(viewingControls(e.state.cloneMap.get('v:2')).toggle.textContent, 'Move back to My List');
});

test('manual choices survive reloads and refresh and the move button restores automatic classification when it agrees', async () => {
    const first = await viewingEnvironment();
    await first.start();
    clickManualViewing(first, '2');
    const next = await viewingEnvironment(7, null, first.storage);
    await next.start();
    assert.ok(completedViewingIds(next).includes('2'));
    await next.c.refreshViewingStatus(next.state);
    assert.ok(completedViewingIds(next).includes('2'));
    viewingUi(next).details.open = true;
    clickManualViewing(next, '2');
    assert.ok(mainViewingIds(next).includes('2'));
    assert.equal(Boolean(next.c.viewing.choice(next.state.watchStatus, '2')), false, 'returning to the automatic main group clears the correction');
    assert.equal(viewingControls(next.state.cloneMap.get('v:2')).marker.hidden, true);
    next.fixtures().titles.videos[2] = viewingVideo('movie', true);
    await next.c.refreshViewingStatus(next.state);
    assert.ok(completedViewingIds(next).includes('2'), 'automatic classification resumes after clearing the override');
    clickManualViewing(next, '2');
    assert.equal(next.c.viewing.choice(next.state.watchStatus, '2').status, 'main');
    assert.equal(viewingControls(next.state.cloneMap.get('v:2')).marker.hidden, false);
    await next.c.refreshViewingStatus(next.state);
    assert.ok(mainViewingIds(next).includes('2'), 'an explicit main-list choice outweighs automatic completion');
    clickManualViewing(next, '2');
    assert.ok(completedViewingIds(next).includes('2'));
    assert.equal(Boolean(next.c.viewing.choice(next.state.watchStatus, '2')), false);
    assert.equal(viewingControls(next.state.cloneMap.get('v:2')).marker.hidden, true);
});



test('moving back with unknown automatic progress retains the explicit main choice when a later scan reports complete', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'all');
    assert.equal(e.c.viewing.freshStatus(e.state.watchStatus, '7'), 'unknown');
    const requests = e.requests.length;
    clickManualViewing(e, '7');
    viewingUi(e).details.open = true;
    clickViewingFilter(e, 'watched', 'all');
    clickManualViewing(e, '7');
    assert.equal(e.c.viewing.choice(e.state.watchStatus, '7').status, 'main');
    assert.equal(viewingControls(e.state.cloneMap.get('v:7')).marker.hidden, false);
    assert.equal(e.requests.length, requests);
    e.fixtures().titles.videos[7] = viewingVideo('movie', true);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('7'));
    const action = e.c.lastAction;
    assert.equal(action.targetGroup, 'main');
    assert.equal(action.automaticStatus, 'unknown');
    assert.equal(action.placement, 'manual');
    assert.equal(action.restoredAutomatic, false);
    assert.equal(action.manualMarkerVisible, true);
});

test('the move button can restore an agreed cached classification without a live result or a new request', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const e = await viewingEnvironment(7, null, first.storage);
    const gate = holdViewingResponse(e, () => true);
    e.c.initializeWatchGroups(e.state, 1);
    await e.flush();
    viewingUi(e).details.open = true;
    const requests = e.requests.length;
    clickManualViewing(e, '1');
    assert.equal(e.c.viewing.choice(e.state.watchStatus, '1').status, 'main');
    clickManualViewing(e, '1');
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '1')), false);
    assert.ok(completedViewingIds(e).includes('1'));
    assert.equal(viewingControls(e.state.cloneMap.get('v:1')).marker.hidden, true);
    const action = e.c.lastAction;
    assert.equal(action.targetGroup, 'watched');
    assert.equal(action.placement, 'automatic');
    assert.equal(action.restoredAutomatic, true);
    assert.equal(action.manualMarkerVisible, false);
    assert.equal(e.requests.length, requests);
    gate.release(); await e.c.viewing.settled(e.state.watchStatus);
});

test('failed automatic restoration keeps the saved placement and marker and the diagnostic reports that actual state', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    viewingUi(e).details.open = true;
    e.c.GM_setValue = () => { throw new Error('storage denied'); };
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(e.c.viewing.choice(e.state.watchStatus, '2').status, 'complete');
    const controls = viewingControls(e.state.cloneMap.get('v:2'));
    assert.equal(controls.marker.hidden, false);
    assert.equal(controls.toggle.disabled, true);
    const action = e.c.lastAction;
    assert.equal(action.saved, false);
    assert.equal(action.restoredAutomatic, false);
    assert.equal(action.manualMarkerVisible, true);
    assert.doesNotMatch(JSON.stringify(action), /active-profile|test-auth-token|videoId|storage denied/);
    const next = await viewingEnvironment(7, null, e.storage);
    await next.start();
    assert.ok(completedViewingIds(next).includes('2'));
    assert.equal(viewingControls(next.state.cloneMap.get('v:2')).marker.hidden, false);
});

test('manual corrections remain available when optional viewing requests fail', async () => {
    const e = await viewingEnvironment();
    e.c.fetch = async () => ({ ok: false, status: 503 });
    await e.start();
    clickViewingFilter(e, 'main', 'all');
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
});

test('a manual series correction expires for an added episode and the change is persisted', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    assert.ok(completedViewingIds(e).includes('5'));
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('5'));
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    e.fixtures().seasons.seasons[50].summary = atom({ length: 3 });
    e.fixtures().episodes.seasons[50].episodes[2] = reference('videos', '502');
    e.fixtures().episodes.videos[502] = viewingVideo('episode', false, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '5')), false);
    assert.equal(Object.hasOwn(e.storage.get('test.viewingChoices.active-profile').choices, '5'), false);
});

test('manual series corrections detect a new season without relying on a larger total count', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].seasonCount = atom(2);
    e.fixtures().seasons.videos[5].seasonList[1] = reference('seasons', '51');
    e.fixtures().seasons.seasons[50].summary = atom({ length: 1 });
    e.fixtures().seasons.seasons[51] = { summary: atom({ length: 1 }) };
    e.fixtures().episodes.seasons[51] = { episodes: { 0: reference('videos', '510') } };
    e.fixtures().episodes.videos[510] = viewingVideo('episode', false, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '5')), false);
});

test('unavailable or conflicting season metadata preserves a manual correction until reliable new coverage arrives', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('5'));
    assert.deepEqual(structuredClone(e.c.viewing.choice(e.state.watchStatus, '5').coverage), [['50', 2]]);
    assert.equal(e.storageCalls.writes, 1);
});

test('a correction made before season metadata arrives captures its first reliable baseline once', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const json = response.json;
        if (e.requests.length === 2) response.json = () => new Promise(resolve => { release = async () => resolve(await json()); });
        return response;
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    assert.equal(e.c.viewing.choice(e.state.watchStatus, '5').coverage, null);
    await release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.deepEqual(structuredClone(e.c.viewing.choice(e.state.watchStatus, '5').coverage), [['50', 2]]);
    assert.equal(e.storageCalls.writes, 2);
    for (let i = 0; i < 10; i++) e.c.syncWatchGroups(e.state);
    assert.equal(e.storageCalls.writes, 2, 'stable synchronization performs no repeated writes');
});

test('profile switching isolates manual choices and stale controls cannot write to the new profile', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    e.models.userInfo.userGuid = 'second-profile';
    clickManualViewing(e, '3');
    assert.equal(e.storageCalls.writes, 1, 'the click on the previous profile is rejected');
    assert.equal(e.c.viewing.choiceIds(e.state.watchStatus).length, 0);
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('2'));
    clickManualViewing(e, '3');
    assert.ok(completedViewingIds(e).includes('3'));
    e.models.userInfo.userGuid = 'active-profile';
    await e.c.refreshViewingStatus(e.state);
    assert.ok(completedViewingIds(e).includes('2'));
    assert.ok(mainViewingIds(e).includes('3'));
    assert.deepEqual(Object.keys(e.storage.get('test.viewingChoices.second-profile').choices), ['3']);
});

test('storage read/write failures surface without pretending a correction was remembered', async () => {
    for (const mode of ['read', 'write']) {
        const e = await viewingEnvironment();
        if (mode === 'read') e.c.GM_getValue = () => { throw new Error('denied'); };
        await e.start();
        if (mode === 'write') e.c.GM_setValue = () => { throw new Error('denied'); };
        clickManualViewing(e, '2');
        assert.ok(mainViewingIds(e).includes('2'));
        assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '2')), false);
        assert.equal([...e.storage.keys()].filter(key => key.startsWith('test.viewingChoices.')).length, 0);
        assert.match(viewingUi(e).note.textContent, /Could not save viewing choices/);
        assert.equal(viewingControls(e.state.cloneMap.get('v:2')).toggle.disabled, true);
    }
});

test('malformed persisted choices are ignored and missing profile identity never writes a correction', async () => {
    const storage = new Map([['test.viewingChoices.active-profile', { version: 1, choices: {
        2: { status: 'complete', type: 'movie', coverage: null },
        3: { status: 'complete', type: 'movie', coverage: 'bad' },
        5: { status: 'complete', type: 'series', coverage: [['50', -1]] },
        garbage: { status: 'complete', type: 'movie', coverage: null }
    } }]]);
    const e = await viewingEnvironment(7, null, storage);
    await e.start();
    assert.deepEqual([...e.c.viewing.choiceIds(e.state.watchStatus)], ['2']);
    const writes = e.storageCalls.writes;
    delete e.models.userInfo.userGuid;
    e.c.syncWatchGroups(e.state);
    clickManualViewing(e, '3');
    assert.equal(e.storageCalls.writes, writes);
    assert.equal(e.c.viewing.choiceIds(e.state.watchStatus).length, 0);
});

test('saving from an older tab preserves unrelated corrections already saved by another tab', async () => {
    const first = await viewingEnvironment();
    const second = await viewingEnvironment(7, null, first.storage);
    await first.start();
    await second.start();
    clickManualViewing(first, '2');
    clickManualViewing(second, '3');
    assert.deepEqual(Object.keys(first.storage.get('test.viewingChoices.active-profile').choices), ['2', '3']);
    assert.ok(completedViewingIds(second).includes('2'));
    clickViewingFilter(first, 'main', 'series');
    clickManualViewing(first, '5');
    assert.deepEqual(Object.keys(first.storage.get('test.viewingChoices.active-profile').choices), ['2', '3', '5']);
});

test('stable manual card synchronization performs no storage calls, allocations or attribute writes', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    const before = { ...e.storageCalls, created: e.created.length, requests: e.requests.length };
    for (const clone of e.state.cloneMap.values()) {
        for (const button of [viewingControls(clone).toggle, viewingControls(clone).marker]) {
            button.setAttribute = () => { throw new Error('unchanged button attribute write'); };
        }
    }
    for (let index = 0; index < 10; index++) e.c.syncWatchGroups(e.state);
    assert.deepEqual({ ...e.storageCalls, created: e.created.length, requests: e.requests.length }, before);
});

test('new episodes are revealed in the current grid even if saving manual expiry fails', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    e.fixtures().titles.videos[5].episodeCount = atom(3);
    e.fixtures().seasons.seasons[50].summary = atom({ length: 3 });
    e.fixtures().episodes.seasons[50].episodes[2] = reference('videos', '502');
    e.fixtures().episodes.videos[502] = viewingVideo('episode', false, 0);
    let attempts = 0;
    e.c.GM_setValue = key => {
        if (key.startsWith('test.viewingChoices.')) attempts++;
        throw new Error('storage failure');
    };
    await e.c.refreshViewingStatus(e.state);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '5')), false);
    assert.equal(attempts, 1);
    assert.equal(e.c.viewing.presentation(e.state.watchStatus).manualFailure, true);
    for (let index = 0; index < 5; index++) e.c.syncWatchGroups(e.state);
    assert.equal(attempts, 1, 'failed persistence does not create a repeated write loop');
});

test('native hover clone replacement publishes correctly labeled manual controls before another group sync', async () => {
    const e = await viewingEnvironment();
    await e.start();
    const item = e.state.items.find(item => item.videoId === '2');
    const old = e.state.cloneMap.get('v:2');
    const fresh = e.c.gridView.replaceCard(e.c.gridView.getCard(item), {node:old.cloneNode(true)}).node;
    assert.equal(viewingControls(fresh).toggle.textContent, 'Mark watched');
    clickManualViewing(e, '2');
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(viewingControls(fresh).toggle.textContent, 'Move back to My List');
});

test('late automatic baseline capture preserves an override cleared by the move button in another tab', async () => {
    const e = await viewingEnvironment();
    const mockFetch = e.c.fetch;
    let release;
    e.c.fetch = async (url, options) => {
        const response = await mockFetch(url, options);
        const json = response.json;
        if (e.requests.length === 2) response.json = () => new Promise(resolve => { release = async () => resolve(await json()); });
        return response;
    };
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !release; attempt++) await e.flush();
    clickViewingFilter(e, 'main', 'series');
    clickManualViewing(e, '5');
    const next = await viewingEnvironment(7, null, e.storage);
    await next.start();
    viewingUi(next).details.open = true;
    clickViewingFilter(next, 'watched', 'series');
    clickManualViewing(next, '5');
    await release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '5')), false);
    assert.ok(mainViewingIds(e).includes('5'));
    assert.equal(Object.hasOwn(e.storage.get('test.viewingChoices.active-profile').choices, '5'), false);
});

test('marking titles into the collapsed watched section preserves the viewport while handing off focus', async () => {
    const e = await viewingEnvironment();
    await e.start();
    let viewport = { x: 40, y: 2400 };
    let focused = 0;
    viewingUi(e).summary.focus = options => {
        focused++;
        if (!options?.preventScroll) viewport = { x: 0, y: 7600 };
    };
    const before = { ...viewport };
    const requests = e.requests.length;
    for (const id of ['2', '3']) {
        clickManualViewing(e, id);
        assert.ok(completedViewingIds(e).includes(id));
        assert.deepEqual(viewport, before, 'a completed card must not pull the viewport down to the watched heading');
        assert.equal(viewingUi(e).details.open, false);
    }
    assert.equal(focused, 2, 'keyboard focus still leaves controls that became hidden');
    assert.equal(e.storageCalls.writes, 2);
    assert.equal(e.requests.length, requests);
});

test('reversing and resetting a correction preserve the viewport when the destination filter hides the card', async () => {
    const e = await viewingEnvironment();
    await e.start();
    clickManualViewing(e, '2');
    viewingUi(e).details.open = true;
    clickViewingFilter(e, 'main', 'series');
    let viewport = { x: 0, y: 6500 };
    viewingUi(e).summary.focus = options => {
        if (!options?.preventScroll) viewport = { x: 0, y: 7900 };
    };
    clickManualViewing(e, '2');
    assert.deepEqual(viewport, { x: 0, y: 6500 });
    assert.ok(mainViewingIds(e).includes('2'));
    assert.equal(e.state.cloneMap.get('v:2').getAttribute('data-tm-type-hidden'), 'true');
    e.fixtures().titles.videos[2] = viewingVideo('movie', true);
    await e.c.refreshViewingStatus(e.state);
    clickViewingFilter(e, 'watched', 'movie');
    clickManualViewing(e, '2');
    clickViewingFilter(e, 'main', 'movie');
    clickViewingFilter(e, 'watched', 'series');
    viewport = { x: 0, y: 2200 };
    clickManualViewing(e, '2');
    assert.deepEqual(viewport, { x: 0, y: 2200 });
    assert.ok(completedViewingIds(e).includes('2'));
    assert.equal(Boolean(e.c.viewing.choice(e.state.watchStatus, '2')), false);
});

test('confirmed movies publish after the first title batch while later title responses are pending', async () => {
    const e = await viewingEnvironment(120);
    e.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        e.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    const gate = holdViewingResponse(e, paths => paths[0][1][0] === '51');
    e.c.initializeWatchGroups(e.state, 1);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await e.flush();
    assert.equal(typeof gate.release, 'function');
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).loading, true);
    assert.equal(completedViewingIds(e).length, 50);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).publications, 1);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).requests, 2, 'the pending independent peer has already reserved its request');
    assert.equal(mainViewingIds(e).length, 70);
    assert.equal(e.storageCalls.cacheWrites, 0, 'batch publication does not write storage');
    await gate.release();
    await e.c.viewing.settled(e.state.watchStatus);
    assert.equal(completedViewingIds(e).length, 120);
    assert.equal(e.requests.length, 3);
    assert.equal(e.storageCalls.cacheWrites, 1);
});

test('500 long series use 500 finale records and 30 bounded requests instead of downloading older progress', async () => {
    const e = await viewingEnvironment(500);
    useCompleteSeriesResponses(e, Object.fromEntries(Array.from({ length: 500 }, (_, index) => [index + 1, 500])));
    await e.start();
    assert.equal(completedViewingIds(e).length, 500);
    assert.equal(e.requests.length, 30);
    const episodePaths = e.requests.filter(request => request.paths[0][0] === 'seasons').flatMap(request => request.paths);
    assert.equal(episodePaths.length, 500);
    assert.ok(episodePaths.every(path => path[3].from === 499 && path[3].to === 499));
    // Each title now requests its independent list length alongside season metadata, in the same HTTP batch.
    assert.ok(e.requests.filter(request => request.paths[0][2] === 'seasonList').every(request =>
        request.paths.length <= 100 && new Set(request.paths.map(path => path[1])).size <= 50));
    const details = e.logs.find(entry => entry.details?.series)?.details;
    assert.equal(details.series.episodesChecked, 500);
    assert.equal(details.series.pending, 0);
    assert.equal(details.failure, null);
    assert.equal(e.state.totalCount, 500);
    assert.equal(e.state.cloneMap.size, 500);
});

test('a recent same-profile cache groups titles before the first response and remains read-only during browsing', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const next = await viewingEnvironment(7, null, first.storage);
    const gate = holdViewingResponse(next);
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    assert.deepEqual(filteredViewingIds(next), ['2', '3']);
    assert.equal(viewingUi(next).details.open, false);
    assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).cachedTitles, 6);
    const row = next.c.collectViewingSeriesDiagnostics(next.state)[0];
    assert.equal(row.automaticStatus, 'complete');
    assert.equal(row.cachedStatus, true);
    for (let index = 0; index < 10; index++) next.c.syncWatchGroups(next.state);
    assert.equal(next.storageCalls.cacheReads, 1);
    assert.equal(next.storageCalls.cacheWrites, 0);
    await next.flush();
    await gate.release();
    await next.c.viewing.settled(next.state.watchStatus);
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).cachedCount, 0);
    assert.equal(next.c.collectViewingSeriesDiagnostics(next.state)[0].cachedStatus, false);
    assert.equal(next.storageCalls.cacheWrites, 1);
    assert.equal(next.requests.length, first.requests.length, 'startup reuse adds no requests and still revalidates');
    const calls = { ...next.storageCalls };
    for (let index = 0; index < 10; index++) next.c.syncWatchGroups(next.state);
    await next.advance(60000);
    assert.deepEqual(next.storageCalls, calls);
    assert.equal(next.requests.length, 3);
});

test('fresh movies replace cache immediately and a newly unfinished finale returns a cached series to My List', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const next = await viewingEnvironment(7, null, first.storage);
    next.setFixtures(viewingFixtures(true));
    next.fixtures().titles.videos[1] = viewingVideo('movie', false);
    const gate = holdViewingResponse(next, paths => paths[0][0] === 'seasons');
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '4']);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await next.flush();
    assert.equal(typeof gate.release, 'function');
    assert.deepEqual(completedViewingIds(next), ['4'], 'show-level progress does not prematurely remove a cached finale result');
    assert.equal(next.c.viewing.freshStatus(next.state.watchStatus, '1'), 'not-started');
    await gate.release();
    await next.c.viewing.settled(next.state.watchStatus);
    assert.deepEqual(completedViewingIds(next), []);
    assert.ok(mainViewingIds(next).includes('4'));
    assert.equal(next.c.collectViewingSeriesDiagnostics(next.state)[0].latestEpisode.episode, 3);
    assert.equal(next.storage.get('test.viewingCache.active-profile').entries[4][1], 'in-progress');
});

test('manual main-list choices outweigh initial cached completion and never enter the automatic cache', async () => {
    const first = await viewingEnvironment();
    await first.start();
    viewingUi(first).details.open = true;
    clickManualViewing(first, '1');
    const next = await viewingEnvironment(7, null, first.storage);
    const gate = holdViewingResponse(next);
    next.c.initializeWatchGroups(next.state, 1);
    assert.ok(mainViewingIds(next).includes('1'));
    assert.deepEqual(completedViewingIds(next), ['4']);
    await next.flush();
    await gate.release();
    await next.c.viewing.settled(next.state.watchStatus);
    assert.ok(mainViewingIds(next).includes('1'));
    assert.equal(next.storage.get('test.viewingCache.active-profile').entries[1][1], 'complete');
    assert.equal(next.storage.get('test.viewingChoices.active-profile').choices[1].status, 'main');
});

test('a failed verification reveals cached automatic titles but retains explicit manual watched choices', async () => {
    const first = await viewingEnvironment();
    await first.start();
    clickManualViewing(first, '2');
    const next = await viewingEnvironment(7, null, first.storage);
    next.c.fetch = async () => ({ ok: false, status: 503 });
    next.c.initializeWatchGroups(next.state, 1);
    assert.deepEqual(completedViewingIds(next), ['1', '2', '4']);
    await next.c.viewing.settled(next.state.watchStatus);
    assert.deepEqual(completedViewingIds(next), ['2']);
    assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).cachedCount, 0);
    assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
    assert.deepEqual(Object.keys(next.storage.get('test.viewingCache.active-profile').entries), []);
    assert.equal(next.storage.get('test.viewingChoices.active-profile').choices[2].status, 'complete');
});

test('startup cache validates age, schema, cutoff and membership without trusting malformed entries', async () => {
    const e = await viewingEnvironment();
    e.setCacheTime(100000000);
    const valid = { version: 1, completionRatio: 0.9, savedAt: 100000000,
        entries: { 1: ['movie', 'complete'], 4: ['series', 'complete'], 999: ['movie', 'complete'] } };
    const cache=createCache({activeProfile:()=>'active-profile',now:()=>e.c.Date.now(),storageKey:e.c.VIEWING_CACHE_STORAGE_KEY,getValue:(...args)=>e.c.GM_getValue(...args)});
    const key = 'test.viewingCache.active-profile';
    e.storage.set(key, valid);
    assert.deepEqual([...cache.read(e.state.items, 'active-profile').results.keys()], ['1', '4']);
    for (const invalid of [
        { ...valid, version: 2 }, { ...valid, completionRatio: 0.95 }, { ...valid, savedAt: 0 },
        { ...valid, savedAt: 100000001 }, { ...valid, savedAt: NaN }, { ...valid, entries: [] },
        { ...valid, entries: Object.fromEntries(Array.from({ length: 5001 }, (_, index) => [index, ['movie', 'complete']])) }
    ]) {
        e.storage.set(key, invalid);
        assert.equal(cache.read(e.state.items, 'active-profile').results.size, 0);
    }
    e.storage.set(key, { ...valid, entries: { 1: ['movie', 'complete'], 2: ['movie', true],
        3: ['movie', 'complete', 'extra'], 4: ['episode', 'complete'], 5: null } });
    assert.deepEqual([...cache.read(e.state.items, 'active-profile').results.keys()], ['1']);
});

test('optional cache storage errors preserve fresh grouping and working manual corrections', async () => {
    for (const mode of ['read', 'write']) {
        const e = await viewingEnvironment();
        const method = mode === 'read' ? 'GM_getValue' : 'GM_setValue';
        const original = e.c[method];
        e.c[method] = (key, value) => {
            if (key.startsWith('test.viewingCache.')) throw new Error('cache denied');
            return original(key, value);
        };
        await e.start();
        assert.deepEqual(completedViewingIds(e), ['1', '4']);
        assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).failure, null);
        assert.equal(e.c.viewing.presentation(e.state.watchStatus).manualFailure, false);
        clickManualViewing(e, '2');
        assert.ok(completedViewingIds(e).includes('2'));
        assert.equal(e.storage.get('test.viewingChoices.active-profile').choices[2].status, 'complete');
    }
});

test('cache reuse is isolated by the active profile and a cancelled response cannot publish or save it', async () => {
    const first = await viewingEnvironment();
    await first.start();
    const other = await viewingEnvironment(7, null, first.storage);
    other.models.userInfo.userGuid = 'other-profile';
    const otherGate = holdViewingResponse(other);
    other.c.initializeWatchGroups(other.state, 1);
    assert.deepEqual(completedViewingIds(other), []);
    assert.equal(other.c.viewing.diagnostics(other.state.watchStatus).cachedTitles, 0);
    await other.flush();
    await otherGate.release();
    await other.c.viewing.settled(other.state.watchStatus);
    assert.equal(other.storageCalls.cacheWrites, 1);
    assert.ok(other.storage.has('test.viewingCache.other-profile'));
    for (const mode of ['profile', 'route']) {
        const next = await viewingEnvironment(7, null, first.storage);
        const gate = holdViewingResponse(next);
        next.c.initializeWatchGroups(next.state, 1);
        assert.deepEqual(completedViewingIds(next), ['1', '4']);
        await next.flush();
        if (mode === 'profile') next.models.userInfo.userGuid = 'third-profile';
        else {
            next.c.sourceState = { grid: { isConnected: true }, watchStatus: { newer: true } };
            next.c.isRouteSessionActive = token => token === 2;
        }
        await gate.release();
        await next.c.viewing.settled(next.state.watchStatus);
        assert.equal(next.storageCalls.cacheWrites, 0);
        if (mode === 'profile') {
            assert.deepEqual(completedViewingIds(next), []);
            assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).cachedCount, 0);
            assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).failure, 'VIEWING_STATUS_PROFILE_CHANGED');
        } else assert.equal(next.c.sourceState.watchStatus.newer, true);
        assert.equal(next.c.sessionScope.requestCount(), 0);
        assert.equal(next.timers.size, 0);
    }
});

test('a later startup failure preserves fresh movie results and drops only unverified cached titles', async () => {
    const first = await viewingEnvironment(60);
    first.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        first.requests.push({ paths });
        return { ok: true, json: async () => ({ jsonGraph: {
            videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
        } }) };
    };
    await first.start();
    const next = await viewingEnvironment(60, null, first.storage);
    next.c.fetch = async (url, options) => {
        const paths = new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value));
        next.requests.push({ paths });
        return paths[0][1][0] === '51' ? { ok: false, status: 503 } : {
            ok: true, json: async () => ({ jsonGraph: {
                videos: Object.fromEntries(paths[0][1].map(id => [id, viewingVideo('movie', true)]))
            } })
        };
    };
    next.c.initializeWatchGroups(next.state, 1);
    assert.equal(completedViewingIds(next).length, 60);
    await next.c.viewing.settled(next.state.watchStatus);
    assert.equal(completedViewingIds(next).length, 50);
    assert.deepEqual(mainViewingIds(next), Array.from({ length: 10 }, (_, index) => String(index + 51)));
    assert.equal(Object.keys(next.storage.get('test.viewingCache.active-profile').entries).length, 50);
    assert.equal(next.storageCalls.cacheWrites, 1);
    assert.equal(next.c.viewing.diagnostics(next.state.watchStatus).failure, 'VIEWING_STATUS_HTTP_503');
});

test('refresh keeps the current series grouping until its new finale result arrives without rereading storage', async () => {
    const e = await viewingEnvironment();
    await e.start();
    e.setFixtures(viewingFixtures(true));
    const gate = holdViewingResponse(e, paths => paths[0][0] === 'seasons');
    const promise = e.c.refreshViewingStatus(e.state);
    for (let attempt = 0; attempt < 10 && !gate.release; attempt++) await e.flush();
    assert.equal(typeof gate.release, 'function');
    assert.deepEqual(completedViewingIds(e), ['1', '4']);
    assert.equal(e.storageCalls.cacheReads, 1);
    assert.equal(e.storageCalls.cacheWrites, 1);
    await gate.release();
    await promise;
    assert.deepEqual(completedViewingIds(e), ['1']);
    assert.equal(e.storageCalls.cacheWrites, 2);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).cachedCount, 0);
});

test('a warm 500-series scan initializes card controls once and performs no further work while browsing', async () => {
    const first = await viewingEnvironment(500);
    useCompleteSeriesResponses(first);
    await first.start();
    const e = await viewingEnvironment(500, null, first.storage);
    useCompleteSeriesResponses(e);
    let controls = 0, visibilityReads = 0;
    for (const clone of e.state.cloneMap.values()) {
        const getAttribute = clone.getAttribute.bind(clone);
        clone.getAttribute = key => {
            if (key === 'data-tm-type-hidden') visibilityReads++;
            return getAttribute(key);
        };
    }
    observeControlLabels(e, () => { controls++; });
    await e.start();
    assert.equal(controls, 500, 'the previous warm scan revisited controls 11,500 times');
    assert.equal(visibilityReads, 500, 'unchanged batches avoid card attribute reads after initial grouping');
    assert.equal(e.requests.length, 30);
    assert.equal(e.c.viewing.diagnostics(e.state.watchStatus).publications, 20);
    assert.equal(completedViewingIds(e).length, 500);
    const work = {viewingGroups:e.c.gridView.groupDiagnostics()};
    assert.equal(work.viewingGroups.fullSyncs, 1);
    assert.equal(work.viewingGroups.cardsConsidered, 1500);
    assert.equal(work.viewingGroups.controlsUpdated, controls);
    await e.advance(60000);
    assert.deepEqual(structuredClone({viewingGroups:e.c.gridView.groupDiagnostics()}), structuredClone(work));
    assert.equal(e.timers.size, 0);
});

test('incremental groups follow hover replacement ownership without retaining or revisiting the old card', async () => {
    const e = await unfinishedMovieGrid(10);
    const item = e.state.items[9];
    const old = e.state.cloneMap.get('v:10');
    const fresh = old.cloneNode(true);
    fresh.__tmMyListItem = item;
    e.c.gridView.replaceCard(e.c.gridView.getCard(item), { node: fresh });

    assert.equal(e.c.gridView.getCard(item).node, fresh);
    clickManualViewing(e, '10');
    assert.equal(fresh.parentElement, viewingUi(e).watchedGrid);
    assert.equal(old.isConnected, false);
    assert.equal(e.c.gridView.getCard(item).node, fresh);
});

test('copy-only series diagnostics explain the named cases without exporting video IDs, raw payloads or credentials', async () => {
    const e = await viewingEnvironment();
    const titles = ['Weeds', 'Ozark', 'Chilling Adventures of Sabrina', 'You'];
    titles.forEach((title, index) => { e.state.items[index + 3].ariaLabel = title; });
    e.fixtures().titles.videos[7] = viewingVideo('show', true, 0, { seasonCount: atom(0) });
    useSparseNestedEpisodes(e, id => ['400', '401'].includes(id), graph => {
        delete graph.videos[400]; delete graph.videos[401];
    });
    await e.start();
    const report = e.c.collectViewingSeriesDiagnostics(e.state);
    assert.deepEqual(report.map(row => row.title), titles);
    assert.equal(report[0].reason, 'unavailable-episode-progress');
    assert.equal(report[0].unknownEpisodes, 1);
    assert.equal(report[0].unknownFields.watched.missing, 1);
    assert.equal(report[1].reason, 'unfinished-episodes');
    assert.equal(report[1].unfinishedEpisodes, 1);
    for (const row of report) assert.ok(!Object.hasOwn(row, 'videoId'));
    let thumbnailReads = 0;
    let reportText = '';
    const diagnosticReport = createReport({ logger: createLogger({name:"test",version:"test",Element,console:{log(){},warn(){},error(){}}}), version: '1.2.2', document: e.c.document,
        navigator: { clipboard: { writeText: async value => { reportText = value; } } }, tLog: value => value,
        readEnvironment: () => ({ url: 'https://www.netflix.com/browse/my-list', userAgent: 'test', browserLanguage: 'en',
            htmlLanguage: 'en', netflixLanguage: 'en', displayLanguage: 'en', logLanguage: 'en', viewport: '1920x1080', devicePixelRatio: 1 }),
        readRuntime: () => ({}), readSeriesViewing: () => e.c.collectViewingSeriesDiagnostics(e.state),
        readThumbnails: () => { thumbnailReads++; return { available: true }; }, readNativePopup: () => ({status:"inactive-route"}) });
    await diagnosticReport.copy();
    const text = reportText;
    assert.match(text, /seriesViewing: .*Weeds/);
    assert.match(text, /thumbnailDiagnostics: \{"available":true\}/);
    assert.equal(thumbnailReads, 1);
    assert.ok(!text.includes('test-auth-token'));
    assert.ok(!text.includes('active-profile'));
    assert.ok(!text.includes('jsonGraph'));
});
