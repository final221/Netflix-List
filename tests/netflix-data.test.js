import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, createDocument } from './helpers/dom.js';
import { createNetflixContext } from '../src/netflix/context.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createCardMarkup } from '../src/netflix/card-markup.js';
import { createListData } from '../src/netflix/list-data.js';
import { createPopupInspection } from '../src/netflix/popup-inspection.js';
import { createScheduler } from './helpers/scheduler.js';
import { carouselEdge, carouselPayload, pageBootstrapHtml } from './helpers/fixtures.js';

function environment() {
    const document = createDocument();
    const location = { origin: 'https://www.netflix.com', href: 'https://www.netflix.com/browse/my-list' };
    const models = { userInfo: { guid: 'owner', userGuid: 'active', authURL: 'token' },
        services: { memberapi: { protocol: 'https', hostname: 'www.netflix.com', path: ['/api/member'] } },
        serverDefs: { BUILD_IDENTIFIER: 'build' }, geo: { locale: { id: 'de-DE' } } };
    const window = { netflix: { appContext: { getModelData: name => models[name] } } };
    const context = createNetflixContext({ window, document, navigator: { language: 'ja-JP' }, location });
    let identity = null;
    const dom = createNetflixPageDom({ document, Element, location, readGraphqlIdentity: () => identity });
    const markup = createCardMarkup({ location });
    return { document, location, models, window, context, dom, markup, setIdentity: value => { identity = value; } };
}
function section(host, uia = '') {
    const node = host.appendChild(new Element('section'));
    if (uia) node.setAttribute('data-uia', uia);
    return node;
}
function slot(videoId = '123') {
    const node = new Element('div');
    node.setAttribute('data-virtual-slot', '0');
    const card = node.appendChild(new Element('a'));
    card.setAttribute('data-uia', 'standard-card');
    card.href = '/browse?jbv=' + videoId;
    card.setAttribute('href', card.href);
    card.setAttribute('aria-label', 'Title ' + videoId);
    const image = card.appendChild(new Element('img'));
    image.setAttribute('srcset', 'native-set');
    return node;
}

test('context reads current locale/profile facts lazily through existing wrapped and model fallbacks', () => {
    const e = environment();
    assert.equal(e.context.getHtmlLanguage(), 'en');
    e.document.documentElement.setAttribute('lang', 'de-DE');
    assert.equal(e.context.getNetflixLanguage(), 'de-DE');
    e.document.documentElement.removeAttribute('lang');
    assert.equal(e.context.getNetflixLanguage(), 'ja-JP');
    assert.equal(e.context.activeProfile(), 'active');
    e.models.userInfo.userGuid = 'other';
    assert.equal(e.context.activeProfile(), 'other');
    e.window.netflix.appContext.getModelData = () => { throw new Error('unavailable'); };
    e.window.wrappedJSObject = { netflix: { reactContext: { models: { userInfo: { data: { userGuid: 'wrapped' } },
        graphql: { data: { bootstrap: true } } } } } };
    assert.equal(e.context.activeProfile(), 'wrapped');
    assert.deepEqual(e.context.readGraphqlBootstrap(), { bootstrap: true });
    assert.deepEqual(e.context.listRequestContext(), { appVersion: undefined, locale: undefined });
});

test('context retains active-profile endpoint safety and build fallback', () => {
    const e = environment();
    const first = e.context.viewingRequestContext();
    assert.equal(first.profileGuid, 'active');
    assert.equal(first.authURL, 'token');
    assert.equal(new URL(first.url).pathname, '/api/member/pathEvaluator');
    assert.equal(first.endpointType, 'descriptor');
    for (const base of ['http://www.netflix.com/api/member', 'https://other.test/api/member',
        'https://user:password@www.netflix.com/api/member', '/api/member?bad=1', '/api/member#bad', '/']) {
        e.models.services.memberapi = base;
        assert.equal(e.context.viewingRequestContext(), null, base);
    }
    delete e.models.services.memberapi;
    assert.equal(e.context.viewingRequestContext().endpointType, 'build');
    delete e.models.userInfo.userGuid;
    assert.equal(e.context.activeProfile(), undefined);
    assert.equal(e.context.viewingRequestContext(), null);
});

