import { createNetflixContext } from './netflix/context.js';
import { createNetflixPageDom, NETFLIX_DOM_SELECTORS } from './netflix/page-dom.js';
import { createCardMarkup } from './netflix/card-markup.js';
import { createLogger } from './diagnostics/logger.js';
import { createReport } from './diagnostics/report.js';
import { createPopupInspection } from './netflix/popup-inspection.js';
import {
    GRID_ID, STATUS_ID, ORDER_MISMATCH_DIALOG_ID, SECTION_ATTR,
    SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS, LOG_LINK_ID, STATUS_TEXT_CLASS,
    STATUS_LABEL_CLASS, STATUS_META_CLASS, FAST_MOVE_CLASS, ORIGINAL_HIDDEN_CLASS,
    ORIGINAL_VISIBILITY_ATTR, ORIGINAL_HEADER_CLASS, SYNTHETIC_SECTION_ID,
    LEGACY_EMPTY_STATE_ID, OLD_IDS, OLD_STYLE_IDS
} from './dom-names.js';
import { createI18n } from './i18n/i18n.js';
import { installStyles, removeStyles } from './grid/styles.js';
import { createListData } from './netflix/list-data.js';
import { createViewingData } from './netflix/viewing-data.js';
import { createSessionScope } from './app/session-scope.js';
import { createCarousel } from './netflix/carousel/carousel.js';

