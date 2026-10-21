import { wrappedTailLogicalPageInfo } from './page-model.js';
import { SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS, ORIGINAL_VISIBILITY_ATTR } from '../../dom-names.js';

// Observations register their own proofs and validate captured material before transfer.
export function createObservations({ scope, window, initializationError, assertRouteSession,
    readBindingGeneration, readAcceptedBinding, observationOperation, assertBinding, isBindingCurrent,
    findMyListSection, netflixDom, NETFLIX_DOM_SELECTORS, cardMarkup, layoutMeasurements,
    withNativeReadScope, cachedLayout, nativeRect, nativeFilledSlots, currentPageSlots, viewportPageSlots,
    readNativeMyListDomState, selectedPage, pageCount, requireNativeReactCarouselTotalCount,
    nativeReactCarouselTotalCount, nativeCarouselReadiness, logicalSlotPositions, sourceHandle, assertSource, carouselDomProfileSummary }) {
    const observationTickets = new WeakMap();
    function observationResult(operation, facts, validate = () => {}) {
        operation.guard(); validate(); operation.guard();
        const result = Object.freeze(facts);
        observationTickets.set(result, { operation, validate });
        return result;
    }
    function assertObservation(result) {
        const ticket = observationTickets.get(result);
        if (ticket) {
            return withNativeReadScope(() => {
                ticket.operation.guard();
                ticket.operation.refresh?.();
                ticket.operation.guard();
                ticket.validate(); ticket.operation.guard();
                return result;
            });
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native observation is no longer current');
    }
    function isObservationCurrent(result) {
        try { assertObservation(result); return true; } catch (_) { return false; }
    }
    function discoverSource({ bindingOnly = false, sessionToken = null, assertCurrent = () => {} } = {}) {
        return withNativeReadScope(() => {
            const generation = readBindingGeneration(), route = scope.token;
            const guard = () => {
                assertRouteSession(sessionToken); assertCurrent();
                if (generation !== readBindingGeneration() || route !== scope.token) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Discovery admission changed');
                }
            };
            const references = () => {
                const section = findMyListSection();
                const scroller = section?.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) || null;
                const track = scroller && netflixDom.findTrack(scroller);
                return { section: section || null, scroller, track: track || null };
            };
            guard();
            const facts = bindingOnly ? references() : readNativeMyListDomState();
            const matchesBinding = Boolean(readAcceptedBinding() && isBindingCurrent(readAcceptedBinding()) &&
                ['section', 'scroller', 'track'].every(key => readAcceptedBinding()[key] === facts[key]));
            return observationResult({ binding: { section: facts.section }, guard }, { ...facts, matchesBinding }, () => {
                const currentReferences = references();
                const current = bindingOnly ? currentReferences : readNativeMyListDomState();
                const changedFields = Object.keys(facts).filter(key => !Object.is(facts[key], current[key]));
                if (changedFields.length || ['section', 'scroller', 'track'].some(key => facts[key] !== currentReferences[key]) ||
                    facts.section?.isConnected === false || facts.scroller?.isConnected === false || facts.track?.isConnected === false) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Observed My List source changed', { changedFields });
                }
            });
        });
    }
    function captureMountedItem({ discovery, videoId }) {
        return withNativeReadScope(() => {
            assertObservation(discovery);
            if (!discovery.track) return null;
            let item = null;
            try {
                for (const slot of netflixDom.directSlots(discovery.track)) {
                    item = cardMarkup.capture(slot, discovery.selectedPage || 0, false);
                    assertObservation(discovery);
                    if (item?.videoId !== String(videoId)) continue;
                    const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const assertCapturedSlot = () => {
                        const current = cardMarkup.capture(slot, discovery.selectedPage || 0, false);
                        if (slot.isConnected === false || slot.parentElement !== discovery.track ||
                            slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) !== card ||
                            !current || ['href', 'videoId', 'ariaLabel'].some(key => current[key] !== item[key])) {
                            throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Captured native card changed');
                        }
                        assertObservation(discovery);
                    };
                    assertCapturedSlot();
                    item.snapshot = slot.cloneNode(true);
                    assertCapturedSlot();
                    return item;
                }
                assertObservation(discovery);
                return null;
            } catch (error) {
                if (item) item.snapshot = null;
                throw error;
            }
        });
    }
    function measureLayout({ section, scroller = null, track = null, mode = 'auto', binding = null,
        sessionToken = null, assertCurrent = () => {} }) {
        return withNativeReadScope(() => {
            const generation = readBindingGeneration(), route = scope.token;
            const guard = () => {
                assertRouteSession(sessionToken); assertCurrent();
                if (!section || section.isConnected === false || scroller?.isConnected === false || track?.isConnected === false ||
                    readBindingGeneration() !== generation || scope.token !== route) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Native layout admission changed');
                }
                if (binding) {
                    assertBinding(binding);
                    if (binding.section !== section || (scroller && binding.scroller !== scroller) || (track && binding.track !== track)) {
                        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Layout binding does not match its source');
                    }
                }
            };
            guard();
            const kind = mode === 'auto' ? (scroller && track ? 'visible' : 'empty') : mode;
            const read = () => {
                return cachedLayout(section, scroller, track, kind, () => {
                const rect = nativeRect(section);
                const bounds = Object.freeze(Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height']
                    .map(key => [key, rect[key]])));
                const layout = kind === 'bounds' ? null : kind === 'visible'
                    ? layoutMeasurements.visible(section, scroller, track) : layoutMeasurements.empty(section);
                const facts = { bounds, viewportWidth: window.innerWidth,
                    ...(layout ? { layout: Object.freeze({ ...layout }) } : {}) };
                return facts;
                });
            };
            const facts = read();
            const same = (left, right) => Boolean(left && right && Object.keys(left).length === Object.keys(right).length &&
                Object.keys(left).every(key => Object.is(left[key], right[key])));
            return observationResult({ binding: { section }, guard }, { ...facts }, () => {
                const current = read();
                if (window.innerWidth !== facts.viewportWidth || !same(current.bounds, facts.bounds) ||
                    (facts.layout && !same(current.layout, facts.layout))) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Observed native layout changed');
                }
            });
        });
    }
    function observeSource(options) {
        return withNativeReadScope(() => {
            const operation = observationOperation(options), runtime = operation.model.view;
            const attempts = runtime.logicalRemapRetryCount;
            const position = options.position ? Object.freeze({ page: selectedPage(operation.binding.section),
                pages: pageCount(operation.binding.section) }) : null;
            const count = options.count === 'required'
                ? requireNativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track,
                    options.provisionalTotalCount ?? null, operation.guard)
                : options.count === 'optional' ? nativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track) : null;
            const countFacts = count ? Object.freeze({ ...count, readings: Object.freeze([...count.readings]),
                uniqueReadings: Object.freeze([...count.uniqueReadings]) }) : null;
            const readinessState = options.readiness ? nativeCarouselReadiness(operation.binding.section,
                operation.binding.scroller, operation.binding.track) : null;
            const readiness = readinessState ? Object.freeze({ ...readinessState,
                capabilities: Object.freeze({ ...readinessState.capabilities }) }) : null;
            const presentationFacts = () => ({
                parked: Boolean(operation.binding.scroller?.classList?.contains(SOURCE_PARKED_CLASS)),
                hidden: operation.binding.section?.getAttribute(ORIGINAL_VISIBILITY_ATTR) === 'false'
            });
            const presentation = options.presentation ? Object.freeze(presentationFacts()) : null;
            return observationResult(operation, { mode: runtime.profile.pageMode,
                needsRemapping: Boolean(runtime.pageMappingStale), remapAttempts: attempts,
                ...(countFacts ? { count: countFacts } : {}), ...(position ? { position } : {}),
                ...(readiness ? { readiness } : {}), ...(presentation ? { presentation } : {}) }, () => {
                if (runtime.logicalRemapRetryCount !== attempts) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Native remapping observation changed');
                if (position && (selectedPage(operation.binding.section) !== position.page ||
                    pageCount(operation.binding.section) !== position.pages)) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native position observation changed');
                }
                if (countFacts) {
                    const current = nativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track);
                    if (current.totalCount !== countFacts.totalCount || current.slots !== countFacts.slots ||
                        current.readings.length !== countFacts.readings.length ||
                        !current.readings.every((value, index) => Object.is(value, countFacts.readings[index]))) {
                        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native count observation changed');
                    }
                }
                if (readiness) {
                    const current = nativeCarouselReadiness(operation.binding.section, operation.binding.scroller, operation.binding.track);
                    if (current.signature !== readiness.signature || current.connected !== readiness.connected ||
                        Object.keys(current.capabilities).length !== Object.keys(readiness.capabilities).length ||
                        Object.keys(readiness.capabilities).some(key => current.capabilities[key] !== readiness.capabilities[key])) {
                        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native readiness observation changed');
                    }
                }
                if (presentation) {
                    const current = presentationFacts();
                    if (current.parked !== presentation.parked || current.hidden !== presentation.hidden) {
                        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native presentation observation changed');
                    }
                }
            });
        });
    }

    function pageCards(options) {
        return withNativeReadScope(() => {
            const operation = observationOperation(options);
            const { section, scroller, track } = operation.binding;
            const page = selectedPage(section);
            operation.guard();
            if (Number.isFinite(options.page) && options.page !== page) throw initializationError('NATIVE_SOURCE_REPLACED',
                'native-observation', 'Mounted native page changed before preparation');
            const columns = Math.max(1, options.columns || 1);
            const viewport = options.window === 'viewport', wantsTemplate = Boolean(options.template);
            const readSlots = () => viewport ? viewportPageSlots(scroller, track, columns) : currentPageSlots(scroller, track);
            const slots = readSlots().slice();
            const mode = operation.model.view.profile.pageMode;
            const tail = mode === 'logical'
                ? wrappedTailLogicalPageInfo(logicalSlotPositions(slots, options.totalCount || 0), options.totalCount || 0, columns) : null;
            const revision = operation.model.revision;
            const cards = Object.freeze(slots.map((slot, index) => Object.freeze({ source: sourceHandle(operation.binding, slot, page),
                inPage: !(tail && tail.page === page && index >= tail.wrapIndex) })));
            const signature = cards.map(entry => entry.source.href).filter(Boolean).join('|');
            const templateSlot = wantsTemplate ? slots[0] || nativeFilledSlots(track)[0] || null : null;
            const template = templateSlot ? cards[0]?.source || sourceHandle(operation.binding, templateSlot, page) : null;
            return observationResult(operation, { page, mode, cards, signature, ...(wantsTemplate ? { template } : {}) }, () => {
                if (selectedPage(section) !== page || operation.model.revision !== revision) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Observed native page mapping changed');
                const current = readSlots();
                if (current.length !== slots.length || current.some((slot, index) => slot !== slots[index])) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Observed native card window changed');
                }
                if (wantsTemplate && (current[0] || nativeFilledSlots(track)[0] || null) !== templateSlot) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native template selection changed');
                }
                for (const entry of cards) assertSource(entry.source);
                if (template) assertSource(template);
            });
        });
    }


    function sourceDescription(source) {
        try {
            let { section, scroller = null, track = null } = source || {};
            if (source?.discover) {
                section ||= findMyListSection();
                scroller ||= section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller) || null;
                track ||= (scroller && netflixDom.findTrack(scroller)) || null;
            }
            if (!section) return null;
            const page = selectedPage(section), pages = pageCount(section);
            const profile = carouselDomProfileSummary(section);
            return Object.freeze({ selectedPage: page, pageCount: pages,
                carouselDom: profile && Object.freeze({ ...profile, capabilities: Object.freeze({ ...profile.capabilities }) }),
                sourceSlots: track ? netflixDom.directSlots(track).length : 0,
                sourceCards: track ? nativeFilledSlots(track).length : 0,
                currentPageCards: scroller && track ? currentPageSlots(scroller, track).length : 0,
                sourceScan: Boolean(scroller?.classList?.contains(SOURCE_SCAN_CLASS)),
                sourceParked: Boolean(scroller?.classList?.contains(SOURCE_PARKED_CLASS)) });
        } catch (_) { return null; }
    }
    return Object.freeze({ sourceDescription, observeSource, pageCards, measureLayout, discoverSource, captureMountedItem,
        assertObservation, isObservationCurrent });
}
