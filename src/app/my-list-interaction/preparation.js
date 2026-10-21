// One admitted expected/preferred/search/graft workflow with exact per-attempt checks.
export function createHoverPreparation(dependencies, { firstVisibleNativePositionMismatch,
    rejectLargeNativePositionDeviation, showOrderMismatchDialog, findItemForSourceSlot,
    readMutationRecovery, acceptMutationRecovery, positionThreshold: ORDER_MISMATCH_POSITION_THRESHOLD }) {
    const { environment, i18n, logger, session } = dependencies;
    const { performance } = environment, { tLog } = i18n, { log, warn, trace } = logger;
    function pageItemKeys(items, page) {
        return new Set(items.filter(item => dependencies.display.preferredPage(item) === page)
            .map(dependencies.display.itemKey).filter(Boolean));
    }

    function popupSource(slot, item) {
        const state = dependencies.display.captureSource();
        const source = dependencies.nativeCarousel.mountedCard({ section: state.section, scroller: state.scroller, track: state.track,
            item: { videoId: item.videoId, href: item.href }, activeOnly: true, sessionToken: session.scope.token });
        if (!source || source.slot !== slot) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'native-popup', 'Native card changed');
        return source;
    }

    function makeLiveClone(slot, item, clone, page, assertCurrent = () => {}, token = dependencies.hover.intent().token, sessionToken = session.scope.token) {
        const card = dependencies.gridView.getCard(item);
        if (!card || card.node !== clone) throw session.initializationError('GRID_CARD_RETIRED', 'grid-cards', 'Preparation card changed');
        return dependencies.nativePopup.prepare({ source: popupSource(slot, item), card, item, page, assertCurrent, token, sessionToken });
    }

    async function prepareMountedPage(page, targetItem, triggerEvent = null, token = null, sessionToken = null) {
        const preparationDetail = detail => ({ requestedPage: page, targetItem: dependencies.diagnostics.itemSummary(targetItem), ...detail });
        session.assertRouteSession(sessionToken);
        if (dependencies.hover.isCancelled(token)) return null;
        let targetCard = dependencies.gridView.getCard(targetItem);
        dependencies.gridView.assertCard(targetCard);
        dependencies.hover.count('hoverPreparation', 'calls');
        const hoverTiming = dependencies.hover.captureTiming();
        dependencies.display.refreshSource('hover-prepare-start');
        const state = dependencies.display.captureSource();
        const { section, scroller, track } = state || {};
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            warn(tLog('nativePagePreparationFailed'), preparationDetail({
                reason: 'native-binding-unavailable'
            }));
            return null;
        }
        const nativeOwner = dependencies.nativeCarousel.borrowBinding(section, scroller, track);
        const collection = dependencies.display.collectionReceipt(state), records = collection.records;
        const assertCurrent = () => {
            session.assertRouteSession(sessionToken);
            dependencies.nativeCarousel.assertBinding(nativeOwner);
            collection.assertCurrent();
        };
        const resolveSource = async (mode = null, options = {}) => {
            session.assertRouteSession(sessionToken);
            if (dependencies.hover.isCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
            const reason = mode === 'search' ? 'hover-locate-start' : mode === 'preferred-refresh'
                ? 'hover-stale-refresh-start' : 'hover-expected-page-start';
            dependencies.display.refreshSource(reason);
            assertCurrent();
            dependencies.gridView.assertCard(targetCard);
            if (!mode) dependencies.hover.releaseInteraction();
            const result = await dependencies.nativeCarousel.resolveCard({ mode, section, scroller, track,
                item: dependencies.diagnostics.itemSummary(targetItem), totalCount: records.length, columns: state.layout?.columns || 1,
                expectedPage: page, preferredPage: page, pageItemCount: mode ? undefined : pageItemKeys(records, page).size,
                hoverToken: token, sessionToken, ...options });
            session.assertRouteSession(sessionToken);
            if (dependencies.hover.isCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
            if (dependencies.display.captureSource() !== state) return { status: 'unknown', reason: 'native-binding-lost-after-page-move' };
            assertCurrent();
            if (result.status === 'mismatch' && !mode) {
                const positionMismatch = firstVisibleNativePositionMismatch(result.visibleCards);
                if (!positionMismatch) return result;
                log('Native My List position mismatch detected before source search', {
                    item: dependencies.diagnostics.itemSummary(positionMismatch.item), expectedPage: page,
                    expectedIndex: positionMismatch.deviation.expectedIndex, actualIndex: positionMismatch.deviation.actualIndex,
                    delta: positionMismatch.deviation.delta, threshold: ORDER_MISMATCH_POSITION_THRESHOLD, visibleIds: result.visibleIds });
                return { ...result, reason: 'position-deviation-before-source-search', positionMismatch };
            }
            if (result.status !== 'found') return result;
            return dependencies.nativeCarousel.sample(() => {
                if (mode === 'search' && options.repairLogicalMapping) {
                    for (let index = 0; index < result.visibleCards.length; index++) {
                        assertCurrent();
                        if (dependencies.hover.isCancelled(token)) return { status: 'unknown', reason: 'hover-cancelled' };
                        dependencies.nativeCarousel.assertSource(result.source);
                        dependencies.nativeCarousel.assertSource(result.sources[index]);
                        const visibleItem = collection.find(result.visibleCards[index]);
                        if (visibleItem) dependencies.display.repairPageMapping(visibleItem, result.page, state, { assertCurrent, report: true });
                    }
                }
                assertCurrent();
                if (mode === 'search') dependencies.nativeCarousel.assertSource(result.source);
                return { ...result, get slot() { return result.source.slot; } };
            });
        };
        const preparationCancelled = reason => {
            if (token === null || token === dependencies.hover.intent().token) return false;
            log(tLog('nativePagePreparationCancelled'), { reason, token, hoverToken: dependencies.hover.intent().token });
            return true;
        };
        const reportPositionMismatch = located => {
            warn('Native My List position mismatch escalated without source search', {
                targetItem: dependencies.diagnostics.itemSummary(targetItem),
                mismatchItem: dependencies.diagnostics.itemSummary(located.positionMismatch.item),
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
        };
        const started = performance.now();

        log(tLog('nativePagePreparationStarted'), preparationDetail({
            triggerEvent: triggerEvent?.type || '',
            token,
            hoverToken: dependencies.hover.intent().token
        }));

        let targetSourceSlot = null;
        let resolvedSource = null;
        let actualPage = page;
        let staleSourceRecovery = false;

        let located = await resolveSource();
        if (preparationCancelled('token-changed-after-expected-page-check')) return null;

        if (located?.status === 'mismatch') {
            if (located.positionMismatch) {
                reportPositionMismatch(located);
                return null;
            }
            // Immediately after a manual reinitialization, Hawkins can expose a
            // stable adjacent-page window for one render cycle. Give the target
            // one bounded re-resolution before treating it as a real order change.
            log('Retrying expected native page after transient page mismatch', preparationDetail({
                visibleIds: located.visibleIds || []
            }));
            await session.sleep(120);
            located = await resolveSource();
            if (preparationCancelled('token-changed-after-mismatch-retry')) return null;
            if (located?.positionMismatch) {
                reportPositionMismatch(located);
                return null;
            }
        }

        assertCurrent();
        if (located?.status === 'found' && located.slot) {
            if (rejectLargeNativePositionDeviation(targetItem, located.source, page)) return null;
            acceptMutationRecovery();
            targetSourceSlot = located.slot;
            resolvedSource = located.source || null;
            actualPage = located.page;
        } else {
            const runtime = dependencies.display.observeSource();
            const staleLogicalMapping = runtime?.mode === 'logical' && runtime.needsRemapping;
            const mutationRecoveryPending = readMutationRecovery();
            const expectedPageMismatch = located?.status === 'mismatch';
            if (staleLogicalMapping || mutationRecoveryPending || expectedPageMismatch) {
                log('Hover expected-page mapping is stale; searching live native source', preparationDetail({
                    locatedStatus: located?.status || null,
                    locatedReason: located?.reason || null,
                    mutationRecoveryPending,
                    expectedPageMismatch,
                    visibleIds: located?.visibleIds || []
                }));
                let repaired = await resolveSource('preferred-refresh');
                if (preparationCancelled('token-changed-after-stale-page-refresh')) return null;
                if (!repaired?.slot) {
                    repaired = await resolveSource('search', { repairLogicalMapping: expectedPageMismatch || mutationRecoveryPending,
                        maxRadius: readMutationRecovery() ? null : 2 });
                }
                if (preparationCancelled('token-changed-after-stale-page-search')) return null;
                assertCurrent();
                if (repaired?.slot) {
                    if (rejectLargeNativePositionDeviation(targetItem, repaired.source, page, located?.visibleIds || [])) return null;
                    acceptMutationRecovery();
                    staleSourceRecovery = true;
                    targetSourceSlot = repaired.slot;
                    actualPage = repaired.page;
                    resolvedSource = repaired.source || null;
                    trace(() => ['Hover source recovered from stale logical page mapping', {
                        targetItem: dependencies.diagnostics.itemSummary(targetItem),
                        requestedPage: page,
                        actualPage,
                        source: dependencies.diagnostics.slotDescriptor(targetSourceSlot)
                    }]);
                } else {
                    const promptSuppression = dependencies.responsive.suppression();
                    if (promptSuppression.suppress) {
                        log(tLog('nativePagePreparationCancelled'), preparationDetail({
                            reason: 'logical-page-mapping-stale-source-not-found-transient',
                            locatedReason: located?.reason || null,
                            visibleIds: located?.visibleIds || [],
                            promptSuppression
                        }));
                        return null;
                    }

                    log('Stale logical page recovery exhausted; escalating to reinitialization prompt', preparationDetail({
                        locatedReason: located?.reason || null,
                        visibleIds: located?.visibleIds || [],
                        promptSuppression
                    }));
                    showOrderMismatchDialog(targetItem, page, located?.visibleIds || []);
                    return null;
                }
            } else {
                log(tLog('nativePagePreparationCancelled'), preparationDetail({
                    reason: located?.reason || 'expected-page-check-inconclusive'
                }));
                return null;
            }
        }

        trace(() => {
            const native = dependencies.display.inspectSource(section, scroller, track);
            return [tLog('nativePagePreparationPositionResolved'), {
                requestedPage: page,
                actualPage,
                selectedPage: native?.selectedPage ?? null,
                currentSlots: native?.currentPageCards ?? 0,
                targetSource: dependencies.diagnostics.slotDescriptor(targetSourceSlot)
            }];
        });

        assertCurrent();
        dependencies.hover.releaseInteraction();
        dependencies.nativePopup.invalidate();

        const pageView = dependencies.nativeCarousel.pageCards({ section, scroller, track, binding: nativeOwner,
            source: resolvedSource, page: actualPage, totalCount: records?.length || 0,
            columns: state.layout?.columns || 1, window: 'viewport',
            sessionToken, assertCurrent });

        let freshTarget = null;
        let refreshedCount = 0;
        let fiberAssignments = 0;
        let propsAssignments = 0;
        let neighborsSkipped = 0;

        dependencies.nativeCarousel.sample(() => {
            for (const entry of pageView.cards) {
                if (dependencies.hover.isCancelled(token)) return;
                dependencies.nativeCarousel.assertObservation(pageView);
                dependencies.hover.count('hoverPreparation', 'slotsConsidered');

                if (!entry.inPage) continue;
                const sourceSlot = entry.source.slot;

                const pageItem = findItemForSourceSlot(sourceSlot);
                if (!pageItem) continue;

                if (!staleSourceRecovery) {
                    dependencies.display.repairPageMapping(pageItem, actualPage, state, {
                        assertCurrent: () => dependencies.nativeCarousel.assertObservation(pageView), connectedOnly: true });
                    dependencies.nativeCarousel.assertObservation(pageView);
                }

                if (dependencies.display.itemKey(pageItem) !== dependencies.display.itemKey(targetItem)) {
                    neighborsSkipped++;
                    dependencies.hover.count('hoverPreparation', 'neighborsSkipped');
                    continue;
                }

                dependencies.gridView.assertCard(targetCard);
                const oldClone = targetCard.node;
                if (!oldClone?.isConnected) continue;

                const graftStarted = performance.now();
                let fresh, stats, handle;
                try { ({ fresh, stats, handle } = makeLiveClone(sourceSlot, pageItem, oldClone, actualPage,
                    () => dependencies.nativeCarousel.assertObservation(pageView), token, sessionToken)); }
                finally { hoverTiming('graft', graftStarted); }
                dependencies.hover.acceptReplacement(targetCard, handle, token, sessionToken);
                targetCard = handle;
                dependencies.nativeCarousel.assertObservation(pageView);
                refreshedCount++;
                dependencies.hover.count('hoverPreparation', 'clonesRebuilt');
                fiberAssignments += stats?.fiberAssignments || 0;
                propsAssignments += stats?.propsAssignments || 0;

                dependencies.nativeCarousel.assertObservation(pageView);

                if (dependencies.display.itemKey(pageItem) === dependencies.display.itemKey(targetItem)) {
                    dependencies.hover.observeReplacement(handle);
                    freshTarget = fresh;
                    targetSourceSlot = sourceSlot;
                }
            }
        });
        if (dependencies.hover.isCancelled(token)) return null;
        dependencies.nativeCarousel.assertObservation(pageView);

        log(tLog('nativePageClonesUpdated'), {
            actualPage,
            refreshedCount,
            preparationScope: 'target-card',
            slotsConsidered: pageView.cards.length,
            neighborsSkipped,
            fiberAssignments,
            propsAssignments,
            targetItem: dependencies.diagnostics.itemSummary(targetItem),
            targetFound: Boolean(freshTarget && targetSourceSlot),
            targetHoveredAtInsertion: freshTarget?.__tmHoverReplacementHovered ?? null
        });

        dependencies.nativeCarousel.assertObservation(pageView);
        if (!freshTarget) {
            // Do not use off-screen slots from adjacent pages as hover sources.
            warn(tLog('nativePagePreparationFailed'), {
                reason: 'target-not-in-current-page-slots',
                targetItem: dependencies.diagnostics.itemSummary(targetItem),
                actualPage,
                slots: pageView.cards.map(entry => dependencies.diagnostics.slotDescriptor(entry.source.slot))
            });
            return null;
        }

        dependencies.nativeCarousel.assertObservation(pageView);
        log(tLog('nativePagePreparationCompleted'), preparationDetail({
            actualPage,
            targetReady: Boolean(freshTarget),
            elapsedMs: Math.round(performance.now() - started)
        }));
        dependencies.nativeCarousel.assertObservation(pageView);
        return freshTarget ? { card: targetCard, source: popupSource(targetSourceSlot, targetItem), page: actualPage } : null;
    }


    return prepareMountedPage;
}
