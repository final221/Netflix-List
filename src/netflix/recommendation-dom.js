import { readVideoIdFromHref } from './page-dom.js';
import { createRecommendationRequests } from './recommendation-requests.js';
import { createLoaderSurvey } from './recommendation-loader.js';
import { findRecommendationQuery } from './recommendation-query.js';


const ACTION_SPACE = 72;
export const RECOMMENDATION_ARROW_STYLES = `
.tm-rec-controls{position:absolute;top:100%;left:0;right:0;height:66px;box-sizing:border-box;align-content:flex-start}
.tm-rec-controls>button{max-width:100%;min-width:0;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia="carousel-hawkins-right-button"],[data-uia="carousel-right-button"],[data-uia="carousel-hawkins-left-button"],[data-uia="carousel-left-button"],.handleNext,.handlePrev){
    width:56px!important;min-width:56px!important;min-height:64px!important;height:100%!important;max-height:none!important;max-width:none!important;box-sizing:border-box!important;
    position:absolute!important;top:0!important;bottom:0!important;transform:none!important;
    display:flex!important;align-items:center!important;justify-content:center!important;border-radius:8px!important;
    opacity:1!important;visibility:visible!important;
    z-index:10001!important;background:rgba(37,37,37,.32)!important;border:1px solid #777!important;box-shadow:0 0 12px #0008!important;color:#fff!important;
    cursor:pointer;pointer-events:auto;
}
:is(section,.lolomoRow):has(.tm-rec-controls) :is(.handleNext,.handlePrev){width:56px!important}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia*="carousel"][data-uia$="button"],.handleNext,.handlePrev):focus-visible{outline:3px solid #fff!important;outline-offset:-3px}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia*="carousel"][data-uia$="button"],.handleNext,.handlePrev) :is(svg,.indicator-icon){width:32px!important;height:32px!important;font-size:32px!important;pointer-events:none}

:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia="carousel-hawkins-right-button"],[data-uia="carousel-right-button"],[data-uia="carousel-hawkins-left-button"],[data-uia="carousel-left-button"],.handleNext,.handlePrev)::after{content:"";position:absolute;inset:0;border:1px solid #777;border-radius:8px;pointer-events:none}
:is(section,.lolomoRow):has(.tm-rec-controls) :is([data-uia="carousel-hawkins-right-button"],[data-uia="carousel-right-button"],[data-uia="carousel-hawkins-left-button"],[data-uia="carousel-left-button"],.handleNext,.handlePrev) :is(button,[role="button"]){width:100%!important;height:100%!important;max-height:none!important;align-self:stretch!important;border-radius:8px!important;background:transparent!important;display:flex!important;align-items:center!important;justify-content:center!important}
`;

