export function createResponsive(options) {
    const { acceptLayoutChange, acceptInitialPage, acceptViewportSignature, window, ResizeObserver, performance, setTimeout, clearTimeout, nativeCarousel, gridView, hover, listMutations, readState, readSessionToken, isRouteSessionActive, assertRouteSession, createRouteSessionCancelledError, isRouteSessionCancelledError, nativeSourceObservation, nativeLayoutObservation, nativeSourceDiagnostics, ensureLiveNativeBinding, applyGridGeometry, layoutFrameStatus, updateStatus, formatHeaderParts, measureNativeCarouselGap, pageForItem, setPageForItem, itemKey, copyItemAttributes, currentGridGeometry, realignActiveSource, layoutSummary, collectRuntimeSnapshot, sleep, log, warn, trace, tLog, tUi, readOriginalVisibility, applyLegacyEmptyStateGeometry } = options;
    let resizeObserver = null, responsiveRefreshTimer = null, responsiveRefreshPromise = null, responsiveRefreshing = false;
    let responsiveDeferral = null, activeResponsiveReason = "", lastResponsiveReason = "", lastResponsiveSignature = "", lastPageShape = "";
    let myListCountConvergencePending = false, responsiveSequence = 0, lifecycleRevision = 0, listeners = null;
    let counters = createCounters();
    function createCounters() { return { events: 0, checks: 0, unchanged: 0, refreshes: 0, hoverPreserved: 0, hoverCancelled: 0, parkedHeightChangesIgnored: 0, parkedHeightHoverPreserved: 0 }; }
    function responsiveSignature(layout) {
        if (!readState()) return '';
        const observation = nativeSourceObservation(readState(), { position: true });
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
        counters.hoverCancelled++;
    }


    function responsivePageShape(layout) {
        if (!readState()) return '';
        const observation = nativeSourceObservation(readState(), { position: true });
        const shape = `${Math.max(1, layout.columns)}|${observation.position.pages}`;
        nativeCarousel.assertObservation(observation);
        return shape;
    }


    function updateResponsiveStatus(layout, note = '') {
        if (!readState()?.status || !readState()?.items) return;
        const geometry = applyGridGeometry(readState().section, readState().grid, layout);
        layoutFrameStatus(readState().status, geometry, readOriginalVisibility() ? (layout.rowGap || readState().layout?.rowGap || 0) : 0);
        updateStatus(formatHeaderParts(
            readState().items.length,
            readState().totalCount,
            readState().initializationElapsedMs,
            true
        ));

        if (note) {
            log(tLog('responsiveStatusNote'), { note });
        }
    }


    async function waitResponsiveLayoutSettled(timeout = 1200, sessionToken = null) {
        assertRouteSession(sessionToken);
        const revision = lifecycleRevision;
        const state = readState();
        const { section, scroller, track } = state;
        const start = performance.now();
        let previous = '';
        let stable = 0;
        let latest = readState().layout;

        while (performance.now() - start < timeout) {
            await sleep(80);
            assertRouteSession(sessionToken);
            if (revision !== lifecycleRevision || readState() !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || !state.grid?.isConnected) {
                throw createRouteSessionCancelledError();
            }
            const observed = nativeLayoutObservation(section, scroller, track, 'auto', state);
            latest = { ...observed.layout };
            latest.rowGap = readState()?.layout?.rowGap || measureNativeCarouselGap(section);
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


    async function rebuildLogicalPageModelFromNativePosition(layout, reason = 'responsive-remap', sessionToken = readSessionToken()) {
        assertRouteSession(sessionToken);
        const live = ensureLiveNativeBinding('logical-page-model-rebuild-start') || readState();
        const state = readState();
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
            if (readState() !== state || state.items !== recordOwner || items.length !== totalCount || state.itemMap !== itemMap ||
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
            acceptInitialPage(state, result.currentPage);
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


    async function remapItemsByOrder(layout, sessionToken = readSessionToken()) {
        const state = readState();
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


    async function refreshResponsiveLayout(sessionToken = readSessionToken()) {
        if (!isRouteSessionActive(sessionToken) || !readState()?.grid?.isConnected || responsiveRefreshing) return;
        const state = readState();
        const { section, scroller, track } = state;
        responsiveRefreshing = true;
        const responsiveOwner = { sessionToken, state, grid: state.grid, ticket: listMutations.deferReconciliation('responsive-refresh') };
        responsiveDeferral = responsiveOwner;
        let deferredLogicalRemap = false;
        const seq = ++responsiveSequence;
        const reason = lastResponsiveReason || 'unspecified';
        activeResponsiveReason = reason;
        const started = performance.now();
        const grid = state.grid;
        const assertOwner = () => {
            assertRouteSession(sessionToken);
            if (responsiveDeferral !== responsiveOwner || responsiveSequence !== seq || readState() !== state || state.section !== section || state.scroller !== scroller || state.track !== track ||
                !section.isConnected || !scroller.isConnected || !track.isConnected || state.grid !== grid || !grid.isConnected) {
                throw createRouteSessionCancelledError();
            }
        };
        try {
            const startingNative = nativeSourceDiagnostics(section, scroller, track);
            log(tLog('responsiveRefreshStarted'), {
                seq,
                reason,
                beforeLayout: layoutSummary(readState().layout),
                selectedPage: startingNative?.selectedPage ?? null,
                pages: startingNative?.pageCount ?? null
            });
            gridView.setRefreshing(grid, true);
            counters.refreshes++;
            cancelResizeHover();
            const liveLayout = await waitResponsiveLayoutSettled(1200, sessionToken);
            assertOwner();
            const signature = responsiveSignature(liveLayout);
            const pageShape = responsivePageShape(liveLayout);

            acceptLayoutChange(state, liveLayout);
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
                        total: readState().items.length,
                        retryCount: nativeSourceObservation(state)?.remapAttempts || 0
                    });
                } else {
                    log(tLog('responsivePageMappingUpdatedWithoutNativeCarouselMovement'), {
                        seq,
                        reason,
                        columns: liveLayout.columns,
                        pages: remappedNative?.pageCount ?? null,
                        changed,
                        total: readState().items.length
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
            if (responsiveDeferral !== responsiveOwner || readState() !== state) return;
            warn(tLog('responsiveRelayoutFailed'), {
                seq,
                reason,
                error,
                elapsedMs: Math.round(performance.now() - started),
                snapshot: collectRuntimeSnapshot()
            });
            updateResponsiveStatus(readState().layout, tUi('relayoutFailed'));
        } finally {
            try {
                if (readState() === state && responsiveDeferral === responsiveOwner) gridView.setRefreshing(grid, false);
                if (readState() === state && isRouteSessionActive(sessionToken) && responsiveSequence === seq && responsiveDeferral === responsiveOwner) {
                    responsiveRefreshing = false;
                    activeResponsiveReason = '';
                    responsiveDeferral = null;
                    responsiveOwner.ticket.release({ reason: 'after-responsive-refresh' });
                    const runtime = readState() === state ? nativeSourceObservation(state) : null;
                    if (deferredLogicalRemap && runtime?.needsRemapping && (runtime.remapAttempts || 0) === 1) {
                        scheduleResponsiveRefresh(
                            400,
                            isResizeResponsiveReason(reason) ? 'responsive-resize-retry' : 'logical-page-model-retry'
                        );
                    }
                }
            } finally {
                const admitted = readState() === state && isRouteSessionActive(sessionToken) && responsiveSequence === seq && responsiveDeferral === responsiveOwner;
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
        const sessionToken = readSessionToken();
        if (!isRouteSessionActive(sessionToken) || !readState()?.grid?.isConnected) return;
        const state = readState();
        lastResponsiveReason = reason;
        clearTimeout(responsiveRefreshTimer);
        const revision = lifecycleRevision;
        const check = setTimeout(() => nativeCarousel.sample(() => {
            if (revision !== lifecycleRevision || responsiveRefreshTimer !== check) return;
            responsiveRefreshTimer = null;
            try {
                if (!isRouteSessionActive(sessionToken) || responsiveRefreshing || readState() !== state || !state.grid?.isConnected) return;
                counters.checks++;
                if (state.empty && (!state.scroller || !state.track)) {
                    const observed = nativeLayoutObservation(state.section, null, null, 'empty', state);
                    const layout = { ...observed.layout };
                    layout.rowGap = measureNativeCarouselGap(state.section);
                    nativeCarousel.assertObservation(observed);
                    if (responsiveLayoutMatches(state.layout, layout)) {
                        counters.unchanged++;
                        return;
                    }
                    acceptLayoutChange(state, layout);
                    const geometry = applyGridGeometry(state.section, state.grid, layout);
                    layoutFrameStatus(state.status, geometry);
                    return;
                }
                ensureLiveNativeBinding('responsive-check');
                if (readState() !== state || !state.section?.isConnected || !state.scroller?.isConnected || !state.track?.isConnected) return;

                // Skip the expensive rescan when measured geometry has not changed.
                // Keep active-slot alignment here and clear it only when the responsive state actually changes.
                const sample = nativeCarousel.sample(() => {
                    const observed = nativeLayoutObservation(state.section, state.scroller, state.track, 'auto', state);
                    const measured = { ...observed.layout };
                    measured.rowGap = state.layout?.rowGap || measureNativeCarouselGap(state.section);
                    const result = { measured, signature: responsiveSignature(measured), geometry: currentGridGeometry(state.section, measured), observed };
                    nativeCarousel.assertObservation(observed);
                    return result;
                });
                const measured = sample.measured;
                const sig = sample.signature;
                if (readState() !== state) return;
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
                    acceptLayoutChange(state, measured);
                    realignActiveSource();
                    counters.unchanged++;
                    const hoverPreserved = Boolean(hover.hasInteraction());
                    if (hoverPreserved) counters.hoverPreserved++;
                    if (parkedHeightOnlyChange) {
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
                        acceptLayoutChange(state, measured);
                        lastResponsiveSignature = sig;
                        lastPageShape = responsivePageShape(measured);
                        realignActiveSource();
                        counters.unchanged++;
                        if (hover.hasInteraction()) counters.hoverPreserved++;
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
                const clearPromise = () => {
                    if (responsiveRefreshPromise === refreshPromise) responsiveRefreshPromise = null;
                };
                Promise.resolve(refreshPromise).then(clearPromise, clearPromise);
            } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            }
        }), delay);
        responsiveRefreshTimer = check;
    }


    function handleTargetResize(reason) {
        if (!readState()?.grid?.isConnected) return;
        counters.events++;
        const signature = responsiveViewportSignature();
        if (readState().resizeViewportSignature !== signature) {
            // Real bounds/zoom/offset changes can invalidate native popup placement
            // even when the column count is unchanged. Duplicate events cannot.
            cancelResizeHover();
            log(tLog(reason === 'window.resize' ? 'windowResizeDetected' : 'visualViewportResizeDetected'), {
                previousSignature: readState().resizeViewportSignature || '', signature,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                hoverCancelled: true
            });
            acceptViewportSignature(readState(), signature);
        }
        scheduleResponsiveRefresh(140, reason);
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
        if (myListCountConvergencePending && readState()?.scroller?.isConnected && readState()?.track?.isConnected) {
            const observation = nativeSourceObservation(readState(), { count: 'optional' });
            nativeCountState = observation.count;
            nativeCarousel.assertObservation(observation);
            nativeCountConverged =
                Number.isSafeInteger(nativeCountState.totalCount) &&
                nativeCountState.totalCount === (readState().items?.length ?? readState().totalCount ?? 0);
            if (nativeCountConverged) myListCountConvergencePending = false;
        }

        return {
            suppress: Boolean(resizePending || resizeRunning || myListCountConvergencePending),
            resizePending,
            resizeRunning,
            myListCountConvergencePending,
            nativeCountConverged,
            legacyTotalCount: readState()?.items?.length ?? readState()?.totalCount ?? null,
            nativeTotalCount: nativeCountState?.totalCount ?? null,
            nativeCountReadings: nativeCountState?.readings || [],
            nativeCountUniqueReadings: nativeCountState?.uniqueReadings || []
        };
    }


    function start() {
        if (listeners) return;
        const revision = lifecycleRevision;
        const resize = reason => () => { if (listeners && revision === lifecycleRevision) handleTargetResize(reason); };
        listeners = { window: resize('window.resize'), visual: resize('visualViewport.resize') };
        window.addEventListener('resize', listeners.window, { passive: true });
        window.visualViewport?.addEventListener('resize', listeners.visual, { passive: true });
    }
    function observe(mode = 'populated') {
        resizeObserver?.disconnect();
        const state = readState(), sessionToken = readSessionToken(), revision = lifecycleRevision;
        if (!state?.grid?.isConnected) return;
        const binding = mode === 'populated' ? null : nativeCarousel.borrowBinding(state.section, state.scroller, state.track);
        const owner = new ResizeObserver(() => {
            if (resizeObserver !== owner || revision !== lifecycleRevision || readState() !== state ||
                !isRouteSessionActive(sessionToken) || !state.grid?.isConnected || responsiveRefreshing) return;
            if (mode === 'populated') { scheduleResponsiveRefresh(140, 'ResizeObserver'); return; }
            if (!state.empty || !nativeCarousel.isBindingCurrent(binding)) return;
            try { nativeCarousel.sample(() => {
                const observed = nativeLayoutObservation(state.section, mode === 'empty' ? null : state.scroller,
                    mode === 'empty' ? null : state.track, mode === 'empty' ? 'empty' : 'auto', state);
                const layout = { ...observed.layout, rowGap: measureNativeCarouselGap(state.section) };
                nativeCarousel.assertObservation(observed);
                if (readState() !== state || !nativeCarousel.isBindingCurrent(binding)) return;
                acceptLayoutChange(state, layout);
                const geometry = applyGridGeometry(state.section, state.grid, layout);
                if (readState() !== state || !nativeCarousel.isBindingCurrent(binding)) return;
                layoutFrameStatus(state.status, geometry, mode === 'empty' && readOriginalVisibility() ? layout.rowGap || 0 : 0);
                applyLegacyEmptyStateGeometry(state.section, layout);
            }); } catch (error) {
                if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isRouteSessionCancelledError(error)) throw error;
            }
        });
        resizeObserver = owner;
        owner.observe(state.section);
        if (mode !== 'empty' && state.scroller) owner.observe(state.scroller);
    }
    function dispose() {
        ++lifecycleRevision; ++responsiveSequence;
        const previous = listeners; listeners = null;
        if (previous) {
            window.removeEventListener('resize', previous.window);
            window.visualViewport?.removeEventListener('resize', previous.visual);
        }
        const observer = resizeObserver; resizeObserver = null;
        clearTimeout(responsiveRefreshTimer); responsiveRefreshTimer = null;
        const deferral = responsiveDeferral; responsiveDeferral = null;
        responsiveRefreshPromise = null; responsiveRefreshing = false;
        activeResponsiveReason = ''; lastResponsiveReason = ''; lastResponsiveSignature = ''; lastPageShape = '';
        myListCountConvergencePending = false;
        try { observer?.disconnect(); }
        finally {
            try {
                if (deferral && readState() === deferral.state) gridView.setRefreshing(deferral.grid, false);
            } finally { deferral?.ticket.release({ resume: false }); }
        }
    }
    function acceptLayout(layout) {
        lastResponsiveSignature = responsiveSignature(layout); lastPageShape = responsivePageShape(layout);
        if (readState()) acceptViewportSignature(readState(), responsiveViewportSignature());
    }
    // Public capability: owns timers, observers, tickets and transaction admission.
    return Object.freeze({ start, observe, dispose, acceptLayout, requestCheck: scheduleResponsiveRefresh,
        whenStable: () => responsiveRefreshPromise?.catch(() => {}) || null,
        viewportSignature: responsiveViewportSignature, suppression: orderMismatchPromptSuppressionState,
        expectCountConvergence: () => { myListCountConvergencePending = true; },
        resetDiagnostics: () => { counters = createCounters(); },
        diagnostics: () => Object.freeze({ resize: { ...counters }, responsiveRefreshing,
            responsiveSignature: lastResponsiveSignature, responsivePageShape: lastPageShape, responsiveReason: lastResponsiveReason }) });
}
