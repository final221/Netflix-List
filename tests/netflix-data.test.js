import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, createDocument } from './helpers/dom.js';
import { createNetflixContext } from '../src/netflix/context.js';
import { createNetflixPageDom } from '../src/netflix/page-dom.js';
import { createCardMarkup } from '../src/netflix/card-markup.js';

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
