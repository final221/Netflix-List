import assert from 'node:assert/strict';
import { createApplication } from '../../src/app/application.js';
import { createBrowser } from './browser.js';
import { Element } from './dom.js';
import { mountPopulatedMyList } from './populated-browser.js';
import { carouselPayload, pageBootstrapHtml, viewingVideo } from './fixtures.js';

// Browser, native DOM, React inputs and wire responses only. No substitute owners.
export function sessionBrowser({ count = 6, columns = 6, viewing = false, logical = false } = {}) {
    const b = createBrowser({ pathname: '/browse/my-list' });
    let source = mountPopulatedMyList(b, { count });
    let ids = Array.from({ length: count }, (_, i) => String(i + 1)), page = 0, width = 600, pointerId = null;
    const events = [], moves = [], requests = [], storage = new Map();
    const models = { userInfo: { userGuid: 'profile-a', authURL: 'test-auth' },
        services: viewing ? { memberapi: '/api/shakti/test' } : {} };
    let videos = Object.fromEntries(ids.map(id => [id, viewingVideo('movie', false, 20)]));
    let postStatus = 200, reply = async () => ({ jsonGraph: { videos } });
    let getReply = () => ({ ok: true, status: 200, url: b.location.href,
        text: async () => pageBootstrapHtml(ids.length, ids[0]), json: async () => carouselPayload(ids.length, ids) });
    const rect = (left, w) => ({ left, top: 0, right: left + w, bottom: 60, width: w, height: 60 });
    const baseObserver = b.context.MutationObserver;
    b.context.MutationObserver = class extends baseObserver {
        observe(target, options) { this.target = target; this.options = options; super.observe(); }
    };
    class NativeEvent { constructor(type, facts) { this.type = type; Object.assign(this, facts); } }
    Object.assign(b.context, { Node: Element, URLSearchParams, PointerEvent: NativeEvent, MouseEvent: NativeEvent,
        GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
        GM_setValue: (key, value) => storage.set(key, value) });
    function browserNode(node) {
        const matches = node.matches.bind(node), clone = node.cloneNode.bind(node);
        node.matches = selector => selector === ':hover' ? node.getAttribute('data-tm-item-video-id') === pointerId : matches(selector);
        node.cloneNode = deep => browserNode(clone(deep));
        node.focus = () => { b.document.activeElement = node; };
        for (const child of node.children) browserNode(child);
        return node;
    }
    const create = b.document.createElement;
    b.document.createElement = tag => browserNode(create(tag));
    b.document.elementFromPoint = () => grid()?.querySelector(`[data-tm-item-video-id="${pointerId}"]`) || null;
    const grid = () => b.document.getElementById('tm-netflix-mylist-v15-grid');
    function updateModel() {
        const payload = carouselPayload(ids.length, ids).data.node;
        payload.eventListeners = [{ notificationMessageRegex: 'UPDATE_PLAYLIST' }];
        b.window.netflix = { reactContext: { models: { graphql: { data: { list: payload } } } },
            appContext: { getModelData: name => models[name] } };
    }
    function paint() {
        updateModel();
        const { section, scroller, track } = source;
        section.getBoundingClientRect = scroller.getBoundingClientRect = () => rect(0, width);
        track.replaceChildren();
        const base = Math.min(page * columns, Math.max(0, ids.length - columns));
        ids.slice(base, base + columns).forEach((id, i) => {
            const slot = track.appendChild(new Element()), card = slot.appendChild(new Element('a'));
            browserNode(slot);
            slot.setAttribute('data-virtual-slot', String(i));
            slot.__reactFiber$input = { stateNode: slot, memoizedProps: { itemIndex: base + i, totalCount: ids.length }, return: null };
            slot.getBoundingClientRect = card.getBoundingClientRect = () => rect(i * width / columns, width / columns);
            card.setAttribute('data-uia', 'standard-card'); card.href = `https://www.netflix.com/browse?jbv=${id}`;
            card.setAttribute('href', card.href); card.setAttribute('aria-label', `Title ${id}`);
            card.__reactProps$input = { onMouseEnter() {} };
            card.__reactFiber$input = { stateNode: card, memoizedProps: card.__reactProps$input, return: slot.__reactFiber$input };
            card.addEventListener('mouseover', event => events.push({ id, type: event.type }));
            card.addEventListener('mouseout', event => events.push({ id, type: event.type }));
        });
        section.querySelectorAll('[data-uia="carousel-page-indicator-item"]').forEach(node => node.remove());
        for (let i = 0; !logical && i < Math.max(1, Math.ceil(ids.length / columns)); i++) {
            const node = section.appendChild(new Element()); node.setAttribute('data-uia', 'carousel-page-indicator-item');
            if (i === page) node.setAttribute('data-indicator-selected', 'true');
        }
        if (logical) track.style.setProperty('transform', 'translate3d(0px, 0px, 0px)');
        const right = section.querySelector('[data-uia="carousel-right-button"]');
        right.click = () => { moves.push('right'); page = (page + 1) % Math.max(1, Math.ceil(ids.length / columns)); paint(); deliver(); };
        let left = section.querySelector('[data-uia="carousel-left-button"]');
        if (!left) { left = section.appendChild(new Element('button')); left.setAttribute('data-uia', 'carousel-left-button'); }
        left.click = () => { moves.push('left'); page = (page - 1 + Math.max(1, Math.ceil(ids.length / columns))) % Math.max(1, Math.ceil(ids.length / columns)); paint(); deliver(); };
    }
    function deliver(target = source.track) {
        for (const observer of [...b.observers]) if (observer.active && observer.options?.childList) {
            observer.callback([{ type: 'childList', target, addedNodes: [], removedNodes: [] }]);
        }
    }
    b.context.fetch = async (url, options) => {
        requests.push({ url, options });
        if (options?.method === 'POST') return { ok: postStatus === 200, status: postStatus, json: () => reply(url, options), text: async () => JSON.stringify(await reply(url, options)) };
        return getReply(url, options);
    };
    paint();
    const app = createApplication({ environment: b.context, version: 'test' });
    async function drain(until = () => !app.diagnostics().currentSession?.running, steps = 200, ms = 25) {
        for (let i = 0; i < steps; i++) { await b.scheduler.advance(ms); await b.scheduler.frame(); if (until()) return; }
        assert.fail('Workflow did not settle: ' + JSON.stringify(b.logs.map(row => [row[1], row[2]?.code, row[2]?.error?.message])));
    }
    const cardIds = () => grid()?.querySelectorAll('[data-tm-item-video-id]').map(node => node.getAttribute('data-tm-item-video-id')) || [];
    const click = id => {
        const tracker = b.document.body.appendChild(new Element()); tracker.className = 'ptrack-content';
        tracker.setAttribute('data-ui-tracking-context', encodeURIComponent(JSON.stringify({ appView: 'addToMyListButton', video_id: id })));
        const button = tracker.appendChild(new Element('button')); button.setAttribute('data-uia', 'remove-from-my-list-with-undo');
        b.document.dispatchEvent({ type: 'click', target: button }); tracker.remove();
    };
    const over = id => {
        pointerId = String(id); const node = grid().querySelector(`[data-tm-item-video-id="${id}"]`);
        grid().dispatchEvent({ type: 'pointerover', target: node, clientX: 20, clientY: 20, isTrusted: true }); return node;
    };
    return { ...b, app, models, events, moves, requests, storage, grid, cardIds, click, over, drain, deliver,
        get source() { return source; }, get ids() { return [...ids]; },
        async start() { app.start(); await drain(); assert.equal(app.diagnostics().currentSession.completed, true); },
        setIds(next, notify = true) { ids = next.map(String); paint(); if (notify) deliver(); },
        setPage(next) { page = next; paint(); deliver(); },
        resize(nextColumns, nextWidth = 600) { columns = nextColumns; width = nextWidth; paint(); b.window.innerWidth = nextWidth; b.window.dispatchEvent({ type: 'resize' }); },
        replaceSource() { const old = source, host = old.section.parentElement; old.section.remove(); source = mountPopulatedMyList(b, { count: ids.length }); const extraHost = source.section.parentElement; host.appendChild(source.section); extraHost.remove(); paint(); deliver(host); return old; },
        replaceTrack() { const old = source.track; old.remove(); source.track = source.scroller.appendChild(new Element()); paint(); deliver(source.scroller); return old; },
        setVideos(next) { videos = next; }, setReply(next) { reply = next; }, setGetReply(next) { getReply = next; }, setPostStatus(next) { postStatus = next; },
        leavePointer(node) { pointerId = null; grid()?.dispatchEvent({ type: 'pointerout', target: node, relatedTarget: b.document.body, clientX: 21, clientY: 20 }); },
        async snapshot() {
            const link = b.document.getElementById('tm-netflix-mylist-v20-log');
            link.dispatchEvent({ type: 'click', currentTarget: link, preventDefault() {} }); await b.scheduler.flush();
            return JSON.parse(b.clipboard.at(-1).split('\n').find(line => line.startsWith('snapshot: ')).slice(10));
        },
        dispose() { app.dispose(); assert.equal(b.scheduler.timers.size, 0); assert.equal(b.scheduler.frames.size, 0); }
    };
}
