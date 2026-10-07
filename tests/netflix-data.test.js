import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, createDocument } from './helpers/dom.js';
import { createNetflixContext } from '../src/netflix/context.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createCardMarkup } from '../src/netflix/card-markup.js';
import { createGrid } from '../src/grid/grid.js';
import { createListData } from '../src/netflix/list-data.js';
import { createViewingData } from '../src/netflix/viewing-data.js';
import { createPopupInspection } from '../src/netflix/popup-inspection.js';
import { createScheduler } from './helpers/scheduler.js';
import { createSessionScope } from '../src/app/session-scope.js';
import { carouselEdge, carouselPayload, pageBootstrapHtml, atom, reference, viewingVideo } from './helpers/fixtures.js';

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
    const grid = createGrid({ document, location, runChunks: async () => {} });
    return { document, location, models, window, context, dom, markup, grid, setIdentity: value => { identity = value; } };
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
    assert.equal(e.grid.ensureSynthetic(e.dom.readSyntheticPlacement()), null);
    const first = section(host, 'empty-carousel-section');
    const placeholder = e.grid.ensureSynthetic(e.dom.readSyntheticPlacement());
    const native = section(host, 'empty-carousel-section');
    first.textContent = 'Unknown localized heading';
    assert.equal(e.dom.findMyListSection(), native);
    assert.equal(first.nextElementSibling, placeholder);
    native.setAttribute('data-uia', 'carousel-row-section-1');
    assert.equal(e.dom.findMyListSection(), native);
    native.remove();
    assert.equal(e.dom.findMyListSection(), null);
    assert.equal(e.grid.ensureSynthetic(e.dom.readSyntheticPlacement()), placeholder);
});

test('heading interpretation returns copied typography facts without retaining or decorating native DOM', () => {
    const e = environment(), native = e.document.body.appendChild(new Element('section'));
    const heading = native.appendChild(new Element('h2'));
    const values = { 'font-family': 'Netflix Sans', 'font-size': '24px', 'font-weight': '700', color: 'white' };
    const dom = createNetflixPageDom({ document: e.document, Element, location: e.location,
        getComputedStyle: node => { assert.equal(node, heading); return { ...values, getPropertyValue: key => values[key] || '' }; } });
    const facts = dom.readHeadingTypography(native);
    assert.deepEqual(facts, { 'font-family': 'Netflix Sans', 'font-size': '24px', 'font-weight': '700', color: 'white' });
    assert.equal(Object.isFrozen(facts), true);
    values['font-size'] = '30px';
    assert.equal(facts['font-size'], '24px');
    assert.equal(heading.attributes.size, 0);
    heading.remove();
    assert.deepEqual(dom.readHeadingTypography(native), {});
});