// Visible slot size/order remains Netflix-owned. No private mutation or playback API.
export function createRecommendationDom(environment) {
    const { document, location, getComputedStyle, performance, PerformanceObserver } = environment;
    const selector = 'a[data-uia="standard-card"][href], .title-card';
    const scrollerLeases = new WeakMap(), arrowRows = new WeakMap();
    const layoutWork = { batches: 0, spaceWrites: 0, spaceRestores: 0, arrowRows: 0, arrowCards: 0, arrowWrites: 0, retirementErrors: 0 };
    let batchDepth = 0; const retirements = new Set();
    function batch(operation) {
        batchDepth++; layoutWork.batches++;
        try { return operation(); }
        finally { if (--batchDepth === 0) {
            const pending = [...retirements]; retirements.clear();
            for (const retire of pending) try { retire(); } catch (_) { layoutWork.retirementErrors++; }
        } }
    }
    const retire = resource => { if (batchDepth) retirements.add(resource.retire); else resource.retire(); };

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
            resource = { users: 0, restore: styleLease(scroller, 'padding-bottom', `${padding + ACTION_SPACE}px`, 'important') };
            resource.retire = () => { if (!resource.users && scrollerLeases.get(scroller) === resource) { resource.restore(); scrollerLeases.delete(scroller); layoutWork.spaceRestores++; } };
            scrollerLeases.set(scroller, resource); layoutWork.spaceWrites++;
        }
        resource.users++; let released = false;
        return () => {
            if (released) return; released = true;
            if (--resource.users === 0) retire(resource);
        };
    }
    const arrowSelector = '[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], [data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handleNext, .handlePrev';
    function reserveArrows(row) {
        let resource = arrowRows.get(row);
        if (!resource) {
            resource = { users: 0, controls: new Map() };
            resource.retire = () => { if (!resource.users && arrowRows.get(row) === resource) {
                for (const value of resource.controls.values()) value.restore.forEach(release => release());
                resource.controls.clear(); arrowRows.delete(row);
            } };
            arrowRows.set(row, resource);
        }
        resource.users++; let released = false;
        return () => {
            if (released) return; released = true;
            if (--resource.users === 0) retire(resource);
        };
    }
    function updateArrows(row) {
        try {
            const resource = arrowRows.get(row); if (!resource) return false; layoutWork.arrowRows++;
            const controls = [...row.querySelectorAll(arrowSelector)];
            for (const [control, value] of resource.controls) if (!controls.includes(control)) {
                value.restore.forEach(release => release()); resource.controls.delete(control);
            }
            if (!controls.length) return false;
            let card;
            for (const item of scan(row)) {
                if (item.row !== row) continue;
                const rect = item.card.getBoundingClientRect(); layoutWork.arrowCards++;
                if (rect.width > 1 && rect.height > 1) { card = rect; break; }
            }
            if (!card) return false;
            for (const control of controls) {
                const parent = control.offsetParent || row, rect = parent.getBoundingClientRect();
                const height = Math.round(card.height + ACTION_SPACE), top = Math.round(card.top - rect.top - (parent.clientTop || 0) + (parent.scrollTop || 0));
                const box = control.getBoundingClientRect(), previous = resource.controls.get(control);
                const viewport = document.documentElement?.clientWidth || environment.window?.innerWidth || environment.innerWidth;
                const next = control.matches('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext');
                const properties = [['height', height + 'px'], ['top', top + 'px'], ['bottom', 'auto']];
                if (viewport > 0 && box.width > 1) {
                    const width = Math.min(viewport, previous?.edgeWidth || Math.max(56, next ? viewport - box.left : box.right));
                    const edge = next ? viewport - width : 0;
                    properties.push(['left', Math.round(edge - rect.left - (parent.clientLeft || 0) + (parent.scrollLeft || 0)) + 'px'], ['right', 'auto'], ['width', Math.round(width) + 'px']);
                }
                const signature = JSON.stringify(properties);
                if (previous?.signature === signature && properties.every(([name, value]) => control.style.getPropertyValue(name) === value)) continue;
                previous?.restore.forEach(release => release());
                const value = { signature, edgeWidth: Number.parseFloat(properties.find(([name]) => name === 'width')?.[1]) || previous?.edgeWidth, restore: [] }; resource.controls.set(control, value);
                for (const [name, applied] of properties) { value.restore.push(styleLease(control, name, applied, 'important')); layoutWork.arrowWrites++; }
            }
            return true;
        } catch (_) { return false; }
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
    function lease({ host, card, id, scroller, row }) {
        const previousPosition = host.style.getPropertyValue('position'), positionPriority = host.style.getPropertyPriority('position');
        const positioned = !getComputedStyle || !getComputedStyle(host).position || getComputedStyle(host).position === 'static';
        if (positioned) host.style.setProperty('position', 'relative');
        const restoreOverflow = styleLease(host, 'overflow', 'visible', 'important');
        const releaseSpace = reserveActions(scroller), releaseArrows = reserveArrows(row);
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
            release() { restore(); restoreOverflow(); releaseSpace(); releaseArrows(); if (positioned && host.style.getPropertyValue('position') === 'relative') {
                if (previousPosition) host.style.setProperty('position', previousPosition, positionPriority); else host.style.removeProperty('position');
            } }
        };
    }
    function sampleRow(row, choices) {
        if (!row?.isConnected) return null;
        const scanned = scan(row), items = scanned.filter(item => item.row === row);
        if (!items.length) return null;
        const scroller = items[0].scroller;
        const bounds = scroller.getBoundingClientRect();
        const visibleIds = [], cardPositions = [];
        let unhidden = 0;
        for (const item of items) {
            if (choices[item.id]) continue;
            unhidden++;
            const rect = item.host.getBoundingClientRect(), center = rect.left + rect.width / 2;
            if (!(rect.width > 1)) continue;
            cardPositions.push({ id: item.id, rect });
            if (center >= bounds.left && center <= bounds.right) visibleIds.push(item.id);
        }
        return { items, bounds, firstCard: scanned[0].card, visibleIds, cardPositions, unhidden,
            state: { scroller, remaining: visibleIds.length, mounted: items.length, offscreen: unhidden - visibleIds.length } };
    }
    function refillState(row, choices) { return sampleRow(row, choices)?.state || null; }
    function loadingFacts(row, sampledCard = null) {
        const result = [], seen = new Set();
        try {
            const card = sampledCard || scan(row)[0]?.card;
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
    const queryRoots = card => [card, ...(card.closest?.('section, .lolomoRow')?.querySelectorAll(arrowSelector) || [])].slice(0, 3);
    function navigationTarget(target) {
        const next = target?.closest?.('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext');
        const previous = next ? null : target?.closest?.('[data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handlePrev');
        const control = next || previous, row = control?.closest('section, .lolomoRow');
        return control?.isConnected && row && scan(row).length ? { row, control, direction: next ? 'next' : 'previous' } : null;
    }
    function navigationStart(control, { detailed = true } = {}) {
        if (!detailed) return { at: diagnosticTime(), detailed: false };
        const components = []; let truncated = false, shapeBudget = 360; const quotas = { props: 0, state: 0 };
        const row = control.closest?.('section, .lolomoRow');
        const loader = createLoaderSurvey(row ? scan(row).slice(0, 120).map(item => item.id) : []);
        const pagination = []; let paginationTruncated = false;
        // Independent of the general shape budget: theme/portal state must not hide loader clues.
        function paginationFacts(root, depth, source) {
            const queue = [[root, '', 0]], seen = new Set(); let inspected = 0;
            while (queue.length && inspected++ < 32) {
                const [value, path, level] = queue.shift();
                if (!value || typeof value !== 'object' || seen.has(value)) continue;
                seen.add(value); loader.inspect(value, { depth, source, path });
                const keys = Object.keys(value).filter(name => /^[A-Za-z_0-9]{1,80}$/.test(name) &&
                    !/auth|token|cookie|credential|profile|account|session|theme|style|portal|toast/i.test(name));
                for (const name of keys.slice(0, 24)) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                    const next = path ? path + '.' + name : name;
                    let fact = null;
                    if (/^(load(More|Next|Previous)?|fetch(More|Next|Query|Page)?|prefetch|paginate|refetch|getRow)$/i.test(name)) {
                        if (descriptor?.get) fact = { kind: 'accessor' };
                        else if (typeof child === 'function') {
                            const arity = Object.getOwnPropertyDescriptor(child, 'length')?.value;
                            fact = { kind: 'callback', ...(Number.isSafeInteger(arity) && arity >= 0 && arity <= 100 ? { arity } : {}) };
                        }
                    } else if (/^(hasNext(Page)?|hasMore|isLoading(Next)?|isFetching(NextPage)?|loading)$/i.test(name) && typeof child === 'boolean')
                        fact = { kind: 'flag', value: child };
                    else if (name === 'name' && ['query', 'mutation', 'subscription'].includes(Object.getOwnPropertyDescriptor(value, 'operationKind')?.value) &&
                        typeof child === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(child)) fact = { kind: 'operation', operationName: child };
                    if (fact) {
                        if (pagination.length < 24) pagination.push({ depth, source, path: next, ...fact });
                        else paginationTruncated = true;
                    }
                    if (level < 5 && child && typeof child === 'object' && (Array.isArray(value) && /^\d+$/.test(name) && Number(name) < 8 ||
                        /^(pagination|fragment|environment|relay|params|variables|data|value|current|ref|state|cache)$/i.test(name)))
                        queue.push([child, next, level + 1]);
                }
                paginationTruncated ||= keys.length > 24;
            }
            paginationTruncated ||= queue.length > 0;
        }
        function shape(value, depth = 0) {
            if (!value || typeof value !== 'object' || depth >= 3 || shapeBudget <= 0) return {};
            const keys = Object.keys(value).filter(key => !/auth|token|cookie|credential|profile|account|session/i.test(key));
            const fields = [];
            for (const name of keys.slice(0, 12)) {
                if (--shapeBudget < 0) { truncated = true; break; }
                const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                fields.push({ name: name.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof child,
                    ...(Array.isArray(child) ? { length: child.length } : {}), ...shape(child, depth + 1),
                    ...(/count|index|offset|limit|pageSize/i.test(name) && Number.isSafeInteger(child) && child >= 0 ? { value: child } : {}),
                    ...(name === 'name' && typeof child === 'string' && ['query', 'mutation', 'subscription'].includes(Object.getOwnPropertyDescriptor(value, 'operationKind')?.value) && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(child || '') ? { operationName: child } : {}) });
            }
            return { fields, fieldsTruncated: fields.length < keys.length };
        }
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
                    for (let i = 0; state && i < 48 && !hooks.has(state); i++) {
                        hooks.add(state); sources.push([`hookState:${i}`, Object.getOwnPropertyDescriptor(state, 'memoizedState')?.value]);
                        state = Object.getOwnPropertyDescriptor(state, 'next')?.value;
                    }
                    truncated ||= Boolean(state);
                } else sources.push(['memoizedState', state]);
                const dependencies = Object.getOwnPropertyDescriptor(fiber, 'dependencies')?.value;
                let dependency = dependencies && Object.getOwnPropertyDescriptor(dependencies, 'firstContext')?.value;
                const contexts = new Set();
                for (let i = 0; dependency && i < 4 && !contexts.has(dependency); i++) {
                    contexts.add(dependency); sources.push(['context:' + i, Object.getOwnPropertyDescriptor(dependency, 'memoizedValue')?.value]);
                    dependency = Object.getOwnPropertyDescriptor(dependency, 'next')?.value;
                }
                for (const [source, value] of sources) {
                    if (!value || typeof value !== 'object') continue;
                    paginationFacts(value, depth, source);
                    const keys = Object.keys(value), fields = Array.isArray(value) ? [{ name: 'stateArray', type: 'array', length: value.length,
                        elements: Array.from({ length: Math.min(value.length, 4) }, (_, index) => {
                            const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), child = descriptor?.value;
                            return { type: descriptor?.get ? 'accessor' : typeof child, ...(Array.isArray(child) ? { length: child.length } : {}),
                                ...shape(child) };
                        }), elementsTruncated: value.length > 4 }] : [];
                    for (const name of keys.slice(0, 40)) {
                        if (/^data-|^tabIndex$|^next$|^baseState$|^baseQueue$|^queue$/i.test(name)) continue;
                        if (!/click|load|fetch|pagin|cursor|item|video|title|row|list|count|next|prev|index|data|cache|fragment|relay|environment|connection|pageInfo|params/i.test(name)) continue;
                        const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                        const fact = { name: name.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof child };
                        if (Array.isArray(child)) fact.length = child.length;
                        else if (child && typeof child === 'object') {
                            Object.assign(fact, shape(child));
                        } else if (/count|index/i.test(name) && Number.isSafeInteger(child) && child >= 0) fact.value = child;
                        fields.push(fact);
                    }
                    truncated ||= keys.length > 40;
                    if (fields.length) {
                        const bucket = source === 'memoizedProps' ? 'props' : 'state';
                        if (quotas[bucket] >= (bucket === 'props' ? 10 : 20)) { truncated = true; continue; }
                        quotas[bucket]++;
                        const type = fiber.elementType || fiber.type;
                        components.push({ depth, source, component: String(typeof type === 'string' ? type : type?.displayName || type?.name || 'unknown').slice(0, 80), fields });
                    }
                }
                if (depth === 23 && fiber.return) truncated = true;
            }
            return { at: diagnosticTime(), components, truncated, pagination, paginationTruncated, loader: loader.snapshot(), control: controlFacts(control) };
        } catch (_) { return { at: diagnosticTime(), unavailable: true, components }; }
    }
    function controlFacts(control) {
        try {
            function describeNode(node) {
                const rect = node.getBoundingClientRect(), style = getComputedStyle?.(node);
                return { tag: node.tagName, rect: [rect.left, rect.top, rect.width, rect.height].map(value => Number.isFinite(value) ? Math.round(value) : null),
                    background: String(style?.backgroundColor || '').slice(0, 80), opacity: style?.opacity,
                    position: style?.position, height: style?.height, overflow: style?.overflow,
                    borderRadius: style?.borderRadius, clipPath: String(style?.clipPath || '').slice(0, 120) };
            }
            const nodes = [control, control.querySelector?.('button, [role="button"]')].filter(Boolean);
            const parents = []; let parent = control.parentElement;
            for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) parents.push(describeNode(parent));
            const rect = control.getBoundingClientRect(), hits = [];
            const viewport = document.documentElement?.clientWidth || environment.window?.innerWidth || environment.innerWidth;
            const points = [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].map(y => [rect.left + rect.width / 2, y]);
            for (const x of [rect.left + 2, rect.right - 2, 1, viewport - 1]) if (Number.isFinite(x)) points.push([x, rect.top + rect.height / 2]);
            if (document?.elementFromPoint && rect.height > 0) for (const [x, y] of points) {
                const hit = document.elementFromPoint(x, y);
                hits.push({ x: Math.round(x), y: Math.round(y), tag: hit?.tagName || null, inside: Boolean(hit && (hit === control || control.contains(hit))) });
            }
            return { nodes: nodes.map(describeNode), parents, icon: control.querySelector?.('svg, .indicator-icon') ? describeNode(control.querySelector('svg, .indicator-icon')) : null, hits };
        } catch (_) { return { unavailable: true }; }
    }
    function diagnosticTime() {
        try { const value = performance?.now(); return Number.isFinite(value) ? value : null; } catch (_) { return null; }
    }
    function requestRecord(entry) {
        if (!['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) return null;
        const url = new URL(entry.name, location.href);
        if (url.hostname !== 'netflix.com' && !url.hostname.endsWith('.netflix.com')) return null;
        return { startTime: entry.startTime, endpoint: /graphql/i.test(url.pathname) ? 'graphql' : /\/api\//i.test(url.pathname) ? 'api' : /falcor|pathEvaluator/i.test(url.pathname) ? 'falcor' : 'other',
            initiator: entry.initiatorType, durationMs: Math.round(entry.duration), transferBytes: Number(entry.transferSize) || 0,
            ...(/graphql/i.test(url.pathname) ? { sameOrigin: url.origin === new URL(location.href).origin,
                queryKeys: [...new Set(url.searchParams.keys())].filter(key => /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(key) && !/auth|token|cookie|credential|profile|account|session/i.test(key)).slice(0, 12),
                ...(/^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(url.searchParams.get('operationName') || '') ? { operation: url.searchParams.get('operationName') } : {}) } : {}) };
    }
    function observeRequests() {
        let graphql = null;
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
        return { begin({ detailed = false } = {}) {
            if (detailed) { graphql ||= createRecommendationRequests(environment); graphql.begin(); }
        }, read() {
            if (observer && active) try { accept(observer.takeRecords()); } catch (_) { failures++; }
            return { available: Boolean(observer && active), records: records.slice(), dropped, failures, graphql: graphql?.read() || null };
        }, dispose() { active = false; graphql?.dispose(); try { observer?.disconnect(); } catch (_) {} observer = null; records.length = 0; } };
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
    function layoutFacts(row, sample) {
        const pack = rect => [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value || 0));
        const rect = sample.state.scroller === row ? sample.bounds : row.getBoundingClientRect();
        const item = sample.items.find(item => item.id === sample.cardPositions[0]?.id);
        const card = item && (item.card === item.host ? sample.cardPositions[0].rect : item.card.getBoundingClientRect());
        const next = row.nextElementSibling?.getBoundingClientRect();
        return { row: pack(rect), reservedSpace: ACTION_SPACE, paddingBottom: sample.state.scroller.style.getPropertyValue('padding-bottom'),
            nextGap: next ? Math.round(next.top - rect.top - rect.height) : null,
            arrows: [...row.querySelectorAll(arrowSelector)].slice(0, 4).map(control => { const box = control.getBoundingClientRect();
                return { direction: control.matches('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext') ? 'next' : 'previous',
                    rect: pack(box), topDelta: card ? Math.round(box.top - card.top) : null,
                    heightDelta: card ? Math.round(box.height - card.height - ACTION_SPACE) : null }; }) };
    }
    function rowDiagnostics(row, choices, { layout = true } = {}) {
        try {
            const sample = sampleRow(row, choices);
            if (!sample) return null;
            const { items, state, visibleIds, cardPositions, unhidden, bounds } = sample;
            const indicators = [...row.querySelectorAll('[data-indicator-selected]')];
            const track = state.scroller.querySelector('.sliderContent, .slider-content') || state.scroller;
            return { rowId: (row.getAttribute('data-list-id') || row.getAttribute('data-uia') || row.id || '').slice(0, 160),
                label: (row.querySelector('h2, .rowTitle')?.textContent || row.getAttribute('aria-label') || '').trim().slice(0, 160),
                mounted: state.mounted, visible: state.remaining, offscreen: state.offscreen, ...(layout ? { layout: layoutFacts(row, sample) } : {}),
                pageCapacity: cardPositions[0]?.rect.width > 1 ? Math.max(1, Math.min(20,
                    Math.floor((bounds.width || bounds.right - bounds.left) / cardPositions[0].rect.width) || 1)) : null,
                hidden: items.length - unhidden,
                ids: items.slice(0, 120).map(item => item.id), idsTruncated: items.length > 120,
                cardPositions: cardPositions.slice(0, 24).map(({ id, rect }) => ({ id,
                    rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round) })), positionsTruncated: unhidden > 24,
                visibleIds: visibleIds.slice(0, 120),
                pageIndex: indicators.findIndex(item => item.getAttribute('data-indicator-selected') === 'true'),
                scrollLeft: Number(state.scroller.scrollLeft) || 0,
                transform: String(getComputedStyle?.(track).transform || track.style.getPropertyValue('transform') || '').slice(0, 160),
                next: Boolean(row.querySelector('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext')),
                previous: Boolean(row.querySelector('[data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handlePrev')),
                loading: loadingFacts(row, sample.firstCard) };
        } catch (_) { return null; }
    }
    return Object.freeze({ scan, lease, updateArrows, batch, layoutDiagnostics: () => ({ ...layoutWork }), describe, refillState, loadingFacts, navigationTarget, rowDiagnostics,
        navigationStart, navigationRequests, observeRequests, queryBinding: (card, ids) => findRecommendationQuery(queryRoots(card), ids), queryPage: card => findRecommendationQuery(queryRoots(card), [], { paginationOnly: true }).pagination });
}
