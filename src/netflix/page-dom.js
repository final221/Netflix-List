import { SECTION_ATTR, SYNTHETIC_SECTION_ID } from '../dom-names.js';

// Netflix-owned selectors used by discovery and card handling live here.
export const NETFLIX_DOM_SELECTORS = Object.freeze({
    browseSections: '[data-uia="browse-page-sections"]',
    progressCard: '[data-uia="progress-card"]',
    carouselRowZero: 'carousel-row-section-0',
    carouselRowOne: 'carousel-row-section-1',
    carouselRowOneSection: 'section[data-uia="carousel-row-section-1"]',
    emptyCarouselSection: 'empty-carousel-section',
    carouselScroller: '[data-uia="carousel-scroller"]',
    standardCard: 'a[data-uia="standard-card"]',
    standardCardWithHref: 'a[data-uia="standard-card"][href]',
    virtualSlot: '[data-virtual-slot]'
});

export function readVideoIdFromHref(href, baseHref) {
    try {
        const url = new URL(href, baseHref);
        const jbv = url.searchParams.get('jbv');
        if (jbv) return jbv;
        const m = url.pathname.match(/\/title\/(\d+)/);
        return m ? m[1] : '';
    } catch (_) {
        return '';
    }
}

export function createNetflixPageDom({ document, Element, location, readGraphqlIdentity = () => null,
    getComputedStyle = () => ({}), HTMLElement = Element }) {
    const videoIdFromHref = href => readVideoIdFromHref(href, location.href);

    function nativeCardIdentity(slot) {
        const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return '';
        const href = card.href || card.getAttribute('href') || '';
        return videoIdFromHref(href) || href || card.getAttribute('aria-label') || '';
    }

    function decodeTrackingContext(node) {
        const raw = node?.getAttribute?.('data-ui-tracking-context') || '';
        if (!raw) return null;
        for (const candidate of [raw, (() => {
            try { return decodeURIComponent(raw); } catch (_) { return raw; }
        })()]) {
            try {
                const parsed = JSON.parse(candidate);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (_) {}
        }
        return null;
    }

    function videoIdFromToggleContext(button, trackingContext, activeVideoId) {
        const direct = trackingContext?.video_id ?? trackingContext?.videoId;
        if (direct !== undefined && direct !== null && String(direct)) return String(direct);
        const unified = String(trackingContext?.unifiedEntityId || '');
        const unifiedMatch = unified.match(/Video:(\d+)/i);
        if (unifiedMatch) return unifiedMatch[1];

        const slot = button?.closest?.(NETFLIX_DOM_SELECTORS.virtualSlot);
        if (slot) {
            for (const anchor of slot.querySelectorAll('a[href]')) {
                const videoId = videoIdFromHref(anchor.href || anchor.getAttribute('href') || '');
                if (videoId) return videoId;
            }
        }

        const modal = button?.closest?.('[role="dialog"], .previewModal--container, .previewModal--wrapper');
        if (modal) {
            for (const anchor of modal.querySelectorAll('a[href]')) {
                const videoId = videoIdFromHref(anchor.href || anchor.getAttribute('href') || '');
                if (videoId) return videoId;
            }
            if (activeVideoId) return String(activeVideoId);
        }
        return '';
    }

    function findMyListSection() {
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        if (!host) return null;
        return netflixDom.findStructuralMyListSection(host) ||
            netflixDom.findSectionByGraphqlIdentity(host, readGraphqlIdentity());
    }

    function describeMembershipClick(event, { activeVideoId = '' } = {}) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest?.('button');
        if (!button) return null;

        const uia = button.getAttribute('data-uia') || '';
        const tracker = button.closest('.ptrack-content[data-ui-tracking-context]');
        const trackingContext = decodeTrackingContext(tracker);
        const trackedAsMyList = trackingContext?.appView === 'addToMyListButton';
        const uiaIsMyList = /(?:^|-)add-to-my-list|remove-from-my-list/i.test(uia);
        if (!trackedAsMyList && !uiaIsMyList) return null;

        const videoId = videoIdFromToggleContext(button, trackingContext, activeVideoId);
        if (!videoId) return null;

        const uiaAction = /remove-from-my-list/i.test(uia)
            ? 'remove'
            : (/add-to-my-list/i.test(uia) ? 'add' : 'unknown');

        return { button, videoId, uiaAction, uia, trackingContext };
    }

    function describeToastActionClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest?.('button');
        const toast = button?.closest?.('#toastRoot [aria-label="toast"], #toastRoot [role="alert"]');
        if (!toast) return false;
        const buttons = [...toast.querySelectorAll('button')];
        return buttons.length === 1 && buttons[0] === button;
    }

    const netflixDom = Object.freeze({
        selectors: NETFLIX_DOM_SELECTORS,

        sectionVideoIds(section, cardLimit = Infinity) {
            const ids = new Set();
            let examined = 0;
            for (const card of section?.querySelectorAll?.(this.selectors.standardCardWithHref) || []) {
                if (examined++ >= cardLimit) break;
                const id = videoIdFromHref(card.getAttribute('href') || card.href || '');
                if (id) ids.add(String(id));
            }
            return ids;
        },

        isSyntheticSection(section) {
            return !section ||
                section.id === SYNTHETIC_SECTION_ID ||
                section.getAttribute('data-tm-synthetic-mylist') === 'true';
        },

        nativeSections(host) {
            if (!host) return [];
            return [...host.querySelectorAll(':scope > section')].filter(section => !this.isSyntheticSection(section));
        },

        nextNativeSection(section, host) {
            if (!section || !host) return null;
            let node = section.nextElementSibling;
            while (node) {
                if (node.matches?.('section') && !this.isSyntheticSection(node)) return node;
                node = node.nextElementSibling;
            }
            return null;
        },

        findContinueWatchingSection(host) {
            const sections = this.nativeSections(host);
            if (!sections.length) return null;

            // Non-empty Continue Watching has progress cards. Its row index is also
            // exposed as a language-neutral Uia. When the row is empty Netflix uses
            // the generic empty-carousel-section Uia, so the first native section on
            // /browse/my-list remains the structural anchor.
            const progressSection = sections.find(section => section.querySelector(this.selectors.progressCard));
            if (progressSection) return progressSection;

            const rowZero = sections.find(section => section.getAttribute('data-uia') === this.selectors.carouselRowZero);
            if (rowZero) return rowZero;

            const first = sections[0];
            if (first?.getAttribute('data-uia') === this.selectors.emptyCarouselSection) return first;
            return null;
        },

        findStructuralMyListSection(host) {
            if (!host) return null;
            const nativeSections = this.nativeSections(host);
            const alreadyBound = nativeSections.find(section => section.getAttribute(SECTION_ATTR) === 'true');
            if (alreadyBound) return alreadyBound;

            // On /browse/my-list Netflix assigns the native My List carousel row the
            // language-neutral structural Uia for row 1. This remains available even
            // when Continue Watching is empty, which has no progress-card elements.
            const indexedMyList = nativeSections.find(section =>
                section.getAttribute('data-uia') === this.selectors.carouselRowOne
            );
            if (indexedMyList) return indexedMyList;

            // Empty My List has the generic empty-carousel-section Uia. In that case
            // use the page structure: My List immediately follows Continue Watching.
            // nextNativeSection() deliberately skips our synthetic placeholder.
            const continueWatching = this.findContinueWatchingSection(host);
            const adjacent = this.nextNativeSection(continueWatching, host);
            if (adjacent) return adjacent;

            return null;
        },

        findSectionByGraphqlIdentity(host, graphqlIdentity) {
            if (!host || !graphqlIdentity) return null;
            const graphqlSectionId = graphqlIdentity.sectionId;
            const byGraphqlId = graphqlSectionId ? document.getElementById(graphqlSectionId) : null;
            if (byGraphqlId?.matches?.('section') && byGraphqlId.parentElement === host &&
                !this.isSyntheticSection(byGraphqlId)) {
                return byGraphqlId;
            }

            const expectedIds = new Set(graphqlIdentity.videoIds);
            if (expectedIds.size) {
                let bestSection = null;
                let bestOverlap = 0;
                for (const section of this.nativeSections(host)) {
                    const ids = this.sectionVideoIds(section);
                    let overlap = 0;
                    for (const id of ids) if (expectedIds.has(id)) overlap++;
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        bestSection = section;
                    }
                }
                if (bestSection && bestOverlap >= Math.min(2, expectedIds.size)) return bestSection;
            }

            return null;
        },

        findTrack(scroller) {
            if (!scroller) return null;
            for (const div of scroller.querySelectorAll('div')) {
                if (div.querySelector(`:scope > ${this.selectors.virtualSlot}`)) return div;
            }
            return null;
        },

        directSlots(track) {
            return track ? [...track.querySelectorAll(`:scope > ${this.selectors.virtualSlot}`)] : [];
        },

        filledSlots(track) {
            return this.directSlots(track).filter(slot => slot.querySelector(this.selectors.standardCard));
        }
    });

    function readMyListAnchor(cardLimit = Infinity) {
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        const section = host?.querySelector?.(`:scope > ${NETFLIX_DOM_SELECTORS.carouselRowOneSection}`) || null;
        let videoIds;
        // A section-ID match needs no card scan. Cache the fallback facts for this one read.
        return { sectionId: String(section?.id || ''),
            get videoIds() { return videoIds ||= [...netflixDom.sectionVideoIds(section, cardLimit)]; } };
    }
    function readHeadingTypography(section) {
        const heading = section?.querySelector('h2') || document.querySelector(`${NETFLIX_DOM_SELECTORS.browseSections} section h2`);
        if (!heading) return Object.freeze({});
        const style = getComputedStyle(heading), facts = {};
        for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']) {
            const value = style.getPropertyValue(property);
            if (value) facts[property] = value;
        }
        facts.color = style.color || 'rgb(255, 255, 255)';
        return Object.freeze(facts);
    }
    function readSyntheticPlacement() {
        const host = document.querySelector(NETFLIX_DOM_SELECTORS.browseSections);
        const native = host && [...host.querySelectorAll(':scope > section')].filter(node => node.id !== SYNTHETIC_SECTION_ID);
        if (!native?.length) return null;
        const after = netflixDom.findContinueWatchingSection(host) || native[0];
        return Object.freeze({ host, after });
    }
    function readEmptyContent(section) {
        const node = section?.querySelector?.(':scope > [data-uia="empty-carousel-section+content"]');
        if (!node) return null;
        const message = normalizeTitle(node.querySelector('[data-uia="empty-carousel-section+message"]')?.textContent);
        return Object.freeze({ node, message });
    }
    function readEmptyShell() {
        return [...document.querySelectorAll('[data-uia="empty-carousel-section+content"]')]
            .find(node => !node.closest(`[${SECTION_ATTR}="true"]`)) || null;
    }
    function normalizeTitle(value) {
        return String(value || '').replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, '').trim();
    }
    function readRowGap(section, viewportWidth) {
        const fallback = Math.max(20, Math.min(56, viewportWidth * 0.02));
        if (!section) return fallback;
        const values = [], sectionRect = section.getBoundingClientRect();
        const children = [...section.parentElement?.children || []];
        const siblings = children.filter(node => node instanceof HTMLElement && node !== section &&
            node.matches('section') && node.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller));
        const index = children.indexOf(section);
        const previous = children.slice(0, index).reverse().find(node => siblings.includes(node));
        const next = children.slice(index + 1).find(node => siblings.includes(node));
        if (previous) {
            const gap = sectionRect.top - previous.getBoundingClientRect().bottom;
            if (gap >= 8 && gap <= 180) values.push(gap);
            const margin = Number.parseFloat(getComputedStyle(previous).marginBottom || '0');
            if (margin >= 8 && margin <= 180) values.push(margin);
        }
        if (next) {
            const gap = next.getBoundingClientRect().top - sectionRect.bottom;
            if (gap >= 8 && gap <= 180) values.push(gap);
            const margin = Number.parseFloat(getComputedStyle(next).marginTop || '0');
            if (margin >= 8 && margin <= 180) values.push(margin);
        }
        const ownMargin = Number.parseFloat(getComputedStyle(section).marginBottom || '0');
        if (ownMargin >= 8 && ownMargin <= 180) values.push(ownMargin);
        if (!values.length) return fallback;
        const nums = values.filter(Number.isFinite).sort((a, b) => a - b), mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }
    return Object.freeze({ ...netflixDom, findMyListSection, readMyListAnchor, nativeCardIdentity, videoIdFromHref,
        decodeTrackingContext, describeMembershipClick, describeToastActionClick, readHeadingTypography, readSyntheticPlacement, readEmptyContent, readEmptyShell, readRowGap, normalizeTitle });
}
