import { GRID_ID } from '../dom-names.js';

export function createMyListInitialization(dependencies) {
    const { environment, i18n, logger, session } = dependencies;
    const { document, window, location, performance, setTimeout, clearTimeout } = environment;
    const { getUiLocale, getLogLocale, tLog } = i18n;
    const { log, warn } = logger;
    const { getHtmlLanguage, getNetflixLanguage } = dependencies.netflixContext;
    const NATIVE_READY_TIMEOUT_MS = 3000, NATIVE_EMPTY_STABLE_MS = 1200, NATIVE_READY_POLL_MS = 25, TOTAL_COUNT_TIMEOUT_MS = 5000;
    let runningInitialization = null, initializationDeferral = null, scheduledRun = null;
    let missingSectionSince = 0, blockedInitialization = null;
    let performanceDiagnostics = createPerformanceDiagnostics();

    function createPerformanceDiagnostics() {
        return {
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0 }
        };
    }

    function beginRunningSession(sessionToken) {
        session.assertRouteSession(sessionToken);
        dependencies.listMutations.start(sessionToken);
        initializationDeferral?.ticket.release({ resume: false });
        const owner = { sessionToken, ticket: dependencies.listMutations.deferReconciliation('initialization') };
        initializationDeferral = owner; runningInitialization = owner;
        return owner;
    }

    function clearRunningSession(sessionToken, retryMutations = true, expected = initializationDeferral) {
        if (runningInitialization?.sessionToken !== sessionToken || initializationDeferral !== expected) return;
        runningInitialization = null;
        initializationDeferral = null;
        expected?.ticket.release({ resume: retryMutations, reason: 'after-initialization' });
    }

    function initializationTimeoutError(stage, timeoutMs, details = {}) {
        return session.initializationError(
            'INITIALIZATION_TIMEOUT',
            stage,
            `Timeout at ${stage} after ${timeoutMs} ms`,
            { timeoutMs, ...details }
        );
    }

    async function waitForMyListTotalCount(timeout = TOTAL_COUNT_TIMEOUT_MS, sessionToken = null) {
        return dependencies.listView.waitForInitialCount({ timeout, sessionToken, now: () => performance.now(), pause: session.sleep,
            pollMs: NATIVE_READY_POLL_MS,
            read: () => ({ available: dependencies.listData.isAvailable(), count: dependencies.listData.detectMyListTotalCount() }),
            onTimeout({ available }) {
                const details = { graphqlAvailable: available, graphqlKey: dependencies.listData.diagnostics().graphqlKey,
                    domGeneration: dependencies.source.nativeSourceDiagnostics()?.carouselDom?.generation ?? null };
                dependencies.diagnostics.logOperationTimeout('total-count-detection', timeout, details);
                return initializationTimeoutError('total-count-detection', timeout, details);
            } });
    }

    function collectMountedSinglePageItems(bootstrap, totalCount, columns, sessionToken = null) {
        session.assertRouteSession(sessionToken);
        if (session.entryKind !== 'spa' || !session.entryReason.startsWith('route:')) {
            return { items: null, reason: 'proof-or-entry-no-longer-valid' };
        }
        return dependencies.nativeCarousel.collect({ mode: 'mounted-single-page', bootstrap, totalCount, columns, sessionToken,
            section: dependencies.source.current?.section, scroller: dependencies.source.current?.scroller, track: dependencies.source.current?.track });
    }

    async function tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken = null) {
        session.assertRouteSession(sessionToken);
        // Only normal SPA entry admits mounted reuse; manual recovery keeps fresh data.
        if (session.entryKind !== 'spa' || !session.entryReason.startsWith('route:')) return null;
        return dependencies.nativeCarousel.mountedBootstrap({ section, scroller, track, sessionToken });
    }

    function waitForNativeCarouselReady(section, scroller, track, sessionToken = null, options = {}) {
        const owner = dependencies.source.current;
        return dependencies.nativeCarousel.prepareSource({ section, scroller, track, sessionToken,
            fastSinglePageTotalCount: options.fastSinglePageTotalCount,
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (dependencies.source.current !== owner) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation',
                    'Page session source changed during native preparation');
            } });
    }

    async function collectAllItems(section, scroller, track, totalCount, sessionToken = null) {
        const state = dependencies.source.current;
        const result = await dependencies.nativeCarousel.collect({ section, scroller, track, totalCount,
            columns: state?.layout?.columns, sessionToken, onProgress(facts) {
                if (dependencies.source.current !== state) return;
                if (facts.initialPage !== undefined && state) dependencies.source.acceptInitialPage(state, facts.initialPage);
                if (facts.collectedCount !== undefined) {
                    if (state) dependencies.source.ensureListMembership(state).observeCount({ collectedCount: facts.collectedCount });
                    dependencies.presentation.updateStatus(dependencies.presentation.formatHeaderParts(facts.collectedCount, totalCount, null));
                }
            } });
        return result.items;
    }

    function recoverNativeInitialization(sessionToken, reason) {
        const failure = blockedInitialization?.native;
        if (!failure || failure.sessionToken !== sessionToken || !session.isRouteSessionActive(sessionToken)) return false;
        if (performanceDiagnostics.nativeRecovery.attempts >= 1) {
            if (!failure.exhaustedReported) {
                failure.exhaustedReported = true;
                performanceDiagnostics.nativeRecovery.exhausted++;
                log(tLog('nativeInitializationRecoveryExhausted'), { sessionToken, reason, maxAttempts: 1 });
            }
            return false;
        }
        try {
            const discovered = dependencies.source.nativeDiscoveryObservation({ bindingOnly: true });
            const { section, scroller, track } = discovered;
            if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected ||
                !section.contains(scroller) || !scroller.contains(track) ||
                (section === failure.section && scroller === failure.scroller && track === failure.track)) return false;

            dependencies.hover.cancel('source');
            dependencies.nativeCarousel.assertObservation(discovered);
            if (blockedInitialization?.native !== failure) return false;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            return false;
        }

        performanceDiagnostics.nativeRecovery.attempts++;
        dependencies.listMutations.deferPending();
        session.cleanupTargetSessionDom();
        dependencies.responsive.dispose();
        dependencies.nativeCarousel.clearBinding();
        dependencies.source.publishSourceState(null);
        dependencies.source.complete(null);
        blockedInitialization = null;
        clearRunningSession(sessionToken, false);
        dependencies.nativeCarousel.refreshDiscovery();
        // A replacement may have a different membership/count. Use the existing
        // fresh SPA bootstrap rather than an old initial-page cache on this retry.
        session.useFreshEntry();
        log(tLog('nativeInitializationRecovered'), {
            sessionToken, reason, attempt: performanceDiagnostics.nativeRecovery.attempts,
            pendingMutations: dependencies.listMutations.pendingIntents().length
        });
        scheduleRun(40, sessionToken);
        return true;
    }

    async function runScript(sessionToken = session.scope.token) {
        if (!session.isRouteSessionActive(sessionToken)) return;
        if (blockedInitialization?.sessionToken === sessionToken) {
            recoverNativeInitialization(sessionToken, 'run');
            return;
        }
        if (runningInitialization?.sessionToken === sessionToken) return;
        let discovered;
        try {
            discovered = dependencies.source.nativeDiscoveryObservation({ bindingOnly: true });
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            if (session.isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }
        let section = discovered.section;
        if (!section) {
            if (dependencies.source.waitingForEmpty && dependencies.source.current?.empty) {
                return;
            }
            const now = performance.now();
            if (!missingSectionSince) missingSectionSince = now;
            const elapsed = now - missingSectionSince;
            if (elapsed < NATIVE_EMPTY_STABLE_MS) {
                scheduleRun(Math.max(40, NATIVE_EMPTY_STABLE_MS - elapsed), sessionToken);
                return;
            }
            section = dependencies.source.ensureSyntheticMyListSection(discovered);
            if (!section) {
                scheduleRun(120, sessionToken);
                return;
            }
        } else {
            missingSectionSince = 0;
            dependencies.gridView.removeSynthetic(section);
        }
        if (dependencies.source.completed === section && document.getElementById(GRID_ID) && !dependencies.source.current?.empty) return;

        try {
            dependencies.nativeCarousel.assertObservation(discovered);
            dependencies.source.cleanupOldArtifacts();
            dependencies.nativeCarousel.assertObservation(discovered);
            dependencies.gridView.installResources(() => { session.assertRouteSession(sessionToken); dependencies.nativeCarousel.assertObservation(discovered); });
            dependencies.source.markOriginalHeader(section);
            dependencies.nativeCarousel.assertObservation(discovered);
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            if (session.isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }

        const initializationStarted = performance.now();
        let mountedSource, scroller, track;
        let provisionalLayout, provisionalFrame;
        try {
            mountedSource = dependencies.source.nativeDiscoveryObservation({ bindingOnly: true });
            if (mountedSource.section && mountedSource.section !== section) {
                throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Initialization source was replaced');
            }
            scroller = mountedSource.section === section ? mountedSource.scroller : null;
            track = mountedSource.section === section ? mountedSource.track : null;
            dependencies.nativeCarousel.sample(() => {
                const observed = dependencies.source.nativeLayoutObservation(section, scroller, track);
                provisionalLayout = { ...observed.layout };
                provisionalLayout.rowGap = dependencies.source.measureNativeCarouselGap(section);
                dependencies.nativeCarousel.assertObservation(observed);
                provisionalFrame = dependencies.presentation.placeLegacyFrame(section, scroller, provisionalLayout, { elapsedMs: null, finalized: false, totalCount: null });
                dependencies.nativeCarousel.assertObservation(observed);
                dependencies.nativeCarousel.assertObservation(mountedSource);
            });
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            if (session.isRouteSessionActive(sessionToken)) scheduleRun(0, sessionToken);
            return;
        }
        dependencies.source.publishNativeParent({ section, scroller, track,
            layout: provisionalLayout,
            items: [],
            collectedCount: 0,
            totalCount: null,
            grid: provisionalFrame.grid,
            status: provisionalFrame.status,
            empty: false,
            resizeViewportSignature: dependencies.responsive.viewportSignature(),
            initializationStartedAt: initializationStarted
        });
        dependencies.source.applyOriginalMyListVisibility();

        const initializationOwner = beginRunningSession(sessionToken);
        session.assertRouteSession(sessionToken);
        let earlyTotalCount;
        let freshMyListBootstrap = null, entryCollection;
        let fastCollection = null;
        let fastCollectionSource = 'graphql';
        const entryParent = dependencies.source.current;
        function finishInitialization({ resume = true, retry = null } = {}) {
            clearRunningSession(sessionToken, resume, initializationOwner);
            if (!session.isRouteSessionActive(sessionToken)) return;
            if (retry === 'scheduled') scheduleRun(0, sessionToken);
            else if (retry === 'immediate') runScript(sessionToken);
        }
        function blockFailure(error, stage, timeoutMs, totalCount) {
            blockedInitialization = { sessionToken };
            dependencies.diagnostics.reportInitializationFailure(error, { stage: error?.stage || stage,
                timeoutMs: error?.details?.timeoutMs ?? timeoutMs, details: error?.details || null });
            dependencies.presentation.updateStatus(dependencies.presentation.formatInitializationErrorMeta(error, totalCount));
        }
        function finishEmpty(reason, preparation = null) {
            try {
                if (preparation) dependencies.nativeCarousel.assertPreparation(preparation);
                dependencies.nativeCarousel.sample(() => {
                    const observed = dependencies.source.nativeLayoutObservation(section, scroller, track);
                    const layout = { ...observed.layout, rowGap: dependencies.source.measureNativeCarouselGap(section) };
                    dependencies.nativeCarousel.assertObservation(observed);
                    dependencies.source.finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted,
                        preparation ? preparation.reason : reason, observed);
                });
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
                finishInitialization({ resume: false, retry: 'scheduled' });
                return;
            }
            finishInitialization();
        }
        try {
            entryCollection = await dependencies.listView.prepareEntry({ entryKind: session.entryKind, sessionToken,
                hasNativeSource: Boolean(scroller && track),
                readMountedBootstrap: () => tryMountedSinglePageFastBootstrap(section, scroller, track, sessionToken),
                readMountedCards() {
                    const mounted = dependencies.source.nativePageObservation();
                    dependencies.nativeCarousel.assertObservation(mounted);
                    return mounted.cards.length;
                },
                startReadiness: () => waitForNativeCarouselReady(section, scroller, track, sessionToken),
                onCount: detail => log(tLog('totalCountDetected'), detail),
                assertCurrent() {
                    if (dependencies.source.current !== entryParent) throw session.initializationError('NATIVE_SOURCE_REPLACED',
                        'list-entry', 'List entry parent changed during source selection');
                } });
            freshMyListBootstrap = entryCollection.bootstrap;
            earlyTotalCount = entryCollection.totalCount;
            session.assertRouteSession(sessionToken);
        } catch (error) {
            if (error?.code === 'NATIVE_SOURCE_REPLACED') {
                log('Initial native card observation discarded after source replacement', { sessionToken });
                finishInitialization({ resume: false, retry: 'scheduled' });
                return;
            }
            if (!session.isRouteSessionCancelledError(error)) {
                blockFailure(error, 'total-count-detection', TOTAL_COUNT_TIMEOUT_MS, null);
            }
            finishInitialization();
            return;
        }
        if (earlyTotalCount === 0) return finishEmpty('totalCount-0');

        // The My List heading can exist before the carousel itself. totalCount is
        // already authoritative here: a positive count must produce a native source,
        // otherwise initialization fails instead of being mistaken for an empty list.
        if (!scroller || !track) {
            let sourceWait;
            try {
                sourceWait = await dependencies.nativeCarousel.waitForSource(section, NATIVE_READY_TIMEOUT_MS, sessionToken);
            } catch (error) {
                if (!session.isRouteSessionCancelledError(error)) {
                    warn(tLog('nativeSourceWaitFailed'), error);
                }
                finishInitialization();
                return;
            }
            session.assertRouteSession(sessionToken);
            if (sourceWait.nativeSection) {
                dependencies.nativePopup.invalidate();
                dependencies.gridView.dispose();
                dependencies.nativeCarousel.clearBinding();
                dependencies.source.publishSourceState(null);
                dependencies.source.complete(null);
                finishInitialization({ retry: 'scheduled' });
                return;
            }
            if (!sourceWait.found) {
                const error = initializationTimeoutError(sourceWait.stage || 'native-source', sourceWait.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: sourceWait.elapsedMs,
                    totalCount: earlyTotalCount
                });
                blockedInitialization = { sessionToken, native: { section, scroller, track, sessionToken } };
                dependencies.diagnostics.reportInitializationFailure(error, {
                    stage: error.stage,
                    timeoutMs: error.details?.timeoutMs ?? null,
                    details: error.details || null,
                });
                dependencies.presentation.updateStatus(dependencies.presentation.formatInitializationErrorMeta(error, earlyTotalCount));
                finishInitialization({ resume: false });
                recoverNativeInitialization(sessionToken, 'native-source-wait');
                return;
            }
            scroller = sourceWait.scroller;
            track = sourceWait.track;
            dependencies.source.attachNativeBinding(dependencies.source.current, section, scroller, track);
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
                finishInitialization({ resume: false });
                recoverNativeInitialization(sessionToken, 'readiness-source-replaced');
                return;
            }
            if (!session.isRouteSessionCancelledError(error)) {
                warn(tLog('nativeCarouselReadinessCheckFailed'), error);
            }
            finishInitialization();
            return;
        }
        if (!readiness.ready) {
            blockedInitialization = { sessionToken, native: { section, scroller, track, sessionToken } };
            finishInitialization({ resume: false });
            if (recoverNativeInitialization(sessionToken, 'readiness-' + readiness.reason)) return;
            const readinessError = readiness.reason === 'timeout'
                ? initializationTimeoutError(readiness.stage || 'native-carousel-readiness', readiness.timeoutMs || NATIVE_READY_TIMEOUT_MS, {
                    elapsedMs: readiness.elapsedMs,
                    state: readiness.state
                })
                : session.initializationError('NATIVE_CAROUSEL_NOT_READY', 'native-carousel-readiness', `Native carousel not ready: ${readiness.reason}`, readiness);
            dependencies.diagnostics.reportInitializationFailure(readinessError, {
                stage: readinessError.stage,
                timeoutMs: readinessError.details?.timeoutMs ?? null,
            });
            dependencies.presentation.updateStatus(dependencies.presentation.formatInitializationErrorMeta(readinessError, earlyTotalCount));
            return;
        }
        if (readiness.empty) return finishEmpty(null, readiness);
        const mountedMode = dependencies.source.nativeSourceObservation()?.mode || 'unknown';

        // A manual/order-mismatch reinitialization can start while Netflix still has
        // page 0 selected with a one-card-shifted mounted window after a My List delta.
        // The fresh CarouselPage response gives us an authoritative first video ID.
        // Normalize only legacy/indicator SPA sessions, before source-scan mode starts,
        // so normal initial-load performance and logical/Hawkins behavior are untouched.
        {
            try {
                await entryCollection.prepareAnchor({ mode: mountedMode, normalize: firstVideoId =>
                    dependencies.nativeCarousel.anchorPageZero({ section, scroller, track, firstVideoId, sessionToken,
                        columns: dependencies.source.current?.layout?.columns }) });
            } catch (error) {
                if (!session.isRouteSessionCancelledError(error)) {
                    blockFailure(error, 'normalize-native-page-zero', null, earlyTotalCount);
                }
                finishInitialization();
                return;
            }
        }

        {
            const countOwner = dependencies.source.current;
            try {
                let countObservation;
                const mountedCount = entryCollection.confirmCount({ mode: mountedMode, readNativeCount() {
                    countObservation = dependencies.source.nativeSourceObservation(countOwner, { count: 'required', provisionalTotalCount: earlyTotalCount });
                    return countObservation.count;
                }, assertNativeCurrent: () => dependencies.nativeCarousel.assertObservation(countObservation) });
                if (mountedCount) {
                    const mountedTotalCount = mountedCount.totalCount;
                    if (mountedCount.changed) {
                        warn('Netflix My List totalCount reconciled from mounted carousel', {
                            provisionalTotalCount: earlyTotalCount, mountedTotalCount,
                            readings: mountedCount.readings, entryKind: session.entryKind,
                            provisionalSource: mountedCount.provisionalSource
                        });
                    } else {
                        log('Netflix My List mounted totalCount confirmed', {
                            totalCount: mountedTotalCount, readings: mountedCount.readings, entryKind: session.entryKind
                        });
                    }
                    mountedCount.assertCurrent();
                    earlyTotalCount = mountedTotalCount;
                    dependencies.source.ensureListMembership(countOwner).observeCount({ totalCount: mountedTotalCount }, { assertCurrent: mountedCount.assertCurrent });
                }
            } catch (error) {
                if (error?.code === 'NATIVE_SOURCE_REPLACED' || dependencies.source.current !== countOwner) {
                    finishInitialization({ resume: false });
                    if (!recoverNativeInitialization(sessionToken, 'native-count-source-replaced')) scheduleRun(0, sessionToken);
                    return;
                }
                if (!session.isRouteSessionCancelledError(error)) {
                    blockFailure(error, 'native-react-total-count', null, earlyTotalCount);
                }
                finishInitialization();
                return;
            }
        }

        {
            let graphqlGeometry, graphqlLayout, templateView;
            try {
                const preferred = await dependencies.listView.preparePreferred({ mode: mountedMode, bootstrap: freshMyListBootstrap,
                    sessionToken, assertCurrent: () => dependencies.nativeCarousel.assertPreparation(readiness),
                    readInput() {
                        graphqlGeometry = dependencies.source.nativeLayoutObservation(section, scroller, track);
                        graphqlLayout = graphqlGeometry.layout;
                        templateView = dependencies.source.nativePageObservation(dependencies.source.current, { template: true });
                        dependencies.nativeCarousel.assertObservation(templateView);
                        dependencies.nativeCarousel.assertObservation(graphqlGeometry);
                        return { totalCount: earlyTotalCount, columns: graphqlLayout.columns,
                            templateSource: templateView.template, assertCurrent: () => dependencies.nativeCarousel.assertObservation(templateView) };
                    },
                    onPrepared(result) {
                        const source = result.collectionSource || 'graphql';
                        dependencies.nativeCarousel.assertObservation(graphqlGeometry);
                        const accepted = dependencies.nativeCarousel.acceptCollection({ preparation: readiness,
                            totalCount: earlyTotalCount, columns: graphqlLayout.columns, collectedCount: result.items.length });
                        log(source === 'mounted-single-page'
                            ? 'Mounted single-page My List fast collection prepared' : 'GraphQL My List fast collection prepared', {
                            collectionSource: source, avoidedMembershipRequests: source === 'mounted-single-page' ? 1 : 0,
                            totalCount: earlyTotalCount, collected: result.items.length,
                            graphqlPageCount: result.bootstrap.pageCount || null, columns: graphqlLayout.columns,
                            knownPageCount: accepted.knownPageCount
                        });
                        dependencies.nativeCarousel.assertMapping(accepted);
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
                fastCollection = preferred;
                fastCollectionSource = preferred.collectionSource || 'graphql';
            } catch (error) {
                if (session.isRouteSessionCancelledError(error)) {
                    finishInitialization();
                    return;
                }
                if (error?.code === 'NATIVE_SOURCE_REPLACED' || !dependencies.nativeCarousel.isPreparationCurrent(readiness)) {
                    log('Fast My List collection discarded after native source replacement', { sessionToken });
                    finishInitialization({ resume: false, retry: 'scheduled' });
                    return;
                }
                fastCollection = null;
                warn('GraphQL My List fast collection failed; falling back to native scan', {
                    code: error?.code || null, stage: error?.stage || 'graphql-fast-collection', error
                });
            }
        }

        const initializationNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
        log(tLog('initializationStarted'), {
            version: session.version,
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

        let initializationRetry = null;
        try {
            const layoutObservation = dependencies.source.nativeLayoutObservation(section, scroller, track);
            const layout = { ...layoutObservation.layout, rowGap: dependencies.source.measureNativeCarouselGap(section) };
            const totalCount = earlyTotalCount;
            const measuredNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
            const initialPages = measuredNative?.pageCount ?? null;
            log(tLog('initialLayoutMeasured'), {
                layout: dependencies.diagnostics.layoutSummary(layout),
                totalCount,
                initialPages,
                selectedPage: measuredNative?.selectedPage ?? null,
                currentPageCards: measuredNative?.currentPageCards ?? 0
            });
            dependencies.nativeCarousel.assertObservation(layoutObservation);

            const status = dependencies.presentation.updateStatus(dependencies.presentation.formatHeaderParts(0, totalCount, null));
            dependencies.gridView.placeStatus(status, { section, anchor: scroller,
                assertCurrent: () => dependencies.nativeCarousel.assertObservation(layoutObservation) });
            dependencies.source.syncStatusTypography(section, status);
            const initialStatusGeometry = dependencies.source.currentGridGeometry(section, layout);
            dependencies.source.layoutFrameStatus(status, initialStatusGeometry, layout.rowGap);
            dependencies.nativeCarousel.assertObservation(layoutObservation);

            // Fast collection skips source-scan presentation, but hover-driven native
            // moves still need the track marker used by the animation suppression CSS.
            dependencies.source.nativeSourcePresentation(section, scroller, track, { phase: 'mounted' });
            dependencies.source.waitForEmpty(false);
            dependencies.source.publishNativeParent({ section, scroller, track, layout,
                initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount });
            const collectionState = dependencies.source.current;
            const collectionBinding = dependencies.nativeCarousel.borrowBinding(section, scroller, track);
            const assertCollectionCurrent = () => {
                session.assertRouteSession(sessionToken);
                dependencies.nativeCarousel.assertBinding(collectionBinding);
                if (dependencies.source.current !== collectionState) throw session.initializationError('NATIVE_SOURCE_REPLACED',
                    'native-collection', 'Collection parent was replaced');
            };
            let emptyObservation;
            const collected = await dependencies.listView.collectForPublication({ preferred: fastCollection, totalCount, sessionToken,
                assertCurrent: assertCollectionCurrent,
                onPreferred(items) {
                    const fastNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
                    log(fastCollectionSource === 'mounted-single-page'
                        ? 'Mounted single-page My List fast collection used' : 'GraphQL My List fast collection used', {
                        collectionSource: fastCollectionSource, collected: items.length, totalCount,
                        pages: fastNative?.pageCount ?? null, sourceCards: fastNative?.sourceCards ?? 0,
                        carouselDom: fastNative?.carouselDom ?? null
                    });
                },
                beforeNative() {
                    // Keep native layout and slot detection intact while scanning.
                    dependencies.source.nativeSourcePresentation(section, scroller, track, { phase: 'scan' });
                    const scanNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
                    log(tLog('nativeCarouselScanModeStarted'), {
                        selectedPage: scanNative?.selectedPage ?? null, pages: scanNative?.pageCount ?? null,
                        sourceSlots: scanNative?.sourceSlots ?? 0, sourceCards: scanNative?.sourceCards ?? 0,
                        carouselDom: scanNative?.carouselDom ?? null
                    });
                },
                collectNative: () => collectAllItems(section, scroller, track, totalCount, sessionToken),
                readEmpty() {
                    emptyObservation = dependencies.nativeCarousel.observeSource({ section, scroller, track, binding: collectionBinding,
                        sessionToken, readiness: true, assertCurrent: assertCollectionCurrent });
                    const facts = emptyObservation.readiness;
                    dependencies.nativeCarousel.assertObservation(emptyObservation);
                    return facts;
                },
                createFailure(facts) {
                    if (facts.code === 'NO_NATIVE_CARDS') return Object.assign(new Error(tLog('noNativeNetflixCardsCouldBeCollected')),
                        { code: facts.code });
                    const error = session.initializationError(facts.code, 'validate-count',
                        `Collected ${facts.collected} of ${facts.totalCount} My List items`,
                        { collected: facts.collected, totalCount: facts.totalCount,
                            endingPage: dependencies.source.nativeSourceDiagnostics(section, scroller, track)?.selectedPage ?? null });
                    warn(tLog('collectedCountDoesNotMatchTotalCount'), {
                        collected: facts.collected, totalCount: facts.totalCount, stage: error.stage, code: error.code
                    });
                    return error;
                } });
            assertCollectionCurrent();
            if (collected.status === 'empty') {
                dependencies.nativeCarousel.assertObservation(emptyObservation);
                dependencies.source.finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, 'collection-confirmed-empty', emptyObservation);
                return;
            }
            const items = collected.transfer.records;

            log(tLog('fullCollectionResultFinalized'), {
                collected: items.length,
                totalCount,
                endingPage: dependencies.source.nativeSourceDiagnostics(section, scroller, track)?.selectedPage ?? null,
                items: items.map(dependencies.diagnostics.itemSummary)
            });
            assertCollectionCurrent();

            // Keep the native carousel at its normal position and size for React resynchronization.
            dependencies.source.nativeSourcePresentation(section, scroller, track, { phase: 'parked' });
            const standbyNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
            log(tLog('nativeCarouselStandbyMode'), {
                selectedPage: standbyNative?.selectedPage ?? null,
                parked: standbyNative?.sourceParked ?? false
            });
            assertCollectionCurrent();
            await dependencies.presentation.buildGrid(section, scroller, collected.transfer, layout, totalCount, sessionToken);
            session.assertRouteSession(sessionToken);
            dependencies.source.acceptEmpty(dependencies.source.current, false);
            dependencies.source.applyOriginalMyListVisibility();

            // Defer React-backed hover preparation until the first actual hover.
            // The live native card is resolved on demand, keeping initialization off the hover path.
            const deferredNative = dependencies.source.nativeSourceDiagnostics(section, scroller, track);
            log(tLog('initialHoverPreparationDeferred'), {
                selectedPage: deferredNative?.selectedPage ?? null,
                currentPageCards: deferredNative?.currentPageCards ?? 0
            });
            if (dependencies.source.current) dependencies.source.ensureListMembership(dependencies.source.current).observeCount({ collectedCount: items.length, totalCount });
            dependencies.source.complete(section);
            if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) {
                performanceDiagnostics.nativeRecovery.completed++;
            }
            dependencies.interaction.resetOrderMismatchStateAfterInitialization();
            dependencies.source.acceptElapsed(dependencies.source.current, performance.now() - initializationStarted);
            dependencies.presentation.updateStatus(dependencies.presentation.formatHeaderParts(items.length, totalCount, dependencies.source.current.initializationElapsedMs, true));

            dependencies.presentation.initializeWatchGroups(dependencies.source.current, sessionToken);

            log(tLog('initializationCompleted'), {
                collected: items.length,
                totalCount,
                    initialPages,
                initialColumns: layout.columns,
                initialCardWidth: layout.cardWidth,
                initializationElapsedMs: Math.round(dependencies.source.current.initializationElapsedMs),
                snapshot: dependencies.diagnostics.collectRuntimeSnapshot()
            });
        } catch (error) {
            if (session.isRouteSessionCancelledError(error)) {
                log(tLog('initializationCancelledByRouteChange'), {
                    sessionToken,
                    url: location.href
                });
            } else if (error?.code === 'NATIVE_SOURCE_REPLACED') {
                log('Native collection discarded after source replacement', { sessionToken });
                initializationRetry = 'scheduled';
            } else if (error?.code === 'GRID_BUILD_SOURCE_REPLACED') {
                log('Grid construction discarded after native source replacement', { sessionToken });
                session.cleanupTargetSessionDom();
                dependencies.nativeCarousel.clearBinding();
                dependencies.source.publishSourceState(null);
                dependencies.source.complete(null);
                initializationRetry = 'immediate';
            } else {
                blockFailure(error, null, null, earlyTotalCount);
            }
        } finally {
            // Keep queued deltas deferred until the replacement source has a
            // complete grid, rather than applying them to an incomplete frame.
            finishInitialization({ resume: !initializationRetry, retry: initializationRetry });
        }
    }

    function scheduleRun(delayMs = 40, sessionToken = session.scope.token) {
        if (!session.isRouteSessionActive(sessionToken)) return;
        if (blockedInitialization?.sessionToken === sessionToken) return;
        const normalizedDelay = Math.max(0, delayMs);
        const dueAt = performance.now() + normalizedDelay;
        // Keep the earliest run; DOM discovery can pull a fallback wait forward.
        if (scheduledRun?.sessionToken === sessionToken && scheduledRun.dueAt > 0 && scheduledRun.dueAt <= dueAt + 1) return;
        if (scheduledRun) clearTimeout(scheduledRun.timer);
        const owner = { sessionToken, dueAt, timer: null };
        scheduledRun = owner;
        owner.timer = setTimeout(() => {
            if (scheduledRun !== owner || session.disposed) return;
            scheduledRun = null;
            if (!session.isRouteSessionActive(sessionToken)) return;
            runScript(sessionToken);
        }, normalizedDelay);
    }

    return Object.freeze({ get running() { return runningInitialization ? Object.freeze({ sessionToken: runningInitialization.sessionToken }) : null; },
        get hasWork() { return Boolean(runningInitialization || scheduledRun); },
        isBlocked: token => blockedInitialization?.sessionToken === token,
        isNativeBlocked: token => blockedInitialization?.native?.sessionToken === token,
        workCounters: () => ({ nativeRecovery: { ...performanceDiagnostics.nativeRecovery } }),
        resetMissingSourceWait() { missingSectionSince = 0; },
        markRecoveryCompleted() { if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) performanceDiagnostics.nativeRecovery.completed++; },
        begin() { blockedInitialization = null; performanceDiagnostics = createPerformanceDiagnostics(); },
        dropDeferral() { initializationDeferral = null; },
        cancelScheduled() { if (scheduledRun) clearTimeout(scheduledRun.timer); scheduledRun = null; },
        retire() { runningInitialization = null; blockedInitialization = null; missingSectionSince = 0; },
        waitForMyListTotalCount, collectMountedSinglePageItems, recoverNativeInitialization, scheduleRun });
}
