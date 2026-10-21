import { createNativeReadings } from './native-readings.js';
import { createSourceResolution } from './source-resolution.js';
import { createObservations } from './observations.js';
import { createPageModel, createPageHints, wrappedTailLogicalPageForRebuild } from './page-model.js';
import { NETFLIX_DOM_SELECTORS as DEFAULT_SELECTORS } from '../page-dom.js';
import { createReadiness } from './readiness.js';
import { createDiscovery } from './discovery.js';
import { createNavigation } from './navigation.js';
import { createCollection } from './collection.js';
import { createReactReadings } from './react-readings.js';
import { createSourcePresentation } from './source-presentation.js';
import { createLayout } from './layout.js';
import { GRID_ID as DEFAULT_GRID_ID, STATUS_ID as DEFAULT_STATUS_ID, LEGACY_EMPTY_STATE_ID as DEFAULT_EMPTY_ID,
    ORDER_MISMATCH_DIALOG_ID as DEFAULT_DIALOG_ID, FAST_MOVE_CLASS } from '../../dom-names.js';

// Native binding and mapping are owned here. Composition supplies interpreted
// membership shape and lifecycle operations, never a mutable feature state bag.
export function createCarousel({ pageDom: netflixDom, scope, document, window, Element, getComputedStyle,
    performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    readListShape = () => null, readGraphqlCount = () => null, createError: initializationError,
    log = () => {}, warn = () => {}, trace = () => {}, tLog = value => value, logTimeout: logOperationTimeout = () => {},
    ownedUi = {}, MutationObserver,
    checkRoute = () => {}, onMutationDelivery = () => {}, isInitializationBlocked = () => false,
    onBlockedMutation = () => {}, isGridDetached = () => false, shouldCoalesce = () => false,
    onRelevantMutation = () => {}, isHoverCancelled = () => false, readHoverToken = () => null,
    navigationDiagnostics = () => ({ bump() {}, record: null }), cardMarkup }) {
    const NETFLIX_DOM_SELECTORS = netflixDom.selectors || DEFAULT_SELECTORS;
    const GRID_ID = ownedUi.grid || DEFAULT_GRID_ID, STATUS_ID = ownedUi.status || DEFAULT_STATUS_ID;
    const LEGACY_EMPTY_STATE_ID = ownedUi.empty || DEFAULT_EMPTY_ID, ORDER_MISMATCH_DIALOG_ID = ownedUi.dialog || DEFAULT_DIALOG_ID;
    const findMyListSection = (...args) => netflixDom.findMyListSection(...args);
    const nativeCardIdentity = (...args) => netflixDom.nativeCardIdentity(...args);
    const listData = { readMyListTotalCount: readGraphqlCount };
    const assertRouteSession = token => scope.assertCurrent(token);
    let models = new WeakMap();
    let acceptedBinding = null;
    let bindingGeneration = 0;
    const bindingTickets = new WeakMap();
    const mappingTickets = new WeakMap();
    const preparationTickets = new WeakMap();
    let preparationOwner = null;
    let mappingSequence = 0;
    const netflixReactCarousel = createReactReadings({ cardSelector: NETFLIX_DOM_SELECTORS.standardCard, Element });
    const readings = createNativeReadings({ netflixDom, NETFLIX_DOM_SELECTORS, netflixReactCarousel,
        readPosition(section) {
            const runtime = getCarouselDomRuntime(section);
            const profile = runtime?.profile || detectCarouselDomProfile(section);
            return { profile, pageCountFinalized: runtime?.pageCountFinalized };
        }, pageCount, selectedPage, findMyListSection, nativeCardIdentity, listData,
        layoutFormula: track => layoutMeasurements.formula(track), initializationError, logVirtualRawIndexDiagnostic,
        readDiagnosticTotalCount: () => acceptedBinding ? readListShape(acceptedBinding.section)?.totalCount : null });
    const {
        withNativeReadScope, invalidateNativeReadScope, nativeRect, nativeFilledSlots,
        nativeIndicatorItems, detectCarouselDomProfile, carouselMoveButton, carouselMoveButtonDisabled,
        currentPageSlots, visibleSignature, nativeCarouselReadiness,
        nativeReactCarouselTotalCount, netflixItemIndexFromSlot,
        nativeLogicalPageState, requireNativeLogicalPageState, viewportPageSlots, currentPageVideoIds, slotDescriptor } = readings;
    const layoutMeasurements = createLayout({ pageDom: netflixDom, window, getComputedStyle,
        readRect: nativeRect, readFilledSlots: nativeFilledSlots, cardSelector: NETFLIX_DOM_SELECTORS.standardCard });
    const sourcePresentation = createSourcePresentation({ document, pageDom: netflixDom, scope,
        generation: () => bindingGeneration, invalidateReads: invalidateNativeReadScope, createError: initializationError, warn });
    const discovery = createDiscovery({ document, scope, MutationObserver, requestAnimationFrame, cancelAnimationFrame,
        findSection: findMyListSection, browseSectionsSelector: NETFLIX_DOM_SELECTORS.browseSections,
        uiIds: { grid: GRID_ID, status: STATUS_ID, empty: LEGACY_EMPTY_STATE_ID, dialog: ORDER_MISMATCH_DIALOG_ID },
        checkRoute, onMutationDelivery, isInitializationBlocked, onBlockedMutation,
        isGridDetached, shouldCoalesce, onRelevantMutation });
    const readinessPolling = createReadiness({ scope, performance, setTimeout, clearTimeout,
        requestAnimationFrame, cancelAnimationFrame, log, warn, tLog, logTimeout: logOperationTimeout,
        native: { borrowBinding, isBindingCurrent, readiness: nativeCarouselReadiness,
            findSection: findMyListSection, findScroller: section => section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller),
            findTrack: scroller => netflixDom.findTrack(scroller) } });
    const navigation = createNavigation({ borrowBinding, assertBinding, createError: initializationError,
        bindingForSource: (scroller, track) => borrowBinding(acceptedBinding?.section || null, scroller, track),
        fastMoveClass: ownedUi.fastMove || FAST_MOVE_CLASS, scope, performance, getComputedStyle,
        setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, MutationObserver,
        cardSelector: NETFLIX_DOM_SELECTORS.standardCard,
        videoIdFromHref: href => netflixDom.videoIdFromHref(href), isHoverCancelled, readHoverToken,
        diagnosticsFor: navigationDiagnostics, log, warn, tLog, logTimeout: logOperationTimeout,
        native: { model: getCarouselDomRuntime, profile: detectCarouselDomProfile,
            registerPage: registerLogicalPageSignature, selectedPage, pageCount,
            navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
            currentSlots: currentPageSlots, signatureOf: visibleSignature,
            notePage: (section, page, cycle) => modelForWrite(section)?.notePage(page, cycle),
            track: scroller => acceptedBinding?.scroller === scroller && acceptedBinding.track?.isConnected
                ? acceptedBinding.track : netflixDom.findTrack(scroller) } });
    const collection = createCollection({ scope, performance, requestAnimationFrame, cancelAnimationFrame,
        navigation, captureItem: (...args) => cardMarkup.capture(...args),
        videoIdFromHref: href => netflixDom.videoIdFromHref(href), cardSelector: NETFLIX_DOM_SELECTORS.standardCard,
        createError: initializationError, log, warn, tLog, logTimeout: logOperationTimeout,
        native: { borrowBinding, assertBinding, isBindingCurrent, model: getCarouselDomRuntime,
            sample: withNativeReadScope, readiness: nativeCarouselReadiness,
            readCount: nativeReactCarouselTotalCount, itemIndex: netflixItemIndexFromSlot, cardIdentity: nativeCardIdentity,
            matchesMountedSource: (section, scroller, track) => findMyListSection() === section &&
                section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) === scroller && netflixDom.findTrack(scroller) === track,
            resetModel: resetCarouselDomRuntime, profile: detectCarouselDomProfile,
            profileSummary: carouselDomProfileSummary, currentSlots: currentPageSlots, signatureOf: visibleSignature,
            selectedPage, pageCount, logicalWindow: nativeLogicalPageState,
            requireLogicalWindow: requireNativeLogicalPageState, forcePage: forceLogicalPageSignature,
            navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
            suppressMotion: navigation.suppress,
            beginCollection: section => modelForWrite(section)?.beginCollection(),
            notePage: (section, page) => modelForWrite(section)?.notePage(page),
            markCycle: section => modelForWrite(section)?.markCycle(),
            completeCollection: (section, pages) => modelForWrite(section)?.finishCollection(pages) } });
    const resolution = createSourceResolution({ scope, performance, setTimeout, clearTimeout, initializationError,
        netflixDom, NETFLIX_DOM_SELECTORS, borrowBinding, assertBinding, isBindingCurrent, assertRouteSession,
        captureCardAuthority, captureResolutionAuthority, readRuntime: section => ({ profile: getCarouselDomRuntime(section)?.profile }), registerLogicalPageSignature,
        navigation, isHoverCancelled, readHoverToken, log, warn, trace, tLog, slotDescriptor,
        withNativeReadScope, currentPageSlots, nativeFilledSlots, nativeIndicatorItems, netflixItemIndexFromSlot,
        selectedPage, pageCount, detectCarouselDomProfile, visibleSignature, viewportPageSlots, currentPageVideoIds });
    const { anchorPageZero, resolveCard, mountedCard, isSourceCurrent, assertSource, sourceHandle, resetMountedWaits } = resolution;
    const observations = createObservations({ scope, window, initializationError, assertRouteSession,
        readBindingGeneration: () => bindingGeneration, readAcceptedBinding: () => acceptedBinding,
        observationOperation, assertBinding, isBindingCurrent, findMyListSection, netflixDom, NETFLIX_DOM_SELECTORS,
        cardMarkup, layoutMeasurements, ...readings, selectedPage, pageCount, sourceHandle, assertSource,
        carouselDomProfileSummary });
    const { observeSource, pageCards, measureLayout, discoverSource, captureMountedItem, assertObservation, isObservationCurrent, sourceDescription } = observations;
    function captureCardAuthority(section) {
        const model = getModel(section), revision = model.revision;
        const current = () => models.get(section) === model && model.revision === revision;
        return Object.freeze({ current, refresh: () => getModel(section) === model && current(),
            profile: () => model.view.profile });
    }
    function captureResolutionAuthority(section) {
        const model = getModel(section), generation = model.mappingGeneration;
        return () => {
            if (models.get(section) !== model || model.mappingGeneration !== generation) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-resolution', 'Native page mapping changed during source resolution');
            }
        };
    }
    function observationOperation({ section, scroller = null, track = null, binding = null, source = null,
        sessionToken = null, assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        binding ||= borrowBinding(section, scroller, track);
        assertBinding(binding);
        if (binding.section !== section || (scroller && binding.scroller !== scroller) || (track && binding.track !== track)) {
            throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Observation binding does not match its source');
        }
        const model = getModel(section), generation = model.mappingGeneration;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (models.get(section) !== model || model.mappingGeneration !== generation) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Observed native interpretation changed');
            }
            if (source) {
                resolution.assertSourceBinding(source, section, scroller, track);
            }
        };
        guard();
        return { binding, guard, refresh: () => getModel(section), model: Object.freeze({
            get revision() { return model.revision; }, view: Object.freeze({
                get profile() { return model.view.profile; },
                get logicalRemapRetryCount() { return model.view.logicalRemapRetryCount; },
                get pageMappingStale() { return model.view.pageMappingStale; }
            }) }) };
    }
    function mappingOperation({ section, scroller, track, sessionToken = null, totalCount, columns,
        assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        let model = getModel(section), generation = model.mappingGeneration;
        // A newer remap supersedes an older one even when markStale is idempotent.
        const sequence = ++mappingSequence;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (sequence !== mappingSequence || models.get(section) !== model || model.mappingGeneration !== generation) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-remapping', 'Native mapping owner changed during remapping');
            }
        };
        guard();
        return { binding, totalCount, columns: Math.max(1, columns || 1), guard,
            get model() { return model; },
            write(callback) { guard(); callback(model); generation = model.mappingGeneration; guard(); },
            commit(facts) {
                guard();
                const replacement = createPageModel(model.view.profile);
                replacement.commit(facts);
                models.set(section, replacement); model = replacement; generation = model.mappingGeneration;
                invalidateNativeReadScope(); guard();
            } };
    }
    function mappingResult(operation, status, facts = {}) {
        operation.guard();
        const runtime = operation.model.view;
        const result = Object.freeze({ status, reason: null, countConverged: false,
            totalCount: operation.totalCount, columns: operation.columns,
            currentPage: runtime.currentPage, knownPageCount: runtime.knownPageCount,
            pageCountFinalized: runtime.pageCountFinalized, pageMappingStale: runtime.pageMappingStale,
            retryCount: runtime.logicalRemapRetryCount, visibleSignature: '', ...facts,
            visibleIds: Object.freeze([...(facts.visibleIds || [])]),
            itemIndices: Object.freeze([...(facts.itemIndices || [])]),
            logicalIndices: Object.freeze([...(facts.logicalIndices || [])]) });
        mappingTickets.set(result, { operation, revision: operation.model.revision });
        return result;
    }
    function assertMapping(result) {
        const ticket = mappingTickets.get(result);
        if (ticket) {
            ticket.operation.guard();
            getModel(ticket.operation.binding.section);
            ticket.operation.guard();
            if (ticket.operation.model.revision === ticket.revision) return result;
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-remapping', 'Native mapping observation is no longer current');
    }
    function isMappingCurrent(result) {
        try { assertMapping(result); return true; } catch (_) { return false; }
    }
    function anchorMappingAfterDelta(options) {
        return withNativeReadScope(() => {
            const operation = mappingOperation(options);
            const { section, scroller, track } = operation.binding;
            if (operation.model.view.profile.pageMode !== 'logical') return mappingResult(operation, 'not-applicable');
            const pages = Math.max(1, Math.ceil(Math.max(operation.totalCount, 1) / operation.columns));
            const slots = currentPageSlots(scroller, track), signature = visibleSignature(slots);
            const votes = new Map();
            for (const slot of slots) {
                operation.guard();
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const id = card ? netflixDom.videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
                const page = id ? options.pageHintForVideoId?.(id) : null;
                operation.guard();
                if (Number.isFinite(page)) votes.set(page, (votes.get(page) || 0) + 1);
            }
            const nativePage = nativeLogicalPageState(scroller, track, operation.totalCount, operation.columns);
            operation.guard();
            let page = Number.isFinite(nativePage.page) ? nativePage.page : operation.model.view.currentPage || 0;
            if (!Number.isFinite(nativePage.page) && votes.size) {
                page = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
            }
            page = Math.max(0, Math.min(pages - 1, page));
            operation.write(model => model.anchor({ pageCount: pages, currentPage: page, signature }));
            return mappingResult(operation, 'anchored', { visibleSignature: signature,
                visibleIds: currentPageVideoIds(scroller, track), itemIndices: nativePage.itemIndices, logicalIndices: nativePage.logicalIndices });
        });
    }
    async function rebuildMappingFromNativePosition(options) {
        const operation = withNativeReadScope(() => mappingOperation(options));
        const { section, scroller, track } = operation.binding;
        const { totalCount, columns } = operation;
        const reason = options.reason || 'responsive-remap';
        if (operation.model.view.profile.pageMode !== 'logical') return mappingResult(operation, 'not-applicable');
        operation.write(model => model.markStale());
        let motionLease = null;
        try {
            await navigation.whenIdle();
            operation.guard();
            return withNativeReadScope(() => {
                getModel(section); operation.guard();
                motionLease = navigation.suppress(section, track);
                operation.guard();
                const runtime = operation.model.view;
                const count = nativeReactCarouselTotalCount(scroller, track);
                operation.guard();
                const countConverged = Number.isSafeInteger(count.totalCount) && count.totalCount === totalCount;
                if (!count.uniqueReadings.length || !countConverged) {
                    operation.write(model => model.deferMapping());
                    log('Logical My List page-model rebuild deferred until native delta converges', {
                        reason, legacyTotalCount: totalCount, nativeTotalCount: count.totalCount,
                        readings: count.readings, uniqueReadings: count.uniqueReadings,
                        selectedPage: selectedPage(section), pageMappingStale: runtime.pageMappingStale,
                        retryCount: runtime.logicalRemapRetryCount });
                    operation.guard();
                    return mappingResult(operation, 'deferred', { reason: 'count-not-converged' });
                }
                let page = nativeLogicalPageState(scroller, track, totalCount, columns);
                operation.guard();
                if (!page.positions.length || !page.positions.every(position => Number.isSafeInteger(position.itemIndex)) || !Number.isFinite(page.page)) {
                    const tail = wrappedTailLogicalPageForRebuild(page.positions, totalCount, columns, runtime);
                    if (tail) {
                        page = { ...page, page: tail.page };
                        log('Logical My List wrapped tail accepted for current-page recovery', {
                            reason, page: tail.page, wrapIndex: tail.wrapIndex, totalCount, columns, itemIndices: page.itemIndices });
                        operation.guard();
                    } else {
                        logVirtualRawIndexDiagnostic(page.slots, totalCount, columns, 'logical-page-model-rebuild');
                        operation.guard();
                        operation.write(model => model.deferMapping());
                        log('Logical My List page-model rebuild deferred for non-canonical native window', {
                            reason, totalCount, columns, slots: page.slots.length, itemIndices: page.itemIndices,
                            logicalIndices: page.logicalIndices, resolvedPage: page.page, retryCount: runtime.logicalRemapRetryCount });
                        operation.guard();
                        return mappingResult(operation, 'deferred', { reason: 'non-canonical-window', countConverged,
                            itemIndices: page.itemIndices, logicalIndices: page.logicalIndices });
                    }
                }
                const signature = visibleSignature(page.slots);
                operation.guard();
                if (!signature) {
                    operation.write(model => model.deferMapping());
                    log('Logical My List page-model rebuild deferred because native signature is unavailable', {
                        reason, totalCount, columns, retryCount: runtime.logicalRemapRetryCount });
                    operation.guard();
                    return mappingResult(operation, 'deferred', { reason: 'signature-unavailable', countConverged });
                }
                const visibleIds = currentPageVideoIds(scroller, track);
                operation.guard();
                operation.commit({ pageCount: Math.max(1, Math.ceil(Math.max(totalCount, 1) / columns)), currentPage: page.page, signature });
                return mappingResult(operation, 'committed', { countConverged, visibleSignature: signature,
                    visibleIds, itemIndices: page.itemIndices, logicalIndices: page.logicalIndices });
            });
        } finally { motionLease?.release(); }
    }
    function refreshMapping(options) {
        return options.mode === 'delta' ? anchorMappingAfterDelta(options) : rebuildMappingFromNativePosition(options);
    }

    async function prepareSource({ section, scroller, track, sessionToken = null, fastSinglePageTotalCount = null,
        assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        const owner = { binding, sessionToken, model: null, generation: null, accepted: false };
        preparationOwner = owner;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (preparationOwner !== owner || (owner.model && models.get(section) !== owner.model) ||
                (owner.generation !== null && owner.model.mappingGeneration !== owner.generation)) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation', 'Native source preparation was replaced');
            }
        };
        owner.guard = guard;
        resetCarouselDomRuntime(section);
        owner.model = models.get(section);
        guard();
        logCarouselDomProfile(section, 'before-readiness');
        guard();
        const readiness = await readinessPolling.waitUntilReady(section, scroller, track, sessionToken, {
            fastSinglePageTotalCount, assertAdmission: guard
        });
        guard();
        // Profile detection may legitimately change while Netflix initializes.
        // The confirmed interpretation is retained for subsequent acceptance.
        owner.generation = owner.model.mappingGeneration;
        const state = readiness.state && Object.freeze({ ...readiness.state,
            capabilities: Object.freeze({ ...readiness.state.capabilities }) });
        const result = Object.freeze({ ...readiness, ...(state ? { state } : {}) });
        if (result.ready && !result.empty) preparationTickets.set(result, owner);
        return result;
    }
    function assertPreparation(result) {
        const owner = preparationTickets.get(result);
        if (owner) {
            owner.guard(); getModel(owner.binding.section); owner.guard();
            return result;
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation', 'Native source preparation is no longer current');
    }
    function isPreparationCurrent(result) {
        try { assertPreparation(result); return true; } catch (_) { return false; }
    }
    function acceptCollection({ preparation, totalCount, columns, collectedCount }) {
        assertPreparation(preparation);
        const owner = preparationTickets.get(preparation);
        if (!Number.isSafeInteger(totalCount) || totalCount <= 0 || !Number.isSafeInteger(columns) || columns <= 0 ||
            !Number.isSafeInteger(collectedCount) || collectedCount !== totalCount) {
            throw initializationError('NATIVE_COLLECTION_COUNT_MISMATCH', 'native-collection-acceptance',
                'Complete collection count and positive layout columns are required', { totalCount, columns, collectedCount });
        }
        if (owner.accepted) throw initializationError('NATIVE_COLLECTION_ALREADY_ACCEPTED', 'native-collection-acceptance',
            'This preparation already accepted a complete collection');
        owner.guard();
        owner.model.confirmCount(Math.max(1, Math.ceil(totalCount / columns)));
        owner.generation = owner.model.mappingGeneration;
        owner.accepted = true;
        owner.guard();
        return mappingResult({ binding: owner.binding, model: owner.model, totalCount, columns, guard: owner.guard }, 'accepted');
    }

    function diagnostics(options = {}) {
        const snapshot = { bindingGeneration, readScopeActive: readings.active(), navigation: navigation.diagnostics(),
            collection: collection.diagnostics(), collectionOperations: collection.pending(), mountedSourceWaits: resolution.pending(),
            ...readinessPolling.diagnostics(),
            ...discovery.diagnostics(),
            presentation: sourcePresentation.diagnostics() };
        if (Object.hasOwn(options, 'card')) {
            try { snapshot.card = withNativeReadScope(() => slotDescriptor(options.card, options.totalCount)); }
            catch (_) { snapshot.card = null; }
        }
        if (Object.hasOwn(options, 'source')) {
            try { snapshot.source = withNativeReadScope(() => sourceDescription(options.source)); }
            catch (_) { snapshot.source = null; }
        }
        return snapshot;
    }
    function getModel(section) {
        if (!section) return null;
        let model = models.get(section);
        const profile = detectCarouselDomProfile(section);
        if (!model) { model = createPageModel(profile); models.set(section, model); }
        else model.updateProfile(profile);
        return model;
    }
    function getCarouselDomRuntime(section) { return getModel(section)?.view || null; }
    function modelForWrite(section) { return models.get(section) || getModel(section); }
    function resetCarouselDomRuntime(section) {
        if (!section) return null;
        invalidateNativeReadScope(); models.delete(section); return getCarouselDomRuntime(section);
    }
    function registerLogicalPageSignature(section, signature, page = null) { return getModel(section)?.register(signature, page) ?? null; }
    function forceLogicalPageSignature(section, signature, page) { return getModel(section)?.force(signature, page) ?? null; }
    function logCarouselDomProfile(section, reason = 'unknown') {
        const model = getModel(section); if (!model) return;
        const summary = carouselDomProfileSummary(section);
        if (model.shouldLog(JSON.stringify(summary))) log(tLog('carouselDomProfileDetected'), { reason, ...summary });
    }
    function borrowBinding(section, scroller = null, track = null) {
        const handle = Object.freeze({ section, scroller, track, generation: bindingGeneration, sessionToken: scope.token });
        bindingTickets.set(handle, { generation: bindingGeneration });
        return handle;
    }
    function isBindingCurrent(handle) {
        const ticket = bindingTickets.get(handle);
        return Boolean(ticket && ticket.generation === bindingGeneration && scope.isCurrent(handle.sessionToken) &&
            (!acceptedBinding || (handle.section === acceptedBinding.section &&
                (!handle.scroller || handle.scroller === acceptedBinding.scroller) &&
                (!handle.track || handle.track === acceptedBinding.track))) &&
            handle.section?.isConnected !== false && handle.scroller?.isConnected !== false && handle.track?.isConnected !== false);
    }
    function assertBinding(handle) {
        if (!isBindingCurrent(handle)) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-binding',
            'Native My List source binding changed', { generation: handle?.generation, currentGeneration: bindingGeneration });
    }
    function bind(section, scroller = null, track = null) {
        if (acceptedBinding && acceptedBinding.section === section && acceptedBinding.scroller === scroller &&
            acceptedBinding.track === track && isBindingCurrent(acceptedBinding)) return acceptedBinding;
        preparationOwner = null;
        readinessPolling.reset(); resetMountedWaits(); collection.reset(); navigation.reset();
        bindingGeneration++; invalidateNativeReadScope();
        if (section) models.delete(section);
        acceptedBinding = borrowBinding(section, scroller, track);
        return acceptedBinding;
    }
    function clearBinding() { preparationOwner = null; readinessPolling.reset(); resetMountedWaits(); collection.reset(); navigation.reset(); bindingGeneration++; acceptedBinding = null; invalidateNativeReadScope(); }

    function carouselDomProfileSummary(section) {
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return null;
        return {
            generation: runtime.profile.generation,
            navigationMode: runtime.profile.navigationMode,
            pageMode: runtime.profile.pageMode,
            indicatorCount: runtime.profile.indicatorCount,
            knownPageCount: runtime.knownPageCount,
            pageCountFinalized: Boolean(runtime.pageCountFinalized),
            cycleDetected: Boolean(runtime.cycleDetected),
            pageMappingStale: Boolean(runtime.pageMappingStale),
            logicalPage: runtime.currentPage,
            capabilities: { ...runtime.profile.capabilities }
        };
    }

    function logicalVisibleSignature(section) {
        const binding = acceptedBinding?.section === section ? acceptedBinding : null;
        const scroller = binding?.scroller?.isConnected ? binding.scroller : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = binding?.track?.isConnected ? binding.track : (scroller && netflixDom.findTrack(scroller));
        if (!scroller || !track) return '';
        return visibleSignature(currentPageSlots(scroller, track));
    }

    function selectedPage(section) {
        if (!readings.active()) return withNativeReadScope(() => selectedPage(section));
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            const items = nativeIndicatorItems(section);
            const index = items.findIndex(x => x.getAttribute('data-indicator-selected') === 'true');
            return index >= 0 ? index : 0;
        }
        if (profile.pageMode === 'logical' && runtime) {
            const binding = acceptedBinding?.section === section ? acceptedBinding : null;
            const scroller = binding?.scroller?.isConnected ? binding.scroller : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
            const track = binding?.track?.isConnected ? binding.track : (scroller && netflixDom.findTrack(scroller));
            const { totalCount = null, columns = 0 } = readListShape(section) || {};
            if (scroller && track && Number.isFinite(totalCount) && totalCount > 0 && columns > 0) {
                const nativeState = nativeLogicalPageState(scroller, track, totalCount, columns);
                if (Number.isFinite(nativeState.page)) {
                    const signature = visibleSignature(nativeState.slots);
                    if (signature) forceLogicalPageSignature(section, signature, nativeState.page);
                    getModel(section).notePage(nativeState.page);
                    return runtime.currentPage;
                }
            }
            const signature = logicalVisibleSignature(section);
            if (signature && runtime.signatureToPage.has(signature)) {
                getModel(section).notePage(runtime.signatureToPage.get(signature));
            }
            return runtime.currentPage;
        }
        return 0;
    }

    function pageCount(section) {
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            return nativeIndicatorItems(section).length || 1;
        }
        if (profile.pageMode === 'logical' && runtime) {
            if (runtime.pageCountFinalized && Number.isFinite(runtime.knownPageCount)) {
                return Math.max(1, runtime.knownPageCount);
            }
            const knownPages = [...runtime.signatureToPage.values()].filter(Number.isFinite);
            if (knownPages.length) return Math.max(1, Math.max(...knownPages) + 1);
        }
        return 1;
    }

    function logVirtualRawIndexDiagnostic(slots, totalCount, columns, stage) {
        const entries = slots.slice(0, Math.min(slots.length, 6)).map((slot, index) => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const child = slot.firstElementChild;
            const cardParent = card?.parentElement || null;
            return {
                index,
                descriptor: slotDescriptor(slot),
                nodes: [
                    netflixReactCarousel.describeNode(slot, 'slot'),
                    netflixReactCarousel.describeNode(child, 'slot-first-child'),
                    netflixReactCarousel.describeNode(cardParent, 'card-parent'),
                    netflixReactCarousel.describeNode(card, 'card')
                ]
            };
        });
        warn('Netflix itemIndex diagnostic', {
            stage,
            totalCount,
            columns,
            slotCount: slots.length,
            entries
        });
    }

    function captureFallbackItem(videoId) {
        const wanted = String(videoId);
        for (const card of document.querySelectorAll(NETFLIX_DOM_SELECTORS.standardCardWithHref)) {
            if (card.closest(`#${GRID_ID}`)) continue;
            const href = card.href || card.getAttribute('href') || '';
            if (netflixDom.videoIdFromHref(href) !== wanted) continue;
            const slot = card.closest(NETFLIX_DOM_SELECTORS.virtualSlot);
            if (!slot) continue;
            const item = cardMarkup.capture(slot, 0);
            if (item?.videoId === wanted) return item;
        }
        return null;
    }
    function cardIdentity(node) {
        const card = node?.matches?.(NETFLIX_DOM_SELECTORS.standardCard) ? node : node?.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return null;
        const href = card.href || card.getAttribute('href') || '';
        return Object.freeze({ href, videoId: netflixDom.videoIdFromHref(href) });
    }

    return Object.freeze({ startDiscovery: discovery.start, stopDiscovery: discovery.stop, refreshDiscovery: discovery.refresh, bind, clearBinding, borrowBinding, isBindingCurrent, assertBinding,
        currentBinding: () => acceptedBinding,
        createPageHints(options = {}) {
            const token = scope.token;
            return createPageHints({ createError: initializationError, assertCurrent() {
                scope.assertCurrent(token); options.assertCurrent?.();
            } });
        },
        whenNavigationIdle: navigation.whenIdle,
        suppressMotion: navigation.suppress, restoreMotion: navigation.restoreMotion,
        movePage: navigation.move, navigateTo: navigation.navigate, stablePage: navigation.stable,
        restorePage(section, scroller, track, items, slots, page, options = {}) {
            return options.mode === 'strict'
                ? navigation.restoreStrict(section, scroller, track, items, slots, page, options.sessionToken ?? null)
                : navigation.restoreFast(section, scroller, track, items, slots, page,
                    options.canonicalTransform || '', options.sessionToken ?? null);
        },
        mountedBootstrap: collection.mountedBootstrap, anchorPageZero,
        resolveCard, mountedCard, isSourceCurrent, assertSource,
        preferredPage({ record, hints, records = [], columns = 1 }) {
            if (!record) return 0;
            const hinted = hints?.get(record);
            if (Number.isFinite(hinted)) return hinted;
            if (Number.isFinite(record.page)) return record.page;
            const index = records.indexOf(record);
            return index >= 0 ? Math.floor(index / Math.max(1, columns || 1)) : 0;
        },
        refreshMapping, isMappingCurrent, assertMapping,
        collect: options => options.mode === 'mounted-single-page' ? collection.collectMounted(options) : collection.collect(options),
        resetSource() { sourcePresentation.dispose(); clearBinding(); collection.resetDiagnostics(); models = new WeakMap(); readings.clear(); },
        presentSource: sourcePresentation.present, cleanupArtifacts: sourcePresentation.cleanupArtifacts,
        prepareSource, acceptCollection, isPreparationCurrent, assertPreparation,
        observeSource, pageCards, measureLayout, discoverSource, captureMountedItem, captureFallbackItem, cardIdentity, assertObservation, isObservationCurrent,
        sample: withNativeReadScope, invalidateReads: invalidateNativeReadScope, waitForSource: readinessPolling.waitForSource,
        diagnostics
    });
}
