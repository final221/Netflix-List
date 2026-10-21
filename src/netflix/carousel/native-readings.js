import { normalizeNetflixLogicalIndex, logicalPageFromSlotPositions } from './page-model.js';
import { readCardSignature } from './react-readings.js';

// Synchronous samples only; interpreted model facts arrive from Carousel.
export function createNativeReadings({ netflixDom, NETFLIX_DOM_SELECTORS, netflixReactCarousel,
    readPosition, pageCount, selectedPage, findMyListSection, nativeCardIdentity, listData, layoutFormula, initializationError,
    logVirtualRawIndexDiagnostic, readDiagnosticTotalCount }) {
    let nativeReadScope = null;
    const layoutMeasurements = { formula: layoutFormula };
    function createNativeReadScope() {
        return { profiles: new WeakMap(), indicators: new WeakMap(), filled: new WeakMap(),
            slots: new WeakMap(), rects: new WeakMap(), indices: new WeakMap(), layouts: new WeakMap(), domState: null };
    }

    function withNativeReadScope(read) {
        if (nativeReadScope) return read();
        // Only synchronous reads belong here. Never retain state across a frame,
        // await, or Netflix render; the next sample must discover fresh native data.
        nativeReadScope = createNativeReadScope();
        try { return read(); } finally { nativeReadScope = null; }
    }

    function invalidateNativeReadScope() {
        if (nativeReadScope) nativeReadScope = createNativeReadScope();
    }

    function nativeRect(node) {
        if (!nativeReadScope) return node.getBoundingClientRect();
        if (!nativeReadScope.rects.has(node)) nativeReadScope.rects.set(node, node.getBoundingClientRect());
        return nativeReadScope.rects.get(node);
    }

    function nativeFilledSlots(track) {
        if (!nativeReadScope) return netflixDom.filledSlots(track);
        if (!nativeReadScope.filled.has(track)) nativeReadScope.filled.set(track, netflixDom.filledSlots(track));
        return nativeReadScope.filled.get(track);
    }

    function nativeIndicatorItems(section) {
        if (!section) return [];
        if (!nativeReadScope) return [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')];
        if (!nativeReadScope.indicators.has(section)) {
            nativeReadScope.indicators.set(section, [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')]);
        }
        return nativeReadScope.indicators.get(section);
    }

    function detectCarouselDomProfile(section) {
        if (section && nativeReadScope?.profiles.has(section)) return nativeReadScope.profiles.get(section);
        const legacyLeft = section?.querySelector?.('[data-uia="carousel-left-button"]') || null;
        const legacyRight = section?.querySelector?.('[data-uia="carousel-right-button"]') || null;
        const hawkinsLeft = section?.querySelector?.('[data-uia="carousel-hawkins-left-button"]') || null;
        const hawkinsRight = section?.querySelector?.('[data-uia="carousel-hawkins-right-button"]') || null;
        const indicatorItems = nativeIndicatorItems(section);
        const legacyControls = Boolean(legacyLeft || legacyRight);
        const hawkinsControls = Boolean(hawkinsLeft || hawkinsRight);
        const generation = legacyControls && hawkinsControls
            ? 'hybrid'
            : legacyControls
                ? 'generation1'
                : hawkinsControls
                    ? 'generation2'
                    : 'unknown';
        const navigationMode = legacyControls ? 'legacy' : (hawkinsControls ? 'hawkins' : 'none');
        const pageMode = legacyControls && indicatorItems.length > 0 ? 'indicator' :
            ((legacyControls || hawkinsControls) ? 'logical' : 'unknown');
        const profile = {
            generation,
            navigationMode,
            pageMode,
            capabilities: {
                legacyControls,
                hawkinsControls,
                pageIndicators: indicatorItems.length > 0,
                selectedIndicator: indicatorItems.some(x => x.getAttribute('data-indicator-selected') === 'true'),
                virtualSlots: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.virtualSlot)),
                standardCards: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard))
            },
            indicatorCount: indicatorItems.length
        };
        if (section && nativeReadScope) nativeReadScope.profiles.set(section, profile);
        Object.freeze(profile.capabilities);
        return Object.freeze(profile);
    }

    function carouselMoveButton(section, scroller, direction) {
        const profile = readPosition(section)?.profile || detectCarouselDomProfile(section);
        const side = direction < 0 ? 'left' : 'right';
        const selectors = profile.navigationMode === 'legacy'
            ? [`[data-uia="carousel-${side}-button"]`, `[data-uia="carousel-hawkins-${side}-button"]`]
            : [`[data-uia="carousel-hawkins-${side}-button"]`, `[data-uia="carousel-${side}-button"]`];
        for (const selector of selectors) {
            const button = scroller?.querySelector?.(selector) || section?.querySelector?.(selector);
            if (button) return { button, selector };
        }
        return { button: null, selector: selectors.join(' | ') };
    }

    function carouselMoveButtonDisabled(button) {
        if (!button) return false;
        return button.disabled === true ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.getAttribute('tabindex') === '-1';
    }

    function currentPageSlots(scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => currentPageSlots(scroller, track));
        let byTrack = nativeReadScope.slots.get(scroller);
        if (!byTrack) nativeReadScope.slots.set(scroller, byTrack = new WeakMap());
        if (byTrack.has(track)) return byTrack.get(track);
        const all = nativeFilledSlots(track);
        if (!all.length) {
            byTrack.set(track, []);
            return byTrack.get(track);
        }

        const sr = nativeRect(scroller);
        const visible = all
            .map(slot => ({ slot, rect: nativeRect(slot) }))
            .filter(x => {
                const cx = x.rect.left + x.rect.width / 2;
                return x.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            })
            .sort((a, b) => a.rect.left - b.rect.left)
            .map(x => x.slot);

        const active = all.filter(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.getAttribute('tabindex') === '0';
        });
        let current = visible;
        if (active.length) {
            // During Hawkins virtual-window hydration Netflix can leave only
            // the first card tabbable while the remaining visible cards exist.
            // Prefer the complete geometric viewport window in that state.
            if (visible.length <= active.length) current = active.sort((a, b) => nativeRect(a).left - nativeRect(b).left);
        }

        byTrack.set(track, current);
        return current;
    }

    function visibleSignature(slots) { return readCardSignature(slots, NETFLIX_DOM_SELECTORS.standardCard); }

    function nativeCarouselReadiness(section, scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeCarouselReadiness(section, scroller, track));
        const slots = netflixDom.directSlots(track);
        const cards = nativeFilledSlots(track);
        const currentSlots = currentPageSlots(scroller, track);
        const pages = pageCount(section);
        const formula = layoutMeasurements.formula(track);
        const columns = Math.max(1, formula?.columns || currentSlots.length || cards.length || 1);
        const runtime = readPosition(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const leftControl = carouselMoveButton(section, scroller, -1).button;
        const rightControl = carouselMoveButton(section, scroller, 1).button;
        const controlsPresent = Boolean(leftControl || rightControl);
        const controlsEnabled =
            leftControl?.getAttribute('tabindex') === '0' ||
            rightControl?.getAttribute('tabindex') === '0';
        const inlineTransform = track.style.getPropertyValue('transform') || '';
        const inlineDisplay = track.style.getPropertyValue('display') || '';
        const inlineWillChange = track.style.getPropertyValue('will-change') || '';
        const trackInitialized =
            inlineDisplay === 'flex' ||
            (inlineTransform && inlineTransform !== 'none') ||
            /\btransform\b/i.test(inlineWillChange);
        const signature = [
            pages,
            slots.length,
            cards.length,
            currentSlots.length,
            columns,
            controlsPresent ? 1 : 0,
            controlsEnabled ? 1 : 0,
            trackInitialized ? 1 : 0,
            profile.generation,
            profile.navigationMode,
            profile.pageMode,
            visibleSignature(currentSlots)
        ].join('||');

        return {
            connected: section.isConnected && scroller.isConnected && track.isConnected,
            pages,
            slots: slots.length,
            cards: cards.length,
            currentCards: currentSlots.length,
            columns,
            controlsPresent,
            controlsEnabled,
            trackInitialized,
            domGeneration: profile.generation,
            navigationMode: profile.navigationMode,
            pageMode: profile.pageMode,
            capabilities: { ...profile.capabilities },
            signature
        };
    }

    function readNativeMyListDomState() {
        if (!nativeReadScope) return withNativeReadScope(() => readNativeMyListDomState());
        if (nativeReadScope.domState) return nativeReadScope.domState;
        const section = findMyListSection();
        if (!section) {
            const graphqlCount = listData.readMyListTotalCount();
            return nativeReadScope.domState = {
                section: null,
                scroller: null,
                track: null,
                pages: 0,
                selectedPage: 0,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: null,
                graphqlCount,
                exactCount: Number.isFinite(graphqlCount) ? graphqlCount : null,
                fingerprint: `none|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = scroller && netflixDom.findTrack(scroller);
        const runtime = readPosition(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const page = selectedPage(section);
        const pages = pageCount(section);
        const pageTopologyKnown = profile.pageMode === 'indicator'
            ? profile.indicatorCount > 0
            : Boolean(runtime?.pageCountFinalized);
        const graphqlCount = listData.readMyListTotalCount();

        if (!scroller || !track) {
            return nativeReadScope.domState = {
                section,
                scroller: scroller || null,
                track: track || null,
                pages,
                selectedPage: page,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: pageTopologyKnown && pages === 1 ? 0 : null,
                graphqlCount,
                exactCount: pageTopologyKnown && pages === 1 ? 0 : (Number.isFinite(graphqlCount) ? graphqlCount : null),
                fingerprint: `${pages}|${page}|0|0||${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const current = currentPageSlots(scroller, track);
        const identities = current.map(nativeCardIdentity).filter(Boolean);
        const uniqueIdentities = [...new Set(identities)];
        const pageSignature = uniqueIdentities.join('|');
        const domExactCount = pageTopologyKnown && pages === 1 ? uniqueIdentities.length : null;
        // For one-page lists the live DOM is authoritative. Netflix's GraphQL cache can
        // remain stale after an in-page add/remove, so only use GraphQL as a fallback.
        const exactCount = Number.isFinite(domExactCount)
            ? domExactCount
            : (Number.isFinite(graphqlCount) ? graphqlCount : null);
        const sourceSlots = netflixDom.directSlots(track).length;
        const sourceCards = nativeFilledSlots(track).length;

        return nativeReadScope.domState = {
            section,
            scroller,
            track,
            pages,
            selectedPage: page,
            pageSignature,
            pageTopologyKnown,
            currentPageCount: uniqueIdentities.length,
            sourceSlots,
            sourceCards,
            domExactCount,
            graphqlCount,
            exactCount,
            fingerprint: `${pages}|${page}|${uniqueIdentities.length}|${sourceSlots}|${sourceCards}|${pageSignature}|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
        };
    }

    function nativeReactCarouselTotalCount(scroller, track) {
        const slots = currentPageSlots(scroller, track);
        const readings = slots.map(slot => netflixReactCarousel.readCarouselTotalCount(slot));
        const finiteReadings = readings.filter(value => Number.isSafeInteger(value) && value >= 0);
        const unique = [...new Set(finiteReadings)];
        return {
            totalCount: unique.length === 1 ? unique[0] : null,
            readings,
            slots: slots.length,
            uniqueReadings: unique
        };
    }

    function requireNativeReactCarouselTotalCount(scroller, track, provisionalTotalCount = null, assertCurrent = () => {}) {
        const state = nativeReactCarouselTotalCount(scroller, track);
        assertCurrent();
        if (Number.isSafeInteger(state.totalCount) && state.totalCount >= 0) return state;
        throw initializationError(
            'NATIVE_TOTAL_COUNT_UNAVAILABLE',
            'native-react-total-count',
            'Could not read a consistent Netflix My List totalCount from the mounted carousel',
            {
                provisionalTotalCount,
                slots: state.slots,
                readings: state.readings,
                uniqueReadings: state.uniqueReadings
            }
        );
    }

    function netflixItemIndexFromSlot(slot) {
        if (!nativeReadScope || !slot) return netflixReactCarousel.readItemIndex(slot).value;
        if (!nativeReadScope.indices.has(slot)) {
            nativeReadScope.indices.set(slot, netflixReactCarousel.readItemIndex(slot).value);
        }
        return nativeReadScope.indices.get(slot);
    }

    function logicalSlotPositions(slots, totalCount) {
        return slots.map(slot => {
            const itemIndex = netflixItemIndexFromSlot(slot);
            return {
                slot,
                itemIndex,
                logicalIndex: normalizeNetflixLogicalIndex(itemIndex, totalCount)
            };
        });
    }

    function nativeLogicalPageState(scroller, track, totalCount, columns) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeLogicalPageState(scroller, track, totalCount, columns));
        const slots = currentPageSlots(scroller, track);
        const positions = logicalSlotPositions(slots, totalCount);
        const page = logicalPageFromSlotPositions(positions, totalCount, columns);
        return {
            slots,
            positions,
            page,
            itemIndices: positions.map(position => position.itemIndex),
            logicalIndices: positions.map(position => position.logicalIndex)
        };
    }

    function requireNativeLogicalPageState(scroller, track, totalCount, columns, stage = 'logical-item-index-detection') {
        const state = nativeLogicalPageState(scroller, track, totalCount, columns);
        if (state.positions.length && state.positions.every(position => Number.isSafeInteger(position.itemIndex)) && Number.isFinite(state.page)) {
            return state;
        }
        logVirtualRawIndexDiagnostic(state.slots, totalCount, columns, stage);
        throw initializationError(
            'NATIVE_LOGICAL_INDEX_UNAVAILABLE',
            stage,
            'Could not read a complete Netflix itemIndex page from the current My List carousel',
            {
                totalCount,
                columns,
                slots: state.slots.length,
                itemIndices: state.itemIndices,
                logicalIndices: state.logicalIndices,
                resolvedPage: state.page
            }
        );
    }

    function viewportPageSlots(scroller, track, columns = 1) {
        return withNativeReadScope(() => {
            const all = nativeFilledSlots(track);
            if (!all.length) return [];
            const count = Math.max(1, columns || 1);
            const sr = nativeRect(scroller);
            const visible = all.map(slot => ({ slot, rect: nativeRect(slot) })).filter(entry => {
                const cx = entry.rect.left + entry.rect.width / 2;
                return entry.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            }).sort((a, b) => a.rect.left - b.rect.left).map(entry => entry.slot);
            return visible.length ? visible.slice(0, count) : currentPageSlots(scroller, track).slice()
                .sort((a, b) => nativeRect(a).left - nativeRect(b).left).slice(0, count);
        });
    }
    function cachedLayout(section, scroller, track, kind, read) {
        let entries = nativeReadScope.layouts.get(section);
        if (!entries) nativeReadScope.layouts.set(section, entries = []);
        const prior = entries.find(entry => entry.scroller === scroller && entry.track === track && entry.kind === kind);
        if (prior) return prior.facts;
        const facts = read();
        entries.push({ scroller, track, kind, facts });
        return facts;
    }

    function currentPageVideoIds(scroller, track) {
        return currentPageSlots(scroller, track)
            .map(slot => {
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                return card ? netflixDom.videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
            })
            .filter(Boolean);
    }

    function slotDescriptor(slot, totalCount = undefined) {
        try {
            if (!slot) return null;
            if (totalCount === undefined) totalCount = readDiagnosticTotalCount();
            const card = slot.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
            const href = card?.href || card?.getAttribute?.('href') || '';
            const itemIndex = netflixItemIndexFromSlot(slot);
            const rect = slot.getBoundingClientRect ? nativeRect(slot) : null;
            const rectangle = rect ? Object.freeze(Object.fromEntries(['left', 'top', 'width', 'height', 'right', 'bottom']
                .map(key => [key, Math.round(rect[key] * 10) / 10]))) : null;
            return Object.freeze({ slot: slot.getAttribute?.('data-virtual-slot') || '', itemIndex,
                logicalIndex: normalizeNetflixLogicalIndex(itemIndex, totalCount), videoId: netflixDom.videoIdFromHref(href), href,
                ariaLabel: card?.getAttribute?.('aria-label') || '', tabindex: card?.getAttribute?.('tabindex') || '',
                connected: Boolean(slot.isConnected), inlineTransform: slot.style?.getPropertyValue?.('transform') || '', rect: rectangle });
        } catch (_) { return null; }
    }
    return Object.freeze({
        withNativeReadScope, invalidateNativeReadScope, nativeRect, nativeFilledSlots,
        nativeIndicatorItems, detectCarouselDomProfile, carouselMoveButton, carouselMoveButtonDisabled,
        currentPageSlots, visibleSignature, nativeCarouselReadiness, readNativeMyListDomState,
        nativeReactCarouselTotalCount, requireNativeReactCarouselTotalCount, netflixItemIndexFromSlot, logicalSlotPositions,
        nativeLogicalPageState, requireNativeLogicalPageState, viewportPageSlots, cachedLayout, currentPageVideoIds, slotDescriptor,
        active: () => Boolean(nativeReadScope), clear: () => { nativeReadScope = null; } });
}
