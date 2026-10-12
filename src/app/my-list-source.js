import { GRID_ID, STATUS_ID, SYNTHETIC_SECTION_ID } from '../dom-names.js';

export function createMyListSource(dependencies) {
    const { environment, i18n, logger, settings, session } = dependencies;
    const { document, window, performance } = environment;
    const { tLog } = i18n;
    const { log } = logger;
    let sourceState = null, completedSection = null, waitingForNativeEmpty = false;
    let nativePresentationLease = null;
    const parents = new WeakMap();
    const fields = ['section', 'scroller', 'track', 'layout', 'grid', 'status', 'items', 'itemMap', 'cloneMap',
        'totalCount', 'collectedCount', 'empty', 'resizeViewportSignature', 'initialPage',
        'initializationStartedAt', 'initializationElapsedMs', 'nativePageHints', 'listMembership'];
    function owned(parent) { return parents.get(parent) || parent; }
    function parentView(value) {
        if (!value || parents.has(value)) return value;
        value = Object.defineProperties({}, Object.getOwnPropertyDescriptors(value));
        const view = Object.defineProperties({}, Object.fromEntries(fields.map(key =>
            [key, { enumerable: true, get: () => value[key] }])));
        Object.defineProperty(view, 'watchStatus', { enumerable: true, get: () => dependencies.presentation.watchFor(view) });
        parents.set(view, value); return Object.freeze(view);
    }
    function accept(parent) {
        if (!parent || parent !== sourceState) throw session.createRouteSessionCancelledError();
        return owned(parent);
    }

    // Publish the replacement before retiring the exact previous parent.
    function publishSourceState(next) {
        const previous = sourceState;
        next = parentView(next);
        sourceState = next;
        if (previous !== next) { dependencies.presentation.retireViewing(previous); previous?.listMembership?.dispose(); previous?.nativePageHints?.dispose(); }
        return next;
    }

    function publishNativeParent({ section, scroller = null, track = null, ...facts }) {
        return publishSourceState(attachNativeBinding(facts, section, scroller, track));
    }

    // Stage and accept membership, page hints and the grid as one publication.
    // The rendering owner calls commit synchronously inside its acceptance callback.
    function stageGridPublication(parent, transfer, totalCount, { assertCurrent }) {
        const membership = ensureListMembership(parent).preparePublication(transfer.records, totalCount, { assertCurrent });
        const hints = ensurePageHints(parent).stage(transfer.records, transfer.readPage, { assertCurrent });
        const assertActive = () => { assertCurrent(); membership.assertCurrent(); hints.assertCurrent(); };
        return Object.freeze({ assertCurrent: assertActive, readPage: record => hints.get(record),
            commit({ grid, status, layout }) {
                membership.commit(); hints.commit(); attachGridRegistry(parent);
                Object.assign(accept(parent), { grid, status, layout });
            },
            discard: hints.discard });
    }

    function ensurePageHints(state) {
        const value = owned(state);
        if (value.nativePageHints) return value.nativePageHints;
        const hints = dependencies.nativeCarousel.createPageHints({ assertCurrent() {
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
        } });
        Object.defineProperty(value, 'nativePageHints', { value: hints, configurable: true });
        return hints;
    }

    function pageForItem(item) {
        return dependencies.nativeCarousel.preferredPage({ record: item, hints: sourceState ? ensurePageHints(sourceState) : null,
            records: sourceState?.items || [], columns: sourceState?.layout?.columns || 1 });
    }

    function setPageForItem(item, page, state = sourceState, admission = {}) {
        ensurePageHints(state).set(item, page, admission);
    }

    function ensureListMembership(state) {
        state = owned(state);
        if (state.listMembership) return state.listMembership;
        const membership = dependencies.listView.createMembership({ items: state.items || [], totalCount: state.totalCount ?? null,
            collectedCount: state.collectedCount ?? 0 });
        Object.defineProperty(state, 'listMembership', { value: membership, configurable: true });
        for (const [field, owned] of [['items', 'records'], ['itemMap', 'lookup'], ['totalCount', 'expectedCount'], ['collectedCount', 'collectedCount']])
            Object.defineProperty(state, field, { enumerable: true, configurable: true, get: () => membership[owned] });
        return membership;
    }

    function attachNativeBinding(state, section, scroller = null, track = null) {
        ensureListMembership(state);
        const value = parents.has(state) ? accept(state) : owned(state);
        const binding = dependencies.nativeCarousel.bind(section, scroller, track);
        for (const key of ['section', 'scroller', 'track']) Object.defineProperty(value, key,
            { enumerable: true, configurable: true, get: () => binding[key] });
        return state;
    }

    function nativeSourcePresentation(section = sourceState?.section, scroller, track, options = {}) {
        const state = sourceState, sessionToken = session.scope.token;
        const ownerSection = state?.section, ownerScroller = state?.scroller, ownerTrack = state?.track;
        if (state && state.section === section) {
            if (scroller === undefined) scroller = state.scroller;
            if (track === undefined) track = state.track;
        }
        const lease = dependencies.nativeCarousel.presentSource({ section, scroller, track, ...options, sessionToken, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== ownerSection || state?.scroller !== ownerScroller || state?.track !== ownerTrack) {
                throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Native presentation caller changed');
            }
        } });
        if (lease !== nativePresentationLease) nativePresentationLease?.release();
        lease?.assertCurrent();
        nativePresentationLease = lease;
        return lease;
    }

    function markOriginalHeader(section, scroller, track) {
        return nativeSourcePresentation(section, scroller, track)?.anchor || null;
    }

    function applyOriginalMyListVisibility() {
        if (!sourceState?.section && !session.isTargetPage()) return;
        if (!nativeSourcePresentation(undefined, undefined, undefined, { visible: settings.preferences().viewOriginalMyList })) return;
        if (sourceState?.status) {
            layoutFrameStatus(sourceState.status, null, settings.preferences().viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0);
        }
    }

    function cleanupOldArtifacts() {
        const state = sourceState, sessionToken = session.scope.token;
        dependencies.gridView.cleanupArtifacts(() => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
        });
        dependencies.nativeCarousel.cleanupArtifacts({ sessionToken, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Artifact cleanup caller changed');
        } });
    }

    function measureNativeCarouselGap(section) {
        const state = sourceState, sessionToken = session.scope.token;
        const gap = dependencies.netflixDom.readRowGap(section, window.innerWidth);
        session.assertRouteSession(sessionToken);
        if (sourceState !== state) throw session.createRouteSessionCancelledError();
        return gap;
    }

    function nativeLayoutObservation(section, scroller = null, track = null, mode = 'auto', state = sourceState) {
        const sessionToken = session.scope.token;
        const ownerSection = state?.section, ownerScroller = state?.scroller, ownerTrack = state?.track;
        const grid = state?.grid, layout = state?.layout, status = state?.status;
        const gridConnected = Boolean(grid?.isConnected);
        return dependencies.nativeCarousel.measureLayout({ section, scroller, track, mode, sessionToken, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== ownerSection || state?.scroller !== ownerScroller ||
                state?.track !== ownerTrack || state?.grid !== grid || state?.layout !== layout || state?.status !== status ||
                (gridConnected && !grid.isConnected)) {
                throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Native layout caller was replaced');
            }
        } });
    }

    function applyLegacyEmptyStateGeometry(section, layout) {
        if (!dependencies.gridView.emptyPresentation().connected || !section || !layout) return;
        const state = sourceState, sessionToken = session.scope.token;
        const geometry = currentGridGeometry(section, layout);
        dependencies.gridView.layoutEmpty(geometry, () => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
        });
    }

    function syncLegacyEmptyState(section, { allowProvisional = false } = {}) {
        const state = sourceState, sessionToken = session.scope.token;
        const binding = state?.section === section ? dependencies.nativeCarousel.borrowBinding(section, state.scroller, state.track) : null;
        const geometry = state?.layout ? currentGridGeometry(section, state.layout) : null;
        return dependencies.gridView.presentEmpty({ section, allowProvisional, geometry, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
            if (binding) dependencies.nativeCarousel.assertBinding(binding);
        } });
    }

    function finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, reason = 'empty', admission = null) {
        if (admission) dependencies.nativeCarousel.assertObservation(admission);
        dependencies.gridView.clearCards(() => { if (admission) dependencies.nativeCarousel.assertObservation(admission); });
        const elapsedMs = performance.now() - initializationStarted;
        const frame = dependencies.presentation.placeLegacyFrame(section, scroller, layout, { elapsedMs, finalized: true, totalCount: 0 });
        if (admission) dependencies.nativeCarousel.assertObservation(admission);
        dependencies.gridView.setEmpty(true);
        nativeSourcePresentation(section, scroller, track, { phase: 'parked' });
        publishSourceState(attachNativeBinding({
            layout,
            items: [],
            totalCount: 0,
            grid: frame.grid,
            status: frame.status,
            itemMap: new Map(),
            empty: true,
            resizeViewportSignature: dependencies.responsive.viewportSignature(),
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        }, section, scroller || null, track || null));
        attachGridRegistry(sourceState);
        waitingForNativeEmpty = false;
        syncLegacyEmptyState(section, { allowProvisional: true });
        completedSection = section;
        dependencies.initialization.markRecoveryCompleted();
        dependencies.interaction.resetOrderMismatchStateAfterInitialization();
        applyOriginalMyListVisibility();
        dependencies.responsive.observe('native-empty');
        log(tLog('emptyLegacyListFinalized'), {
            reason,
            elapsedMs: Math.round(elapsedMs),
            layout: dependencies.diagnostics.layoutSummary(layout)
        });
    }

    function nativeDiscoveryObservation({ bindingOnly = false } = {}) {
        const state = sourceState, sessionToken = session.scope.token;
        const section = state?.section, scroller = state?.scroller, track = state?.track;
        const grid = state?.grid, layout = state?.layout;
        return dependencies.nativeCarousel.discoverSource({ bindingOnly, sessionToken, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== section || state?.scroller !== scroller || state?.track !== track ||
                state?.grid !== grid || state?.layout !== layout) {
                throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Discovery caller was replaced');
            }
        } });
    }

    function ensureSyntheticMyListSection(admission) {
        const state = sourceState, sessionToken = session.scope.token;
        const guard = () => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
            if (admission) dependencies.nativeCarousel.assertObservation(admission);
        };
        guard();
        const placement = dependencies.netflixDom.readSyntheticPlacement();
        guard();
        return dependencies.gridView.ensureSynthetic(placement, guard);
    }

    function moveLegacyFrameToSyntheticEmpty() {
        if (!sourceState) return false;
        const state = sourceState;
        const live = nativeDiscoveryObservation();
        if (live.section && !live.scroller && !live.track) {
            return adoptLiveMyListSection(live, true);
        }
        const synthetic = ensureSyntheticMyListSection(live);
        if (!synthetic) return false;
        dependencies.nativeCarousel.assertObservation(live);
        const status = state.status || document.getElementById(STATUS_ID);
        const grid = state.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const observed = nativeLayoutObservation(synthetic, null, null, 'empty', state);
        const layout = { ...observed.layout };
        layout.rowGap = measureNativeCarouselGap(synthetic);
        dependencies.nativeCarousel.assertObservation(observed);
        dependencies.gridView.clearEmpty({ restoreGrid: false });
        dependencies.nativeCarousel.assertObservation(observed);
        const geometry = currentGridGeometry(synthetic, layout);
        dependencies.gridView.mount({ section: synthetic, status, geometry, layout, visible: false,
            assertCurrent: () => dependencies.nativeCarousel.assertObservation(observed) });
        if (sourceState !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Synthetic layout parent was replaced');
        attachNativeBinding(state, synthetic);
        owned(sourceState).layout = layout;
        owned(sourceState).empty = true;
        owned(sourceState).status = status;
        owned(sourceState).grid = grid;
        dependencies.gridView.setEmpty(true);

        syncLegacyEmptyState(synthetic, { allowProvisional: true });
        completedSection = synthetic;
        applyOriginalMyListVisibility();
        dependencies.responsive.observe('empty');
        log(tLog('legacyFrameMovedToEmptyAnchor'), {
            items: sourceState.items?.length ?? 0
        });
        return true;
    }

    function adoptLiveMyListSection(live, empty = false) {
        if (!sourceState || !live?.section || (empty ? live.scroller || live.track : !live.scroller || !live.track)) return false;
        if (!empty && sourceState.section === live.section && sourceState.scroller === live.scroller && sourceState.track === live.track) return false;
        dependencies.nativeCarousel.assertObservation(live);
        const state = sourceState;
        const status = state.status || document.getElementById(STATUS_ID);
        const grid = state.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const observed = nativeLayoutObservation(live.section, live.scroller, live.track, empty ? 'empty' : 'auto', state);
        const layout = { ...observed.layout, rowGap: measureNativeCarouselGap(live.section) };
        dependencies.nativeCarousel.assertObservation(observed);
        dependencies.interaction.clearSourceAlignment();
        dependencies.nativeCarousel.assertObservation(observed);
        dependencies.nativePopup.invalidate();
        dependencies.nativeCarousel.assertObservation(observed);
        if (!empty) dependencies.gridView.clearEmpty({ restoreGrid: false });
        const originalAnchor = markOriginalHeader(live.section, live.scroller, live.track);
        dependencies.nativeCarousel.assertObservation(observed);
        dependencies.nativeCarousel.assertObservation(live);
        if (!empty) nativeSourcePresentation(live.section, live.scroller, live.track, { phase: 'parked' });
        const geometry = currentGridGeometry(live.section, layout);
        dependencies.gridView.mount({ section: live.section, anchor: empty ? originalAnchor : live.scroller,
            status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
            assertCurrent: () => dependencies.nativeCarousel.assertObservation(observed) });
        if (sourceState !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Incoming layout parent was replaced');
        attachNativeBinding(state, live.section, live.scroller, live.track);
        owned(state).layout = layout;
        owned(state).status = status;
        owned(state).grid = grid;
        owned(state).empty = empty || (state.items?.length ?? 0) === 0;
        if (empty || !state.empty) waitingForNativeEmpty = false;
        if (empty) {
            dependencies.gridView.setEmpty(true);
            syncLegacyEmptyState(live.section, { allowProvisional: true });
            applyLegacyEmptyStateGeometry(live.section, layout);
        }
        syncStatusTypography(live.section, status);
        completedSection = live.section;
        dependencies.gridView.removeSynthetic(live.section);
        applyOriginalMyListVisibility();
        dependencies.responsive.observe(empty ? 'empty' : undefined);
        if (empty) {
            log(tLog('nativeEmptyMyListSectionAdopted'), {
                layout: dependencies.diagnostics.layoutSummary(layout), originalVisible: settings.preferences().viewOriginalMyList
            });
        } else {
            log(tLog('nativeMyListSourceAdoptedWithoutRescan'), {
                pages: live.pages, selectedPage: live.selectedPage, layout: dependencies.diagnostics.layoutSummary(layout)
            });
        }
        dependencies.nativeCarousel.invalidateReads();
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
                throw session.createRouteSessionCancelledError();
            }
        };
        const result = dependencies.nativeCarousel.refreshMapping({ mode: 'delta', section, scroller, track,
            totalCount, columns: Math.max(1, state.layout?.columns || 1), sessionToken: session.scope.token,
            assertCurrent: assertOwner, pageHintForVideoId: id => {
                const item = itemMap?.get('v:' + id);
                return item ? pageForItem(item) : undefined;
            } });
        if (result.status !== 'anchored') return false;
        dependencies.nativeCarousel.assertMapping(result);
        dependencies.responsive.expectCountConvergence();
        log(tLog('logicalPageModelSynchronizedAfterDelta'), {
            reason, currentPage: result.currentPage, knownPageCount: result.knownPageCount,
            pageCountFinalized: result.pageCountFinalized, pageMappingStale: result.pageMappingStale,
            visibleSignature: result.visibleSignature, visibleIds: result.visibleIds,
            itemIndices: result.itemIndices, logicalIndices: result.logicalIndices, totalCount
        });
        dependencies.nativeCarousel.assertMapping(result);
        return true;
    }

    function visibleNativeItems(live) {
        if (!live?.scroller || !live?.track) return [];
        const state = sourceState;
        if (state?.scroller !== live.scroller || state?.track !== live.track) {
            throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Visible cards no longer belong to the current parent');
        }
        return dependencies.nativeCarousel.sample(() => {
            dependencies.nativeCarousel.assertObservation(live);
            const observed = nativePageObservation(state);
            const items = observed.cards.map(entry => {
                const item = dependencies.gridView.captureCard(entry.source.slot, live.selectedPage || 0, false);
                dependencies.nativeCarousel.assertObservation(observed);
                return item;
            }).filter(item => item?.videoId);
            dependencies.nativeCarousel.assertObservation(observed);
            dependencies.nativeCarousel.assertObservation(live);
            return items;
        });
    }

    function readMutationLayout(parent, { positionOnly = false } = {}) {
        const runtime = positionOnly ? null : nativeSourceObservation(parent), layout = parent.layout, columns = layout?.columns;
        const sessionToken = session.scope.token;
        return Object.freeze({ mode: runtime?.mode, columns, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (runtime) dependencies.nativeCarousel.assertObservation(runtime);
            if (sourceState !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw session.createRouteSessionCancelledError();
        } });
    }

    function readMutationVisibleFacts(live, parent, { order = false } = {}) {
        const sessionToken = session.scope.token, layout = parent.layout, columns = layout?.columns;
        const assertCurrent = () => {
            session.assertRouteSession(sessionToken);
            if (live) dependencies.nativeCarousel.assertObservation(live);
            if (sourceState !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw session.createRouteSessionCancelledError();
        };
        assertCurrent();
        const ids = order && !live?.pageSignature ? [] : visibleNativeItems(live).map(item => item.videoId);
        assertCurrent();
        return Object.freeze({ ids: Object.freeze(ids), page: live?.selectedPage || 0, columns,
            available: Boolean(live?.pageSignature), assertCurrent });
    }

    function findNativeMyListItemByVideoId(videoId, liveState = null) {
        const discovery = liveState || nativeDiscoveryObservation();
        return dependencies.nativeCarousel.captureMountedItem({ discovery, videoId });
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
        dependencies.nativeCarousel.assertObservation(live);

        const sessionToken = session.scope.token;
        session.cleanupTargetSessionDom();
        dependencies.responsive.dispose();
        completedSection = null;
        dependencies.nativeCarousel.clearBinding();
        publishSourceState(null);
        waitingForNativeEmpty = false;
        dependencies.initialization.resetMissingSourceWait();
        dependencies.initialization.scheduleRun(0, sessionToken);
        return true;
    }

    function ensureLiveNativeBinding(reason = 'live-check', bindingOnly = false) {
        if (!sourceState || !session.isTargetPage()) return null;
        const owner = sourceState;
        const sessionToken = session.scope.token;
        const assertParent = () => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== owner) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Adoption parent was replaced');
        };
        try {
            if (bindingOnly && !waitingForNativeEmpty && !sourceState.empty) {
                // Observer callbacks need element identity, not page geometry, React
                // indices, or counts when Netflix still owns the same mounted source.
                const binding = nativeDiscoveryObservation({ bindingOnly: true });
                dependencies.nativeCarousel.assertObservation(binding);
                if (binding.section && binding.scroller && binding.track && binding.matchesBinding) return binding;
            }
            let live = nativeDiscoveryObservation();

            if (waitingForNativeEmpty && (sourceState.items?.length ?? 0) === 0) {
                if (live.section && !live.scroller && !live.track) {
                    const emptyState = dependencies.gridView.emptyPresentation();
                    const alreadyNative = (
                        sourceState.section === live.section &&
                        !sourceState.scroller &&
                        !sourceState.track &&
                        emptyState.source === 'native'
                    );
                    if (!alreadyNative) adoptLiveMyListSection(live, true);
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
                const emptyState = dependencies.gridView.emptyPresentation();
                if (!emptyState.connected) {
                    syncLegacyEmptyState(sourceState.section, { allowProvisional: true });
                }
                dependencies.nativeCarousel.assertObservation(live);
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
                const emptyState = dependencies.gridView.emptyPresentation();
                const alreadyNative = (
                    sourceState.section === live.section &&
                    !sourceState.scroller &&
                    !sourceState.track &&
                    emptyState.source === 'native'
                );
                if (!alreadyNative) {
                    adoptLiveMyListSection(live, true);
                    assertParent(); live = nativeDiscoveryObservation();
                }
            } else if (!live.section && (sourceState.items?.length ?? 0) === 0 && sourceState.section?.id !== SYNTHETIC_SECTION_ID) {
                if (!waitingForNativeEmpty) {
                    moveLegacyFrameToSyntheticEmpty();
                    assertParent(); live = nativeDiscoveryObservation();
                }
            }
            dependencies.nativeCarousel.assertObservation(live);
            return live;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            return null;
        }
    }

    function refreshNativeSectionAfterDelta() {
        return ensureLiveNativeBinding('delta-refresh');
    }

    function layoutFrameStatus(status, geometry = null, rowGap) {
        const state = sourceState, sessionToken = session.scope.token;
        const section = state?.section, scroller = state?.scroller, track = state?.track;
        const grid = state?.grid, layout = state?.layout, previousStatus = state?.status;
        dependencies.gridView.layoutStatus(status, geometry, rowGap, () => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state || state?.section !== section || state?.scroller !== scroller ||
                state?.track !== track || state?.grid !== grid || state?.layout !== layout || state?.status !== previousStatus) {
                throw session.createRouteSessionCancelledError();
            }
        });
    }

    function syncStatusTypography(section, status) {
        if (!status) return;
        const state = sourceState, sessionToken = session.scope.token;
        const typography = dependencies.netflixDom.readHeadingTypography(section);
        session.assertRouteSession(sessionToken);
        if (sourceState !== state) throw session.createRouteSessionCancelledError();
        dependencies.gridView.applyStatusTypography(status, typography, () => {
            session.assertRouteSession(sessionToken);
            if (sourceState !== state) throw session.createRouteSessionCancelledError();
        });
    }

    function nativeSourceDiagnostics(section = sourceState?.section, scroller = sourceState?.scroller, track = sourceState?.track, discover = false) {
        return dependencies.nativeCarousel.diagnostics({ source: { section, scroller, track, discover } }).source;
    }

    function nativeSourceObservation(state = sourceState, { count, provisionalTotalCount, position, presentation } = {}) {
        if (!state?.section) return null;
        const { section, scroller, track } = state;
        const sessionToken = session.scope.token;
        return dependencies.nativeCarousel.observeSource({ section, scroller, track, sessionToken, count, provisionalTotalCount, position, presentation,
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (sourceState !== state) throw session.createRouteSessionCancelledError();
            } });
    }

    function nativePageObservation(state = sourceState, { template = false } = {}) {
        const { section, scroller, track, totalCount, layout } = state;
        const sessionToken = session.scope.token;
        return dependencies.nativeCarousel.pageCards({ section, scroller, track, totalCount, columns: layout?.columns,
            window: 'current', template, sessionToken, assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (sourceState !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Native card observation parent was replaced');
            } });
    }

    function itemKey(item) {
        return item.videoId ? `v:${item.videoId}` : `h:${item.href}`;
    }

    function currentGridGeometry(section, layout) {
        return dependencies.nativeCarousel.sample(() => {
            const observed = nativeLayoutObservation(section, null, null, 'bounds');
            return dependencies.gridView.geometry({ bounds: observed.bounds, viewportWidth: observed.viewportWidth }, layout,
                () => dependencies.nativeCarousel.assertObservation(observed));
        });
    }

    function applyGridGeometry(section, grid, layout) {
        return dependencies.gridView.applyGeometry(grid, currentGridGeometry(section, layout), layout);
    }

    function copyItemAttributes(target, item, index = null) {
        const handle = dependencies.gridView.getCard(item);
        if (!handle || handle.node !== target) throw session.initializationError('GRID_CARD_RETIRED', 'grid-cards', 'Card record changed');
        dependencies.gridView.updateCard(handle, item, index);
    }

    function attachGridRegistry(state) {
        Object.defineProperty(owned(state), 'cloneMap', { enumerable: true, configurable: true, get: () => dependencies.gridView.cards });
        return state;
    }

    return Object.freeze({ get current() { return sourceState; }, get completed() { return completedSection; },
        get waitingForEmpty() { return waitingForNativeEmpty; },
        complete(section) { completedSection = section; }, waitForEmpty(value) { waitingForNativeEmpty = value; },
        acceptLayout(parent, layout) { accept(parent).layout = layout; },
        acceptInitialPage(parent, page) { accept(parent).initialPage = page; },
        acceptViewportSignature(parent, signature) { accept(parent).resizeViewportSignature = signature; },
        retireMembership() { sourceState?.listMembership?.dispose(); },
        retirePageHints() { sourceState?.nativePageHints?.dispose(); },
        acceptStatus(parent, status) { accept(parent).status = status; },
        acceptEmpty(parent, empty) { accept(parent).empty = empty; },
        acceptElapsed(parent, elapsed) { accept(parent).initializationElapsedMs = elapsed; },
        releasePresentation() { const lease = nativePresentationLease; nativePresentationLease = null; lease?.release(); },
        publishNativeParent, stageGridPublication, publishSourceState, pageForItem, setPageForItem,
        ensureListMembership, attachNativeBinding, nativeSourcePresentation, markOriginalHeader,
        applyOriginalMyListVisibility, cleanupOldArtifacts, measureNativeCarouselGap, nativeLayoutObservation,
        applyLegacyEmptyStateGeometry, syncLegacyEmptyState, finalizeEmptyLegacyList,
        nativeDiscoveryObservation, ensureSyntheticMyListSection, syncLogicalPageModelAfterDelta,
        readMutationLayout, readMutationVisibleFacts, findNativeMyListItemByVideoId, ensureLiveNativeBinding,
        refreshNativeSectionAfterDelta, layoutFrameStatus, syncStatusTypography, nativeSourceDiagnostics,
        nativeSourceObservation, nativePageObservation, itemKey, currentGridGeometry, applyGridGeometry,
        copyItemAttributes });
}
