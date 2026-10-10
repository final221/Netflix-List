import { readVideoIdFromHref } from './page-dom.js';
import { createRecommendationRequests } from './recommendation-requests.js';


export const RECOMMENDATION_ARROW_STYLES = `
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia="carousel-hawkins-right-button"],[data-uia="carousel-right-button"],[data-uia="carousel-hawkins-left-button"],[data-uia="carousel-left-button"],.handleNext,.handlePrev){
    min-width:56px!important;min-height:64px!important;opacity:1!important;visibility:visible!important;
    z-index:10001!important;background:rgba(20,20,20,.85)!important;color:#fff!important;
    cursor:pointer;pointer-events:auto;
}
:is(section,.lolomoRow):has(.tm-rec-controls) :is(.handleNext,.handlePrev){width:56px!important}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia*="carousel"][data-uia$="button"],.handleNext,.handlePrev):focus-visible{outline:3px solid #fff!important;outline-offset:-3px}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia*="carousel"][data-uia$="button"],.handleNext,.handlePrev) :is(svg,.indicator-icon){width:32px!important;height:32px!important;font-size:32px!important;pointer-events:none}
`;

// Visible slot size/order remains Netflix-owned. No private mutation or playback API.
export function createRecommendationDom(environment) {
    const { document, location, getComputedStyle, performance, PerformanceObserver } = environment;
    const selector = 'a[data-uia="standard-card"][href], .title-card';
    const scrollerLeases = new WeakMap();
    function styleLease(node, name, value, priority = '') {
        const previous = node.style.getPropertyValue(name), previousPriority = node.style.getPropertyPriority(name);
        node.style.setProperty(name, value, priority);
        return () => {
            if (node.style.getPropertyValue(name) !== value || node.style.getPropertyPriority(name) !== priority) return;
            if (previous) node.style.setProperty(name, previous, previousPriority); else node.style.removeProperty(name);
        };
    }
    function reserveActions(scroller) {
        let resource = scrollerLeases.get(scroller);
        if (!resource) {
            const padding = Number.parseFloat(getComputedStyle?.(scroller).paddingBottom) || 0;
            resource = { users: 0, restore: styleLease(scroller, 'padding-bottom', `${padding + 72}px`, 'important') };
            scrollerLeases.set(scroller, resource);
        }
        resource.users++; let released = false;
        return () => {
            if (released) return; released = true;
            if (--resource.users === 0) { resource.restore(); scrollerLeases.delete(scroller); }
        };
    }
    function describe(card) {
        if (!card?.isConnected) return null;
        const host = card.closest('[data-virtual-slot], .slider-item') || card.parentElement;
        const row = card.closest('section, .lolomoRow');
        if (!host || !row || row.querySelector('[data-uia="progress-card"], .continueWatching') ||
            row.classList.contains('continueWatching')) return null;
        const anchor = card.matches('a[href]') ? card : card.querySelector('a[href]');
        const href = anchor?.getAttribute('href') || anchor?.href || '';
        let id = readVideoIdFromHref(href, location.href);
        if (!id) try { id = new URL(href, location.href).pathname.match(/^\/watch\/(\d+)(?:\/|$)/)?.[1] || ''; } catch (_) {}
        if (!/^\d+$/.test(id)) return null;
        const scroller = host.closest('[data-uia="carousel-scroller"], .slider') || row;
        const title = (card.querySelector('img[alt]')?.getAttribute('alt') ||
            card.querySelector('.fallback-text')?.textContent || card.getAttribute('aria-label') || '').trim().slice(0, 300);
        const typeHint = card.getAttribute('data-video-type') === 'movie' ? 'movie' : undefined;
        return { host, card, id, scroller, title, row, typeHint };
    }
    function scan(root = document) {
        const result = [], seen = new Set();
        const cards = root.matches?.(selector) ? [root, ...root.querySelectorAll(selector)] : root.querySelectorAll(selector);
        for (const card of cards) {
            const value = describe(card);
            if (value && !seen.has(value.host)) { seen.add(value.host); result.push(value); }
        }
        return result;
    }
    function lease({ host, card, id, scroller }) {
        const previousPosition = host.style.getPropertyValue('position'), positionPriority = host.style.getPropertyPriority('position');
        const positioned = !getComputedStyle || !getComputedStyle(host).position || getComputedStyle(host).position === 'static';
        if (positioned) host.style.setProperty('position', 'relative');
        const restoreOverflow = styleLease(host, 'overflow', 'visible', 'important');
        const releaseSpace = reserveActions(scroller);
        let hidden = false, originalVisibility = '', visibilityPriority = '', originalPointer = '', pointerPriority = '';
        let restoreDisplay = null;
        const originalAria = card.getAttribute('aria-hidden'), originalTab = card.getAttribute('tabindex');
        function current() { const value = describe(card); return value?.host === host && value.id === id && value.scroller === scroller; }
        function restore() {
            if (!hidden) return;
            restoreDisplay?.(); restoreDisplay = null;
            for (const [key, applied, previous, priority] of [['visibility', 'hidden', originalVisibility, visibilityPriority],
                ['pointer-events', 'none', originalPointer, pointerPriority]]) {
                if (card.style.getPropertyValue(key) === applied) {
                    if (previous) card.style.setProperty(key, previous, priority); else card.style.removeProperty(key);
                }
            }
            if (card.getAttribute('aria-hidden') === 'true') {
                if (originalAria === null) card.removeAttribute('aria-hidden'); else card.setAttribute('aria-hidden', originalAria);
            }
            if (card.getAttribute('tabindex') === '-1') {
                if (originalTab === null) card.removeAttribute('tabindex'); else card.setAttribute('tabindex', originalTab);
            }
            hidden = false;
        }
        return { current,
            hide(value) {
                if (!current()) return false;
                if (!value) { restore(); return true; }
                if (!hidden) {
                    restoreDisplay = styleLease(host, 'display', 'none', 'important');
                    originalVisibility = card.style.getPropertyValue('visibility'); visibilityPriority = card.style.getPropertyPriority('visibility');
                    originalPointer = card.style.getPropertyValue('pointer-events'); pointerPriority = card.style.getPropertyPriority('pointer-events');
                    card.style.setProperty('visibility', 'hidden', 'important'); card.style.setProperty('pointer-events', 'none', 'important');
                    card.setAttribute('aria-hidden', 'true'); card.setAttribute('tabindex', '-1'); hidden = true;
                }
                return true;
            },
            release() { restore(); restoreOverflow(); releaseSpace(); if (positioned && host.style.getPropertyValue('position') === 'relative') {
                if (previousPosition) host.style.setProperty('position', previousPosition, positionPriority); else host.style.removeProperty('position');
            } }
        };
    }
    function refillState(row, choices) {
        if (!row?.isConnected) return null;
        const items = scan(row).filter(item => item.row === row);
        if (!items.length) return null;
        const scroller = items[0].scroller;
        const bounds = scroller.getBoundingClientRect();
        const remaining = items.filter(item => {
            if (choices[item.id]) return false;
            const cardRect = item.host.getBoundingClientRect(), center = cardRect.left + cardRect.width / 2;
            return cardRect.width > 1 && center >= bounds.left && center <= bounds.right;
        });
        return { scroller, remaining: remaining.length, mounted: items.length,
            offscreen: items.filter(item => !choices[item.id]).length - remaining.length };
    }
    function loadingFacts(row) {
        const result = [], seen = new Set();
        try {
            const card = scan(row)[0]?.card;
            for (const root of [card, row]) {
                const key = root && Object.getOwnPropertyNames(root).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
                let fiber = key && root[key];
                for (let depth = 0; fiber && depth < 16 && result.length < 6 && !seen.has(fiber); depth++, fiber = fiber.return) {
                    seen.add(fiber);
                    const props = fiber.memoizedProps;
                    if (!props || typeof props !== 'object') continue;
                    const names = Object.keys(props).filter(name => /load|fetch|pagin|cursor|hasNext|itemCount|totalCount|rowId/i.test(name)).slice(0, 12);
                    if (!names.length) continue;
                    const type = fiber.elementType || fiber.type;
                    result.push({ depth, component: String(typeof type === 'string' ? type : type?.displayName || type?.name || 'unknown').slice(0, 80),
                        properties: names.map(name => ({ name: name.slice(0, 80), type: typeof Object.getOwnPropertyDescriptor(props, name)?.value })) });
                }
            }
        } catch (_) { return [{ unavailable: true }]; }
        return result;
    }
    function navigationTarget(target) {
        const next = target?.closest?.('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext');
        const previous = next ? null : target?.closest?.('[data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handlePrev');
        const control = next || previous, row = control?.closest('section, .lolomoRow');
        return control?.isConnected && row && scan(row).length ? { row, control, direction: next ? 'next' : 'previous' } : null;
    }
    function navigationStart(control) {
        const components = []; let truncated = false; const quotas = { props: 0, state: 0 };
        try {
            const key = Object.getOwnPropertyNames(control).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
            let fiber = key && Object.getOwnPropertyDescriptor(control, key)?.value;
            const seen = new Set();
            for (let depth = 0; fiber && depth < 24 && !seen.has(fiber); depth++, fiber = fiber.return) {
                seen.add(fiber);
                const sources = [['memoizedProps', Object.getOwnPropertyDescriptor(fiber, 'memoizedProps')?.value]];
                let state = Object.getOwnPropertyDescriptor(fiber, 'memoizedState')?.value;
                const hooks = new Set();
                if (state && Object.hasOwn(state, 'memoizedState') && Object.hasOwn(state, 'next')) {
                    for (let i = 0; state && i < 16 && !hooks.has(state); i++) {
                        hooks.add(state); sources.push([`hookState:${i}`, Object.getOwnPropertyDescriptor(state, 'memoizedState')?.value]);
                        state = Object.getOwnPropertyDescriptor(state, 'next')?.value;
                    }
                    truncated ||= Boolean(state);
                } else sources.push(['memoizedState', state]);
                for (const [source, value] of sources) {
                    if (!value || typeof value !== 'object') continue;
                    const keys = Object.keys(value), fields = Array.isArray(value) ? [{ name: 'stateArray', type: 'array', length: value.length,
                        elements: Array.from({ length: Math.min(value.length, 4) }, (_, index) => {
                            const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), child = descriptor?.value;
                            return { type: descriptor?.get ? 'accessor' : typeof child, ...(Array.isArray(child) ? { length: child.length } : {}) };
                        }), elementsTruncated: value.length > 4 }] : [];
                    for (const name of keys.slice(0, 40)) {
                        if (/^data-|^tabIndex$|^next$|^baseState$|^baseQueue$|^queue$/i.test(name)) continue;
                        if (!/click|load|fetch|pagin|cursor|item|video|title|row|list|count|next|prev|index|data|cache/i.test(name)) continue;
                        const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                        const fact = { name: name.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof child };
                        if (Array.isArray(child)) fact.length = child.length;
                        else if (child && typeof child === 'object') {
                            const nested = Object.keys(child);
                            fact.fields = nested.slice(0, 12).map(key => {
                                const descriptor = Object.getOwnPropertyDescriptor(child, key), value = descriptor?.value;
                                return { name: key.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof value,
                                    ...(Array.isArray(value) ? { length: value.length } : {}) };
                            });
                            fact.fieldsTruncated = nested.length > 12;
                        } else if (/count|index/i.test(name) && Number.isSafeInteger(child) && child >= 0) fact.value = child;
                        fields.push(fact);
                    }
                    truncated ||= keys.length > 40;
                    if (fields.length) {
                        const bucket = source === 'memoizedProps' ? 'props' : 'state';
                        if (quotas[bucket] >= 10) { truncated = true; continue; }
                        quotas[bucket]++;
                        const type = fiber.elementType || fiber.type;
                        components.push({ depth, source, component: String(typeof type === 'string' ? type : type?.displayName || type?.name || 'unknown').slice(0, 80), fields });
                    }
                }
                if (depth === 23 && fiber.return) truncated = true;
            }
            return { at: diagnosticTime(), components, truncated };
        } catch (_) { return { at: diagnosticTime(), unavailable: true, components }; }
    }
    function diagnosticTime() {
        try { const value = performance?.now(); return Number.isFinite(value) ? value : null; } catch (_) { return null; }
    }
    function requestRecord(entry) {
        if (!['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) return null;
        const url = new URL(entry.name, location.href);
        if (url.hostname !== 'netflix.com' && !url.hostname.endsWith('.netflix.com')) return null;
        return { startTime: entry.startTime, endpoint: /graphql/i.test(url.pathname) ? 'graphql' : /\/api\//i.test(url.pathname) ? 'api' : /falcor|pathEvaluator/i.test(url.pathname) ? 'falcor' : 'other',
            initiator: entry.initiatorType, durationMs: Math.round(entry.duration), transferBytes: Number(entry.transferSize) || 0 };
    }
    function observeRequests() {
        const graphql = createRecommendationRequests(environment);
        let observer = null, active = true, dropped = 0, failures = 0; const records = [];
        function accept(entries) {
            if (!active) return;
            for (const entry of entries) try {
                const record = requestRecord(entry); if (!record) continue;
                if (records.length === 200) { records.shift(); dropped++; }
                records.push(record);
            } catch (_) { failures++; }
        }
        try {
            observer = new PerformanceObserver(list => { if (active) try { accept(list.getEntries()); } catch (_) { failures++; } });
            observer.observe({ type: 'resource', buffered: false });
        } catch (_) { try { observer?.disconnect(); } catch (_) {} observer = null; }
        return { begin: graphql.begin, read() {
            if (observer && active) try { accept(observer.takeRecords()); } catch (_) { failures++; }
            return { available: Boolean(observer && active), records: records.slice(), dropped, failures, graphql: graphql.read() };
        }, dispose() { active = false; graphql.dispose(); try { observer?.disconnect(); } catch (_) {} observer = null; records.length = 0; } };
    }
    function navigationRequests(start, stop = diagnosticTime(), capture = null) {
        try {
            if (!Number.isFinite(start) || !Number.isFinite(stop) || (!capture?.available && !performance?.getEntriesByType)) return { unavailable: true };
            const end = Math.min(stop, start + 5000), all = capture?.available ? capture.records : performance.getEntriesByType('resource'), entries = [];
            let matched = 0;
            for (const entry of all.slice(-2000)) {
                if (entry.startTime < start || entry.startTime >= end) continue;
                const record = capture?.available ? entry : requestRecord(entry); if (!record) continue;
                matched++;
                if (entries.length >= 24) continue;
                const { startTime, ...facts } = record;
                entries.push({ ...facts, offsetMs: Math.round(startTime - start) });
            }
            return { windowMs: Math.max(0, end - start), inspected: Math.min(all.length, 2000), bufferTruncated: all.length > 2000,
                matched, entries, truncated: matched > entries.length, attribution: 'time-window-only',
                source: capture?.available ? 'future-observer' : 'buffered-fallback', dropped: capture?.dropped || 0, failures: capture?.failures || 0,
                graphql: capture?.graphql ? { ...capture.graphql, records: capture.graphql.records.filter(record => record.at >= start && record.at < end) } : null,
                limitation: 'Completed entries only; absent entries do not prove cached data, and zero transfer does not prove cache use.' };
        } catch (_) { return { unavailable: true }; }
    }
    function rowDiagnostics(row, choices) {
        try {
            const items = scan(row).filter(item => item.row === row), state = refillState(row, choices);
            if (!state) return null;
            const indicators = [...row.querySelectorAll('[data-indicator-selected]')];
            const track = state.scroller.querySelector('.sliderContent, .slider-content') || state.scroller;
            return { rowId: (row.getAttribute('data-list-id') || row.getAttribute('data-uia') || row.id || '').slice(0, 160),
                label: (row.querySelector('h2, .rowTitle')?.textContent || row.getAttribute('aria-label') || '').trim().slice(0, 160),
                mounted: state.mounted, visible: state.remaining, offscreen: state.offscreen,
                hidden: items.filter(item => choices[item.id]).length,
                ids: items.slice(0, 120).map(item => item.id), idsTruncated: items.length > 120,
                pageIndex: indicators.findIndex(item => item.getAttribute('data-indicator-selected') === 'true'),
                scrollLeft: Number(state.scroller.scrollLeft) || 0,
                transform: String(getComputedStyle?.(track).transform || track.style.getPropertyValue('transform') || '').slice(0, 160),
                next: Boolean(row.querySelector('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext')),
                previous: Boolean(row.querySelector('[data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handlePrev')),
                loading: loadingFacts(row) };
        } catch (_) { return null; }
    }
    return Object.freeze({ scan, lease, describe, refillState, loadingFacts, navigationTarget, rowDiagnostics,
        navigationStart, navigationRequests, observeRequests });
}
