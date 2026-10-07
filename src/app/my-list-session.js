import { createResponsive } from './responsive.js';
import { createSessionScope } from './session-scope.js';
import { createHover } from '../hover/hover.js';
import { createNativePopup } from '../netflix/native-popup.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from '../netflix/page-dom.js';
import { createGrid } from '../grid/grid.js';
import { createList } from '../list/list.js';
import { createReport } from '../diagnostics/report.js';
import { createPopupInspection } from '../netflix/popup-inspection.js';
import {
    GRID_ID, STATUS_ID, SECTION_ATTR,
    STATUS_LABEL_CLASS, STATUS_META_CLASS,
    SYNTHETIC_SECTION_ID
} from '../dom-names.js';
import { createListData } from '../netflix/list-data.js';
import { createViewingData } from '../netflix/viewing-data.js';
import { createViewing } from '../viewing/viewing.js';
import { createCarousel } from '../netflix/carousel/carousel.js';

// Page-session composition: admitted cross-feature transactions and lifecycle only.
export function createMyListSession({ environment = globalThis, version, context: netflixContext, i18n, logger,
    settings, userscript = {}, nextSessionToken, onNavigation = () => {} }) {
    const { window, document, navigator, location, Element, HTMLElement, getComputedStyle, performance,
        setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, MutationObserver, fetch,
        AbortController, queueMicrotask, console } = environment;
    const { getValue: GM_getValue, setValue: GM_setValue } = userscript;
    let started = false, disposed = false, sessionCleanupFailures = 0;
    const sessionPauses = new Map();

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
        formatUiNumber, formatItemCount, formatInitializationTime } = i18n;

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
        requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS, nextToken: nextSessionToken });
    const gridView = createGrid({ document, location,
        imageDiagnostics: { window, location, performance, PerformanceObserver: environment.PerformanceObserver,
            getComputedStyle, readInitializationStartedAt: () => sourceState?.initializationStartedAt, readSessionToken: () => sessionScope.token,
            isRouteSessionActive,
            readScanFinishedAt: () => sourceState?.watchStatus ? viewing.diagnostics(sourceState.watchStatus).network?.finishedAt : null },
        runChunks: runConstructionChunks,
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
        onExpired: detail => log(tLog('undoEntriesExpired'), detail) });

    const BUILD_CHUNK_MAX_ITEMS = 24;
    const BUILD_CHUNK_BUDGET_MS = 6;
    // Short, coalesced callback-gap samples; never a continuous FPS/paint monitor.

    const SCRIPT_NAME = 'My List for Netflix';
    const SCRIPT_VERSION = version;
    // Enable temporarily when detailed source-card traces are needed for diagnosis.

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
        readThumbnails: () => gridView.images.collect(), readNativePopup: () => popupInspection.collect() });

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
        checkRoute: () => onNavigation('MutationObserver-url'),
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
        whenStable: () => responsive.whenStable(),
        resolveReady: resolveReadyHover, prepare: prepareHoverCard, sleep, assertSession: assertRouteSession,
        isCancelledError: isRouteSessionCancelledError, describeItem: itemSummary, log, warn, tLog,
        createPopup: policy => { return (nativePopup = createNativePopup({ Element, Node: environment.Node, document, PointerEvent: environment.PointerEvent, MouseEvent: environment.MouseEvent, performance,
        requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, carousel: nativeCarousel, grid: gridView,
        pageDom: netflixDom, selectors: NETFLIX_DOM_SELECTORS,
        ...policy,
        readEnvironment: () => ({ grid: sourceState?.grid, scroller: sourceState?.scroller }),
        isSessionCurrent: isRouteSessionActive, itemForSource: findItemForSourceSlot, activeSource: findActiveSourceSlot,
        createError: initializationError, describeSource: slotDescriptor, describeItem: itemSummary, log, warn, trace, tLog,
        capturePreview: (...args) => popupInspection.capturePreview(...args) })); }
    });


    let responsiveParent = null, responsiveView = null;
    const responsiveParents = new WeakMap();
    function readResponsiveState() {
        if (!sourceState) return null;
        if (responsiveParent !== sourceState) {
            responsiveParent = sourceState;
            const parent = sourceState;
            responsiveView = Object.freeze(Object.defineProperties({}, Object.fromEntries([
                'section', 'scroller', 'track', 'grid', 'status', 'layout', 'items', 'itemMap', 'cloneMap', 'totalCount',
                'empty', 'resizeViewportSignature', 'initializationElapsedMs', 'initialPage'
            ].map(key => [key, { enumerable: true, get: () => parent[key] }]))));
            responsiveParents.set(responsiveView, parent);
        }
        return responsiveView;
    }
    function responsiveParentFor(view) {
        const parent = responsiveParents.get(view);
        if (!parent || sourceState !== parent) throw createRouteSessionCancelledError();
        return parent;
    }
    const responsive = createResponsive({ window, ResizeObserver: environment.ResizeObserver,
        performance, setTimeout, clearTimeout, nativeCarousel, gridView, hover, listMutations,
        readState: readResponsiveState, readSessionToken: () => sessionScope.token,
        acceptLayoutChange: (view, layout) => { responsiveParentFor(view).layout = layout; },
        acceptInitialPage: (view, page) => { responsiveParentFor(view).initialPage = page; },
        acceptViewportSignature: (view, signature) => { responsiveParentFor(view).resizeViewportSignature = signature; },
        isRouteSessionActive, assertRouteSession, createRouteSessionCancelledError, isRouteSessionCancelledError,
        nativeSourceObservation: (view, options) => nativeSourceObservation(responsiveParentFor(view), options),
        nativeLayoutObservation: (section, scroller, track, mode, view) => nativeLayoutObservation(section, scroller, track, mode, responsiveParentFor(view)),
        nativeSourceDiagnostics, ensureLiveNativeBinding,
        applyGridGeometry, layoutFrameStatus, updateStatus, formatHeaderParts, measureNativeCarouselGap,
        pageForItem, setPageForItem: (item, page, view, admission) => setPageForItem(item, page, responsiveParentFor(view), admission),
        itemKey, copyItemAttributes, currentGridGeometry,
        realignActiveSource: () => nativePopup.checkDetached(), layoutSummary, collectRuntimeSnapshot,
        sleep, log, warn, trace, tLog, tUi, readOriginalVisibility: () => settings.preferences().viewOriginalMyList, applyLegacyEmptyStateGeometry });
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
        return nativeCarousel.preferredPage({ record: item, hints: sourceState ? ensurePageHints(sourceState) : null,
            records: sourceState?.items || [], columns: sourceState?.layout?.columns || 1 });
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
    let initializationDeferral = null;
    let completedSection = null;
    let scheduled = false;
    let scheduledSessionToken = null;
    let scheduledRunTimer = null;
    let scheduledRunDueAt = 0;
    let sourceState = null;
    let orderMismatchDismissed = false;
    let orderMismatchDialogOpen = false;
    let orderMismatchReinitializing = false;
    let mutationSourceRecoveryPending = false;
    let targetSessionActive = false;
    let targetSessionEntryKind = 'initial';
    let targetSessionReason = 'route:initial';
    let targetListenersActive = false;
    let missingSectionSince = 0;
    let waitingForNativeEmpty = false;
    let initializationBlockedSessionToken = null;
    let nativeInitializationFailure = null;
    let performanceDiagnostics = createPerformanceDiagnostics();

    function createPerformanceDiagnostics() {
        return {
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0 }
        };
    }

    function collectPerformanceDiagnostics() {
        const snapshots = Object.fromEntries(Object.entries(performanceDiagnostics).map(([key, counters]) => [key, { ...counters }]));
        return { viewingGroups: gridView.groupDiagnostics(), hoverPreparation: hover.diagnostics().hoverPreparation,
            popupInvestigation: popupInspection.diagnostics(), ...snapshots,
            nativeRecovery: { ...snapshots.nativeRecovery, alignmentRestores: nativePopup.diagnostics().alignmentRestores,
                alignmentRestoreFailures: nativePopup.diagnostics().alignmentRestoreFailures },
            undoRetention: listMutations.workDiagnostics(), resize: responsive.diagnostics().resize, imageResources: gridView.images.diagnostics(), ...hover.diagnostics(), ...listView.diagnostics(), nativeCollection: nativeCarousel.diagnostics().collection, grid: gridView.diagnostics() };
    }

    function createNavigationDiagnosticSink(token) { return hover.navigationSink(token); }

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
        return !disposed && sessionScope.isCurrent(sessionToken);
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

        listMutations.dispose(); initializationDeferral = null;
        hover.cancel('source');
        restoreActiveCarouselStyles();
        completedSection = null;
        if (sourceState?.section && !sourceState.section.isConnected) {
            nativeCarousel.clearBinding();
            publishSourceState(null);
        }
        responsive.dispose();
        mutationSourceRecoveryPending = false;
        missingSectionSince = 0;
        gridView.cancelBuild();
        gridView.resetEmpty();
        listData.reset();
        waitingForNativeEmpty = false;
    }

    function cleanupTargetSessionDom() {
        const release = operation => { try { operation(); } catch (_) { sessionCleanupFailures++; } };
        release(() => viewing.dispose(sourceState?.watchStatus));
        release(() => sourceState?.listMembership?.dispose()); release(() => sourceState?.nativePageHints?.dispose());
        release(restoreActiveCarouselStyles); release(clearSourceAlignment); release(() => nativePopup.invalidate());
        release(() => gridView.dispose());
        orderMismatchDialogOpen = false;

        const lease = nativePresentationLease; nativePresentationLease = null;
        release(() => lease?.release());
    }

    function suspendTargetSession(reason = 'route-leave') {
        const release = operation => { try { operation(); } catch (_) { sessionCleanupFailures++; } };
        const hadSession = targetSessionActive || running || sourceState || completedSection || scheduled;
        const previousToken = sessionScope.token;
        listMutations.dispose(); initializationDeferral = null;
        viewing.dispose(sourceState?.watchStatus); sourceState?.listMembership?.dispose(); sourceState?.nativePageHints?.dispose();
        sessionScope.dispose();
        targetSessionActive = false;
        const pauses = [...sessionPauses]; sessionPauses.clear();
        for (const [timer, settle] of pauses) { release(() => clearTimeout(timer)); settle(); }
        gridView.images.dispose();
        hover.dispose();

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduledRunTimer = null;
        scheduled = false;
        scheduledSessionToken = null;
        scheduledRunDueAt = 0;

        release(cleanupTargetSessionDom);
        release(stopTargetEventListeners);
        release(() => responsive.dispose());
        release(() => nativeCarousel.resetSource());

        running = false;
        runningSessionToken = null;
        completedSection = null;
        nativeCarousel.clearBinding();
        publishSourceState(null);
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
        responsive.resetDiagnostics();
        gridView.images.reset(); gridView.images.start(sessionScope.token);
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
            viewOriginalMyList: settings.preferences().viewOriginalMyList,
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
            ...responsive.diagnostics(),
            resizeViewportSignature: sourceState?.resizeViewportSignature || '',
            hoverScrollState: hover.diagnostics().hoverScrollState,
            pointer: { x: hover.intent().pointerX, y: hover.intent().pointerY }
        };
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
        if (!nativeSourcePresentation(undefined, undefined, undefined, { visible: settings.preferences().viewOriginalMyList })) return;
        if (sourceState?.status) {
            layoutFrameStatus(sourceState.status, null, settings.preferences().viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0);
        }
    }

    function sleep(ms) {
        if (disposed) return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                if (sessionPauses.get(timer) !== resolve) return;
                sessionPauses.delete(timer); resolve();
            }, ms);
            sessionPauses.set(timer, resolve);
        });
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
            status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
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
            resizeViewportSignature: responsive.viewportSignature(),
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
        responsive.observe('native-empty');
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
        return netflixDom.normalizeTitle(value);
    }


    function installEmptyFrameResizeObserver() { responsive.observe('empty'); }

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
        gridView.mount({ section: live.section, anchor: live.scroller, status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
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

        responsive.observe();

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
        gridView.mount({ section: live.section, anchor: originalAnchor, status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
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
            originalVisible: settings.preferences().viewOriginalMyList
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
        responsive.expectCountConvergence();
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
        return gridView.insertCard(record, { ...options, ordered: !parent.watchStatus });
    }

    function updateMutationCard(record, index, { parent, assertCurrent }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(itemKey(record));
        if (clone?.isConnected) copyItemAttributes(clone, record, index);
        assertCurrent();
    }

    function presentListOrder(change, { parent, assertCurrent }) {
        assertCurrent();
        if (parent.grid && !parent.watchStatus) gridView.applyMembershipOrder(change, assertCurrent);
    }

    function presentListChange({ count, empty, logical }, { parent, assertCurrent }) {
        assertCurrent(); parent.empty = empty;
        if (logical && count) { responsive.requestCheck(140, 'my-list-delta'); assertCurrent(); }
        gridView.setEmpty(empty); assertCurrent();
        waitingForNativeEmpty = empty;
        if (empty) syncLegacyEmptyState(parent.section, { allowProvisional: true });
        else clearLegacyEmptyState();
        assertCurrent(); nativePopup.invalidate(); assertCurrent();
        if (parent.watchStatus) { syncWatchGroups(parent); assertCurrent(); }
        const status = updateStatus(formatHeaderParts(count, count, parent.initializationElapsedMs, true));
        assertCurrent(); parent.status = status;
        if (status && parent.layout) {
            layoutFrameStatus(status, null, settings.preferences().viewOriginalMyList && !empty ? (parent.layout.rowGap || 0) : 0);
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

    function findAnyStandardCardItemByVideoId(videoId) { return nativeCarousel.captureFallbackItem(videoId); }

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
        responsive.dispose();
        completedSection = null;
        nativeCarousel.clearBinding();
        publishSourceState(null);
        waitingForNativeEmpty = false;
        missingSectionSince = 0;
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
            try { await Promise.resolve(responsive.whenStable()); } catch (_) {}
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


    function pageItemKeys(items, page) {
        return new Set(items.filter(item => pageForItem(item) === page).map(itemKey).filter(Boolean));
    }

    async function ensureFreshIndicatorPageZeroAnchor(section, scroller, track, firstVideoId, sessionToken = null) {
        return nativeCarousel.anchorPageZero({ section, scroller, track, firstVideoId, sessionToken,
            columns: sourceState?.layout?.columns });
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
        return ensureListMembership(sourceState).positionDeviation(item, source.itemIndex);
    }

    function firstVisibleNativePositionMismatch(cards) {
        return sourceState ? ensureListMembership(sourceState).firstPositionMismatch(cards, ORDER_MISMATCH_POSITION_THRESHOLD) : null;
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
        const identity = nativeCarousel.cardIdentity(slot);
        return identity && sourceState?.itemMap ? sourceState.itemMap.get(itemKey(identity)) || null : null;
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
                        const promptSuppression = responsive.suppression();
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
                    hover.observeReplacement(handle);
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
                section, anchor: scroller, status, geometry, layout, visible: settings.preferences().viewOriginalMyList, assertCurrent: assertBuildActive,
                onAccepted(root) {
                    publication.commit(); pageHints.commit(); attachGridRegistry(buildState);
                    buildState.grid = root; buildState.status = status; buildState.layout = layout;
                    if (buildState.watchStatus) bindViewingSession(buildState, sessionToken, true);
                } });
        } finally { pageHints.discard(); transfer.discard(); }
        clearLegacyEmptyState({ restoreGrid: false });
        if (sourceState.watchStatus) syncWatchGroups(sourceState);

        responsive.acceptLayout(layout);
        // Remember the viewport used to publish this grid before observing the
        // source's own collapse to the hidden, one-pixel standby height.
        buildState.resizeViewportSignature = responsive.viewportSignature();

        responsive.observe();

        log(tLog('legacyGridBuilt'), {
            items: items.length,
            totalCount,
            geometry,
            layout: layoutSummary(layout),
            gridCards: gridView.cards.size
        });

        return grid;
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
        responsive.start();
        nativeCarousel.startDiscovery();
    }

    function stopTargetEventListeners() {
        hover.dispose();
        nativePopup.finishProbe({ result: 'released-before-check', reason: 'listeners-stopped' });
        nativePopup.release('listeners-stopped');
        if (!targetListenersActive && !nativeCarousel.diagnostics().discoveryActive) return;
        targetListenersActive = false;
        document.removeEventListener('click', handleObservedMyListToggleClick, true);
        responsive.dispose();
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
        responsive.dispose();
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
            resizeViewportSignature: responsive.viewportSignature(),
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
        const timer = setTimeout(() => {
            if (scheduledRunTimer !== timer || disposed) return;
            scheduledRunTimer = null;
            if (scheduledSessionToken === sessionToken) {
                scheduled = false;
                scheduledSessionToken = null;
                scheduledRunDueAt = 0;
            }
            if (!isRouteSessionActive(sessionToken)) return;
            runScript(sessionToken);
        }, normalizedDelay);
        scheduledRunTimer = timer;
    }

    // Public page-session boundary; all feature state remains private to its capability.
    function start(reason = 'route:initial') {
        if (started || disposed) return;
        started = true; startTargetSession(reason);
    }
    function dispose(reason = 'route-leave') {
        if (disposed) return;
        disposed = true; suspendTargetSession(reason);
    }
    return Object.freeze({ start, dispose,
        check() { if (!started || disposed) return; resetDetachedTargetState(); scheduleRun(0, sessionScope.token); },
        preferencesChanged() { if (started && !disposed) applyOriginalMyListVisibility(); },
        diagnostics: () => Object.freeze({ active: targetSessionActive, token: sessionScope.token,
            running, completed: Boolean(completedSection), blocked: initializationBlockedSessionToken === sessionScope.token, cleanupFailures: sessionCleanupFailures }) });
}