test('page discovery uses structural anchors and skips synthetic sections independently of headings', () => {
    const e = environment();
    const host = e.document.body.appendChild(new Element('main'));
    host.setAttribute('data-uia', 'browse-page-sections');
    assert.equal(e.dom.findMyListSection(), null);
    assert.equal(e.dom.ensureSyntheticMyListSection(), null);
    const first = section(host, 'empty-carousel-section');
    const placeholder = e.dom.ensureSyntheticMyListSection();
    const native = section(host, 'empty-carousel-section');
    first.textContent = 'Unknown localized heading';
    assert.equal(e.dom.findMyListSection(), native);
    assert.equal(first.nextElementSibling, placeholder);
    native.setAttribute('data-uia', 'carousel-row-section-1');
    assert.equal(e.dom.findMyListSection(), native);
    native.remove();
    assert.equal(e.dom.findMyListSection(), null);
    assert.equal(e.dom.ensureSyntheticMyListSection(), placeholder);
});

test('GraphQL identity fallback matches current section IDs and card overlap without a structural anchor', () => {
    const e = environment();
    const host = e.document.body.appendChild(new Element('main'));
    host.setAttribute('data-uia', 'browse-page-sections');
    const other = section(host), selected = section(host);
    selected.id = 'my-list';
    selected.append(slot('1'), slot('2'));
    other.append(slot('99'));
    e.setIdentity({ sectionId: 'my-list', videoIds: [] });
    assert.equal(e.dom.findMyListSection(), selected);
    e.setIdentity({ sectionId: 'gone', videoIds: ['1', '2'] });
    assert.equal(e.dom.findMyListSection(), selected);
    selected.remove();
    assert.equal(e.dom.findMyListSection(), null);
});

test('membership decoding returns UI identity facts while the caller owns current-membership decisions', () => {
    const e = environment();
    const tracker = new Element('div');
    tracker.className = 'ptrack-content';
    tracker.setAttribute('data-ui-tracking-context', encodeURIComponent(JSON.stringify({ appView: 'addToMyListButton', video_id: 123 })));
    const button = tracker.appendChild(new Element('button'));
    button.setAttribute('data-uia', 'remove-from-my-list-with-undo');
    const decoded = e.dom.describeMembershipClick({ target: button });
    assert.equal(decoded.videoId, '123');
    assert.equal(decoded.uiaAction, 'remove');
    assert.ok(!Object.hasOwn(decoded, 'action'));
    tracker.setAttribute('data-ui-tracking-context', 'malformed%');
    assert.equal(e.dom.decodeTrackingContext(tracker), null);
    const nativeSlot = slot('456');
    nativeSlot.appendChild(button);
    assert.equal(e.dom.describeMembershipClick({ target: button }).videoId, '456');
    const modal = new Element('div');
    modal.setAttribute('role', 'dialog');
    modal.appendChild(button);
    assert.equal(e.dom.describeMembershipClick({ target: button }, { activeVideoId: '789' }).videoId, '789');
    assert.equal(e.dom.describeMembershipClick({ target: {} }), null);
});

test('markup capture and shared-template cloning preserve identity and clear inherited preparation state', () => {
    const e = environment();
    const source = slot('123');
    source.__reactFiber$test = { private: true };
    for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted', 'data-tm-preparing', 'data-tm-hover-token']) {
        source.setAttribute(name, 'old');
    }
    const captured = e.markup.capture(source, 2, true);
    assert.equal(captured.videoId, '123');
    assert.equal(captured.page, 2);
    assert.notEqual(captured.snapshot, source);
    assert.equal(e.markup.capture(source, 2, false).snapshot, null);
    const template = e.markup.captureTemplate(source);
    const record = { href: '/browse?jbv=456', ariaLabel: 'New title', imageUrl: 'https://image.test/456.jpg' };
    const clone = e.markup.createClone(template, record, true);
    assert.equal(clone.querySelector('a').href, record.href);
    assert.equal(clone.querySelector('a').getAttribute('aria-label'), record.ariaLabel);
    assert.equal(clone.querySelector('img').src, record.imageUrl);
    assert.equal(clone.querySelector('img').getAttribute('srcset'), null);
    for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted', 'data-tm-preparing', 'data-tm-hover-token']) {
        assert.equal(clone.getAttribute(name), null);
        assert.equal(source.getAttribute(name), 'old');
    }
    assert.equal(clone.__reactFiber$test, undefined);
    assert.equal(template.querySelector('a').href, '/browse?jbv=123');
    const nativeStyles = ['flex', 'width', 'min-width', 'max-width', 'transform', 'translate', 'opacity', 'visibility', 'pointer-events'];
    nativeStyles.forEach(name => clone.style.setProperty(name, 'native'));
    e.markup.normalize(clone);
    nativeStyles.forEach(name => assert.equal(clone.style.getPropertyValue(name), ''));
    assert.equal(clone.querySelector('a').tabIndex, 0);
    assert.equal(clone.querySelector('img').loading, 'lazy');
    assert.equal(clone.querySelector('img').decoding, 'async');
    assert.equal(e.markup.capture(new Element('div'), 0), null);
    assert.equal(e.markup.captureTemplate(new Element('div')), null);
});

