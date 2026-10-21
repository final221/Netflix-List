import { readVideoIdFromHref } from './page-dom.js';
import { createRecommendationInspection } from './recommendation-dom/inspection.js';
import { findRecommendationQuery } from './recommendation-query.js';


const ACTION_SPACE = 72;
export const RECOMMENDATION_ARROW_STYLES = `
.tm-rec-controls{position:absolute;top:100%;left:0;right:0;box-sizing:border-box;align-content:flex-start}
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
    const { document, location, getComputedStyle } = environment;
    const selector = 'a[data-uia="standard-card"][href], .title-card';
    const { loadingFacts, navigationStart, navigationRequests, observeRequests } = createRecommendationInspection(environment, scan);
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
    function actionSpan(item, card) {
        const actions = item.host.querySelector('.tm-rec-controls')?.getBoundingClientRect();
        return Math.round(Math.max(card.height, actions?.height > 1 ? actions.top + actions.height - card.top : 0));
    }
    function updateArrows(row) {
        try {
            const resource = arrowRows.get(row); if (!resource) return false; layoutWork.arrowRows++;
            const controls = [...row.querySelectorAll(arrowSelector)];
            for (const [control, value] of resource.controls) if (!controls.includes(control)) {
                value.restore.forEach(release => release()); resource.controls.delete(control);
            }
            if (!controls.length) return false;
            let card, height;
            for (const item of scan(row)) {
                if (item.row !== row) continue;
                const rect = item.card.getBoundingClientRect(); layoutWork.arrowCards++;
                if (rect.width > 1 && rect.height > 1) { card = rect; height = actionSpan(item, rect); break; }
            }
            if (!card) return false;
            for (const control of controls) {
                const parent = control.offsetParent || row, rect = parent.getBoundingClientRect();
                const top = Math.round(card.top - rect.top - (parent.clientTop || 0) + (parent.scrollTop || 0));
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
    const queryRoots = card => [card, ...(card.closest?.('section, .lolomoRow')?.querySelectorAll(arrowSelector) || [])].slice(0, 3);
    function navigationTarget(target) {
        const next = target?.closest?.('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext');
        const previous = next ? null : target?.closest?.('[data-uia="carousel-hawkins-left-button"], [data-uia="carousel-left-button"], .handlePrev');
        const control = next || previous, row = control?.closest('section, .lolomoRow');
        return control?.isConnected && row && scan(row).length ? { row, control, direction: next ? 'next' : 'previous' } : null;
    }
    function layoutFacts(row, sample) {
        const pack = rect => [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value || 0));
        const rect = sample.state.scroller === row ? sample.bounds : row.getBoundingClientRect();
        const item = sample.items.find(item => item.id === sample.cardPositions[0]?.id);
        const card = item && (item.card === item.host ? sample.cardPositions[0].rect : item.card.getBoundingClientRect());
        const contentHeight = card ? actionSpan(item, card) : null;
        const next = row.nextElementSibling?.getBoundingClientRect();
        return { row: pack(rect), reservedSpace: ACTION_SPACE, contentHeight, paddingBottom: sample.state.scroller.style.getPropertyValue('padding-bottom'),
            nextGap: next ? Math.round(next.top - rect.top - rect.height) : null,
            arrows: [...row.querySelectorAll(arrowSelector)].slice(0, 4).map(control => { const box = control.getBoundingClientRect();
                return { direction: control.matches('[data-uia="carousel-hawkins-right-button"], [data-uia="carousel-right-button"], .handleNext') ? 'next' : 'previous',
                    rect: pack(box), topDelta: card ? Math.round(box.top - card.top) : null,
                    heightDelta: card ? Math.round(box.height - contentHeight) : null }; }) };
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