// Transitional runtime; responsibilities move to their declared owners in P03-P20.
export function startLegacy() {
    'use strict';

    const netflixContext = createNetflixContext({ window, document, navigator, location });
    const { getHtmlLanguage, getNetflixLanguage } = netflixContext;
    const viewingData = createViewingData({ context: netflixContext,
        fetch: (...args) => fetch(...args), createCancelledError: createRouteSessionCancelledError });
    const netflixDom = createNetflixPageDom({ document, Element, location,
        readGraphqlIdentity: () => listData.myListDomIdentity() });
    const { findMyListSection, nativeCardIdentity, videoIdFromHref, decodeTrackingContext } = netflixDom;
    const cardMarkup = createCardMarkup({ location });
    const itemFromSlot = cardMarkup.capture;
    const { getUiLocale, getLogLocale, tUi, tUiPlural, tLog,
        formatUiNumber, formatItemCount, formatInitializationTime } = createI18n({ readLanguage: getNetflixLanguage });

    const TARGET_PATH = '/browse/my-list';
    const PAGE_STABLE_TIMEOUT_MS = 2000;
    const NATIVE_READY_TIMEOUT_MS = 3000;
    const NATIVE_SINGLE_PAGE_STABLE_MS = 700;
    const NATIVE_EMPTY_STABLE_MS = 1200;
    const NATIVE_READY_POLL_MS = 25;
    const NATIVE_LOGICAL_STABLE_MS = 120;
    const DELTA_MUTATION_TIMEOUT_MS = 1800;
    const UNDO_ENTRY_TTL_MS = 30000;
    const HOVER_SOURCE_TIMEOUT_MS = 500;
    const HOVER_SOURCE_INTERVAL_MS = 10;
    const HOVER_ACTIVATION_DELAY_MS = 120;
    const HOVER_SCROLL_QUIET_MS = 180;
    const HOVER_RETRY_DELAY_MS = 180;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    const TOTAL_COUNT_TIMEOUT_MS = 5000;
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = 10000;
    const sessionScope = createSessionScope({ isTargetPage, AbortController, setTimeout, clearTimeout,
        requestTimeoutMs: FRESH_MY_LIST_FETCH_TIMEOUT_MS });
    const BUILD_CHUNK_MAX_ITEMS = 24;
    const BUILD_CHUNK_BUDGET_MS = 6;
    const VIEWING_TITLE_BATCH_SIZE = viewingData.limits.titleBatch;
    const VIEWING_EPISODE_BATCH_SIZE = viewingData.limits.episodeBatch;
    const VIEWING_MAX_SEASONS = viewingData.limits.seasons;
    const VIEWING_MAX_EPISODES = viewingData.limits.episodes;
    const VIEWING_MAX_REQUESTS = 32;
    const VIEWING_MAX_PASSES = 3;
    // Controlled overlap experiment; compare completion timing and failures in Copy Logs.
    const VIEWING_REQUEST_CONCURRENCY = 2;
    const VIEWING_TIMEOUT_MS = 30000;
    const VIEWING_COMPLETION_RATIO = 0.90;
    // Read-only, on-demand Copy Logs samples; no work is added to scrolling.
    const THUMBNAIL_DIAGNOSTIC_LIMITS = Object.freeze({
        cards: 600, geometry: 24, resourceEntries: 2000
    });
    const IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES = 4000;
    // Short, coalesced callback-gap samples; never a continuous FPS/paint monitor.
    const HOVER_FRAME_DIAGNOSTIC_LIMITS = Object.freeze({ routeFrames: 12000, windowFrames: 1800,
        intentMs: 600, preparationMs: 6000, replayMs: 2000, scrollMs: 1000 });
    // One delayed presence check per sampled replay, cancelled by an earlier
    // preview transfer or exit. This does not retry or alter native hover.
    const HOVER_PREVIEW_DIAGNOSTIC_LIMITS = Object.freeze({ delayMs: 900, routeReplays: 48, roots: 6 });
    const HOVER_INTERRUPTION_LOG_LIMIT = 48;
    const HOVER_CANCELLATION_REASONS = Object.freeze({ scroll: 'Scroll', 'pointer-leave': 'PointerLeave',
        superseded: 'Superseded', resize: 'Resize', group: 'Group', source: 'Source', route: 'Route',
        controls: 'Controls', 'outside-grid': 'OutsideGrid', preview: 'Preview', other: 'Other' });

    const SCRIPT_NAME = 'My List for Netflix';
    const SCRIPT_VERSION = __SCRIPT_VERSION__;
    // Enable temporarily when detailed source-card traces are needed for diagnosis.
    const VERBOSE_INTERACTION_LOGS = false;
    const SETTINGS_STORAGE_KEY = 'legacyMyListForNetflix.settings.v3';
    const VIEWING_CHOICES_STORAGE_KEY = 'legacyMyListForNetflix.viewingChoices.v1.';
    const VIEWING_CACHE_STORAGE_KEY = 'legacyMyListForNetflix.viewingCache.v1.';
    const VIEWING_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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
        readGraphqlCount: () => listData.readMyListTotalCount(), cardMarkup, createError: initializationError,
        log, warn, trace, tLog, logTimeout: logOperationTimeout, describeSlot: slotDescriptor, MutationObserver,
        isHoverCancelled: hoverPreparationCancelled, readHoverToken: () => hoverToken,
        navigationDiagnostics: createNavigationDiagnosticSink,
        checkRoute: () => { if (location.href !== lastObservedUrl) handleRouteChange('MutationObserver-url'); },
        onMutationDelivery: () => { if (activeNativeHover?.previewRoot && !activeNativeHover.previewRoot.isConnected)
            releaseNativePreview(activeNativeHover, 'preview-removed'); },
        isInitializationBlocked: () => initializationBlockedSessionToken === sessionScope.token,
        onBlockedMutation: token => recoverNativeInitialization(token, 'document-mutation'),
        isGridDetached: () => Boolean(completedSection && sourceState?.grid && !sourceState.grid.isConnected),
        shouldCoalesce: () => Boolean(completedSection || (waitingForNativeEmpty && sourceState?.empty)),
        onRelevantMutation: handleRelevantTargetDocumentMutation });

    // Temporary publication bridge: sourceState may borrow native references,
    // but only the carousel can accept a binding or invalidate its generation.
    function attachNativeBinding(state, section, scroller = null, track = null) {
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

    function formatHeaderParts(current, total, elapsedMs = null, finalized = false) {
        if (finalized && sourceState?.watchStatus && current === sourceState.items?.length && total === current) {
            const watch = sourceState.watchStatus;
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
    let completedSection = null;
    let scheduled = false;
    let scheduledSessionToken = null;
    let scheduledRunTimer = null;
    let scheduledRunDueAt = 0;
    let sourceState = null;
    let resizeObserver = null;
    let hoverToken = 0;
    let orderMismatchDismissed = false;
    let orderMismatchDialogOpen = false;
    let orderMismatchReinitializing = false;
    let activeVideoId = null;
    let activePage = null;
    let activeClone = null;
    let activeSourceSlot = null;
    let activeGeometryProxy = null;
    let activeNativeHover = null;
    let responsiveRefreshTimer = null;
    let responsiveRefreshPromise = null;
    let responsiveRefreshing = false;
    let activeResponsiveReason = '';
    let myListCountConvergencePending = false;
    let mutationSourceRecoveryPending = false;
    let lastResponsiveSignature = '';
    let lastPageShape = '';
    let lastPointerX = -1;
    let lastPointerY = -1;
    let lastTargetScrollAt = -Infinity;
    let hoverNeedsPointerMove = false;
    let pendingGridHoverClone = null;
    let pendingGridHoverDiagnostic = null;
    let activeHoverPreparationDiagnostic = null;
    const graftedGridClones = new Set();
    let hoverSequence = 0;
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
    let logFeedbackTimer = null;
    let missingSectionSince = 0;
    let pendingMyListMutations = new Map();
    let recentRemovedMyListItems = new Map();
    let undoExpiryTimer = null;
    let myListMutationSequence = 0;
    let waitingForNativeEmpty = false;
    let cachedNativeEmptyContent = null;
    let cachedNativeEmptyMessage = '';
    let initializationBlockedSessionToken = null;
    let nativeInitializationFailure = null;
    let performanceDiagnostics = createPerformanceDiagnostics();
    let imageResourceObserver = null;
    let hoverFrameDiagnosticOwner = null;

    function createPerformanceDiagnostics() {
        return {
            viewingGroups: { syncs: 0, fullSyncs: 0, cardsConsidered: 0, controlsUpdated: 0, categoryMoves: 0,
                hoverPreserved: 0, hoverCancelled: 0, lastReason: '' },
            hoverPreparation: { calls: 0, slotsConsidered: 0, clonesRebuilt: 0, neighborsSkipped: 0 },
            hoverLifecycle: { replayAttempts: 0, replaysDispatched: 0, replayCancelled: 0, replayFailed: 0,
                exitsDispatched: 0, exitSkipped: 0, exitFailed: 0, scrollBursts: 0, scrollExits: 0,
                lastExitReason: '', boundaryDetoursAvoided: 0, duplicateAlignmentsAvoided: 0,
                duplicatePageReadsAvoided: 0, logicalMoveReads: 0, logicalMoveObserverStarts: 0,
                logicalMoveNotifications: 0, logicalMoveSignalFrames: 0, logicalMoveFallbackWakes: 0,
                logicalMoveObserverUnsupported: 0, logicalMoveObserverFailures: 0,
                previewTransfers: 0, previewReturns: 0, previewReleases: 0, previewRejected: 0, lastPreviewReason: '' },
            hoverTiming: { dwellSamples: 0, dwellTotalMs: 0, dwellMaxMs: 0,
                queueSamples: 0, queueTotalMs: 0, queueMaxMs: 0,
                moveSamples: 0, moveTotalMs: 0, moveMaxMs: 0,
                acknowledgementSamples: 0, acknowledgementTotalMs: 0, acknowledgementMaxMs: 0,
                settlementSamples: 0, settlementTotalMs: 0, settlementMaxMs: 0,
                mainPreparationSamples: 0, mainPreparationTotalMs: 0, mainPreparationMaxMs: 0,
                watchedPreparationSamples: 0, watchedPreparationTotalMs: 0, watchedPreparationMaxMs: 0,
                graftSamples: 0, graftTotalMs: 0, graftMaxMs: 0,
                alignmentSamples: 0, alignmentTotalMs: 0, alignmentMaxMs: 0,
                replaySamples: 0, replayTotalMs: 0, replayMaxMs: 0,
                exitSamples: 0, exitTotalMs: 0, exitMaxMs: 0,
                previewSamples: 0, previewTotalMs: 0, previewMaxMs: 0 },
            hoverInteraction: { intentsQueued: 0, intentsCancelled: 0, dwellCompleted: 0, dwellRejected: 0,
                replacementNotHovered: 0, replayGuardRejected: 0, leavesBeforeReplay: 0, leavesAfterReplay: 0,
                leavesWithin600ms: 0, stationaryLeaves: 0, leavesToPreviewHint: 0, diagnosticFailures: 0,
                replacementPointerChecks: 0, replacementPointerAccepted: 0, replacementPointerRejected: 0,
                replacementPointerUnavailable: 0 },
            hoverScroll: { scope: 'scroll-intent-and-interruptions', interruptionLogLimit: HOVER_INTERRUPTION_LOG_LIMIT,
                wheelEvents: 0, scrollEvents: 0, otherScrollEvents: 0, lastScrollEvent: '',
                boundarySuppressedQuiet: 0, boundarySuppressedMovement: 0, unchangedPointerEvents: 0,
                physicalRearms: 0, dwellRearms: 0, intentsDuringQuiet: 0, intentsAwaitingMovement: 0,
                cancelledDwellTotalMs: 0, cancelledDwellMaxMs: 0, lastIntentCancellationReason: '',
                preparationInterruptions: 0, interruptionLogs: 0, interruptionLogsSkipped: 0,
                lastPreparationCancellationReason: '',
                ...Object.fromEntries(Object.values(HOVER_CANCELLATION_REASONS).flatMap(reason =>
                    [[`intentCancelled${reason}`, 0], [`preparationCancelled${reason}`, 0]])) },
            hoverPreview: { scope: 'bounded-preview-presence', delayMs: HOVER_PREVIEW_DIAGNOSTIC_LIMITS.delayMs,
                routeReplayLimit: HOVER_PREVIEW_DIAGNOSTIC_LIMITS.routeReplays, rootLimit: HOVER_PREVIEW_DIAGNOSTIC_LIMITS.roots,
                scheduled: 0, completed: 0, checks: 0, pointerChecks: 0, rootSearches: 0,
                checkTotalMs: 0, checkMaxMs: 0,
                matchedTransfers: 0, matchedAtPointer: 0, matchedElsewhere: 0, noPreviewRoot: 0,
                unverifiedRoots: 0, earlyRelease: 0, invalidOwner: 0, hidden: 0, failed: 0,
                skippedAtLimit: 0, lastResult: '' },
            hoverFrames: { scope: 'bounded-animation-callback-gaps', supported: false, active: false, stopReason: '',
                routeFrameLimit: HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames,
                windowFrameLimit: HOVER_FRAME_DIAGNOSTIC_LIMITS.windowFrames,
                windows: 0, callbacks: 0, gapSamples: 0, totalGapMs: 0, maxGapMs: 0,
                gapsOver32ms: 0, gapsOver50ms: 0, gapsOver100ms: 0,
                mixedPhaseSamples: 0, mixedPhaseMaxMs: 0,
                intentSamples: 0, intentMaxMs: 0, preparationSamples: 0, preparationMaxMs: 0,
                replaySamples: 0, replayMaxMs: 0, scrollSamples: 0, scrollMaxMs: 0 },
            resize: { events: 0, checks: 0, unchanged: 0, refreshes: 0, hoverPreserved: 0, hoverCancelled: 0,
                parkedHeightChangesIgnored: 0, parkedHeightHoverPreserved: 0 },
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0, alignmentRestores: 0, alignmentRestoreFailures: 0 },
            undoRetention: { remembered: 0, expired: 0, consumed: 0, cleared: 0, schedules: 0, expiryCallbacks: 0 },
            membershipReuse: { attempts: 0, reused: 0, rejected: 0, itemsCaptured: 0, requestsAvoided: 0 },
            imageResources: { scope: 'page-images-during-list-route', supported: false, active: false, stopReason: '',
                limit: IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES, batches: 0, entriesExamined: 0, beforeRouteOrInvalid: 0,
                skippedAtLimit: 0, imageEntries: 0, startedAfterViewingScan: 0, durationSamples: 0,
                totalFetchMs: 0, maxFetchMs: 0, lastImageStartOffsetMs: null, cacheDelivery: 0,
                transferBytesReported: 0, zeroTransferSizeEntries: 0, disconnectFailures: 0 }
        };
    }

    function collectPerformanceDiagnostics() {
        const snapshots = Object.fromEntries(Object.entries(performanceDiagnostics).map(([key, counters]) => [key, { ...counters }]));
        return { viewingGroups: snapshots.viewingGroups, hoverPreparation: snapshots.hoverPreparation,
            popupInvestigation: popupInspection.diagnostics(), ...snapshots, nativeCollection: nativeCarousel.diagnostics().collection };
    }

    function createNavigationDiagnosticSink(token) {
        const lifecycle = performanceDiagnostics.hoverLifecycle;
        const timing = token === null ? null : performanceDiagnostics.hoverTiming;
        return Object.freeze({
            bump(field) { if (performanceDiagnostics.hoverLifecycle === lifecycle) lifecycle[field]++; },
            record: timing ? (phase, started) => recordHoverTiming(timing, phase, started) : null
        });
    }

    function recordHoverTiming(counters, phase, started) {
        if (performanceDiagnostics.hoverTiming !== counters) return;
        const elapsed = Math.max(0, Math.round((performance.now() - started) * 10) / 10);
        counters[`${phase}Samples`]++;
        counters[`${phase}TotalMs`] = Math.round((counters[`${phase}TotalMs`] + elapsed) * 10) / 10;
        counters[`${phase}MaxMs`] = Math.max(counters[`${phase}MaxMs`], elapsed);
        return elapsed;
    }

    function stopHoverFrameDiagnostics(reason = 'route-leave') {
        const owner = hoverFrameDiagnosticOwner;
        if (!owner) return;
        hoverFrameDiagnosticOwner = null;
        owner.counters.active = false;
        owner.counters.stopReason = reason;
        try { if (owner.frame !== null) cancelAnimationFrame(owner.frame); } catch (_) {}
    }

    function handleHoverDiagnosticVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            stopHoverFrameDiagnostics('hidden');
            finishNativePreviewDiagnostic(activeNativeHover, { result: 'hidden' });
        }
    }

    function startHoverFrameDiagnostics(phase) {
        const counters = performanceDiagnostics.hoverFrames;
        try {
            if (!Object.hasOwn(HOVER_FRAME_DIAGNOSTIC_LIMITS, `${phase}Ms`)) return;
            if (!isRouteSessionActive(sessionScope.token)) return;
            if (hoverFrameDiagnosticOwner && hoverFrameDiagnosticOwner.counters !== counters) {
                stopHoverFrameDiagnostics('owner-replaced');
            }
            counters.supported = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
            if (!counters.supported) { counters.stopReason = 'unsupported'; return; }
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                stopHoverFrameDiagnostics('hidden'); counters.stopReason = 'hidden'; return;
            }
            if (counters.callbacks >= HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames) {
                counters.stopReason = 'route-frame-limit'; return;
            }
            const now = performance.now();
            let owner = hoverFrameDiagnosticOwner;
            if (!owner) {
                owner = { counters, sessionToken: sessionScope.token, frame: null, previousAt: now, mixedPhase: false };
                hoverFrameDiagnosticOwner = owner;
            }
            // Preserve an outstanding callback's baseline across phase changes:
            // a delayed dwell timer must not erase the stall that preceded it.
            // Intervals spanning phases are reported separately, not attributed
            // entirely to preparation or entirely to Netflix's popup replay.
            if (owner.phase !== phase && now > owner.previousAt) owner.mixedPhase = true;
            owner.phase = phase;
            owner.deadline = now + HOVER_FRAME_DIAGNOSTIC_LIMITS[`${phase}Ms`];
            owner.windowFrames = 0;
            counters.windows++;
            counters.active = true;
            counters.stopReason = '';
            if (owner.frame === null) owner.frame = requestAnimationFrame(() => sampleHoverFrameDiagnostics(owner));
        } catch (_) {
            stopHoverFrameDiagnostics('api-failed'); counters.active = false; counters.stopReason = 'api-failed';
        }
    }

    function sampleHoverFrameDiagnostics(owner) {
        if (hoverFrameDiagnosticOwner !== owner) return;
        owner.frame = null;
        try {
            if (performanceDiagnostics.hoverFrames !== owner.counters || !isRouteSessionActive(owner.sessionToken)) {
                stopHoverFrameDiagnostics('owner-replaced'); return;
            }
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                stopHoverFrameDiagnostics('hidden'); return;
            }
            const now = performance.now();
            const gap = Math.max(0, Math.round((now - owner.previousAt) * 10) / 10);
            owner.previousAt = now;
            const counters = owner.counters;
            counters.callbacks++;
            counters.gapSamples++;
            counters.totalGapMs = Math.round((counters.totalGapMs + gap) * 10) / 10;
            counters.maxGapMs = Math.max(counters.maxGapMs, gap);
            if (gap > 32) counters.gapsOver32ms++;
            if (gap > 50) counters.gapsOver50ms++;
            if (gap > 100) counters.gapsOver100ms++;
            const phase = owner.mixedPhase ? 'mixedPhase' : owner.phase;
            counters[`${phase}Samples`]++;
            counters[`${phase}MaxMs`] = Math.max(counters[`${phase}MaxMs`], gap);
            owner.mixedPhase = false;
            // Include a late callback's gap before stopping at the deadline.
            if (counters.callbacks >= HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames) {
                stopHoverFrameDiagnostics('route-frame-limit'); return;
            }
            if (++owner.windowFrames >= HOVER_FRAME_DIAGNOSTIC_LIMITS.windowFrames) {
                stopHoverFrameDiagnostics('window-frame-limit'); return;
            }
            if (now >= owner.deadline) { stopHoverFrameDiagnostics('window-complete'); return; }
            owner.frame = requestAnimationFrame(() => sampleHoverFrameDiagnostics(owner));
        } catch (_) { stopHoverFrameDiagnostics('api-failed'); }
    }

    function hoverReplayGuardDiagnostic(clone, generation, token, sessionToken, item) {
        // Failure-only scalar checks: no rectangles, styles, DOM search or React data.
        try {
            return { token, currentToken: hoverToken, routeActive: isRouteSessionActive(sessionToken),
                preparationCancelled: hoverPreparationCancelled(token), targetConnected: Boolean(clone?.isConnected),
                gridConnected: Boolean(sourceState?.grid?.isConnected),
                gridOwned: Boolean(clone && sourceState?.grid && gridOwnsClone(clone, sourceState.grid)),
                generationMatches: generation === clone?.__tmHoverActivationGeneration,
                targetHovered: Boolean(clone?.matches(':hover')), viewingControlHovered: Boolean(clone?.__tmViewingControlHovered),
                hoverSuppressed: gridHoverSuppressed(), activeCloneMatches: activeClone === clone,
                activeVideoMatches: activeVideoId === item.videoId,
                replacementHoveredAtInsertion: clone?.__tmHoverReplacementHovered ?? null,
                replacementPointerVerified: clone?.__tmHoverReplacementPointerVerified ?? null,
                sinceScrollMs: Number.isFinite(lastTargetScrollAt) ? Math.round(performance.now() - lastTargetScrollAt) : null };
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; return { unavailable: true }; }
    }

    function hoverLeaveDestinationDiagnostic(target) {
        // Class names are inspected only for fixed UI hints, never exported.
        // Six ancestors / eight class tokens each; no text, URLs, IDs or HTML.
        const result = { element: target instanceof Element, tag: '', inGrid: false,
            viewingControlHint: false, previewHint: false, ancestorsExamined: 0, truncated: false };
        let node = target instanceof Element ? target : target?.parentElement;
        for (; node && result.ancestorsExamined < 6; node = node.parentElement) {
            result.ancestorsExamined++;
            if (!result.tag && /^[a-z][a-z0-9-]{0,15}$/i.test(node.localName || '')) result.tag = node.localName;
            if (node === sourceState?.grid) result.inGrid = true;
            if (node.getAttribute('data-tm-viewing-actions') === 'true') result.viewingControlHint = true;
            const classes = node.classList;
            for (let index = 0; classes && index < Math.min(classes.length, 8); index++) {
                if (/^(?:previewModal|mini-modal|bob|jawbone)(?:$|[-_])/i.test(classes.item(index) || '')) {
                    result.previewHint = true;
                }
            }
        }
        result.truncated = Boolean(node);
        return result;
    }

    function recordGridHoverLeave(clone, relatedTarget, event) {
        const counters = performanceDiagnostics.hoverInteraction;
        try {
            const replay = activeClone === clone ? activeNativeHover : null;
            const afterReplay = Boolean(replay && replay.sessionToken === sessionScope.token);
            const sinceReplayMs = afterReplay ? Math.max(0, Math.round(performance.now() - replay.replayedAt)) : null;
            const coordinatesKnown = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY);
            const pointerDeltaPx = afterReplay && coordinatesKnown ? Math.round(Math.hypot(
                event.clientX - replay.coordinates.clientX, event.clientY - replay.coordinates.clientY) * 10) / 10 : null;
            const destination = hoverLeaveDestinationDiagnostic(relatedTarget);
            if (afterReplay) {
                counters.leavesAfterReplay++;
                if (sinceReplayMs <= 600) counters.leavesWithin600ms++;
                if (pointerDeltaPx !== null && pointerDeltaPx <= 1) counters.stationaryLeaves++;
            } else counters.leavesBeforeReplay++;
            if (destination.previewHint) counters.leavesToPreviewHint++;
            log(tLog('hoverPointerLeaveObserved'), { afterReplay, sinceReplayMs, pointerDeltaPx,
                eventType: event?.type === 'pointerout' ? 'pointerout' : event?.type === 'pointerover' ? 'pointerover' : 'unspecified',
                trusted: Boolean(event?.isTrusted), targetConnected: Boolean(clone.isConnected),
                targetHovered: clone.matches(':hover'), sameCloneDestination: Boolean(relatedTarget && clone.contains(relatedTarget)),
                destination });
        } catch (_) { counters.diagnosticFailures++; }
    }

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
        const scanFinishedAt = sourceState?.watchStatus?.network?.finishedAt;
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

    function nativeRect(...args) {
        return nativeCarousel.rect(...args);
    }

    function nativeFilledSlots(...args) {
        return nativeCarousel.filledSlots(...args);
    }

    function nativeIndicatorItems(...args) {
        return nativeCarousel.indicators(...args);
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

    function hoverPreparationCancelled(token) {
        return token !== null && token !== undefined && token !== hoverToken;
    }

    function hoverScrollElapsed(now = performance.now()) {
        return Number.isFinite(lastTargetScrollAt) ? Math.max(0, Math.round(now - lastTargetScrollAt)) : null;
    }

    function recordHoverCancellation(counters, kind, reason) {
        const knownReason = Object.hasOwn(HOVER_CANCELLATION_REASONS, reason) ? reason : 'other';
        if (performanceDiagnostics.hoverScroll === counters) {
            counters[`${kind}Cancelled${HOVER_CANCELLATION_REASONS[knownReason]}`]++;
        }
        return knownReason;
    }

    function advanceHoverToken(reason = 'other') {
        const token = ++hoverToken;
        const owner = activeHoverPreparationDiagnostic;
        // Dispose before logging: a newer intent or native exit may reenter.
        activeHoverPreparationDiagnostic = null;
        if (!owner || owner.token !== token - 1) return token;
        try {
            const counters = owner.counters;
            if (performanceDiagnostics.hoverScroll !== counters) return token;
            const knownReason = recordHoverCancellation(counters, 'preparation', reason);
            counters.preparationInterruptions++;
            counters.lastPreparationCancellationReason = knownReason;
            if (counters.interruptionLogs >= HOVER_INTERRUPTION_LOG_LIMIT) {
                counters.interruptionLogsSkipped++;
                return token;
            }
            counters.interruptionLogs++;
            log('Hover preparation interrupted', { seq: owner.seq, token: owner.token, nextToken: token,
                group: owner.group, reason: knownReason, elapsedMs: Math.round(performance.now() - owner.started),
                sinceScrollMs: hoverScrollElapsed(), intent: owner.intent });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
        return token;
    }

    function hoverIntentDiagnosticSnapshot(owner) {
        if (!owner) return null;
        return { physicalMove: owner.physicalMove, sinceScrollAtQueueMs: owner.sinceScrollAtQueueMs,
            quietRemainingAtQueueMs: owner.quietRemainingAtQueueMs, needsMovementAtQueue: owner.needsMovementAtQueue,
            scheduledDwellMs: owner.scheduledDwellMs, actualDwellMs: Math.round(performance.now() - owner.started),
            sinceScrollAtActivationMs: hoverScrollElapsed() };
    }

    function hoverScrollStateSnapshot() {
        const sinceScrollMs = hoverScrollElapsed();
        return { needsPointerMove: hoverNeedsPointerMove, sinceScrollMs,
            quietRemainingMs: sinceScrollMs === null ? 0 : Math.max(0, HOVER_SCROLL_QUIET_MS - sinceScrollMs),
            pendingIntent: Boolean(pendingGridHoverClone), preparing: Boolean(activeHoverPreparationDiagnostic),
            lastEvent: performanceDiagnostics.hoverScroll.lastScrollEvent };
    }

    function clearRunningSession(sessionToken, retryMutations = true) {
        if (runningSessionToken !== sessionToken) return;
        running = false;
        runningSessionToken = null;
        if (retryMutations) retryPendingMyListMutations('after-initialization');
    }

    function restoreActiveCarouselStyles() {
        nativeCarousel.restoreMotion();
    }

    function resetDetachedTargetState() {
        if (completedSection?.isConnected && document.getElementById(GRID_ID)) return;

        clearSourceAlignment();
        restoreActiveCarouselStyles();
        advanceHoverToken('source');
        invalidateGridReact();
        cancelPendingGridHover('source');
        completedSection = null;
        if (sourceState?.section && !sourceState.section.isConnected) {
            nativeCarousel.clearBinding();
            sourceState = null;
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
        activeVideoId = null;
        activePage = null;
        activeClone = null;
        activeSourceSlot = null;
        activeGeometryProxy = null;
        missingSectionSince = 0;
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        clearPendingMyListMutations();
        clearUndoEntries();
        listData.reset();
        waitingForNativeEmpty = false;
        cachedNativeEmptyContent = null;
        cachedNativeEmptyMessage = '';
    }

    function cleanupTargetSessionDom() {
        restoreActiveCarouselStyles();
        clearSourceAlignment();
        invalidateGridReact();

        const section = sourceState?.section;
        const scroller = sourceState?.scroller;
        const track = sourceState?.track;

        document.getElementById(GRID_ID)?.remove();
        document.getElementById(STATUS_ID)?.remove();
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        document.getElementById(ORDER_MISMATCH_DIALOG_ID)?.remove();
        orderMismatchDialogOpen = false;
        removeStyles(document);

        if (section) {
            section.classList.remove(FAST_MOVE_CLASS, ORIGINAL_HIDDEN_CLASS);
            section.removeAttribute(SECTION_ATTR);
            section.removeAttribute(ORIGINAL_VISIBILITY_ATTR);
            for (const node of section.querySelectorAll(`.${ORIGINAL_HEADER_CLASS}`)) {
                node.classList.remove(ORIGINAL_HEADER_CLASS);
            }
        }
        if (scroller) scroller.classList.remove(SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS);
        if (track) track.classList.remove('tm-netflix-mylist-v15-track');

        const synthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        if (synthetic) synthetic.remove();
    }

    function suspendTargetSession(reason = 'route-leave') {
        const hadSession = targetSessionActive || running || sourceState || completedSection || scheduled;
        const previousToken = sessionScope.token;
        sessionScope.dispose();
        targetSessionActive = false;
        stopImageResourceDiagnostics();
        stopHoverFrameDiagnostics();

        if (scheduledRunTimer !== null) clearTimeout(scheduledRunTimer);
        scheduledRunTimer = null;
        scheduled = false;
        scheduledSessionToken = null;
        scheduledRunDueAt = 0;

        advanceHoverToken('route');
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
        clearPendingMyListMutations();
        clearUndoEntries();

        running = false;
        runningSessionToken = null;
        completedSection = null;
        nativeCarousel.clearBinding();
        sourceState = null;
        activeVideoId = null;
        activePage = null;
        activeClone = null;
        activeSourceSlot = null;
        activeGeometryProxy = null;
        lastResponsiveSignature = '';
        lastPageShape = '';
        missingSectionSince = 0;
        listData.reset();
        waitingForNativeEmpty = false;
        cachedNativeEmptyContent = null;
        cachedNativeEmptyMessage = '';
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
        performanceDiagnostics = createPerformanceDiagnostics();
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
        if (!slot) return null;
        const card = slot.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
        const href = card?.href || card?.getAttribute?.('href') || '';
        const itemIndex = netflixItemIndexFromSlot(slot);
        const logicalIndex = normalizeNetflixLogicalIndex(itemIndex, sourceState?.totalCount);
        return {
            slot: slot.getAttribute?.('data-virtual-slot') || '',
            itemIndex,
            logicalIndex,
            videoId: videoIdFromHref(href),
            href,
            ariaLabel: card?.getAttribute?.('aria-label') || '',
            tabindex: card?.getAttribute?.('tabindex') || '',
            connected: Boolean(slot.isConnected),
            inlineTransform: slot.style?.getPropertyValue?.('transform') || '',
            rect: rectSummary(slot.getBoundingClientRect ? nativeRect(slot) : null)
        };
    }

    function itemSummary(item) {
        if (!item) return null;
        return {
            videoId: item.videoId || '',
            page: item.page,
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
        const section = sourceState?.section || findMyListSection();
        const scroller = sourceState?.scroller || section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = sourceState?.track || (scroller && netflixDom.findTrack(scroller));
        const grid = document.getElementById(GRID_ID);
        const statusNode = document.getElementById(STATUS_ID);
        const statusLabel = statusNode?.querySelector?.(`.${STATUS_LABEL_CLASS}`)?.textContent || '';
        const statusMeta = statusNode?.querySelector?.(`.${STATUS_META_CLASS}`)?.textContent || '';
        const statusText = [statusLabel, statusMeta].filter(Boolean).join('  ') || statusNode?.textContent || '';

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
            selectedPage: section ? selectedPage(section) : null,
            pageCount: section ? pageCount(section) : null,
            carouselDom: section ? carouselDomProfileSummary(section) : null,
            totalCount: sourceState?.totalCount ?? null,
            collectedItems: sourceState?.items?.length ?? 0,
            sourceSlots: track ? netflixDom.directSlots(track).length : 0,
            sourceCards: track ? netflixDom.filledSlots(track).length : 0,
            currentPageCards: scroller && track ? currentPageSlots(scroller, track).length : 0,
            gridCards: sourceState?.cloneMap?.size ?? 0,
            performanceWork: collectPerformanceDiagnostics(),
            undoRetention: { entries: recentRemovedMyListItems.size, expiryScheduled: Boolean(undoExpiryTimer),
                nextExpiryInMs: undoExpiryTimer ? Math.max(0, Math.round(undoExpiryTimer.dueAt - performance.now())) : null },
            viewingStatus: sourceState?.watchStatus ? {
                completed: sourceState.watchStatus.completedCount,
                unknown: sourceState.watchStatus.unknownCount,
                loading: sourceState.watchStatus.loading,
                requests: sourceState.watchStatus.requests,
                passes: sourceState.watchStatus.passes,
                failure: sourceState.watchStatus.failure,
                network: collectViewingNetworkDiagnostics(sourceState.watchStatus.network)
            } : null,
            sourceScan: Boolean(scroller?.classList?.contains(SOURCE_SCAN_CLASS)),
            sourceParked: Boolean(scroller?.classList?.contains(SOURCE_PARKED_CLASS)),
            sourceGeometryProxy: Boolean(activeGeometryProxy),
            hoverPresentation: 'netflix-native',
            nativeHoverOwned: Boolean(activeNativeHover),
            nativePreviewOwned: Boolean(activeNativeHover?.previewRoot),
            viewOriginalMyList,
            myListSyncMode: 'event-driven',
            pendingMyListMutations: [...pendingMyListMutations.values()].map(entry => ({
                videoId: entry.videoId,
                action: entry.action,
                ageMs: Math.round(performance.now() - entry.detectedAt),
                source: entry.source || '',
                observerActive: Boolean(entry.observer)
            })),
            layout: layoutSummary(sourceState?.layout),
            activeVideoId,
            activePage,
            activeClone: activeClone ? {
                videoId: activeClone.getAttribute('data-tm-item-video-id') || '',
                page: activeClone.getAttribute('data-tm-item-page') || '',
                backedPage: activeClone.getAttribute('data-tm-backed-page') || '',
                hoverReady: activeClone.getAttribute('data-tm-hover-ready') === 'true',
                connected: Boolean(activeClone.isConnected),
                rect: rectSummary(activeClone.getBoundingClientRect?.())
            } : null,
            activeSourceSlot: slotDescriptor(activeSourceSlot),
            hoverToken,
            responsiveRefreshing,
            responsiveSignature: lastResponsiveSignature,
            responsivePageShape: lastPageShape,
            responsiveReason: lastResponsiveReason,
            resizeViewportSignature: sourceState?.resizeViewportSignature || '',
            hoverScrollState: hoverScrollStateSnapshot(),
            pointer: { x: lastPointerX, y: lastPointerY }
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

    function copyLogsTooltip() {
        return tLog('copyLogsTooltip');
    }

    function showLogCopiedFeedback(link) {
        clearTimeout(logFeedbackTimer);
        link.textContent = tLog('copied');
        link.title = tLog('copied');
        logFeedbackTimer = setTimeout(() => {
            if (!link?.isConnected) return;
            link.textContent = 'CopyLogs';
            link.title = copyLogsTooltip();
        }, 2500);
    }

    async function handleLogClick(event) {
        event.preventDefault();
        const link = event.currentTarget;
        log(tLog('copyLogsRequested'), collectRuntimeSnapshot());
        try {
            const method = await diagnosticReport.copy();
            showLogCopiedFeedback(link);
            log(tLog('copyLogsCompleted'), { method, entries: logger.size() });
        } catch (error) {
            warn(tLog('copyLogsFailed'), error);
            link.title = tLog('copyFailed', { message: error?.message || error });
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

    function markOriginalHeader(section) {
        if (!section) return null;

        const emptyTitle = section.querySelector(':scope > [data-uia="empty-carousel-section+title"]');
        if (emptyTitle) {
            const emptyContent = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
            emptyTitle.classList.add(ORIGINAL_HEADER_CLASS);
            emptyContent?.classList.add(ORIGINAL_HEADER_CLASS);
            return emptyContent || emptyTitle;
        }

        const heading = section.querySelector('h2');
        if (!heading) return null;
        let container = heading;
        while (container.parentElement && container.parentElement !== section) {
            container = container.parentElement;
        }
        if (container.parentElement === section) {
            container.classList.add(ORIGINAL_HEADER_CLASS);
            return container;
        }
        return null;
    }

    function applyOriginalMyListVisibility() {
        const section = sourceState?.section || (isTargetPage() ? findMyListSection() : null);
        if (!section) return;
        markOriginalHeader(section);
        section.classList.toggle(ORIGINAL_HIDDEN_CLASS, !viewOriginalMyList);
        section.setAttribute(ORIGINAL_VISIBILITY_ATTR, viewOriginalMyList ? 'true' : 'false');
        if (sourceState?.status) {
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0}px`);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function cleanupOldArtifacts() {
        for (const id of OLD_IDS) document.getElementById(id)?.remove();
        for (const id of OLD_STYLE_IDS) document.getElementById(id)?.remove();

        for (const section of document.querySelectorAll('[data-tm-mylist-v14], [data-tm-mylist-100-demo], [data-tm-mylist-clone-demo]')) {
            section.removeAttribute('data-tm-mylist-v14');
            section.removeAttribute('data-tm-mylist-100-demo');
            section.removeAttribute('data-tm-mylist-clone-demo');
            section.style.removeProperty('--tm-source-width');
        }

        for (const scroller of document.querySelectorAll('.tm-netflix-mylist-v14-source, .tm-netflix-mylist-100-demo-source, .tm-netflix-mylist-100-demo-source-parked')) {
            scroller.classList.remove('tm-netflix-mylist-v14-source', 'tm-netflix-mylist-100-demo-source', 'tm-netflix-mylist-100-demo-source-parked');
            scroller.style.removeProperty('--tm-source-width');
            scroller.style.removeProperty('--slot-width');
            scroller.style.removeProperty('--sp-slot-width');
        }

        for (const slot of document.querySelectorAll('[data-tm-source-aligned], [data-tm-source-proxied]')) {
            slot.style.removeProperty('transform');
            slot.style.removeProperty('transform-origin');
            slot.style.removeProperty('z-index');
            slot.removeAttribute('data-tm-source-aligned');
            slot.removeAttribute('data-tm-source-proxied');
        }
    }

    function measureNativeCarouselGap(section) {
        if (!section) return Math.max(20, Math.min(56, window.innerWidth * 0.02));
        const values = [];
        const sectionRect = section.getBoundingClientRect();
        const siblings = [...section.parentElement?.children || []].filter(node =>
            node instanceof HTMLElement && node !== section && node.matches('section') && node.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller)
        );
        const index = [...section.parentElement?.children || []].indexOf(section);
        const previous = [...section.parentElement?.children || []].slice(0, index).reverse().find(node => siblings.includes(node));
        const next = [...section.parentElement?.children || []].slice(index + 1).find(node => siblings.includes(node));

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
        return values.length ? median(values) : Math.max(20, Math.min(56, window.innerWidth * 0.02));
    }

    function median(values) {
        const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!nums.length) return 0;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }

    function describeMyListToggleClick(event) {
        const decoded = netflixDom.describeMembershipClick(event, { activeVideoId });
        if (!decoded) return null;
        // Current membership owns the action; Netflix's Undo UI can advertise remove on an add.
        const wasInLegacy = Boolean(sourceState?.itemMap?.has(`v:${decoded.videoId}`));
        return { ...decoded, action: wasInLegacy ? 'remove' : 'add', wasInLegacy };
    }

    function parseSlotLayoutFormula(...args) {
        return nativeCarousel.slotLayoutFormula(...args);
    }

    function measureVisibleLayout(...args) {
        return nativeCarousel.layout(...args);
    }

    function measureEmptyLayout(...args) {
        return nativeCarousel.emptyLayout(...args);
    }

    function placeLegacyFrame(section, scroller, layout, { elapsedMs = null, finalized = false, totalCount = null } = {}) {
        section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(section);

        let grid = document.getElementById(GRID_ID);
        if (!grid) {
            grid = document.createElement('div');
            grid.id = GRID_ID;
            grid.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        }
        if (!grid.children.length) grid.setAttribute('data-tm-empty', 'true');

        const geometry = applyGridGeometry(section, grid, layout);
        const status = updateStatus(formatHeaderParts(0, totalCount, elapsedMs, finalized));
        const header = section.querySelector(`:scope > .${ORIGINAL_HEADER_CLASS}`) || markOriginalHeader(section);
        const emptyContent = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const anchor = scroller?.isConnected ? scroller : (emptyContent?.isConnected ? emptyContent : header);
        if (anchor) anchor.insertAdjacentElement('afterend', status);
        else section.prepend(status);
        syncStatusTypography(section, status);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        status.insertAdjacentElement('afterend', grid);
        grid.style.marginTop = '0px';

        return { status, grid, geometry };
    }

    function clearLegacyEmptyState({ restoreGrid = true } = {}) {
        document.getElementById(LEGACY_EMPTY_STATE_ID)?.remove();
        if (!restoreGrid) return;
        const status = sourceState?.status || document.getElementById(STATUS_ID);
        const grid = sourceState?.grid || document.getElementById(GRID_ID);
        if (status?.isConnected && grid?.isConnected && status.nextElementSibling !== grid) {
            status.insertAdjacentElement('afterend', grid);
        }
    }

    function sanitizeLegacyEmptyClone(clone, source) {
        if (!clone) return null;
        clone.id = LEGACY_EMPTY_STATE_ID;
        clone.classList.remove(ORIGINAL_HEADER_CLASS);
        clone.removeAttribute('data-uia');
        clone.setAttribute('data-tm-legacy-empty-state', 'true');
        clone.setAttribute('data-tm-empty-source', source);
        for (const node of clone.querySelectorAll('[id], [data-uia]')) {
            node.removeAttribute('id');
            node.removeAttribute('data-uia');
            node.classList?.remove?.(ORIGINAL_HEADER_CLASS);
        }
        return clone;
    }

    function cloneNativeEmptyContent(section) {
        const original = section?.querySelector?.(':scope > [data-uia="empty-carousel-section+content"]');
        if (!original) return null;

        const message = normalizeNetflixUiText(
            original.querySelector('[data-uia="empty-carousel-section+message"]')?.textContent || ''
        );
        if (message) cachedNativeEmptyMessage = message;
        cachedNativeEmptyContent = original.cloneNode(true);

        return sanitizeLegacyEmptyClone(original.cloneNode(true), 'native');
    }

    function provisionalMyListEmptyMessage() {
        if (cachedNativeEmptyMessage) return cachedNativeEmptyMessage;
        return tUi('emptyMessage');
    }

    function cloneProvisionalEmptyContent() {
        if (cachedNativeEmptyContent) {
            return sanitizeLegacyEmptyClone(cachedNativeEmptyContent.cloneNode(true), 'provisional-cached');
        }

        const shell = [...document.querySelectorAll('[data-uia="empty-carousel-section+content"]')]
            .find(node => !node.closest(`[${SECTION_ATTR}="true"]`));
        if (shell) {
            const clone = shell.cloneNode(true);
            clone.querySelector('[data-uia="empty-carousel-section+pictogram"]')?.remove();
            const messageNode = clone.querySelector('[data-uia="empty-carousel-section+message"]');
            if (messageNode) {
                messageNode.textContent = provisionalMyListEmptyMessage();
            } else {
                const p = document.createElement('p');
                p.textContent = provisionalMyListEmptyMessage();
                clone.appendChild(p);
            }
            return sanitizeLegacyEmptyClone(clone, 'provisional-shell');
        }

        const fallback = document.createElement('div');
        const message = document.createElement('p');
        message.textContent = provisionalMyListEmptyMessage();
        fallback.appendChild(message);
        return sanitizeLegacyEmptyClone(fallback, 'provisional-fallback');
    }

    function applyLegacyEmptyStateGeometry(section, layout) {
        const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
        if (!emptyState?.isConnected || !section || !layout) return;
        const geometry = currentGridGeometry(section, layout);
        emptyState.style.marginLeft = `${geometry.left}px`;
        emptyState.style.width = `${geometry.width}px`;
        emptyState.style.maxWidth = `${geometry.width}px`;
    }

    function syncLegacyEmptyState(section, { allowProvisional = false } = {}) {
        clearLegacyEmptyState({ restoreGrid: false });
        const status = sourceState?.status || document.getElementById(STATUS_ID);
        const grid = sourceState?.grid || document.getElementById(GRID_ID);
        if (!status?.isConnected || !grid?.isConnected) return false;

        const clone = cloneNativeEmptyContent(section) || (allowProvisional ? cloneProvisionalEmptyContent() : null);
        if (!clone) {
            if (status.nextElementSibling !== grid) status.insertAdjacentElement('afterend', grid);
            return false;
        }

        status.insertAdjacentElement('afterend', clone);
        clone.insertAdjacentElement('afterend', grid);
        const layout = sourceState?.layout;
        if (layout) applyLegacyEmptyStateGeometry(section, layout);
        return true;
    }

    function waitForNativeSource(...args) {
        return nativeCarousel.waitForSource(...args);
    }

    function finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, reason = 'empty') {
        document.getElementById(GRID_ID)?.replaceChildren();
        const elapsedMs = performance.now() - initializationStarted;
        const frame = placeLegacyFrame(section, scroller, layout, { elapsedMs, finalized: true, totalCount: 0 });
        frame.grid.setAttribute('data-tm-empty', 'true');
        if (scroller && track) {
            track.classList.add('tm-netflix-mylist-v15-track');
            scroller.classList.add(SOURCE_PARKED_CLASS);
        }
        sourceState = attachNativeBinding({
            layout,
            items: [],
            totalCount: 0,
            grid: frame.grid,
            status: frame.status,
            cloneMap: new Map(),
            itemMap: new Map(),
            empty: true,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        }, section, scroller || null, track || null);
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(section, { allowProvisional: true });
        completedSection = section;
        if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
            performanceDiagnostics.nativeRecovery.completed++;
        }
        resetOrderMismatchStateAfterInitialization();
        applyOriginalMyListVisibility();
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!frame.grid.isConnected) return;
            if (sourceState?.empty) {
                const nextLayout = sourceState.scroller && sourceState.track
                    ? measureVisibleLayout(section, sourceState.scroller, sourceState.track)
                    : measureEmptyLayout(section);
                nextLayout.rowGap = measureNativeCarouselGap(section);
                sourceState.layout = nextLayout;
                const geometry = applyGridGeometry(section, frame.grid, nextLayout);
                frame.status.style.marginLeft = `${geometry.left}px`;
                frame.status.style.width = `${geometry.width}px`;
                applyLegacyEmptyStateGeometry(section, nextLayout);
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

    function recordViewingFieldKinds(kinds, counts) {
        for (const [key, kind] of Object.entries(kinds)) counts[key][kind] = (counts[key][kind] || 0) + 1;
        return kinds;
    }

    function classifyViewingVideo(record) {
        if (!record || !['movie', 'episode'].includes(record.type)) return 'unknown';
        if (record.watched === true) return 'complete';
        // Stopping at the credits can leave Netflix's flag false. Accept enough
        // playback independently of that flag, with a small allowance for credits.
        if (record.runtime > 0 && record.bookmark !== null) {
            const creditsBoundary = record.creditsOffset > 0 && record.creditsOffset <= record.runtime
                ? record.creditsOffset : record.runtime;
            const boundary = Math.min(creditsBoundary, record.runtime * VIEWING_COMPLETION_RATIO);
            if (record.bookmark >= boundary) return 'complete';
        }
        if (record.bookmark > 0) return 'in-progress';
        if (record.watched === false && record.bookmark === 0) return 'not-started';
        return 'unknown';
    }

    function classifyViewingSeries(plan) {
        if (!plan) return 'unknown';
        const ids = new Set();
        const statuses = [];
        for (const season of plan.seasons) {
            for (let index = 0; index < season.count; index++) {
                const episode = season.episodes.get(index);
                if (!episode?.id || ids.has(episode.id) || episode.status === 'unknown') return 'unknown';
                ids.add(episode.id);
                statuses.push(episode.status);
            }
        }
        if (statuses.length !== plan.expected || !statuses.length) return 'unknown';
        if (statuses.every(status => status === 'complete')) return 'complete';
        return statuses.every(status => status === 'not-started') ? 'not-started' : 'in-progress';
    }

    function viewingLatestEpisode(plan) {
        for (let seasonIndex = plan.seasons.length - 1; seasonIndex >= 0; seasonIndex--) {
            const season = plan.seasons[seasonIndex];
            if (season.count > 0) return { season, seasonNumber: seasonIndex + 1, index: season.count - 1,
                episode: season.episodes.get(season.count - 1) };
        }
        return null;
    }

    function viewingProgressSummary(record) {
        const status = classifyViewingVideo(record);
        const percent = record?.runtime > 0 && record.bookmark !== null
            ? Math.round(Math.min(100, record.bookmark / record.runtime * 100) * 10) / 10 : null;
        const creditsReached = Boolean(record?.runtime > 0 && record.creditsOffset > 0 &&
            record.creditsOffset <= record.runtime && record.bookmark !== null && record.bookmark >= record.creditsOffset);
        return { status, percent, thresholdPercent: VIEWING_COMPLETION_RATIO * 100,
            watched: typeof record?.watched === 'boolean' ? record.watched : null, creditsReached,
            reason: status === 'complete' ? record.watched === true ? 'watched-flag'
                : creditsReached ? 'credits-reached' : 'completion-threshold'
                : percent === null ? 'progress-unavailable' : 'below-completion-threshold' };
    }

    function viewingSeriesResult(plan) {
        const latest = viewingLatestEpisode(plan)?.episode;
        const ids = plan.seasons.flatMap(season => [...season.episodes.values()]).filter(episode => episode.id).map(episode => episode.id);
        // The user selected this inference even when older progress is absent or
        // reset. A validated season plan identifies the latest returned episode.
        if (latest?.id && latest.status === 'complete' && new Set(ids).size === ids.length) return 'complete';
        return classifyViewingSeries(plan);
    }

    function assertViewingJob(job) {
        assertRouteSession(job.sessionToken);
        if (sourceState !== job.state || job.state.watchStatus !== job.watch ||
            !job.state.grid?.isConnected || netflixContext.activeProfile() !== job.context.profileGuid) {
            throw createRouteSessionCancelledError();
        }
    }

    function createViewingNetworkDiagnostics() {
        const now = performance.now();
        return { startedAt: now, lastChangeAt: now, finishedAt: null, concurrencyLimit: VIEWING_REQUEST_CONCURRENCY,
            inFlight: 0, peakInFlight: 0, succeeded: 0, failed: 0, rateLimited: 0, aborted: 0,
            totalRequestMs: 0, maxRequestMs: 0, overlapMs: 0 };
    }

    function collectViewingNetworkDiagnostics(network) {
        if (!network) return null;
        const now = network.finishedAt ?? performance.now();
        const requests = network.succeeded + network.failed;
        return { concurrencyLimit: network.concurrencyLimit, started: requests + network.inFlight,
            inFlight: network.inFlight, peakInFlight: network.peakInFlight,
            elapsedMs: Math.round(now - network.startedAt), succeeded: network.succeeded, failed: network.failed,
            rateLimited: network.rateLimited, aborted: network.aborted,
            totalRequestMs: Math.round(network.totalRequestMs), maxRequestMs: Math.round(network.maxRequestMs),
            meanRequestMs: requests ? Math.round(network.totalRequestMs / requests) : 0,
            overlapMs: Math.round(network.overlapMs + (network.inFlight > 1 ? now - network.lastChangeAt : 0)) };
    }

    async function runViewingRequest(job, readBatch) {
        assertViewingJob(job);
        if (job.collectionFailure) throw job.collectionFailure;
        const now = performance.now();
        const remaining = job.deadline - now;
        if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
        if (job.passRequests >= VIEWING_MAX_REQUESTS) {
            if (job.passes >= VIEWING_MAX_PASSES) throw new Error('VIEWING_STATUS_BUDGET');
            // Continue the same finite queue, including partial episode coverage.
            // Do not restart title requests or retry failed HTTP responses.
            job.passes++;
            job.passRequests = 0;
        }
        job.passRequests++;
        job.requests++;
        const request = createRouteFetch(job.sessionToken);
        const controllers = job.controllers ||= new Set();
        controllers.add(request.controller);
        const network = job.network ||= createViewingNetworkDiagnostics();
        if (network.inFlight > 1) network.overlapMs += now - network.lastChangeAt;
        network.lastChangeAt = now;
        network.inFlight++;
        network.peakInFlight = Math.max(network.peakInFlight, network.inFlight);
        let succeeded = false;
        sessionScope.setRequestTimeout(request, Math.min(8000, remaining));
        try {
            // The scan owns quota, deadline and resource accounting; the adapter owns HTTP/wire data.
            const result = await readBatch({ signal: request.controller.signal, assertCurrent: () => assertViewingJob(job) });
            assertViewingJob(job);
            succeeded = true;
            return result;
        } catch (error) {
            if (error?.message === 'VIEWING_STATUS_HTTP_429') network.rateLimited++;
            if (error?.name === 'AbortError') network.aborted++;
            assertViewingJob(job);
            if (performance.now() >= job.deadline) throw new Error('VIEWING_STATUS_BUDGET');
            throw error;
        } finally {
            const finishedAt = performance.now();
            const elapsed = finishedAt - now;
            if (network.inFlight > 1) network.overlapMs += finishedAt - network.lastChangeAt;
            network.lastChangeAt = finishedAt;
            network.inFlight--;
            network.totalRequestMs += elapsed;
            network.maxRequestMs = Math.max(network.maxRequestMs, elapsed);
            if (succeeded) network.succeeded++;
            else network.failed++;
            controllers.delete(request.controller);
            finishRouteFetch(request);
        }
    }

    async function runViewingBatches(batches, job, collectBatch, requestsPerBatch = 1) {
        for (let offset = 0; offset < batches.length;) {
            assertViewingJob(job);
            if (job.collectionFailure) throw job.collectionFailure;
            const remaining = VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES - job.requests;
            if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
            // Near the cap, leave enough quota to finish a series chain rather
            // than spending its last two requests on two metadata-only chains.
            const width = Math.min(VIEWING_REQUEST_CONCURRENCY, Math.max(1, Math.floor(remaining / requestsPerBatch)));
            const wave = batches.slice(offset, offset + width);
            offset += wave.length;
            await Promise.allSettled(wave.map(async batch => {
                try {
                    await collectBatch(batch);
                } catch (error) {
                    job.collectionFailure ||= error;
                    if (isRouteSessionCancelledError(error)) {
                        for (const controller of job.controllers || []) controller.abort();
                    }
                    throw error;
                }
            }));
            // Drain allocated reads before finalizing partial results. A valid
            // peer may still publish, but a known failure stops new requests.
            if (job.collectionFailure) throw job.collectionFailure;
        }
    }

    function readViewingCache(state, profile) {
        const cached = { results: new Map(), types: new Map() };
        if (!profile || typeof GM_getValue !== 'function') return cached;
        try {
            const stored = GM_getValue(VIEWING_CACHE_STORAGE_KEY + encodeURIComponent(profile), null);
            const age = Date.now() - stored?.savedAt;
            if (stored?.version !== 1 || stored.completionRatio !== VIEWING_COMPLETION_RATIO ||
                !Number.isFinite(stored.savedAt) || age < 0 || age > VIEWING_CACHE_MAX_AGE_MS ||
                !stored.entries || typeof stored.entries !== 'object' || Array.isArray(stored.entries) ||
                Object.keys(stored.entries).length > 5000) return cached;
            for (const item of state.items || []) {
                const id = String(item.videoId);
                const entry = stored.entries[id];
                if (!/^\d+$/.test(id) || !Array.isArray(entry) || entry.length !== 2 ||
                    !['movie', 'series'].includes(entry[0]) ||
                    !['complete', 'in-progress', 'not-started', 'unknown'].includes(entry[1])) continue;
                cached.types.set(id, entry[0]);
                cached.results.set(id, entry[1]);
            }
        } catch (_) { /* Optional startup reuse must not block the grid. */ }
        return cached;
    }

    function clearCachedViewingStatus(watch) {
        watch.cachedResults?.clear();
        watch.cachedTypes?.clear();
    }

    function writeViewingCache(job) {
        if (typeof GM_setValue !== 'function') return;
        try {
            assertViewingJob(job);
            const entries = {};
            for (const item of job.state.items || []) {
                const id = String(item.videoId);
                const type = job.types.get(id);
                if (/^\d+$/.test(id) && ['movie', 'series'].includes(type)) {
                    entries[id] = [type, job.results.get(id) || 'unknown'];
                }
            }
            if (Object.keys(entries).length > 5000) return;
            // Save only fresh scan data once, never extending unverified cache
            // entries or persisting a manual choice as an automatic result.
            GM_setValue(VIEWING_CACHE_STORAGE_KEY + encodeURIComponent(job.context.profileGuid),
                { version: 1, completionRatio: VIEWING_COMPLETION_RATIO, savedAt: Date.now(), entries });
        } catch (_) { /* A cache failure leaves fresh grouping and corrections usable. */ }
    }

    function publishViewingProgress(job, changedIds) {
        assertViewingJob(job);
        job.watch.results = job.results;
        job.watch.types = job.types;
        job.watch.seriesDetails = job.seriesDetails;
        job.watch.requests = job.requests;
        job.watch.passes = job.passes;
        job.watch.publications++;
        syncWatchGroups(job.state, changedIds, 'scan-batch');
    }

    async function collectViewingStatuses(job) {
        const ids = [...new Set(job.state.items.map(item => String(item.videoId)).filter(id => /^\d+$/.test(id)))];
        const seriesById = new Map();
        const titleBatches = [];
        for (let offset = 0; offset < ids.length; offset += VIEWING_TITLE_BATCH_SIZE) {
            titleBatches.push(ids.slice(offset, offset + VIEWING_TITLE_BATCH_SIZE));
        }
        await runViewingBatches(titleBatches, job, async batch => {
            const records = await runViewingRequest(job, owner => viewingData.readTitles(batch, job.context, owner));
            for (const id of batch) {
                const record = records.get(id);
                let pendingSeries = false;
                job.watch.cachedTypes.delete(id);
                if (record?.type === 'movie') job.types.set(id, 'movie');
                else if (['show', 'series', 'tvshow', 'episode'].includes(record?.type)) job.types.set(id, 'series');
                if (record && ['show', 'series', 'tvshow'].includes(record.type)) {
                    job.seriesStats.found++;
                    if ((record.seasonCount === null || (Number.isSafeInteger(record.seasonCount) &&
                        record.seasonCount > 0 && record.seasonCount <= VIEWING_MAX_SEASONS)) &&
                        (record.episodeCount === null || (Number.isSafeInteger(record.episodeCount) &&
                        record.episodeCount > 0 && record.episodeCount <= VIEWING_MAX_EPISODES))) {
                        seriesById.set(id, record);
                        job.seriesStats.eligible++;
                        pendingSeries = true;
                    }
                }
                // A show-level flag cannot replace a cached finale result.
                // Keep that provisional result only until its episode check.
                if (!pendingSeries) {
                    job.watch.cachedResults.delete(id);
                    job.results.set(id, classifyViewingVideo(record));
                }
            }
            publishViewingProgress(job, batch);
        });
        // Response arrival cannot change native order or budget priority.
        const series = ids.map(id => seriesById.get(id)).filter(Boolean);
        const seriesBatches = [];
        for (let offset = 0; offset < series.length;) {
            const batch = [];
            let episodes = 0, seasons = 0;
            while (offset < series.length && batch.length < VIEWING_TITLE_BATCH_SIZE) {
                const record = series[offset];
                const seasonCost = record.seasonCount ?? VIEWING_MAX_SEASONS;
                if (batch.length && (episodes + 1 > VIEWING_EPISODE_BATCH_SIZE ||
                    seasons + seasonCost > VIEWING_EPISODE_BATCH_SIZE)) break;
                batch.push(record);
                episodes++;
                seasons += seasonCost;
                offset++;
            }
            // Only the latest episode determines the selected caught-up rule.
            // Bound season metadata and finale checks, not historical runtimes.
            seriesBatches.push(batch);
        }
        await runViewingBatches(seriesBatches, job, batch => collectViewingSeriesBatch(batch, job), 2);
        // Preserve the complete ordinary scan before spending its remaining
        // budget on incomplete nested responses. Already verified titles win.
        await recheckViewingSeries(job);
    }

    async function collectViewingSeriesBatch(records, job) {
        const coverage = await runViewingRequest(job, owner => viewingData.readSeasons(records, job.context, owner));
        const plans = coverage.map(plan => ({ ...plan,
            seasons: plan.seasons.map(season => ({ ...season, episodes: new Map() })) }));
        job.seriesStats.planned += plans.length;
        job.seriesStats.unplanned += records.length - plans.length;
        const plannedIds = new Set(plans.map(plan => plan.videoId));
        for (const record of records) {
            if (!plannedIds.has(record.videoId)) {
                job.watch.cachedResults.delete(record.videoId);
                job.results.set(record.videoId, 'unknown');
                job.seriesDetails.set(record.videoId, { reason: 'season-metadata-incomplete-or-inconsistent' });
            }
        }
        for (const plan of plans) job.watch.seriesCoverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
        // Coverage can expire a manual correction even before the finale arrives.
        const metadataChanges = records.filter(record => !plannedIds.has(record.videoId) || job.watch.manualChoices.has(record.videoId));
        if (metadataChanges.length) publishViewingProgress(job, metadataChanges.map(record => record.videoId));
        await collectViewingEpisodePlans(plans, job);
    }

    async function collectViewingEpisodePlans(plans, job) {
        const segments = [];
        for (const plan of plans) {
            const latest = viewingLatestEpisode(plan);
            if (latest && !latest.episode) segments.push({ plan, season: latest.season, from: latest.index, to: latest.index });
        }
        // Request one episode per series. Older progress cannot change the
        // latest-episode inference, including when the finale is unavailable.
        for (let offset = 0; offset < segments.length;) {
            const batch = [];
            let size = 0;
            while (offset < segments.length) {
                const segment = segments[offset];
                if (segment.plan.finished) { offset++; continue; }
                const length = segment.to - segment.from + 1;
                if (batch.length && size + length > VIEWING_EPISODE_BATCH_SIZE) break;
                batch.push(segment);
                size += length;
                offset++;
            }
            if (!batch.length) continue;
            const ranges = await runViewingRequest(job, owner => viewingData.readEpisodes(
                batch.map(({ season, from, to }) => ({ seasonId: season.id, from, to })), job.context, owner));
            for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
                const { plan, season, from, to } = batch[batchIndex];
                const latest = viewingLatestEpisode(plan);
                for (let index = from; index <= to; index++) {
                    const { id, record, kinds } = ranges[batchIndex].episodes[index - from];
                    const status = classifyViewingVideo(record);
                    season.episodes.set(index, { id, status, ...(status === 'unknown' ? { record } : {}) });
                    if (latest?.season === season && latest.index === index) season.episodes.get(index).progress = viewingProgressSummary(record);
                    job.seriesStats.episodesChecked++;
                    if (!id) job.seriesStats.missingEpisodeRefs++;
                    if (status === 'unknown') {
                        job.seriesStats.episodesUnknown++;
                        season.episodes.get(index).kinds = recordViewingFieldKinds(kinds, job.recheckStats.initialUnknownFields);
                    }
                    else if (status !== 'complete') job.seriesStats.episodesIncomplete++;
                }
            }
            // Keep each fully checked result even if a later request fails or
            // reaches the scan budget. Unfinished coverage remains unknown.
            for (const plan of new Set(batch.map(segment => segment.plan))) {
                if (plan.finished) continue;
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
                const result = viewingSeriesResult(plan);
                if (result === 'complete' || full || observed.some(episode => !episode.id || episode.status !== 'complete')) {
                    const status = result === 'complete' ? result : full ? result
                        : observed.some(episode => !episode.id || episode.status === 'unknown') ? 'unknown' : 'in-progress';
                    finishViewingSeriesPlan(plan, status, job);
                } else saveViewingSeriesDetails(plan, job);
            }
            publishViewingProgress(job, batch.map(segment => segment.plan.videoId));
        }
    }

    function finishViewingSeriesPlan(plan, status, job) {
        const bucket = value => value === 'complete' ? 'complete' : value === 'unknown' ? 'unknown' : 'incomplete';
        if (plan.status === undefined) job.seriesStats.checked++;
        else job.seriesStats[bucket(plan.status)]--;
        job.seriesStats[bucket(status)]++;
        plan.status = status;
        plan.finished = true;
        job.watch.cachedResults.delete(plan.videoId);
        job.results.set(plan.videoId, status);
        saveViewingSeriesDetails(plan, job);
        if (status === 'unknown') {
            const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
            const latest = viewingLatestEpisode(plan)?.episode;
            if ((latest?.id && latest.status === 'unknown') ||
                (observed.every(episode => episode.id && ['complete', 'unknown'].includes(episode.status)) &&
                new Set(observed.map(episode => episode.id)).size === observed.length)) {
                if (!job.unresolvedSeries.has(plan)) job.recheckStats.candidates++;
                job.unresolvedSeries.add(plan);
            }
        }
    }

    function saveViewingSeriesDetails(plan, job) {
        const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
        const complete = observed.filter(episode => episode.status === 'complete').length;
        const unfinished = observed.filter(episode => ['not-started', 'in-progress'].includes(episode.status)).length;
        const unknown = observed.filter(episode => episode.status === 'unknown').length;
        const missing = observed.filter(episode => !episode.id).length;
        const duplicates = observed.length - new Set(observed.filter(episode => episode.id).map(episode => episode.id)).size - missing;
        const fields = { watched: {}, bookmark: {}, runtime: {} };
        for (const episode of observed) {
            if (episode.status !== 'unknown' || !episode.kinds) continue;
            for (const [key, kind] of Object.entries(episode.kinds)) fields[key][kind] = (fields[key][kind] || 0) + 1;
        }
        const latest = viewingLatestEpisode(plan);
        const reason = plan.status === 'complete' ? classifyViewingSeries(plan) === 'complete'
            ? 'verified-complete' : 'latest-episode-complete' : unfinished ? 'unfinished-episodes'
            : missing || duplicates ? 'invalid-episode-references' : unknown ? 'unavailable-episode-progress' : 'episode-coverage-incomplete';
        job.seriesDetails.set(plan.videoId, { reason, seasons: plan.seasons.length, expectedEpisodes: plan.expected,
            checkedEpisodes: observed.length, completeEpisodes: complete, unfinishedEpisodes: unfinished,
            unknownEpisodes: unknown, missingEpisodeRefs: missing, duplicateEpisodeRefs: duplicates,
            latestEpisode: latest ? { season: latest.seasonNumber, episode: latest.index + 1,
                ...(latest.episode?.progress || { status: 'unknown', percent: null, thresholdPercent: VIEWING_COMPLETION_RATIO * 100,
                    reason: latest.episode ? 'episode-reference-unavailable' : 'not-checked' }),
                ...(latest.episode?.kinds ? { fields: latest.episode.kinds } : {}) } : null,
            ...(unknown ? { unknownFields: fields } : {}) });
    }

    function collectViewingSeriesDiagnostics(state) {
        const watch = state?.watchStatus;
        if (!watch) return [];
        // Only Copy Logs expands these compact per-series summaries. Ordinary
        // runtime snapshots, scroll and hover never build title-level reports.
        return (state.items || []).filter(item => viewingTitleType(watch, String(item.videoId)) === 'series').map(item => {
            const id = String(item.videoId);
            return { title: item.ariaLabel || '(untitled)', status: effectiveViewingStatus(watch, id),
                automaticStatus: watch.results.get(id) || watch.cachedResults?.get(id) || 'unknown',
                cachedStatus: !watch.results.has(id) && Boolean(watch.cachedResults?.has(id)),
                manualChoice: watch.manualChoices.get(id)?.status || null,
                ...(watch.seriesDetails.get(id) || { reason: watch.loading ? 'checking' : 'series-metadata-unavailable-or-unprocessed' }) };
        });
    }

    async function recheckViewingSeries(job) {
        const attempted = new Set();
        for (;;) {
            assertViewingJob(job);
            const targets = new Map();
            for (const plan of job.unresolvedSeries) {
                if (plan.status !== 'unknown' || plan.recheckBlocked) continue;
                const latest = viewingLatestEpisode(plan)?.episode;
                const onlyLatest = plan.seasons.some(season => [...season.episodes.values()].some(episode =>
                    ['not-started', 'in-progress'].includes(episode.status)));
                for (const season of plan.seasons) {
                    for (const episode of season.episodes.values()) {
                        if (onlyLatest && episode !== latest) continue;
                        if (episode.status !== 'unknown' || attempted.has(episode.id)) continue;
                        if (!targets.has(episode.id)) {
                            if (targets.size >= VIEWING_EPISODE_BATCH_SIZE) continue;
                            targets.set(episode.id, []);
                        }
                        targets.get(episode.id).push({ plan, episode });
                    }
                }
            }
            if (!targets.size) return;
            // The reference supplied the episode ID. Ask the same read-only
            // video path directly, rather than guessing from a resume label.
            const beforeRequests = job.requests;
            let directData;
            try {
                directData = await runViewingRequest(job, owner => viewingData.readDirectEpisodes([...targets.keys()], job.context, owner));
            } finally {
                job.recheckStats.requests += job.requests - beforeRequests;
            }
            const affected = new Set();
            for (const [id, entries] of targets) {
                attempted.add(id);
                job.recheckStats.episodes++;
                const { record: direct, kinds } = directData.get(id);
                for (const { plan, episode } of entries) {
                    affected.add(plan);
                    const previous = episode.record;
                    const record = direct ? {
                        ...direct,
                        watched: typeof direct.watched === 'boolean' ? direct.watched : previous?.watched,
                        bookmark: direct.bookmark ?? previous?.bookmark ?? null,
                        runtime: direct.runtime > 0 ? direct.runtime : previous?.runtime ?? null,
                        creditsOffset: direct.creditsOffset ?? previous?.creditsOffset ?? null
                    } : previous;
                    episode.status = classifyViewingVideo(record);
                    if (episode === viewingLatestEpisode(plan)?.episode) episode.progress = viewingProgressSummary(record);
                    if (episode.status === 'unknown') {
                        job.recheckStats.unknownEpisodes++;
                        episode.kinds = recordViewingFieldKinds(kinds, job.recheckStats.remainingUnknownFields);
                    } else job.recheckStats.recoveredEpisodes++;
                    if (episode.status !== 'complete') plan.recheckBlocked = true;
                    if (episode.status === 'unknown') episode.record = record;
                    else { delete episode.record; delete episode.kinds; }
                }
            }
            for (const plan of affected) {
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const result = viewingSeriesResult(plan);
                if (result === 'complete' || full) finishViewingSeriesPlan(plan, result, job);
                saveViewingSeriesDetails(plan, job);
                if (plan.status === 'complete') job.recheckStats.recoveredSeries++;
            }
            publishViewingProgress(job, [...affected].map(plan => plan.videoId));
        }
    }

    function validViewingCoverage(value) {
        return Array.isArray(value) && value.length > 0 && value.length <= VIEWING_MAX_SEASONS &&
            value.every(pair => Array.isArray(pair) && pair.length === 2 && /^\d+$/.test(pair[0]) &&
                Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= VIEWING_MAX_EPISODES) &&
            new Set(value.map(pair => pair[0])).size === value.length &&
            value.reduce((sum, pair) => sum + pair[1], 0) > 0 &&
            value.reduce((sum, pair) => sum + pair[1], 0) <= VIEWING_MAX_EPISODES;
    }

    function readManualViewingChoices(profile) {
        if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') throw new Error('storage-unavailable');
        const choices = new Map();
        const stored = GM_getValue(VIEWING_CHOICES_STORAGE_KEY + encodeURIComponent(profile), null);
        if (stored == null) return choices;
        if (stored.version !== 1 || !stored.choices || typeof stored.choices !== 'object' ||
            Array.isArray(stored.choices) || Object.keys(stored.choices).length > 5000) throw new Error('invalid-storage');
        for (const [id, choice] of Object.entries(stored.choices)) {
            if (!/^\d+$/.test(id) || !choice || !['complete', 'main'].includes(choice.status) ||
                !['movie', 'series', 'unknown'].includes(choice.type) ||
                (choice.coverage !== null && !validViewingCoverage(choice.coverage))) continue;
            choices.set(id, { status: choice.status, type: choice.type, coverage: choice.coverage });
        }
        return choices;
    }

    function syncManualViewingProfile(watch) {
        const profile = netflixContext.activeProfile();
        const active = typeof profile === 'string' && profile ? profile : null;
        if (watch.manualProfileGuid === active) return false;
        if (watch.manualProfileGuid !== undefined) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.seriesCoverage = new Map();
        }
        watch.manualProfileGuid = active;
        watch.manualChoices = new Map();
        watch.manualFailure = false;
        if (!active) return true;
        try { watch.manualChoices = readManualViewingChoices(active); }
        catch (_) { watch.manualFailure = true; }
        return true;
    }

    function saveManualViewingChoices(watch, changes, conditional = false) {
        try {
            if (!watch.manualProfileGuid || netflixContext.activeProfile() !== watch.manualProfileGuid) throw new Error('storage-unavailable');
            // Apply only this action's changes to the newest saved map, so an
            // older tab does not erase unrelated corrections from another tab.
            const choices = readManualViewingChoices(watch.manualProfileGuid);
            let applied = false;
            for (const [id, choice] of changes) {
                if (conditional && JSON.stringify(choices.get(id)) !== JSON.stringify(watch.manualChoices.get(id))) continue;
                if (choice) choices.set(id, choice);
                else choices.delete(id);
                applied = true;
            }
            if (choices.size > 5000) throw new Error('storage-full');
            if (applied) GM_setValue(VIEWING_CHOICES_STORAGE_KEY + encodeURIComponent(watch.manualProfileGuid),
                { version: 1, choices: Object.fromEntries(choices) });
            watch.manualFailure = false;
            return choices;
        } catch (_) { watch.manualFailure = true; return null; }
    }

    function changedManualViewingIds(previous, next) {
        const changed = new Set();
        for (const id of new Set([...previous.keys(), ...next.keys()])) {
            if (JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id))) changed.add(id);
        }
        return changed;
    }

    function reconcileManualViewingCoverage(watch, ids = null) {
        const changes = new Map();
        const candidates = ids === null ? watch.manualChoices.keys() : ids;
        for (const id of candidates) {
            const choice = watch.manualChoices.get(id);
            if (!choice) continue;
            if (choice.status !== 'complete') continue;
            const coverage = watch.seriesCoverage.get(id);
            if (!coverage) continue;
            if (!choice.coverage) {
                changes.set(id, { ...choice, type: 'series', coverage });
            } else {
                const previous = new Map(choice.coverage);
                if (coverage.some(([season, count]) => count > 0 && (!previous.has(season) || count > previous.get(season)))) {
                    changes.set(id, null);
                }
            }
        }
        if (changes.size) {
            const previous = watch.manualChoices;
            const saved = saveManualViewingChoices(watch, changes, true);
            if (saved) watch.manualChoices = saved;
            else for (const [id, choice] of changes) {
                // New episodes must remain visible even if saving the expiry fails.
                if (choice) watch.manualChoices.set(id, choice);
                else watch.manualChoices.delete(id);
            }
            return saved ? changedManualViewingIds(previous, saved) : new Set(changes.keys());
        }
        return new Set();
    }

    function effectiveViewingStatus(watch, id) {
        const manual = watch.manualChoices.get(id);
        return manual ? manual.status === 'complete' ? 'complete' : 'in-progress'
            : watch.results.get(id) || watch.cachedResults?.get(id) || 'unknown';
    }

    function viewingTitleType(watch, id) {
        return watch.types.get(id) || watch.cachedTypes?.get(id) || watch.manualChoices.get(id)?.type;
    }

    function ensureManualViewingControls(clone) {
        let controls = clone.__tmViewingControls;
        if (!controls || controls.root.parentElement !== clone) {
            // Snapshot clones can contain copied controls without their JS state.
            for (const child of [...clone.children]) {
                if (child.getAttribute('data-tm-viewing-actions') === 'true') child.remove();
            }
            const root = document.createElement('div');
            root.setAttribute('data-tm-viewing-actions', 'true');
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.setAttribute('data-tm-viewing-action', 'toggle');
            const marker = document.createElement('span');
            marker.setAttribute('data-tm-manual-choice', 'true');
            marker.setAttribute('role', 'img');
            root.appendChild(toggle);
            root.appendChild(marker);
            clone.appendChild(root);
            controls = clone.__tmViewingControls = { root, toggle, marker };
        }
        return controls;
    }

    function syncManualViewingCard(state, clone, item, status) {
        const watch = state.watchStatus;
        const controls = ensureManualViewingControls(clone);
        const id = String(item.videoId);
        const type = viewingTitleType(watch, id);
        const label = status === 'complete' ? tUi('moveBackToMyList')
            : tUi(type === 'series' ? 'markCaughtUp' : 'markWatched');
        if (controls.toggle.textContent !== label) controls.toggle.textContent = label;
        const toggleLabel = label + ': ' + (item.ariaLabel || id);
        if (controls.toggle.getAttribute('aria-label') !== toggleLabel) controls.toggle.setAttribute('aria-label', toggleLabel);
        const disabled = !watch.manualProfileGuid || watch.manualFailure;
        if (controls.toggle.disabled !== disabled) controls.toggle.disabled = disabled;
        const markerLabel = tUi('manualViewingChoice');
        if (controls.marker.textContent !== markerLabel) controls.marker.textContent = markerLabel;
        const description = tUi('manualViewingChoiceDescription');
        if (controls.marker.getAttribute('title') !== description) controls.marker.setAttribute('title', description);
        if (controls.marker.getAttribute('aria-label') !== description) controls.marker.setAttribute('aria-label', description);
        const hidden = !watch.manualChoices.has(id);
        if (controls.marker.hidden !== hidden) controls.marker.hidden = hidden;
    }

    function ensureManualViewingBehavior(state) {
        const grid = state.grid;
        if (grid.__tmViewingBehaviorInstalled) return;
        grid.__tmViewingBehaviorInstalled = true;
        grid.addEventListener('click', event => {
            let button = event.target instanceof Element ? event.target : event.target?.parentElement;
            while (button && button !== grid && !button.getAttribute('data-tm-viewing-action')) button = button.parentElement;
            if (!button || button === grid || button.getAttribute('data-tm-viewing-action') !== 'toggle') return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (button.disabled) return;
            if (sourceState !== state || state.grid !== grid || !grid.isConnected || !isRouteSessionActive(state.watchStatus.sessionToken)) return;
            let clone = button.parentElement;
            while (clone && clone !== grid && !clone.__tmMyListItem) clone = clone.parentElement;
            if (!clone || !gridOwnsClone(clone, grid) || state.cloneMap.get(itemKey(clone.__tmMyListItem)) !== clone) return;
            if (clone.__tmViewingControls?.toggle !== button) return;
            const watch = state.watchStatus;
            if (netflixContext.activeProfile() !== watch.manualProfileGuid) {
                syncWatchGroups(state);
                return;
            }
            syncManualViewingProfile(watch);
            const id = String(clone.__tmMyListItem.videoId);
            const status = effectiveViewingStatus(watch, id) === 'complete' ? 'main' : 'complete';
            const automatic = watch.results.get(id) || watch.cachedResults?.get(id) || 'unknown';
            // Returning to an agreed automatic group also clears the old override.
            // Unknown/in-flight data cannot establish agreement: keep that explicit
            // placement, just as when automatic classification would undo the move.
            const restoreAutomatic = automatic !== 'unknown' && (automatic === 'complete') === (status === 'complete');
            const choice = restoreAutomatic ? null : { status, type: viewingTitleType(watch, id) || 'unknown',
                coverage: status === 'complete' ? watch.seriesCoverage.get(id) || null : null };
            const changes = new Map([[id, choice]]);
            const saved = saveManualViewingChoices(watch, changes);
            const changed = saved ? changedManualViewingIds(watch.manualChoices, saved) : new Set();
            if (saved) watch.manualChoices = saved;
            const beforeWork = { ...performanceDiagnostics.viewingGroups };
            syncWatchGroups(state, changed, 'manual-choice');
            log(tLog('viewingChoiceApplied'), {
                saved: Boolean(saved), action: button.getAttribute('data-tm-viewing-action'),
                targetGroup: status === 'complete' ? 'watched' : 'main', automaticStatus: automatic,
                placement: choice ? 'manual' : 'automatic', restoredAutomatic: Boolean(saved) && restoreAutomatic,
                manualMarkerVisible: watch.manualChoices.has(id),
                changedTitles: changed.size, completed: watch.completedCount,
                work: Object.fromEntries(Object.entries(performanceDiagnostics.viewingGroups)
                    .filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, value - beforeWork[key]]))
            });
            if (!gridOwnsClone(clone, grid)) watch.ui.summary.focus?.({ preventScroll: true });
        }, true);
    }

    function gridOwnsClone(clone, grid) {
        if (!grid || !clone || clone.getAttribute('data-tm-type-hidden') === 'true') return false;
        if (clone.parentElement === grid) return true;
        const parent = clone.parentElement;
        const details = parent?.parentElement;
        return parent?.getAttribute('data-tm-watch-grid') === 'true' &&
            details?.parentElement === grid && details.open === true;
    }

    function createWatchTypeFilter(state, group) {
        const grid = state.grid;
        const root = document.createElement('div');
        root.setAttribute('data-tm-type-filter', group);
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', tUi(group === 'main' ? 'legacyMyList' : 'watchedCaughtUp') + ': ' + tUi('titleTypeFilter'));
        const buttons = new Map();
        for (const [type, key] of [['movie', 'filterFilms'], ['series', 'filterSeries'], ['all', 'filterAll']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('data-tm-filter-value', type);
            const label = document.createElement('span');
            label.textContent = tUi(key);
            const count = document.createElement('span');
            count.setAttribute('data-tm-type-count', 'true');
            button.appendChild(label);
            button.appendChild(count);
            button.addEventListener('click', () => {
                if (sourceState !== state || state.grid !== grid || state.watchStatus?.ui?.grid !== grid ||
                    !grid.isConnected || state.watchStatus.filters[group] === type) return;
                state.watchStatus.filters[group] = type;
                syncWatchGroups(state, [], 'type-filter');
            });
            root.appendChild(button);
            buttons.set(type, { button, count, key });
        }
        return { root, buttons };
    }

    function syncWatchTypeFilter(control, selected, counts) {
        for (const [type, { button, count, key }] of control.buttons) {
            const pressed = String(type === selected);
            if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
            const value = formatUiNumber(counts[type]);
            if (count.textContent !== value) count.textContent = value;
            const label = tUi(key) + ': ' + formatItemCount(counts[type]);
            if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        }
    }

    function ensureWatchGroupUi(state) {
        const watch = state.watchStatus;
        if (watch.ui?.grid === state.grid) return watch.ui;
        ensureManualViewingBehavior(state);
        const details = document.createElement('details');
        details.setAttribute('data-tm-watch-section', 'true');
        details.open = watch.expanded;
        const summary = document.createElement('summary');
        const watchedGrid = document.createElement('div');
        watchedGrid.setAttribute('data-tm-watch-grid', 'true');
        details.appendChild(summary);
        const mainFilter = createWatchTypeFilter(state, 'main');
        const watchedFilter = createWatchTypeFilter(state, 'watched');
        const watchedEmpty = document.createElement('p');
        watchedEmpty.setAttribute('data-tm-watch-empty', 'true');
        watchedEmpty.textContent = tUi('noMatchingTitles');
        details.appendChild(watchedFilter.root);
        details.appendChild(watchedEmpty);
        details.appendChild(watchedGrid);
        const empty = document.createElement('p');
        empty.setAttribute('data-tm-watch-empty', 'true');
        empty.textContent = tUi('caughtUpMessage');
        const controls = document.createElement('div');
        controls.setAttribute('data-tm-watch-controls', 'true');
        const note = document.createElement('span');
        note.setAttribute('role', 'status');
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = tUi('refreshViewingStatus');
        refresh.addEventListener('click', () => refreshViewingStatus(state));
        controls.appendChild(note);
        controls.appendChild(refresh);
        details.addEventListener('toggle', () => {
            if (sourceState !== state || watch.ui?.details !== details) return;
            watch.expanded = details.open;
            cancelPendingGridHover('group');
            advanceHoverToken('group');
            clearSourceAlignment();
            activeClone = null;
            activeVideoId = null;
            activePage = null;
            invalidateGridReact();
        });
        return watch.ui = { grid: state.grid, details, summary, watchedGrid, empty, controls, note, refresh,
            mainFilter, watchedFilter, watchedEmpty };
    }

    function syncWatchChildOrder(parent, children) {
        let reference = parent.firstElementChild;
        for (const child of children) {
            if (child !== reference) parent.insertBefore(child, reference);
            reference = child.nextElementSibling;
        }
    }

    function syncWatchGroups(state, changedIds = null, reason = 'reconcile') {
        if (sourceState !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus;
        const profileChanged = syncManualViewingProfile(watch);
        const ui = ensureWatchGroupUi(state);
        const previousIndex = watch.groupIndex?.grid === state.grid ? watch.groupIndex : null;
        const full = changedIds === null || profileChanged || !previousIndex;
        const ids = full ? null : new Set([...changedIds].map(String));
        for (const id of reconcileManualViewingCoverage(watch, ids)) ids?.add(id);
        const index = full ? {
            grid: state.grid, entries: new Map(), order: [], unknown: 0,
            counts: { main: { movie: 0, series: 0, all: 0 }, watched: { movie: 0, series: 0, all: 0 } }
        } : previousIndex;
        const disabled = !watch.manualProfileGuid || watch.manualFailure;
        const locale = getUiLocale();
        let candidates = state.items || [];
        if (!full) {
            const selected = new Map();
            for (const id of ids) {
                const entry = previousIndex.entries.get(id);
                if (entry) selected.set(id, entry.item);
            }
            if (previousIndex.disabled !== disabled || previousIndex.locale !== locale ||
                previousIndex.filters.main !== watch.filters.main || previousIndex.filters.watched !== watch.filters.watched) {
                for (const entry of previousIndex.entries.values()) {
                    if (previousIndex.disabled !== disabled || previousIndex.locale !== locale ||
                        previousIndex.filters[entry.group] !== watch.filters[entry.group]) selected.set(entry.id, entry.item);
                }
            }
            candidates = [...selected.values()];
        }
        const updates = [];
        const work = performanceDiagnostics.viewingGroups;
        work.syncs++;
        work.lastReason = reason;
        if (full) work.fullSyncs++;
        const countEntry = (entry, delta) => {
            index.counts[entry.group].all += delta;
            if (entry.type === 'movie' || entry.type === 'series') index.counts[entry.group][entry.type] += delta;
            if (entry.status === 'unknown') index.unknown += delta;
        };
        for (const item of candidates) {
            const id = String(item.videoId);
            const previous = previousIndex?.entries.get(id);
            const status = !full && !ids.has(id) ? previous.status : effectiveViewingStatus(watch, id);
            const type = !full && !ids.has(id) ? previous.type : viewingTitleType(watch, id);
            const clone = state.cloneMap?.get(itemKey(item));
            if (!clone) continue;
            work.cardsConsidered++;
            const group = status === 'complete' ? 'watched' : 'main';
            const hidden = watch.filters[group] !== 'all' && watch.filters[group] !== type;
            const manual = watch.manualChoices.has(id);
            if (!full && previous.clone === clone && previous.status === status && previous.type === type &&
                previous.group === group && previous.hidden === hidden && previous.disabled === disabled &&
                previous.locale === locale && previous.title === item.ariaLabel && previous.manual === manual &&
                clone.parentElement === (group === 'main' ? state.grid : ui.watchedGrid)) continue;
            const entry = { id, item, clone, status, type, group, hidden, disabled, locale,
                title: item.ariaLabel, manual, order: full ? index.order.length : previous.order };
            const controlsChanged = !previous || previous.clone !== clone || previous.group !== group ||
                previous.type !== type || previous.disabled !== disabled || previous.locale !== locale ||
                previous.title !== entry.title || previous.manual !== entry.manual;
            const visibilityChanged = hidden !== (clone.getAttribute('data-tm-type-hidden') === 'true');
            const moved = Boolean(previous && previous.group !== group) ||
                clone.parentElement !== (group === 'main' ? state.grid : ui.watchedGrid);
            if (!full) countEntry(previous, -1);
            countEntry(entry, 1);
            index.entries.set(id, entry);
            if (full) index.order.push(id);
            updates.push({ entry, controlsChanged, visibilityChanged, moved });
        }

        const counts = index.counts;
        const visibleCount = counts.main[watch.filters.main];
        const visibleCompleted = counts.watched[watch.filters.watched];
        const uiSignature = JSON.stringify([counts, index.unknown, watch.filters, watch.loading, watch.manualFailure,
            locale, state.items.length, state.totalCount, state.initializationElapsedMs]);
        const uiChanged = uiSignature !== previousIndex?.uiSignature;
        const targets = [...new Set([activeClone, pendingGridHoverClone].filter(Boolean))];
        const beforeRects = new Map();
        if (uiChanged || full || updates.some(update => update.moved || update.visibilityChanged || update.controlsChanged)) {
            for (const clone of targets) beforeRects.set(clone, clone.getBoundingClientRect());
        }
        for (const { entry, controlsChanged, visibilityChanged, moved } of updates) {
            if (controlsChanged) {
                syncManualViewingCard(state, entry.clone, entry.item, entry.status);
                work.controlsUpdated++;
            }
            if (visibilityChanged) {
                if (entry.hidden) entry.clone.setAttribute('data-tm-type-hidden', 'true');
                else entry.clone.removeAttribute('data-tm-type-hidden');
            }
            if (moved || visibilityChanged) releaseGridReact(entry.clone);
            if (moved && !full) {
                const parent = entry.group === 'main' ? state.grid : ui.watchedGrid;
                let reference = entry.group === 'main' ? ui.empty : null;
                for (let offset = entry.order + 1; offset < index.order.length; offset++) {
                    const next = index.entries.get(index.order[offset]);
                    if (next.group === entry.group && next.clone.parentElement === parent) {
                        reference = next.clone;
                        break;
                    }
                }
                parent.insertBefore(entry.clone, reference);
                work.categoryMoves++;
            }
        }
        if (full) {
            const remaining = [], completed = [];
            for (const entry of index.entries.values()) (entry.group === 'watched' ? completed : remaining).push(entry.clone);
            const mainOrder = [ui.mainFilter.root, ...remaining, ui.empty, ui.controls, ui.details];
            work.categoryMoves += updates.filter(update => update.moved).length;
            syncWatchChildOrder(ui.watchedGrid, completed);
            syncWatchChildOrder(state.grid, mainOrder);
        }
        watch.completedCount = counts.watched.all;
        watch.unknownCount = index.unknown;
        watch.visibleCount = visibleCount;
        if (uiChanged) {
            syncWatchTypeFilter(ui.mainFilter, watch.filters.main, counts.main);
            syncWatchTypeFilter(ui.watchedFilter, watch.filters.watched, counts.watched);
            ui.empty.hidden = visibleCount > 0;
            const emptyText = watch.loading ? tUi('checkingViewingStatus')
                : !counts.main.all && counts.watched.all ? tUi('caughtUpMessage') : tUi('noMatchingTitles');
            if (ui.empty.textContent !== emptyText) ui.empty.textContent = emptyText;
            ui.watchedEmpty.hidden = visibleCompleted > 0;
            ui.refresh.disabled = watch.loading;
            const label = tUi('watchedCaughtUp') + ' (' + formatUiNumber(counts.watched.all) + ')';
            if (ui.summary.textContent !== label) ui.summary.textContent = label;
            let note = watch.loading ? tUi('checkingViewingStatus')
                : index.unknown ? tUi('unknownViewingStatus', { count: formatUiNumber(index.unknown) }) : '';
            const unknownTypes = counts.main.all - counts.main.movie - counts.main.series;
            if (unknownTypes && watch.filters.main !== 'all') {
                note += (note ? ' ' : '') + tUi('unknownTitleTypes', { count: formatUiNumber(unknownTypes) });
            }
            if (watch.manualFailure) note += (note ? ' ' : '') + tUi('viewingChoiceStorageFailed');
            if (ui.note.textContent !== note) ui.note.textContent = note;
            state.status = updateStatus(formatHeaderParts(state.items.length, state.totalCount,
                state.initializationElapsedMs, true));
        }
        index.filters = { ...watch.filters };
        index.disabled = disabled;
        index.locale = locale;
        index.uiSignature = uiSignature;
        watch.groupIndex = index;
        const hoverChanged = targets.some(clone => {
            if (!clone.isConnected || !gridOwnsClone(clone, state.grid)) return true;
            const before = beforeRects.get(clone);
            if (!before) return false;
            const after = clone.getBoundingClientRect();
            return ['left', 'top', 'width', 'height'].some(key => Math.abs(before[key] - after[key]) > 0.5);
        }) || Boolean(activeSourceSlot && !activeSourceSlot.isConnected);
        if (hoverChanged) {
            cancelPendingGridHover('group');
            advanceHoverToken('group');
            clearSourceAlignment();
            activeClone = null;
            activeVideoId = null;
            activePage = null;
            invalidateGridReact();
            work.hoverCancelled++;
        } else if (targets.length) {
            work.hoverPreserved++;
        }
    }

    function initializeWatchGroups(state, sessionToken) {
        const active = netflixContext.activeProfile();
        const profile = typeof active === 'string' && active ? active : null;
        const cached = readViewingCache(state, profile);
        state.watchStatus = {
            sessionToken, results: new Map(), types: new Map(), seriesDetails: new Map(), filters: { main: 'movie', watched: 'movie' },
            cachedResults: cached.results, cachedTypes: cached.types, cachedTitles: cached.types.size, publications: 0,
            seriesCoverage: new Map(), manualChoices: new Map(), manualProfileGuid: undefined, manualFailure: false,
            completedCount: 0, unknownCount: state.items.length, visibleCount: 0,
            loading: false, expanded: false, ui: null, promise: null, requests: 0, passes: 0, failure: null, profileGuid: profile,
            network: null
        };
        syncWatchGroups(state);
        refreshViewingStatus(state);
    }

    async function refreshViewingStatus(state) {
        if (sourceState !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus;
        if (watch.loading) return watch.promise;
        const context = viewingData.beginRead();
        if (!context || !isRouteSessionActive(watch.sessionToken)) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.seriesCoverage = new Map();
            watch.failure = 'VIEWING_STATUS_CONTEXT';
            syncWatchGroups(state);
            log(tLog('viewingStatusUnavailable'), { reason: watch.failure });
            return;
        }
        if (watch.profileGuid !== context.profileGuid) {
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
        } else {
            // Keep the current grouping while refreshing unresolved series,
            // using the same provisional fallback as a warm list entry.
            for (const [id, status] of watch.results) watch.cachedResults.set(id, status);
            for (const [id, type] of watch.types) watch.cachedTypes.set(id, type);
        }
        watch.profileGuid = context.profileGuid;
        watch.loading = true;
        watch.seriesCoverage = new Map();
        watch.failure = null;
        watch.publications = 0;
        syncWatchGroups(state, [], 'scan-start');
        const job = {
            state, watch, context, sessionToken: watch.sessionToken, results: new Map(), types: new Map(), seriesDetails: new Map(),
            requests: 0, passRequests: 0, passes: 1, deadline: performance.now() + VIEWING_TIMEOUT_MS * VIEWING_MAX_PASSES,
            unresolvedSeries: new Set(), controllers: new Set(), collectionFailure: null, network: createViewingNetworkDiagnostics(),
            recheckStats: { candidates: 0, requests: 0, episodes: 0, recoveredEpisodes: 0, recoveredSeries: 0, unknownEpisodes: 0,
                initialUnknownFields: { watched: {}, bookmark: {}, runtime: {} },
                remainingUnknownFields: { watched: {}, bookmark: {}, runtime: {} } },
            seriesStats: { found: 0, eligible: 0, planned: 0, checked: 0, complete: 0, unknown: 0,
                incomplete: 0, unplanned: 0, episodesChecked: 0, episodesIncomplete: 0, episodesUnknown: 0, missingEpisodeRefs: 0 }
        };
        watch.network = job.network;
        log(tLog('viewingStatusStarted'), {
            titles: state.items.length, endpointType: context.endpointType, endpointPath: context.endpointPath,
            completionRatio: VIEWING_COMPLETION_RATIO, maxPasses: VIEWING_MAX_PASSES,
            maxRequests: VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES, cachedTitles: watch.cachedTypes.size,
            concurrencyLimit: VIEWING_REQUEST_CONCURRENCY
        });
        watch.promise = (async () => {
            try {
                await collectViewingStatuses(job);
                assertViewingJob(job);
            } catch (error) {
                if (isRouteSessionCancelledError(error)) {
                    job.network.finishedAt = performance.now();
                    log(tLog('viewingStatusUnavailable'), { reason: 'VIEWING_STATUS_CANCELLED', requests: job.requests,
                        network: collectViewingNetworkDiagnostics(job.network) });
                    // A profile switch in the same grid invalidates old results.
                    if (sourceState === state && state.watchStatus === watch && isRouteSessionActive(job.sessionToken)) {
                        clearCachedViewingStatus(watch);
                        watch.results = new Map();
                        watch.types = new Map();
                        watch.seriesDetails = new Map();
                        watch.loading = false;
                        watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED';
                        syncWatchGroups(state);
                    }
                    return;
                }
                watch.failure = /^VIEWING_STATUS_[A-Z0-9_]+$/.test(error?.message || '')
                    ? error.message : 'VIEWING_STATUS_FAILED';
                warn(tLog('viewingStatusUnavailable'), { reason: watch.failure, requests: job.requests,
                    network: collectViewingNetworkDiagnostics(job.network) });
            }
            job.network.finishedAt = performance.now();
            if (sourceState !== state || state.watchStatus !== watch || !isRouteSessionActive(job.sessionToken)) return;
            if (netflixContext.activeProfile() !== context.profileGuid) {
                job.results.clear();
                job.types.clear();
                job.seriesDetails.clear();
                watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED';
            }
            watch.results = job.results;
            watch.types = job.types;
            watch.seriesDetails = job.seriesDetails;
            watch.requests = job.requests;
            watch.passes = job.passes;
            watch.loading = false;
            const unresolvedCachedIds = new Set([...watch.cachedResults.keys(), ...watch.cachedTypes.keys()]);
            clearCachedViewingStatus(watch);
            syncWatchGroups(state, unresolvedCachedIds, 'scan-complete');
            writeViewingCache(job);
            log(tLog('viewingStatusCompleted'), {
                completed: watch.completedCount, unknown: watch.unknownCount,
                requests: watch.requests, passes: watch.passes, failure: watch.failure, publications: watch.publications,
                series: { ...job.seriesStats, pending: job.seriesStats.eligible - job.seriesStats.checked - job.seriesStats.unplanned },
                recheck: job.recheckStats,
                network: collectViewingNetworkDiagnostics(job.network),
                work: collectPerformanceDiagnostics()
            });
        })().catch(() => {
            // Optional grouping must never reject Netflix's grid initialization.
            if (sourceState !== state || state.watchStatus !== watch) return;
            watch.loading = false;
            clearCachedViewingStatus(watch);
            watch.results = new Map();
            watch.types = new Map();
            watch.seriesDetails = new Map();
            watch.failure = 'VIEWING_STATUS_FAILED';
            syncWatchGroups(state);
        });
        return watch.promise;
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

    async function buildGraphqlMyListItems(records, totalCount, columns, template, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (!Array.isArray(records) || !template || !Number.isFinite(totalCount)) return null;
        // Material was captured before asynchronous data work; no live slot is borrowed here.
        const items = [];
        const seen = new Set();
        const complete = await runConstructionChunks(records.length, index => {
            const record = records[index];
            const videoId = record?.videoId;
            if (!videoId || seen.has(videoId)) return;
            const itemIndex = items.length;
            items.push({
                ...record,
                page: Math.floor(itemIndex / Math.max(1, columns)),
                logicalIndex: itemIndex,
                cardTemplate: template,
                graphql: true
            });
            seen.add(videoId);
        }, () => assertRouteSession(sessionToken));
        assertRouteSession(sessionToken);
        return complete && items.length === totalCount ? items : null;
    }

    // Collection strategy remains here until P13; data results contain no wire fields or DOM.
    async function collectLogicalListItems({ bootstrap, totalCount, columns, templateSlot, sessionToken = null }) {
        let current = bootstrap;
        try {
            assertRouteSession(sessionToken);
            if (bootstrap?.source === 'mounted-single-page-fast-path') {
                const reuse = collectMountedSinglePageItems(bootstrap, totalCount, columns, sessionToken);
                const work = performanceDiagnostics.membershipReuse;
                work.attempts++;
                if (reuse.items) {
                    work.reused++; work.itemsCaptured += reuse.items.length; work.requestsAvoided++;
                    return { bootstrap, items: reuse.items, collectionSource: 'mounted-single-page' };
                }
                work.rejected++;
                log('Mounted single-page membership reuse rejected; using fresh collection', {
                    collectionSource: 'mounted-single-page', reason: reuse.reason, totalCount });
            }
            // One detached template survives pagination/normalization yields. Grid owns it after acceptance.
            const template = templateSlot ? cardMarkup.captureTemplate(templateSlot) : null;
            const data = await listData.collectRecords({ bootstrap, totalCount, sessionToken });
            current = data.bootstrap;
            assertRouteSession(sessionToken);
            const items = await buildGraphqlMyListItems(data.records, totalCount, columns, template, sessionToken);
            assertRouteSession(sessionToken);
            return { bootstrap: current, items, ...(data.error ? { error: data.error } : {}) };
        } catch (error) {
            assertRouteSession(sessionToken);
            if (isRouteSessionCancelledError(error)) throw error;
            return { bootstrap: current, items: null, error };
        }
    }

    async function waitForMyListTotalCount(timeout = TOTAL_COUNT_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const started = performance.now();
        let lastGraphqlAvailable = false;
        while (performance.now() - started < timeout) {
            assertRouteSession(sessionToken);
            lastGraphqlAvailable = listData.isAvailable();
            const n = listData.detectMyListTotalCount();
            if (Number.isFinite(n) && n >= 0) return n;
            await sleep(NATIVE_READY_POLL_MS);
        }
        assertRouteSession(sessionToken);
        const details = {
            graphqlAvailable: lastGraphqlAvailable,
            graphqlKey: listData.diagnostics().graphqlKey,
            domGeneration: sourceState?.section ? detectCarouselDomProfile(sourceState.section).generation : null
        };
        logOperationTimeout('total-count-detection', timeout, details);
        throw initializationTimeoutError('total-count-detection', timeout, details);
    }

    function readNativeMyListDomState(...args) {
        return nativeCarousel.observe(...args);
    }

    function normalizeNetflixUiText(value) {
        return String(value || '')
            .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    function clearUndoExpiryTimer() {
        if (undoExpiryTimer) clearTimeout(undoExpiryTimer.id);
        undoExpiryTimer = null;
    }

    function clearUndoEntries() {
        clearUndoExpiryTimer();
        performanceDiagnostics.undoRetention.cleared += recentRemovedMyListItems.size;
        recentRemovedMyListItems.clear();
    }

    function scheduleUndoExpiry() {
        let dueAt = Infinity;
        for (const entry of recentRemovedMyListItems.values()) {
            if (Number.isFinite(entry?.removedAt)) dueAt = Math.min(dueAt, entry.removedAt + UNDO_ENTRY_TTL_MS);
        }
        if (!Number.isFinite(dueAt) || !isRouteSessionActive(sessionScope.token)) {
            clearUndoExpiryTimer();
            return;
        }
        if (undoExpiryTimer?.dueAt === dueAt && undoExpiryTimer.sessionToken === sessionScope.token) return;
        clearUndoExpiryTimer();
        // Capture only the timer owner, never a card or a removed-entry array.
        const owner = { id: null, sessionToken: sessionScope.token, dueAt };
        undoExpiryTimer = owner;
        performanceDiagnostics.undoRetention.schedules++;
        owner.id = setTimeout(() => {
            if (undoExpiryTimer !== owner) return;
            undoExpiryTimer = null;
            if (!isRouteSessionActive(owner.sessionToken)) return;
            performanceDiagnostics.undoRetention.expiryCallbacks++;
            pruneUndoEntries();
        }, Math.max(0, dueAt - performance.now()));
    }

    function forgetUndoEntry(videoId) {
        if (!recentRemovedMyListItems.delete(String(videoId))) return;
        performanceDiagnostics.undoRetention.consumed++;
        scheduleUndoExpiry();
    }

    function pruneUndoEntries(now = performance.now()) {
        let expired = 0, pendingFallbacksPreserved = 0;
        for (const [videoId, entry] of recentRemovedMyListItems.entries()) {
            if (!Number.isFinite(entry?.removedAt) || now - entry.removedAt >= UNDO_ENTRY_TTL_MS) {
                if (entry?.item && pendingMyListMutations.get(videoId)?.fallbackItem === entry.item) pendingFallbacksPreserved++;
                // Drop this cache's ownership only. A queued Undo mutation may
                // still own the same item and needs its snapshot to finish.
                recentRemovedMyListItems.delete(videoId);
                expired++;
            }
        }
        performanceDiagnostics.undoRetention.expired += expired;
        scheduleUndoExpiry();
        if (expired) log(tLog('undoEntriesExpired'), { expired, remaining: recentRemovedMyListItems.size, pendingFallbacksPreserved });
    }

    function rememberUndoEntry(item, index) {
        if (!item?.videoId || !item.snapshot) return;
        pruneUndoEntries();
        recentRemovedMyListItems.set(String(item.videoId), {
            videoId: String(item.videoId),
            item,
            index: Math.max(0, Number.isFinite(index) ? Math.floor(index) : 0),
            title: normalizeNetflixUiText(item.ariaLabel || ''),
            removedAt: performance.now()
        });
        performanceDiagnostics.undoRetention.remembered++;
        scheduleUndoExpiry();
    }

    function describeMyListUndoClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest?.('button');
        if (!button) return null;
        const toast = button.closest('#toastRoot [aria-label="toast"], #toastRoot [role="alert"]');
        if (!toast) return null;

        const toastButtons = [...toast.querySelectorAll('button')];
        if (toastButtons.length !== 1 || toastButtons[0] !== button) return null;

        pruneUndoEntries();
        let entry = null;
        for (const candidate of recentRemovedMyListItems.values()) {
            if (!entry || candidate.removedAt > entry.removedAt) entry = candidate;
        }
        if (!entry) return null;

        // A single action button inside a recent-removal toast is treated as Undo.
        // The most recent remembered removal identifies the affected video. No
        // localized toast text participates in detection or state decisions.
        return {
            button,
            videoId: entry.videoId,
            action: 'add',
            uiaAction: 'undo',
            wasInLegacy: false,
            uia: 'toast-undo',
            trackingContext: null,
            fallbackItem: entry.item,
            preferredIndex: entry.index,
            undo: true
        };
    }

    function findNativeMyListItemByVideoId(videoId, liveState = null) {
        const live = liveState || readNativeMyListDomState();
        const track = live.track;
        if (!track) return null;
        for (const slot of netflixDom.directSlots(track)) {
            const item = itemFromSlot(slot, live.selectedPage || 0, false);
            if (item?.videoId === String(videoId)) {
                item.snapshot = slot.cloneNode(true);
                return item;
            }
        }
        return null;
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

    function installEmptyFrameResizeObserver(section) {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (!sourceState?.empty || !sourceState.grid?.isConnected || !sourceState.status?.isConnected) return;
            const nextLayout = measureEmptyLayout(section);
            nextLayout.rowGap = measureNativeCarouselGap(section);
            sourceState.layout = nextLayout;
            const geometry = applyGridGeometry(section, sourceState.grid, nextLayout);
            sourceState.status.style.marginLeft = `${geometry.left}px`;
            sourceState.status.style.width = `${geometry.width}px`;
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (nextLayout.rowGap || 0) : 0}px`);
            applyLegacyEmptyStateGeometry(section, nextLayout);
        });
        resizeObserver.observe(section);
    }

    function moveLegacyFrameToSyntheticEmpty() {
        if (!sourceState) return false;
        const live = readNativeMyListDomState();
        if (live.section && !live.scroller && !live.track) {
            return adoptLiveEmptyMyListSection(live);
        }
        const synthetic = netflixDom.ensureSyntheticMyListSection();
        if (!synthetic) return false;
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        synthetic.setAttribute(SECTION_ATTR, 'true');
        clearLegacyEmptyState({ restoreGrid: false });
        synthetic.appendChild(status);
        status.insertAdjacentElement('afterend', grid);
        const layout = measureEmptyLayout(synthetic);
        layout.rowGap = measureNativeCarouselGap(synthetic);
        attachNativeBinding(sourceState, synthetic);
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        grid.setAttribute('data-tm-empty', 'true');
        const geometry = applyGridGeometry(synthetic, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', '0px');
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

        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        clearSourceAlignment();
        invalidateGridReact();
        const oldSynthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        clearLegacyEmptyState({ restoreGrid: false });
        live.section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(live.section);
        const layout = measureVisibleLayout(live.section, live.scroller, live.track);
        layout.rowGap = measureNativeCarouselGap(live.section);
        parkSource(live.scroller);
        live.scroller.insertAdjacentElement('afterend', status);
        status.insertAdjacentElement('afterend', grid);
        attachNativeBinding(sourceState, live.section, live.scroller, live.track);
        sourceState.layout = layout;
        sourceState.status = status;
        sourceState.grid = grid;
        sourceState.empty = (sourceState.items?.length ?? 0) === 0;
        if (!sourceState.empty) waitingForNativeEmpty = false;
        const geometry = applyGridGeometry(live.section, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        syncStatusTypography(live.section, status);
        completedSection = live.section;
        if (oldSynthetic && oldSynthetic !== live.section) oldSynthetic.remove();
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
        const status = sourceState.status || document.getElementById(STATUS_ID);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;

        clearSourceAlignment();
        invalidateGridReact();
        const oldSynthetic = document.getElementById(SYNTHETIC_SECTION_ID);
        live.section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(live.section);

        const layout = measureEmptyLayout(live.section);
        layout.rowGap = measureNativeCarouselGap(live.section);
        const emptyContent = live.section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const originalAnchor = emptyContent || markOriginalHeader(live.section);
        if (originalAnchor) originalAnchor.insertAdjacentElement('afterend', status);
        else live.section.prepend(status);
        status.insertAdjacentElement('afterend', grid);

        attachNativeBinding(sourceState, live.section);
        sourceState.layout = layout;
        sourceState.empty = true;
        sourceState.status = status;
        sourceState.grid = grid;
        grid.setAttribute('data-tm-empty', 'true');
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(live.section, { allowProvisional: true });

        const geometry = applyGridGeometry(live.section, grid, layout);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        applyLegacyEmptyStateGeometry(live.section, layout);
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        syncStatusTypography(live.section, status);

        completedSection = live.section;
        if (oldSynthetic && oldSynthetic !== live.section) oldSynthetic.remove();
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
        if (!sourceState?.section || !sourceState?.scroller || !sourceState?.track) return false;
        const runtime = getCarouselDomRuntime(sourceState.section);
        if (!runtime || runtime.profile.pageMode !== 'logical') return false;

        const columns = Math.max(1, sourceState.layout?.columns || 1);
        const items = sourceState.items || [];
        const estimatedPages = Math.max(1, Math.ceil(Math.max(items.length, 1) / columns));
        const slots = currentPageSlots(sourceState.scroller, sourceState.track);
        const signature = visibleSignature(slots);

        // Hawkins page boundaries can retain a native phase across a responsive
        // column-count change or a My List delta. Recomputing every item.page as
        // floor(index / columns) fabricates page boundaries that may be one page
        // away from the live carousel. Preserve the last native-observed pages and
        // re-anchor only the page that is actually visible now.
        const votes = new Map();
        for (const slot of slots) {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const videoId = card ? videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
            const item = videoId ? sourceState.itemMap?.get(`v:${videoId}`) : null;
            if (!Number.isFinite(item?.page)) continue;
            votes.set(item.page, (votes.get(item.page) || 0) + 1);
        }

        const nativePageState = nativeLogicalPageState(
            sourceState.scroller,
            sourceState.track,
            items.length,
            columns
        );
        let currentPage = Number.isFinite(nativePageState.page)
            ? nativePageState.page
            : Math.max(0, Math.min(estimatedPages - 1, runtime.currentPage || 0));
        if (!Number.isFinite(nativePageState.page) && votes.size) {
            currentPage = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
            currentPage = Math.max(0, Math.min(estimatedPages - 1, currentPage));
        }

        myListCountConvergencePending = true;
        nativeCarousel.anchorAfterDelta(sourceState.section, { pageCount: estimatedPages, currentPage, signature });

        log(tLog('logicalPageModelSynchronizedAfterDelta'), {
            reason,
            currentPage,
            knownPageCount: runtime.knownPageCount,
            pageCountFinalized: runtime.pageCountFinalized,
            pageMappingStale: runtime.pageMappingStale,
            visibleSignature: signature,
            visibleIds: slots.map(slot => videoIdFromHref(slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || '')).filter(Boolean),
            itemIndices: nativePageState.itemIndices,
            logicalIndices: nativePageState.logicalIndices,
            totalCount: items.length
        });
        return true;
    }

    function reindexLegacyItemsAfterDelta(reason = 'delta-reindex') {
        if (!sourceState) return;
        const items = sourceState.items || [];
        const columns = Math.max(1, sourceState.layout?.columns || 1);
        const runtime = sourceState.section ? getCarouselDomRuntime(sourceState.section) : null;
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const resetLogicalPages = reason === 'mutation-reindex';
        sourceState.itemMap = new Map();
        items.forEach((item, index) => {
            // Generation 1 retains authoritative native indicators. Generation 2
            // keeps the last page observed from the live Hawkins carousel during
            // order alignment. An add/remove changes every later page boundary,
            // so mutation reindexing must reset all logical pages from the new
            // item order before the native carousel converges.
            if (!logicalMode || resetLogicalPages || !Number.isFinite(item.page)) {
                item.page = Math.floor(index / columns);
            }
            const key = itemKey(item);
            sourceState.itemMap.set(key, item);
            const clone = sourceState.cloneMap?.get(key);
            if (clone?.isConnected) copyItemAttributes(clone, item, index);
        });
        sourceState.totalCount = items.length;
        sourceState.empty = items.length === 0;
        if (logicalMode) {
            syncLogicalPageModelAfterDelta(reason);
            if (items.length) scheduleResponsiveRefresh(140, 'my-list-delta');
        }
        if (sourceState.grid) {
            if (items.length) sourceState.grid.removeAttribute('data-tm-empty');
            else sourceState.grid.setAttribute('data-tm-empty', 'true');
        }
        if (items.length) {
            waitingForNativeEmpty = false;
            clearLegacyEmptyState();
        } else {
            waitingForNativeEmpty = true;
            syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
        }
        invalidateGridReact();
        if (sourceState.watchStatus) syncWatchGroups(sourceState);
        const elapsed = sourceState.initializationElapsedMs;
        sourceState.status = updateStatus(formatHeaderParts(items.length, items.length, elapsed, true));
        if (sourceState.status && sourceState.layout) {
            sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList && !sourceState.empty ? (sourceState.layout.rowGap || 0) : 0}px`);
        }
    }

    function applyLegacyRemoval(videoId, reason = 'click-delta') {
        if (!sourceState?.items) return false;
        const key = `v:${videoId}`;
        const index = sourceState.items.findIndex(item => itemKey(item) === key);
        if (index < 0) return false;

        const [removed] = sourceState.items.splice(index, 1);
        const clone = sourceState.cloneMap?.get(key);
        if (activeVideoId === String(videoId) || activeClone === clone) {
            advanceHoverToken('source');
            clearSourceAlignment();
            activeVideoId = null;
            activeClone = null;
            activePage = null;
        }
        releaseGridReact(clone);
        clone?.remove();
        // Reuse the removed tree for Undo instead of keeping another full tree
        // for every item throughout its lifetime in the displayed grid.
        if (clone) removed.snapshot = clone;
        rememberUndoEntry(removed, index);
        sourceState.cloneMap?.delete(key);
        sourceState.itemMap?.delete(key);
        reindexLegacyItemsAfterDelta('mutation-reindex');
        mutationSourceRecoveryPending = true;
        if (!sourceState.items.length) {
            // Do not inject a synthetic section into Netflix's React-managed section
            // stack during the last-item transition. Netflix owns the native My List
            // carousel -> empty-section replacement; we only wait for and adopt it.
            waitingForNativeEmpty = true;
        }
        log(tLog('legacyItemRemovedByDifferentialUpdate'), {
            reason,
            removed: itemSummary(removed),
            remaining: sourceState.items.length
        });
        return true;
    }

    function applyLegacyAddition(item, preferredIndex = 0, reason = 'click-delta') {
        if (!sourceState || !item?.videoId || !cardSourceForItem(item)) return false;
        const key = itemKey(item);
        if (sourceState.itemMap?.has(key) || sourceState.items?.some(existing => itemKey(existing) === key)) return false;

        const items = sourceState.items || (sourceState.items = []);
        const grid = sourceState.grid || document.getElementById(GRID_ID);
        if (!grid) return false;
        ensureGridHoverBehavior(grid);
        const index = Math.max(0, Math.min(items.length, Number.isFinite(preferredIndex) ? Math.floor(preferredIndex) : 0));
        const clone = createItemClone(item);
        item.page = Math.floor(index / Math.max(1, sourceState.layout?.columns || 1));
        normalizeClone(clone);
        copyItemAttributes(clone, item, index);
        associateGridHoverItem(item, clone);
        const before = sourceState.watchStatus ? null : (grid.children[index] || null);
        grid.insertBefore(clone, before);
        items.splice(index, 0, item);
        sourceState.cloneMap ||= new Map();
        sourceState.cloneMap.set(key, clone);
        sourceState.itemMap ||= new Map();
        sourceState.itemMap.set(key, item);
        releaseItemCardSnapshot(item);
        forgetUndoEntry(item.videoId);
        waitingForNativeEmpty = false;
        sourceState.empty = false;
        grid.removeAttribute('data-tm-empty');
        reindexLegacyItemsAfterDelta('mutation-reindex');
        mutationSourceRecoveryPending = true;
        log(tLog('legacyItemAddedByDifferentialUpdate'), {
            reason,
            index,
            added: itemSummary(item),
            total: sourceState.items.length
        });
        return true;
    }

    function visibleNativeItems(live) {
        if (!live?.scroller || !live?.track) return [];
        return currentPageSlots(live.scroller, live.track)
            .map(slot => itemFromSlot(slot, live.selectedPage || 0, false))
            .filter(item => item?.videoId);
    }

    function preferredIndexForNativeItem(videoId, live) {
        const items = visibleNativeItems(live);
        const position = items.findIndex(item => item.videoId === String(videoId));
        if (position < 0) return 0;
        const columns = Math.max(1, sourceState?.layout?.columns || items.length || 1);
        return Math.min(sourceState?.items?.length ?? 0, (live.selectedPage || 0) * columns + position);
    }

    function alignLegacyVisiblePageOrder(live) {
        if (!sourceState?.items?.length || !live?.pageSignature) return false;
        const nativeItems = visibleNativeItems(live);
        const nativeIds = nativeItems.map(item => item.videoId);
        if (!nativeIds.length || nativeIds.some(id => !sourceState.itemMap?.has(`v:${id}`))) return false;

        const columns = Math.max(1, sourceState.layout?.columns || nativeIds.length);
        const base = Math.min(sourceState.items.length, (live.selectedPage || 0) * columns);
        const currentIds = sourceState.items.slice(base, base + nativeIds.length).map(item => item.videoId);
        if (currentIds.join('|') === nativeIds.join('|')) return false;

        const nativeSet = new Set(nativeIds);
        const ordered = nativeIds.map(id => sourceState.itemMap.get(`v:${id}`)).filter(Boolean);
        const remaining = sourceState.items.filter(item => !nativeSet.has(item.videoId));
        const insertion = Math.min(base, remaining.length);
        sourceState.items = [...remaining.slice(0, insertion), ...ordered, ...remaining.slice(insertion)];

        const grid = sourceState.grid;
        if (grid && !sourceState.watchStatus) {
            // Only move the visible native page worth of clones. The remaining clones
            // keep their relative order, so DOM work stays O(columns), not O(all items).
            for (let i = 0; i < ordered.length; i++) {
                const clone = sourceState.cloneMap?.get(itemKey(ordered[i]));
                if (!clone) continue;
                const targetIndex = insertion + i;
                const reference = grid.children[targetIndex] || null;
                if (reference !== clone) grid.insertBefore(clone, reference);
            }
        }
        reindexLegacyItemsAfterDelta();
        log(tLog('legacyVisibleOrderAligned'), {
            page: live.selectedPage,
            ids: nativeIds
        });
        return true;
    }

    function disposeMyListMutation(videoId, expected = null) {
        const key = String(videoId || '');
        const mutation = pendingMyListMutations.get(key);
        if (!mutation || (expected && mutation !== expected)) return;
        try { mutation.observer?.disconnect(); } catch (_) {}
        if (mutation.timeoutId !== null && mutation.timeoutId !== undefined) clearTimeout(mutation.timeoutId);
        pendingMyListMutations.delete(key);
    }

    function scheduleMyListMutationTimeout(mutation) {
        if (!mutation || pendingMyListMutations.get(mutation.videoId) !== mutation) return;
        if (mutation.timeoutId !== null && mutation.timeoutId !== undefined) clearTimeout(mutation.timeoutId);
        mutation.timeoutId = setTimeout(() => {
            if (pendingMyListMutations.get(mutation.videoId) !== mutation) return;
            mutation.timeoutId = null;

            const applied = tryApplyMyListMutation(mutation, 'observer-timeout');
            if (applied || pendingMyListMutations.get(mutation.videoId) !== mutation) return;
            if (running || responsiveRefreshing) {
                mutation.deferredWhileBusy = true;
                return;
            }

            warn(tLog('differentialUpdateTimedOutWaitingForAUsableCardSnapshot'), {
                seq: mutation.seq,
                videoId: mutation.videoId,
                action: mutation.action,
                timeoutMs: DELTA_MUTATION_TIMEOUT_MS
            });
            disposeMyListMutation(mutation.videoId, mutation);
        }, DELTA_MUTATION_TIMEOUT_MS);
    }

    function retryPendingMyListMutations(reason) {
        if (running || responsiveRefreshing || !isTargetPage()) return;

        for (const mutation of [...pendingMyListMutations.values()]) {
            if (!mutation.deferredWhileBusy) continue;
            mutation.deferredWhileBusy = false;
            const applied = tryApplyMyListMutation(mutation, reason);
            if (!applied && pendingMyListMutations.get(mutation.videoId) === mutation) {
                scheduleMyListMutationTimeout(mutation);
            }
        }
    }

    function clearPendingMyListMutations() {
        for (const [videoId, mutation] of [...pendingMyListMutations.entries()]) {
            disposeMyListMutation(videoId, mutation);
        }
        pendingMyListMutations = new Map();
    }

    function nativeBindingChanged(live) {
        if (!sourceState || !live?.section || !live?.scroller || !live?.track) return false;
        return sourceState.section !== live.section ||
            sourceState.scroller !== live.scroller ||
            sourceState.track !== live.track ||
            !sourceState.section?.isConnected ||
            !sourceState.scroller?.isConnected ||
            !sourceState.track?.isConnected;
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

        const sessionToken = sessionScope.token;
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        completedSection = null;
        nativeCarousel.clearBinding();
        sourceState = null;
        waitingForNativeEmpty = false;
        missingSectionSince = 0;
        lastResponsiveSignature = '';
        lastPageShape = '';
        scheduleRun(0, sessionToken);
        return true;
    }

    function ensureLiveNativeBinding(reason = 'live-check', bindingOnly = false) {
        if (!sourceState || !isTargetPage()) return null;
        if (bindingOnly && !waitingForNativeEmpty && !sourceState.empty) {
            // Observer callbacks need element identity, not page geometry, React
            // indices, or counts when Netflix still owns the same mounted source.
            const section = findMyListSection();
            const scroller = section?.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) || null;
            const track = scroller && netflixDom.findTrack(scroller);
            const binding = { section, scroller, track };
            if (section && scroller && track && !nativeBindingChanged(binding)) return binding;
        }
        let live = readNativeMyListDomState();

        if (waitingForNativeEmpty && (sourceState.items?.length ?? 0) === 0) {
            if (live.section && !live.scroller && !live.track) {
                const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
                const alreadyNative = (
                    sourceState.section === live.section &&
                    !sourceState.scroller &&
                    !sourceState.track &&
                    emptyState?.getAttribute('data-tm-empty-source') === 'native'
                );
                if (!alreadyNative) adoptLiveEmptyMyListSection(live);
                live = readNativeMyListDomState();
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
            const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
            if (!emptyState?.isConnected) {
                syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
            }
            return live;
        }

        if (live.section && live.scroller && live.track &&
            sourceState.empty && (sourceState.items?.length ?? 0) === 0) {
            if (restartInitializationForPopulatedNativeMyList(live, reason)) return live;
        }

        if (live.section && live.scroller && live.track && nativeBindingChanged(live)) {
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
            live = readNativeMyListDomState();
        } else if (live.section && !live.scroller && !live.track && (sourceState.items?.length ?? 0) === 0) {
            const emptyState = document.getElementById(LEGACY_EMPTY_STATE_ID);
            const alreadyNative = (
                sourceState.section === live.section &&
                !sourceState.scroller &&
                !sourceState.track &&
                emptyState?.getAttribute('data-tm-empty-source') === 'native'
            );
            if (!alreadyNative) {
                adoptLiveEmptyMyListSection(live);
                live = readNativeMyListDomState();
            }
        } else if (!live.section && (sourceState.items?.length ?? 0) === 0 && sourceState.section?.id !== SYNTHETIC_SECTION_ID) {
            if (!waitingForNativeEmpty) {
                moveLegacyFrameToSyntheticEmpty();
                live = readNativeMyListDomState();
            }
        }
        return live;
    }

    function refreshNativeSectionAfterDelta() {
        return ensureLiveNativeBinding('delta-refresh');
    }

    function tryApplyMyListMutation(mutation, reason = 'event') {
        if (!mutation || pendingMyListMutations.get(mutation.videoId) !== mutation) return false;
        if (!sourceState || !isTargetPage()) return false;
        if (running || responsiveRefreshing || (nativeInitializationFailure?.sessionToken === sessionScope.token &&
            initializationBlockedSessionToken === sessionScope.token)) {
            mutation.deferredWhileBusy = true;
            return false;
        }
        mutation.deferredWhileBusy = false;

        const videoId = mutation.videoId;
        let live = refreshNativeSectionAfterDelta() || readNativeMyListDomState();

        if (mutation.action === 'remove') {
            const changed = applyLegacyRemoval(videoId, reason);
            if (!changed && !sourceState.itemMap?.has(`v:${videoId}`)) {
                disposeMyListMutation(videoId, mutation);
                return true;
            }
            if (changed) {
                live = refreshNativeSectionAfterDelta() || live;
                if (live?.track) alignLegacyVisiblePageOrder(live);
                disposeMyListMutation(videoId, mutation);
                return true;
            }
            return false;
        }

        if (sourceState.itemMap?.has(`v:${videoId}`)) {
            disposeMyListMutation(videoId, mutation);
            return true;
        }

        const nativeItem = findNativeMyListItemByVideoId(videoId, live);
        const candidate = nativeItem || mutation.fallbackItem || findAnyStandardCardItemByVideoId(videoId);
        if (!cardSourceForItem(candidate)) return false;

        const preferredIndex = nativeItem
            ? preferredIndexForNativeItem(videoId, live)
            : (Number.isFinite(mutation.preferredIndex) ? mutation.preferredIndex : 0);
        const changed = applyLegacyAddition(candidate, preferredIndex, nativeItem ? `${reason}-native` : `${reason}-captured`);
        if (changed || sourceState.itemMap?.has(`v:${videoId}`)) {
            live = refreshNativeSectionAfterDelta() || live;
            if (live?.track) alignLegacyVisiblePageOrder(live);
            disposeMyListMutation(videoId, mutation);
            return true;
        }
        return false;
    }

    function queueMyListMutation(descriptor) {
        if (!descriptor?.videoId || !sourceState) return;
        const videoId = String(descriptor.videoId);
        disposeMyListMutation(videoId);

        const fallbackItem = descriptor.action === 'add'
            ? (descriptor.fallbackItem || findAnyStandardCardItemByVideoId(videoId))
            : null;
        const seq = ++myListMutationSequence;
        const mutation = {
            seq,
            videoId,
            action: descriptor.action,
            uia: descriptor.uia || '',
            uiaAction: descriptor.uiaAction || 'unknown',
            source: 'user-click',
            detectedAt: performance.now(),
            fallbackItem,
            preferredIndex: Number.isFinite(descriptor.preferredIndex) ? Math.max(0, Math.floor(descriptor.preferredIndex)) : null,
            undo: Boolean(descriptor.undo),
            observer: null,
            timeoutId: null,
            deferredWhileBusy: false
        };
        pendingMyListMutations.set(videoId, mutation);

        // Register before Netflix handles the click. This catches synchronous React
        // mutations from every carousel and MiniModal without a periodic poll.
        const root = document.body || document.documentElement;
        if (root) {
            mutation.observer = new MutationObserver(() => {
                tryApplyMyListMutation(mutation, 'mutation-observer');
            });
            mutation.observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['data-uia', 'class', 'aria-label', 'href']
            });
        }

        // A one-shot timeout bounds ordinary waiting. If the script is busy,
        // defer disposal until the busy operation ends and retry then.
        scheduleMyListMutationTimeout(mutation);

        log(tLog('myListMutationQueued'), {
            seq,
            videoId,
            action: descriptor.action,
            uiaAction: descriptor.uiaAction || 'unknown',
            uia: descriptor.uia || '',
            syncMode: 'event-driven',
            undo: Boolean(mutation.undo),
            preferredIndex: mutation.preferredIndex,
            hasFallbackSnapshot: Boolean(cardSourceForItem(fallbackItem))
        });

        // Capture runs before Netflix's handler; a microtask runs after the click
        // dispatch completes. Most removals and visible-card additions finish here.
        queueMicrotask(() => {
            tryApplyMyListMutation(mutation, 'post-click');
        });
    }

    function handleObservedMyListToggleClick(event) {
        if (!isTargetPage() || !sourceState) return;
        const descriptor = describeMyListToggleClick(event) || describeMyListUndoClick(event);
        if (!descriptor) return;
        queueMyListMutation(descriptor);
    }

    function updateStatus(content) {
        let node = document.getElementById(STATUS_ID);
        if (!node) {
            node = document.createElement('div');
            node.id = STATUS_ID;
        }

        let textNode = node.querySelector(`.${STATUS_TEXT_CLASS}`);
        if (!textNode) {
            textNode = document.createElement('span');
            textNode.className = STATUS_TEXT_CLASS;
            node.appendChild(textNode);
        }

        let labelNode = textNode.querySelector(`.${STATUS_LABEL_CLASS}`);
        if (!labelNode) {
            labelNode = document.createElement('span');
            labelNode.className = STATUS_LABEL_CLASS;
            textNode.appendChild(labelNode);
        }

        let metaNode = textNode.querySelector(`.${STATUS_META_CLASS}`);
        if (!metaNode) {
            metaNode = document.createElement('span');
            metaNode.className = STATUS_META_CLASS;
            textNode.appendChild(metaNode);
        }

        const label = content && typeof content === 'object' ? content.label || '' : String(content ?? '');
        const meta = content && typeof content === 'object' ? content.meta || '' : '';
        if (labelNode.textContent !== label) labelNode.textContent = label;
        if (metaNode.textContent !== meta) metaNode.textContent = meta;

        let link = node.querySelector(`#${LOG_LINK_ID}`);
        if (!link) {
            link = document.createElement('a');
            link.id = LOG_LINK_ID;
            link.href = '#';
            link.textContent = 'CopyLogs';
            link.title = copyLogsTooltip();
            link.addEventListener('click', handleLogClick);
            node.appendChild(link);
        }

        return node;
    }

    function hideOrderMismatchDialog() {
        document.getElementById(ORDER_MISMATCH_DIALOG_ID)?.remove();
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
        orderMismatchReinitializing = true;
        orderMismatchDismissed = true;
        hideOrderMismatchDialog();

        advanceHoverToken('source');
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;

        log(tLog('manualReinitializationRequested'), {
            selectedPage: sourceState?.section ? selectedPage(sourceState.section) : null,
            items: sourceState?.items?.length ?? null
        });

        try {
            try { await Promise.resolve(responsiveRefreshPromise); } catch (_) {}
            await nativeCarousel.whenNavigationIdle();
            if (!isRouteSessionActive(sessionToken)) return;

            // Reinitialization must begin from Netflix's first native My List page.
            // Keep the current source state alive until page 0 is confirmed so the
            // logical carousel can still resolve its native page number correctly.
            const section = sourceState?.section;
            const scroller = sourceState?.scroller;
            if (!section?.isConnected || !scroller?.isConnected) {
                throw initializationError(
                    'REINITIALIZATION_SOURCE_UNAVAILABLE',
                    'return-native-my-list-to-start',
                    'The native My List carousel is unavailable before reinitialization'
                );
            }

            const fromPage = selectedPage(section);
            const returnedPage = await goToPage(section, scroller, 0, null, sessionToken);
            assertRouteSession(sessionToken);
            if (returnedPage !== 0 || selectedPage(section) !== 0) {
                throw initializationError(
                    'REINITIALIZATION_START_PAGE_NOT_REACHED',
                    'return-native-my-list-to-start',
                    'Could not return the native My List carousel to the first page',
                    { fromPage, returnedPage, selectedPage: selectedPage(section) }
                );
            }

            // Fully discard the existing My List for Netflix session using the same
            // teardown path as a route leave, then start a fresh normal session.
            suspendTargetSession('order-mismatch-reinitialize');
            if (!isTargetPage()) return;
            startTargetSession('order-mismatch-reinitialize');
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
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

        orderMismatchDialogOpen = true;
        const dialog = document.createElement('div');
        dialog.id = ORDER_MISMATCH_DIALOG_ID;
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'false');
        dialog.setAttribute('aria-label', tUi('orderChangedPrompt'));

        const message = document.createElement('div');
        message.setAttribute('data-tm-order-message', 'true');
        message.textContent = tUi('orderChangedPrompt');

        const actions = document.createElement('div');
        actions.setAttribute('data-tm-order-actions', 'true');

        const okButton = document.createElement('button');
        okButton.type = 'button';
        okButton.setAttribute('data-tm-order-ok', 'true');
        okButton.textContent = tUi('orderChangedOk');

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.setAttribute('data-tm-order-cancel', 'true');
        cancelButton.textContent = tUi('orderChangedCancel');

        okButton.addEventListener('click', () => {
            log(tLog('orderMismatchPromptAccepted'), {
                item: itemSummary(item),
                expectedPage,
                visibleIds
            });
            void reinitializeAfterOrderMismatch();
        }, { once: true });

        cancelButton.addEventListener('click', () => {
            orderMismatchDismissed = true;
            hideOrderMismatchDialog();
            log(tLog('orderMismatchPromptCancelled'), {
                item: itemSummary(item),
                expectedPage,
                visibleIds
            });
        }, { once: true });

        actions.append(okButton, cancelButton);
        dialog.append(message, actions);
        (document.body || document.documentElement).appendChild(dialog);

        log(tLog('orderMismatchPromptShown'), {
            item: itemSummary(item),
            expectedPage,
            visibleIds
        });
    }

    function syncStatusTypography(section, status) {
        const heading = section?.querySelector('h2') || document.querySelector(`${NETFLIX_DOM_SELECTORS.browseSections} section h2`);
        if (!heading || !status) return;

        const style = getComputedStyle(heading);
        for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']) {
            const value = style.getPropertyValue(property);
            if (value) status.style.setProperty(property, value);
        }
        status.style.color = style.color || 'rgb(255, 255, 255)';
    }

    function detectCarouselDomProfile(...args) {
        return nativeCarousel.profile(...args);
    }

    function getCarouselDomRuntime(...args) {
        return nativeCarousel.model(...args);
    }

    function resetCarouselDomRuntime(...args) {
        return nativeCarousel.resetModel(...args);
    }

    function carouselDomProfileSummary(...args) {
        return nativeCarousel.profileSummary(...args);
    }

    function logCarouselDomProfile(...args) {
        return nativeCarousel.logProfile(...args);
    }

    function logicalVisibleSignature(...args) {
        return nativeCarousel.visiblePageSignature(...args);
    }

    function registerLogicalPageSignature(...args) {
        return nativeCarousel.registerPage(...args);
    }

    function normalizeLogicalPages(...args) {
        return nativeCarousel.normalizePages(...args);
    }

    function selectedPage(...args) {
        return nativeCarousel.selectedPage(...args);
    }

    function pageCount(...args) {
        return nativeCarousel.pageCount(...args);
    }

    function carouselMoveButton(...args) {
        return nativeCarousel.navigationControl(...args);
    }

    function carouselMoveButtonDisabled(...args) {
        return nativeCarousel.controlDisabled(...args);
    }

    function moveOnePage(...args) {
        return nativeCarousel.movePage(...args);
    }

    function goToPage(...args) {
        return nativeCarousel.navigateTo(...args);
    }

    function currentPageSlots(...args) {
        return nativeCarousel.currentSlots(...args);
    }

    function visibleSignature(...args) {
        return nativeCarousel.signatureOf(...args);
    }

    function nativeCarouselReadiness(...args) {
        return nativeCarousel.readiness(...args);
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

    function waitForNativeCarouselReady(...args) {
        return nativeCarousel.ready(...args);
    }

    function waitStableCurrentPage(...args) {
        return nativeCarousel.stablePage(...args);
    }

    function createItemClone(item) {
        const source = cardSourceForItem(item);
        if (!source) throw new Error(`No card markup available for ${itemKey(item)}`);
        return cardMarkup.createClone(source, item, source === item.cardTemplate);
    }

    function cardSourceForItem(item) {
        if (!item) return null;
        if (item.snapshot) return item.snapshot;
        const key = itemKey(item);
        // A removed/recollected item with the same title id must not borrow a
        // different item's tree. Published items use only their current clone.
        if (sourceState?.itemMap?.get(key) === item) {
            const clone = sourceState.cloneMap?.get(key);
            if (clone) return clone;
        }
        return item.cardTemplate || null;
    }

    function releaseItemCardSnapshot(item) {
        // Clear references without deleting properties from frequently read items.
        if (item.snapshot) item.snapshot = null;
        if (item.cardTemplate) item.cardTemplate = null;
        if (item.imageUrl) item.imageUrl = '';
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

    function pageItemKeys(...args) {
        return nativeCarousel.pageKeys(...args);
    }

    function currentPageVideoIds(...args) {
        return nativeCarousel.visibleVideoIds(...args);
    }

    async function ensureFreshIndicatorPageZeroAnchor(section, scroller, track, firstVideoId, sessionToken = null) {
        return nativeCarousel.anchorPageZero({ section, scroller, track, firstVideoId, sessionToken,
            columns: sourceState?.layout?.columns });
    }

    // Reads the private React props needed to order and validate Netflix's logical carousel.
    function logVirtualRawIndexDiagnostic(...args) {
        return nativeCarousel.diagnoseIndices(...args);
    }

    function nativeReactCarouselTotalCount(...args) {
        return nativeCarousel.readCount(...args);
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
            nativeCountState = nativeReactCarouselTotalCount(sourceState.scroller, sourceState.track);
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

    function requireNativeReactCarouselTotalCount(...args) {
        return nativeCarousel.requireCount(...args);
    }

    function netflixItemIndexFromSlot(...args) {
        return nativeCarousel.itemIndex(...args);
    }

    function normalizeNetflixLogicalIndex(...args) {
        return nativeCarousel.logicalIndex(...args);
    }

    function logicalSlotPositions(...args) {
        return nativeCarousel.positions(...args);
    }

    function expectedLogicalIndicesForPage(...args) {
        return nativeCarousel.expectedPageIndices(...args);
    }

    function logicalPageFromSlotPositions(...args) {
        return nativeCarousel.pageForPositions(...args);
    }

    function nativeLogicalPageState(...args) {
        return nativeCarousel.logicalWindow(...args);
    }

    function forceLogicalPageSignature(...args) {
        return nativeCarousel.forcePage(...args);
    }

    function requireNativeLogicalPageState(...args) {
        return nativeCarousel.requireLogicalWindow(...args);
    }

    async function collectAllItems(section, scroller, track, totalCount, sessionToken = null) {
        const state = sourceState;
        const result = await nativeCarousel.collect({ section, scroller, track, totalCount,
            columns: state?.layout?.columns, sessionToken, onProgress(facts) {
                if (sourceState !== state) return;
                if (facts.initialPage !== undefined && state) state.initialPage = facts.initialPage;
                if (facts.collectedCount !== undefined) {
                    if (state) state.collectedCount = facts.collectedCount;
                    updateStatus(formatHeaderParts(facts.collectedCount, totalCount, null));
                }
            } });
        return result.items;
    }

    function normalizeClone(slot) {
        cardMarkup.normalize(slot);
        // Group controls remain with presentation until P11/P12.
        ensureManualViewingControls(slot);
    }

    function currentGridGeometry(section, layout) {
        const sectionRect = nativeRect(section);
        const left = Math.max(0, layout.gridLeft);
        const viewportRight = Math.min(window.innerWidth, sectionRect.right);
        const available = Math.max(layout.cardWidth, viewportRight - sectionRect.left - left);
        const width = Math.max(layout.cardWidth, Math.min(layout.gridWidth, available));

        // Use the currently measured native Netflix column count instead of recalculating from the startup ratio.
        return { width, left, columns: Math.max(1, layout.columns) };
    }

    function applyGridGeometry(section, grid, layout) {
        const geometry = currentGridGeometry(section, layout);
        const properties = {
            '--tm-cols': String(geometry.columns),
            '--tm-grid-width': `${geometry.width}px`,
            '--tm-grid-left': `${geometry.left}px`,
            '--tm-gap': `${layout.gap}px`
        };
        for (const [property, value] of Object.entries(properties)) {
            if (grid.style.getPropertyValue(property) !== value) grid.style.setProperty(property, value);
        }
        grid.__tmAppliedGeometry = geometry;
        return geometry;
    }

    function pairDomTrees(sourceRoot, cloneRoot) {
        const domMap = new Map();
        const pairs = [];

        function walk(source, clone) {
            if (!(source instanceof Element) || !(clone instanceof Element)) return;
            domMap.set(source, clone);
            pairs.push([source, clone]);

            const sourceChildren = source.children;
            const cloneChildren = clone.children;
            const count = Math.min(sourceChildren.length, cloneChildren.length);
            for (let i = 0; i < count; i++) walk(sourceChildren[i], cloneChildren[i]);
        }

        walk(sourceRoot, cloneRoot);
        return { domMap, pairs };
    }

    // Contains the private React-key graft used only to make cloned cards hoverable.
    const netflixReactHover = Object.freeze({
        clearClone(root) {
            const nodes = [root, ...root.querySelectorAll('*')];
            for (const node of nodes) {
                for (const key of Object.getOwnPropertyNames(node)) {
                    if (!key.startsWith('__react')) continue;
                    if (key.startsWith('__reactContainer$')) continue;
                    try { delete node[key]; } catch (_) {}
                }
            }
        },

        graftTreeToClone(sourceRoot, cloneRoot) {
            const { domMap, pairs } = pairDomTrees(sourceRoot, cloneRoot);
            const fiberMap = new Map();
            let fiberAssignments = 0;
            let propsAssignments = 0;

            function reactKeysForNode(node) {
                const keys = Object.getOwnPropertyNames(node);
                return {
                    fiberKeys: keys.filter(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')),
                    propsKeys: keys.filter(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')),
                    otherKeys: keys.filter(k =>
                        k.startsWith('__react') &&
                        !k.startsWith('__reactFiber$') &&
                        !k.startsWith('__reactInternalInstance$') &&
                        !k.startsWith('__reactProps$') &&
                        !k.startsWith('__reactEventHandlers$')
                    )
                };
            }

            function cloneFiberChain(sourceFiber) {
                if (!sourceFiber || typeof sourceFiber !== 'object') return sourceFiber;
                if (fiberMap.has(sourceFiber)) return fiberMap.get(sourceFiber);

                const clonedFiber = Object.assign(
                    Object.create(Object.getPrototypeOf(sourceFiber) || Object.prototype),
                    sourceFiber
                );
                fiberMap.set(sourceFiber, clonedFiber);

                if (sourceFiber.stateNode instanceof Node && domMap.has(sourceFiber.stateNode)) {
                    clonedFiber.stateNode = domMap.get(sourceFiber.stateNode);
                }

                // Preserve the structure that produced working hover behavior in legacy 1.2.0.
                clonedFiber.return = cloneFiberChain(sourceFiber.return);
                return clonedFiber;
            }

            for (const [source, clone] of pairs) {
                const { fiberKeys, propsKeys, otherKeys } = reactKeysForNode(source);

                for (const key of fiberKeys) {
                    try {
                        clone[key] = cloneFiberChain(source[key]);
                        fiberAssignments++;
                    } catch (error) {
                        warn(tLog('fiberGraftFailed'), key, error);
                    }
                }

                for (const key of propsKeys) {
                    try {
                        clone[key] = source[key];
                        propsAssignments++;
                    } catch (error) {
                        warn(tLog('propsGraftFailed'), key, error);
                    }
                }

                for (const key of otherKeys) {
                    if (key.startsWith('__reactContainer$')) continue;
                    try { clone[key] = source[key]; } catch (_) {}
                }
            }

            cloneRoot.setAttribute('data-tm-react-grafted', 'true');
            return { fiberAssignments, propsAssignments, clonedFibers: fiberMap.size };
        }
    });

    function findMountedSourceSlot(track, item, activeOnly = false) {
        let candidates;
        if (activeOnly && sourceState?.scroller) {
            candidates = currentPageSlots(sourceState.scroller, track);
        } else {
            candidates = netflixDom.filledSlots(track);
        }

        return candidates.find(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            if (!card) return false;
            const href = card.href || card.getAttribute('href') || '';
            if (href === item.href) return true;
            const id = videoIdFromHref(href);
            return item.videoId && id === item.videoId;
        }) || null;
    }

    function findActiveSourceSlot(item) {
        ensureLiveNativeBinding('hover-source-direct');
        if (!sourceState?.track?.isConnected || !sourceState?.scroller?.isConnected) return null;
        return findMountedSourceSlot(sourceState.track, item, true);
    }

    async function waitForMountedSourceItem(item, timeout = HOVER_SOURCE_TIMEOUT_MS, activeOnly = true, sessionToken = null, token = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-source-wait');
        let track = sourceState?.track;
        const start = performance.now();
        let slot = null;
        while (performance.now() - start < timeout) {
            assertRouteSession(sessionToken);
            if (hoverPreparationCancelled(token)) return null;
            if (!track?.isConnected || sourceState?.track !== track) {
                ensureLiveNativeBinding('hover-source-wait-disconnected');
                track = sourceState?.track;
            }
            if (!track) return null;
            slot = findMountedSourceSlot(track, item, activeOnly);
            if (slot) return slot;
            await sleep(HOVER_SOURCE_INTERVAL_MS);
            assertRouteSession(sessionToken);
        }
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-source-wait-final');
        track = sourceState?.track;
        return track ? findMountedSourceSlot(track, item, activeOnly) : null;
    }

    function viewportPageSlots(scroller, track, columns = sourceState?.layout?.columns || 1) {
        return nativeCarousel.viewportSlots(scroller, track, columns);
    }

    async function resolveExpectedPageSourceItem(item, expectedPage = item.page, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
        ensureLiveNativeBinding('hover-expected-page-start');
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
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

    function nativePositionDeviation(item, slot) {
        if (!item || !slot || !sourceState?.items?.length) return null;
        const expectedIndexFromItems = sourceState.items.indexOf(item);
        const expectedIndex = Number.isSafeInteger(expectedIndexFromItems) && expectedIndexFromItems >= 0
            ? expectedIndexFromItems
            : item.logicalIndex;
        const actualIndex = nativeCarousel.indexReading(slot).value;
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

    function rejectLargeNativePositionDeviation(item, slot, expectedPage, visibleIds = []) {
        const deviation = nativePositionDeviation(item, slot);
        if (!deviation || deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) return false;
        const actualVideoId = videoIdFromHref(slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || '');
        const diagnostic = {
            item: itemSummary(item),
            expectedPage,
            expectedIndex: deviation.expectedIndex,
            actualIndex: deviation.actualIndex,
            delta: deviation.delta,
            threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
            source: slotDescriptor(slot)
        };
        warn('Native My List position deviates beyond order-mismatch threshold', diagnostic);
        showOrderMismatchDialog(
            item,
            expectedPage,
            [...new Set([...visibleIds, actualVideoId].filter(Boolean))]
        );
        return true;
    }

    async function refreshStaleSourceOnPreferredPage(item, preferredPage = item.page, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        const rebound = ensureLiveNativeBinding('hover-stale-refresh-start');
        let section = rebound?.section || sourceState?.section;
        let scroller = rebound?.scroller || sourceState?.scroller;
        let track = rebound?.track || sourceState?.track;
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;

        const total = pageCount(section);
        if (total <= 0) return null;
        await goToPage(section, scroller, preferredPage, token, sessionToken, true);
        if (token !== null && token !== hoverToken) return null;

        let slot = findMountedSourceSlot(track, item, true);
        if (slot) return { slot, page: selectedPage(section), refreshed: false };

        // A My List delta can leave the preferred Hawkins page temporarily empty
        // even though its logical page number is already selected. Nudge the ring by
        // one page and return immediately; this is enough to make React commit the
        // new virtual itemIndex set without scanning the whole carousel.
        if (total > 1 && selectedPage(section) === preferredPage) {
            const from = selectedPage(section);
            const moved = await moveOnePage(section, scroller, 1, token, sessionToken);
            if (token !== null && token !== hoverToken) return null;
            if (moved !== from) {
                await moveOnePage(section, scroller, -1, token, sessionToken);
                if (token !== null && token !== hoverToken) return null;
            }
        }

        const live = ensureLiveNativeBinding('hover-stale-refresh-after-pulse');
        section = live?.section || sourceState?.section;
        scroller = live?.scroller || sourceState?.scroller;
        track = live?.track || sourceState?.track;
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;

        await goToPage(section, scroller, preferredPage, token, sessionToken, true);
        if (token !== null && token !== hoverToken) return null;
        slot = await waitForMountedSourceItem(item, 700, true, sessionToken, token);
        if (token !== null && token !== hoverToken) return null;
        if (!slot) return null;

        trace(() => ['Hover stale logical page refreshed without full carousel scan', {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            source: slotDescriptor(slot)
        }]);
        return { slot, page: selectedPage(section), refreshed: true };
    }

    async function locateActiveSourceItem(item, preferredPage = item.page, token = null, sessionToken = null, repairLogicalMapping = true, maxRadius = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        ensureLiveNativeBinding('hover-locate-start');
        let { section, scroller, track } = sourceState || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;
        const total = pageCount(section);
        const tried = new Set();
        const order = [];

        const push = p => {
            if (p < 0 || p >= total || tried.has(p)) return;
            tried.add(p);
            order.push(p);
        };

        push(preferredPage);
        const radiusLimit = Number.isFinite(maxRadius)
            ? Math.min(Math.max(0, Math.floor(maxRadius)), Math.max(0, total - 1))
            : Math.max(0, total - 1);
        for (let delta = 1; delta <= radiusLimit; delta++) {
            push(preferredPage + delta);
            push(preferredPage - delta);
        }

        log(tLog('hoverSourceSearchStarted'), {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            pages: total,
            order
        });

        for (const page of order) {
            assertRouteSession(sessionToken);
            if (hoverPreparationCancelled(token)) return null;
            const rebound = ensureLiveNativeBinding('hover-locate-page');
            if (rebound?.section && rebound?.scroller && rebound?.track) {
                section = rebound.section;
                scroller = rebound.scroller;
                track = rebound.track;
            }
            if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) return null;
            const beforeSig = visibleSignature(currentPageSlots(scroller, track));
            log(tLog('hoverSourceSearchPage'), {
                item: itemSummary(item),
                page,
                selectedBefore: selectedPage(section)
            });

            await goToPage(section, scroller, page, token, sessionToken, true);
            if (token !== null && token !== hoverToken) {
                log(tLog('hoverSourceSearchCancelled'), { reason: 'token-changed-after-page-move', token, hoverToken });
                return null;
            }

            let slot = await waitForMountedSourceItem(
                item,
                page === preferredPage ? HOVER_SOURCE_TIMEOUT_MS : 280,
                true,
                sessionToken,
                token
            );
            if (token !== null && token !== hoverToken) {
                log(tLog('hoverSourceSearchCancelled'), { reason: 'token-changed-after-mount-wait', token, hoverToken });
                return null;
            }

            if (!slot) {
                await waitStableCurrentPage(scroller, track, {
                    previousSignature: beforeSig,
                    minElapsed: 120,
                    timeout: 520,
                    sessionToken,
                    hoverToken: token
                });
                if (hoverPreparationCancelled(token)) return null;
                slot = findMountedSourceSlot(track, item, true);
            }

            if (slot) {
                const actual = selectedPage(section);
                const runtime = getCarouselDomRuntime(section);
                const visibleSlots = viewportPageSlots(scroller, track, Math.max(1, sourceState?.layout?.columns || 1));
                const signature = visibleSignature(visibleSlots);
                if (repairLogicalMapping && runtime?.profile?.pageMode === 'logical' && signature) {
                    registerLogicalPageSignature(section, signature, actual);
                }
                if (repairLogicalMapping) {
                    for (const visibleSlot of visibleSlots) {
                        const visibleItem = findItemForSourceSlot(visibleSlot);
                        if (!visibleItem) continue;
                        const oldPage = visibleItem.page;
                        if (oldPage === actual) continue;
                        visibleItem.page = actual;
                        const visibleClone = findGridClone(visibleItem);
                        if (visibleClone) visibleClone.setAttribute('data-tm-item-page', String(actual));
                        log(tLog('itemPageMappingCorrected'), {
                            item: itemSummary(visibleItem),
                            oldPage,
                            actualPage: actual,
                            reason: 'logical-visible-page-repair'
                        });
                    }
                }
                trace(() => [tLog('hoverSourceFound'), {
                    item: itemSummary(item),
                    actualPage: actual,
                    source: slotDescriptor(slot)
                }]);
                return { slot, page: actual };
            }
        }

        warn(tLog('hoverSourceSearchFailed'), {
            item: itemSummary(item),
            preferredPage,
            selectedPage: selectedPage(section),
            pages: total
        });
        return null;
    }

    function copyItemAttributes(target, item, index = null) {
        if (index !== null) target.setAttribute('data-tm-item-order', String(index));
        target.setAttribute('data-tm-item-page', String(item.page));
        target.setAttribute('data-tm-item-video-id', item.videoId || '');
        target.__tmMyListItem = item;
    }

    function findGridClone(item) {
        return sourceState?.cloneMap?.get(itemKey(item)) || null;
    }

    function setGridClone(item, clone) {
        if (!sourceState?.cloneMap) return;
        const previous = findGridClone(item);
        if (previous && previous !== clone) releaseGridReact(previous);
        sourceState.cloneMap.set(itemKey(item), clone);
        if (sourceState.watchStatus) {
            syncManualViewingCard(sourceState, clone, item, effectiveViewingStatus(sourceState.watchStatus, String(item.videoId)));
            const entry = sourceState.watchStatus.groupIndex?.entries.get(String(item.videoId));
            if (entry) entry.clone = clone;
        }
        if (clone?.getAttribute('data-tm-react-grafted') === 'true') graftedGridClones.add(clone);
    }

    function findItemForSourceSlot(slot) {
        const card = slot?.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card || !sourceState?.itemMap) return null;
        return sourceState.itemMap.get(itemKeyFromCard(card)) || null;
    }

    function releaseGridReact(clone) {
        if (!clone || !graftedGridClones.delete(clone)) return;
        netflixReactHover.clearClone(clone);
        clone.removeAttribute('data-tm-hover-ready');
        clone.removeAttribute('data-tm-backed-page');
        clone.removeAttribute('data-tm-react-grafted');
    }

    function invalidateGridReact(except = null) {
        for (const clone of graftedGridClones) {
            if (clone !== except || !clone.isConnected) releaseGridReact(clone);
        }
    }

    function restoreGeometryProxy() {
        const proxy = activeGeometryProxy;
        if (!proxy) return;
        let failures = 0;

        for (const entry of proxy.entries) {
            for (const method of ['getBoundingClientRect', 'getClientRects']) {
                const descriptor = entry.descriptors[method];
                try {
                    if (descriptor) {
                        Object.defineProperty(entry.source, method, descriptor);
                    } else {
                        if (!delete entry.source[method]) failures++;
                    }
                } catch (_) { failures++; }
            }
        }

        proxy.sourceSlot.removeAttribute('data-tm-source-proxied');
        activeGeometryProxy = null;
        performanceDiagnostics.nativeRecovery.alignmentRestores++;
        if (failures) {
            performanceDiagnostics.nativeRecovery.alignmentRestoreFailures += failures;
            warn(tLog('sourceAlignmentRestoreFailed'), { methods: failures, nodes: proxy.entries.length });
        }
    }

    function clearSourceAlignment(slot = activeSourceSlot, reason = 'source-release', relatedTarget = null) {
        releaseNativeHover(reason, relatedTarget);
        invalidateNativeReadScope();
        restoreGeometryProxy();
        if (slot?.hasAttribute?.('data-tm-source-aligned')) {
            // Clean up transforms left by legacy 2.1 when updating the script without a full page reload.
            slot.style.removeProperty('transform');
            slot.style.removeProperty('transform-origin');
            slot.style.removeProperty('z-index');
            slot.removeAttribute('data-tm-source-aligned');
        }
        if (!slot || slot === activeSourceSlot) activeSourceSlot = null;
    }

    function makeClientRectList(rect) {
        const list = [rect];
        list.item = index => list[index] || null;
        return list;
    }

    function releaseNativeHover(reason = 'source-release', relatedTarget = null) {
        const owner = activeNativeHover;
        if (!owner) return;
        // Clear ownership first: native exit handlers can synchronously cause another cleanup.
        activeNativeHover = null;
        finishNativePreviewDiagnostic(owner, { result: 'released-before-check', reason });
        clearNativePreviewTransfer(owner, reason);
        const { counters, timing, card, coordinates } = owner;
        const started = performance.now();
        counters.lastExitReason = reason;
        try {
            if (!nativeHoverSourceMatches(owner)) {
                counters.exitSkipped++;
                return;
            }
            // React derives leave events from bubbling out events. Send them while
            // the source still has grid geometry, before removing its coordinate proxy.
            const common = { ...coordinates, relatedTarget };
            let dispatched = false;
            if (typeof PointerEvent === 'function') {
                try {
                    card.dispatchEvent(new PointerEvent('pointerout', { ...common,
                        pointerId: 1, pointerType: 'mouse', isPrimary: true }));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            }
            if (nativeHoverSourceMatches(owner) && activeNativeHover === null) {
                try {
                    card.dispatchEvent(new MouseEvent('mouseout', common));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            } else counters.exitSkipped++;
            if (dispatched) {
                counters.exitsDispatched++;
                if (reason === 'scroll') counters.scrollExits++;
            }
        } catch (_) { counters.exitFailed++; }
        finally { recordHoverTiming(timing, 'exit', started); }
    }

    function nativeHoverSourceMatches(owner) {
        return owner.card.isConnected && owner.sourceSlot.isConnected && Boolean(owner.videoId) &&
            owner.sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) === owner.card &&
            videoIdFromHref(owner.card.href || owner.card.getAttribute('href') || '') === owner.videoId;
    }

    function finishNativePreviewDiagnostic(owner, details) {
        const observation = owner?.previewDiagnostic;
        if (!observation || observation.done) return;
        observation.done = true;
        // Clear retained DOM and timer ownership before logging or native exit.
        const timer = observation.timer;
        observation.timer = null;
        observation.clone = null;
        try {
            if (timer !== null) clearTimeout(timer);
            const counters = observation.counters;
            if (performanceDiagnostics.hoverPreview !== counters) return;
            counters.completed++;
            counters.lastResult = details.result;
            const field = { 'matching-preview-transfer': 'matchedTransfers', 'matching-preview-at-pointer': 'matchedAtPointer',
                'matching-preview-elsewhere': 'matchedElsewhere', 'no-preview-root-found': 'noPreviewRoot',
                'preview-roots-unverified': 'unverifiedRoots', 'released-before-check': 'earlyRelease',
                'owner-invalid': 'invalidOwner', hidden: 'hidden', 'probe-failed': 'failed' }[details.result];
            if (field) counters[field]++;
            log(tLog('hoverPreviewPresence'), { seq: observation.seq, token: owner.token,
                sinceReplayMs: Math.round(performance.now() - owner.replayedAt), ...details });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }

    function inspectNativePreviewDiagnostic(owner) {
        const observation = owner?.previewDiagnostic;
        if (!observation || observation.done) return;
        const clone = observation.clone;
        const counters = observation.counters;
        let checkStarted = null;
        try {
            if (performanceDiagnostics.hoverPreview !== counters || activeNativeHover !== owner ||
                owner.token !== hoverToken || !isRouteSessionActive(owner.sessionToken) || activeClone !== clone ||
                activeVideoId !== owner.videoId || !gridOwnsClone(clone, sourceState?.grid) || !nativeHoverSourceMatches(owner)) {
                finishNativePreviewDiagnostic(owner, { result: 'owner-invalid' });
                return;
            }
            if (document.visibilityState === 'hidden') {
                finishNativePreviewDiagnostic(owner, { result: 'hidden' });
                return;
            }
            counters.checks++;
            checkStarted = performance.now();
            const physicalKnown = Number.isFinite(lastPointerX) && Number.isFinite(lastPointerY) &&
                lastPointerX !== -1 && lastPointerY !== -1;
            const x = physicalKnown ? lastPointerX : owner.coordinates.clientX;
            const y = physicalKnown ? lastPointerY : owner.coordinates.clientY;
            let hit = null;
            let pointerTarget = 'unavailable';
            if (Number.isFinite(x) && Number.isFinite(y) && typeof document.elementFromPoint === 'function') {
                counters.pointerChecks++;
                hit = document.elementFromPoint(x, y);
                if (gridCloneFromPointerEvent({ target: hit }, sourceState.grid) === clone) pointerTarget = 'same-card';
                else if (gridCloneFromPointerEvent({ target: hit }, sourceState.grid, true) === clone) pointerTarget = 'viewing-control';
                else if (hit && !sourceState.grid.contains(hit) && !sourceState.scroller?.contains(hit) &&
                    findNativeHoverPreview(hit, owner.videoId).root) pointerTarget = 'matching-preview';
                else pointerTarget = hit ? 'elsewhere' : 'no-hit';
            }
            const details = { pointerTarget, physicalKnown, targetHovered: clone.matches(':hover'), rootsExamined: 0, truncated: false };
            if (pointerTarget === 'matching-preview') {
                finishNativePreviewDiagnostic(owner, { result: 'matching-preview-at-pointer', ...details });
                return;
            }
            // Only an unconfirmed replay reaches this single bounded search.
            // A connected matching root is presence evidence, not a visibility or
            // paint measurement; it may be hidden or open elsewhere on the page.
            counters.rootSearches++;
            const roots = document.querySelectorAll('.previewModal--wrapper, .bob-container, .previewModal--container, .bob-card');
            const limit = Math.min(roots.length, HOVER_PREVIEW_DIAGNOSTIC_LIMITS.roots);
            details.truncated = roots.length > limit;
            for (let index = 0; index < limit; index++) {
                details.rootsExamined++;
                if (sourceState.grid.contains(roots[index]) || sourceState.scroller?.contains(roots[index])) continue;
                if (findNativeHoverPreview(roots[index], owner.videoId).root) {
                    finishNativePreviewDiagnostic(owner, { result: 'matching-preview-elsewhere', ...details });
                    return;
                }
            }
            finishNativePreviewDiagnostic(owner, { result: roots.length ? 'preview-roots-unverified' : 'no-preview-root-found', ...details });
        } catch (_) { finishNativePreviewDiagnostic(owner, { result: 'probe-failed' }); }
        finally {
            if (checkStarted !== null && performanceDiagnostics.hoverPreview === counters) {
                const elapsed = Math.max(0, Math.round((performance.now() - checkStarted) * 10) / 10);
                counters.checkTotalMs = Math.round((counters.checkTotalMs + elapsed) * 10) / 10;
                counters.checkMaxMs = Math.max(counters.checkMaxMs, elapsed);
            }
        }
    }

    function scheduleNativePreviewDiagnostic(owner, clone) {
        if (!owner || activeNativeHover !== owner || owner.previewDiagnostic) return;
        const counters = performanceDiagnostics.hoverPreview;
        if (counters.scheduled >= HOVER_PREVIEW_DIAGNOSTIC_LIMITS.routeReplays) {
            counters.skippedAtLimit++;
            return;
        }
        owner.previewDiagnostic = { counters, clone, timer: null, done: false, seq: ++counters.scheduled };
        try {
            if (document.visibilityState === 'hidden') {
                finishNativePreviewDiagnostic(owner, { result: 'hidden' });
            } else if (owner.previewRoot) {
                finishNativePreviewDiagnostic(owner, { result: 'matching-preview-transfer' });
            } else {
                owner.previewDiagnostic.timer = setTimeout(() => inspectNativePreviewDiagnostic(owner), HOVER_PREVIEW_DIAGNOSTIC_LIMITS.delayMs);
            }
        } catch (_) { finishNativePreviewDiagnostic(owner, { result: 'probe-failed' }); }
    }

    function nativePreviewNodeVideoId(node) {
        const raw = node.getAttribute('data-ui-tracking-context') || '';
        if (raw && raw.length <= 4096) {
            const tracking = decodeTrackingContext(node);
            const direct = tracking?.video_id ?? tracking?.videoId;
            if ((typeof direct === 'string' || typeof direct === 'number') && /^\d+$/.test(String(direct))) return String(direct);
            const unified = typeof tracking?.unifiedEntityId === 'string' ? tracking.unifiedEntityId.match(/^Video:(\d+)$/i) : null;
            if (unified) return unified[1];
        }
        const href = node.href || node.getAttribute('href') || '';
        // A movie's Play link can identify its title. For series an episode ID
        // alone is insufficient; a series detail/tracking reference must match.
        return videoIdFromHref(href) || (/\/watch\/(\d+)(?:[/?#]|$)/.exec(href)?.[1] || '');
    }

    function findNativeHoverPreview(target, videoId) {
        if (!(target instanceof Element)) return { root: null, reason: 'not-preview' };
        // Prefer the outer wrapper so movement among image and controls stays inside.
        const root = target.closest('.previewModal--wrapper, .bob-container') ||
            target.closest('.previewModal--container, .bob-card');
        if (!root?.isConnected) return { root: null, reason: 'not-preview' };
        let node = target;
        for (let index = 0; node && index < 8; index++, node = node.parentElement) {
            if (nativePreviewNodeVideoId(node) === videoId) return { root, reason: 'matching-preview-title' };
            if (node === root) break;
        }
        const references = root.querySelectorAll('a[href], [data-ui-tracking-context]');
        const limit = Math.min(references.length, 16);
        for (let index = 0; index < limit; index++) {
            if (nativePreviewNodeVideoId(references[index]) === videoId) {
                return { root, reason: 'matching-preview-title' };
            }
        }
        return { root: null, reason: limit < references.length ? 'preview-identity-limit' : 'preview-identity-unverified' };
    }

    function retainNativeHoverForPreview(clone, relatedTarget, event) {
        const owner = activeNativeHover;
        if (!owner || activeClone !== clone || event?.type !== 'pointerout' || !event.isTrusted ||
            owner.token !== hoverToken || !isRouteSessionActive(owner.sessionToken) || !gridOwnsClone(clone, sourceState?.grid)) return false;
        try {
            if (!nativeHoverSourceMatches(owner)) return false;
            const candidate = findNativeHoverPreview(relatedTarget, owner.videoId);
            if (!candidate.root) {
                if (candidate.reason !== 'not-preview') {
                    owner.counters.previewRejected++;
                    log(tLog('hoverPreviewTransferRejected'), { reason: candidate.reason });
                }
                return false;
            }
            if (owner.previewRoot === candidate.root) return true;
            owner.previewRoot = candidate.root;
            owner.previewClone = clone;
            owner.previewEnteredAt = performance.now();
            owner.counters.previewTransfers++;
            owner.counters.lastPreviewReason = candidate.reason;
            finishNativePreviewDiagnostic(owner, { result: 'matching-preview-transfer' });
            try { popupInspection.capturePreview(candidate.root, owner.sessionToken); }
            catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
            try {
                log(tLog('hoverPreviewTransfer'), { reason: candidate.reason,
                    sinceReplayMs: Math.round(performance.now() - owner.replayedAt) });
            } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
            return true;
        } catch (_) {
            owner.counters.previewRejected++;
            try { log(tLog('hoverPreviewTransferRejected'), { reason: 'preview-check-failed' }); } catch (_) {}
            return false;
        }
    }

    function clearNativePreviewTransfer(owner, reason) {
        if (!owner?.previewRoot) return;
        owner.previewRoot = null;
        owner.previewClone = null;
        try {
            if (reason === 'preview-return') owner.counters.previewReturns++;
            else owner.counters.previewReleases++;
            owner.counters.lastPreviewReason = reason;
            recordHoverTiming(owner.timing, 'preview', owner.previewEnteredAt);
            log(tLog('hoverPreviewReleased'), { reason, heldMs: Math.round(performance.now() - owner.previewEnteredAt) });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }

    function releaseNativePreview(owner, reason, relatedTarget = null) {
        if (activeNativeHover !== owner || !owner?.previewRoot) return;
        const clone = owner.previewClone;
        const releaseToken = advanceHoverToken('preview');
        clearSourceAlignment(undefined, reason, relatedTarget);
        // Native exit callbacks may synchronously establish another hover owner.
        if (hoverToken === releaseToken && activeClone === clone) {
            activeClone = null;
            activeVideoId = null;
            activePage = null;
        }
    }

    function nativePreviewOwnerMatches(owner) {
        try {
            return activeNativeHover === owner && activeClone === owner.previewClone && activeVideoId === owner.videoId &&
                Boolean(owner.previewClone?.isConnected) && gridOwnsClone(owner.previewClone, sourceState?.grid) &&
                isRouteSessionActive(owner.sessionToken) && owner.token === hoverToken && nativeHoverSourceMatches(owner);
        } catch (_) { return false; }
    }

    function handleTargetPreviewPointerOut(event) {
        const owner = activeNativeHover;
        const root = owner?.previewRoot;
        if (!root || !event.isTrusted || !root.contains(event.target) ||
            (event.relatedTarget && root.contains(event.relatedTarget))) return;
        const clone = owner.previewClone;
        const valid = root.isConnected && nativePreviewOwnerMatches(owner);
        if (valid && event.relatedTarget &&
            gridCloneFromPointerEvent({ target: event.relatedTarget }, sourceState.grid) === clone) {
            clearNativePreviewTransfer(owner, 'preview-return');
            return;
        }
        releaseNativePreview(owner, valid ? 'preview-leave' : 'preview-owner-invalid', event.relatedTarget);
    }

    function alignSourceSlotToClone(sourceSlot, clone) {
        if (!sourceSlot?.isConnected || !clone?.isConnected) return false;

        const sourceItem = findItemForSourceSlot(sourceSlot);
        if (!sourceItem || findActiveSourceSlot(sourceItem) !== sourceSlot) return false;

        clearSourceAlignment();

        const { pairs } = pairDomTrees(sourceSlot, clone);
        const entries = [];
        for (const [source, target] of pairs) {
            if (!(source instanceof Element) || !(target instanceof Element)) continue;

            const descriptors = {
                getBoundingClientRect: Object.getOwnPropertyDescriptor(source, 'getBoundingClientRect') || null,
                getClientRects: Object.getOwnPropertyDescriptor(source, 'getClientRects') || null
            };

            try {
                Object.defineProperty(source, 'getBoundingClientRect', {
                    configurable: true,
                    value: () => target.getBoundingClientRect()
                });
                Object.defineProperty(source, 'getClientRects', {
                    configurable: true,
                    value: () => makeClientRectList(target.getBoundingClientRect())
                });
                entries.push({ source, descriptors });
            } catch (_) {
                for (const method of ['getBoundingClientRect', 'getClientRects']) {
                    try {
                        if (descriptors[method]) Object.defineProperty(source, method, descriptors[method]);
                        else delete source[method];
                    } catch (_) {}
                }
            }
        }

        if (!entries.length) return false;

        sourceSlot.setAttribute('data-tm-source-proxied', 'true');
        activeGeometryProxy = { sourceSlot, clone, entries };
        activeSourceSlot = sourceSlot;
        return true;
    }

    function replayHoverOnNativeSource(sourceSlot, triggerEvent) {
        if (!sourceSlot?.isConnected) return false;
        const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) || sourceSlot;
        const rect = card.getBoundingClientRect();
        const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        const currentPointer = lastPointerX !== -1 && lastPointerY !== -1 && inside(lastPointerX, lastPointerY);
        const originalPointer = inside(triggerEvent?.clientX, triggerEvent?.clientY);
        const x = currentPointer ? lastPointerX : originalPointer ? triggerEvent.clientX : rect.left + rect.width / 2;
        const y = currentPointer ? lastPointerY : originalPointer ? triggerEvent.clientY : rect.top + rect.height / 2;

        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            screenX: Number.isFinite(triggerEvent?.screenX) && Number.isFinite(triggerEvent?.clientX)
                ? triggerEvent.screenX + x - triggerEvent.clientX : x,
            screenY: Number.isFinite(triggerEvent?.screenY) && Number.isFinite(triggerEvent?.clientY)
                ? triggerEvent.screenY + y - triggerEvent.clientY : y,
            relatedTarget: null
        };

        const owner = { card, sourceSlot, coordinates: common, token: hoverToken, sessionToken: sessionScope.token,
            videoId: videoIdFromHref(card.href || card.getAttribute('href') || ''),
            counters: performanceDiagnostics.hoverLifecycle, timing: performanceDiagnostics.hoverTiming,
            replayedAt: performance.now() };
        releaseNativeHover('replaced');
        activeNativeHover = owner;
        const stillActive = () => activeNativeHover === owner && !hoverPreparationCancelled(owner.token) &&
            isRouteSessionActive(owner.sessionToken) && nativeHoverSourceMatches(owner);
        try {
            card.dispatchEvent(new PointerEvent('pointerover', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            if (!stillActive()) return false;
            card.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mouseover', common));
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mousemove', common));
        return stillActive();
    }

    function releaseFailedGridHover(clone, token) {
        if (!clone || token !== hoverToken || activeClone !== clone) return;
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
    }

    function scheduleNativeHoverReplay(sourceSlot, item, clone, triggerEvent, actualPage, reason,
        token = hoverToken, sessionToken = sessionScope.token) {
        const generation = clone?.__tmHoverActivationGeneration;
        const counters = performanceDiagnostics.hoverLifecycle;
        const timing = performanceDiagnostics.hoverTiming;
        return new Promise(resolve => requestAnimationFrame(() => {
            const finish = success => {
                if (!success) releaseFailedGridHover(clone, token);
                resolve(success);
            };
            try {
                if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    !gridHoverTargetActive(clone, generation, triggerEvent) ||
                    activeClone !== clone || activeVideoId !== item.videoId) {
                    counters.replayCancelled++;
                    if (performanceDiagnostics.hoverLifecycle === counters) {
                        performanceDiagnostics.hoverInteraction.replayGuardRejected++;
                        log(tLog('hoverReplayGuardRejected'), hoverReplayGuardDiagnostic(clone, generation, token, sessionToken, item));
                    }
                    return finish(false);
                }
                counters.replayAttempts++;
                if (!sourceSlot?.isConnected) { counters.replayFailed++; return finish(false); }

                const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const sourceVideoId = videoIdFromHref(card?.href || card?.getAttribute?.('href') || '');
                // Native visibility/page reads need original source geometry, not
                // the grid rectangles installed for Netflix's popup placement.
                clearSourceAlignment();
                const alignmentStarted = performance.now();
                let failureReason;
                try {
                    failureReason = withNativeReadScope(() => {
                        if (!sourceVideoId || sourceVideoId !== item.videoId) return 'source-video-id-mismatch';
                        if (findActiveSourceSlot(item) !== sourceSlot) return 'source-no-longer-active';
                        return alignSourceSlotToClone(sourceSlot, clone) ? '' : 'source-alignment-failed';
                    });
                } finally { recordHoverTiming(timing, 'alignment', alignmentStarted); }
                if (failureReason) {
                    counters.replayFailed++;
                    warn(tLog('nativeHoverReplayCancelled'), {
                        reason: failureReason,
                        targetVideoId: item.videoId,
                        sourceVideoId,
                        source: slotDescriptor(sourceSlot)
                    });
                    return finish(false);
                }

                const replayStarted = performance.now();
                let replayed;
                try { replayed = replayHoverOnNativeSource(sourceSlot, triggerEvent); }
                finally { recordHoverTiming(timing, 'replay', replayStarted); }
                if (replayed) {
                    counters.replaysDispatched++;
                    startHoverFrameDiagnostics('replay');
                    scheduleNativePreviewDiagnostic(activeNativeHover, clone);
                } else counters.replayCancelled++;
                if (replayed) trace(() => [tLog('nativeHoverReplayedFromLiveSource'), {
                    item: itemSummary(item),
                    actualPage,
                    reason,
                    triggerEvent: triggerEvent?.type || '',
                    source: slotDescriptor(sourceSlot)
                }]);
                finish(Boolean(replayed));
            } catch (error) {
                counters.replayFailed++;
                warn(tLog('nativeHoverReplayCancelled'), { reason: 'replay-failed', item: itemSummary(item), error });
                finish(false);
            }
        }));
    }

    function makeLiveClone(sourceSlot, item, oldClone, actualPage) {
        // Keep the legacy 1.2.0 order: clone the live source, graft React data, then insert into the DOM.
        const fresh = sourceSlot.cloneNode(true);
        const stats = netflixReactHover.graftTreeToClone(sourceSlot, fresh);
        normalizeClone(fresh);

        const order = oldClone?.getAttribute('data-tm-item-order');
        copyItemAttributes(fresh, item, order === null || order === undefined ? null : Number(order));
        fresh.setAttribute('data-tm-hover-ready', String(Boolean(stats?.fiberAssignments || stats?.propsAssignments)));
        fresh.setAttribute('data-tm-backed-page', String(actualPage));
        fresh.__tmHoverActivationGeneration = oldClone?.__tmHoverActivationGeneration;
        if (oldClone?.getAttribute('data-tm-type-hidden') === 'true') fresh.setAttribute('data-tm-type-hidden', 'true');
        else fresh.removeAttribute('data-tm-type-hidden');
        if (oldClone?.getAttribute('data-tm-preparing') === 'true' &&
            oldClone.getAttribute('data-tm-hover-token') === String(hoverToken)) {
            fresh.setAttribute('data-tm-preparing', 'true');
            fresh.setAttribute('data-tm-hover-token', String(hoverToken));
            fresh.__tmHoverReplacementToken = hoverToken;
        }
        ensureGridHoverBehavior(sourceState.grid);
        associateGridHoverItem(item, fresh);
        return { fresh, stats };
    }

    async function prepareMountedPage(page, targetItem = null, triggerEvent = null, token = null, sessionToken = null) {
        assertRouteSession(sessionToken);
        if (hoverPreparationCancelled(token)) return null;
        performanceDiagnostics.hoverPreparation.calls++;
        const hoverTiming = performanceDiagnostics.hoverTiming;
        ensureLiveNativeBinding('hover-prepare-start');
        const { section, scroller, track } = sourceState || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'native-binding-unavailable',
                targetItem: itemSummary(targetItem),
                requestedPage: page
            });
            return null;
        }
        const beforeSignature = targetItem ? '' : visibleSignature(currentPageSlots(scroller, track));
        const started = performance.now();

        log(tLog('nativePagePreparationStarted'), {
            requestedPage: page,
            targetItem: itemSummary(targetItem),
            triggerEvent: triggerEvent?.type || '',
            token,
            hoverToken
        });

        let targetSourceSlot = null;
        let resolvedPageSlots = null;
        let actualPage = page;
        let staleSourceRecovery = false;

        if (targetItem) {
            let located = await resolveExpectedPageSourceItem(targetItem, page, token, sessionToken);
            if (token !== null && token !== hoverToken) {
                log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-expected-page-check', token, hoverToken });
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
                if (token !== null && token !== hoverToken) {
                    log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-mismatch-retry', token, hoverToken });
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

            if (located?.status === 'found' && located.slot) {
                if (rejectLargeNativePositionDeviation(targetItem, located.slot, page)) return null;
                mutationSourceRecoveryPending = false;
                targetSourceSlot = located.slot;
                resolvedPageSlots = located.slots || null;
                actualPage = located.page;
            } else {
                const runtime = getCarouselDomRuntime(section);
                const staleLogicalMapping = runtime?.profile?.pageMode === 'logical' && runtime.pageMappingStale;
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
                    if (token !== null && token !== hoverToken) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-refresh', token, hoverToken });
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
                    if (token !== null && token !== hoverToken) {
                        log(tLog('nativePagePreparationCancelled'), { reason: 'token-changed-after-stale-page-search', token, hoverToken });
                        return null;
                    }
                    if (repaired?.slot) {
                        if (rejectLargeNativePositionDeviation(targetItem, repaired.slot, page, located?.visibleIds || [])) return null;
                        mutationSourceRecoveryPending = false;
                        staleSourceRecovery = true;
                        targetSourceSlot = repaired.slot;
                        actualPage = repaired.page;
                        const liveScroller = sourceState?.scroller || scroller;
                        const liveTrack = sourceState?.track || track;
                        resolvedPageSlots = viewportPageSlots(
                            liveScroller,
                            liveTrack,
                            Math.max(1, sourceState?.layout?.columns || 1)
                        );
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
            if (token !== null && token !== hoverToken) return null;
            await waitStableCurrentPage(scroller, track, {
                previousSignature: beforeSignature,
                minElapsed: 160,
                sessionToken,
                hoverToken: token
            });
            if (hoverPreparationCancelled(token)) return null;
            actualPage = selectedPage(section);
        }

        trace(() => [tLog('nativePagePreparationPositionResolved'), {
            requestedPage: page,
            actualPage,
            selectedPage: selectedPage(section),
            currentSlots: (resolvedPageSlots || currentPageSlots(scroller, track)).length,
            targetSource: slotDescriptor(targetSourceSlot)
        }]);

        invalidateGridReact();
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = actualPage;

        const slots = resolvedPageSlots || currentPageSlots(scroller, track);
        const runtime = getCarouselDomRuntime(section);
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const logicalPositions = logicalMode
            ? logicalSlotPositions(slots, sourceState?.items?.length || 0)
            : [];
        const wrappedTail = logicalMode
            ? wrappedTailLogicalPageInfo(logicalPositions, sourceState?.items?.length || 0, Math.max(1, sourceState?.layout?.columns || 1))
            : null;
        const wrappedTailBufferStart = wrappedTail && actualPage === wrappedTail.page
            ? wrappedTail.wrapIndex
            : -1;

        let freshTarget = null;
        let refreshedCount = 0;
        let fiberAssignments = 0;
        let propsAssignments = 0;
        let neighborsSkipped = 0;

        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            const sourceSlot = slots[slotIndex];
            performanceDiagnostics.hoverPreparation.slotsConsidered++;

            // A wrapped Hawkins tail can temporarily append page-0 cards after
            // totalCount-1 (for example 32,33,34,35,36,0). Those slots are ring
            // buffers, not members of the logical last page. Never re-page or graft
            // them into the legacy grid as if they belonged to actualPage.
            if (wrappedTailBufferStart >= 0 && slotIndex >= wrappedTailBufferStart) continue;

            const pageItem = findItemForSourceSlot(sourceSlot);
            if (!pageItem) continue;

            if (!staleSourceRecovery && pageItem.page !== actualPage) {
                pageItem.page = actualPage;
                const mappedClone = findGridClone(pageItem);
                if (mappedClone?.isConnected) mappedClone.setAttribute('data-tm-item-page', String(actualPage));
            }

            if (targetItem && itemKey(pageItem) !== itemKey(targetItem)) {
                neighborsSkipped++;
                performanceDiagnostics.hoverPreparation.neighborsSkipped++;
                continue;
            }

            const oldClone = findGridClone(pageItem);
            if (!oldClone?.isConnected) continue;

            const graftStarted = performance.now();
            let fresh, stats;
            try { ({ fresh, stats } = makeLiveClone(sourceSlot, pageItem, oldClone, actualPage)); }
            finally { recordHoverTiming(hoverTiming, 'graft', graftStarted); }
            refreshedCount++;
            performanceDiagnostics.hoverPreparation.clonesRebuilt++;
            fiberAssignments += stats?.fiberAssignments || 0;
            propsAssignments += stats?.propsAssignments || 0;
            fresh.setAttribute('data-tm-item-page', String(pageItem.page));
            fresh.setAttribute('data-tm-backed-page', String(actualPage));
            oldClone.replaceWith(fresh);
            setGridClone(pageItem, fresh);

            if (targetItem && itemKey(pageItem) === itemKey(targetItem)) {
                try {
                    fresh.__tmHoverReplacementHovered = fresh.matches(':hover');
                    if (!fresh.__tmHoverReplacementHovered) performanceDiagnostics.hoverInteraction.replacementNotHovered++;
                } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
                freshTarget = fresh;
                targetSourceSlot = sourceSlot;
            }
        }

        log(tLog('nativePageClonesUpdated'), {
            actualPage,
            refreshedCount,
            preparationScope: targetItem ? 'target-card' : 'mounted-page',
            slotsConsidered: slots.length,
            neighborsSkipped,
            fiberAssignments,
            propsAssignments,
            targetItem: itemSummary(targetItem),
            targetFound: Boolean(freshTarget && targetSourceSlot),
            targetHoveredAtInsertion: freshTarget?.__tmHoverReplacementHovered ?? null
        });

        if (targetItem && !freshTarget) {
            // Do not use off-screen slots from adjacent pages as hover sources.
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'target-not-in-current-page-slots',
                targetItem: itemSummary(targetItem),
                actualPage,
                slots: slots.map(slotDescriptor)
            });
            return null;
        }

        if (targetItem && freshTarget && targetSourceSlot) {
            // Align once, in the replay frame after source identity/visibility is revalidated.
            performanceDiagnostics.hoverLifecycle.duplicateAlignmentsAvoided++;
            activeVideoId = targetItem.videoId;
            activeClone = freshTarget;

            const replayed = await scheduleNativeHoverReplay(
                targetSourceSlot,
                targetItem,
                freshTarget,
                triggerEvent,
                actualPage,
                'prepared-page',
                token,
                sessionToken
            );
            if (!replayed) return null;
        }

        log(tLog('nativePagePreparationCompleted'), {
            requestedPage: page,
            actualPage,
            targetItem: itemSummary(targetItem),
            targetReady: Boolean(freshTarget),
            elapsedMs: Math.round(performance.now() - started)
        });
        return freshTarget;
    }

    async function activateClone(item, clone, triggerEvent = null, generation = clone?.__tmHoverActivationGeneration, intentDiagnostic = null) {
        if (!gridHoverTargetActive(clone, generation)) return;
        const seq = ++hoverSequence;
        const started = performance.now();
        const timing = performanceDiagnostics.hoverTiming;
        const group = clone.parentElement?.getAttribute('data-tm-watch-grid') === 'true' ? 'watched' : 'main';

        if (orderMismatchDialogOpen || orderMismatchReinitializing) {
            log(tLog('hoverCancelled'), {
                seq,
                reason: orderMismatchDialogOpen ? 'order-mismatch-dialog-open' : 'order-mismatch-reinitializing',
                item: itemSummary(item)
            });
            return;
        }

        if (responsiveRefreshPromise) {
            log(tLog('hoverWaitingResponsiveRefreshInProgress'), { seq, item: itemSummary(item) });
            try { await responsiveRefreshPromise; } catch (_) {}
            if (!gridHoverTargetActive(clone, generation)) return;
        }
        if (!clone?.isConnected) {
            warn(tLog('hoverCancelled'), { seq, reason: 'clone-disconnected', item: itemSummary(item) });
            return;
        }
        if (clone.getAttribute('data-tm-preparing') === 'true') {
            const preparingTokenText = clone.getAttribute('data-tm-hover-token');
            const preparingToken = preparingTokenText === null ? NaN : Number(preparingTokenText);
            if (Number.isFinite(preparingToken) && preparingToken !== hoverToken) {
                // The previous hover was already cancelled (typically by pointerleave),
                // but its async cleanup has not reached finally yet. Clear only that
                // stale marker so a new hover can start immediately; the old token will
                // make the previous async path self-cancel at its next checkpoint.
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            } else {
                log(tLog('hoverCancelled'), { seq, reason: 'already-preparing', item: itemSummary(item) });
                return;
            }
        }

        const token = advanceHoverToken('superseded');
        const sessionToken = sessionScope.token;
        startHoverFrameDiagnostics('preparation');
        clone.setAttribute('data-tm-hover-token', String(token));
        clone.setAttribute('data-tm-preparing', 'true');
        const diagnosticOwner = { seq, token, group, started, intent: intentDiagnostic,
            counters: performanceDiagnostics.hoverScroll };
        activeHoverPreparationDiagnostic = diagnosticOwner;
        let fresh = null;
        try {
            assertRouteSession(sessionToken);
            // One recovery attempt for this intent, including failed ready-source
            // replay. Follow the current card after preparation replaces its DOM.
            for (let attempt = 0; attempt < 2; attempt++) {
                if (attempt) await sleep(HOVER_RETRY_DELAY_MS);
                const current = attempt ? findGridClone(item) : clone;
                if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    orderMismatchDialogOpen || orderMismatchReinitializing ||
                    !gridHoverTargetActive(current, generation, triggerEvent) ||
                    current.getAttribute('data-tm-hover-token') !== String(token)) break;

                clearSourceAlignment();
                const { selected, backedPage, sourceSlot } = withNativeReadScope(() => {
                    if (!attempt && current.getAttribute('data-tm-hover-ready') === 'true') {
                        ensureLiveNativeBinding('hover-reuse');
                    }
                    const selected = selectedPage(sourceState.section);
                    const backedPage = Number(current.getAttribute('data-tm-backed-page'));
                    const sourceSlot = !attempt && current.getAttribute('data-tm-hover-ready') === 'true' &&
                        Number.isFinite(backedPage) && selected === backedPage ? findActiveSourceSlot(item) : null;
                    return { selected, backedPage, sourceSlot };
                });
                if (attempt) {
                    log('Retrying native page preparation after transient hydration', {
                        seq,
                        item: itemSummary(item),
                        token,
                        selectedPage: selected
                    });
                }

                let reused = false;
                if (!attempt && sourceSlot) {
                    performanceDiagnostics.hoverLifecycle.duplicateAlignmentsAvoided++;
                    reused = true;
                    activePage = selected;
                    activeVideoId = item.videoId;
                    activeClone = current;
                    log(tLog('hoverReusedImmediately'), {
                        seq,
                        group,
                        intent: intentDiagnostic,
                        item: itemSummary(item),
                        selectedPage: selected,
                        backedPage,
                        elapsedMs: Math.round(performance.now() - started)
                    });
                    const replayed = await scheduleNativeHoverReplay(
                        sourceSlot, item, current, triggerEvent, selected, 'immediate-reuse', token, sessionToken
                    );
                    fresh = replayed ? current : null;
                }
                if (!reused) {
                    log(tLog('hoverRequestedNativePagePreparation'), {
                        seq,
                        group,
                        intent: intentDiagnostic,
                        directPageDistance: Math.abs(selected - item.page),
                        item: itemSummary(item),
                        selectedPage: selected,
                        targetPage: item.page,
                        backedPage: Number.isFinite(backedPage) ? backedPage : null,
                        hoverReady: current.getAttribute('data-tm-hover-ready') === 'true',
                        token,
                        triggerEvent: triggerEvent?.type || ''
                    });
                    fresh = await prepareMountedPage(item.page, item, triggerEvent, token, sessionToken);
                }
                if (fresh || hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    orderMismatchDialogOpen || orderMismatchReinitializing) break;
            }
            if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken)) return;
            if (fresh) recordHoverTiming(timing, group === 'watched' ? 'watchedPreparation' : 'mainPreparation', started);
            log(tLog('hoverNativePagePreparationResult'), {
                seq,
                group,
                intent: intentDiagnostic,
                item: itemSummary(item),
                success: Boolean(fresh),
                replayDispatched: Boolean(fresh),
                activePage,
                activeVideoId,
                elapsedMs: Math.round(performance.now() - started)
            });
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('liveClonePreparationFailed'), { seq, item: itemSummary(item), error });
            }
        } finally {
            if (activeHoverPreparationDiagnostic === diagnosticOwner) activeHoverPreparationDiagnostic = null;
            if (!fresh) releaseFailedGridHover(activeClone, token);
            const current = findGridClone(item);
            if (current?.isConnected && current.getAttribute('data-tm-hover-token') === String(token)) {
                current.removeAttribute('data-tm-preparing');
                current.removeAttribute('data-tm-hover-token');
            }
            if (clone?.isConnected && clone.getAttribute('data-tm-hover-token') === String(token)) {
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            }
        }
    }

    function gridCloneFromPointerEvent(event, grid, includeViewingControls = false) {
        let node = event.target instanceof Element ? event.target : event.target?.parentElement;
        while (node && node !== grid) {
            if (!includeViewingControls && node.getAttribute('data-tm-viewing-actions') === 'true') return null;
            if (node.__tmMyListItem && gridOwnsClone(node, grid)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function gridHoverSuppressed() {
        return hoverNeedsPointerMove || performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS;
    }

    function gridHoverReplacementUnderPointer(clone, triggerEvent) {
        // Only a replacement in this still-current preparation can use hit testing.
        // Never infer hover merely from a saved rectangle or a nearby popup.
        if (clone.__tmHoverReplacementToken !== hoverToken ||
            clone.getAttribute('data-tm-hover-token') !== String(hoverToken) ||
            clone.getAttribute('data-tm-preparing') !== 'true') return false;
        const counters = performanceDiagnostics.hoverInteraction;
        counters.replacementPointerChecks++;
        const current = lastPointerX !== -1 && lastPointerY !== -1;
        const x = current ? lastPointerX : triggerEvent?.clientX;
        const y = current ? lastPointerY : triggerEvent?.clientY;
        try {
            if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document?.elementFromPoint !== 'function') {
                counters.replacementPointerUnavailable++;
                clone.__tmHoverReplacementPointerVerified = null;
                return false;
            }
            const target = document.elementFromPoint(x, y);
            const matches = Boolean(target && gridCloneFromPointerEvent({ target }, sourceState.grid) === clone);
            clone.__tmHoverReplacementPointerVerified = matches;
            if (matches) counters.replacementPointerAccepted++;
            else counters.replacementPointerRejected++;
            return matches;
        } catch (_) {
            counters.replacementPointerUnavailable++;
            clone.__tmHoverReplacementPointerVerified = null;
            return false;
        }
    }

    function gridHoverTargetActive(clone, generation, triggerEvent = null) {
        return !gridHoverSuppressed() && Boolean(sourceState?.grid?.isConnected) &&
            Boolean(clone?.isConnected) && gridOwnsClone(clone, sourceState.grid) &&
            !clone.__tmViewingControlHovered &&
            generation === clone.__tmHoverActivationGeneration &&
            (clone.matches(':hover') || gridHoverReplacementUnderPointer(clone, triggerEvent));
    }

    function cancelPendingGridHover(reason = 'other') {
        const clone = pendingGridHoverClone;
        const diagnostic = pendingGridHoverDiagnostic;
        pendingGridHoverClone = null;
        pendingGridHoverDiagnostic = null;
        if (!clone) return;
        performanceDiagnostics.hoverInteraction.intentsCancelled++;
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clearTimeout(clone.__tmHoverActivationTimer);
        clone.__tmHoverActivationTimer = null;
        try {
            if (diagnostic && performanceDiagnostics.hoverScroll === diagnostic.counters) {
                const counters = diagnostic.counters;
                const elapsed = Math.max(0, Math.round(performance.now() - diagnostic.started));
                counters.cancelledDwellTotalMs += elapsed;
                counters.cancelledDwellMaxMs = Math.max(counters.cancelledDwellMaxMs, elapsed);
                counters.lastIntentCancellationReason = recordHoverCancellation(counters, 'intent', reason);
            }
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }

    function handleGridClonePointerOver(event, clone, item, physicalMove = false) {
        if (orderMismatchDialogOpen || orderMismatchReinitializing) return;
        if (event.relatedTarget && clone.contains(event.relatedTarget)) return;
        if (!sourceState?.section) return;
        if (gridHoverSuppressed() && !physicalMove) {
            const counters = performanceDiagnostics.hoverScroll;
            if (hoverNeedsPointerMove) counters.boundarySuppressedMovement++;
            if (performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS) counters.boundarySuppressedQuiet++;
            return;
        }
        if (pendingGridHoverClone === clone || activeClone === clone) return;
        if (clone.getAttribute('data-tm-preparing') === 'true' &&
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) return;

        // All preparation, including ready-source reuse, goes through the dwell.
        // Physical intent received just after a scroll survives the quiet period.
        // Boundary events alone still cannot prepare a stationary scroll target.
        cancelPendingGridHover('superseded');
        const generation = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clone.__tmHoverActivationGeneration = generation;
        pendingGridHoverClone = clone;
        performanceDiagnostics.hoverInteraction.intentsQueued++;
        startHoverFrameDiagnostics('intent');
        const dwellStarted = performance.now();
        const timing = performanceDiagnostics.hoverTiming;
        const counters = performanceDiagnostics.hoverScroll;
        const quietRemaining = Math.max(0, HOVER_SCROLL_QUIET_MS - (dwellStarted - lastTargetScrollAt));
        const delay = Math.max(HOVER_ACTIVATION_DELAY_MS, quietRemaining);
        const diagnostic = { started: dwellStarted, counters, physicalMove,
            sinceScrollAtQueueMs: hoverScrollElapsed(dwellStarted), quietRemainingAtQueueMs: Math.round(quietRemaining),
            needsMovementAtQueue: hoverNeedsPointerMove, scheduledDwellMs: Math.round(delay) };
        pendingGridHoverDiagnostic = diagnostic;
        if (quietRemaining > 0) counters.intentsDuringQuiet++;
        if (hoverNeedsPointerMove) counters.intentsAwaitingMovement++;
        clone.__tmHoverActivationTimer = setTimeout(() => {
            recordHoverTiming(timing, 'dwell', dwellStarted);
            clone.__tmHoverActivationTimer = null;
            if (pendingGridHoverClone === clone) pendingGridHoverClone = null;
            if (pendingGridHoverDiagnostic === diagnostic) pendingGridHoverDiagnostic = null;
            if (physicalMove && sourceState?.grid?.isConnected && clone.isConnected &&
                gridOwnsClone(clone, sourceState.grid) && generation === clone.__tmHoverActivationGeneration &&
                clone.matches(':hover') && performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) {
                if (hoverNeedsPointerMove && performanceDiagnostics.hoverScroll === counters) counters.dwellRearms++;
                hoverNeedsPointerMove = false;
            }
            if (!gridHoverTargetActive(clone, generation)) {
                performanceDiagnostics.hoverInteraction.dwellRejected++;
                return;
            }
            performanceDiagnostics.hoverInteraction.dwellCompleted++;
            activateClone(item, clone, event, generation, hoverIntentDiagnosticSnapshot(diagnostic));
        }, delay);
    }

    function handleGridClonePointerLeave(clone, item, relatedTarget = null, event = null) {
        if (pendingGridHoverClone === clone || activeClone === clone ||
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) {
            recordGridHoverLeave(clone, relatedTarget, event);
        }
        if (retainNativeHoverForPreview(clone, relatedTarget, event)) return;
        const cancellationReason = clone.__tmViewingControlHovered ? 'controls' : 'pointer-leave';
        if (pendingGridHoverClone === clone) cancelPendingGridHover(cancellationReason);
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        if (clone.__tmHoverActivationTimer !== null && clone.__tmHoverActivationTimer !== undefined) {
            clearTimeout(clone.__tmHoverActivationTimer);
            clone.__tmHoverActivationTimer = null;
        }

        const cloneTokenText = clone.getAttribute('data-tm-hover-token');
        const cloneToken = cloneTokenText === null ? NaN : Number(cloneTokenText);
        if (Number.isFinite(cloneToken) && cloneToken === hoverToken) {
            advanceHoverToken(cancellationReason);
            clone.removeAttribute('data-tm-hover-token');
            clone.removeAttribute('data-tm-preparing');
            log(tLog('pendingHoverCancelledOnLeave'), {
                item: itemSummary(item),
                token: cloneToken,
                hoverToken
            });
        }
        if (activeClone !== clone) return;
        clearSourceAlignment(undefined, 'pointer-leave', relatedTarget);
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        log(tLog('hoverCoordinateProxyReleased'), { item: itemSummary(item) });
    }

    function associateGridHoverItem(item, clone) {
        clone.__tmMyListItem = item;
    }

    function ensureGridHoverBehavior(grid) {
        if (!grid || grid.__tmHoverBehaviorInstalled) return;
        grid.__tmHoverBehaviorInstalled = true;
        grid.addEventListener('pointerover', event => {
            const clone = gridCloneFromPointerEvent(event, grid);
            if (clone) {
                clone.__tmViewingControlHovered = false;
                handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
            } else {
                const controlClone = gridCloneFromPointerEvent(event, grid, true);
                if (controlClone) {
                    controlClone.__tmViewingControlHovered = true;
                    handleGridClonePointerLeave(controlClone, controlClone.__tmMyListItem, event.target, event);
                } else cancelPendingGridHover('controls');
            }
        }, { capture: true, passive: true });
        grid.addEventListener('pointerout', event => {
            const clone = gridCloneFromPointerEvent(event, grid);
            if (!clone || (event.relatedTarget && clone.contains(event.relatedTarget))) return;
            handleGridClonePointerLeave(clone, clone.__tmMyListItem, event.relatedTarget, event);
        }, { capture: true, passive: true });
    }

    async function buildGrid(section, scroller, items, layout, totalCount, sessionToken = sessionScope.token) {
        const buildState = sourceState;
        const track = buildState?.track;
        const assertBuildActive = () => {
            assertRouteSession(sessionToken);
            if (sourceState !== buildState) throw createRouteSessionCancelledError();
            if (!section.isConnected || !scroller.isConnected || !track?.isConnected ||
                buildState.section !== section || buildState.scroller !== scroller || buildState.track !== track) {
                throw initializationError('GRID_BUILD_SOURCE_REPLACED', 'grid-construction',
                    'Native My List source changed during grid construction');
            }
        };
        assertBuildActive();
        const grid = document.createElement('div');
        grid.id = GRID_ID;
        grid.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        grid.removeAttribute('data-tm-empty');
        ensureGridHoverBehavior(grid);

        const cloneMap = new Map();
        const itemMap = new Map();

        await runConstructionChunks(items.length, index => {
            const item = items[index];
            const clone = createItemClone(item);
            normalizeClone(clone);
            copyItemAttributes(clone, item, index);
            associateGridHoverItem(item, clone);
            grid.appendChild(clone);
            const key = itemKey(item);
            cloneMap.set(key, clone);
            itemMap.set(key, item);
        }, assertBuildActive);
        assertBuildActive();

        // Publish the complete tree and maps together. A cancelled/failed build
        // never removes the current frame or exposes a partial clone map.
        clearLegacyEmptyState({ restoreGrid: false });
        invalidateGridReact();
        document.getElementById(GRID_ID)?.remove();
        buildState.cloneMap = cloneMap;
        buildState.itemMap = itemMap;

        const geometry = applyGridGeometry(section, grid, layout);
        const status = updateStatus(formatHeaderParts(items.length, totalCount, null));

        // Place the legacy-grid header and grid below the native carousel.
        scroller.insertAdjacentElement('afterend', status);
        syncStatusTypography(section, status);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || 0) : 0}px`);
        status.insertAdjacentElement('afterend', grid);
        grid.style.marginTop = '0px';

        sourceState.items = items;
        sourceState.totalCount = totalCount;
        sourceState.grid = grid;
        sourceState.status = status;
        sourceState.layout = layout;
        if (sourceState.watchStatus) syncWatchGroups(sourceState);
        // The displayed trees now own the markup. Release captured native trees
        // and the shared GraphQL template only after successful publication.
        items.forEach(releaseItemCardSnapshot);

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
            gridCards: cloneMap.size
        });

        return grid;
    }

    function responsiveSignature(layout) {
        if (!sourceState) return '';
        return [
            Math.max(1, layout.columns),
            pageCount(sourceState.section),
            Math.round(layout.cardWidth),
            Math.round(layout.gridWidth),
            Math.round(layout.gridLeft),
            Math.round(layout.sidePadding || 0),
            Math.round(layout.scrollerWidth)
        ].join('|');
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
        cancelPendingGridHover('resize');
        advanceHoverToken('resize');
        clearSourceAlignment();
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        invalidateGridReact();
        performanceDiagnostics.resize.hoverCancelled++;
    }

    function responsivePageShape(layout) {
        if (!sourceState) return '';
        return `${Math.max(1, layout.columns)}|${pageCount(sourceState.section)}`;
    }

    function updateResponsiveStatus(layout, note = '') {
        if (!sourceState?.status || !sourceState?.items) return;
        const geometry = applyGridGeometry(sourceState.section, sourceState.grid, layout);
        sourceState.status.style.marginLeft = `${geometry.left}px`;
        sourceState.status.style.width = `${geometry.width}px`;
        sourceState.status.style.setProperty('--tm-row-gap', `${viewOriginalMyList ? (layout.rowGap || sourceState.layout?.rowGap || 0) : 0}px`);
        updateStatus(formatHeaderParts(
            sourceState.items.length,
            sourceState.totalCount,
            sourceState.initializationElapsedMs,
            true
        ));
        sourceState.grid.style.marginTop = '0px';

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
            latest = measureVisibleLayout(section, scroller, track);
            latest.rowGap = sourceState?.layout?.rowGap || measureNativeCarouselGap(section);
            const sig = responsiveSignature(latest);
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

    function wrappedTailLogicalPageInfo(...args) {
        return nativeCarousel.wrappedTail(...args);
    }

    function wrappedTailLogicalPageForRebuild(...args) {
        return nativeCarousel.wrappedTailForRebuild(...args);
    }

    async function rebuildLogicalPageModelFromNativePosition(layout, reason = 'responsive-remap', sessionToken = sessionScope.token) {
        assertRouteSession(sessionToken);
        const live = ensureLiveNativeBinding('logical-page-model-rebuild-start') || sourceState;
        const section = live?.section || sourceState?.section;
        const scroller = live?.scroller || sourceState?.scroller;
        const track = live?.track || sourceState?.track;
        const items = sourceState?.items || [];
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            throw new Error('Native carousel binding is unavailable during logical page model rebuild');
        }

        const bindingOwner = nativeCarousel.borrowBinding(section, scroller, track);
        nativeCarousel.assertBinding(bindingOwner);
        const columns = Math.max(1, layout?.columns || sourceState?.layout?.columns || 1);
        const pages = Math.max(1, Math.ceil(Math.max(items.length, 1) / columns));
        let motionLease = null;

        let runtime = getCarouselDomRuntime(section);
        nativeCarousel.markMappingStale(section);

        try {
            await nativeCarousel.whenNavigationIdle();
            assertRouteSession(sessionToken);
            nativeCarousel.assertBinding(bindingOwner);

            // Keep the finalized runtime until the current Hawkins page has been
            // validated. A My List mutation can briefly expose a wrapped virtual
            // tail; a transient read must not collapse pageCount() for hover.
            motionLease = nativeCarousel.suppressMotion(section, track);

            const nativeCountState = nativeReactCarouselTotalCount(scroller, track);
            const nativeCountHasReadings = nativeCountState.uniqueReadings.length > 0;
            const nativeCountConverged =
                Number.isSafeInteger(nativeCountState.totalCount) &&
                nativeCountState.totalCount === items.length;
            if (nativeCountConverged) myListCountConvergencePending = false;
            if (!nativeCountHasReadings || !nativeCountConverged) {
                nativeCarousel.deferMapping(section);
                log('Logical My List page-model rebuild deferred until native delta converges', {
                    reason,
                    legacyTotalCount: items.length,
                    nativeTotalCount: nativeCountState.totalCount,
                    readings: nativeCountState.readings,
                    uniqueReadings: nativeCountState.uniqueReadings,
                    selectedPage: selectedPage(section),
                    pageMappingStale: runtime.pageMappingStale,
                    retryCount: runtime.logicalRemapRetryCount
                });
                return null;
            }

            let pageState = nativeLogicalPageState(scroller, track, items.length, columns);
            const strictPageStateValid =
                pageState.positions.length > 0 &&
                pageState.positions.every(position => Number.isSafeInteger(position.itemIndex)) &&
                Number.isFinite(pageState.page);

            if (!strictPageStateValid) {
                const wrappedTail = wrappedTailLogicalPageForRebuild(
                    pageState.positions,
                    items.length,
                    columns,
                    runtime
                );
                if (wrappedTail) {
                    pageState = { ...pageState, page: wrappedTail.page };
                    log('Logical My List wrapped tail accepted for current-page recovery', {
                        reason,
                        page: wrappedTail.page,
                        wrapIndex: wrappedTail.wrapIndex,
                        totalCount: items.length,
                        columns,
                        itemIndices: pageState.itemIndices
                    });
                } else {
                    logVirtualRawIndexDiagnostic(pageState.slots, items.length, columns, 'logical-page-model-rebuild');
                    nativeCarousel.deferMapping(section);
                    log('Logical My List page-model rebuild deferred for non-canonical native window', {
                        reason,
                        totalCount: items.length,
                        columns,
                        slots: pageState.slots.length,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        resolvedPage: pageState.page,
                        retryCount: runtime.logicalRemapRetryCount
                    });
                    return null;
                }
            }

            const signature = visibleSignature(pageState.slots);
            if (!signature) {
                nativeCarousel.deferMapping(section);
                log('Logical My List page-model rebuild deferred because native signature is unavailable', {
                    reason,
                    totalCount: items.length,
                    columns,
                    retryCount: runtime.logicalRemapRetryCount
                });
                return null;
            }

            nativeCarousel.commitMapping(section, { pageCount: pages, currentPage: pageState.page, signature });
            runtime = getCarouselDomRuntime(section);

            let changed = 0;
            items.forEach((item, index) => {
                const page = Math.min(pages - 1, Math.floor(index / columns));
                item.logicalIndex = index;
                if (item.page !== page) changed++;
                item.page = page;
                const clone = sourceState?.cloneMap?.get(itemKey(item));
                if (clone?.isConnected) clone.setAttribute('data-tm-item-page', String(page));
            });
            if (sourceState) sourceState.initialPage = pageState.page;

            log(tLog('logicalPageModelSynchronizedAfterDelta'), {
                reason,
                currentPage: runtime.currentPage,
                knownPageCount: runtime.knownPageCount,
                pageCountFinalized: runtime.pageCountFinalized,
                pageMappingStale: runtime.pageMappingStale,
                visibleSignature: signature,
                visibleIds: currentPageVideoIds(scroller, track),
                itemIndices: pageState.itemIndices,
                logicalIndices: pageState.logicalIndices,
                columns,
                changed,
                totalCount: items.length
            });
            return changed;
        } finally {
            motionLease?.release();
        }
    }

    async function remapItemsByOrder(layout, sessionToken = sessionScope.token) {
        const { section, items, cloneMap } = sourceState;
        const columns = Math.max(1, layout.columns);
        const runtime = getCarouselDomRuntime(section);
        const logicalMode = runtime?.profile?.pageMode === 'logical';
        const pages = logicalMode
            ? Math.max(1, Math.ceil(items.length / columns))
            : Math.max(1, pageCount(section));
        let changed = 0;

        if (logicalMode) {
            changed = await rebuildLogicalPageModelFromNativePosition(layout, 'responsive-remap', sessionToken);
        } else {
            items.forEach((item, index) => {
                const page = Math.min(pages - 1, Math.floor(index / columns));
                if (item.page !== page) changed++;
                item.page = page;
                const clone = cloneMap?.get(itemKey(item));
                if (clone) clone.setAttribute('data-tm-item-page', String(page));
            });
        }

        const updatedRuntime = getCarouselDomRuntime(section);
        log(tLog('responsiveItemPageMappingRecalculatedWithoutNativeCarouselScan'), {
            columns,
            pages,
            changed,
            total: items.length,
            selectedPage: selectedPage(section),
            pageMode: updatedRuntime?.profile?.pageMode || null,
            reanchoredLogicalPages: logicalMode,
            pageMappingStale: Boolean(updatedRuntime?.pageMappingStale)
        });

        return changed;
    }

    async function refreshResponsiveLayout(sessionToken = sessionScope.token) {
        if (!isRouteSessionActive(sessionToken) || !sourceState?.grid?.isConnected || responsiveRefreshing) return;
        const state = sourceState;
        const { section, scroller, track } = state;
        responsiveRefreshing = true;
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
        log(tLog('responsiveRefreshStarted'), {
            seq,
            reason,
            beforeLayout: layoutSummary(sourceState.layout),
            selectedPage: selectedPage(sourceState.section),
            pages: pageCount(sourceState.section)
        });
        grid.setAttribute('data-tm-responsive-refreshing', 'true');
        performanceDiagnostics.resize.refreshes++;
        cancelResizeHover();

        try {
            const liveLayout = await waitResponsiveLayoutSettled(1200, sessionToken);
            assertOwner();
            const signature = responsiveSignature(liveLayout);
            const pageShape = responsivePageShape(liveLayout);

            sourceState.layout = liveLayout;
            updateResponsiveStatus(liveLayout, tUi('relayoutInProgress'));

            const pageShapeChanged = pageShape !== lastPageShape;
            const logicalMappingStale = Boolean(getCarouselDomRuntime(sourceState.section)?.pageMappingStale);
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
            if (pageShapeChanged || logicalMappingStale) {
                const changed = await remapItemsByOrder(liveLayout, sessionToken);
                assertOwner();
                deferredLogicalRemap = changed === null;
                if (deferredLogicalRemap) {
                    log('Responsive logical page remap deferred', {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: pageCount(sourceState.section),
                        total: sourceState.items.length,
                        retryCount: getCarouselDomRuntime(sourceState.section)?.logicalRemapRetryCount || 0
                    });
                } else {
                    log(tLog('responsivePageMappingUpdatedWithoutNativeCarouselMovement'), {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: pageCount(sourceState.section),
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
                selectedPage: selectedPage(sourceState.section),
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
            grid.removeAttribute('data-tm-responsive-refreshing');
            if (isRouteSessionActive(sessionToken) && responsiveSequence === seq) {
                responsiveRefreshing = false;
                activeResponsiveReason = '';
                retryPendingMyListMutations('after-responsive-refresh');
                const runtime = sourceState?.section ? getCarouselDomRuntime(sourceState.section) : null;
                if (deferredLogicalRemap && runtime?.pageMappingStale && (runtime.logicalRemapRetryCount || 0) === 1) {
                    scheduleResponsiveRefresh(
                        400,
                        isResizeResponsiveReason(reason) ? 'responsive-resize-retry' : 'logical-page-model-retry'
                    );
                }
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
        responsiveRefreshTimer = setTimeout(() => {
            responsiveRefreshTimer = null;
            if (!isRouteSessionActive(sessionToken) || responsiveRefreshing || sourceState !== state || !state.grid?.isConnected) return;
            performanceDiagnostics.resize.checks++;
            if (state.empty && (!state.scroller || !state.track)) {
                const layout = measureEmptyLayout(state.section);
                layout.rowGap = measureNativeCarouselGap(state.section);
                if (responsiveLayoutMatches(state.layout, layout)) {
                    performanceDiagnostics.resize.unchanged++;
                    return;
                }
                state.layout = layout;
                const geometry = applyGridGeometry(state.section, state.grid, layout);
                state.status.style.marginLeft = `${geometry.left}px`;
                state.status.style.width = `${geometry.width}px`;
                return;
            }
            ensureLiveNativeBinding('responsive-check');
            if (sourceState !== state || !state.section?.isConnected || !state.scroller?.isConnected || !state.track?.isConnected) return;

            // Skip the expensive rescan when measured geometry has not changed.
            // Keep active-slot alignment here and clear it only when the responsive state actually changes.
            const sample = withNativeReadScope(() => {
                const measured = measureVisibleLayout(state.section, state.scroller, state.track);
                measured.rowGap = state.layout?.rowGap || measureNativeCarouselGap(state.section);
                return { measured, signature: responsiveSignature(measured), geometry: currentGridGeometry(state.section, measured) };
            });
            const measured = sample.measured;
            const sig = sample.signature;
            const logicalMappingStale = Boolean(getCarouselDomRuntime(sourceState.section)?.pageMappingStale);
            const applied = state.grid.__tmAppliedGeometry;
            const layoutUnchanged = responsiveLayoutMatches(state.layout, measured);
            // Parking a hidden source changes its own height, not the displayed
            // grid. Preserve the first hover only after all other checks agree.
            const parkedHeightOnlyChange = !layoutUnchanged && lastResponsiveReason === 'ResizeObserver' &&
                sig === lastResponsiveSignature && !logicalMappingStale &&
                state.section.getAttribute(ORIGINAL_VISIBILITY_ATTR) === 'false' &&
                state.scroller.classList.contains(SOURCE_PARKED_CLASS) &&
                state.resizeViewportSignature === responsiveViewportSignature() &&
                Number.isFinite(state.layout?.scrollerHeight) && state.layout.scrollerHeight > 1.5 &&
                Number.isFinite(measured.scrollerHeight) && measured.scrollerHeight >= 1 && measured.scrollerHeight <= 1.5 &&
                responsiveLayoutMatches(state.layout, measured, true);
            const geometryUnchanged = (layoutUnchanged || parkedHeightOnlyChange) && applied &&
                ['width', 'left', 'columns'].every(key => Math.abs(applied[key] - sample.geometry[key]) <= 0.5);
            if (sig === lastResponsiveSignature && geometryUnchanged && !logicalMappingStale) {
                const previousScrollerHeight = state.layout.scrollerHeight;
                sourceState.layout = measured;
                realignActiveSource();
                performanceDiagnostics.resize.unchanged++;
                const hoverPreserved = Boolean(activeClone || pendingGridHoverClone ||
                    activeHoverPreparationDiagnostic?.token === hoverToken);
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
                        }); } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
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
                    if (activeClone || pendingGridHoverClone) performanceDiagnostics.resize.hoverPreserved++;
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
        }, delay);
    }

    function beginSourceScan(section, scroller, track) {
        section.setAttribute(SECTION_ATTR, 'true');
        scroller.classList.add(SOURCE_SCAN_CLASS);
        track.classList.add('tm-netflix-mylist-v15-track');
    }

    function parkSource(scroller) {
        scroller.classList.remove(SOURCE_SCAN_CLASS);
        scroller.classList.add(SOURCE_PARKED_CLASS);

    }

    function realignActiveSource() {
        if (!activeGeometryProxy) return;
        if (!activeGeometryProxy.sourceSlot.isConnected || !activeGeometryProxy.clone.isConnected) {
            clearSourceAlignment();
        }
    }

    function handleTargetPointerMove(event) {
        // Synthetic native replay must not overwrite the latest physical position.
        if (!event.isTrusted) return;
        const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        if (!moved) {
            if (hoverNeedsPointerMove) performanceDiagnostics.hoverScroll.unchangedPointerEvents++;
            return;
        }
        const grid = sourceState?.grid;
        if (!grid?.isConnected) return;
        const clone = gridCloneFromPointerEvent(event, grid);
        const owner = activeNativeHover;
        if (owner?.previewRoot) {
            if (!owner.previewRoot.isConnected || !gridOwnsClone(owner.previewClone, grid)) {
                releaseNativePreview(owner, 'preview-removed');
            } else if (owner.previewRoot.contains(event.target)) {
                cancelPendingGridHover('preview');
                return;
            } else if (clone === owner.previewClone && nativePreviewOwnerMatches(owner)) {
                clearNativePreviewTransfer(owner, 'preview-return');
            } else releaseNativePreview(owner, 'preview-leave', event.target);
        }
        if (performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) {
            if (hoverNeedsPointerMove) performanceDiagnostics.hoverScroll.physicalRearms++;
            hoverNeedsPointerMove = false;
        }
        if (clone) handleGridClonePointerOver(event, clone, clone.__tmMyListItem, true);
        else cancelPendingGridHover('outside-grid');
    }

    function handleTargetScroll(event = null) {
        const now = performance.now();
        const starting = now - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS;
        lastTargetScrollAt = now;
        const counters = performanceDiagnostics.hoverScroll;
        const kind = event?.type === 'wheel' ? 'wheel' : event?.type === 'scroll' ? 'scroll' : 'other';
        counters[kind === 'wheel' ? 'wheelEvents' : kind === 'scroll' ? 'scrollEvents' : 'otherScrollEvents']++;
        counters.lastScrollEvent = kind;
        hoverNeedsPointerMove = true;
        cancelPendingGridHover('scroll');
        if (!starting) return;
        performanceDiagnostics.hoverLifecycle.scrollBursts++;
        startHoverFrameDiagnostics('scroll');
        advanceHoverToken('scroll');
        clearSourceAlignment(undefined, 'scroll');
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        // Grafted React props also receive Netflix's delegated mouse events.
        // Clear them once per scroll burst so they cannot bypass the script guard.
        invalidateGridReact();
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
        document.addEventListener('pointermove', handleTargetPointerMove, { passive: true, capture: true });
        document.addEventListener('pointerout', handleTargetPreviewPointerOut, { passive: true, capture: true });
        document.addEventListener('visibilitychange', handleHoverDiagnosticVisibilityChange, { passive: true });
        document.addEventListener('wheel', handleTargetScroll, { passive: true, capture: true });
        document.addEventListener('scroll', handleTargetScroll, { passive: true, capture: true });
        document.addEventListener('click', handleObservedMyListToggleClick, { capture: true, passive: true });
        window.addEventListener('resize', handleTargetWindowResize, { passive: true });
        window.visualViewport?.addEventListener('resize', handleTargetVisualViewportResize, { passive: true });
        nativeCarousel.startDiscovery();
    }

    function stopTargetEventListeners() {
        stopHoverFrameDiagnostics();
        finishNativePreviewDiagnostic(activeNativeHover, { result: 'released-before-check', reason: 'listeners-stopped' });
        if (activeNativeHover?.previewRoot) releaseNativePreview(activeNativeHover, 'listeners-stopped');
        if (!targetListenersActive && !nativeCarousel.diagnostics().discoveryActive) return;
        targetListenersActive = false;
        cancelPendingGridHover('route');
        lastTargetScrollAt = -Infinity;
        hoverNeedsPointerMove = false;
        lastPointerX = -1;
        lastPointerY = -1;
        document.removeEventListener('pointermove', handleTargetPointerMove, true);
        document.removeEventListener('pointerout', handleTargetPreviewPointerOut, true);
        document.removeEventListener('visibilitychange', handleHoverDiagnosticVisibilityChange);
        document.removeEventListener('wheel', handleTargetScroll, true);
        document.removeEventListener('scroll', handleTargetScroll, true);
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
        const section = findMyListSection();
        const scroller = section?.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = scroller && netflixDom.findTrack(scroller);
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected ||
            !section.contains(scroller) || !scroller.contains(track) ||
            (section === failure.section && scroller === failure.scroller && track === failure.track)) return false;

        performanceDiagnostics.nativeRecovery.attempts++;
        for (const mutation of pendingMyListMutations.values()) mutation.deferredWhileBusy = true;
        advanceHoverToken('source');
        cancelPendingGridHover('source');
        cleanupTargetSessionDom();
        resizeObserver?.disconnect();
        resizeObserver = null;
        clearTimeout(responsiveRefreshTimer);
        responsiveRefreshTimer = null;
        responsiveRefreshPromise = null;
        responsiveRefreshing = false;
        nativeCarousel.clearBinding();
        sourceState = null;
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
            pendingMutations: pendingMyListMutations.size
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
        let section = findMyListSection();
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
            section = netflixDom.ensureSyntheticMyListSection();
            if (!section) {
                scheduleRun(120, sessionToken);
                return;
            }
        } else {
            missingSectionSince = 0;
            const synthetic = document.getElementById(SYNTHETIC_SECTION_ID);
            if (synthetic && synthetic !== section) synthetic.remove();
        }
        if (completedSection === section && document.getElementById(GRID_ID) && !sourceState?.empty) return;

        cleanupOldArtifacts();
        installStyles(document);
        section.setAttribute(SECTION_ATTR, 'true');
        markOriginalHeader(section);

        const initializationStarted = performance.now();
        let scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        let track = scroller && netflixDom.findTrack(scroller);
        let provisionalLayout = scroller && track ? measureVisibleLayout(section, scroller, track) : measureEmptyLayout(section);
        provisionalLayout.rowGap = measureNativeCarouselGap(section);
        const provisionalFrame = placeLegacyFrame(section, scroller, provisionalLayout, { elapsedMs: null, finalized: false, totalCount: null });
        sourceState = attachNativeBinding({
            layout: provisionalLayout,
            items: [],
            collectedCount: 0,
            totalCount: null,
            grid: provisionalFrame.grid,
            status: provisionalFrame.status,
            cloneMap: new Map(),
            itemMap: new Map(),
            empty: false,
            resizeViewportSignature: responsiveViewportSignature(),
            initializationStartedAt: initializationStarted
        }, section, scroller || null, track || null);
        applyOriginalMyListVisibility();

        running = true;
        runningSessionToken = sessionToken;
        assertRouteSession(sessionToken);
        let earlyTotalCount;
        let freshMyListBootstrap = null;
        let mountedSinglePageFastBootstrap = false;
        let fastItems = null;
        let fastCollectionSource = 'graphql';
        let parallelReadinessPromise = null;
        let carouselProfileLoggedForReadiness = false;
        const startParallelReadiness = () => {
            if (parallelReadinessPromise || !scroller || !track) return;
            resetCarouselDomRuntime(section);
            logCarouselDomProfile(section, 'before-readiness');
            carouselProfileLoggedForReadiness = true;
            parallelReadinessPromise = waitForNativeCarouselReady(section, scroller, track, sessionToken)
                .then(value => ({ value, error: null }), error => ({ value: null, error }));
        };
        try {
            if (targetSessionEntryKind === 'initial') {
                earlyTotalCount = await waitForMyListTotalCount(TOTAL_COUNT_TIMEOUT_MS, sessionToken);
                freshMyListBootstrap = {
                    totalCount: earlyTotalCount,
                    firstVideoId: listData.firstMyListVideoId()
                };
            } else {
                const mountedFast = scroller && track
                    ? await tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken)
                    : null;
                if (mountedFast) {
                    freshMyListBootstrap = mountedFast;
                    mountedSinglePageFastBootstrap = true;
                    earlyTotalCount = mountedFast.totalCount;
                    log(tLog('totalCountDetected'), {
                        totalCount: earlyTotalCount,
                        detectionReason: mountedFast.source,
                        firstVideoId: mountedFast.firstVideoId || null,
                        elapsedMs: mountedFast.elapsedMs
                    });
                } else {
                    // When a non-empty native carousel is already mounted, readiness and
                    // the authoritative fresh count are independent read-only checks. Run
                    // them together instead of serializing their latency.
                    if (scroller && track && currentPageSlots(scroller, track).length > 0) {
                        startParallelReadiness();
                    }
                    freshMyListBootstrap = await listData.fetchBootstrap(sessionToken);
                    earlyTotalCount = freshMyListBootstrap.totalCount;
                    log(tLog('totalCountDetected'), {
                        totalCount: earlyTotalCount,
                        detectionReason: 'fresh-netflix-my-list-carousel',
                        firstVideoId: freshMyListBootstrap.firstVideoId || null
                    });
                }
            }
            assertRouteSession(sessionToken);
        } catch (error) {
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
            clearRunningSession(sessionToken);
            return;
        }
        if (earlyTotalCount === 0) {
            finalizeEmptyLegacyList(section, scroller, track, provisionalLayout, initializationStarted, 'totalCount-0');
            clearRunningSession(sessionToken);
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
                clearRunningSession(sessionToken);
                return;
            }
            assertRouteSession(sessionToken);
            if (sourceWait.nativeSection) {
                invalidateGridReact();
                document.getElementById(GRID_ID)?.remove();
                document.getElementById(STATUS_ID)?.remove();
                if (section.id === SYNTHETIC_SECTION_ID) section.remove();
                nativeCarousel.clearBinding();
                sourceState = null;
                completedSection = null;
                clearRunningSession(sessionToken);
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
                clearRunningSession(sessionToken, false);
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
        if (!carouselProfileLoggedForReadiness) {
            resetCarouselDomRuntime(section);
            logCarouselDomProfile(section, 'before-readiness');
            carouselProfileLoggedForReadiness = true;
        }
        let readiness;
        try {
            if (parallelReadinessPromise) {
                const parallelReadiness = await parallelReadinessPromise;
                if (parallelReadiness.error) throw parallelReadiness.error;
                readiness = parallelReadiness.value;
            } else {
                readiness = await waitForNativeCarouselReady(section, scroller, track, sessionToken, {
                    fastSinglePageTotalCount: mountedSinglePageFastBootstrap ? earlyTotalCount : null
                });
            }
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('nativeCarouselReadinessCheckFailed'), error);
            }
            clearRunningSession(sessionToken);
            return;
        }
        if (!readiness.ready) {
            initializationBlockedSessionToken = sessionToken;
            nativeInitializationFailure = { section, scroller, track, sessionToken };
            clearRunningSession(sessionToken, false);
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
            const emptyLayout = measureVisibleLayout(section, scroller, track);
            emptyLayout.rowGap = measureNativeCarouselGap(section);
            finalizeEmptyLegacyList(section, scroller, track, emptyLayout, initializationStarted, readiness.reason);
            clearRunningSession(sessionToken);
            return;
        }
        const mountedProfile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);

        // A manual/order-mismatch reinitialization can start while Netflix still has
        // page 0 selected with a one-card-shifted mounted window after a My List delta.
        // The fresh CarouselPage response gives us an authoritative first video ID.
        // Normalize only legacy/indicator SPA sessions, before source-scan mode starts,
        // so normal initial-load performance and logical/Hawkins behavior are untouched.
        if (targetSessionEntryKind !== 'initial' &&
            mountedProfile.pageMode === 'indicator' &&
            freshMyListBootstrap?.firstVideoId) {
            try {
                await ensureFreshIndicatorPageZeroAnchor(
                    section,
                    scroller,
                    track,
                    freshMyListBootstrap.firstVideoId,
                    sessionToken
                );
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
                clearRunningSession(sessionToken);
                return;
            }
        }

        if (mountedProfile.pageMode === 'logical') {
            try {
                const mountedCountState = requireNativeReactCarouselTotalCount(scroller, track, earlyTotalCount);
                const mountedTotalCount = mountedCountState.totalCount;
                if (mountedTotalCount !== earlyTotalCount) {
                    warn('Netflix My List totalCount reconciled from mounted carousel', {
                        provisionalTotalCount: earlyTotalCount,
                        mountedTotalCount,
                        readings: mountedCountState.readings,
                        entryKind: targetSessionEntryKind,
                        provisionalSource: targetSessionEntryKind === 'initial'
                            ? 'graphql-cache'
                            : 'fresh-netflix-my-list-carousel'
                    });
                } else {
                    log('Netflix My List mounted totalCount confirmed', {
                        totalCount: mountedTotalCount,
                        readings: mountedCountState.readings,
                        entryKind: targetSessionEntryKind
                    });
                }
                earlyTotalCount = mountedTotalCount;
                if (sourceState) sourceState.totalCount = mountedTotalCount;
            } catch (error) {
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
                clearRunningSession(sessionToken);
                return;
            }
        }

        if (mountedProfile.pageMode === 'logical') {
            const fastBindingOwner = nativeCarousel.borrowBinding(section, scroller, track);
            const retryReplacedSource = () => {
                log('Fast My List collection discarded after native source replacement', { sessionToken });
                clearRunningSession(sessionToken, false);
                scheduleRun(0, sessionToken);
            };
            try {
                nativeCarousel.assertBinding(fastBindingOwner);
                const graphqlLayout = measureVisibleLayout(section, scroller, track);
                const templateSlot = currentPageSlots(scroller, track)[0] || netflixDom.filledSlots(track)[0];
                const graphqlCollection = await collectLogicalListItems({
                    bootstrap: freshMyListBootstrap,
                    totalCount: earlyTotalCount,
                    columns: graphqlLayout.columns,
                    templateSlot,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                if (!nativeCarousel.isBindingCurrent(fastBindingOwner)) {
                    retryReplacedSource();
                    return;
                }
                freshMyListBootstrap = graphqlCollection.bootstrap;
                fastItems = graphqlCollection.items;
                fastCollectionSource = graphqlCollection.collectionSource || 'graphql';
                if (graphqlCollection.error) throw graphqlCollection.error;
                if (fastItems) {
                    const runtime = getCarouselDomRuntime(section);
                    nativeCarousel.confirmPageCount(section, Math.max(1, Math.ceil(earlyTotalCount / Math.max(1, graphqlLayout.columns))));
                    log(fastCollectionSource === 'mounted-single-page'
                        ? 'Mounted single-page My List fast collection prepared' : 'GraphQL My List fast collection prepared', {
                        collectionSource: fastCollectionSource,
                        avoidedMembershipRequests: fastCollectionSource === 'mounted-single-page' ? 1 : 0,
                        totalCount: earlyTotalCount,
                        collected: fastItems.length,
                        graphqlPageCount: freshMyListBootstrap.pageCount || null,
                        columns: graphqlLayout.columns,
                        knownPageCount: runtime.knownPageCount
                    });
                } else {
                    warn('GraphQL My List fast collection was incomplete; falling back to native scan', {
                        totalCount: earlyTotalCount,
                        bootstrapTotalCount: freshMyListBootstrap?.totalCount,
                        graphqlEdgeCount: freshMyListBootstrap?.edgeCount || 0,
                        graphqlPageCount: freshMyListBootstrap?.pageCount || null,
                        columns: graphqlLayout.columns
                    });
                }
            } catch (error) {
                if (isRouteSessionCancelledError(error)) {
                    clearRunningSession(sessionToken);
                    return;
                }
                if (!nativeCarousel.isBindingCurrent(fastBindingOwner)) {
                    retryReplacedSource();
                    return;
                }
                warn('GraphQL My List fast collection failed; falling back to native scan', {
                    code: error?.code || null,
                    stage: error?.stage || 'graphql-fast-collection',
                    error
                });
            }
        }

        log(tLog('initializationStarted'), {
            version: SCRIPT_VERSION,
            browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(),
            netflixLanguage: getNetflixLanguage(),
            displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            devicePixelRatio: window.devicePixelRatio,
            selectedPage: selectedPage(section),
            pages: pageCount(section),
            sourceSlots: netflixDom.directSlots(track).length,
            sourceCards: netflixDom.filledSlots(track).length,
            carouselDom: carouselDomProfileSummary(section)
        });

        let retryGridBuild = false;
        try {
            const layout = measureVisibleLayout(section, scroller, track);
            layout.rowGap = measureNativeCarouselGap(section);
            const totalCount = earlyTotalCount;
            const initialPages = pageCount(section);
            log(tLog('initialLayoutMeasured'), {
                layout: layoutSummary(layout),
                totalCount,
                initialPages,
                selectedPage: selectedPage(section),
                currentPageCards: currentPageSlots(scroller, track).length
            });

            const status = updateStatus(formatHeaderParts(0, totalCount, null));
            scroller.insertAdjacentElement('afterend', status);
            syncStatusTypography(section, status);
            const initialStatusGeometry = currentGridGeometry(section, layout);
            status.style.marginLeft = `${initialStatusGeometry.left}px`;
            status.style.width = `${initialStatusGeometry.width}px`;
            status.style.setProperty('--tm-row-gap', `${layout.rowGap}px`);

            // Fast collection skips beginSourceScan(), but hover-driven native
            // moves still need the track marker used by the animation suppression CSS.
            track.classList.add('tm-netflix-mylist-v15-track');
            waitingForNativeEmpty = false;
            sourceState = attachNativeBinding({ layout, initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount }, section, scroller, track);
            let items;
            if (fastItems?.length === totalCount) {
                items = fastItems;
                log(fastCollectionSource === 'mounted-single-page'
                    ? 'Mounted single-page My List fast collection used' : 'GraphQL My List fast collection used', {
                    collectionSource: fastCollectionSource,
                    collected: items.length,
                    totalCount,
                    pages: pageCount(section),
                    sourceCards: netflixDom.filledSlots(track).length,
                    carouselDom: carouselDomProfileSummary(section)
                });
            } else {
                // Keep the native carousel in place while scanning so Netflix layout and
                // tabindex/current-slot detection continue to reflect native state.
                beginSourceScan(section, scroller, track);
                log(tLog('nativeCarouselScanModeStarted'), {
                    selectedPage: selectedPage(section),
                    pages: pageCount(section),
                    sourceSlots: netflixDom.directSlots(track).length,
                    sourceCards: netflixDom.filledSlots(track).length,
                    carouselDom: carouselDomProfileSummary(section)
                });
                items = await collectAllItems(section, scroller, track, totalCount, sessionToken);
            }
            if (!items.length) {
                const nowState = nativeCarouselReadiness(section, scroller, track);
                if (nowState.pages === 1 && nowState.cards === 0) {
                    finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, 'collection-confirmed-empty');
                    return;
                }
                const noCardsError = new Error(tLog('noNativeNetflixCardsCouldBeCollected'));
                noCardsError.code = 'NO_NATIVE_CARDS';
                throw noCardsError;
            }

            if (Number.isFinite(totalCount) && items.length !== totalCount) {
                const countError = initializationError(
                    'COLLECTION_COUNT_MISMATCH',
                    'validate-count',
                    `Collected ${items.length} of ${totalCount} My List items`,
                    { collected: items.length, totalCount, endingPage: selectedPage(section) }
                );
                warn(tLog('collectedCountDoesNotMatchTotalCount'), {
                    collected: items.length,
                    totalCount,
                    stage: countError.stage,
                    code: countError.code
                });
                throw countError;
            }

            log(tLog('fullCollectionResultFinalized'), {
                collected: items.length,
                totalCount,
                endingPage: selectedPage(section),
                items: items.map(itemSummary)
            });

            // Keep the native carousel at its normal position and size for React resynchronization.
            parkSource(scroller);
            log(tLog('nativeCarouselStandbyMode'), {
                selectedPage: selectedPage(section),
                parked: scroller.classList.contains(SOURCE_PARKED_CLASS)
            });
            await buildGrid(section, scroller, items, layout, totalCount, sessionToken);
            assertRouteSession(sessionToken);
            sourceState.empty = false;
            applyOriginalMyListVisibility();

            // Defer React-backed hover preparation until the first actual hover.
            // The live native card is resolved on demand, keeping initialization off the hover path.
            log(tLog('initialHoverPreparationDeferred'), {
                selectedPage: selectedPage(section),
                currentPageCards: currentPageSlots(scroller, track).length
            });
            if (sourceState) { sourceState.collectedCount = items.length; sourceState.totalCount = totalCount; }
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
            } else if (error?.code === 'GRID_BUILD_SOURCE_REPLACED') {
                log('Grid construction discarded after native source replacement', { sessionToken });
                cleanupTargetSessionDom();
                nativeCarousel.clearBinding();
                sourceState = null;
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
            clearRunningSession(sessionToken, !retryGridBuild);
            if (retryGridBuild && isRouteSessionActive(sessionToken)) runScript(sessionToken);
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
