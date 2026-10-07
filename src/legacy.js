import { createHover } from './hover/hover.js';
import { createNativePopup } from './netflix/native-popup.js';
import { createNetflixContext } from './netflix/context.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from './netflix/page-dom.js';
import { createGrid } from './grid/grid.js';
import { createList } from './list/list.js';
import { createLogger } from './diagnostics/logger.js';
import { createReport } from './diagnostics/report.js';
import { createPopupInspection } from './netflix/popup-inspection.js';
import {
    GRID_ID, STATUS_ID, SECTION_ATTR,
    STATUS_LABEL_CLASS, STATUS_META_CLASS,
    SYNTHETIC_SECTION_ID
} from './dom-names.js';
import { createI18n } from './i18n/i18n.js';
import { createListData } from './netflix/list-data.js';
import { createViewingData } from './netflix/viewing-data.js';
import { createViewing } from './viewing/viewing.js';
import { createSessionScope } from './app/session-scope.js';
import { createCarousel } from './netflix/carousel/carousel.js';

// Transitional runtime; responsibilities move to their declared owners in P03-P20.
export function startLegacy() {
    'use strict';

    const netflixContext = createNetflixContext({ window, document, navigator, location });
    const { getHtmlLanguage, getNetflixLanguage } = netflixContext;
    const viewingData = createViewingData({ context: netflixContext,
        fetch: (...args) => fetch(...args), createCancelledError: createRouteSessionCancelledError });
    const viewing = createViewing({ activeProfile: () => netflixContext.activeProfile(), now: () => Date.now(), limits: viewingData.limits, data: viewingData, performanceNow: () => performance.now(),
        beginRequest: token => createRouteFetch(token), finishRequest: request => finishRouteFetch(request),
        setRequestTimeout: (request, delay) => sessionScope.setRequestTimeout(request, delay),
        isCancelled: isRouteSessionCancelledError, createCancelledError: createRouteSessionCancelledError,
        log: (key, detail) => log(tLog(key), detail), warn: (key, detail) => warn(tLog(key), detail),
        getValue: typeof GM_getValue === 'function' ? (...args) => GM_getValue(...args) : undefined,
        setValue: typeof GM_setValue === 'function' ? (...args) => GM_setValue(...args) : undefined });
    const netflixDom = createNetflixPageDom({ document, Element, HTMLElement, location, getComputedStyle,
        readGraphqlIdentity: () => listData.myListDomIdentity() });
    const { nativeCardIdentity, videoIdFromHref, decodeTrackingContext } = netflixDom;
    const itemFromSlot = (...args) => gridView.captureCard(...args);
    const { getUiLocale, getLogLocale, tUi, tUiPlural, tLog,
        formatUiNumber, formatItemCount, formatInitializationTime } = createI18n({ readLanguage: getNetflixLanguage });

    const TARGET_PATH = '/browse/my-list';
    const NATIVE_READY_TIMEOUT_MS = 3000;
    const NATIVE_EMPTY_STABLE_MS = 1200;
    const NATIVE_READY_POLL_MS = 25;
    const DELTA_MUTATION_TIMEOUT_MS = 1800;
    const UNDO_ENTRY_TTL_MS = 30000;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    const TOTAL_COUNT_TIMEOUT_MS = 5000;
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = 10000;
    const sessionScope = createSessionScope({ isTargetPage, AbortController, setTimeout, clearTimeout,
        requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS });
    const gridView = createGrid({ document, location, runChunks: runConstructionChunks,
        createError: (code, message) => initializationError(code, 'grid-cards', message),
        installHover: grid => hover.install(grid), readPage: pageForItem,
        onRetire: (handle, detail) => { nativePopup.retire(handle); hover.retire(handle, detail); },
        tLog, tUi, formatUiNumber, formatItemCount, copyLogs: copyDiagnosticLogs, setTimeout, clearTimeout,
        readEmptyContent: section => netflixDom.readEmptyContent(section), readEmptyShell: () => netflixDom.readEmptyShell(),
        isActive: () => targetSessionActive && isTargetPage() });

    const listView = createList({ runChunks: runConstructionChunks, assertSession: assertRouteSession,
        isCancelled: isRouteSessionCancelledError, collectMounted: collectMountedSinglePageItems,
        captureTemplate: source => gridView.captureTemplate(source), assertSource: source => nativeCarousel.assertSource(source),
        collectRecords: input => listData.collectRecords(input),
        waitInitialCount: token => waitForMyListTotalCount(TOTAL_COUNT_TIMEOUT_MS, token),
        readInitialFirstId: () => listData.firstMyListVideoId(), fetchBootstrap: token => listData.fetchBootstrap(token),
        onReuseRejected: detail => log('Mounted single-page membership reuse rejected; using fresh collection', detail) });

    const listMutations = listView.createMutations({ now: () => performance.now(),
        readSession: () => sessionScope.token, isSessionActive: isRouteSessionActive, setTimeout, clearTimeout,
        ttl: UNDO_ENTRY_TTL_MS, hasRetained: (id, item) => gridView.hasRetained(id, item),
        releaseRetained: id => gridView.releaseRetained(id), mutationTimeout: DELTA_MUTATION_TIMEOUT_MS,
        isBlocked: () => nativeInitializationFailure?.sessionToken === sessionScope.token && initializationBlockedSessionToken === sessionScope.token,
        readParent: () => sourceState, canApply: () => Boolean(sourceState && isTargetPage()),
        assertSession: assertRouteSession, isCancelled: isRouteSessionCancelledError,
        createError: (code, message) => initializationError(code, 'native-discovery', message),
        hasMember: id => sourceState.itemMap?.has('v:' + id),
        refreshNative: refreshNativeSectionAfterDelta, observeNative: nativeDiscoveryObservation,
        captureNative: findNativeMyListItemByVideoId, hasMaterial: (item, correlationId) => gridView.materialFor(item, correlationId),
        assertNative: observation => nativeCarousel.assertObservation(observation),
        readMembership: ensureListMembership, readLayout: readMutationLayout, readVisible: readMutationVisibleFacts,
        hasCard: record => Boolean(gridView.getCard(record)), retireCard: retireMutationCard,
        canInsertCard: prepareMutationInsertion, insertCard: insertMutationCard,
        readPage: pageForItem, writePage: (record, page, { parent, assertCurrent }) => setPageForItem(record, page, parent, { assertCurrent }),
        updateCard: updateMutationCard, sample: operation => nativeCarousel.sample(operation),
        refreshMapping: syncLogicalPageModelAfterDelta, onReindexed: presentListChange, onOrder: presentListOrder,
        onChanged: reportListChange, createCancelledError: createRouteSessionCancelledError,
        findFallback: findAnyStandardCardItemByVideoId,
        queueMicrotask, observeChanges(callback) {
            const root = document.body || document.documentElement;
            if (!root) return null;
            const observer = new MutationObserver(callback);
            try { observer.observe(root, { childList: true, subtree: true, attributes: true,
                attributeFilter: ['data-uia', 'class', 'aria-label', 'href'] }); }
            catch (error) { observer.disconnect(); throw error; }
            return observer;
        },
        onTimeout: detail => warn(tLog('differentialUpdateTimedOutWaitingForAUsableCardSnapshot'), detail),
        onQueued: intent => log(tLog('myListMutationQueued'), { seq: intent.seq, videoId: intent.videoId, action: intent.action,
            uiaAction: intent.uiaAction, uia: intent.uia, syncMode: 'event-driven', undo: intent.undo,
            preferredIndex: intent.preferredIndex, hasFallbackSnapshot: Boolean(gridView.materialFor(intent.fallbackItem, intent.correlationId)) }),
        normalizeTitle: normalizeNetflixUiText,
        onCounter: (name, amount) => { performanceDiagnostics.undoRetention[name] += amount; },
        onExpired: detail => log(tLog('undoEntriesExpired'), detail) });

    const BUILD_CHUNK_MAX_ITEMS = 24;
    const BUILD_CHUNK_BUDGET_MS = 6;
    // Read-only, on-demand Copy Logs samples; no work is added to scrolling.
    const THUMBNAIL_DIAGNOSTIC_LIMITS = Object.freeze({
        cards: 600, geometry: 24, resourceEntries: 2000
    });
    const IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES = 4000;
    // Short, coalesced callback-gap samples; never a continuous FPS/paint monitor.

    const SCRIPT_NAME = 'My List for Netflix';
    const SCRIPT_VERSION = __SCRIPT_VERSION__;
    // Enable temporarily when detailed source-card traces are needed for diagnosis.
    const VERBOSE_INTERACTION_LOGS = false;
    const SETTINGS_STORAGE_KEY = 'legacyMyListForNetflix.settings.v3';

    const logger = createLogger({ name: SCRIPT_NAME, version: SCRIPT_VERSION, Element, console,
        isTraceEnabled: () => VERBOSE_INTERACTION_LOGS });
    const { log, warn, trace } = logger;
    const popupInspection = createPopupInspection({ Element, now: () => performance.now(),
        isCurrentSession: token => targetSessionActive && isRouteSessionActive(token),
        readSessionToken: () => sessionScope.token, isSourceMounted: () => Boolean(sourceState?.grid?.isConnected),
        readSourceCard: () => sourceState.track?.querySelector(NETFLIX_DOM_SELECTORS.standardCard) });
    const diagnosticReport = createReport({ logger, version: SCRIPT_VERSION, document, navigator, tLog,
        readEnvironment: () => ({ url: location.href, userAgent: navigator.userAgent, browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(), netflixLanguage: getNetflixLanguage(), displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(), viewport: `${window.innerWidth}x${window.innerHeight}`, devicePixelRatio: window.devicePixelRatio }),
        readRuntime: () => collectRuntimeSnapshot(), readSeriesViewing: () => collectViewingSeriesDiagnostics(sourceState),
        readThumbnails: () => collectThumbnailDiagnostics(sourceState), readNativePopup: () => popupInspection.collect() });

    const listData = createListData({ context: netflixContext, pageDom: netflixDom, location,
        fetch: (...args) => fetch(...args), performance, assertCurrent: assertRouteSession,
        isCancelled: isRouteSessionCancelledError, createError: initializationError,
        beginRequest: createRouteFetch, finishRequest: finishRouteFetch, runChunks: runConstructionChunks,
        inspection: popupInspection, log, warn, tLog, requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS });

    const nativeCarousel = createCarousel({ pageDom: netflixDom, scope: sessionScope, document, window, Element,
        getComputedStyle, performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
        readListShape: section => sourceState?.section === section ? { totalCount: sourceState.totalCount,
            columns: Math.max(1, sourceState.layout?.columns || 1) } : null,
        readGraphqlCount: () => listData.readMyListTotalCount(),
        cardMarkup: { capture: gridView.captureCard, captureTemplate: gridView.captureTemplate }, createError: initializationError,
        log, warn, trace, tLog, logTimeout: logOperationTimeout, MutationObserver,
        isHoverCancelled: token => hover.isCancelled(token), readHoverToken: () => hover.intent().token,
        navigationDiagnostics: createNavigationDiagnosticSink,
        checkRoute: () => { if (location.href !== lastObservedUrl) handleRouteChange('MutationObserver-url'); },
        onMutationDelivery: () => nativePopup.checkDetached(),
        isInitializationBlocked: () => initializationBlockedSessionToken === sessionScope.token,
        onBlockedMutation: token => recoverNativeInitialization(token, 'document-mutation'),
        isGridDetached: () => Boolean(completedSection && sourceState?.grid && !sourceState.grid.isConnected),
        shouldCoalesce: () => Boolean(completedSection || (waitingForNativeEmpty && sourceState?.empty)),
        onRelevantMutation: handleRelevantTargetDocumentMutation });


    let nativePopup;
    const hover = createHover({ Element, document, performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
        sample: callback => nativeCarousel.sample(callback), grid: gridView, readSessionToken: () => sessionScope.token, isSessionCurrent: isRouteSessionActive,
        readEnvironment: () => ({ grid: sourceState?.grid, blockedReason: orderMismatchDialogOpen ? 'order-mismatch-dialog-open' :
            orderMismatchReinitializing ? 'order-mismatch-reinitializing' : '' }),
        whenStable: () => responsiveRefreshPromise?.catch(() => {}) || null,
        resolveReady: resolveReadyHover, prepare: prepareHoverCard, sleep, assertSession: assertRouteSession,
        isCancelledError: isRouteSessionCancelledError, describeItem: itemSummary, log, warn, tLog,
        createPopup: policy => { return (nativePopup = createNativePopup({ Element, Node: globalThis.Node, document, PointerEvent: globalThis.PointerEvent, MouseEvent: globalThis.MouseEvent, performance,
        requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, carousel: nativeCarousel, grid: gridView,
        pageDom: netflixDom, selectors: NETFLIX_DOM_SELECTORS,
        ...policy, readDiagnostics: () => ({ ...policy.readDiagnostics(), nativeRecovery: performanceDiagnostics.nativeRecovery }),
        readEnvironment: () => ({ grid: sourceState?.grid, scroller: sourceState?.scroller }),
        isSessionCurrent: isRouteSessionActive, itemForSource: findItemForSourceSlot, activeSource: findActiveSourceSlot,
        createError: initializationError, describeSource: slotDescriptor, describeItem: itemSummary, log, warn, trace, tLog,
        capturePreview: (...args) => popupInspection.capturePreview(...args) })); }
    });

    function resolveReadyHover(item, card) {
        if (!card) return null;
        const state = sourceState;
        return withNativeReadScope(() => {
            ensureLiveNativeBinding('hover-reuse');
            const observation = nativeSourceObservation(state, { position: true });
            const page = observation.position.page, backedPage = Number(card.node.getAttribute('data-tm-backed-page'));
            const source = card.node.getAttribute('data-tm-hover-ready') === 'true' && Number.isFinite(backedPage) && page === backedPage
                ? nativeCarousel.mountedCard({ section: state.section, scroller: state.scroller, track: state.track,
                    item: { videoId: item.videoId, href: item.href }, activeOnly: true, sessionToken: sessionScope.token }) : null;
            const assertCurrent = () => { if (sourceState !== state) throw createRouteSessionCancelledError(); nativeCarousel.assertObservation(observation); };
            assertCurrent();
            return { source, card, page, backedPage, targetPage: pageForItem(item), assertCurrent };
        });
    }

    function prepareHoverCard(item, card, event, token, sessionToken) {
        if (!card || !gridView.isCardCurrent(card)) return null;
        return prepareMountedPage(pageForItem(item), item, event, token, sessionToken);
    }

    function clearSourceAlignment(slot, reason = 'source-release', relatedTarget = null) {
        nativePopup.release(reason, relatedTarget, slot);
    }

    function popupSource(slot, item) {
        const state = sourceState;
        const source = nativeCarousel.mountedCard({ section: state.section, scroller: state.scroller, track: state.track,
            item: { videoId: item.videoId, href: item.href }, activeOnly: true, sessionToken: sessionScope.token });
        if (!source || source.slot !== slot) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-popup', 'Native card changed');
        return source;
    }


    function makeLiveClone(slot, item, clone, page, assertCurrent = () => {}, token = hover.intent().token, sessionToken = sessionScope.token) {
        const card = gridView.getCard(item);
        if (!card || card.node !== clone) throw initializationError('GRID_CARD_RETIRED', 'grid-cards', 'Preparation card changed');
        return nativePopup.prepare({ source: popupSource(slot, item), card, item, page, assertCurrent, token, sessionToken });
    }

    let nativePresentationLease = null;

    // Composition publishes the replacement before retiring the exact previous list parent.
    function publishSourceState(next) {
        const previous = sourceState;
        sourceState = next;
        if (previous !== next) { viewing.dispose(previous?.watchStatus); previous?.listMembership?.dispose(); previous?.nativePageHints?.dispose(); }
        return next;
    }

    function ensurePageHints(state) {
        if (state.nativePageHints) return state.nativePageHints;
        const hints = nativeCarousel.createPageHints({ assertCurrent() {
            if (sourceState !== state) throw createRouteSessionCancelledError();
        } });
        Object.defineProperty(state, 'nativePageHints', { value: hints, configurable: true });
        return hints;
    }

    function pageForItem(item) {
        if (!item) return 0;
        const hinted = sourceState ? ensurePageHints(sourceState).get(item) : undefined;
        if (Number.isFinite(hinted)) return hinted;
        if (Number.isFinite(item.page)) return item.page; // Transient collector input, never an admitted record.
        const index = sourceState?.items?.indexOf(item) ?? -1;
        return index >= 0 ? Math.floor(index / Math.max(1, sourceState.layout?.columns || 1)) : 0;
    }

    function setPageForItem(item, page, state = sourceState, admission = {}) {
        ensurePageHints(state).set(item, page, admission);
    }

    function ensureListMembership(state) {
        if (state.listMembership) return state.listMembership;
        const membership = listView.createMembership({ items: state.items || [], totalCount: state.totalCount ?? null,
            collectedCount: state.collectedCount ?? 0 });
        Object.defineProperty(state, 'listMembership', { value: membership, configurable: true });
        for (const [field, owned] of [['items', 'records'], ['itemMap', 'lookup'], ['totalCount', 'expectedCount'], ['collectedCount', 'collectedCount']])
            Object.defineProperty(state, field, { enumerable: true, configurable: true, get: () => membership[owned] });
        return membership;
    }

    // Native binding and membership remain distinct owners in transitional composition.
    function attachNativeBinding(state, section, scroller = null, track = null) {
        ensureListMembership(state);
        const binding = nativeCarousel.bind(section, scroller, track);
        for (const key of ['section', 'scroller', 'track']) Object.defineProperty(state, key,
            { enumerable: true, configurable: true, get: () => binding[key] });
        return state;
    }

    function formatInitializationErrorMeta(error, fallbackTotalCount = null) {
        const details = error?.details || {};
        const rawCollected = Number(
            details.collected ??
            details.actual ??
            sourceState?.collectedCount ??
            0
        );
        const collected = Number.isFinite(rawCollected) && rawCollected >= 0 ? rawCollected : 0;
        const itemText = tUiPlural('itemCount', collected, { count: formatUiNumber(collected) });

        const rawTotal = Number(
            details.totalCount ??
            details.expected ??
            fallbackTotalCount
        );
        if (!Number.isFinite(rawTotal) || rawTotal < collected) {
            return `${itemText} ${tUi('errorCount', { count: '' })}`;
        }

        const missing = Math.max(0, rawTotal - collected);
        const missingText = tUiPlural('itemCount', missing, { count: formatUiNumber(missing) });
        return `${itemText} ${tUi('errorCount', { count: missingText })}`;
    }

    function formatHeaderParts(current, total, elapsedMs = null, finalized = false, presentation = null) {
        if (finalized && sourceState?.watchStatus && current === sourceState.items?.length && total === current) {
            const watch = presentation || gridView.presentation();
            current = Number.isFinite(watch.visibleCount) ? watch.visibleCount
                : Math.max(0, current - (watch.completedCount || 0));
            total = current;
        }
        return {
            label: tUi('legacyMyList'),
            meta: `${formatItemCount(current, total, finalized)}  ${formatInitializationTime(elapsedMs)}`
        };
    }

    let running = false;
    let runningSessionToken = null;
    let initializationDeferral = null, responsiveDeferral = null;
    let completedSection = null;
    let scheduled = false;
    let scheduledSessionToken = null;
    let scheduledRunTimer = null;
    let scheduledRunDueAt = 0;
    let sourceState = null;
    let resizeObserver = null;
    let orderMismatchDismissed = false;
    let orderMismatchDialogOpen = false;
    let orderMismatchReinitializing = false;
    let responsiveRefreshTimer = null;
    let responsiveRefreshPromise = null;
    let responsiveRefreshing = false;
    let activeResponsiveReason = '';
    let myListCountConvergencePending = false;
    let mutationSourceRecoveryPending = false;
    let lastResponsiveSignature = '';
    let lastPageShape = '';
    let responsiveSequence = 0;
    let lastResponsiveReason = '';
    let lastObservedUrl = location.href;
    let routeChangeSequence = 0;
    let targetSessionActive = false;
    let targetSessionEntryKind = 'initial';
    let targetSessionReason = 'route:initial';
    let targetListenersActive = false;
    let viewOriginalMyList = true;
    let viewOriginalMenuId = null;
    let missingSectionSince = 0;
    let waitingForNativeEmpty = false;
    let initializationBlockedSessionToken = null;
    let nativeInitializationFailure = null;
    let performanceDiagnostics = createPerformanceDiagnostics();
    let imageResourceObserver = null;

    function createPerformanceDiagnostics() {
        return {
            resize: { events: 0, checks: 0, unchanged: 0, refreshes: 0, hoverPreserved: 0, hoverCancelled: 0,
                parkedHeightChangesIgnored: 0, parkedHeightHoverPreserved: 0 },
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0, alignmentRestores: 0, alignmentRestoreFailures: 0 },
            undoRetention: { remembered: 0, expired: 0, consumed: 0, cleared: 0, schedules: 0, expiryCallbacks: 0 },
            imageResources: { scope: 'page-images-during-list-route', supported: false, active: false, stopReason: '',
                limit: IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES, batches: 0, entriesExamined: 0, beforeRouteOrInvalid: 0,
                skippedAtLimit: 0, imageEntries: 0, startedAfterViewingScan: 0, durationSamples: 0,
                totalFetchMs: 0, maxFetchMs: 0, lastImageStartOffsetMs: null, cacheDelivery: 0,
                transferBytesReported: 0, zeroTransferSizeEntries: 0, disconnectFailures: 0 }
        };
    }

    function collectPerformanceDiagnostics() {
        const snapshots = Object.fromEntries(Object.entries(performanceDiagnostics).map(([key, counters]) => [key, { ...counters }]));
        return { viewingGroups: gridView.groupDiagnostics(), hoverPreparation: hover.diagnostics().hoverPreparation,
            popupInvestigation: popupInspection.diagnostics(), ...snapshots, ...hover.diagnostics(), ...listView.diagnostics(), nativeCollection: nativeCarousel.diagnostics().collection, grid: gridView.diagnostics() };
    }

    function createNavigationDiagnosticSink(token) { return hover.navigationSink(token); }


    function stopImageResourceDiagnostics(reason = 'route-leave') {
        const owner = imageResourceObserver;
        if (!owner) return;
        imageResourceObserver = null;
        owner.counters.active = false;
        owner.counters.stopReason = reason;
        try { owner.observer?.disconnect(); } catch (_) { owner.counters.disconnectFailures++; }
    }

    function recordImageResourceEntries(owner, entries) {
        if (imageResourceObserver !== owner || !isRouteSessionActive(owner.sessionToken) ||
            performanceDiagnostics.imageResources !== owner.counters) return;
        const counters = owner.counters;
        counters.batches++;
        const count = Math.min(entries.length, IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES - counters.entriesExamined);
        const scanFinishedAt = sourceState?.watchStatus ? viewing.diagnostics(sourceState.watchStatus).network?.finishedAt : null;
        for (let index = 0; index < count; index++) {
            const entry = entries[index];
            counters.entriesExamined++;
            if (!Number.isFinite(entry.startTime) || entry.startTime < owner.startedAt) {
                counters.beforeRouteOrInvalid++; continue;
            }
            if (entry.initiatorType !== 'img') continue;
            counters.imageEntries++;
            if (Number.isFinite(scanFinishedAt) && entry.startTime >= scanFinishedAt) counters.startedAfterViewingScan++;
            counters.lastImageStartOffsetMs = Math.max(counters.lastImageStartOffsetMs ?? 0, Math.round(entry.startTime - owner.startedAt));
            if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                counters.durationSamples++;
                counters.totalFetchMs += Math.round(entry.duration);
                counters.maxFetchMs = Math.max(counters.maxFetchMs, Math.round(entry.duration));
            }
            if (entry.deliveryType === 'cache') counters.cacheDelivery++;
            if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) counters.transferBytesReported += entry.transferSize;
            else if (entry.transferSize === 0) counters.zeroTransferSizeEntries++;
        }
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) {
            counters.skippedAtLimit += entries.length - count;
            stopImageResourceDiagnostics('entry-limit');
        }
        // No URL is read or retained. These include native Netflix images as well as grid thumbnails.
    }

    function startImageResourceDiagnostics(sessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        const counters = performanceDiagnostics.imageResources;
        if (imageResourceObserver?.sessionToken === sessionToken && imageResourceObserver.counters === counters) return;
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) return;
        stopImageResourceDiagnostics('replaced');
        if (typeof PerformanceObserver !== 'function') {
            counters.stopReason = 'unsupported'; return;
        }
        const owner = { sessionToken, counters, startedAt: performance.now(), observer: null };
        try {
            const supportedTypes = PerformanceObserver.supportedEntryTypes;
            if (Array.isArray(supportedTypes) && !supportedTypes.includes('resource')) {
                counters.stopReason = 'unsupported'; return;
            }
            owner.observer = new PerformanceObserver(list => {
                if (imageResourceObserver !== owner || !isRouteSessionActive(sessionToken) ||
                    performanceDiagnostics.imageResources !== counters) return;
                try { recordImageResourceEntries(owner, list.getEntries()); }
                catch (_) { stopImageResourceDiagnostics('read-failed'); }
            });
            imageResourceObserver = owner;
            // Subscribe only to future entries. Do not enlarge or clear Netflix's saved timing buffer.
            owner.observer.observe({ entryTypes: ['resource'] });
            counters.supported = true;
            counters.active = true;
            counters.stopReason = '';
        } catch (_) {
            if (imageResourceObserver === owner) stopImageResourceDiagnostics('observe-failed');
            else counters.stopReason = 'observe-failed';
        }
    }

    function withNativeReadScope(...args) {
        return nativeCarousel.sample(...args);
    }

    function invalidateNativeReadScope(...args) {
        return nativeCarousel.invalidateReads(...args);
    }

    function isTargetPage() {
        return location.origin === 'https://www.netflix.com' && location.pathname === TARGET_PATH;
    }

    function isRouteSessionActive(sessionToken) {
        return sessionScope.isCurrent(sessionToken);
    }

    function createRouteSessionCancelledError() {
        return sessionScope.cancelledError();
    }

    function isRouteSessionCancelledError(error) {
        return sessionScope.isCancelled(error);
    }

    function assertRouteSession(sessionToken) {
        if (sessionToken === null || sessionToken === undefined) return;
        if (!isRouteSessionActive(sessionToken)) throw createRouteSessionCancelledError();
    }

    function createRouteFetch(sessionToken) {
        assertRouteSession(sessionToken);
        return sessionScope.beginRequest(sessionToken);
    }

    function finishRouteFetch(request) {
        sessionScope.finishRequest(request);
    }


    function beginRunningSession(sessionToken) {
        assertRouteSession(sessionToken);
        listMutations.start(sessionToken);
        initializationDeferral?.ticket.release({ resume: false });
        const owner = { sessionToken, ticket: listMutations.deferReconciliation('initialization') };
        initializationDeferral = owner; running = true; runningSessionToken = sessionToken;
        return owner;
    }

    function clearRunningSession(sessionToken, retryMutations = true, expected = initializationDeferral) {
        if (runningSessionToken !== sessionToken || initializationDeferral !== expected) return;
        running = false;
        runningSessionToken = null;
        initializationDeferral = null;
        expected?.ticket.release({ resume: retryMutations, reason: 'after-initialization' });
    }

    function restoreActiveCarouselStyles() {
        nativeCarousel.restoreMotion();
    }

    function resetDetachedTargetState() {
        if (completedSection?.isConnected && document.getElementById(GRID_ID)) return;
        if (sourceState?.section && !sourceState.section.isConnected) {
            viewing.dispose(sourceState.watchStatus); sourceState.listMembership?.dispose(); sourceState.nativePageHints?.dispose();
        }

        listMutations.dispose(); initializationDeferral = null; responsiveDeferral = null;
        hover.cancel('source');
        restoreActiveCarouselStyles();
        completedSection = null;
        if (sourceState?.section && !sourceState.section.isConnected) {
            nativeCarousel.clearBinding();
            publishSourceState(null);
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        activeResponsiveReason = '';
        myListCountConvergencePending = false;
        mutationSourceRecoveryPending = false;
        lastResponsiveSignature = '';
        lastPageShape = '';
        missingSectionSince = 0;
        gridView.cancelBuild();
        gridView.resetEmpty();
        listData.reset();
        waitingForNativeEmpty = false;
    }

    function cleanupTargetSessionDom() {
        viewing.dispose(sourceState?.watchStatus); sourceState?.listMembership?.dispose(); sourceState?.nativePageHints?.dispose();
        restoreActiveCarouselStyles();
        clearSourceAlignment();
        nativePopup.invalidate();

        gridView.dispose();
        orderMismatchDialogOpen = false;

        nativePresentationLease?.release();
        nativePresentationLease = null;
    }

    function suspendTargetSession(reason = 'route-leave') {
        const hadSession = targetSessionActive || running || sourceState || completedSection || scheduled;
        const previousToken = sessionScope.token;
        listMutations.dispose(); initializationDeferral = null; responsiveDeferral = null;
        viewing.dispose(sourceState?.watchStatus); sourceState?.listMembership?.dispose(); sourceState?.nativePageHints?.dispose();
        sessionScope.dispose();
        targetSessionActive = false;
        stopImageResourceDiagnostics();
        hover.dispose();

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduledRunTimer = null;
        scheduled = false;
        scheduledSessionToken = null;
        scheduledRunDueAt = 0;

        cleanupTargetSessionDom();
        stopTargetEventListeners();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        activeResponsiveReason = '';
        myListCountConvergencePending = false;
        nativeCarousel.resetSource();

        running = false;
        runningSessionToken = null;
        completedSection = null;
        nativeCarousel.clearBinding();
        publishSourceState(null);
        lastResponsiveSignature = '';
        lastPageShape = '';
        missingSectionSince = 0;
        listData.reset();
        waitingForNativeEmpty = false;
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        orderMismatchDismissed = false;
        orderMismatchDialogOpen = false;
        orderMismatchReinitializing = false;

        if (hadSession) {
            log(tLog('targetSessionSuspended'), {
                reason,
                previousToken,
                nextToken: sessionScope.token,
                url: location.href
            });
        }
    }

    function startTargetSession(reason = 'route-enter') {
        sessionScope.begin();
        targetSessionActive = true;
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        performanceDiagnostics = createPerformanceDiagnostics(); hover.resetDiagnostics();
        listView.resetDiagnostics();
        popupInspection.reset();
        startImageResourceDiagnostics(sessionScope.token);
        targetSessionEntryKind = reason === 'route:initial' ? 'initial' : 'spa';
        targetSessionReason = reason;
        const sessionToken = sessionScope.token;
        resetDetachedTargetState();
        startTargetEventListeners();
        log(tLog('targetSessionStarted'), {
            reason,
            sessionToken,
            url: location.href
        });
        scheduleRun(0, sessionToken);
    }

    function handleRouteChange(source = 'unknown') {
        const currentUrl = location.href;
        const changed = currentUrl !== lastObservedUrl;
        if (!changed && source !== 'initial') return;

        const previousUrl = lastObservedUrl;
        lastObservedUrl = currentUrl;
        const seq = ++routeChangeSequence;
        const target = isTargetPage();

        log(tLog('routeChangeDetected'), {
            seq,
            source,
            previousUrl,
            currentUrl,
            target
        });

        if (!target) {
            suspendTargetSession(`route:${source}`);
            return;
        }

        if (!targetSessionActive) {
            startTargetSession(`route:${source}`);
            return;
        }

        resetDetachedTargetState();
        scheduleRun(0, sessionScope.token);
    }

    function installSpaNavigationHooks() {
        for (const methodName of ['pushState', 'replaceState']) {
            const original = history[methodName];
            if (typeof original !== 'function') continue;
            history[methodName] = function (...args) {
                const result = original.apply(this, args);
                queueMicrotask(() => handleRouteChange(`history.${methodName}`));
                return result;
            };
        }

        window.addEventListener('popstate', () => handleRouteChange('popstate'), true);
        window.addEventListener('hashchange', () => handleRouteChange('hashchange'), true);
    }

    function initializationError(code, stage, message, details = {}) {
        const error = new Error(message || code || 'Initialization failed');
        error.code = code || 'INITIALIZATION_FAILED';
        error.stage = stage || 'unknown';
        error.details = details;
        return error;
    }

    function initializationTimeoutError(stage, timeoutMs, details = {}) {
        return initializationError(
            'INITIALIZATION_TIMEOUT',
            stage,
            `Timeout at ${stage} after ${timeoutMs} ms`,
            { timeoutMs, ...details }
        );
    }

    function logOperationTimeout(stage, timeoutMs, details = {}) {
        const payload = { stage, timeoutMs, ...details };
        warn(tLog('operationTimedOut'), payload);
        return payload;
    }

    function rectSummary(rect) {
        if (!rect) return null;
        return {
            left: Math.round(rect.left * 10) / 10,
            top: Math.round(rect.top * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            bottom: Math.round(rect.bottom * 10) / 10
        };
    }

    function slotDescriptor(slot) {
        return nativeCarousel.diagnostics({ card: slot, totalCount: sourceState?.totalCount }).card;
    }

    function itemSummary(item) {
        if (!item) return null;
        return {
            videoId: item.videoId || '',
            page: pageForItem(item),
            href: item.href || '',
            ariaLabel: item.ariaLabel || ''
        };
    }

    function layoutSummary(layout) {
        if (!layout) return null;
        return {
            columns: layout.columns,
            cardWidth: Math.round((layout.cardWidth || 0) * 10) / 10,
            gap: Math.round((layout.gap || 0) * 10) / 10,
            rowGap: Math.round((layout.rowGap || 0) * 10) / 10,
            gridLeft: Math.round((layout.gridLeft || 0) * 10) / 10,
            gridWidth: Math.round((layout.gridWidth || 0) * 10) / 10,
            sidePadding: Math.round((layout.sidePadding || 0) * 10) / 10,
            sidePaddingLeft: Math.round((layout.sidePaddingLeft ?? layout.sidePadding ?? 0) * 10) / 10,
            sidePaddingRight: Math.round((layout.sidePaddingRight ?? layout.sidePadding ?? 0) * 10) / 10,
            scrollerWidth: Math.round((layout.scrollerWidth || 0) * 10) / 10,
            scrollerHeight: Math.round((layout.scrollerHeight || 0) * 10) / 10,
            widthRatio: Number.isFinite(layout.widthRatio)
                ? Math.round(layout.widthRatio * 100000) / 100000
                : null,
            formulaBased: Boolean(layout.formulaBased)
        };
    }

    function collectRuntimeSnapshot() {
        const section = sourceState?.section, scroller = sourceState?.scroller, track = sourceState?.track;
        const grid = document.getElementById(GRID_ID);
        const statusNode = document.getElementById(STATUS_ID);
        const statusLabel = statusNode?.querySelector?.(`.${STATUS_LABEL_CLASS}`)?.textContent || '';
        const statusMeta = statusNode?.querySelector?.(`.${STATUS_META_CLASS}`)?.textContent || '';
        const statusText = [statusLabel, statusMeta].filter(Boolean).join('  ') || statusNode?.textContent || '';
        const native = nativeSourceDiagnostics(section, scroller, track, true);
        const viewingSummary = sourceState?.watchStatus ? viewing.diagnostics(sourceState.watchStatus) : null;

        return {
            url: location.href,
            browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(),
            netflixLanguage: getNetflixLanguage(),
            displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            status: statusText,
            running,
            runningSessionToken,
            targetSessionActive,
            routeSessionToken: sessionScope.token,
            completed: Boolean(completedSection && completedSection.isConnected),
            selectedPage: native?.selectedPage ?? null,
            pageCount: native?.pageCount ?? null,
            carouselDom: native?.carouselDom ?? null,
            totalCount: sourceState?.totalCount ?? null,
            collectedItems: sourceState?.items?.length ?? 0,
            sourceSlots: native?.sourceSlots ?? 0,
            sourceCards: native?.sourceCards ?? 0,
            currentPageCards: native?.currentPageCards ?? 0,
            gridCards: sourceState?.cloneMap?.size ?? 0,
            performanceWork: collectPerformanceDiagnostics(),
            undoRetention: listMutations.undoDiagnostics(),
            reconciliation: listMutations.deferralDiagnostics(),
            viewingStatus: sourceState?.watchStatus ? {
                completed: gridView.presentation().completedCount,
                unknown: gridView.presentation().unknownCount,
                ...viewingSummary
            } : null,
            sourceScan: native?.sourceScan ?? false,
            sourceParked: native?.sourceParked ?? false,
            sourceGeometryProxy: nativePopup.diagnostics().geometryOwned,
            hoverPresentation: 'netflix-native',
            nativeHoverOwned: nativePopup.diagnostics().replayOwned,
            nativePreviewOwned: nativePopup.diagnostics().previewOwned,
            nativeInteraction: nativePopup.diagnostics(),
            viewOriginalMyList,
            myListSyncMode: 'event-driven',
            pendingMyListMutations: listMutations.pendingDiagnostics(),
            layout: layoutSummary(sourceState?.layout),
            activeVideoId: hover.intent().videoId,
            activePage: hover.intent().page,
            activeClone: hover.intent().clone ? {
                videoId: hover.intent().clone.getAttribute('data-tm-item-video-id') || '',
                page: hover.intent().clone.getAttribute('data-tm-item-page') || '',
                backedPage: hover.intent().clone.getAttribute('data-tm-backed-page') || '',
                hoverReady: hover.intent().clone.getAttribute('data-tm-hover-ready') === 'true',
                connected: Boolean(hover.intent().clone.isConnected),
                rect: rectSummary(hover.intent().clone.getBoundingClientRect?.())
            } : null,
            activeSourceSlot: nativePopup.describeActiveSource(),
            hoverToken: hover.intent().token,
            responsiveRefreshing,
            responsiveSignature: lastResponsiveSignature,
            responsivePageShape: lastPageShape,
            responsiveReason: lastResponsiveReason,
            resizeViewportSignature: sourceState?.resizeViewportSignature || '',
            hoverScrollState: hover.diagnostics().hoverScrollState,
            pointer: { x: hover.intent().pointerX, y: hover.intent().pointerY }
        };
    }

    function collectThumbnailDiagnostics(state = sourceState) {
        const grid = state?.grid;
        if (!state || state !== sourceState || !grid?.isConnected || !(state.cloneMap instanceof Map) ||
            !isRouteSessionActive(sessionScope.token)) return { available: false, reason: 'no-current-grid' };
        const started = performance.now();
        const report = {
            available: true, scope: 'first-image-per-owned-card', limits: { ...THUMBNAIL_DIAGNOSTIC_LIMITS },
            mappedCards: state.cloneMap.size, cardsExamined: 0, truncated: state.cloneMap.size > THUMBNAIL_DIAGNOSTIC_LIMITS.cards,
            detachedCards: 0, cardsWithoutImage: 0, duplicateImagesSkipped: 0, images: 0,
            loading: { lazy: 0, eager: 0, other: 0 }, decoding: { async: 0, sync: 0, other: 0 },
            pixels: { ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 },
            sourceSelection: { current: 0, srcFallback: 0, unresolved: 0, invalidUrl: 0,
                graphqlAssigned: 0, graphqlSelectionMatches: 0, graphqlSelectionDiffers: 0, graphqlSelectionUnresolved: 0 },
            dimensionAttributes: { paired: 0, missingOrPartial: 0 },
            visibility: { renderEligible: 0, filterHidden: 0, collapsedWatched: 0, otherHidden: 0 }
        };
        const seen = new Set();
        const urls = new Set();
        const eligible = [];
        try {
            for (const clone of state.cloneMap.values()) {
                if (report.cardsExamined >= THUMBNAIL_DIAGNOSTIC_LIMITS.cards) break;
                report.cardsExamined++;
                if (!clone?.isConnected || !grid.contains(clone)) { report.detachedCards++; continue; }
                const image = clone.querySelector('img');
                if (!image) { report.cardsWithoutImage++; continue; }
                if (seen.has(image)) { report.duplicateImagesSkipped++; continue; }
                seen.add(image);
                report.images++;
                report.loading[['lazy', 'eager'].includes(image.loading) ? image.loading : 'other']++;
                report.decoding[['async', 'sync'].includes(image.decoding) ? image.decoding : 'other']++;
                const current = image.currentSrc || '';
                const src = image.src || image.getAttribute('src') || '';
                if (image.getAttribute('data-tm-graphql-image') === 'true') {
                    report.sourceSelection.graphqlAssigned++;
                    report.sourceSelection[!current ? 'graphqlSelectionUnresolved' : current === src ?
                        'graphqlSelectionMatches' : 'graphqlSelectionDiffers']++;
                }
                const hasSource = Boolean(current || src || image.getAttribute('srcset'));
                // Complete with intrinsic dimensions does not establish decode/paint completion.
                const status = !hasSource ? 'noSource' : image.complete !== true ? 'pending' :
                    image.naturalWidth > 0 && image.naturalHeight > 0 ? 'ready' : 'completeWithoutPixels';
                report.pixels[status]++;
                report.sourceSelection[current ? 'current' : src ? 'srcFallback' : 'unresolved']++;
                if (current || src) {
                    try {
                        const url = new URL(current || src, location.href);
                        if (url.protocol === 'https:' || url.protocol === 'http:') urls.add(url.href);
                    } catch (_) { report.sourceSelection.invalidUrl++; }
                }
                const width = Number(image.getAttribute('width'));
                const height = Number(image.getAttribute('height'));
                report.dimensionAttributes[Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ?
                    'paired' : 'missingOrPartial']++;
                if (gridOwnsClone(clone, grid)) {
                    report.visibility.renderEligible++;
                    eligible.push({ image, status });
                } else if (clone.getAttribute('data-tm-type-hidden') === 'true') report.visibility.filterHidden++;
                else if (clone.parentElement?.getAttribute('data-tm-watch-grid') === 'true' &&
                    clone.parentElement.parentElement?.open !== true) report.visibility.collapsedWatched++;
                else report.visibility.otherHidden++;
            }
        } catch (_) {
            return { ...report, available: false, reason: 'card-read-failed', elapsedMs: Math.round(performance.now() - started) };
        }
        report.geometry = sampleThumbnailGeometry(eligible);
        report.resourceTiming = collectThumbnailResourceTiming(urls, state.initializationStartedAt);
        report.elapsedMs = Math.round(performance.now() - started);
        // URLs and DOM references stay inside this call; only copied scalar summaries leave it.
        return report;
    }

    function sampleThumbnailGeometry(records) {
        const positions = () => ({ images: 0, ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 });
        const viewport = window.visualViewport;
        const bounds = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
            width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
        const report = {
            available: true, positionAt: 'copy-time', bounds, eligibleImages: records.length, sampleCount: 0, rectReads: 0,
            styleAvailable: typeof getComputedStyle === 'function',
            inViewport: positions(), aboveViewport: positions(), belowViewport: positions(), outsideViewport: positions(), zeroArea: positions(),
            pendingWithImageBox: 0, pendingWithParentBox: 0, imageAspectRatioHint: 0, parentAspectRatioHint: 0, parentBlockPadding: 0,
            imageWidth: { min: null, max: null }, imageHeight: { min: null, max: null }
        };
        const count = Math.min(records.length, THUMBNAIL_DIAGNOSTIC_LIMITS.geometry);
        try {
            for (let index = 0; index < count; index++) {
                // Spread the fixed sample across eligible cards, including both ends of the list.
                const record = records[count === 1 ? 0 : Math.floor(index * (records.length - 1) / (count - 1))];
                report.rectReads++;
                const rect = record.image.getBoundingClientRect();
                const parent = record.image.parentElement;
                let parentRect = null;
                if (parent) { report.rectReads++; parentRect = parent.getBoundingClientRect(); }
                const hasBox = rect.width > 0 && rect.height > 0;
                const position = !hasBox ? 'zeroArea' : rect.bottom <= bounds.top ? 'aboveViewport' :
                    rect.top >= bounds.top + bounds.height ? 'belowViewport' :
                    rect.right > bounds.left && rect.left < bounds.left + bounds.width ? 'inViewport' : 'outsideViewport';
                report[position].images++;
                report[position][record.status]++;
                if (record.status === 'pending') {
                    if (hasBox) report.pendingWithImageBox++;
                    if (parentRect?.width > 0 && parentRect.height > 0) report.pendingWithParentBox++;
                }
                for (const [key, size] of [['imageWidth', rect.width], ['imageHeight', rect.height]]) {
                    if (!Number.isFinite(size)) continue;
                    const value = Math.round(size * 10) / 10;
                    report[key].min = report[key].min === null ? value : Math.min(report[key].min, value);
                    report[key].max = report[key].max === null ? value : Math.max(report[key].max, value);
                }
                if (report.styleAvailable) {
                    const imageStyle = getComputedStyle(record.image);
                    const parentStyle = parent ? getComputedStyle(parent) : null;
                    if (imageStyle?.aspectRatio && imageStyle.aspectRatio !== 'auto') report.imageAspectRatioHint++;
                    if (parentStyle?.aspectRatio && parentStyle.aspectRatio !== 'auto') report.parentAspectRatioHint++;
                    if (parseFloat(parentStyle?.paddingTop) > 0 || parseFloat(parentStyle?.paddingBottom) > 0) report.parentBlockPadding++;
                }
                report.sampleCount++;
            }
        } catch (_) { report.available = false; report.reason = 'read-failed'; }
        // A parent box or dimension hint is evidence to inspect, not proof of reserved artwork space or a layout shift.
        return report;
    }

    function collectThumbnailResourceTiming(urls, initializationStartedAt) {
        const report = {
            available: false, bufferedEntries: 0, examinedEntries: 0, truncated: false, imageEntriesExamined: 0,
            sourcesConsidered: urls.size, matchedEntries: 0, uniqueSourceMatches: 0, sourcesWithoutEntry: urls.size,
            entriesBeforeInitializationSkipped: 0,
            initializationStartKnown: Number.isFinite(initializationStartedAt), cacheDelivery: 0,
            positiveTransferSizeEntries: 0, zeroTransferSizeEntries: 0, unreportedTransferSizeEntries: 0, transferBytesReported: 0,
            fetchDurationMs: { samples: 0, total: 0, mean: null, max: null },
            positionAtRequestKnown: false, imageDecodeMeasured: false, layoutShiftsMeasured: false
        };
        if (typeof performance.getEntriesByType !== 'function') return { ...report, reason: 'unsupported' };
        try {
            const entries = performance.getEntriesByType('resource');
            report.bufferedEntries = entries.length;
            report.truncated = entries.length > THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries;
            const matched = new Set();
            const first = Math.max(0, entries.length - THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries);
            for (let index = entries.length - 1; index >= first; index--) {
                const entry = entries[index];
                report.examinedEntries++;
                if (entry.initiatorType !== 'img') continue;
                report.imageEntriesExamined++;
                if (!urls.has(entry.name)) continue;
                if (report.initializationStartKnown && entry.startTime < initializationStartedAt) {
                    report.entriesBeforeInitializationSkipped++; continue;
                }
                report.matchedEntries++;
                matched.add(entry.name);
                if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                    report.fetchDurationMs.samples++;
                    report.fetchDurationMs.total += entry.duration;
                    report.fetchDurationMs.max = Math.max(report.fetchDurationMs.max ?? 0, entry.duration);
                }
                if (entry.deliveryType === 'cache') report.cacheDelivery++;
                if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) {
                    report.positiveTransferSizeEntries++;
                    report.transferBytesReported += entry.transferSize;
                } else if (entry.transferSize === 0) report.zeroTransferSizeEntries++;
                else report.unreportedTransferSizeEntries++;
            }
            report.uniqueSourceMatches = matched.size;
            report.sourcesWithoutEntry = urls.size - matched.size;
            const durations = report.fetchDurationMs;
            durations.mean = durations.samples ? Math.round(durations.total / durations.samples * 10) / 10 : null;
            durations.total = Math.round(durations.total * 10) / 10;
            if (durations.max !== null) durations.max = Math.round(durations.max * 10) / 10;
            report.available = true;
        } catch (_) { report.reason = 'read-failed'; }
        // Resource history can be incomplete and cross-origin byte fields can be hidden.
        // Fetch duration is not decode/paint time; zero bytes does not establish a cache hit.
        return report;
    }

    async function copyDiagnosticLogs() {
        log(tLog('copyLogsRequested'), collectRuntimeSnapshot());
        try {
            const method = await diagnosticReport.copy();
            log(tLog('copyLogsCompleted'), { method, entries: logger.size() });
            return method;
        } catch (error) {
            warn(tLog('copyLogsFailed'), error);
            throw error;
        }
    }

    function loadSettings() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
            if (typeof parsed.viewOriginalMyList === 'boolean') viewOriginalMyList = parsed.viewOriginalMyList;
            // Rewrite the settings object so obsolete options from older releases are removed.
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ viewOriginalMyList }));
        } catch (_) {}
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ viewOriginalMyList }));
        } catch (_) {}
    }

    function unregisterMenuCommandSafe(id) {
        if (id === null || id === undefined) return;
        try {
            if (typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(id);
        } catch (_) {}
    }

    function refreshMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        unregisterMenuCommandSafe(viewOriginalMenuId);

        viewOriginalMenuId = GM_registerMenuCommand(
            viewOriginalMyList ? tUi('hideOriginalMyList') : tUi('showOriginalMyList'),
            () => {
                viewOriginalMyList = !viewOriginalMyList;
                saveSettings();
                refreshMenuCommands();
                applyOriginalMyListVisibility();
                log(tLog('originalMyListVisibilityChanged'), { enabled: viewOriginalMyList });
            }
        );
    }

    function nativeSourcePresentation(section = sourceState?.section, scroller, track, options = {}) {
        const state = sourceState, sessionToken = sessionScope.token;
        const ownerSection = state?.section, ownerScroller = state?.scroller, ownerTrack = state?.track;
        if (state && state.section === section) {
            if (scroller === undefined) scroller = state.scroller;
            if (track === undefined) track = state.track;
        }
        const lease = nativeCarousel.presentSource({ section, scroller, track, ...options, sessionToken, assertCurrent() {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== ownerSection || state?.scroller !== ownerScroller || state?.track !== ownerTrack) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Native presentation caller changed');
            }
        } });
        if (lease !== nativePresentationLease) nativePresentationLease?.release();
        lease?.assertCurrent();
        nativePresentationLease = lease;
        return lease;
    }

    function markOriginalHeader(section) {
        return nativeSourcePresentation(section)?.anchor || null;
    }

    function applyOriginalMyListVisibility() {
        if (!sourceState?.section && !isTargetPage()) return;
        if (!nativeSourcePresentation(undefined, undefined, undefined, { visible: viewOriginalMyList })) return;
        if (sourceState?.status) {
            layoutFrameStatus(sourceState.status, null, viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function cleanupOldArtifacts() {
        const state = sourceState, sessionToken = sessionScope.token;
        gridView.cleanupArtifacts(() => {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw createRouteSessionCancelledError();
        });
        nativeCarousel.cleanupArtifacts({ sessionToken, assertCurrent() {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Artifact cleanup caller changed');
        } });
    }

    function measureNativeCarouselGap(section) {
        const state = sourceState, sessionToken = sessionScope.token;
        const gap = netflixDom.readRowGap(section, window.innerWidth);
        assertRouteSession(sessionToken);
        if (sourceState !== state) throw createRouteSessionCancelledError();
        return gap;
    }

    function nativeLayoutObservation(section, scroller = null, track = null, mode = 'auto', state = sourceState) {
        const sessionToken = sessionScope.token;
        const ownerSection = state?.section, ownerScroller = state?.scroller, ownerTrack = state?.track;
        const grid = state?.grid, layout = state?.layout, status = state?.status;
        const gridConnected = Boolean(grid?.isConnected);
        return nativeCarousel.measureLayout({ section, scroller, track, mode, sessionToken, assertCurrent() {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== ownerSection || state?.scroller !== ownerScroller ||
                state?.track !== ownerTrack || state?.grid !== grid || state?.layout !== layout || state?.status !== status ||
                (gridConnected && !grid.isConnected)) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Native layout caller was replaced');
            }
        } });
    }

    function placeLegacyFrame(section, scroller, layout, { elapsedMs = null, finalized = false, totalCount = null } = {}) {
        const state = sourceState, sessionToken = sessionScope.token;
        markOriginalHeader(section);

        const geometry = currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(0, totalCount, elapsedMs, finalized));
        const header = markOriginalHeader(section);
        const grid = gridView.mount({ section, anchor: scroller?.isConnected ? scroller : header,
            status, geometry, layout, visible: viewOriginalMyList,
            assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED', 'grid-frame', 'Frame caller changed');
            } });
        syncStatusTypography(section, status);

        return { status, grid, geometry };
    }

    function clearLegacyEmptyState(options) {
        return gridView.clearEmpty(options);
    }

    function applyLegacyEmptyStateGeometry(section, layout) {
        if (!gridView.emptyPresentation().connected || !section || !layout) return;
        const state = sourceState, sessionToken = sessionScope.token;
        const geometry = currentGridGeometry(section, layout);
        gridView.layoutEmpty(geometry, () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw createRouteSessionCancelledError();
        });
    }

    function syncLegacyEmptyState(section, { allowProvisional = false } = {}) {
        const state = sourceState, sessionToken = sessionScope.token;
        const binding = state?.section === section ? nativeCarousel.borrowBinding(section, state.scroller, state.track) : null;
        const geometry = state?.layout ? currentGridGeometry(section, state.layout) : null;
        return gridView.presentEmpty({ section, allowProvisional, geometry, assertCurrent() {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw createRouteSessionCancelledError();
            if (binding) nativeCarousel.assertBinding(binding);
        } });
    }

    function waitForNativeSource(...args) {
        return nativeCarousel.waitForSource(...args);
    }

    function finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, reason = 'empty', admission = null) {
        if (admission) nativeCarousel.assertObservation(admission);
        gridView.clearCards(() => { if (admission) nativeCarousel.assertObservation(admission); });
        const elapsedMs = performance.now() - initializationStarted;
        const frame = placeLegacyFrame(section, scroller, layout, { elapsedMs, finalized: true, totalCount: 0 });
        if (admission) nativeCarousel.assertObservation(admission);
        gridView.setEmpty(true);
        nativeSourcePresentation(section, scroller, track, { phase: 'parked' });
        publishSourceState(attachNativeBinding({
            layout,
            items: [],
            totalCount: 0,
            grid: frame.grid,
            status: frame.status,
            itemMap: new Map(),
            empty: true,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        }, section, scroller || null, track || null));
        attachGridRegistry(sourceState);
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(section, { allowProvisional: true });
        completedSection = section;
        if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
            performanceDiagnostics.nativeRecovery.completed++;
        }
        resetOrderMismatchStateAfterInitialization();
        applyOriginalMyListVisibility();
        resizeObserver?.disconnect();
        const emptyState = sourceState, emptySessionToken = sessionScope.token;
        const emptyBinding = nativeCarousel.borrowBinding(section, scroller, track);
        resizeObserver = new ResizeObserver(() => {
            if (!isRouteSessionActive(emptySessionToken) || sourceState !== emptyState || !emptyState.empty ||
                !frame.grid.isConnected || !nativeCarousel.isBindingCurrent(emptyBinding)) return;
            try {
                withNativeReadScope(() => {
                    const observed = nativeLayoutObservation(section, emptyState.scroller, emptyState.track, 'auto', emptyState);
                    const nextLayout = { ...observed.layout };
                    nextLayout.rowGap = measureNativeCarouselGap(section);
                    nativeCarousel.assertObservation(observed);
                    emptyState.layout = nextLayout;
                    const geometry = applyGridGeometry(section, frame.grid, nextLayout);
                    if (sourceState !== emptyState || !nativeCarousel.isBindingCurrent(emptyBinding)) return;
                    layoutFrameStatus(frame.status, geometry);
                    applyLegacyEmptyStateGeometry(section, nextLayout);
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            }
        });
        resizeObserver.observe(section);
        if (scroller) resizeObserver.observe(scroller);
        log(tLog('emptyLegacyListFinalized'), {
            reason,
            elapsedMs: Math.round(elapsedMs),
            layout: layoutSummary(layout)
        });
    }

    // Viewing status is read separately from native card markup. A shared card
    // template or membership in Continue Watching cannot establish completion.

    function applyManualViewingChoice(state, item) {
        const watch = state.watchStatus, grid = state.grid;
        const assertCurrent = () => {
            viewing.assertCurrent(watch);
            if (sourceState !== state || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected || !state.items.includes(item)) throw createRouteSessionCancelledError();
        };
        if (netflixContext.activeProfile() !== viewing.presentation(watch).profile) {
            syncWatchGroups(state); return;
        }
        const result = viewing.place(watch, String(item.videoId), { assertCurrent });
        assertCurrent();
        const beforeWork = { ...gridView.groupDiagnostics() };
        syncWatchGroups(state, result.changed, 'manual-choice');
        log(tLog('viewingChoiceApplied'), {
            saved: result.saved, action: result.action, targetGroup: result.targetGroup,
            automaticStatus: result.automaticStatus, placement: result.placement,
            restoredAutomatic: result.restoredAutomatic, manualMarkerVisible: result.manualMarkerVisible,
            changedTitles: result.changedTitles, completed: gridView.presentation().completedCount,
            work: Object.fromEntries(Object.entries(gridView.groupDiagnostics())
                .filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, value - beforeWork[key]]))
        });
    }

    function gridOwnsClone(clone, grid) { return gridView.isCardVisible(clone, grid); }

    function cancelGroupHover() {
        hover.cancel('group');
    }

    function syncWatchGroups(state, changedIds = null, reason = 'reconcile') {
        if (sourceState !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus, grid = state.grid;
        const guard = () => {
            viewing.assertCurrent(watch);
            if (sourceState !== state || state.watchStatus !== watch || state.grid !== grid || gridView.root !== grid) throw createRouteSessionCancelledError();
        };
        guard();
        const reconciled = viewing.reconcile(watch, changedIds);
        const ids = reconciled === null || !gridView.presentation().initialized ? null : new Set(reconciled);
        guard();
        gridView.applyViewingChange({ items: state.items || [], changedIds: ids, reason, assertCurrent: guard,
            metadata: { disabled: viewing.presentation(watch).disabled, loading: viewing.presentation(watch).loading,
                manualFailure: viewing.presentation(watch).manualFailure, locale: getUiLocale(), totalCount: state.totalCount,
                initializationElapsedMs: state.initializationElapsedMs },
            readPlacement(item, classify) {
                const id = String(item.videoId);
                return classify ? viewing.placement(watch, id) : { manual: viewing.hasChoice(watch, id) };
            },
            onAction: item => applyManualViewingChoice(state, item), onRefresh: () => refreshViewingStatus(state),
            onRequest: request => syncWatchGroups(state, [], request), onHoverChanged: cancelGroupHover,
            readProtectedCards: () => hover.protectedCards(),
            isProtectedSourceCurrent: () => !nativePopup.diagnostics().geometryOwned || nativePopup.diagnostics().sourceConnected,
            releaseInteraction: handle => nativePopup.retire(handle),
            formatHeader: summary => formatHeaderParts(state.items.length, state.totalCount, state.initializationElapsedMs, true, summary)
        });
        guard(); state.status = gridView.status;
    }

    function bindViewingSession(state, sessionToken, preserve = false) {
        const grid = state.grid, previous = state.watchStatus;
        const watch = viewing.createSession({ previous: preserve ? previous : null,
            sessionToken, readItems: () => state.items || [],
            assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== state || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected) throw createRouteSessionCancelledError();
            },
            onChange: change => syncWatchGroups(state, change.ids, change.reason),
            readPresentation: () => ({ completed: gridView.presentation().completedCount, unknown: gridView.presentation().unknownCount }),
            readWork: collectPerformanceDiagnostics });
        state.watchStatus = watch;
        viewing.dispose(previous); return watch;
    }

    function initializeWatchGroups(state, sessionToken) {
        const watch = bindViewingSession(state, sessionToken);
        viewing.assertCurrent(watch);
        gridView.resetViewing(); viewing.start(watch);
    }

    function refreshViewingStatus(state) {
        if (sourceState === state && state.watchStatus) return viewing.refresh(state.watchStatus);
    }

    function collectViewingSeriesDiagnostics(state) {
        return state?.watchStatus ? viewing.seriesDiagnostics(state.watchStatus) : [];
    }

    async function runConstructionChunks(count, buildItem, assertActive) {
        assertActive();
        let chunkStarted = performance.now();
        let chunkItems = 0;
        for (let index = 0; index < count; index++) {
            if (buildItem(index) === false) return false;
            chunkItems++;
            if (index + 1 < count && (chunkItems >= BUILD_CHUNK_MAX_ITEMS ||
                performance.now() - chunkStarted >= BUILD_CHUNK_BUDGET_MS)) {
                // A timer yields to a new task, allowing input/rendering and route
                // cleanup to run. Promise-only yielding would remain in microtasks.
                await sleep(0);
                assertActive();
                chunkStarted = performance.now();
                chunkItems = 0;
            }
        }
        assertActive();
        return true;
    }


    async function waitForMyListTotalCount(timeout = TOTAL_COUNT_TIMEOUT_MS, sessionToken = null) {
        return listView.waitForInitialCount({ timeout, sessionToken, now: () => performance.now(), pause: sleep,
            pollMs: NATIVE_READY_POLL_MS,
            read: () => ({ available: listData.isAvailable(), count: listData.detectMyListTotalCount() }),
            onTimeout({ available }) {
                const details = { graphqlAvailable: available, graphqlKey: listData.diagnostics().graphqlKey,
                    domGeneration: nativeSourceDiagnostics()?.carouselDom?.generation ?? null };
                logOperationTimeout('total-count-detection', timeout, details);
                return initializationTimeoutError('total-count-detection', timeout, details);
            } });
    }

    function nativeDiscoveryObservation({ bindingOnly = false } = {}) {
        const state = sourceState, sessionToken = sessionScope.token;
        const section = state?.section, scroller = state?.scroller, track = state?.track;
        const grid = state?.grid, layout = state?.layout;
        return nativeCarousel.discoverSource({ bindingOnly, sessionToken, assertCurrent() {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== section || state?.scroller !== scroller || state?.track !== track ||
                state?.grid !== grid || state?.layout !== layout) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Discovery caller was replaced');
            }
        } });
    }

    function normalizeNetflixUiText(value) {
        return String(value || '')
            .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }


    function installEmptyFrameResizeObserver(section) {
        const state = sourceState, sessionToken = sessionScope.token;
        const binding = nativeCarousel.borrowBinding(section, state?.scroller, state?.track);
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!isRouteSessionActive(sessionToken) || sourceState !== state || state.section !== section || !state.empty ||
                !state.grid?.isConnected || !state.status?.isConnected || !nativeCarousel.isBindingCurrent(binding)) return;
            try {
                withNativeReadScope(() => {
                    const observed = nativeLayoutObservation(section, null, null, 'empty', state);
                    const nextLayout = { ...observed.layout };
                    nextLayout.rowGap = measureNativeCarouselGap(section);
                    nativeCarousel.assertObservation(observed);
                    state.layout = nextLayout;
                    const geometry = applyGridGeometry(section, state.grid, nextLayout);
                    if (sourceState !== state || !nativeCarousel.isBindingCurrent(binding)) return;
                    layoutFrameStatus(state.status, geometry, viewOriginalMyList ? (nextLayout.rowGap || 0) : 0);
                    applyLegacyEmptyStateGeometry(section, nextLayout);
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            }
        });
        resizeObserver.observe(section);
    }

    function ensureSyntheticMyListSection(admission) {
        const state = sourceState, sessionToken = sessionScope.token;
        const guard = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw createRouteSessionCancelledError();
            if (admission) nativeCarousel.assertObservation(admission);
        };
        guard();
        const placement = netflixDom.readSyntheticPlacement();
        guard();
        return gridView.ensureSynthetic(placement, guard);
    }

    function moveLegacyFrameToSyntheticEmpty() {
        if (!sourceState) return false;
        const state = sourceState;
        const live = nativeDiscoveryObservation();
        if (live.section && !live.scroller && !live.track) {
            return adoptLiveEmptyMyListSection(live);
        }
        const synthetic = ensureSyntheticMyListSection(live);
        if (!synthetic) return false;
        nativeCarousel.assertObservation(live);
        const status = state.status || document.getElementById(STATUS_ID);
        const grid = state.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const observed = nativeLayoutObservation(synthetic, null, null, 'empty', state);
        const layout = { ...observed.layout };
        layout.rowGap = measureNativeCarouselGap(synthetic);
        nativeCarousel.assertObservation(observed);
        clearLegacyEmptyState({ restoreGrid: false });
        nativeCarousel.assertObservation(observed);
        const geometry = currentGridGeometry(synthetic, layout);
        gridView.mount({ section: synthetic, status, geometry, layout, visible: false,
            assertCurrent: () => nativeCarousel.assertObservation(observed) });
        if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Synthetic layout parent was replaced');
        attachNativeBinding(state, synthetic);
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        gridView.setEmpty(true);

        syncLegacyEmptyState(synthetic, { allowProvisional: true });
        completedSection = synthetic;
        applyOriginalMyListVisibility();
        installEmptyFrameResizeObserver(synthetic);
        log(tLog('legacyFrameMovedToEmptyAnchor'), {
            items: sourceState.items?.length ?? 0
        });
        return true;
    }

    function adoptLiveMyListSection(live) {
        if (!sourceState || !live?.section || !live?.scroller || !live?.track) return false;
        if (sourceState.section === live.section && sourceState.scroller === live.scroller && sourceState.track === live.track) return false;
        nativeCarousel.assertObservation(live);
        const state = sourceState;
        const status = state.status || document.getElementById(STATUS_ID);
        const grid = state.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const observed = nativeLayoutObservation(live.section, live.scroller, live.track, 'auto', state);
        const layout = { ...observed.layout };
        layout.rowGap = measureNativeCarouselGap(live.section);
        nativeCarousel.assertObservation(observed);
        clearSourceAlignment();
        nativeCarousel.assertObservation(observed);
        nativePopup.invalidate();
        nativeCarousel.assertObservation(observed);
        clearLegacyEmptyState({ restoreGrid: false });
        markOriginalHeader(live.section);
        nativeCarousel.assertObservation(observed);
        nativeCarousel.assertObservation(live);
        parkSource(live.section, live.scroller, live.track);
        const geometry = currentGridGeometry(live.section, layout);
        gridView.mount({ section: live.section, anchor: live.scroller, status, geometry, layout, visible: viewOriginalMyList,
            assertCurrent: () => nativeCarousel.assertObservation(observed) });
        if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Incoming layout parent was replaced');
        attachNativeBinding(state, live.section, live.scroller, live.track);
        sourceState.layout = layout;
        sourceState.status = status;
        sourceState.grid = grid;
        sourceState.empty = (sourceState.items?.length ?? 0) === 0;
        if (!sourceState.empty) waitingForNativeEmpty = false;

        syncStatusTypography(live.section, status);
        completedSection = live.section;
        gridView.removeSynthetic(live.section);
        applyOriginalMyListVisibility();

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!grid.isConnected || responsiveRefreshing) return;
            scheduleResponsiveRefresh(140, 'ResizeObserver');
        });
        resizeObserver.observe(live.section);
        resizeObserver.observe(live.scroller);

        log(tLog('nativeMyListSourceAdoptedWithoutRescan'), {
            pages: live.pages,
            selectedPage: live.selectedPage,
            layout: layoutSummary(layout)
        });
        invalidateNativeReadScope();
        return true;
    }

    function adoptLiveEmptyMyListSection(live) {
        if (!sourceState || !live?.section || live.scroller || live.track) return false;
        nativeCarousel.assertObservation(live);
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const state = sourceState;
        const observed = nativeLayoutObservation(live.section, null, null, 'empty', state);
        const layout = { ...observed.layout };
        layout.rowGap = measureNativeCarouselGap(live.section);
        nativeCarousel.assertObservation(observed);
        clearSourceAlignment();
        nativeCarousel.assertObservation(observed);
        nativePopup.invalidate();
        nativeCarousel.assertObservation(observed);
        markOriginalHeader(live.section);

        nativeCarousel.assertObservation(observed);
        nativeCarousel.assertObservation(live);
        const originalAnchor = markOriginalHeader(live.section);
        nativeCarousel.assertObservation(observed);
        nativeCarousel.assertObservation(live);
        const geometry = currentGridGeometry(live.section, layout);
        gridView.mount({ section: live.section, anchor: originalAnchor, status, geometry, layout, visible: viewOriginalMyList,
            assertCurrent: () => nativeCarousel.assertObservation(observed) });

        if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Incoming empty layout parent was replaced');
        attachNativeBinding(state, live.section);
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        gridView.setEmpty(true);
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(live.section, { allowProvisional: true });

        applyLegacyEmptyStateGeometry(live.section, layout);
        syncStatusTypography(live.section, status);

        completedSection = live.section;
        gridView.removeSynthetic(live.section);
        applyOriginalMyListVisibility();
        installEmptyFrameResizeObserver(live.section);

        log(tLog('nativeEmptyMyListSectionAdopted'), {
            layout: layoutSummary(layout),
            originalVisible: viewOriginalMyList
        });
        invalidateNativeReadScope();
        return true;
    }

    function syncLogicalPageModelAfterDelta(reason = 'delta-reindex') {
        const state = sourceState;
        if (!state?.section || !state?.scroller || !state?.track) return false;
        const { section, scroller, track, itemMap } = state;
        const recordOwner = state.items, items = recordOwner || [];
        const totalCount = items.length;
        const assertOwner = () => {
            if (sourceState !== state || state.items !== recordOwner || state.itemMap !== itemMap || items.length !== totalCount ||
                state.section !== section || state.scroller !== scroller || state.track !== track) {
                throw createRouteSessionCancelledError();
            }
        };
        const result = nativeCarousel.refreshMapping({ mode: 'delta', section, scroller, track,
            totalCount, columns: Math.max(1, state.layout?.columns || 1), sessionToken: sessionScope.token,
            assertCurrent: assertOwner, pageHintForVideoId: id => {
                const item = itemMap?.get('v:' + id);
                return item ? pageForItem(item) : undefined;
            } });
        if (result.status !== 'anchored') return false;
        nativeCarousel.assertMapping(result);
        myListCountConvergencePending = true;
        log(tLog('logicalPageModelSynchronizedAfterDelta'), {
            reason, currentPage: result.currentPage, knownPageCount: result.knownPageCount,
            pageCountFinalized: result.pageCountFinalized, pageMappingStale: result.pageMappingStale,
            visibleSignature: result.visibleSignature, visibleIds: result.visibleIds,
            itemIndices: result.itemIndices, logicalIndices: result.logicalIndices, totalCount
        });
        nativeCarousel.assertMapping(result);
        return true;
    }


    function visibleNativeItems(live) {
        if (!live?.scroller || !live?.track) return [];
        const state = sourceState;
        if (state?.scroller !== live.scroller || state?.track !== live.track) {
            throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Visible cards no longer belong to the current parent');
        }
        return withNativeReadScope(() => {
            nativeCarousel.assertObservation(live);
            const observed = nativePageObservation(state);
            const items = observed.cards.map(entry => {
                const item = itemFromSlot(entry.source.slot, live.selectedPage || 0, false);
                nativeCarousel.assertObservation(observed);
                return item;
            }).filter(item => item?.videoId);
            nativeCarousel.assertObservation(observed);
            nativeCarousel.assertObservation(live);
            return items;
        });
    }

    function readMutationLayout(parent, { positionOnly = false } = {}) {
        const runtime = positionOnly ? null : nativeSourceObservation(parent), layout = parent.layout, columns = layout?.columns;
        const sessionToken = sessionScope.token;
        return Object.freeze({ mode: runtime?.mode, columns, assertCurrent() {
            assertRouteSession(sessionToken);
            if (runtime) nativeCarousel.assertObservation(runtime);
            if (sourceState !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw createRouteSessionCancelledError();
        } });
    }

    function readMutationVisibleFacts(live, parent, { order = false } = {}) {
        const sessionToken = sessionScope.token, layout = parent.layout, columns = layout?.columns;
        const assertCurrent = () => {
            assertRouteSession(sessionToken);
            if (live) nativeCarousel.assertObservation(live);
            if (sourceState !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw createRouteSessionCancelledError();
        };
        assertCurrent();
        const ids = order && !live?.pageSignature ? [] : visibleNativeItems(live).map(item => item.videoId);
        assertCurrent();
        return Object.freeze({ ids: Object.freeze(ids), page: live?.selectedPage || 0, columns,
            available: Boolean(live?.pageSignature), assertCurrent });
    }

    function retireMutationCard(record, { correlationId, parent, assertCurrent, onAccepted }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(itemKey(record));
        if (hover.intent().videoId === String(record.videoId) || hover.intent().clone === clone) {
            hover.cancel('source'); assertCurrent();
        }
        const handle = gridView.getCard(record);
        if (handle) gridView.removeCard(handle, { correlationId, assertCurrent, onAccepted });
        else onAccepted();
        assertCurrent();
    }

    function prepareMutationInsertion({ parent, assertCurrent }) {
        assertCurrent();
        const grid = parent.grid || document.getElementById(GRID_ID);
        if (!grid) return false;
        hover.install(grid); assertCurrent(); return true;
    }

    function insertMutationCard(record, options) {
        const { parent, index, assertCurrent } = options;
        assertCurrent();
        const grid = parent.grid || document.getElementById(GRID_ID);
        const before = parent.watchStatus ? null : (grid.children[index] || null);
        return gridView.insertCard(record, { ...options, before });
    }

    function updateMutationCard(record, index, { parent, assertCurrent }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(itemKey(record));
        if (clone?.isConnected) copyItemAttributes(clone, record, index);
        assertCurrent();
    }

    function presentListOrder(change, { parent, assertCurrent }) {
        assertCurrent();
        const grid = parent.grid;
        if (grid && !parent.watchStatus) for (let index = 0; index < change.ordered.length; index++) {
            assertCurrent();
            const record = change.ordered[index], clone = parent.cloneMap?.get(itemKey(record));
            if (!clone) continue;
            const before = grid.children[change.index + index] || null;
            if (before !== clone) gridView.moveCard(gridView.getCard(record), grid, before);
            assertCurrent();
        }
    }

    function presentListChange({ count, empty, logical }, { parent, assertCurrent }) {
        assertCurrent(); parent.empty = empty;
        if (logical && count) { scheduleResponsiveRefresh(140, 'my-list-delta'); assertCurrent(); }
        gridView.setEmpty(empty); assertCurrent();
        waitingForNativeEmpty = empty;
        if (empty) syncLegacyEmptyState(parent.section, { allowProvisional: true });
        else clearLegacyEmptyState();
        assertCurrent(); nativePopup.invalidate(); assertCurrent();
        if (parent.watchStatus) { syncWatchGroups(parent); assertCurrent(); }
        const status = updateStatus(formatHeaderParts(count, count, parent.initializationElapsedMs, true));
        assertCurrent(); parent.status = status;
        if (status && parent.layout) {
            layoutFrameStatus(status, null, viewOriginalMyList && !empty ? (parent.layout.rowGap || 0) : 0);
            assertCurrent();
        }
    }

    function reportListChange(change, { assertCurrent }) {
        assertCurrent();
        if (change.kind === 'order') log(tLog('legacyVisibleOrderAligned'), { page: change.page, ids: change.ids });
        else {
            mutationSourceRecoveryPending = true;
            if (change.kind === 'remove') log(tLog('legacyItemRemovedByDifferentialUpdate'), {
                reason: change.reason, removed: itemSummary(change.record), remaining: change.count });
            else log(tLog('legacyItemAddedByDifferentialUpdate'), {
                reason: change.reason, index: change.index, added: itemSummary(change.record), total: change.count });
        }
        assertCurrent();
    }

    function findNativeMyListItemByVideoId(videoId, liveState = null) {
        const discovery = liveState || nativeDiscoveryObservation();
        return nativeCarousel.captureMountedItem({ discovery, videoId });
    }

    function findAnyStandardCardItemByVideoId(videoId) {
        const wanted = String(videoId);
        for (const card of document.querySelectorAll(NETFLIX_DOM_SELECTORS.standardCardWithHref)) {
            if (card.closest(`#${GRID_ID}`)) continue;
            const href = card.href || card.getAttribute('href') || '';
            if (videoIdFromHref(href) !== wanted) continue;
            const slot = card.closest(NETFLIX_DOM_SELECTORS.virtualSlot);
            if (!slot) continue;
            const item = itemFromSlot(slot, 0);
            if (item?.videoId === wanted) return item;
        }
        return null;
    }


    function restartInitializationForPopulatedNativeMyList(live, reason = 'late-populated-source') {
        if (!sourceState?.empty || !live?.section || !live?.scroller || !live?.track) return false;
        const visibleItems = visibleNativeItems(live);
        if (!visibleItems.length) return false;

        log(tLog('populatedNativeMyListDetectedAfterEmpty'), {
            reason,
            pages: live.pages,
            selectedPage: live.selectedPage,
            visibleItems: visibleItems.length
        });
        nativeCarousel.assertObservation(live);

        const sessionToken = sessionScope.token;
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveDeferral?.ticket.release({ resume: false }); responsiveDeferral = null;
        responsiveRefreshing = false;
        completedSection = null;
        nativeCarousel.clearBinding();
        publishSourceState(null);
        waitingForNativeEmpty = false;
        missingSectionSince = 0;
        lastResponsiveSignature = '';
        lastPageShape = '';
        scheduleRun(0, sessionToken);
        return true;
    }

    function ensureLiveNativeBinding(reason = 'live-check', bindingOnly = false) {
        if (!sourceState || !isTargetPage()) return null;
        const owner = sourceState;
        const sessionToken = sessionScope.token;
        const assertParent = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== owner) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Adoption parent was replaced');
        };
        try {
            if (bindingOnly && !waitingForNativeEmpty && !sourceState.empty) {
                // Observer callbacks need element identity, not page geometry, React
                // indices, or counts when Netflix still owns the same mounted source.
                const binding = nativeDiscoveryObservation({ bindingOnly: true });
                nativeCarousel.assertObservation(binding);
                if (binding.section && binding.scroller && binding.track && binding.matchesBinding) return binding;
            }
            let live = nativeDiscoveryObservation();

            if (waitingForNativeEmpty && (sourceState.items?.length ?? 0) === 0) {
                if (live.section && !live.scroller && !live.track) {
                    const emptyState = gridView.emptyPresentation();
                    const alreadyNative = (
                        sourceState.section === live.section &&
                        !sourceState.scroller &&
                        !sourceState.track &&
                        emptyState.source === 'native'
                    );
                    if (!alreadyNative) adoptLiveEmptyMyListSection(live);
                    assertParent(); live = nativeDiscoveryObservation();
                    return live;
                }

                if (!live.section) {
                    // During a 1 -> 0 transition Netflix can briefly remove the native My
                    // List section before mounting its empty section. Do not insert our own
                    // section into the React-managed sibling list; that can interfere with
                    // Netflix's reconciliation and make the native empty frame disappear.
                    return live;
                }

                // Netflix can leave the last native card mounted briefly after the click.
                // Do not re-adopt that stale populated carousel over the immediate 0-item
                // legacy presentation. The document observer will call us again as soon as
                // the native empty section replaces it.
                const emptyState = gridView.emptyPresentation();
                if (!emptyState.connected) {
                    syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
                }
                nativeCarousel.assertObservation(live);
                return live;
            }

            if (live.section && live.scroller && live.track &&
                sourceState.empty && (sourceState.items?.length ?? 0) === 0) {
                if (restartInitializationForPopulatedNativeMyList(live, reason)) return null;
            }

            if (live.section && live.scroller && live.track && !live.matchesBinding) {
                const previous = {
                    sectionConnected: Boolean(sourceState.section?.isConnected),
                    scrollerConnected: Boolean(sourceState.scroller?.isConnected),
                    trackConnected: Boolean(sourceState.track?.isConnected),
                    sameSection: sourceState.section === live.section,
                    sameScroller: sourceState.scroller === live.scroller,
                    sameTrack: sourceState.track === live.track
                };
                if (adoptLiveMyListSection(live)) {
                    log(tLog('nativeMyListBindingRefreshed'), {
                        reason,
                        pages: live.pages,
                        selectedPage: live.selectedPage,
                        previous
                    });
                }
                assertParent(); live = nativeDiscoveryObservation();
            } else if (live.section && !live.scroller && !live.track && (sourceState.items?.length ?? 0) === 0) {
                const emptyState = gridView.emptyPresentation();
                const alreadyNative = (
                    sourceState.section === live.section &&
                    !sourceState.scroller &&
                    !sourceState.track &&
                    emptyState.source === 'native'
                );
                if (!alreadyNative) {
                    adoptLiveEmptyMyListSection(live);
                    assertParent(); live = nativeDiscoveryObservation();
                }
            } else if (!live.section && (sourceState.items?.length ?? 0) === 0 && sourceState.section?.id !== SYNTHETIC_SECTION_ID) {
                if (!waitingForNativeEmpty) {
                    moveLegacyFrameToSyntheticEmpty();
                    assertParent(); live = nativeDiscoveryObservation();
                }
            }
            nativeCarousel.assertObservation(live);
            return live;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            return null;
        }
    }

    function refreshNativeSectionAfterDelta() {
        return ensureLiveNativeBinding('delta-refresh');
    }

    function handleObservedMyListToggleClick(event) {
        if (!isTargetPage() || !sourceState) return;
        listMutations.observeClick(() => {
            const membership = netflixDom.describeMembershipClick(event, { activeVideoId: hover.intent().videoId });
            return { membership, toastAction: !membership && netflixDom.describeToastActionClick(event) };
        });
    }

    function updateStatus(content) {
        return gridView.updateStatus(content);
    }

    function hideOrderMismatchDialog() {
        gridView.hideMismatch();
        orderMismatchDialogOpen = false;
    }

    function resetOrderMismatchStateAfterInitialization() {
        hideOrderMismatchDialog();
        orderMismatchDismissed = false;
        orderMismatchReinitializing = false;
    }

    async function reinitializeAfterOrderMismatch() {
        if (orderMismatchReinitializing || running || !isTargetPage() || !targetSessionActive) return;
        const sessionToken = sessionScope.token;
        const state = sourceState;
        orderMismatchReinitializing = true;
        orderMismatchDismissed = true;
        hideOrderMismatchDialog();

        hover.cancel('source');

        log(tLog('manualReinitializationRequested'), {
            selectedPage: nativeSourceDiagnostics()?.selectedPage ?? null,
            items: sourceState?.items?.length ?? null
        });

        try {
            // Reinitialization must begin from Netflix's first native My List page.
            // Keep the current source state alive until page 0 is confirmed so the
            // logical carousel can still resolve its native page number correctly.
            const { section, scroller, track } = state || {};
            if (!section?.isConnected || !scroller?.isConnected) {
                throw initializationError(
                    'REINITIALIZATION_SOURCE_UNAVAILABLE',
                    'return-native-my-list-to-start',
                    'The native My List carousel is unavailable before reinitialization'
                );
            }

            const nativeOwner = nativeCarousel.borrowBinding(section, scroller, track);
            const assertCurrent = () => {
                assertRouteSession(sessionToken);
                nativeCarousel.assertBinding(nativeOwner);
                if (sourceState !== state || state.section !== section || state.scroller !== scroller || state.track !== track) {
                    throw createRouteSessionCancelledError();
                }
            };
            assertCurrent();
            try { await Promise.resolve(responsiveRefreshPromise); } catch (_) {}
            await nativeCarousel.whenNavigationIdle();
            assertCurrent();
            const before = nativeSourceObservation(state, { position: true });
            const fromPage = before.position.page;
            const returnedPage = await goToPage(section, scroller, 0, null, sessionToken);
            assertCurrent();
            const after = nativeSourceObservation(state, { position: true });
            nativeCarousel.assertObservation(after);
            if (returnedPage !== 0 || after.position.page !== 0) {
                throw initializationError(
                    'REINITIALIZATION_START_PAGE_NOT_REACHED',
                    'return-native-my-list-to-start',
                    'Could not return the native My List carousel to the first page',
                    { fromPage, returnedPage, selectedPage: after.position.page }
                );
            }

            // Fully discard the existing My List for Netflix session using the same
            // teardown path as a route leave, then start a fresh normal session.
            assertCurrent();
            suspendTargetSession('order-mismatch-reinitialize');
            if (!isTargetPage()) return;
            startTargetSession('order-mismatch-reinitialize');
        } catch (error) {
            if (!isRouteSessionCancelledError(error) && error?.code !== 'NATIVE_SOURCE_REPLACED') {
                orderMismatchDismissed = false;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || 'order-mismatch-reinitialize',
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, sourceState?.totalCount ?? null));
            }
        } finally {
            orderMismatchReinitializing = false;
        }
    }

    function showOrderMismatchDialog(item, expectedPage, visibleIds = []) {
        if (orderMismatchDismissed || orderMismatchDialogOpen || orderMismatchReinitializing) return;
        const state = sourceState, sessionToken = sessionScope.token;
        const detail = { item: itemSummary(item), expectedPage, visibleIds: [...visibleIds] };
        gridView.showMismatch({ message: tUi('orderChangedPrompt'), acceptLabel: tUi('orderChangedOk'),
            cancelLabel: tUi('orderChangedCancel'), assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== state) throw createRouteSessionCancelledError();
            }, onAccept() {
                log(tLog('orderMismatchPromptAccepted'), detail);
                void reinitializeAfterOrderMismatch();
            }, onCancel() {
                orderMismatchDismissed = true;
                hideOrderMismatchDialog();
                log(tLog('orderMismatchPromptCancelled'), detail);
            } });
        orderMismatchDialogOpen = true;
        log(tLog('orderMismatchPromptShown'), detail);
    }

    function layoutFrameStatus(status, geometry = null, rowGap) {
        const state = sourceState, sessionToken = sessionScope.token;
        const section = state?.section, scroller = state?.scroller, track = state?.track;
        const grid = state?.grid, layout = state?.layout, previousStatus = state?.status;
        gridView.layoutStatus(status, geometry, rowGap, () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== section || state?.scroller !== scroller ||
                state?.track !== track || state?.grid !== grid || state?.layout !== layout || state?.status !== previousStatus) {
                throw createRouteSessionCancelledError();
            }
        });
    }

    function syncStatusTypography(section, status) {
        if (!status) return;
        const state = sourceState, sessionToken = sessionScope.token;
        const typography = netflixDom.readHeadingTypography(section);
        assertRouteSession(sessionToken);
        if (sourceState !== state) throw createRouteSessionCancelledError();
        gridView.applyStatusTypography(status, typography, () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state) throw createRouteSessionCancelledError();
        });
    }

    function nativeSourceDiagnostics(section = sourceState?.section, scroller = sourceState?.scroller, track = sourceState?.track, discover = false) {
        return nativeCarousel.diagnostics({ source: { section, scroller, track, discover } }).source;
    }

    function nativeSourceObservation(state = sourceState, { count, provisionalTotalCount, position, presentation } = {}) {
        if (!state?.section) return null;
        const { section, scroller, track } = state;
        const sessionToken = sessionScope.token;
        return nativeCarousel.observeSource({ section, scroller, track, sessionToken, count, provisionalTotalCount, position, presentation,
            assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== state) throw createRouteSessionCancelledError();
            } });
    }

    function nativePageObservation(state = sourceState, { template = false } = {}) {
        const { section, scroller, track, totalCount, layout } = state;
        const sessionToken = sessionScope.token;
        return nativeCarousel.pageCards({ section, scroller, track, totalCount, columns: layout?.columns,
            window: 'current', template, sessionToken, assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== state) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Native card observation parent was replaced');
            } });
    }

    function goToPage(...args) {
        return nativeCarousel.navigateTo(...args);
    }

    function collectMountedSinglePageItems(bootstrap, totalCount, columns, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (targetSessionEntryKind !== 'spa' || !targetSessionReason.startsWith('route:')) {
            return { items: null, reason: 'proof-or-entry-no-longer-valid' };
        }
        return nativeCarousel.collect({ mode: 'mounted-single-page', bootstrap, totalCount, columns, sessionToken,
            section: sourceState?.section, scroller: sourceState?.scroller, track: sourceState?.track });
    }

    async function tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken = null) {
        assertRouteSession(sessionToken);
        // Only normal SPA entry admits mounted reuse; manual recovery keeps fresh data.
        if (targetSessionEntryKind !== 'spa' || !targetSessionReason.startsWith('route:')) return null;
        return nativeCarousel.mountedBootstrap({ section, scroller, track, sessionToken });
    }

    function waitForNativeCarouselReady(section, scroller, track, sessionToken = null, options = {}) {
        const owner = sourceState;
        return nativeCarousel.prepareSource({ section, scroller, track, sessionToken,
            fastSinglePageTotalCount: options.fastSinglePageTotalCount,
            assertCurrent() {
                assertRouteSession(sessionToken);
                if (sourceState !== owner) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation',
                    'Page session source changed during native preparation');
            } });
    }

    function waitStableCurrentPage(...args) {
        return nativeCarousel.stablePage(...args);
    }


    function itemKey(item) {
        return item.videoId ? `v:${item.videoId}` : `h:${item.href}`;
    }

    function itemKeyFromCard(card) {
        const href = card?.href || card?.getAttribute?.('href') || '';
        if (!href) return '';
        const videoId = videoIdFromHref(href);
        return videoId ? `v:${videoId}` : `h:${href}`;
    }

    function pageItemKeys(items, page) {
        return new Set(items.filter(item => pageForItem(item) === page).map(itemKey).filter(Boolean));
    }

    async function ensureFreshIndicatorPageZeroAnchor(section, scroller, track, firstVideoId, sessionToken = null) {
        return nativeCarousel.anchorPageZero({ section, scroller, track, firstVideoId, sessionToken,
            columns: sourceState?.layout?.columns });
    }

    function isResizeResponsiveReason(reason) {
        return reason === 'ResizeObserver' || reason === 'responsive-resize-retry';
    }

    function orderMismatchPromptSuppressionState() {
        const resizePending =
            isResizeResponsiveReason(lastResponsiveReason) &&
            responsiveRefreshTimer !== null;
        const resizeRunning =
            responsiveRefreshing &&
            isResizeResponsiveReason(activeResponsiveReason);

        let nativeCountState = null;
        let nativeCountConverged = false;
        if (myListCountConvergencePending && sourceState?.scroller?.isConnected && sourceState?.track?.isConnected) {
            const observation = nativeSourceObservation(sourceState, { count: 'optional' });
            nativeCountState = observation.count;
            nativeCarousel.assertObservation(observation);
            nativeCountConverged =
                Number.isSafeInteger(nativeCountState.totalCount) &&
                nativeCountState.totalCount === (sourceState.items?.length ?? sourceState.totalCount ?? 0);
            if (nativeCountConverged) myListCountConvergencePending = false;
        }

        return {
            suppress: Boolean(resizePending || resizeRunning || myListCountConvergencePending),
            resizePending,
            resizeRunning,
            myListCountConvergencePending,
            nativeCountConverged,
            legacyTotalCount: sourceState?.items?.length ?? sourceState?.totalCount ?? null,
            nativeTotalCount: nativeCountState?.totalCount ?? null,
            nativeCountReadings: nativeCountState?.readings || [],
            nativeCountUniqueReadings: nativeCountState?.uniqueReadings || []
        };
    }

    async function collectAllItems(section, scroller, track, totalCount, sessionToken = null) {
        const state = sourceState;
        const result = await nativeCarousel.collect({ section, scroller, track, totalCount,
            columns: state?.layout?.columns, sessionToken, onProgress(facts) {
                if (sourceState !== state) return;
                if (facts.initialPage !== undefined && state) state.initialPage = facts.initialPage;
                if (facts.collectedCount !== undefined) {
                    if (state) ensureListMembership(state).observeCount({ collectedCount: facts.collectedCount });
                    updateStatus(formatHeaderParts(facts.collectedCount, totalCount, null));
                }
            } });
        return result.items;
    }

    function normalizeClone(slot) {
        gridView.normalizeCard(slot);
    }

    function currentGridGeometry(section, layout) {
        return withNativeReadScope(() => {
            const observed = nativeLayoutObservation(section, null, null, 'bounds');
            return gridView.geometry({ bounds: observed.bounds, viewportWidth: observed.viewportWidth }, layout,
                () => nativeCarousel.assertObservation(observed));
        });
    }

    function applyGridGeometry(section, grid, layout) {
        return gridView.applyGeometry(grid, currentGridGeometry(section, layout), layout);
    }


    function findMountedSourceSlot(track, item, activeOnly = false) {
        return nativeCarousel.sample(() => nativeCarousel.mountedCard({ section: sourceState?.section,
            scroller: sourceState?.scroller, track, item: { href: item.href, videoId: item.videoId }, activeOnly,
            sessionToken: sessionScope.token })?.slot || null);
    }

    function findActiveSourceSlot(item) {
        ensureLiveNativeBinding('hover-source-direct');
        if (!sourceState?.track?.isConnected || !sourceState?.scroller?.isConnected) return null;
        return findMountedSourceSlot(sourceState.track, item, true);
    }

    async function resolveExpectedPageSourceItem(item, expectedPage = pageForItem(item), token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
        ensureLiveNativeBinding('hover-expected-page-start');
        hover.releaseInteraction();
        const state = sourceState;
        const result = await nativeCarousel.resolveCard({ section: state?.section, scroller: state?.scroller,
            track: state?.track, item: { videoId: item.videoId, href: item.href }, expectedPage,
            totalCount: state?.items?.length || 0, columns: state?.layout?.columns || 1,
            pageItemCount: pageItemKeys(state?.items || [], expectedPage).size, hoverToken: token, sessionToken });
        assertRouteSession(sessionToken);
        if (sourceState !== state) return { status: 'unknown', reason: 'native-binding-lost-after-page-move' };
        if (result.status === 'found') {
            return { ...result, get slot() { return result.source.slot; },
                get slots() { return nativeCarousel.sample(() => result.sources.map(source => source.slot)); } };
        }
        if (result.status !== 'mismatch') return result;
        const positionMismatch = firstVisibleNativePositionMismatch(result.visibleCards);
        if (!positionMismatch) return result;
        log('Native My List position mismatch detected before source search', {
            item: itemSummary(positionMismatch.item), expectedPage,
            expectedIndex: positionMismatch.deviation.expectedIndex, actualIndex: positionMismatch.deviation.actualIndex,
            delta: positionMismatch.deviation.delta, threshold: ORDER_MISMATCH_POSITION_THRESHOLD, visibleIds: result.visibleIds });
        return { ...result, reason: 'position-deviation-before-source-search', positionMismatch };
    }

    function nativePositionDeviation(item, source) {
        if (!item || !source || !sourceState?.items?.length) return null;
        nativeCarousel.assertSource(source);
        const expectedIndex = sourceState.items.indexOf(item);
        const actualIndex = source.itemIndex;
        if (!Number.isSafeInteger(expectedIndex) || expectedIndex < 0 ||
            !Number.isSafeInteger(actualIndex) || actualIndex < 0) {
            return null;
        }
        return {
            expectedIndex,
            actualIndex,
            delta: actualIndex - expectedIndex,
            absoluteDelta: Math.abs(actualIndex - expectedIndex)
        };
    }

    function firstVisibleNativePositionMismatch(cards) {
        for (const card of cards || []) {
            const visibleItem = sourceState?.items?.find(item => card.videoId
                ? String(item.videoId) === card.videoId : item.href === card.href);
            if (!visibleItem) continue;
            const expectedIndex = sourceState.items.indexOf(visibleItem);
            const actualIndex = card.itemIndex;
            if (!Number.isSafeInteger(actualIndex) || actualIndex < 0) continue;
            const delta = actualIndex - expectedIndex;
            const deviation = { expectedIndex, actualIndex, delta, absoluteDelta: Math.abs(delta) };
            if (deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) continue;
            return { item: visibleItem, deviation };
        }
        return null;
    }

    function rejectLargeNativePositionDeviation(item, source, expectedPage, visibleIds = []) {
        const state = sourceState;
        const deviation = nativePositionDeviation(item, source);
        if (!deviation || deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) return false;
        const actualVideoId = source.videoId;
        const diagnostic = {
            item: itemSummary(item),
            expectedPage,
            expectedIndex: deviation.expectedIndex,
            actualIndex: deviation.actualIndex,
            delta: deviation.delta,
            threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
            source: slotDescriptor(source.slot)
        };
        warn('Native My List position deviates beyond order-mismatch threshold', diagnostic);
        nativeCarousel.assertSource(source);
        if (sourceState !== state) throw createRouteSessionCancelledError();
        showOrderMismatchDialog(
            item,
            expectedPage,
            [...new Set([...visibleIds, actualVideoId].filter(Boolean))]
        );
        return true;
    }

    async function refreshStaleSourceOnPreferredPage(item, preferredPage = pageForItem(item), token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token)) return null;
        ensureLiveNativeBinding('hover-stale-refresh-start');
        const state = sourceState;
        const result = await nativeCarousel.resolveCard({ mode: 'preferred-refresh', section: state?.section,
            scroller: state?.scroller, track: state?.track, item: itemSummary(item), preferredPage,
            hoverToken: token, sessionToken });
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token) || sourceState !== state || result.status !== 'found') return null;
        return { ...result, get slot() { return result.source.slot; } };
    }

    async function locateActiveSourceItem(item, preferredPage = pageForItem(item), token = null, sessionToken = null, repairLogicalMapping = true, maxRadius = null) {
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token)) return null;
        ensureLiveNativeBinding('hover-locate-start');
        const state = sourceState;
        const result = await nativeCarousel.resolveCard({ mode: 'search', section: state?.section,
            scroller: state?.scroller, track: state?.track, item: itemSummary(item), preferredPage,
            columns: state?.layout?.columns || 1, repairLogicalMapping, maxRadius, hoverToken: token, sessionToken });
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token) || sourceState !== state || result.status !== 'found') return null;
        return nativeCarousel.sample(() => {
            if (repairLogicalMapping) {
                for (let index = 0; index < result.visibleCards.length; index++) {
                    assertRouteSession(sessionToken);
                    if (hover.isCancelled(token) || sourceState !== state) return null;
                    nativeCarousel.assertSource(result.source);
                    nativeCarousel.assertSource(result.sources[index]);
                    const visibleItem = state.itemMap?.get(itemKey(result.visibleCards[index]));
                    if (!visibleItem || pageForItem(visibleItem) === result.page) continue;
                    const oldPage = pageForItem(visibleItem);
                    setPageForItem(visibleItem, result.page, state);
                    const visibleClone = findGridClone(visibleItem);
                    if (visibleClone) copyItemAttributes(visibleClone, visibleItem);
                    log(tLog('itemPageMappingCorrected'), { item: itemSummary(visibleItem), oldPage,
                        actualPage: result.page, reason: 'logical-visible-page-repair' });
                }
            }
            assertRouteSession(sessionToken);
            if (hover.isCancelled(token) || sourceState !== state) return null;
            nativeCarousel.assertSource(result.source);
            return { ...result, get slot() { return result.source.slot; } };
        });
    }

    function copyItemAttributes(target, item, index = null) {
        const handle = gridView.getCard(item);
        if (!handle || handle.node !== target) throw initializationError('GRID_CARD_RETIRED', 'grid-cards', 'Card record changed');
        gridView.updateCard(handle, item, index);
    }

    function findGridClone(item) {
        return gridView.getCard(item)?.node || null;
    }

    function attachGridRegistry(state) {
        Object.defineProperty(state, 'cloneMap', { enumerable: true, configurable: true, get: () => gridView.cards });
        return state;
    }


    function findItemForSourceSlot(slot) {
        const card = slot?.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card || !sourceState?.itemMap) return null;
        return sourceState.itemMap.get(itemKeyFromCard(card)) || null;
    }


    async function prepareMountedPage(page, targetItem = null, triggerEvent = null, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hover.isCancelled(token)) return null;
        let targetCard = targetItem ? gridView.getCard(targetItem) : null;
        if (targetItem) gridView.assertCard(targetCard);
        hover.count('hoverPreparation', 'calls');
        const hoverTiming = hover.captureTiming();
        ensureLiveNativeBinding('hover-prepare-start');
        const state = sourceState;
        const { section, scroller, track } = state || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'native-binding-unavailable',
                targetItem: itemSummary(targetItem),
                requestedPage: page
            });
            return null;
        }
        const nativeOwner = nativeCarousel.borrowBinding(section, scroller, track);
        const records = state.items, itemMap = state.itemMap, cloneMap = state.cloneMap, grid = state.grid;
        const assertCurrent = () => {
            assertRouteSession(sessionToken);
            nativeCarousel.assertBinding(nativeOwner);
            if (sourceState !== state || state.items !== records || state.itemMap !== itemMap ||
                state.cloneMap !== cloneMap || state.grid !== grid) throw createRouteSessionCancelledError();
        };
        const beforeView = targetItem ? null : nativeCarousel.pageCards({ section, scroller, track,
            binding: nativeOwner, totalCount: state.totalCount, columns: state.layout?.columns, sessionToken, assertCurrent });
        const beforeSignature = beforeView?.signature || '';
        if (beforeView) nativeCarousel.assertObservation(beforeView);
        const started = performance.now();

        log(tLog('nativePagePreparationStarted'), {
            requestedPage: page,
            targetItem: itemSummary(targetItem),
            triggerEvent: triggerEvent?.type || '',
            token,
            hoverToken: hover.intent().token
        });

        let targetSourceSlot = null;
        let resolvedSource = null;
        let actualPage = page;
        let staleSourceRecovery = false;

        if (targetItem) {
            let located = await resolveExpectedPageSourceItem(targetItem, page, token, sessionToken);
            if (token !== null && token !== hover.intent().token) {
                log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-expected-page-check', token, hoverToken: hover.intent().token });
                return null;
            }

            if (located?.status === 'mismatch') {
                if (located.positionMismatch) {
                    warn('Native My List position mismatch escalated without source search', {
                        targetItem: itemSummary(targetItem),
                        mismatchItem: itemSummary(located.positionMismatch.item),
                        requestedPage: page,
                        expectedIndex: located.positionMismatch.deviation.expectedIndex,
                        actualIndex: located.positionMismatch.deviation.actualIndex,
                        delta: located.positionMismatch.deviation.delta,
                        threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
                        visibleIds: located.visibleIds || []
                    });
                    showOrderMismatchDialog(
                        located.positionMismatch.item || targetItem,
                        page,
                        located.visibleIds || []
                    );
                    return null;
                }
                // Immediately after a manual reinitialization, Hawkins can expose a
                // stable adjacent-page window for one render cycle. Give the target
                // one bounded re-resolution before treating it as a real order change.
                log('Retrying expected native page after transient page mismatch', {
                    targetItem: itemSummary(targetItem),
                    requestedPage: page,
                    visibleIds: located.visibleIds || []
                });
                await sleep(120);
                located = await resolveExpectedPageSourceItem(targetItem, page, token, sessionToken);
                if (token !== null && token !== hover.intent().token) {
                    log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-mismatch-retry', token, hoverToken: hover.intent().token });
                    return null;
                }
                if (located?.positionMismatch) {
                    warn('Native My List position mismatch escalated without source search', {
                        targetItem: itemSummary(targetItem),
                        mismatchItem: itemSummary(located.positionMismatch.item),
                        requestedPage: page,
                        expectedIndex: located.positionMismatch.deviation.expectedIndex,
                        actualIndex: located.positionMismatch.deviation.actualIndex,
                        delta: located.positionMismatch.deviation.delta,
                        threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
                        visibleIds: located.visibleIds || []
                    });
                    showOrderMismatchDialog(
                        located.positionMismatch.item || targetItem,
                        page,
                        located.visibleIds || []
                    );
                    return null;
                }
            }

            assertCurrent();
            if (located?.status === 'found' && located.slot) {
                if (rejectLargeNativePositionDeviation(targetItem, located.source, page)) return null;
                mutationSourceRecoveryPending = false;
                targetSourceSlot = located.slot;
                resolvedSource = located.source || null;
                actualPage = located.page;
            } else {
                const runtime = nativeSourceObservation();
                const staleLogicalMapping = runtime?.mode === 'logical' && runtime.needsRemapping;
                const mutationRecoveryPending = mutationSourceRecoveryPending;
                const expectedPageMismatch = located?.status === 'mismatch';
                if (staleLogicalMapping || mutationRecoveryPending || expectedPageMismatch) {
                    log('Hover expected-page mapping is stale; searching live native source', {
                        targetItem: itemSummary(targetItem),
                        requestedPage: page,
                        locatedStatus: located?.status || null,
                        locatedReason: located?.reason || null,
                        mutationRecoveryPending,
                        expectedPageMismatch,
                        visibleIds: located?.visibleIds || []
                    });
                    let repaired = await refreshStaleSourceOnPreferredPage(targetItem, page, token, sessionToken);
                    if (token !== null && token !== hover.intent().token) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-refresh', token, hoverToken: hover.intent().token });
                        return null;
                    }
                    if (!repaired?.slot) {
                        repaired = await locateActiveSourceItem(
                            targetItem,
                            page,
                            token,
                            sessionToken,
                            expectedPageMismatch || mutationRecoveryPending,
                            mutationSourceRecoveryPending ? null : 2
                        );
                    }
                    if (token !== null && token !== hover.intent().token) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-search', token, hoverToken: hover.intent().token });
                        return null;
                    }
                    assertCurrent();
                    if (repaired?.slot) {
                        if (rejectLargeNativePositionDeviation(targetItem, repaired.source, page, located?.visibleIds || [])) return null;
                        mutationSourceRecoveryPending = false;
                        staleSourceRecovery = true;
                        targetSourceSlot = repaired.slot;
                        actualPage = repaired.page;
                        resolvedSource = repaired.source || null;
                        trace(() => ['Hover source recovered from stale logical page mapping', {
                            targetItem: itemSummary(targetItem),
                            requestedPage: page,
                            actualPage,
                            source: slotDescriptor(targetSourceSlot)
                        }]);
                    } else {
                        const promptSuppression = orderMismatchPromptSuppressionState();
                        if (promptSuppression.suppress) {
                            log(tLog('nativePagePreparationCancelled'), {
                                reason: 'logical-page-mapping-stale-source-not-found-transient',
                                targetItem: itemSummary(targetItem),
                                requestedPage: page,
                                locatedReason: located?.reason || null,
                                visibleIds: located?.visibleIds || [],
                                promptSuppression
                            });
                            return null;
                        }

                        log('Stale logical page recovery exhausted; escalating to reinitialization prompt', {
                            targetItem: itemSummary(targetItem),
                            requestedPage: page,
                            locatedReason: located?.reason || null,
                            visibleIds: located?.visibleIds || [],
                            promptSuppression
                        });
                        showOrderMismatchDialog(targetItem, page, located?.visibleIds || []);
                        return null;
                    }
                } else {
                    log(tLog('nativePagePreparationCancelled'), {
                        reason: located?.reason || 'expected-page-check-inconclusive',
                        targetItem: itemSummary(targetItem),
                        requestedPage: page
                    });
                    return null;
                }
            }
        } else {
            await goToPage(section, scroller, page, token, sessionToken, true);
            if (token !== null && token !== hover.intent().token) return null;
            await waitStableCurrentPage(scroller, track, {
                previousSignature: beforeSignature,
                minElapsed: 160,
                sessionToken,
                hoverToken: token
            });
            if (hover.isCancelled(token)) return null;
            assertCurrent();
            actualPage = nativeSourceObservation(state, { position: true }).position.page;
        }

        trace(() => {
            const native = nativeSourceDiagnostics(section, scroller, track);
            return [tLog('nativePagePreparationPositionResolved'), {
                requestedPage: page,
                actualPage,
                selectedPage: native?.selectedPage ?? null,
                currentSlots: native?.currentPageCards ?? 0,
                targetSource: slotDescriptor(targetSourceSlot)
            }];
        });

        assertCurrent();
        hover.releaseInteraction();
        nativePopup.invalidate();

        const pageView = nativeCarousel.pageCards({ section, scroller, track, binding: nativeOwner,
            source: resolvedSource, page: actualPage, totalCount: records?.length || 0,
            columns: state.layout?.columns || 1, window: targetItem ? 'viewport' : 'current',
            sessionToken, assertCurrent });

        let freshTarget = null;
        let refreshedCount = 0;
        let fiberAssignments = 0;
        let propsAssignments = 0;
        let neighborsSkipped = 0;

        nativeCarousel.sample(() => {
            for (const entry of pageView.cards) {
                if (hover.isCancelled(token)) return;
                nativeCarousel.assertObservation(pageView);
                hover.count('hoverPreparation', 'slotsConsidered');

                if (!entry.inPage) continue;
                const sourceSlot = entry.source.slot;

                const pageItem = findItemForSourceSlot(sourceSlot);
                if (!pageItem) continue;

                if (!staleSourceRecovery && pageForItem(pageItem) !== actualPage) {
                    setPageForItem(pageItem, actualPage, state);
                    const mappedClone = findGridClone(pageItem);
                    if (mappedClone?.isConnected) copyItemAttributes(mappedClone, pageItem);
                    nativeCarousel.assertObservation(pageView);
                }

                if (targetItem && itemKey(pageItem) !== itemKey(targetItem)) {
                    neighborsSkipped++;
                    hover.count('hoverPreparation', 'neighborsSkipped');
                    continue;
                }

                if (targetItem) gridView.assertCard(targetCard);
                const oldClone = targetItem ? targetCard.node : findGridClone(pageItem);
                if (!oldClone?.isConnected) continue;

                const graftStarted = performance.now();
                let fresh, stats, handle;
                try { ({ fresh, stats, handle } = makeLiveClone(sourceSlot, pageItem, oldClone, actualPage,
                    () => nativeCarousel.assertObservation(pageView), token, sessionToken)); }
                finally { hoverTiming('graft', graftStarted); }
                if (targetItem) { hover.acceptReplacement(targetCard, handle, token, sessionToken); targetCard = handle; }
                nativeCarousel.assertObservation(pageView);
                refreshedCount++;
                hover.count('hoverPreparation', 'clonesRebuilt');
                fiberAssignments += stats?.fiberAssignments || 0;
                propsAssignments += stats?.propsAssignments || 0;

                nativeCarousel.assertObservation(pageView);

                if (targetItem && itemKey(pageItem) === itemKey(targetItem)) {
                    try {
                        fresh.__tmHoverReplacementHovered = fresh.matches(':hover');
                        if (!fresh.__tmHoverReplacementHovered) hover.count('hoverInteraction', 'replacementNotHovered');
                    } catch (_) { hover.count('hoverInteraction', 'diagnosticFailures'); }
                    freshTarget = fresh;
                    targetSourceSlot = sourceSlot;
                }
            }
        });
        if (hover.isCancelled(token)) return null;
        nativeCarousel.assertObservation(pageView);

        log(tLog('nativePageClonesUpdated'), {
            actualPage,
            refreshedCount,
            preparationScope: targetItem ? 'target-card' : 'mounted-page',
            slotsConsidered: pageView.cards.length,
            neighborsSkipped,
            fiberAssignments,
            propsAssignments,
            targetItem: itemSummary(targetItem),
            targetFound: Boolean(freshTarget && targetSourceSlot),
            targetHoveredAtInsertion: freshTarget?.__tmHoverReplacementHovered ?? null
        });

        nativeCarousel.assertObservation(pageView);
        if (targetItem && !freshTarget) {
            // Do not use off-screen slots from adjacent pages as hover sources.
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'target-not-in-current-page-slots',
                targetItem: itemSummary(targetItem),
                actualPage,
                slots: pageView.cards.map(entry => slotDescriptor(entry.source.slot))
            });
            return null;
        }

        nativeCarousel.assertObservation(pageView);
        log(tLog('nativePagePreparationCompleted'), {
            requestedPage: page,
            actualPage,
            targetItem: itemSummary(targetItem),
            targetReady: Boolean(freshTarget),
            elapsedMs: Math.round(performance.now() - started)
        });
        nativeCarousel.assertObservation(pageView);
        return freshTarget ? { card: targetCard, source: popupSource(targetSourceSlot, targetItem), page: actualPage } : null;
    }


    async function buildGrid(section, scroller, items, layout, totalCount, sessionToken = sessionScope.token) {
        const buildState = sourceState;
        const track = buildState?.track;
        const assertBuildParent = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== buildState) throw createRouteSessionCancelledError();
            if (!section.isConnected || !scroller.isConnected || !track?.isConnected ||
                buildState.section !== section || buildState.scroller !== scroller || buildState.track !== track) {
                throw initializationError('GRID_BUILD_SOURCE_REPLACED', 'grid-construction',
                    'Native My List source changed during grid construction');
            }
        };
        const transfer = listView.prepareRecords(items, { assertCurrent: assertBuildParent });
        const publication = ensureListMembership(buildState).preparePublication(transfer.records, totalCount, { assertCurrent: assertBuildParent });
        const pageHints = ensurePageHints(buildState).stage(transfer.records, transfer.readPage, { assertCurrent: assertBuildParent });
        const assertBuildActive = () => { assertBuildParent(); publication.assertCurrent(); pageHints.assertCurrent(); };
        assertBuildActive();
        const geometry = currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(items.length, totalCount, null));
        syncStatusTypography(section, status);
        let grid;
        try {
            grid = await gridView.publish({ items: transfer.records, readMaterial: transfer.readMaterial, releaseMaterial: transfer.release,
                readPage: (record, index) => pageHints.get(record) ?? Math.floor(index / Math.max(1, layout.columns)),
                section, anchor: scroller, status, geometry, layout, visible: viewOriginalMyList, assertCurrent: assertBuildActive,
                onAccepted(root) {
                    publication.commit(); pageHints.commit(); attachGridRegistry(buildState);
                    buildState.grid = root; buildState.status = status; buildState.layout = layout;
                    if (buildState.watchStatus) bindViewingSession(buildState, sessionToken, true);
                } });
        } finally { pageHints.discard(); transfer.discard(); }
        clearLegacyEmptyState({ restoreGrid: false });
        if (sourceState.watchStatus) syncWatchGroups(sourceState);

        lastResponsiveSignature = responsiveSignature(layout);
        lastPageShape = responsivePageShape(layout);
        // Remember the viewport used to publish this grid before observing the
        // source's own collapse to the hidden, one-pixel standby height.
        buildState.resizeViewportSignature = responsiveViewportSignature();

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!grid.isConnected || responsiveRefreshing) return;
            scheduleResponsiveRefresh(140, 'ResizeObserver');
        });
        resizeObserver.observe(section);
        resizeObserver.observe(scroller);

        log(tLog('legacyGridBuilt'), {
            items: items.length,
            totalCount,
            geometry,
            layout: layoutSummary(layout),
            gridCards: gridView.cards.size
        });

        return grid;
    }

    function responsiveSignature(layout) {
        if (!sourceState) return '';
        const observation = nativeSourceObservation(sourceState, { position: true });
        const signature = [
            Math.max(1, layout.columns),
            observation.position.pages,
            Math.round(layout.cardWidth),
            Math.round(layout.gridWidth),
            Math.round(layout.gridLeft),
            Math.round(layout.sidePadding || 0),
            Math.round(layout.scrollerWidth)
        ].join('|');
        nativeCarousel.assertObservation(observation);
        return signature;
    }

    function responsiveViewportSignature() {
        const viewport = typeof window === 'undefined' ? {} : window;
        const visual = viewport.visualViewport;
        return [viewport.innerWidth, viewport.innerHeight, viewport.devicePixelRatio,
            visual?.width, visual?.height, visual?.scale, visual?.offsetLeft, visual?.offsetTop].join('|');
    }

    function responsiveLayoutMatches(previous, next, ignoreScrollerHeight = false) {
        if (!previous) return false;
        return ['columns', 'cardWidth', 'gridWidth', 'gridLeft', 'sidePadding', 'sidePaddingLeft',
            'sidePaddingRight', 'scrollerWidth', 'scrollerHeight', 'gap', 'rowGap']
            .every(key => (ignoreScrollerHeight && key === 'scrollerHeight') ||
                Math.abs((previous[key] || 0) - (next[key] || 0)) <= 0.5);
    }

    function cancelResizeHover() {
        hover.cancel('resize');
        performanceDiagnostics.resize.hoverCancelled++;
    }

    function responsivePageShape(layout) {
        if (!sourceState) return '';
        const observation = nativeSourceObservation(sourceState, { position: true });
        const shape = `${Math.max(1, layout.columns)}|${observation.position.pages}`;
        nativeCarousel.assertObservation(observation);
        return shape;
    }

    function updateResponsiveStatus(layout, note = '') {
        if (!sourceState?.status || !sourceState?.items) return;
        const geometry = applyGridGeometry(sourceState.section, sourceState.grid, layout);
        layoutFrameStatus(sourceState.status, geometry, viewOriginalMyList ? (layout.rowGap || sourceState.layout?.rowGap || 0) : 0);
        updateStatus(formatHeaderParts(
            sourceState.items.length,
            sourceState.totalCount,
            sourceState.initializationElapsedMs,
            true
        ));

        if (note) {
            log(tLog('responsiveStatusNote'), { note });
        }
    }

    async function waitResponsiveLayoutSettled(timeout = 1200, sessionToken = null) {
        assertRouteSession(sessionToken);
        const state = sourceState;
        const { section, scroller, track } = state;
        const start = performance.now();
        let previous = '';
        let stable = 0;
        let latest = sourceState.layout;

        while (performance.now() - start < timeout) {
            await sleep(80);
            assertRouteSession(sessionToken);
            if (sourceState !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || !state.grid?.isConnected) {
                throw createRouteSessionCancelledError();
            }
            const observed = nativeLayoutObservation(section, scroller, track, 'auto', state);
            latest = { ...observed.layout };
            latest.rowGap = sourceState?.layout?.rowGap || measureNativeCarouselGap(section);
            const sig = responsiveSignature(latest);
            nativeCarousel.assertObservation(observed);
            if (sig === previous) {
                stable++;
                if (stable >= 2) return latest;
            } else {
                previous = sig;
                stable = 0;
            }
        }
        assertRouteSession(sessionToken);
        return latest;
    }

    async function rebuildLogicalPageModelFromNativePosition(layout, reason = 'responsive-remap', sessionToken = sessionScope.token) {
        assertRouteSession(sessionToken);
        const live = ensureLiveNativeBinding('logical-page-model-rebuild-start') || sourceState;
        const state = sourceState;
        const section = live?.section || state?.section;
        const scroller = live?.scroller || state?.scroller;
        const track = live?.track || state?.track;
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            throw new Error('Native carousel binding is unavailable during logical page model rebuild');
        }
        if (!state) throw createRouteSessionCancelledError();
        const { itemMap, cloneMap, grid } = state;
        const recordOwner = state.items, items = recordOwner || [];
        const totalCount = items.length;
        const columns = Math.max(1, layout?.columns || state.layout?.columns || 1);
        const previousColumns = state.layout?.columns;
        const assertOwner = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state.items !== recordOwner || items.length !== totalCount || state.itemMap !== itemMap ||
                state.cloneMap !== cloneMap || state.grid !== grid || (grid && !grid.isConnected) ||
                state.layout?.columns !== previousColumns || state.section !== section || state.scroller !== scroller || state.track !== track) {
                throw createRouteSessionCancelledError();
            }
        };
        const result = await nativeCarousel.refreshMapping({ mode: 'responsive', section, scroller, track,
            totalCount, columns, reason, sessionToken, assertCurrent: assertOwner });
        const assertPublication = () => { assertOwner(); nativeCarousel.assertMapping(result); };
        assertPublication();
        if (result.countConverged) myListCountConvergencePending = false;
        if (result.status !== 'committed') return null;
        return nativeCarousel.sample(() => {
            let changed = 0;
            items.forEach((item, index) => {
                assertPublication();
                const page = Math.min(result.knownPageCount - 1, Math.floor(index / columns));
                if (pageForItem(item) !== page) changed++;
                setPageForItem(item, page, state, { assertCurrent: assertPublication });
                const clone = cloneMap?.get(itemKey(item));
                if (clone?.isConnected) copyItemAttributes(clone, item);
                assertPublication();
            });
            assertPublication();
            state.initialPage = result.currentPage;
            log(tLog('logicalPageModelSynchronizedAfterDelta'), {
                reason, currentPage: result.currentPage, knownPageCount: result.knownPageCount,
                pageCountFinalized: result.pageCountFinalized, pageMappingStale: result.pageMappingStale,
                visibleSignature: result.visibleSignature, visibleIds: result.visibleIds,
                itemIndices: result.itemIndices, logicalIndices: result.logicalIndices, columns, changed, totalCount
            });
            assertPublication();
            return changed;
        });
    }

    async function remapItemsByOrder(layout, sessionToken = sessionScope.token) {
        const state = sourceState;
        const { section, items, cloneMap } = state;
        const columns = Math.max(1, layout.columns);
        const runtime = nativeSourceObservation(state, { position: true });
        const logicalMode = runtime?.mode === 'logical';
        const pages = logicalMode
            ? Math.max(1, Math.ceil(items.length / columns))
            : Math.max(1, runtime.position.pages);
        let changed = 0;

        if (logicalMode) {
            changed = await rebuildLogicalPageModelFromNativePosition(layout, 'responsive-remap', sessionToken);
        } else {
            nativeCarousel.sample(() => items.forEach((item, index) => {
                nativeCarousel.assertObservation(runtime);
                const page = Math.min(pages - 1, Math.floor(index / columns));
                if (pageForItem(item) !== page) changed++;
                setPageForItem(item, page, state, { assertCurrent: () => nativeCarousel.assertObservation(runtime) });
                const clone = cloneMap?.get(itemKey(item));
                if (clone) copyItemAttributes(clone, item);
                nativeCarousel.assertObservation(runtime);
            }));
        }

        const updatedRuntime = nativeSourceObservation(state);
        log(tLog('responsiveItemPageMappingRecalculatedWithoutNativeCarouselScan'), {
            columns,
            pages,
            changed,
            total: items.length,
            selectedPage: nativeSourceDiagnostics(section, state.scroller, state.track)?.selectedPage ?? null,
            pageMode: updatedRuntime?.mode || null,
            reanchoredLogicalPages: logicalMode,
            pageMappingStale: Boolean(updatedRuntime?.needsRemapping)
        });
        nativeCarousel.assertObservation(updatedRuntime);

        return changed;
    }

    async function refreshResponsiveLayout(sessionToken = sessionScope.token) {
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected || responsiveRefreshing) return;
        const state = sourceState;
        const { section, scroller, track } = state;
        responsiveRefreshing = true;
        const responsiveOwner = { sessionToken, ticket: listMutations.deferReconciliation('responsive-refresh') };
        responsiveDeferral = responsiveOwner;
        let deferredLogicalRemap = false;
        const seq = ++responsiveSequence;
        const reason = lastResponsiveReason || 'unspecified';
        activeResponsiveReason = reason;
        const started = performance.now();
        const grid = state.grid;
        const assertOwner = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || state.grid !== grid || !grid.isConnected) {
                throw createRouteSessionCancelledError();
            }
        };
        try {
            const startingNative = nativeSourceDiagnostics(section, scroller, track);
            log(tLog('responsiveRefreshStarted'), {
                seq,
                reason,
                beforeLayout: layoutSummary(sourceState.layout),
                selectedPage: startingNative?.selectedPage ?? null,
                pages: startingNative?.pageCount ?? null
            });
            gridView.setRefreshing(grid, true);
            performanceDiagnostics.resize.refreshes++;
            cancelResizeHover();
            const liveLayout = await waitResponsiveLayoutSettled(1200, sessionToken);
            assertOwner();
            const signature = responsiveSignature(liveLayout);
            const pageShape = responsivePageShape(liveLayout);

            sourceState.layout = liveLayout;
            updateResponsiveStatus(liveLayout, tUi('relayoutInProgress'));

            const pageShapeChanged = pageShape !== lastPageShape;
            const sourceObservation = nativeSourceObservation(state);
            const logicalMappingStale = Boolean(sourceObservation?.needsRemapping);
            log(tLog('responsiveMeasurementResolved'), {
                seq,
                reason,
                liveLayout: layoutSummary(liveLayout),
                signature,
                pageShape,
                previousPageShape: lastPageShape,
                pageShapeChanged,
                logicalMappingStale
            });
            assertOwner();
            nativeCarousel.assertObservation(sourceObservation);
            if (pageShapeChanged || logicalMappingStale) {
                const changed = await remapItemsByOrder(liveLayout, sessionToken);
                assertOwner();
                deferredLogicalRemap = changed === null;
                const remappedNative = nativeSourceDiagnostics(section, scroller, track);
                if (deferredLogicalRemap) {
                    log('Responsive logical page remap deferred', {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: remappedNative?.pageCount ?? null,
                        total: sourceState.items.length,
                        retryCount: nativeSourceObservation(state)?.remapAttempts || 0
                    });
                } else {
                    log(tLog('responsivePageMappingUpdatedWithoutNativeCarouselMovement'), {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: remappedNative?.pageCount ?? null,
                        changed,
                        total: sourceState.items.length
                    });
                }
            } else {
                // Geometry-only resize: keep the native carousel exactly where the user left it.
                realignActiveSource();
            }

            const finalSignature = responsiveSignature(liveLayout);
            const finalPageShape = responsivePageShape(liveLayout);
            lastResponsiveSignature = finalSignature;
            lastPageShape = finalPageShape;
            updateResponsiveStatus(liveLayout);
            log(tLog('responsiveRefreshCompleted'), {
                seq,
                reason,
                layout: layoutSummary(liveLayout),
                elapsedMs: Math.round(performance.now() - started),
                selectedPage: nativeSourceDiagnostics(section, scroller, track)?.selectedPage ?? null,
                finalSignature,
                finalPageShape
            });
        } catch (error) {
            if (isRouteSessionCancelledError(error)) return;
            warn(tLog('responsiveRelayoutFailed'), {
                seq,
                reason,
                error,
                elapsedMs: Math.round(performance.now() - started),
                snapshot: collectRuntimeSnapshot()
            });
            updateResponsiveStatus(sourceState.layout, tUi('relayoutFailed'));
        } finally {
            try {
                gridView.setRefreshing(grid, false);
                if (isRouteSessionActive(sessionToken) && responsiveSequence === seq && responsiveDeferral === responsiveOwner) {
                    responsiveRefreshing = false;
                    activeResponsiveReason = '';
                    responsiveDeferral = null;
                    responsiveOwner.ticket.release({ reason: 'after-responsive-refresh' });
                    const runtime = sourceState === state ? nativeSourceObservation(state) : null;
                    if (deferredLogicalRemap && runtime?.needsRemapping && (runtime.remapAttempts || 0) === 1) {
                        scheduleResponsiveRefresh(
                            400,
                            isResizeResponsiveReason(reason) ? 'responsive-resize-retry' : 'logical-page-model-retry'
                        );
                    }
                }
            } finally {
                const admitted = isRouteSessionActive(sessionToken) && responsiveSequence === seq && responsiveDeferral === responsiveOwner;
                if (responsiveDeferral === responsiveOwner) {
                    responsiveRefreshing = false; responsiveDeferral = null; activeResponsiveReason = '';
                }
                responsiveOwner.ticket.release({ resume: admitted, reason: 'after-responsive-refresh' });
            }

            // Resize may fast-reanchor the hidden/native carousel to rebuild the logical
            // indicator, but it never starts MiniModal hover preparation by itself.
        }
    }

    function scheduleResponsiveRefresh(delay = 140, reason = 'unknown') {
        const sessionToken = sessionScope.token;
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected) return;
        const state = sourceState;
        lastResponsiveReason = reason;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = setTimeout(() => withNativeReadScope(() => {
            responsiveRefreshTimer = null;
            try {
                if (!isRouteSessionActive(sessionToken) || responsiveRefreshing || sourceState !== state || !state.grid?.isConnected) return;
                performanceDiagnostics.resize.checks++;
                if (state.empty && (!state.scroller || !state.track)) {
                    const observed = nativeLayoutObservation(state.section, null, null, 'empty', state);
                    const layout = { ...observed.layout };
                    layout.rowGap = measureNativeCarouselGap(state.section);
                    nativeCarousel.assertObservation(observed);
                    if (responsiveLayoutMatches(state.layout, layout)) {
                        performanceDiagnostics.resize.unchanged++;
                        return;
                    }
                    state.layout = layout;
                    const geometry = applyGridGeometry(state.section, state.grid, layout);
                    layoutFrameStatus(state.status, geometry);
                    return;
                }
                ensureLiveNativeBinding('responsive-check');
                if (sourceState !== state || !state.section?.isConnected || !state.scroller?.isConnected || !state.track?.isConnected) return;

                // Skip the expensive rescan when measured geometry has not changed.
                // Keep active-slot alignment here and clear it only when the responsive state actually changes.
                const sample = withNativeReadScope(() => {
                    const observed = nativeLayoutObservation(state.section, state.scroller, state.track, 'auto', state);
                    const measured = { ...observed.layout };
                    measured.rowGap = state.layout?.rowGap || measureNativeCarouselGap(state.section);
                    const result = { measured, signature: responsiveSignature(measured), geometry: currentGridGeometry(state.section, measured), observed };
                    nativeCarousel.assertObservation(observed);
                    return result;
                });
                const measured = sample.measured;
                const sig = sample.signature;
                if (sourceState !== state) return;
                const sourceObservation = nativeSourceObservation(state, { presentation: true });
                const logicalMappingStale = Boolean(sourceObservation?.needsRemapping);
                const applied = state.grid.__tmAppliedGeometry;
                const layoutUnchanged = responsiveLayoutMatches(state.layout, measured);
                // Parking a hidden source changes its own height, not the displayed
                // grid. Preserve the first hover only after all other checks agree.
                const parkedHeightOnlyChange = !layoutUnchanged && lastResponsiveReason === 'ResizeObserver' &&
                    sig === lastResponsiveSignature && !logicalMappingStale &&
                    sourceObservation.presentation.hidden && sourceObservation.presentation.parked &&
                    state.resizeViewportSignature === responsiveViewportSignature() &&
                    Number.isFinite(state.layout?.scrollerHeight) && state.layout.scrollerHeight > 1.5 &&
                    Number.isFinite(measured.scrollerHeight) && measured.scrollerHeight >= 1 && measured.scrollerHeight <= 1.5 &&
                    responsiveLayoutMatches(state.layout, measured, true);
                const geometryUnchanged = (layoutUnchanged || parkedHeightOnlyChange) && applied &&
                    ['width', 'left', 'columns'].every(key => Math.abs(applied[key] - sample.geometry[key]) <= 0.5);
                if (!nativeCarousel.isObservationCurrent(sourceObservation)) return;
                if (!nativeCarousel.isObservationCurrent(sample.observed)) return;
                if (sig === lastResponsiveSignature && geometryUnchanged && !logicalMappingStale) {
                    const previousScrollerHeight = state.layout.scrollerHeight;
                    sourceState.layout = measured;
                    realignActiveSource();
                    performanceDiagnostics.resize.unchanged++;
                    const hoverPreserved = Boolean(hover.hasInteraction());
                    if (hoverPreserved) performanceDiagnostics.resize.hoverPreserved++;
                    if (parkedHeightOnlyChange) {
                        const counters = performanceDiagnostics.resize;
                        counters.parkedHeightChangesIgnored++;
                        if (hoverPreserved) counters.parkedHeightHoverPreserved++;
                        // One event per route; later occurrences remain in Copy Logs.
                        if (counters.parkedHeightChangesIgnored === 1) {
                            try { log(tLog('responsiveRemeasurementNoShapeChange'), {
                                reason: lastResponsiveReason, signature: sig, parkedHeightOnlyChange: true,
                                previousScrollerHeight, scrollerHeight: measured.scrollerHeight, hoverPreserved
                            }); } catch (_) { hover.count('hoverInteraction', 'diagnosticFailures'); }
                        }
                    } else trace(() => [tLog('responsiveRemeasurementNoShapeChange'), {
                        reason: lastResponsiveReason,
                        signature: sig,
                        layout: layoutSummary(measured)
                    }]);
                    return;
                }

                // Netflix can change only the carousel page count after a My List removal
                // settles (for example, after the Undo window) without changing responsive
                // geometry. Treat that as content-state convergence, not a responsive relayout,
                // so an active hover is not invalidated unnecessarily.
                if (lastResponsiveReason === 'ResizeObserver') {
                    const previousParts = String(lastResponsiveSignature || '').split('|');
                    const currentParts = String(sig || '').split('|');
                    const pageCountOnlyChanged =
                        previousParts.length === 7 &&
                        currentParts.length === 7 &&
                        previousParts[1] !== currentParts[1] &&
                        previousParts.every((part, index) => index === 1 || part === currentParts[index]);

                    if (pageCountOnlyChanged && geometryUnchanged && !logicalMappingStale) {
                        const previousSignature = lastResponsiveSignature;
                        sourceState.layout = measured;
                        lastResponsiveSignature = sig;
                        lastPageShape = responsivePageShape(measured);
                        realignActiveSource();
                        performanceDiagnostics.resize.unchanged++;
                        if (hover.hasInteraction()) performanceDiagnostics.resize.hoverPreserved++;
                        log(tLog('responsiveRemeasurementNoShapeChange'), {
                            reason: lastResponsiveReason,
                            signature: sig,
                            previousSignature,
                            pageCountOnlyChange: true,
                            layout: layoutSummary(measured)
                        });
                        return;
                    }
                }

                const refreshPromise = refreshResponsiveLayout(sessionToken);
                responsiveRefreshPromise = refreshPromise;
                Promise.resolve(refreshPromise).finally(() => {
                    if (responsiveRefreshPromise === refreshPromise) responsiveRefreshPromise = null;
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            }
        }), delay);
    }

    function beginSourceScan(section, scroller, track) {
        return nativeSourcePresentation(section, scroller, track, { phase: 'scan' });
    }

    function parkSource(section, scroller, track) {
        return nativeSourcePresentation(section, scroller, track, { phase: 'parked' });
    }

    function realignActiveSource() {
        nativePopup.checkDetached();
    }


    function handleTargetWindowResize() {
        handleTargetResize('window.resize');
    }

    function handleTargetVisualViewportResize() {
        handleTargetResize('visualViewport.resize');
    }

    function handleTargetResize(reason) {
        if (!sourceState?.grid?.isConnected) return;
        performanceDiagnostics.resize.events++;
        const signature = responsiveViewportSignature();
        if (sourceState.resizeViewportSignature !== signature) {
            // Real bounds/zoom/offset changes can invalidate native popup placement
            // even when the column count is unchanged. Duplicate events cannot.
            cancelResizeHover();
            log(tLog(reason === 'window.resize' ? 'windowResizeDetected' : 'visualViewportResizeDetected'), {
                previousSignature: sourceState.resizeViewportSignature || '', signature,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                hoverCancelled: true
            });
            sourceState.resizeViewportSignature = signature;
        }
        scheduleResponsiveRefresh(140, reason);
    }

    function handleRelevantTargetDocumentMutation(sessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        if ((completedSection || (waitingForNativeEmpty && sourceState?.empty)) && sourceState?.grid?.isConnected) {
            ensureLiveNativeBinding('document-mutation', true);
        } else {
            scheduleRun(40, sessionToken);
        }
    }

    function startTargetEventListeners() {
        if (targetListenersActive) return;
        targetListenersActive = true;
        hover.start();
        document.addEventListener('click', handleObservedMyListToggleClick, { capture: true, passive: true });
        window.addEventListener('resize', handleTargetWindowResize, { passive: true });
        window.visualViewport?.addEventListener('resize', handleTargetVisualViewportResize, { passive: true });
        nativeCarousel.startDiscovery();
    }

    function stopTargetEventListeners() {
        hover.dispose();
        nativePopup.finishProbe({ result: 'released-before-check', reason: 'listeners-stopped' });
        nativePopup.release('listeners-stopped');
        if (!targetListenersActive && !nativeCarousel.diagnostics().discoveryActive) return;
        targetListenersActive = false;
        document.removeEventListener('click', handleObservedMyListToggleClick, true);
        window.removeEventListener('resize', handleTargetWindowResize);
        window.visualViewport?.removeEventListener('resize', handleTargetVisualViewportResize);
        nativeCarousel.stopDiscovery();
    }

    function recoverNativeInitialization(sessionToken, reason) {
        const failure = nativeInitializationFailure;
        if (!failure || failure.sessionToken !== sessionToken || !isRouteSessionActive(sessionToken)) return false;
        if (performanceDiagnostics.nativeRecovery.attempts >= 1) {
            if (!failure.exhaustedReported) {
                failure.exhaustedReported = true;
                performanceDiagnostics.nativeRecovery.exhausted++;
                log(tLog('nativeInitializationRecoveryExhausted'), { sessionToken, reason, maxAttempts: 1 });
            }
            return false;
        }
        try {
            const discovered = nativeDiscoveryObservation({ bindingOnly: true });
            const { section, scroller, track } = discovered;
            if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected ||
                !section.contains(scroller) || !scroller.contains(track) ||
                (section === failure.section && scroller === failure.scroller && track === failure.track)) return false;

            hover.cancel('source');
            nativeCarousel.assertObservation(discovered);
            if (nativeInitializationFailure !== failure) return false;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            return false;
        }

        performanceDiagnostics.nativeRecovery.attempts++;
        listMutations.deferPending();
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveDeferral?.ticket.release({ resume: false }); responsiveDeferral = null;
        responsiveRefreshing = false;
        nativeCarousel.clearBinding();
        publishSourceState(null);
        completedSection = null;
        initializationBlockedSessionToken = null;
        nativeInitializationFailure = null;
        clearRunningSession(sessionToken, false);
        nativeCarousel.refreshDiscovery();
        // A replacement may have a different membership/count. Use the existing
        // fresh SPA bootstrap rather than an old initial-page cache on this retry.
        targetSessionEntryKind = 'spa';
        log(tLog('nativeInitializationRecovered'), {
            sessionToken, reason, attempt: performanceDiagnostics.nativeRecovery.attempts,
            pendingMutations: listMutations.pendingIntents().length
        });
        scheduleRun(40, sessionToken);
        return true;
    }

    async function runScript(sessionToken = sessionScope.token) {
        if (!isRouteSessionActive(sessionToken)) return;
        if (initializationBlockedSessionToken === sessionToken) {
            recoverNativeInitialization(sessionToken, 'run');
            return;
        }
        if (running && runningSessionToken === sessionToken) return;
        let discovered;
        try {
            discovered = nativeDiscoveryObservation({ bindingOnly: true });
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            if (isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }
        let section = discovered.section;
        if (!section) {
            if (waitingForNativeEmpty && sourceState?.empty) {
                return;
            }
            const now = performance.now();
            if (!missingSectionSince) missingSectionSince = now;
            const elapsed = now - missingSectionSince;
            if (elapsed < NATIVE_EMPTY_STABLE_MS) {
                scheduleRun(Math.max(40, NATIVE_EMPTY_STABLE_MS - elapsed), sessionToken);
                return;
            }
            section = ensureSyntheticMyListSection(discovered);
            if (!section) {
                scheduleRun(120, sessionToken);
                return;
            }
        } else {
            missingSectionSince = 0;
            gridView.removeSynthetic(section);
        }
        if (completedSection === section && document.getElementById(GRID_ID) && !sourceState?.empty) return;

        try {
            nativeCarousel.assertObservation(discovered);
            cleanupOldArtifacts();
            nativeCarousel.assertObservation(discovered);
            gridView.installResources(() => { assertRouteSession(sessionToken); nativeCarousel.assertObservation(discovered); });
            markOriginalHeader(section);
            nativeCarousel.assertObservation(discovered);
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            if (isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }

        const initializationStarted = performance.now();
        let mountedSource, scroller, track;
        let provisionalLayout, provisionalFrame;
        try {
            mountedSource = nativeDiscoveryObservation({ bindingOnly: true });
            if (mountedSource.section && mountedSource.section !== section) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Initialization source was replaced');
            }
            scroller = mountedSource.section === section ? mountedSource.scroller : null;
            track = mountedSource.section === section ? mountedSource.track : null;
            withNativeReadScope(() => {
                const observed = nativeLayoutObservation(section, scroller, track);
                provisionalLayout = { ...observed.layout };
                provisionalLayout.rowGap = measureNativeCarouselGap(section);
                nativeCarousel.assertObservation(observed);
                provisionalFrame = placeLegacyFrame(section, scroller, provisionalLayout, { elapsedMs: null, finalized: false, totalCount: null });
                nativeCarousel.assertObservation(observed);
                nativeCarousel.assertObservation(mountedSource);
            });
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            if (isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }
        publishSourceState(attachNativeBinding({
            layout: provisionalLayout,
            items: [],
            collectedCount: 0,
            totalCount: null,
            grid: provisionalFrame.grid,
            status: provisionalFrame.status,
            itemMap: new Map(),
            empty: false,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted
        }, section, scroller || null, track || null));
        applyOriginalMyListVisibility();

        const initializationOwner = beginRunningSession(sessionToken);
        assertRouteSession(sessionToken);
        let earlyTotalCount;
        let freshMyListBootstrap = null, entryCollection;
        let fastItems = null;
        let fastCollectionSource = 'graphql';
        const entryParent = sourceState;
        try {
            entryCollection = await listView.prepareEntry({ entryKind: targetSessionEntryKind, sessionToken,
                hasNativeSource: Boolean(scroller && track),
                readMountedBootstrap: () => tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken),
                readMountedCards() {
                    const mounted = nativePageObservation();
                    nativeCarousel.assertObservation(mounted);
                    return mounted.cards.length;
                },
                startReadiness: () => waitForNativeCarouselReady(section, scroller, track, sessionToken),
                onCount: detail => log(tLog('totalCountDetected'), detail),
                assertCurrent() {
                    if (sourceState !== entryParent) throw initializationError('NATIVE_SOURCE_REPLACED',
                        'list-entry', 'List entry parent changed during source selection');
                } });
            freshMyListBootstrap = entryCollection.bootstrap;
            earlyTotalCount = entryCollection.totalCount;
            assertRouteSession(sessionToken);
        } catch (error) {
            if (error?.code === 'NATIVE_SOURCE_REPLACED') {
                log('Initial native card observation discarded after source replacement', { sessionToken });
                clearRunningSession(sessionToken, false, initializationOwner);
                scheduleRun(0, sessionToken);
                return;
            }
            if (!isRouteSessionCancelledError(error)) {
                initializationBlockedSessionToken = sessionToken;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || 'total-count-detection',
                    timeoutMs: error?.details?.timeoutMs ?? TOTAL_COUNT_TIMEOUT_MS,
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, null));
            }
            clearRunningSession(sessionToken, true, initializationOwner);
            return;
        }
        if (earlyTotalCount === 0) {
            try {
                withNativeReadScope(() => {
                    const observed = nativeLayoutObservation(section, scroller, track);
                    const layout = { ...observed.layout, rowGap: measureNativeCarouselGap(section) };
                    nativeCarousel.assertObservation(observed);
                    finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, 'totalCount-0', observed);
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
                clearRunningSession(sessionToken, false, initializationOwner);
                if (isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
                return;
            }
            clearRunningSession(sessionToken, true, initializationOwner);
            return;
        }

        // The My List heading can exist before the carousel itself. totalCount is
        // already authoritative here: a positive count must produce a native source,
        // otherwise initialization fails instead of being mistaken for an empty list.
        if (!scroller || !track) {
            let sourceWait;
            try {
                sourceWait = await waitForNativeSource(section, NATIVE_READY_TIMEOUT_MS, sessionToken);
            } catch (error) {
                if (!isRouteSessionCancelledError(error)) {
                    warn(tLog('nativeSourceWaitFailed'), error);
                }
                clearRunningSession(sessionToken, true, initializationOwner);
                return;
            }
            assertRouteSession(sessionToken);
            if (sourceWait.nativeSection) {
                nativePopup.invalidate();
                gridView.dispose();
                nativeCarousel.clearBinding();
                publishSourceState(null);
                completedSection = null;
                clearRunningSession(sessionToken, true, initializationOwner);
                scheduleRun(0, sessionToken);
                return;
            }
            if (!sourceWait.found) {
                const error = initializationTimeoutError(sourceWait.stage || 'native-source', sourceWait.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: sourceWait.elapsedMs,
                    totalCount: earlyTotalCount
                });
                initializationBlockedSessionToken = sessionToken;
                nativeInitializationFailure = { section, scroller, track, sessionToken };
                warn(tLog('initializationFailed'), {
                    code: error.code,
                    stage: error.stage,
                    timeoutMs: error.details?.timeoutMs ?? null,
                    details: error.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                clearRunningSession(sessionToken, false, initializationOwner);
                recoverNativeInitialization(sessionToken, 'native-source-wait');
                return;
            }
            scroller = sourceWait.scroller;
            track = sourceWait.track;
            attachNativeBinding(sourceState, section, scroller, track);
        }

        // Netflix can expose the My List section before its virtual carousel has finished
        // building. Do not alter the carousel (especially transition/animation styles)
        // until the native page/slot structure has settled.
        let readiness;
        try {
            readiness = await entryCollection.prepareReadiness(options =>
                waitForNativeCarouselReady(section, scroller, track, sessionToken, options));
        } catch (error) {
            if (error?.code === 'NATIVE_SOURCE_REPLACED') {
                clearRunningSession(sessionToken, false, initializationOwner);
                recoverNativeInitialization(sessionToken, 'readiness-source-replaced');
                return;
            }
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('nativeCarouselReadinessCheckFailed'), error);
            }
            clearRunningSession(sessionToken, true, initializationOwner);
            return;
        }
        if (!readiness.ready) {
            initializationBlockedSessionToken = sessionToken;
            nativeInitializationFailure = { section, scroller, track, sessionToken };
            clearRunningSession(sessionToken, false, initializationOwner);
            if (recoverNativeInitialization(sessionToken, 'readiness-' + readiness.reason)) return;
            const readinessError = readiness.reason === 'timeout'
                ? initializationTimeoutError(readiness.stage || 'native-carousel-readiness', readiness.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: readiness.elapsedMs,
                    state: readiness.state
                })
                : initializationError('NATIVE_CAROUSEL_NOT_READY', 'native-carousel-readiness', `Native carousel not ready: ${readiness.reason}`, readiness);
            warn(tLog('initializationFailed'), {
                code: readinessError.code,
                stage: readinessError.stage,
                timeoutMs: readinessError.details?.timeoutMs ?? null,
                error: readinessError,
                snapshot: collectRuntimeSnapshot()
            });
            updateStatus(formatInitializationErrorMeta(readinessError, earlyTotalCount));
            return;
        }
        if (readiness.empty) {
            try {
                nativeCarousel.assertPreparation(readiness);
                withNativeReadScope(() => {
                    const observed = nativeLayoutObservation(section, scroller, track);
                    const emptyLayout = { ...observed.layout, rowGap: measureNativeCarouselGap(section) };
                    nativeCarousel.assertObservation(observed);
                    finalizeEmptyLegacyList(section, scroller, track, emptyLayout, initializationStarted, readiness.reason, observed);
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
                clearRunningSession(sessionToken, false, initializationOwner);
                if (isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
                return;
            }
            clearRunningSession(sessionToken, true, initializationOwner);
            return;
        }
        const mountedMode = nativeSourceObservation()?.mode || 'unknown';

        // A manual/order-mismatch reinitialization can start while Netflix still has
        // page 0 selected with a one-card-shifted mounted window after a My List delta.
        // The fresh CarouselPage response gives us an authoritative first video ID.
        // Normalize only legacy/indicator SPA sessions, before source-scan mode starts,
        // so normal initial-load performance and logical/Hawkins behavior are untouched.
        {
            try {
                await entryCollection.prepareAnchor({ mode: mountedMode, normalize: firstVideoId =>
                    ensureFreshIndicatorPageZeroAnchor(section, scroller, track, firstVideoId, sessionToken) });
            } catch (error) {
                if (!isRouteSessionCancelledError(error)) {
                    initializationBlockedSessionToken = sessionToken;
                    warn(tLog('initializationFailed'), {
                        code: error?.code || null,
                        stage: error?.stage || 'normalize-native-page-zero',
                        timeoutMs: error?.details?.timeoutMs ?? null,
                        details: error?.details || null,
                        error,
                        snapshot: collectRuntimeSnapshot()
                    });
                    updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                }
                clearRunningSession(sessionToken, true, initializationOwner);
                return;
            }
        }

        {
            const countOwner = sourceState;
            try {
                let countObservation;
                const mountedCount = entryCollection.confirmCount({ mode: mountedMode, readNativeCount() {
                    countObservation = nativeSourceObservation(countOwner, { count: 'required', provisionalTotalCount: earlyTotalCount });
                    return countObservation.count;
                }, assertNativeCurrent: () => nativeCarousel.assertObservation(countObservation) });
                if (mountedCount) {
                    const mountedTotalCount = mountedCount.totalCount;
                    if (mountedCount.changed) {
                        warn('Netflix My List totalCount reconciled from mounted carousel', {
                            provisionalTotalCount: earlyTotalCount, mountedTotalCount,
                            readings: mountedCount.readings, entryKind: targetSessionEntryKind,
                            provisionalSource: mountedCount.provisionalSource
                        });
                    } else {
                        log('Netflix My List mounted totalCount confirmed', {
                            totalCount: mountedTotalCount, readings: mountedCount.readings, entryKind: targetSessionEntryKind
                        });
                    }
                    mountedCount.assertCurrent();
                    earlyTotalCount = mountedTotalCount;
                    ensureListMembership(countOwner).observeCount({ totalCount: mountedTotalCount }, { assertCurrent: mountedCount.assertCurrent });
                }
            } catch (error) {
                if (error?.code === 'NATIVE_SOURCE_REPLACED' || sourceState !== countOwner) {
                    clearRunningSession(sessionToken, false, initializationOwner);
                    if (!recoverNativeInitialization(sessionToken, 'native-count-source-replaced')) scheduleRun(0, sessionToken);
                    return;
                }
                if (!isRouteSessionCancelledError(error)) {
                    initializationBlockedSessionToken = sessionToken;
                    warn(tLog('initializationFailed'), {
                        code: error?.code || null,
                        stage: error?.stage || 'native-react-total-count',
                        timeoutMs: error?.details?.timeoutMs ?? null,
                        details: error?.details || null,
                        error,
                        snapshot: collectRuntimeSnapshot()
                    });
                    updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
                }
                clearRunningSession(sessionToken, true, initializationOwner);
                return;
            }
        }

        {
            const retryReplacedSource = () => {
                log('Fast My List collection discarded after native source replacement', { sessionToken });
                clearRunningSession(sessionToken, false, initializationOwner);
                scheduleRun(0, sessionToken);
            };
            let graphqlGeometry, graphqlLayout, templateView;
            try {
                const preferred = await listView.preparePreferred({ mode: mountedMode, bootstrap: freshMyListBootstrap,
                    sessionToken, assertCurrent: () => nativeCarousel.assertPreparation(readiness),
                    readInput() {
                        graphqlGeometry = nativeLayoutObservation(section, scroller, track);
                        graphqlLayout = graphqlGeometry.layout;
                        templateView = nativePageObservation(sourceState, { template: true });
                        nativeCarousel.assertObservation(templateView);
                        nativeCarousel.assertObservation(graphqlGeometry);
                        return { totalCount: earlyTotalCount, columns: graphqlLayout.columns,
                            templateSource: templateView.template, assertCurrent: () => nativeCarousel.assertObservation(templateView) };
                    },
                    onPrepared(result) {
                        const source = result.collectionSource || 'graphql';
                        nativeCarousel.assertObservation(graphqlGeometry);
                        const accepted = nativeCarousel.acceptCollection({ preparation: readiness,
                            totalCount: earlyTotalCount, columns: graphqlLayout.columns, collectedCount: result.items.length });
                        log(source === 'mounted-single-page'
                            ? 'Mounted single-page My List fast collection prepared' : 'GraphQL My List fast collection prepared', {
                            collectionSource: source, avoidedMembershipRequests: source === 'mounted-single-page' ? 1 : 0,
                            totalCount: earlyTotalCount, collected: result.items.length,
                            graphqlPageCount: result.bootstrap.pageCount || null, columns: graphqlLayout.columns,
                            knownPageCount: accepted.knownPageCount
                        });
                        nativeCarousel.assertMapping(accepted);
                    },
                    onIncomplete(result) {
                        warn('GraphQL My List fast collection was incomplete; falling back to native scan', {
                            totalCount: earlyTotalCount, bootstrapTotalCount: result.bootstrap?.totalCount,
                            graphqlEdgeCount: result.bootstrap?.edgeCount || 0, graphqlPageCount: result.bootstrap?.pageCount || null,
                            columns: graphqlLayout.columns
                        });
                    },
                    onFailure(error) {
                        warn('GraphQL My List fast collection failed; falling back to native scan', {
                            code: error?.code || null, stage: error?.stage || 'graphql-fast-collection', error
                        });
                    } });
                freshMyListBootstrap = preferred.bootstrap;
                fastItems = preferred.items;
                fastCollectionSource = preferred.collectionSource || 'graphql';
            } catch (error) {
                if (isRouteSessionCancelledError(error)) {
                    clearRunningSession(sessionToken, true, initializationOwner);
                    return;
                }
                if (error?.code === 'NATIVE_SOURCE_REPLACED' || !nativeCarousel.isPreparationCurrent(readiness)) {
                    retryReplacedSource();
                    return;
                }
                fastItems = null;
                warn('GraphQL My List fast collection failed; falling back to native scan', {
                    code: error?.code || null, stage: error?.stage || 'graphql-fast-collection', error
                });
            }
        }

        const initializationNative = nativeSourceDiagnostics(section, scroller, track);
        log(tLog('initializationStarted'), {
            version: SCRIPT_VERSION,
            browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(),
            netflixLanguage: getNetflixLanguage(),
            displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            selectedPage: initializationNative?.selectedPage ?? null,
            pages: initializationNative?.pageCount ?? null,
            sourceSlots: initializationNative?.sourceSlots ?? 0,
            sourceCards: initializationNative?.sourceCards ?? 0,
            carouselDom: initializationNative?.carouselDom ?? null
        });

        let retryGridBuild = false;
        let retryNativeCollection = false;
        try {
            const layoutObservation = nativeLayoutObservation(section, scroller, track);
            const layout = { ...layoutObservation.layout, rowGap: measureNativeCarouselGap(section) };
            const totalCount = earlyTotalCount;
            const measuredNative = nativeSourceDiagnostics(section, scroller, track);
            const initialPages = measuredNative?.pageCount ?? null;
            log(tLog('initialLayoutMeasured'), {
                layout: layoutSummary(layout),
                totalCount,
                initialPages,
                selectedPage: measuredNative?.selectedPage ?? null,
                currentPageCards: measuredNative?.currentPageCards ?? 0
            });
            nativeCarousel.assertObservation(layoutObservation);

            const status = updateStatus(formatHeaderParts(0, totalCount, null));
            gridView.placeStatus(status, { section, anchor: scroller,
                assertCurrent: () => nativeCarousel.assertObservation(layoutObservation) });
            syncStatusTypography(section, status);
            const initialStatusGeometry = currentGridGeometry(section, layout);
            layoutFrameStatus(status, initialStatusGeometry, layout.rowGap);
            nativeCarousel.assertObservation(layoutObservation);

            // Fast collection skips beginSourceScan(), but hover-driven native
            // moves still need the track marker used by the animation suppression CSS.
            nativeSourcePresentation(section, scroller, track, { phase: 'mounted' });
            waitingForNativeEmpty = false;
            publishSourceState(attachNativeBinding({ layout, initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount }, section, scroller, track));
            const collectionState = sourceState;
            const collectionBinding = nativeCarousel.borrowBinding(section, scroller, track);
            const assertCollectionCurrent = () => {
                assertRouteSession(sessionToken);
                nativeCarousel.assertBinding(collectionBinding);
                if (sourceState !== collectionState) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-collection', 'Collection parent was replaced');
            };
            let emptyObservation;
            const collected = await listView.collectForPublication({ preferred: fastItems, totalCount, sessionToken,
                assertCurrent: assertCollectionCurrent,
                onPreferred(items) {
                    const fastNative = nativeSourceDiagnostics(section, scroller, track);
                    log(fastCollectionSource === 'mounted-single-page'
                        ? 'Mounted single-page My List fast collection used' : 'GraphQL My List fast collection used', {
                        collectionSource: fastCollectionSource, collected: items.length, totalCount,
                        pages: fastNative?.pageCount ?? null, sourceCards: fastNative?.sourceCards ?? 0,
                        carouselDom: fastNative?.carouselDom ?? null
                    });
                },
                beforeNative() {
                    // Keep native layout and slot detection intact while scanning.
                    beginSourceScan(section, scroller, track);
                    const scanNative = nativeSourceDiagnostics(section, scroller, track);
                    log(tLog('nativeCarouselScanModeStarted'), {
                        selectedPage: scanNative?.selectedPage ?? null, pages: scanNative?.pageCount ?? null,
                        sourceSlots: scanNative?.sourceSlots ?? 0, sourceCards: scanNative?.sourceCards ?? 0,
                        carouselDom: scanNative?.carouselDom ?? null
                    });
                },
                collectNative: () => collectAllItems(section, scroller, track, totalCount, sessionToken),
                readEmpty() {
                    emptyObservation = nativeCarousel.observeSource({ section, scroller, track, binding: collectionBinding,
                        sessionToken, readiness: true, assertCurrent: assertCollectionCurrent });
                    const facts = emptyObservation.readiness;
                    nativeCarousel.assertObservation(emptyObservation);
                    return facts;
                },
                createFailure(facts) {
                    if (facts.code === 'NO_NATIVE_CARDS') return Object.assign(new Error(tLog('noNativeNetflixCardsCouldBeCollected')),
                        { code: facts.code });
                    const error = initializationError(facts.code, 'validate-count',
                        `Collected ${facts.collected} of ${facts.totalCount} My List items`,
                        { collected: facts.collected, totalCount: facts.totalCount,
                            endingPage: nativeSourceDiagnostics(section, scroller, track)?.selectedPage ?? null });
                    warn(tLog('collectedCountDoesNotMatchTotalCount'), {
                        collected: facts.collected, totalCount: facts.totalCount, stage: error.stage, code: error.code
                    });
                    return error;
                } });
            assertCollectionCurrent();
            if (collected.status === 'empty') {
                nativeCarousel.assertObservation(emptyObservation);
                finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, 'collection-confirmed-empty', emptyObservation);
                return;
            }
            const items = collected.items;

            log(tLog('fullCollectionResultFinalized'), {
                collected: items.length,
                totalCount,
                endingPage: nativeSourceDiagnostics(section, scroller, track)?.selectedPage ?? null,
                items: items.map(itemSummary)
            });
            assertCollectionCurrent();

            // Keep the native carousel at its normal position and size for React resynchronization.
            parkSource(section, scroller, track);
            const standbyNative = nativeSourceDiagnostics(section, scroller, track);
            log(tLog('nativeCarouselStandbyMode'), {
                selectedPage: standbyNative?.selectedPage ?? null,
                parked: standbyNative?.sourceParked ?? false
            });
            assertCollectionCurrent();
            await buildGrid(section, scroller, items, layout, totalCount, sessionToken);
            assertRouteSession(sessionToken);
            sourceState.empty = false;
            applyOriginalMyListVisibility();

            // Defer React-backed hover preparation until the first actual hover.
            // The live native card is resolved on demand, keeping initialization off the hover path.
            const deferredNative = nativeSourceDiagnostics(section, scroller, track);
            log(tLog('initialHoverPreparationDeferred'), {
                selectedPage: deferredNative?.selectedPage ?? null,
                currentPageCards: deferredNative?.currentPageCards ?? 0
            });
            if (sourceState) ensureListMembership(sourceState).observeCount({ collectedCount: items.length, totalCount });
            completedSection = section;
            if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
                performanceDiagnostics.nativeRecovery.completed++;
            }
            resetOrderMismatchStateAfterInitialization();
            sourceState.initializationElapsedMs = performance.now() - initializationStarted;
            updateStatus(formatHeaderParts(items.length, totalCount, sourceState.initializationElapsedMs, true));

            initializeWatchGroups(sourceState, sessionToken);

            log(tLog('initializationCompleted'), {
                collected: items.length,
                totalCount,
                    initialPages,
                initialColumns: layout.columns,
                initialCardWidth: layout.cardWidth,
                initializationElapsedMs: Math.round(sourceState.initializationElapsedMs),
                snapshot: collectRuntimeSnapshot()
            });
        } catch (error) {
            if (isRouteSessionCancelledError(error)) {
                log(tLog('initializationCancelledByRouteChange'), {
                    sessionToken,
                    url: location.href
                });
            } else if (error?.code === 'NATIVE_SOURCE_REPLACED') {
                log('Native collection discarded after source replacement', { sessionToken });
                retryNativeCollection = true;
            } else if (error?.code === 'GRID_BUILD_SOURCE_REPLACED') {
                log('Grid construction discarded after native source replacement', { sessionToken });
                cleanupTargetSessionDom();
                nativeCarousel.clearBinding();
                publishSourceState(null);
                completedSection = null;
                retryGridBuild = true;
            } else {
                initializationBlockedSessionToken = sessionToken;
                warn(tLog('initializationFailed'), {
                    code: error?.code || null,
                    stage: error?.stage || null,
                    timeoutMs: error?.details?.timeoutMs ?? null,
                    details: error?.details || null,
                    error,
                    snapshot: collectRuntimeSnapshot()
                });
                updateStatus(formatInitializationErrorMeta(error, earlyTotalCount));
            }
        } finally {
            // Keep queued deltas deferred until the replacement source has a
            // complete grid, rather than applying them to an incomplete frame.
            clearRunningSession(sessionToken, !retryGridBuild && !retryNativeCollection, initializationOwner);
            if (isRouteSessionActive(sessionToken)) {
                if (retryNativeCollection) scheduleRun(0, sessionToken);
                else if (retryGridBuild) runScript(sessionToken);
            }
        }
    }

    function scheduleRun(delayMs = 40, sessionToken = sessionScope.token) {
        if (!isRouteSessionActive(sessionToken)) return;
        if (initializationBlockedSessionToken === sessionToken) return;

        const normalizedDelay = Math.max(0, delayMs);
        const dueAt = performance.now() + normalizedDelay;
        if (scheduled && scheduledSessionToken === sessionToken) {
            // Keep an existing earlier/equal run, but allow a DOM mutation to pull a
            // long fallback wait (notably the native-section 1200 ms wait) forward.
            if (scheduledRunDueAt > 0 && scheduledRunDueAt <= dueAt + 1) return;
        }

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduled = true;
        scheduledSessionToken = sessionToken;
        scheduledRunDueAt = dueAt;
        scheduledRunTimer = setTimeout(() => {
            scheduledRunTimer = null;
            if (scheduledSessionToken === sessionToken) {
                scheduled = false;
                scheduledSessionToken = null;
                scheduledRunDueAt = 0;
            }
            if (!isRouteSessionActive(sessionToken)) return;
            runScript(sessionToken);
        }, normalizedDelay);
    }

    loadSettings();
    refreshMenuCommands();
    installSpaNavigationHooks();
    log(tLog('scriptStarted'), {
        version: SCRIPT_VERSION,
        url: location.href,
        userAgent: navigator.userAgent,
        browserLanguage: navigator.language || '',
        htmlLanguage: getHtmlLanguage(),
        netflixLanguage: getNetflixLanguage(),
        displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio
    });
    handleRouteChange('initial');
}