function dataEnvironment(count = 4, overrides = {}) {
    const e = environment();
    const scheduler = createScheduler();
    const requests = [], responses = [], logs = [], warnings = [], controllers = new Set();
    let currentToken = 1;
    const graph = { MyList: { __typename: 'PinotCarouselSection', _id: 'row-id', id: 'list-section',
        entities: { totalCount: count, edges: [{ node: { __ref: 'standardBoxshot_Video:1' } }] },
        eventListeners: [{ notificationMessageRegex: 'UPDATE_PLAYLIST' }] } };
    e.window.netflix.reactContext = { models: { graphql: { data: graph } } };
    const assertCurrent = token => {
        if (token !== null && token !== undefined && token !== currentToken) {
            throw Object.assign(new Error('Cancelled'), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
        }
    };
    const inspection = createPopupInspection({ Element, now: () => scheduler.performance.now(),
        isCurrentSession: token => token === currentToken, readSessionToken: () => currentToken,
        isSourceMounted: () => false, readSourceCard: () => null });
    const adapter = createListData({ context: e.context, pageDom: e.dom, location: e.location,
        performance: scheduler.performance, now: () => 1000, assertCurrent,
        isCancelled: error => error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED',
        createError: (code, stage, message, details) => Object.assign(new Error(message), { code, stage, details }),
        log: (name, details) => logs.push({ name, details }), warn: (name, details) => warnings.push({ name, details }), tLog: value => value,
        beginRequest: token => {
            assertCurrent(token);
            const controller = new AbortController();
            controllers.add(controller);
            return { controller, timeoutId: scheduler.setTimeout(() => controller.abort(), 10000) };
        },
        finishRequest: request => {
            scheduler.clearTimeout(request.timeoutId);
            request.controller.abort();
            controllers.delete(request.controller);
        },
        runChunks: async (length, build, active) => {
            for (let index = 0; index < length; index++) { active(); build(index); }
            active(); return true;
        },
        inspection,
        fetch: async (url, options) => {
            const request = { url, options, body: options.body ? JSON.parse(options.body) : null };
            requests.push(request);
            const response = responses.shift();
            if (!response) throw new Error('Unexpected request');
            if (response.waitFetch) await response.waitFetch(options.signal);
            if (response.error) throw response.error;
            return { ok: !response.status || response.status === 200, status: response.status || 200,
                statusText: 'test', url, text: async () => {
                    if (response.waitBody) await response.waitBody(options.signal);
                    return response.raw ?? JSON.stringify(response.payload);
                } };
        }, ...overrides });
    const page = (...args) => ({ payload: carouselPayload(...args) });
    const collect = bootstrap => adapter.collectRecords({ bootstrap, totalCount: count, sessionToken: currentToken });
    return { ...e, scheduler, adapter, graph, requests, responses, logs, warnings, controllers, inspection,
        page, collect, setToken: value => { currentToken = value; }, assertCurrent };
}

test('list data hides wire responses and continuation while resuming the original row once', async () => {
    const e = dataEnvironment(150);
    e.responses.push(e.page(150, Array.from({ length: 75 }, (_, index) => index + 1), true, 'next'));
    const bootstrap = await e.adapter.fetchBootstrap(1);
    assert.deepEqual(bootstrap, { totalCount: 150, firstVideoId: '1', source: 'graphql', pageCount: 1, edgeCount: 75, hasMore: true });
    e.graph.MyList._id = 'recycled-row';
    e.responses.push(e.page(150, Array.from({ length: 75 }, (_, index) => index + 76)));
    const result = await e.collect(bootstrap);
    assert.equal(e.requests.length, 2);
    assert.equal(e.requests[1].body.variables.rowId, 'row-id');
    assert.equal(e.requests[1].body.variables.carouselAfterCursor, 'next');
    assert.equal(result.bootstrap.pageCount, 2);
    assert.equal(bootstrap.edgeCount, 75);
    assert.deepEqual(result.records.map(record => record.videoId), Array.from({ length: 150 }, (_, index) => String(index + 1)));
    assert.deepEqual(Object.keys(result.records[0]).sort(), ['ariaLabel', 'href', 'imageUrl', 'videoId']);
    assert.equal(e.controllers.size, 0);
    assert.equal(e.scheduler.timers.size, 0);
});

test('list data never publishes malformed or incomplete records as a complete collection', async () => {
    for (const edges of [[carouselEdge(1)], [carouselEdge(1), carouselEdge(1)], [{ node: {} }, carouselEdge(2)]]) {
        const e = dataEnvironment(2);
        const payload = carouselPayload(2, []);
        payload.data.node.entities.edges = edges;
        e.responses.push({ payload });
        const result = await e.collect(await e.adapter.fetchBootstrap(1));
        assert.equal(result.records, null);
        assert.equal(e.requests.length, 1);
    }
});

test('list data keeps native-page cache identity private and resets discovery without stale model reads', () => {
    const e = dataEnvironment();
    assert.equal(e.adapter.readMyListTotalCount(), 4);
    assert.equal(e.adapter.firstMyListVideoId(), '1');
    assert.deepEqual(e.adapter.myListDomIdentity(), { sectionId: 'list-section', videoIds: ['1'] });
    delete e.graph.MyList;
    assert.equal(e.adapter.readMyListTotalCount(), null);
    assert.equal(e.adapter.diagnostics().graphqlKey, null);
    e.adapter.reset();
    assert.ok(!Object.hasOwn(e.adapter, 'findMyListGraphqlEntry'));
});

test('list data uses HTML only for failed bootstrap and retains count after optional pagination failure', async () => {
    const e = dataEnvironment();
    e.responses.push({ status: 503 }, { raw: pageBootstrapHtml(4, '7') });
    const fallback = await e.adapter.fetchBootstrap(1);
    assert.equal(fallback.totalCount, 4);
    assert.equal(fallback.firstVideoId, '7');
    assert.equal(fallback.source, 'page');
    assert.deepEqual(e.requests.map(request => request.options.method), ['POST', 'GET']);
    assert.equal(new URL(e.requests[1].url).origin, e.location.origin);
    const f = dataEnvironment();
    f.responses.push(f.page(4, [1, 2], true, 'next'));
    const bootstrap = await f.adapter.fetchBootstrap(1);
    f.responses.push({ raw: 'invalid JSON' });
    const result = await f.collect(bootstrap);
    assert.equal(result.bootstrap, bootstrap);
    assert.equal(result.records, null);
    assert.equal(result.error.code, 'FRESH_MY_LIST_CAROUSEL_PARSE_ERROR');
    assert.ok(f.requests.every(request => request.options.method === 'POST'));
});

test('list data rejects stale bodies before surveying or initiating fallback requests', async () => {
    const e = dataEnvironment();
    e.responses.push({ ...e.page(4, [1, 2]), waitBody: async () => { e.setToken(2); } });
    await assert.rejects(e.adapter.fetchBootstrap(1), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    assert.equal(e.requests.length, 1);
    assert.equal(e.warnings.length, 0);
    assert.equal(e.inspection.diagnostics().responsePages, 0);
    assert.equal(e.controllers.size, 0);
    assert.equal(e.scheduler.timers.size, 0);
});

test('optional pagination HTTP, parse, count and cursor failures preserve the valid bootstrap', async () => {
    for (const failure of ['http', 'parse', 'count', 'cursor', 'repeated-cursor']) {
        const e = dataEnvironment();
        e.responses.push(e.page(4, [1, 2], true, failure === 'cursor' ? null : 'next'));
        const bootstrap = await e.adapter.fetchBootstrap(1);
        if (failure === 'http') e.responses.push({ status: 503 });
        if (failure === 'parse') e.responses.push({ raw: '{bad json' });
        if (failure === 'count') e.responses.push(e.page(5, [3, 4]));
        if (failure === 'repeated-cursor') e.responses.push(e.page(4, [3], true, 'next'));
        const result = await e.collect(bootstrap);
        assert.equal(result.bootstrap, bootstrap);
        assert.equal(result.bootstrap.totalCount, 4);
        assert.equal(result.bootstrap.firstVideoId, '1');
        assert.equal(result.bootstrap.edgeCount, 2);
        assert.equal(result.records, null);
        assert.ok(result.error?.code, failure);
        assert.ok(e.requests.every(request => request.options.method === 'POST'));
        assert.ok(e.requests.length <= 2);
        assert.equal(e.controllers.size, 0);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

const waitForAbort = signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
});
test('optional pagination timeout retains bootstrap while count timeout uses fresh HTML fallback', async () => {
    const e = dataEnvironment();
    e.responses.push(e.page(4, [1, 2], true, 'next'));
    const bootstrap = await e.adapter.fetchBootstrap(1);
    e.responses.push({ ...e.page(4, [3, 4]), waitFetch: waitForAbort });
    const completion = e.collect(bootstrap);
    await e.scheduler.flush();
    await e.scheduler.advance(10000);
    const result = await completion;
    assert.equal(result.bootstrap, bootstrap);
    assert.equal(result.records, null);
    assert.equal(result.error.code, 'FRESH_MY_LIST_CAROUSEL_TIMEOUT');
    assert.equal(e.requests.length, 2);
    assert.equal(e.controllers.size, 0);
    assert.equal(e.scheduler.timers.size, 0);
    const f = dataEnvironment();
    f.responses.push({ ...f.page(4, [1, 2]), waitFetch: waitForAbort }, { raw: pageBootstrapHtml(4) });
    const fallback = f.adapter.fetchBootstrap(1);
    await f.scheduler.advance(10000);
    const fresh = await fallback;
    assert.equal(fresh.totalCount, 4);
    assert.equal(fresh.firstVideoId, '1');
    assert.deepEqual(f.requests.map(request => request.options.method), ['POST', 'GET']);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.warnings[0].details.code, 'FRESH_MY_LIST_CAROUSEL_TIMEOUT');
    assert.equal(f.controllers.size, 0);
    assert.equal(f.scheduler.timers.size, 0);
});

test('invalid first-page counts and responses use HTML rather than a false empty list', async () => {
    for (const failure of [null, undefined, '', false, -1, 1.5, 'http', 'parse']) {
        const e = dataEnvironment();
        const first = failure === 'http' ? { status: 500 }
            : failure === 'parse' ? { raw: 'bad json' } : e.page(failure, [1]);
        e.responses.push(first, { raw: pageBootstrapHtml(4, '7') });
        const bootstrap = await e.adapter.fetchBootstrap(1);
        assert.equal(bootstrap.totalCount, 4);
        assert.equal(bootstrap.firstVideoId, '7');
        assert.deepEqual(e.requests.map(request => request.options.method), ['POST', 'GET']);
        assert.equal(e.controllers.size, 0);
        assert.equal(e.scheduler.timers.size, 0);
    }
});

test('zero and complete single-page data avoid further requests', async () => {
    for (const count of [0, 6]) {
        const e = dataEnvironment(count);
        e.responses.push(e.page(count, Array.from({ length: count }, (_, index) => index + 1)));
        const bootstrap = await e.adapter.fetchBootstrap(1);
        const result = await e.collect(bootstrap);
        assert.equal(bootstrap.totalCount, count);
        assert.equal(bootstrap.firstVideoId, count ? '1' : '');
        assert.equal(e.requests.length, 1);
        assert.equal(result.records.length, count);
        assert.equal(e.controllers.size, 0);
    }
});

test('the eight-page limit never publishes a partial data collection', async () => {
    const e = dataEnvironment(9);
    e.responses.push(e.page(9, [1], true, 'cursor-1'));
    for (let page = 2; page <= 8; page++) e.responses.push(e.page(9, [page], true, `cursor-${page}`));
    const bootstrap = await e.adapter.fetchBootstrap(1);
    const result = await e.collect(bootstrap);
    assert.equal(e.requests.length, 8);
    assert.equal(result.bootstrap, bootstrap);
    assert.equal(result.records, null);
    assert.equal(result.error.code, 'FRESH_MY_LIST_CAROUSEL_PAGE_LIMIT');
    assert.equal(e.controllers.size, 0);
    assert.equal(e.scheduler.timers.size, 0);
});

test('the actual CarouselPage response is surveyed without requests or changes to usable records', async () => {
    const e = dataEnvironment(2);
    e.responses.push(e.page(2, ['1', '2']));
    const bootstrap = await e.adapter.fetchBootstrap(1);
    const result = await e.collect(bootstrap);
    assert.equal(e.requests.length, 1);
    assert.deepEqual(result.records.map(record => record.ariaLabel), ['Title 1', 'Title 2']);
    const report = e.inspection.diagnostics();
    assert.equal(report.responsePages, 1);
    assert.equal(report.sampledCards, 2);
    assert.equal(report.titleScalar, 2);
    assert.equal(report.artworkScalar, 2);
    assert.equal(e.scheduler.timers.size, 0);
});

test('a retained continuation cannot be borrowed by another route session', async () => {
    const e = dataEnvironment();
    e.responses.push(e.page(4, [1, 2], true, 'next'));
    const bootstrap = await e.adapter.fetchBootstrap(1);
    e.setToken(2);
    await assert.rejects(e.collect(bootstrap), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    assert.equal(e.requests.length, 1);
    assert.equal(e.controllers.size, 0);
});

test('normalization keeps native order and metadata while skipping malformed and duplicate nodes', async () => {
    const e = dataEnvironment(2);
    const payload = carouselPayload(2, []);
    payload.data.node.entities.edges = [{ node: {} }, carouselEdge(1, { displayString: { text: 'Nested title' },
        contextualArtwork: { image: { url: 'https://images.test/nested.webp' } } }), carouselEdge(1),
        carouselEdge(2, { contextualArtwork: {} })];
    e.responses.push({ payload });
    const result = await e.collect(await e.adapter.fetchBootstrap(1));
    assert.deepEqual(result.records.map(record => [record.videoId, record.ariaLabel, record.imageUrl]),
        [['1', 'Nested title', 'https://images.test/nested.webp'], ['2', 'Title 2', '']]);
    assert.ok(result.records.every(record => !Object.hasOwn(record, 'page') && !Object.hasOwn(record, 'cardTemplate')));
});

test('page anchor fallbacks and direction/header facts use the current page without translated text', async () => {
    const e = dataEnvironment();
    e.graph.MyList.eventListeners = [];
    const host = e.document.body.appendChild(new Element('main'));
    host.setAttribute('data-uia', 'browse-page-sections');
    const row = section(host, 'carousel-row-section-1');
    row.id = 'list-section';
    row.textContent = 'Unrelated localized text';
    assert.equal(e.adapter.readMyListTotalCount(), 4);
    row.id = 'other-section';
    row.append(slot('1'), slot('2'));
    e.graph.MyList.entities.edges.push({ node: { __ref: 'standardBoxshot_Video:2' } });
    e.adapter.reset();
    assert.equal(e.adapter.readMyListTotalCount(), 4);
    e.document.documentElement.dir = 'rtl';
    e.responses.push(e.page(4, [1, 2, 3, 4]));
    await e.adapter.fetchBootstrap(1);
    const request = e.requests[0];
    assert.equal(request.body.variables.imageParamsForChannel.artworkType, 'CHANNEL_TILE_BACKGROUND_RTL');
    assert.equal(request.body.variables.carouselPageSize, 75);
    assert.equal(request.options.headers['x-netflix.context.app-version'], 'build');
    assert.equal(request.options.headers['x-netflix.context.locales'], 'de-de');
    assert.equal(request.options.headers['X-Netflix.Request.Originating.Url'], e.location.href);
});
