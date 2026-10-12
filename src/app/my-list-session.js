import { createResponsive } from './responsive.js';
import { createSessionScope } from './session-scope.js';
import { createHover } from '../hover/hover.js';
import { createNativePopup } from '../netflix/native-popup.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from '../netflix/page-dom.js';
import { createGrid } from '../grid/grid.js';
import { createList } from '../list/list.js';
import { createMyListDiagnostics } from './my-list-diagnostics.js';
import { createPopupInspection } from '../netflix/popup-inspection.js';
import { GRID_ID } from '../dom-names.js';
import { createListData } from '../netflix/list-data.js';
import { createViewingData } from '../netflix/viewing-data.js';
import { createViewing } from '../viewing/viewing.js';
import { createCarousel } from '../netflix/carousel/carousel.js';

import { createMyListSource } from './my-list-source.js';
import { createMyListPresentation } from './my-list-presentation.js';
import { createMyListInitialization } from './my-list-initialization.js';
import { createMyListInteraction } from './my-list-interaction.js';

// Page-session composition: admitted cross-feature transactions and lifecycle only.
export function createMyListSession({ environment = globalThis, version, context: netflixContext, i18n, logger,
    settings, userscript = {}, saveLogs, readLogHistory, nextSessionToken, onNavigation = () => {} }) {
    const { window, document, location, Element, HTMLElement, getComputedStyle, performance,
        setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, MutationObserver, fetch,
        AbortController, queueMicrotask } = environment;
    const { getValue: GM_getValue, setValue: GM_setValue } = userscript;
    let started = false, disposed = false, sessionCleanupFailures = 0;
    const sessionPauses = new Map();

    const session = Object.freeze({ version, get scope() { return sessionScope; },
        isTargetPage, isRouteSessionActive, assertRouteSession, createRouteSessionCancelledError,
        isRouteSessionCancelledError, initializationError, sleep, cleanupTargetSessionDom,
        get active() { return targetSessionActive; }, get disposed() { return disposed; },
        get entryKind() { return targetSessionEntryKind; }, get entryReason() { return targetSessionReason; },
        useFreshEntry() { targetSessionEntryKind = 'spa'; },
        restart(reason) { suspendTargetSession(reason); if (isTargetPage()) startTargetSession(reason); }
    });
    // Constructors are inert. Getters resolve collaborator edges after composition,
    // without sharing writable session state or activating feature resources.
    const myListSource = createMyListSource({ environment, i18n, logger, settings, session,
        get initialization() { return initialization; },
        get interaction() { return interaction; },
        get gridView() { return gridView; },
        get listView() { return listView; },
        get nativeCarousel() { return nativeCarousel; },
        get nativePopup() { return nativePopup; },
        get responsive() { return responsive; },
        get netflixDom() { return netflixDom; },
        get diagnostics() { return diagnostics; },
        get presentation() { return presentation; },
    });
    const { publishSourceState, pageForItem, setPageForItem, ensureListMembership,
        applyOriginalMyListVisibility, nativeDiscoveryObservation, syncLogicalPageModelAfterDelta,
        readMutationLayout, readMutationVisibleFacts, findNativeMyListItemByVideoId, ensureLiveNativeBinding,
        refreshNativeSectionAfterDelta } = myListSource;
    const presentation = createMyListPresentation({ environment, i18n, logger, settings, session,
        get gridView() { return gridView; },
        get nativePopup() { return nativePopup; },
        get hover() { return hover; },
        get responsive() { return responsive; },
        get viewing() { return viewing; },
        get netflixContext() { return netflixContext; },
        get diagnostics() { return diagnostics; },
        get source() { return myListSource; },
    });
    const { retireMutationCard, prepareMutationInsertion, insertMutationCard, updateMutationCard,
        presentListOrder, presentListChange } = presentation;

    const initialization = createMyListInitialization({ environment, i18n, logger, session,
        get gridView() { return gridView; },
        get listView() { return listView; },
        get listMutations() { return listMutations; },
        get nativeCarousel() { return nativeCarousel; },
        get nativePopup() { return nativePopup; },
        get hover() { return hover; },
        get responsive() { return responsive; },
        get listData() { return listData; },
        get netflixContext() { return netflixContext; },
        get diagnostics() { return diagnostics; },
        get presentation() { return presentation; },
        get interaction() { return interaction; },
        source: myListSource,
    });
    const { waitForMyListTotalCount, collectMountedSinglePageItems, recoverNativeInitialization, scheduleRun } = initialization;
    const interaction = createMyListInteraction({ environment, i18n, logger, session,
        get gridView() { return gridView; },
        get nativeCarousel() { return nativeCarousel; },
        get nativePopup() { return nativePopup; },
        get hover() { return hover; },
        get responsive() { return responsive; },
        get diagnostics() { return diagnostics; },
        get presentation() { return presentation; },
        get initialization() { return initialization; },
        source: myListSource,
    });
    const { resolveReadyHover, prepareHoverCard, clearSourceAlignment, findActiveSourceSlot,
        findItemForSourceSlot, reportListChange } = interaction;

    const diagnostics = createMyListDiagnostics({ environment, context: netflixContext, i18n, logger, settings, version, saveLogs, readLogHistory,
        session,
        get gridView() { return gridView; },
        get hover() { return hover; },
        get nativePopup() { return nativePopup; },
        get responsive() { return responsive; },
        get nativeCarousel() { return nativeCarousel; },
        get popupInspection() { return popupInspection; },
        get listMutations() { return listMutations; },
        get listView() { return listView; },
        get viewing() { return viewing; },
        get source() { return myListSource; },
        get initialization() { return initialization; },
    });
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
    const { tUi, tLog, formatUiNumber, formatItemCount } = i18n;

    const TARGET_PATH = '/browse/my-list';
    const DELTA_MUTATION_TIMEOUT_MS = 1800;
    const UNDO_ENTRY_TTL_MS = 30000;
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = 10000;
    const sessionScope = createSessionScope({ isTargetPage, AbortController, setTimeout, clearTimeout,
        requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS, nextToken: nextSessionToken });
    const gridView = createGrid({ document, location,
        imageDiagnostics: { window, location, performance, PerformanceObserver: environment.PerformanceObserver,
            getComputedStyle, readInitializationStartedAt: () => myListSource.current?.initializationStartedAt, readSessionToken: () => sessionScope.token,
            isRouteSessionActive,
            readScanFinishedAt: () => myListSource.current?.watchStatus ? viewing.diagnostics(myListSource.current.watchStatus).network?.finishedAt : null },
        runChunks: runConstructionChunks,
        createError: (code, message) => initializationError(code, 'grid-cards', message),
        installHover: grid => hover.install(grid), readPage: pageForItem,
        onRetire: (handle, detail) => { nativePopup.retire(handle); hover.retire(handle, detail); },
        tUi, formatUiNumber, formatItemCount,
        readEmptyContent: section => netflixDom.readEmptyContent(section), readEmptyShell: () => netflixDom.readEmptyShell(),
        isActive: () => targetSessionActive && isTargetPage() });

    const listView = createList({ runChunks: runConstructionChunks, assertSession: assertRouteSession,
        isCancelled: isRouteSessionCancelledError, collectMounted: collectMountedSinglePageItems,
        captureTemplate: source => gridView.captureTemplate(source), assertSource: source => nativeCarousel.assertSource(source),
        collectRecords: input => listData.collectRecords(input),
        waitInitialCount: token => waitForMyListTotalCount(undefined, token),
        readInitialFirstId: () => listData.firstMyListVideoId(), fetchBootstrap: token => listData.fetchBootstrap(token),
        onReuseRejected: detail => log('Mounted single-page membership reuse rejected; using fresh collection', detail) });

    const listMutations = listView.createMutations({ now: () => performance.now(),
        readSession: () => sessionScope.token, isSessionActive: isRouteSessionActive, setTimeout, clearTimeout,
        ttl: UNDO_ENTRY_TTL_MS, hasRetained: (id, item) => gridView.hasRetained(id, item),
        releaseRetained: id => gridView.releaseRetained(id), mutationTimeout: DELTA_MUTATION_TIMEOUT_MS,
        isBlocked: () => initialization.isNativeBlocked(sessionScope.token),
        readParent: () => myListSource.current, canApply: () => Boolean(myListSource.current && isTargetPage()),
        assertSession: assertRouteSession, isCancelled: isRouteSessionCancelledError,
        createError: (code, message) => initializationError(code, 'native-discovery', message),
        hasMember: id => myListSource.current.grid ? myListSource.current.itemMap.has('v:' + id) : null,
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
        findFallback: videoId => nativeCarousel.captureFallbackItem(videoId),
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
        normalizeTitle: netflixDom.normalizeTitle,
        onExpired: detail => log(tLog('undoEntriesExpired'), detail) });

    const BUILD_CHUNK_MAX_ITEMS = 24;
    const BUILD_CHUNK_BUDGET_MS = 6;

    const { log, warn, trace } = logger;
    const popupInspection = createPopupInspection({ Element, now: () => performance.now(),
        isCurrentSession: token => targetSessionActive && isRouteSessionActive(token),
        readSessionToken: () => sessionScope.token, isSourceMounted: () => Boolean(myListSource.current?.grid?.isConnected),
        readSourceCard: () => myListSource.current.track?.querySelector(NETFLIX_DOM_SELECTORS.standardCard) });

    const listData = createListData({ context: netflixContext, pageDom: netflixDom, location,
        fetch: (...args) => fetch(...args), performance, assertCurrent: assertRouteSession,
        isCancelled: isRouteSessionCancelledError, createError: initializationError,
        beginRequest: createRouteFetch, finishRequest: finishRouteFetch, runChunks: runConstructionChunks,
        inspection: popupInspection, log, warn, tLog, requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS });

    const nativeCarousel = createCarousel({ pageDom: netflixDom, scope: sessionScope, document, window, Element,
        getComputedStyle, performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
        readListShape: section => myListSource.current?.section === section ? { totalCount: myListSource.current.totalCount,
            columns: Math.max(1, myListSource.current.layout?.columns || 1) } : null,
        readGraphqlCount: () => listData.readMyListTotalCount(),
        cardMarkup: { capture: gridView.captureCard, captureTemplate: gridView.captureTemplate }, createError: initializationError,
        log, warn, trace, tLog, logTimeout: diagnostics.logOperationTimeout, MutationObserver,
        isHoverCancelled: token => hover.isCancelled(token), readHoverToken: () => hover.intent().token,
        navigationDiagnostics: createNavigationDiagnosticSink,
        checkRoute: () => onNavigation('MutationObserver-url'),
        onMutationDelivery: () => nativePopup.checkDetached(),
        isInitializationBlocked: () => initialization.isBlocked(sessionScope.token),
        onBlockedMutation: token => recoverNativeInitialization(token, 'document-mutation'),
        isGridDetached: () => Boolean(myListSource.completed && myListSource.current?.grid && !myListSource.current.grid.isConnected),
        shouldCoalesce: () => Boolean(myListSource.completed || (myListSource.waitingForEmpty && myListSource.current?.empty)),
        onRelevantMutation: handleRelevantTargetDocumentMutation });

    let nativePopup;
    const hover = createHover({ Element, document, performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
        sample: callback => nativeCarousel.sample(callback), grid: gridView, readSessionToken: () => sessionScope.token, isSessionCurrent: isRouteSessionActive,
        readEnvironment: () => ({ grid: myListSource.current?.grid, blockedReason: interaction.blockedReason }),
        whenStable: () => responsive.whenStable(),
        resolveReady: resolveReadyHover, prepare: prepareHoverCard, sleep, assertSession: assertRouteSession,
        isCancelledError: isRouteSessionCancelledError, describeItem: diagnostics.itemSummary, log, warn, tLog,
        createPopup: policy => { return (nativePopup = createNativePopup({ Element, Node: environment.Node, document, PointerEvent: environment.PointerEvent, MouseEvent: environment.MouseEvent, performance,
        requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, carousel: nativeCarousel, grid: gridView,
        pageDom: netflixDom, selectors: NETFLIX_DOM_SELECTORS,
        ...policy,
        readEnvironment: () => ({ grid: myListSource.current?.grid, scroller: myListSource.current?.scroller }),
        isSessionCurrent: isRouteSessionActive, itemForSource: findItemForSourceSlot, activeSource: findActiveSourceSlot,
        createError: initializationError, describeSource: diagnostics.slotDescriptor, describeItem: diagnostics.itemSummary, log, warn, trace, tLog,
        capturePreview: (...args) => popupInspection.capturePreview(...args) })); }
    });

    const responsive = createResponsive({ window, ResizeObserver: environment.ResizeObserver,
        performance, setTimeout, clearTimeout, nativeCarousel, gridView, hover, listMutations,
        source: myListSource, presentation, readSessionToken: () => sessionScope.token,
        isRouteSessionActive, assertRouteSession, createRouteSessionCancelledError, isRouteSessionCancelledError,
        realignActiveSource: () => nativePopup.checkDetached(), layoutSummary: diagnostics.layoutSummary, collectRuntimeSnapshot: diagnostics.collectRuntimeSnapshot,
        sleep, log, warn, trace, tLog, tUi, readOriginalVisibility: () => settings.preferences().viewOriginalMyList });

    let targetSessionActive = false;
    let targetSessionEntryKind = 'initial';
    let targetSessionReason = 'route:initial';
    let targetListenersActive = false;

    function createNavigationDiagnosticSink(token) { return hover.navigationSink(token); }

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

    function resetDetachedTargetState() {
        if (myListSource.completed?.isConnected && document.getElementById(GRID_ID)) return;
        if (myListSource.current?.section && !myListSource.current.section.isConnected) {
            presentation.retireViewing(myListSource.current); myListSource.retireMembership(); myListSource.retirePageHints();
        }

        listMutations.dispose(); initialization.dropDeferral();
        hover.cancel('source');
        nativeCarousel.restoreMotion();
        myListSource.complete(null);
        if (myListSource.current?.section && !myListSource.current.section.isConnected) {
            nativeCarousel.clearBinding();
            publishSourceState(null);
        }
        responsive.dispose();
        interaction.clearMutationRecovery();
        initialization.resetMissingSourceWait();
        gridView.cancelBuild();
        gridView.resetEmpty();
        listData.reset();
        myListSource.waitForEmpty(false);
    }

    function cleanupTargetSessionDom() {
        const release = operation => { try { operation(); } catch (_) { sessionCleanupFailures++; } };
        release(() => presentation.retireViewing(myListSource.current));
        release(myListSource.retireMembership); release(myListSource.retirePageHints);
        release(nativeCarousel.restoreMotion); release(clearSourceAlignment); release(() => nativePopup.invalidate());
        release(() => gridView.dispose());
        interaction.closeState();

        release(myListSource.releasePresentation);
    }

    function suspendTargetSession(reason = 'route-leave') {
        const release = operation => { try { operation(); } catch (_) { sessionCleanupFailures++; } };
        const hadSession = targetSessionActive || initialization.hasWork || myListSource.current || myListSource.completed;
        const previousToken = sessionScope.token;
        listMutations.dispose(); initialization.dropDeferral();
        presentation.retireViewing(myListSource.current); myListSource.retireMembership(); myListSource.retirePageHints();
        sessionScope.dispose();
        targetSessionActive = false;
        const pauses = [...sessionPauses]; sessionPauses.clear();
        for (const [timer, settle] of pauses) { release(() => clearTimeout(timer)); settle(); }
        gridView.images.dispose();
        hover.dispose();

        initialization.cancelScheduled();

        release(cleanupTargetSessionDom);
        release(stopTargetEventListeners);
        release(() => responsive.dispose());
        release(() => nativeCarousel.resetSource());

        initialization.retire();
        myListSource.complete(null);
        nativeCarousel.clearBinding();
        publishSourceState(null);
        initialization.resetMissingSourceWait();
        listData.reset();
        myListSource.waitForEmpty(false);

        interaction.retire();

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
        initialization.begin(); hover.resetDiagnostics();
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

    // Viewing status is read separately from native card markup. A shared card
    // template or membership in Continue Watching cannot establish completion.

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

    function handleObservedMyListToggleClick(event) {
        if (!isTargetPage() || !myListSource.current) return;
        listMutations.observeClick(() => {
            const membership = netflixDom.describeMembershipClick(event, { activeVideoId: hover.intent().videoId });
            return { membership, toastAction: !membership && netflixDom.describeToastActionClick(event) };
        });
    }

    function handleRelevantTargetDocumentMutation(sessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        if ((myListSource.completed || (myListSource.waitingForEmpty && myListSource.current?.empty)) && myListSource.current?.grid?.isConnected) {
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

    // Public page-session boundary; all feature state remains private to its capability.
    function start(reason = 'route:initial') {
        if (started || disposed) return;
        started = true; startTargetSession(reason);
    }
    function dispose(reason = 'route-leave') {
        if (disposed) return;
        disposed = true; suspendTargetSession(reason);
    }
    return Object.freeze({ start, dispose, copyLogs: diagnostics.copyDiagnosticLogs, diagnosticSnapshot: diagnostics.snapshot,
        check() { if (!started || disposed) return; resetDetachedTargetState(); scheduleRun(0, sessionScope.token); },
        preferencesChanged() {
            if (!started || disposed) return;
            try { applyOriginalMyListVisibility(); }
            catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED') throw error;
                // The saved preference is applied by the next admitted source.
                // A menu click can arrive between Netflix detaching and replacing it.
                scheduleRun(0, sessionScope.token);
            }
        },
        diagnostics: () => Object.freeze({ active: targetSessionActive, token: sessionScope.token,
            running: Boolean(initialization.running), completed: Boolean(myListSource.completed), blocked: initialization.isBlocked(sessionScope.token), cleanupFailures: sessionCleanupFailures }) });
}
