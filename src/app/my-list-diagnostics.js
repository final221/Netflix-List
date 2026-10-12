import { createReport } from '../diagnostics/report.js';
import { GRID_ID, STATUS_ID, STATUS_LABEL_CLASS, STATUS_META_CLASS } from '../dom-names.js';

// Passive projections are sampled per report; retained snapshots never drive work.
export function createMyListDiagnostics(providers) {
    const { environment, context, i18n, logger, settings, version, saveLogs, readLogHistory } = providers;
    const { document, location, navigator, window } = environment;
    const { getHtmlLanguage, getNetflixLanguage } = context;
    const { getUiLocale, getLogLocale, tLog } = i18n;
    const { log, warn } = logger;
    const diagnosticReport = createReport({ logger, version, writeText: saveLogs, readHistory: readLogHistory,
        readEnvironment: () => ({ url: location.href, userAgent: navigator.userAgent, browserLanguage: navigator.language || '',
            htmlLanguage: getHtmlLanguage(), netflixLanguage: getNetflixLanguage(), displayLanguage: getUiLocale(),
            logLanguage: getLogLocale(), viewport: `${window.innerWidth}x${window.innerHeight}`, devicePixelRatio: window.devicePixelRatio }),
        readRuntime: () => collectRuntimeSnapshot(), readSeriesViewing: () => collectViewingSeriesDiagnostics(providers.display.captureSource()),
        readThumbnails: () => providers.gridView.images.collect(), readNativePopup: () => providers.popupInspection.collect() });

    function collectPerformanceDiagnostics({ hoverSummary = providers.hover.diagnostics(), nativeInteraction = providers.nativePopup.diagnostics(),
        responsiveSummary = providers.responsive.diagnostics(), carouselSummary = providers.nativeCarousel.diagnostics() } = {}) {
        const snapshots = Object.fromEntries(Object.entries(providers.initialization.workCounters()).map(([key, counters]) => [key, { ...counters }]));
        return { viewingGroups: providers.gridView.groupDiagnostics(), hoverPreparation: hoverSummary.hoverPreparation,
            popupInvestigation: providers.popupInspection.diagnostics(), ...snapshots,
            nativeRecovery: { ...snapshots.nativeRecovery, alignmentRestores: nativeInteraction.alignmentRestores,
                alignmentRestoreFailures: nativeInteraction.alignmentRestoreFailures },
            undoRetention: providers.listMutations.workDiagnostics(), resize: responsiveSummary.resize, imageResources: providers.gridView.images.diagnostics(), ...hoverSummary, ...providers.listView.diagnostics(), nativeCollection: carouselSummary.collection, grid: providers.gridView.diagnostics() };
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
        return providers.nativeCarousel.diagnostics({ card: slot, totalCount: providers.display.captureSource()?.totalCount }).card;
    }

    function itemSummary(item) {
        return providers.display.itemSummary(item);
    }

    const layoutSummary = layout => providers.display.layoutSummary(layout);

    function collectRuntimeSnapshot() {
        const section = providers.display.captureSource()?.section, scroller = providers.display.captureSource()?.scroller, track = providers.display.captureSource()?.track;
        const grid = document.getElementById(GRID_ID);
        const statusNode = document.getElementById(STATUS_ID);
        const statusLabel = statusNode?.querySelector?.(`.${STATUS_LABEL_CLASS}`)?.textContent || '';
        const statusMeta = statusNode?.querySelector?.(`.${STATUS_META_CLASS}`)?.textContent || '';
        const statusText = [statusLabel, statusMeta].filter(Boolean).join('  ') || statusNode?.textContent || '';
        const carouselSummary = providers.nativeCarousel.diagnostics({ source: { section, scroller, track, discover: true } });
        const native = carouselSummary.source;
        const nativeInteraction = providers.nativePopup.diagnostics(), hoverSummary = providers.hover.diagnostics();
        const responsiveSummary = providers.responsive.diagnostics(), intent = providers.hover.intent();
        const viewingSummary = providers.display.viewingDiagnostics();

        const viewingPresentation = providers.display.captureSource()?.viewingActive ? providers.gridView.presentation() : null;

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
            running: Boolean(providers.initialization.running),
            runningSessionToken: providers.initialization.running?.sessionToken ?? null,
            targetSessionActive: providers.session.active,
            routeSessionToken: providers.session.scope.token,
            completed: Boolean(providers.display.completed && providers.display.completed.isConnected),
            selectedPage: native?.selectedPage ?? null,
            pageCount: native?.pageCount ?? null,
            carouselDom: native?.carouselDom ?? null,
            totalCount: providers.display.captureSource()?.totalCount ?? null,
            collectedItems: providers.display.captureSource()?.items?.length ?? 0,
            sourceSlots: native?.sourceSlots ?? 0,
            sourceCards: native?.sourceCards ?? 0,
            currentPageCards: native?.currentPageCards ?? 0,
            gridCards: providers.display.captureSource()?.cardCount ?? 0,
            performanceWork: collectPerformanceDiagnostics({ hoverSummary, nativeInteraction, responsiveSummary, carouselSummary }),
            undoRetention: providers.listMutations.undoDiagnostics(),
            reconciliation: providers.listMutations.deferralDiagnostics(),
            viewingStatus: providers.display.captureSource()?.viewingActive ? {
                completed: viewingPresentation.completedCount,
                unknown: viewingPresentation.unknownCount,
                ...viewingSummary
            } : null,
            sourceScan: native?.sourceScan ?? false,
            sourceParked: native?.sourceParked ?? false,
            sourceGeometryProxy: nativeInteraction.geometryOwned,
            hoverPresentation: 'netflix-native',
            nativeHoverOwned: nativeInteraction.replayOwned,
            nativePreviewOwned: nativeInteraction.previewOwned,
            nativeInteraction,
            viewOriginalMyList: settings.preferences().viewOriginalMyList,
            myListSyncMode: 'event-driven',
            pendingMyListMutations: providers.listMutations.pendingDiagnostics(),
            layout: layoutSummary(providers.display.captureSource()?.layout),
            activeVideoId: intent.videoId,
            activePage: intent.page,
            activeClone: intent.clone ? {
                videoId: intent.clone.getAttribute('data-tm-item-video-id') || '',
                page: intent.clone.getAttribute('data-tm-item-page') || '',
                backedPage: intent.clone.getAttribute('data-tm-backed-page') || '',
                hoverReady: intent.clone.getAttribute('data-tm-hover-ready') === 'true',
                connected: Boolean(intent.clone.isConnected),
                rect: rectSummary(intent.clone.getBoundingClientRect?.())
            } : null,
            activeSourceSlot: providers.nativePopup.describeActiveSource(),
            hoverToken: intent.token,
            ...responsiveSummary,
            resizeViewportSignature: providers.display.captureSource()?.resizeViewportSignature || '',
            hoverScrollState: hoverSummary.hoverScrollState,
            pointer: { x: intent.pointerX, y: intent.pointerY }
        };
    }

    async function copyDiagnosticLogs(options = {}) {
        log(tLog('copyLogsRequested'), { detailed: Boolean(options.detailed) });
        try {
            const method = await diagnosticReport.copy(options);
            log(tLog('copyLogsCompleted'), { method, entries: logger.size() });
            return method;
        } catch (error) {
            warn(tLog('copyLogsFailed'), error);
            throw error;
        }
    }

    function collectViewingSeriesDiagnostics(state) {
        return providers.display.seriesDiagnostics();
    }

    function reportInitializationFailure(error, detail) {
        warn(tLog('initializationFailed'), { code: error?.code || null, ...detail,
            error, snapshot: collectRuntimeSnapshot() });
    }

    function logOperationTimeout(stage, timeoutMs, details = {}) {
        const payload = { stage, timeoutMs, ...details };
        warn(tLog('operationTimedOut'), payload);
        return payload;
    }

    return Object.freeze({ reportInitializationFailure, logOperationTimeout, collectPerformanceDiagnostics,
        slotDescriptor, itemSummary, layoutSummary, collectRuntimeSnapshot, copyDiagnosticLogs,
        snapshot: diagnosticReport.snapshot });
}