test('native frame interpretation preserves Continue Watching placement and bounded row-gap median/fallback', () => {
    const e = environment(), host = e.document.body.appendChild(new Element('main'));
    host.setAttribute('data-uia', 'browse-page-sections');
    const first = section(host, 'unrelated-row');
    const previous = section(host, 'carousel-row-section-0');
    const current = section(host, 'carousel-row-section-1');
    const next = section(host, 'unrelated-next-row');
    for (const parent of [previous, next]) parent.appendChild(new Element()).setAttribute('data-uia', 'carousel-scroller');
    previous.getBoundingClientRect = () => ({ top: 0, bottom: 100 });
    current.getBoundingClientRect = () => ({ top: 120, bottom: 200 });
    next.getBoundingClientRect = () => ({ top: 230, bottom: 300 });
    const dom = createNetflixPageDom({ document: e.document, Element, location: e.location, getComputedStyle: node =>
        node === previous ? { marginBottom: '40px' } : node === next ? { marginTop: '50px' } : { marginBottom: '40px' } });
    const placement = dom.readSyntheticPlacement();
    assert.equal(placement.host, host);
    assert.equal(placement.after, previous);
    assert.equal(Object.isFrozen(placement), true);
    assert.equal(first.nextElementSibling, previous, 'reading must not position a script node');
    assert.equal(dom.readRowGap(current, 1280), 40);
    assert.equal(dom.readRowGap(null, 1280), 25.6);
    assert.equal(dom.readRowGap(null, 300), 20);
    assert.equal(dom.readRowGap(null, 10000), 56);
    assert.equal(dom.positionSyntheticSection, undefined);
    assert.equal(dom.ensureSyntheticMyListSection, undefined);
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

test('toast action decoding accepts one button in a Netflix toast without localized text or list decisions', () => {
    // The shared DOM fixture does not implement descendant selectors.
    class DescendantElement extends Element {
        matches(selector) {
            return selector.split(',').some(part => {
                const descendant=part.trim().match(/^(#[\w-]+)\s+(.+)$/);
                return descendant ? super.matches(descendant[2]) && Boolean(this.parentElement?.closest(descendant[1])) : super.matches(part);
            });
        }
    }
    const e=environment(),root=e.document.body.appendChild(new Element('div'));root.id='toastRoot';
    const toast=root.appendChild(new DescendantElement('div'));toast.setAttribute('aria-label','toast');
    const button=toast.appendChild(new Element('button')),child=button.appendChild(new Element('span'));
    button.textContent='Zurück';
    assert.equal(e.dom.describeToastActionClick({target:child}),true);
    const other=toast.appendChild(new Element('button'));
    assert.equal(e.dom.describeToastActionClick({target:button}),false);other.remove();
    toast.setAttribute('aria-label','other');assert.equal(e.dom.describeToastActionClick({target:button}),false);
    toast.setAttribute('role','alert');assert.equal(e.dom.describeToastActionClick({target:button}),true);
    root.id='unrelated';assert.equal(e.dom.describeToastActionClick({target:button}),false);
    assert.equal(e.dom.describeToastActionClick({target:{}}),false);
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

test('GraphQL template materialization preserves missing-artwork and missing-image behavior', () => {
    const e=environment();
    for(const missing of ['artwork','image']){
        const source=slot('123'),image=source.querySelector('img');
        image.src='native-image.jpg';image.setAttribute('srcset','native-srcset');
        if(missing==='image')image.remove();
        const template=e.markup.captureTemplate(source),record={videoId:'456',href:'/browse?jbv=456',ariaLabel:'Next',imageUrl:''};
        const clone=e.markup.createClone(template,record,true),result=clone.querySelector('img');
        if(missing==='image')assert.equal(result,null);
        else {assert.equal(result.src,'native-image.jpg');assert.equal(result.getAttribute('srcset'),'native-srcset');}
        assert.equal(clone.querySelector('a').href,record.href);
    }
});

function dataEnvironment(count = 4, overrides = {}) {
    const e = environment();
    const scheduler = createScheduler();
    const requests = [], responses = [], logs = [], warnings = [];
    const scope = createSessionScope({ isTargetPage: () => true, AbortController,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout });
    scope.begin();
    const graph = { MyList: { __typename: 'PinotCarouselSection', _id: 'row-id', id: 'list-section',
        entities: { totalCount: count, edges: [{ node: { __ref: 'standardBoxshot_Video:1' } }] },
        eventListeners: [{ notificationMessageRegex: 'UPDATE_PLAYLIST' }] } };
    e.window.netflix.reactContext = { models: { graphql: { data: graph } } };
    const assertCurrent = scope.assertCurrent;
    const inspection = createPopupInspection({ Element, now: () => scheduler.performance.now(),
        isCurrentSession: token => token === scope.token, readSessionToken: () => scope.token,
        isSourceMounted: () => false, readSourceCard: () => null });
    const adapter = createListData({ context: e.context, pageDom: e.dom, location: e.location,
        performance: scheduler.performance, now: () => 1000, assertCurrent,
        isCancelled: error => error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED',
        createError: (code, stage, message, details) => Object.assign(new Error(message), { code, stage, details }),
        log: (name, details) => logs.push({ name, details }), warn: (name, details) => warnings.push({ name, details }), tLog: value => value,
        beginRequest: scope.beginRequest, finishRequest: scope.finishRequest,
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
    const collect = bootstrap => adapter.collectRecords({ bootstrap, totalCount: count, sessionToken: scope.token });
    return { ...e, scheduler, adapter, graph, requests, responses, logs, warnings, scope, inspection,
        page, collect, setToken: value => { while (scope.token < value) scope.begin(); }, assertCurrent };
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
    assert.equal(e.scope.requestCount(), 0);
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
    assert.equal(e.scope.requestCount(), 0);
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
        assert.equal(e.scope.requestCount(), 0);
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
    assert.equal(e.scope.requestCount(), 0);
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
    assert.equal(f.scope.requestCount(), 0);
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
        assert.equal(e.scope.requestCount(), 0);
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
        assert.equal(e.scope.requestCount(), 0);
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
    assert.equal(e.scope.requestCount(), 0);
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
    assert.equal(e.scope.requestCount(), 0);
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

function viewingDataEnvironment() {
    const e = environment(), requests = [], responses = [];
    let current = true;
    const cancelled = () => Object.assign(new Error('Cancelled'), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    const controller = new AbortController();
    const owner = { signal: controller.signal, assertCurrent: () => { if (!current) throw cancelled(); } };
    const data = createViewingData({ context: e.context, createCancelledError: cancelled,
        fetch: async (url, options) => {
            const response = responses.shift();
            if (!response) throw new Error('Unexpected request');
            requests.push({ url, options, paths: new URLSearchParams(options.body).getAll('path').map(JSON.parse) });
            response.headers?.();
            return { ok: !response.status || response.status === 200, status: response.status || 200,
                json: async () => { response.body?.(); if (response.error) throw response.error;
                    return response.payload ?? { jsonGraph: response.graph }; } };
        } });
    return { ...e, data, requests, responses, owner, cancel: () => { current = false; } };
}

test('viewing access keeps credentials private and each typed operation dispatches one bounded request', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    assert.deepEqual(Object.keys(access).sort(), ['endpointPath', 'endpointType', 'profileGuid']);
    assert.equal(Object.isFrozen(access), true);
    e.responses.push({ graph: { videos: { 1: viewingVideo('show', false, 0,
        { seasonCount: atom(1), episodeCount: atom(2) }) } } });
    const titles = await e.data.readTitles(['1'], access, e.owner);
    e.responses.push({ graph: { videos: { 1: { seasonList: { 0: reference('seasons', 10) } } },
        seasons: { 10: { summary: atom({ length: 2 }) } } } });
    const plans = await e.data.readSeasons([...titles.values()], access, e.owner);
    assert.deepEqual(plans, [{ videoId: '1', expected: 2, seasons: [{ id: '10', count: 2 }] }]);
    assert.ok(!Object.hasOwn(plans[0].seasons[0], 'episodes'));
    e.responses.push({ graph: { seasons: { 10: { episodes: { 1: reference('videos', 101) } } },
        videos: { 101: viewingVideo('episode', false, 90) } } });
    const ranges = await e.data.readEpisodes([{ seasonId: '10', from: 1, to: 1 }], access, e.owner);
    assert.equal(ranges[0].episodes[0].id, '101');
    assert.equal(ranges[0].episodes[0].record.bookmark, 90);
    e.responses.push({ graph: { videos: { 101: viewingVideo('', true) } } });
    const repaired = await e.data.readDirectEpisodes(['101'], access, e.owner);
    assert.equal(repaired.get('101').record.type, 'episode');
    assert.equal(e.requests.length, 4);
    for (const request of e.requests) {
        assert.equal(request.options.credentials, 'same-origin');
        assert.equal(request.options.redirect, 'error');
        assert.equal(request.options.signal, e.owner.signal);
        assert.equal(new URLSearchParams(request.options.body).get('authURL'), 'token');
    }
    assert.ok(!JSON.stringify({ access, titles: [...titles.values()], plans, ranges,
        repaired: [...repaired.values()] }).includes('$type'));
    assert.ok(!JSON.stringify(access).includes('token'));
});

test('viewing normalization resolves atom and reference chains without leaking malformed progress', async () => {
    const e = viewingDataEnvironment();
    e.responses.push({ graph: { videos: {
        1: reference('videos', 10), 10: viewingVideo('movie', true),
        2: { $type: 'error', value: 'missing' },
        3: reference('videos', 4), 4: reference('videos', 3),
        5: viewingVideo('show', { $type: 'ref', value: ['private'] }, '100',
            { seasonCount: atom(null), episodeCount: atom('2'), runtime: atom(-1) }),
        6: { summary: reference('summaries', 1), watched: reference('flags', 1) }
    }, summaries: { 1: atom({ type: 'movie' }) }, flags: { 1: atom(false) } } });
    const records = await e.data.readTitles(['1', '2', '3', '5', '6', '7'], e.data.beginRead(), e.owner);
    assert.equal(records.get('1').watched, true);
    assert.equal(records.get('2'), null);
    assert.equal(records.get('3'), null);
    assert.equal(records.get('5').watched, undefined);
    assert.equal(records.get('5').bookmark, null);
    assert.equal(records.get('5').runtime, null);
    assert.equal(records.get('5').seasonCount, null);
    assert.equal(Number.isNaN(records.get('5').episodeCount), true);
    assert.equal(records.get('6').watched, false);
    assert.equal(records.get('7'), null);
    assert.ok(!JSON.stringify([...records.values()]).includes('$type'));
});

test('viewing coverage distinguishes absent counts from contradictory, incomplete and duplicate seasons', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    const graph = { videos: { 1: { seasonList: { length: atom(1), 0: reference('seasons', 10) } } },
        seasons: { 10: { summary: atom({ length: 2 }) } } };
    const base = { videoId: '1', seasonCount: null, episodeCount: null };
    const read = async (record = base, data = graph) => {
        e.responses.push({ graph: data });
        return e.data.readSeasons([record], access, e.owner);
    };
    assert.equal((await read())[0].expected, 2);
    graph.videos[1].seasonList[0] = ['seasons', '10'];
    assert.equal((await read())[0].expected, 2, 'array season references retain their namespace interpretation');
    graph.videos[1].seasonList[0] = reference('seasons', 10);
    for (const record of [{ ...base, episodeCount: 3 }, { ...base, seasonCount: NaN },
        { ...base, episodeCount: NaN }, { ...base, seasonCount: 2 }, { ...base, episodeCount: 501 }]) {
        assert.deepEqual(await read(record), []);
    }
    assert.deepEqual(await read(base, { ...graph, videos: { 1: { seasonList: { 0: reference('seasons', 10) } } } }), []);
    assert.deepEqual(await read({ ...base, seasonCount: 2 }, { ...graph,
        videos: { 1: { seasonList: { 0: reference('seasons', 10), 1: reference('seasons', 10) } } } }), []);
    assert.deepEqual(await read(base, { ...graph, videos: { 1: { seasonList: {
        length: atom(1), 0: reference('videos', 10) } } } }), []);
});

test('viewing batches reject stale owners at headers and body before returning normalized records', async () => {
    for (const phase of ['headers', 'body']) {
        for (const reason of ['route', 'profile']) {
            const e = viewingDataEnvironment(), access = e.data.beginRead();
            e.responses.push({ graph: { videos: { 1: viewingVideo('movie', true) } },
                [phase]: () => { if (reason === 'route') e.cancel(); else e.models.userInfo.userGuid = 'other'; } });
            await assert.rejects(e.data.readTitles(['1'], access, e.owner),
                { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
            assert.equal(e.requests.length, 1);
        }
    }
});

test('viewing request failures remain truthful and never start adapter retries', async () => {
    for (const response of [{ status: 429 }, { error: new SyntaxError('bad JSON') },
        { payload: { status: 'error', jsonGraph: {} } }, { payload: {} }]) {
        const e = viewingDataEnvironment();
        e.responses.push(response);
        await assert.rejects(e.data.readTitles(['1'], e.data.beginRead(), e.owner));
        assert.equal(e.requests.length, 1);
    }
});

test('missing season and episode totals require an explicit complete season-list length and valid per-season totals', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    const graph = { videos: { 4: { seasonList: { 0: reference('seasons', 40) } } },
        seasons: { 40: { summary: atom({ length: 2 }) } } };
    const missingCounts = { videoId: '4', seasonCount: null, episodeCount: null };
    const read = async (record = missingCounts) => {
        e.responses.push({ graph });
        return e.data.readSeasons([record], access, e.owner);
    };
    assert.deepEqual(await read(), [], 'a returned subset is not a complete season list');
    graph.videos[4].seasonList.length = atom(1);
    delete graph.seasons[40].summary;
    graph.seasons[40].length = atom(2);
    const [plan] = await read();
    assert.equal(plan.expected, 2);
    assert.equal(plan.seasons.length, 1);
    assert.equal(plan.seasons[0].count, 2);
    for (const [seasonCount, episodeCount] of [[NaN, null], [1, NaN], [0, null], [41, null], [1, 501], [1, 3]]) {
        assert.deepEqual(await read({ ...missingCounts, seasonCount, episodeCount }), []);
    }
    graph.videos[4].seasonList[1] = reference('seasons', '50');
    assert.deepEqual(await read(), [], 'extra returned seasons reject a contradictory length');
    delete graph.videos[4].seasonList[1];
    graph.seasons[40].length = atom('2');
    assert.deepEqual(await read(), []);
});

test('viewing access rejects forged and obsolete profile tickets before a request starts', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    await assert.rejects(e.data.readTitles(['1'], { ...access }, e.owner), { message: 'VIEWING_STATUS_CONTEXT' });
    e.models.userInfo.userGuid = 'other';
    await assert.rejects(e.data.readTitles(['1'], access, e.owner), { code: 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED' });
    assert.equal(e.requests.length, 0);
    e.models.services.memberapi = 'https://other.test/memberapi';
    assert.equal(e.data.beginRead(), null);
    assert.equal(e.requests.length, 0);
});

test('viewing batches enforce the existing title, season and episode bounds without splitting requests', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    const ids = size => Array.from({ length: size }, (_, index) => String(index + 1));
    await assert.rejects(e.data.readTitles(ids(51), access, e.owner), { message: 'VIEWING_STATUS_BATCH' });
    await assert.rejects(e.data.readDirectEpisodes(ids(201), access, e.owner), { message: 'VIEWING_STATUS_BATCH' });
    await assert.rejects(e.data.readEpisodes([{ seasonId: '10', from: 0, to: 200 }], access, e.owner),
        { message: 'VIEWING_STATUS_BATCH' });
    await assert.rejects(e.data.readEpisodes([{ seasonId: '10', from: 500, to: 500 }], access, e.owner),
        { message: 'VIEWING_STATUS_BATCH' });
    await assert.rejects(e.data.readSeasons(ids(6).map(videoId => ({ videoId, seasonCount: null, episodeCount: null })),
        access, e.owner), { message: 'VIEWING_STATUS_BATCH' });
    assert.equal(e.requests.length, 0);
    assert.equal(Object.isFrozen(e.data.limits), true);
});

test('episode normalization preserves reference identity and diagnostic shapes without transferring raw values', async () => {
    const e = viewingDataEnvironment(), access = e.data.beginRead();
    const graph = { seasons: { 10: { episodes: { 0: ['videos', '100'], 1: reference('seasons', 101),
        2: reference('videos', 102) } } }, videos: {
        100: viewingVideo('', { unsupported: true }, '95', { runtime: atom(-1) }),
        102: viewingVideo('movie', true)
    } };
    e.responses.push({ graph });
    const [{ episodes }] = await e.data.readEpisodes([{ seasonId: '10', from: 0, to: 2 }], access, e.owner);
    assert.equal(episodes[0].record.type, 'episode');
    assert.equal(episodes[0].record.watched, undefined);
    assert.equal(episodes[0].record.bookmark, null);
    assert.deepEqual(episodes[0].kinds, { watched: 'atom:object', bookmark: 'atom:string', runtime: 'atom:negative-number' });
    assert.equal(episodes[1].id, '');
    assert.equal(episodes[1].record, null);
    assert.deepEqual(episodes[1].kinds, { watched: 'missing', bookmark: 'missing', runtime: 'missing' });
    assert.equal(episodes[2].id, '102');
    assert.equal(episodes[2].record, null, 'a movie reference cannot qualify as episode progress');
    assert.ok(!JSON.stringify(episodes).includes('$type'));
});
