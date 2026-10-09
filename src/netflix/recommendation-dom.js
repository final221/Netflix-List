import { readVideoIdFromHref } from './page-dom.js';

// Slot size/order remains Netflix-owned. No private mutation or playback API.
export function createRecommendationDom({ document, location, getComputedStyle }) {
    const selector = 'a[data-uia="standard-card"][href], .title-card';
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
        return { host, card, id };
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
    function lease({ host, card, id }) {
        const previousPosition = host.style.getPropertyValue('position'), positionPriority = host.style.getPropertyPriority('position');
        const positioned = !getComputedStyle || !getComputedStyle(host).position || getComputedStyle(host).position === 'static';
        if (positioned) host.style.setProperty('position', 'relative');
        let hidden = false, originalVisibility = '', visibilityPriority = '', originalPointer = '', pointerPriority = '';
        const originalAria = card.getAttribute('aria-hidden'), originalTab = card.getAttribute('tabindex');
        function current() { const value = describe(card); return value?.host === host && value.id === id; }
        function restore() {
            if (!hidden) return;
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
                    originalVisibility = card.style.getPropertyValue('visibility'); visibilityPriority = card.style.getPropertyPriority('visibility');
                    originalPointer = card.style.getPropertyValue('pointer-events'); pointerPriority = card.style.getPropertyPriority('pointer-events');
                    card.style.setProperty('visibility', 'hidden', 'important'); card.style.setProperty('pointer-events', 'none', 'important');
                    card.setAttribute('aria-hidden', 'true'); card.setAttribute('tabindex', '-1'); hidden = true;
                }
                return true;
            },
            release() { restore(); if (positioned && host.style.getPropertyValue('position') === 'relative') {
                if (previousPosition) host.style.setProperty('position', previousPosition, positionPriority); else host.style.removeProperty('position');
            } }
        };
    }
    return Object.freeze({ scan, lease, describe });
}
