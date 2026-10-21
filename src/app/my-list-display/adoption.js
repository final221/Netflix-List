import { GRID_ID, STATUS_ID, SYNTHETIC_SECTION_ID } from '../../dom-names.js';

// Adoption requests guarded fact acceptance; accepted publication/resources stay in display.
export function createSourceAdoption(dependencies) {
    const { environment, i18n, logger, settings, session, source,
        syncLegacyEmptyState, visibleNativeItems, publishSourceState } = dependencies;
    const { document } = environment, { log } = logger, { tLog } = i18n;
    const { nativeDiscoveryObservation, nativeLayoutObservation, measureNativeCarouselGap,
        currentGridGeometry, applyOriginalMyListVisibility, applyLegacyEmptyStateGeometry,
        markOriginalHeader, nativeSourcePresentation, syncStatusTypography, layoutSummary } = source;
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
        source.acceptAdoption(state, { section: synthetic, layout, empty: true, status, grid });
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
        source.acceptAdoption(state, { section: live.section, scroller: live.scroller, track: live.track,
            layout, status, grid, empty: empty || (state.items?.length ?? 0) === 0 });
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


    return Object.freeze({ ensureSyntheticMyListSection, moveLegacyFrameToSyntheticEmpty,
        adoptLiveMyListSection, restartInitializationForPopulatedNativeMyList, ensureLiveNativeBinding });
}
