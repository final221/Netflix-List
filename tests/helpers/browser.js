import { EventTarget, Element, createDocument } from './dom.js';
import { createScheduler } from './scheduler.js';

export function createBrowser({ pathname = '/browse', grants = true, visualViewport = true, storage = true, language = 'en' } = {}) {
    const scheduler = createScheduler();
    const document = createDocument();
    document.documentElement.setAttribute('lang', language);
    const window = new EventTarget();
    Object.assign(window, { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 });
    if (visualViewport) window.visualViewport = new EventTarget();
    const location = { origin: 'https://www.netflix.com', pathname, href: 'https://www.netflix.com' + pathname };
    const logs = [], menus = new Map(), observers = [], requests = [], clipboard = [];
    class MutationObserver {
        constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    }
    const history = {};
    for (const method of ['pushState', 'replaceState']) {
        history[method] = (_state, _title, url) => {
            const next = new URL(url, location.href);
            Object.assign(location, { origin: next.origin, pathname: next.pathname, href: next.href });
        };
    }
    const context = {
        window, document, location, history, Element, HTMLElement: Element, MutationObserver, ResizeObserver: class extends MutationObserver {}, URL, AbortController,
        navigator: { userAgent: 'offline-bundle-test', language: 'en',
            clipboard: { writeText: async text => { clipboard.push(text); } } },
        localStorage: storage ? { getItem: () => null, setItem() {} } : { getItem() { throw new Error('denied'); } },
        console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        performance: scheduler.performance,
        setTimeout: scheduler.setTimeout, clearTimeout: scheduler.clearTimeout,
        requestAnimationFrame: scheduler.requestAnimationFrame, cancelAnimationFrame: scheduler.cancelAnimationFrame,
        queueMicrotask,
        getComputedStyle: () => ({ gap: '8px', rowGap: '8px', paddingLeft: '0', paddingRight: '0',
            fontSize: '16px', fontFamily: 'sans-serif', fontWeight: '400', lineHeight: '20px', color: 'white',
            getPropertyValue(name) { return this[name] || ''; } }),
        fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
    };
    if (grants) Object.assign(context, {
        GM_registerMenuCommand: (label, callback) => { const id = menus.size + 1; menus.set(id, { label, callback }); return id; },
        GM_unregisterMenuCommand: id => menus.delete(id)
    });
    // In raw mode the browser's page globals and window refer to the same environment.
    window.netflix = {};
    return { context, scheduler, document, window, history, location, logs, menus, observers, requests, clipboard,
        async navigate(url, method = 'pushState') { history[method](null, '', url); await scheduler.flush(); },
        mountMyList() {
            const host = document.body.appendChild(new Element('main'));
            host.setAttribute('data-uia', 'browse-page-sections');
            const section = host.appendChild(new Element('section'));
            section.setAttribute('data-uia', 'carousel-row-section-1');
            section.appendChild(new Element('h2'));
            return section;
        }
    };
}
