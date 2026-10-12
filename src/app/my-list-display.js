import { GRID_ID, STATUS_ID, SYNTHETIC_SECTION_ID } from '../dom-names.js';
import { createDisplaySource } from './my-list-display/source.js';
import { applyPageAssignments } from './my-list-display/page-mapping.js';
import { createDisplayViewing } from './my-list-display/viewing.js';

// The app-facing display capability coordinates complete accepted-parent transitions.
export function createMyListDisplay(dependencies) {
    const { environment, i18n, logger, settings, session } = dependencies;
    const { document, window, performance } = environment;
    const { tUi, tUiPlural, tLog, formatUiNumber, formatItemCount, formatInitializationTime } = i18n;
    const { log } = logger;
    const route = Object.freeze({ get scope() { return { token: session.scope.token }; },
        assertRouteSession: session.assertRouteSession, createRouteSessionCancelledError: session.createRouteSessionCancelledError,
        initializationError: session.initializationError });
    const source = createDisplaySource({ environment, settings, session: route,
        get gridView() { return dependencies.gridView; }, get listView() { return dependencies.listView; },
        get nativeCarousel() { return dependencies.nativeCarousel; }, get netflixDom() { return dependencies.netflixDom; } });
    const { captureSource, unwrap, layoutSummary, applyOriginalMyListVisibility, measureNativeCarouselGap, applyLegacyEmptyStateGeometry,
        layoutFrameStatus, syncStatusTypography, currentGridGeometry, applyGridGeometry, copyItemAttributes,
        stageGridPublication, pageForItem, setPageForItem, ensureListMembership, attachNativeBinding,
        nativeSourcePresentation, markOriginalHeader, nativeLayoutObservation, nativeDiscoveryObservation,
        nativeSourceDiagnostics, nativeSourceObservation, nativePageObservation, itemKey, attachGridRegistry } = source;
    const viewingAttachment = createDisplayViewing({ session: route, logger, i18n,
        get viewing() { return dependencies.viewing; }, get gridView() { return dependencies.gridView; },
        get hover() { return dependencies.hover; }, get nativePopup() { return dependencies.nativePopup; },
        get netflixContext() { return dependencies.netflixContext; },
        isCurrent: parent => source.current === parent,
        onAttached: source.acceptViewing, onStatus: source.acceptStatus,
        formatHeaderParts, readWork: (...args) => dependencies.readWork(...args) });
    const { initializeWatchGroups } = viewingAttachment;
    function publishSourceState(next) {
        const previous = source.current;
        next = source.replace(next);
        if (previous !== next) { viewingAttachment.retire(previous); source.retireParent(previous); }
        return next;
    }

    function publishNativeParent({ section, scroller = null, track = null, ...facts }) {
        return publishSourceState(attachNativeBinding(facts, section, scroller, track));
    }

    function cleanupOldArtifacts() {
        const state = source.current, sessionToken = session.scope.token;
        dependencies.gridView.cleanupArtifacts(() => {
            session.assertRouteSession(sessionToken);
            if (source.current !== state) throw session.createRouteSessionCancelledError();
        });
        dependencies.nativeCarousel.cleanupArtifacts({ sessionToken, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (source.current !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Artifact cleanup caller changed');
        } });
    }

    function syncLegacyEmptyState(section, { allowProvisional = false } = {}) {
        const state = source.current, sessionToken = session.scope.token;
        const binding = state?.section === section ? dependencies.nativeCarousel.borrowBinding(section, state.scroller, state.track) : null;
        const geometry = state?.layout ? currentGridGeometry(section, state.layout) : null;
        return dependencies.gridView.presentEmpty({ section, allowProvisional, geometry, assertCurrent() {
            session.assertRouteSession(sessionToken);
            if (source.current !== state) throw session.createRouteSessionCancelledError();
            if (binding) dependencies.nativeCarousel.assertBinding(binding);
        } });
    }

    function finalizeEmptyLegacyList(section, scroller, track, layout, initializationStarted, reason = 'empty', admission = null) {
        if (admission) dependencies.nativeCarousel.assertObservation(admission);
        dependencies.gridView.clearCards(() => { if (admission) dependencies.nativeCarousel.assertObservation(admission); });
        const elapsedMs = performance.now() - initializationStarted;
        const frame = placeLegacyFrame(section, scroller, layout, { elapsedMs, finalized: true, totalCount: 0 });
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
            resizeViewportSignature: dependencies.viewportSignature(),
            initializationStartedAt: initializationStarted,
            initializationElapsedMs: elapsedMs
        }, section, scroller || null, track || null));
        attachGridRegistry(source.current);
        source.waitForEmpty(false);
        syncLegacyEmptyState(section, { allowProvisional: true });
        source.complete(section);
        dependencies.onTransition({ kind: 'initialization-accepted', empty: true });
        applyOriginalMyListVisibility();
        dependencies.onTransition({ kind: 'source-adopted', mode: 'native-empty' });
        log(tLog('emptyLegacyListFinalized'), {
            reason,
            elapsedMs: Math.round(elapsedMs),
            layout: layoutSummary(layout)
        });
    }

    function ensureSyntheticMyListSection(admission) {
        const state = source.current, sessionToken = session.scope.token;
        const guard = () => {
            session.assertRouteSession(sessionToken);
            if (source.current !== state) throw session.createRouteSessionCancelledError();
            if (admission) dependencies.nativeCarousel.assertObservation(admission);
        };
        guard();
        const placement = dependencies.netflixDom.readSyntheticPlacement();
        guard();
        return dependencies.gridView.ensureSynthetic(placement, guard);
    }

    function moveLegacyFrameToSyntheticEmpty() {
        if (!source.current) return false;
        const state = source.current;
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
        if (source.current !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Synthetic layout parent was replaced');
        attachNativeBinding(state, synthetic);
        source.owned(source.current).layout = layout;
        source.owned(source.current).empty = true;
        source.owned(source.current).status = status;
        source.owned(source.current).grid = grid;
        dependencies.gridView.setEmpty(true);

        syncLegacyEmptyState(synthetic, { allowProvisional: true });
        source.complete(synthetic);
        applyOriginalMyListVisibility();
        dependencies.onTransition({ kind: 'source-adopted', mode: 'empty' });
        log(tLog('legacyFrameMovedToEmptyAnchor'), {
            items: source.current.items?.length ?? 0
        });
        return true;
    }

    function adoptLiveMyListSection(live, empty = false) {
        if (!source.current || !live?.section || (empty ? live.scroller || live.track : !live.scroller || !live.track)) return false;
        if (!empty && source.current.section === live.section && source.current.scroller === live.scroller && source.current.track === live.track) return false;
        dependencies.nativeCarousel.assertObservation(live);
        const state = source.current;
        const status = state.status || document.getElementById(STATUS_ID);
        const grid = state.grid || document.getElementById(GRID_ID);
        if (!status || !grid) return false;
        const observed = nativeLayoutObservation(live.section, live.scroller, live.track, empty ? 'empty' : 'auto', state);
        const layout = { ...observed.layout, rowGap: measureNativeCarouselGap(live.section) };
        dependencies.nativeCarousel.assertObservation(observed);
        dependencies.nativePopup.release('source-release');
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
        if (source.current !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-layout', 'Incoming layout parent was replaced');
        attachNativeBinding(state, live.section, live.scroller, live.track);
        source.owned(state).layout = layout;
        source.owned(state).status = status;
        source.owned(state).grid = grid;
        source.owned(state).empty = empty || (state.items?.length ?? 0) === 0;
        if (empty || !state.empty) source.waitForEmpty(false);
        if (empty) {
            dependencies.gridView.setEmpty(true);
            syncLegacyEmptyState(live.section, { allowProvisional: true });
            applyLegacyEmptyStateGeometry(live.section, layout);
        }
        syncStatusTypography(live.section, status);
        source.complete(live.section);
        dependencies.gridView.removeSynthetic(live.section);
        applyOriginalMyListVisibility();
        dependencies.onTransition({ kind: 'source-adopted', mode: empty ? 'empty' : undefined });
        if (empty) {
            log(tLog('nativeEmptyMyListSectionAdopted'), {
                layout: layoutSummary(layout), originalVisible: settings.preferences().viewOriginalMyList
            });
        } else {
            log(tLog('nativeMyListSourceAdoptedWithoutRescan'), {
                pages: live.pages, selectedPage: live.selectedPage, layout: layoutSummary(layout)
            });
        }
        dependencies.nativeCarousel.invalidateReads();
        return true;
    }

    function syncLogicalPageModelAfterDelta(reason = 'delta-reindex') {
        const state = source.current;
        if (!state?.section || !state?.scroller || !state?.track) return false;
        const { section, scroller, track, itemMap } = state;
        const recordOwner = state.items, items = recordOwner || [];
        const totalCount = items.length;
        const assertOwner = () => {
            if (source.current !== state || state.items !== recordOwner || state.itemMap !== itemMap || items.length !== totalCount ||
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
        dependencies.onTransition({ kind: 'membership-mapped' });
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
        const state = source.current;
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
            if (source.current !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw session.createRouteSessionCancelledError();
        } });
    }

    function readMutationVisibleFacts(live, parent, { order = false } = {}) {
        const sessionToken = session.scope.token, layout = parent.layout, columns = layout?.columns;
        const assertCurrent = () => {
            session.assertRouteSession(sessionToken);
            if (live) dependencies.nativeCarousel.assertObservation(live);
            if (source.current !== parent || parent.layout !== layout || parent.layout?.columns !== columns) throw session.createRouteSessionCancelledError();
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
        if (!source.current?.empty || !live?.section || !live?.scroller || !live?.track) return false;
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
        dependencies.onTransition({ kind: 'source-reinitializing' });
        source.complete(null);
        dependencies.nativeCarousel.clearBinding();
        publishSourceState(null);
        source.waitForEmpty(false);
        dependencies.onTransition({ kind: 'initialization-required', reason, sessionToken });
        return true;
    }

    function ensureLiveNativeBinding(reason = 'live-check', bindingOnly = false) {
        if (!source.current || !session.isTargetPage()) return null;
        const owner = source.current;
        const sessionToken = session.scope.token;
        const assertParent = () => {
            session.assertRouteSession(sessionToken);
            if (source.current !== owner) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-discovery', 'Adoption parent was replaced');
        };
        try {
            if (bindingOnly && !source.waitingForEmpty && !source.current.empty) {
                // Observer callbacks need element identity, not page geometry, React
                // indices, or counts when Netflix still owns the same mounted source.
                const binding = nativeDiscoveryObservation({ bindingOnly: true });
                dependencies.nativeCarousel.assertObservation(binding);
                if (binding.section && binding.scroller && binding.track && binding.matchesBinding) return binding;
            }
            let live = nativeDiscoveryObservation();

            if (source.waitingForEmpty && (source.current.items?.length ?? 0) === 0) {
                if (live.section && !live.scroller && !live.track) {
                    const emptyState = dependencies.gridView.emptyPresentation();
                    const alreadyNative = (
                        source.current.section === live.section &&
                        !source.current.scroller &&
                        !source.current.track &&
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
                    syncLegacyEmptyState(source.current.section, { allowProvisional: true });
                }
                dependencies.nativeCarousel.assertObservation(live);
                return live;
            }

            if (live.section && live.scroller && live.track &&
                source.current.empty && (source.current.items?.length ?? 0) === 0) {
                if (restartInitializationForPopulatedNativeMyList(live, reason)) return null;
            }

            if (live.section && live.scroller && live.track && !live.matchesBinding) {
                const previous = {
                    sectionConnected: Boolean(source.current.section?.isConnected),
                    scrollerConnected: Boolean(source.current.scroller?.isConnected),
                    trackConnected: Boolean(source.current.track?.isConnected),
                    sameSection: source.current.section === live.section,
                    sameScroller: source.current.scroller === live.scroller,
                    sameTrack: source.current.track === live.track
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
            } else if (live.section && !live.scroller && !live.track && (source.current.items?.length ?? 0) === 0) {
                const emptyState = dependencies.gridView.emptyPresentation();
                const alreadyNative = (
                    source.current.section === live.section &&
                    !source.current.scroller &&
                    !source.current.track &&
                    emptyState.source === 'native'
                );
                if (!alreadyNative) {
                    adoptLiveMyListSection(live, true);
                    assertParent(); live = nativeDiscoveryObservation();
                }
            } else if (!live.section && (source.current.items?.length ?? 0) === 0 && source.current.section?.id !== SYNTHETIC_SECTION_ID) {
                if (!source.waitingForEmpty) {
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

    function formatInitializationErrorMeta(error, fallbackTotalCount = null) {
        const details = error?.details || {};
        const rawCollected = Number(
            details.collected ??
            details.actual ??
            source.current?.collectedCount ??
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
        if (finalized && source.current?.watchStatus && current === source.current.items?.length && total === current) {
            const watch = presentation || dependencies.gridView.presentation();
            current = Number.isFinite(watch.visibleCount) ? watch.visibleCount
                : Math.max(0, current - (watch.completedCount || 0));
            total = current;
        }
        return {
            label: tUi('legacyMyList'),
            meta: `${formatItemCount(current, total, finalized)}  ${formatInitializationTime(elapsedMs)}`
        };
    }

    function placeLegacyFrame(section, scroller, layout, { elapsedMs = null, finalized = false, totalCount = null } = {}) {
        const state = source.current, sessionToken = session.scope.token;
        source.markOriginalHeader(section);

        const geometry = currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(0, totalCount, elapsedMs, finalized));
        const header = source.markOriginalHeader(section);
        const grid = dependencies.gridView.mount({ section, anchor: scroller?.isConnected ? scroller : header,
            status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (source.current !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'grid-frame', 'Frame caller changed');
            } });
        syncStatusTypography(section, status);

        return { status, grid, geometry };
    }

    function retireMutationCard(record, { correlationId, parent, assertCurrent, onAccepted }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(source.itemKey(record));
        if (dependencies.hover.intent().videoId === String(record.videoId) || dependencies.hover.intent().clone === clone) {
            dependencies.hover.cancel('source'); assertCurrent();
        }
        const handle = dependencies.gridView.getCard(record);
        if (handle) dependencies.gridView.removeCard(handle, { correlationId, assertCurrent, onAccepted });
        else onAccepted();
        assertCurrent();
    }

    function prepareMutationInsertion({ parent, assertCurrent }) {
        assertCurrent();
        const grid = parent.grid || document.getElementById(GRID_ID);
        if (!grid) return false;
        dependencies.hover.install(grid); assertCurrent(); return true;
    }

    function insertMutationCard(record, options) {
        const { parent, index, assertCurrent } = options;
        assertCurrent();
        const grid = parent.grid || document.getElementById(GRID_ID);
        return dependencies.gridView.insertCard(record, { ...options, ordered: !parent.watchStatus });
    }

    function updateMutationCard(record, index, { parent, assertCurrent }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(source.itemKey(record));
        if (clone?.isConnected) copyItemAttributes(clone, record, index);
        assertCurrent();
    }

    function presentListOrder(change, { parent, assertCurrent }) {
        assertCurrent();
        if (parent.grid && !parent.watchStatus) dependencies.gridView.applyMembershipOrder(change, assertCurrent);
    }

    function presentListChange({ count, empty, logical }, { parent, assertCurrent }) {
        assertCurrent(); source.acceptEmpty(parent, empty);
        if (logical && count) { dependencies.onTransition({ kind: 'membership-layout-changed' }); assertCurrent(); }
        dependencies.gridView.setEmpty(empty); assertCurrent();
        source.waitForEmpty(empty);
        if (empty) syncLegacyEmptyState(parent.section, { allowProvisional: true });
        else dependencies.gridView.clearEmpty();
        assertCurrent(); dependencies.nativePopup.invalidate(); assertCurrent();
        if (parent.watchStatus) { viewingAttachment.syncWatchGroups(parent); assertCurrent(); }
        const status = updateStatus(formatHeaderParts(count, count, parent.initializationElapsedMs, true));
        assertCurrent(); source.acceptStatus(parent, status);
        if (status && parent.layout) {
            layoutFrameStatus(status, null, settings.preferences().viewOriginalMyList && !empty ? (parent.layout.rowGap || 0) : 0);
            assertCurrent();
        }
    }

    function updateStatus(content) {
        return dependencies.gridView.updateStatus(content);
    }

    async function buildGrid(section, scroller, transfer, layout, totalCount, sessionToken = session.scope.token) {
        const buildState = source.current;
        const track = buildState?.track;
        const assertBuildParent = () => {
            session.assertRouteSession(sessionToken);
            if (source.current !== buildState) throw session.createRouteSessionCancelledError();
            if (!section.isConnected || !scroller.isConnected || !track?.isConnected ||
                buildState.section !== section || buildState.scroller !== scroller || buildState.track !== track) {
                throw session.initializationError('GRID_BUILD_SOURCE_REPLACED', 'grid-construction',
                    'Native My List source changed during grid construction');
            }
        };
        const items = transfer.records;
        const publication = source.stageGridPublication(buildState, transfer, totalCount, { assertCurrent: assertBuildParent });
        const assertBuildActive = publication.assertCurrent;
        assertBuildActive();
        const geometry = currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(items.length, totalCount, null));
        syncStatusTypography(section, status);
        let grid;
        try {
            grid = await dependencies.gridView.publish({ items: transfer.records, readMaterial: transfer.readMaterial, releaseMaterial: transfer.release,
                readPage: (record, index) => publication.readPage(record) ?? Math.floor(index / Math.max(1, layout.columns)),
                section, anchor: scroller, status, geometry, layout, visible: settings.preferences().viewOriginalMyList, assertCurrent: assertBuildActive,
                onAccepted(root) {
                    publication.commit({ grid: root, status, layout });
                    if (buildState.watchStatus) viewingAttachment.bindViewingSession(buildState, sessionToken, true);
                } });
        } finally { publication.discard(); transfer.discard(); }
        dependencies.gridView.clearEmpty({ restoreGrid: false });
        if (source.current.watchStatus) viewingAttachment.syncWatchGroups(source.current);

        dependencies.onTransition({ kind: 'layout-published', layout });
        // Remember the viewport used to publish this grid before observing the
        // source's own collapse to the hidden, one-pixel standby height.
        source.acceptViewportSignature(buildState, dependencies.viewportSignature());

        dependencies.onTransition({ kind: 'source-adopted' });

        log(tLog('legacyGridBuilt'), {
            items: items.length,
            totalCount,
            geometry,
            layout: layoutSummary(layout),
            gridCards: dependencies.gridView.cards.size
        });

        return grid;
    }

    async function publishCollection(section, scroller, transfer, layout, totalCount, initializationStarted, sessionToken = session.scope.token) {
        const items = transfer.records;
        const track = source.current?.track;
        await buildGrid(section, scroller, transfer, layout, totalCount, sessionToken);
        session.assertRouteSession(sessionToken);
        source.acceptEmpty(source.current, false);
        applyOriginalMyListVisibility();

        // Defer React-backed hover preparation until the first actual hover.
        // The live native card is resolved on demand, keeping initialization off the hover path.
        const deferredNative = nativeSourceDiagnostics(section, scroller, track);
        log(tLog('initialHoverPreparationDeferred'), {
            selectedPage: deferredNative?.selectedPage ?? null,
            currentPageCards: deferredNative?.currentPageCards ?? 0
        });
        if (source.current) ensureListMembership(source.current).observeCount({ collectedCount: items.length, totalCount });
        source.complete(section);
        dependencies.onTransition({ kind: 'initialization-accepted', empty: false });
        source.acceptElapsed(source.current, performance.now() - initializationStarted);
        updateStatus(formatHeaderParts(items.length, totalCount, source.current.initializationElapsedMs, true));

        initializeWatchGroups(source.current, sessionToken);

        return captureSource();
    }

    function showProvisional({ section, scroller, track, layout, initializationStarted, assertCurrent }) {
        const frame = placeLegacyFrame(section, scroller, layout, { elapsedMs: null, finalized: false, totalCount: null });
        assertCurrent();
        publishNativeParent({ section, scroller, track, layout, items: [], collectedCount: 0, totalCount: null,
            grid: frame.grid, status: frame.status, empty: false,
            resizeViewportSignature: dependencies.viewportSignature(), initializationStartedAt: initializationStarted });
        applyOriginalMyListVisibility();
        return frame;
    }

    function showInitializationFailure(error, totalCount = null) {
        updateStatus(formatInitializationErrorMeta(error, totalCount));
    }

    function showCollectionProgress(parent, facts, { assertCurrent = () => {}, header = true } = {}) {
        const guard = acceptedParentGuard(parent, assertCurrent); guard();
        ensureListMembership(parent).observeCount(facts, { assertCurrent: guard }); guard();
        if (header) updateStatus(formatHeaderParts(facts.collectedCount, facts.totalCount, null));
    }

    function showCollectionFrame(section, scroller, track, layout, totalCount, initializationStarted, observation) {
        const guard = () => dependencies.nativeCarousel.assertObservation(observation);
        const status = updateStatus(formatHeaderParts(0, totalCount, null));
        dependencies.gridView.placeStatus(status, { section, anchor: scroller, assertCurrent: guard });
        syncStatusTypography(section, status);
        layoutFrameStatus(status, currentGridGeometry(section, layout), layout.rowGap);
        guard();
        nativeSourcePresentation(section, scroller, track, { phase: 'mounted' });
        source.waitForEmpty(false);
        publishNativeParent({ section, scroller, track, layout,
            initializationStartedAt: initializationStarted, empty: false, collectedCount: 0, totalCount });
        return captureSource();
    }

    function mappingCards() {
        return { get: dependencies.gridView.getCard,
            update: (card, item) => copyItemAttributes(card.node, item) };
    }

    function repairPageMapping(item, page, parent, { assertCurrent = () => {}, connectedOnly = false, report = false } = {}) {
        const guard = acceptedParentGuard(parent, assertCurrent);
        return applyPageAssignments([{ item, page }], {
            hints: { read: pageForItem, write: (record, value) => setPageForItem(record, value, parent) },
            cards: mappingCards(), assertCurrent: guard, skipUnchanged: true, connectedOnly,
            onChanged(record, previous, actualPage) {
                if (report) log(tLog('itemPageMappingCorrected'), {
                    item: { videoId: record.videoId || '', page: pageForItem(record), href: record.href || '', ariaLabel: record.ariaLabel || '' },
                    oldPage: previous, actualPage, reason: 'logical-visible-page-repair' });
            } });
    }

    function applyResponsiveMapping(parent, { columns, pages, assertCurrent, connectedOnly = false, initialPage }) {
        const guard = acceptedParentGuard(parent, assertCurrent);
        const records = parent.items;
        function* assignments() {
            for (let index = 0; index < records.length; index++) {
                yield { item: records[index], page: Math.min(pages - 1, Math.floor(index / columns)) };
            }
        }
        const changed = applyPageAssignments(assignments(), {
            hints: { read: pageForItem, write: (record, page) => setPageForItem(record, page, parent, { assertCurrent }) },
            cards: mappingCards(), assertCurrent: guard, connectedOnly });
        guard();
        if (initialPage !== undefined) source.acceptInitialPage(parent, initialPage);
        return changed;
    }

    function acceptedParentGuard(parent, admission = () => {}) {
        const token = session.scope.token;
        return () => {
            session.assertRouteSession(token); admission();
            if (source.current !== parent) throw session.createRouteSessionCancelledError();
        };
    }

    function collectionReceipt(parent = source.current) {
        const records = parent.items, itemMap = parent.itemMap, cloneMap = parent.cloneMap, grid = parent.grid;
        const size = records?.length;
        return Object.freeze({ records, find: identity => itemMap?.get(itemKey(identity)) || null,
            assertCurrent() {
                if (source.current !== parent || parent.items !== records || parent.itemMap !== itemMap || parent.cloneMap !== cloneMap || parent.grid !== grid || records?.length !== size) throw session.createRouteSessionCancelledError();
            } });
    }

    const admitted = operation => (...args) => {
        const result = operation(...args.map(unwrap));
        return result && result === source.current ? captureSource() : result;
    };

    function applyLayout(parent, layout, { mode = 'measurement', note = '', assertCurrent = () => {}, rowGap } = {}) {
        const guard = acceptedParentGuard(parent, assertCurrent); guard(); source.acceptLayout(parent, layout);
        if (mode === 'measurement') return;
        const geometry = applyGridGeometry(parent.section, parent.grid, layout);
        guard();
        const gap = rowGap ?? (mode === 'status' ? (settings.preferences().viewOriginalMyList ? layout.rowGap || parent.layout?.rowGap || 0 : 0) : undefined);
        layoutFrameStatus(parent.status, geometry, gap);
        if (mode === 'status') showLayoutStatus(parent, layout, note, false);
        if (mode === 'empty-source') applyLegacyEmptyStateGeometry(parent.section, layout);
    }
    function showLayoutStatus(parent, layout, note = '', geometry = true) {
        if (!parent?.status || !parent.items) return;
        const guard = acceptedParentGuard(parent); guard();
        if (geometry) {
            const measured = applyGridGeometry(parent.section, parent.grid, layout);
            layoutFrameStatus(parent.status, measured, settings.preferences().viewOriginalMyList ? layout.rowGap || parent.layout?.rowGap || 0 : 0);
        }
        guard();
        updateStatus(formatHeaderParts(parent.items.length, parent.totalCount, parent.initializationElapsedMs, true));
        if (note) log(tLog('responsiveStatusNote'), { note });
    }
    function retireAcceptedResources(release = operation => operation()) {
        const parent = source.current, membership = parent?.listMembership, hints = parent?.nativePageHints;
        release(() => viewingAttachment.retire(parent));
        release(() => membership?.dispose()); release(() => hints?.dispose());
    }
    function discardSource() {
        source.complete(null); dependencies.nativeCarousel.clearBinding(); publishSourceState(null); source.waitForEmpty(false);
    }
    function createMutations(options) {
        return dependencies.listView.createMutations({ ...options,
            readParent: () => source.current, canApply: () => Boolean(source.current && session.isTargetPage()),
            hasMember: id => source.current.grid ? source.current.itemMap.has('v:' + id) : null,
            refreshNative: refreshNativeSectionAfterDelta, observeNative: nativeDiscoveryObservation,
            captureNative: findNativeMyListItemByVideoId, hasMaterial: (item, correlationId) => dependencies.gridView.materialFor(item, correlationId),
            assertNative: observation => dependencies.nativeCarousel.assertObservation(observation),
            readMembership: ensureListMembership, readLayout: readMutationLayout, readVisible: readMutationVisibleFacts,
            hasCard: record => Boolean(dependencies.gridView.getCard(record)), retireCard: retireMutationCard,
            canInsertCard: prepareMutationInsertion, insertCard: insertMutationCard, readPage: pageForItem,
            writePage: (record, page, { parent, assertCurrent }) => setPageForItem(record, page, parent, { assertCurrent }),
            updateCard: updateMutationCard, sample: operation => dependencies.nativeCarousel.sample(operation),
            refreshMapping: syncLogicalPageModelAfterDelta, onReindexed: presentListChange, onOrder: presentListOrder });
    }
    function itemSummary(item) {
        if (!item) return null;
        const parent = source.current;
        return { videoId: item.videoId || '',
            page: dependencies.nativeCarousel.preferredPage({ record: item, hints: parent ? source.owned(parent).nativePageHints : null,
                records: parent?.items || [], columns: parent?.layout?.columns || 1 }),
            href: item.href || '', ariaLabel: item.ariaLabel || '' };
    }

    function bindSource(parent, section, scroller, track) {
        acceptedParentGuard(parent)(); return attachNativeBinding(parent, section, scroller, track);
    }
    function recordCollectionPage(parent, page) {
        acceptedParentGuard(parent)(); source.acceptInitialPage(parent, page);
    }
    function recordViewportChange(parent, signature) {
        acceptedParentGuard(parent)(); source.acceptViewportSignature(parent, signature);
    }

    return Object.freeze({ captureSource, createMutations, itemSummary, layoutSummary,
        get completed() { return source.completed; }, get waitingForEmpty() { return source.waitingForEmpty; },
        showProvisional, publishCollection, publishEmpty: finalizeEmptyLegacyList, showInitializationFailure,
        showCollectionProgress: admitted(showCollectionProgress), showCollectionFrame,
        applyLayout: admitted(applyLayout), showLayoutStatus: admitted(showLayoutStatus),
        recordViewportChange: admitted(recordViewportChange),
        repairPageMapping: admitted(repairPageMapping), applyResponsiveMapping: admitted(applyResponsiveMapping),
        collectionReceipt: admitted(collectionReceipt), findRecord: identity => source.current?.itemMap?.get(itemKey(identity)) || null,
        positionDeviation: (item, index) => ensureListMembership(source.current).positionDeviation(item, index),
        firstPositionMismatch: (cards, threshold) => source.current ? ensureListMembership(source.current).firstPositionMismatch(cards, threshold) : null,
        refreshSource: ensureLiveNativeBinding, applyPreferences: applyOriginalMyListVisibility,
        discoverSource: nativeDiscoveryObservation, measureSource: admitted(nativeLayoutObservation),
        inspectSource: nativeSourceDiagnostics, observeSource: admitted(nativeSourceObservation),
        observePage: admitted(nativePageObservation), measureGap: measureNativeCarouselGap,
        measureGrid: currentGridGeometry, itemKey, preferredPage: pageForItem,
        ensureSynthetic: ensureSyntheticMyListSection, prepareArtifacts: cleanupOldArtifacts,
        bindSource: admitted(bindSource), presentSource: nativeSourcePresentation,
        recordCollectionPage: admitted(recordCollectionPage),
        retireAcceptedResources, releasePresentation: source.releasePresentation, discardSource,
        invalidateCompletion: () => source.complete(null),
        viewingDiagnostics: () => source.current?.watchStatus ? dependencies.viewing.diagnostics(source.current.watchStatus) : null,
        seriesDiagnostics: () => source.current?.watchStatus ? dependencies.viewing.seriesDiagnostics(source.current.watchStatus) : [],
        clearEmptyWait: () => source.waitForEmpty(false)
    });
}
