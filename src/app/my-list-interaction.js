export function createMyListInteraction(dependencies) {
    const { environment, i18n, logger, session } = dependencies;
    const { window, performance } = environment;
    const { tUi, tLog } = i18n;
    const { log, warn, trace } = logger;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    let orderMismatchDismissed = false, orderMismatchDialogOpen = false, orderMismatchReinitializing = false;
    let mutationSourceRecoveryPending = false;

    function pageItemKeys(items, page) {
        return new Set(items.filter(item => dependencies.display.preferredPage(item) === page)
            .map(dependencies.display.itemKey).filter(Boolean));
    }

    function resolveReadyHover(item, card) {
        if (!card) return null;
        const state = dependencies.display.captureSource();
        return dependencies.nativeCarousel.sample(() => {
            dependencies.display.refreshSource('hover-reuse');
            const observation = dependencies.display.observeSource(state, { position: true });
            const page = observation.position.page, backedPage = Number(card.node.getAttribute('data-tm-backed-page'));
            const source = card.node.getAttribute('data-tm-hover-ready') === 'true' && Number.isFinite(backedPage) && page === backedPage
                ? dependencies.nativeCarousel.mountedCard({ section: state.section, scroller: state.scroller, track: state.track,
                    item: { videoId: item.videoId, href: item.href }, activeOnly: true, sessionToken: session.scope.token }) : null;
            const assertCurrent = () => { if (dependencies.display.captureSource() !== state) throw session.createRouteSessionCancelledError(); dependencies.nativeCarousel.assertObservation(observation); };
            assertCurrent();
            return { source, card, page, backedPage, targetPage: dependencies.display.preferredPage(item), assertCurrent };
        });
    }

    function prepareHoverCard(item, card, event, token, sessionToken) {
        if (!card || !dependencies.gridView.isCardCurrent(card)) return null;
        return prepareMountedPage(dependencies.display.preferredPage(item), item, event, token, sessionToken);
    }

    function clearSourceAlignment(slot, reason = 'source-release', relatedTarget = null) {
        dependencies.nativePopup.release(reason, relatedTarget, slot);
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

    function hideOrderMismatchDialog() {
        dependencies.gridView.hideMismatch();
        orderMismatchDialogOpen = false;
    }

    function resetOrderMismatchStateAfterInitialization() {
        hideOrderMismatchDialog();
        orderMismatchDismissed = false;
        orderMismatchReinitializing = false;
    }

    async function reinitializeAfterOrderMismatch() {
        if (orderMismatchReinitializing || dependencies.isInitializing() || !session.isTargetPage() || !session.active) return;
        const sessionToken = session.scope.token;
        const state = dependencies.display.captureSource();
        orderMismatchReinitializing = true;
        orderMismatchDismissed = true;
        hideOrderMismatchDialog();

        dependencies.hover.cancel('source');

        log(tLog('manualReinitializationRequested'), {
            selectedPage: dependencies.display.inspectSource()?.selectedPage ?? null,
            items: dependencies.display.captureSource()?.items?.length ?? null
        });

        try {
            // Reinitialization must begin from Netflix's first native My List page.
            // Keep the current source state alive until page 0 is confirmed so the
            // logical carousel can still resolve its native page number correctly.
            const { section, scroller, track } = state || {};
            if (!section?.isConnected || !scroller?.isConnected) {
                throw session.initializationError(
                    'REINITIALIZATION_SOURCE_UNAVAILABLE',
                    'return-native-my-list-to-start',
                    'The native My List carousel is unavailable before reinitialization'
                );
            }

            const nativeOwner = dependencies.nativeCarousel.borrowBinding(section, scroller, track);
            const assertCurrent = () => {
                session.assertRouteSession(sessionToken);
                dependencies.nativeCarousel.assertBinding(nativeOwner);
                if (dependencies.display.captureSource() !== state || state.section !== section || state.scroller !== scroller || state.track !== track) {
                    throw session.createRouteSessionCancelledError();
                }
            };
            assertCurrent();
            try { await Promise.resolve(dependencies.responsive.whenStable()); } catch (_) {}
            await dependencies.nativeCarousel.whenNavigationIdle();
            assertCurrent();
            const before = dependencies.display.observeSource(state, { position: true });
            const fromPage = before.position.page;
            const returnedPage = await dependencies.nativeCarousel.navigateTo(section, scroller, 0, null, sessionToken);
            assertCurrent();
            const after = dependencies.display.observeSource(state, { position: true });
            dependencies.nativeCarousel.assertObservation(after);
            if (returnedPage !== 0 || after.position.page !== 0) {
                throw session.initializationError(
                    'REINITIALIZATION_START_PAGE_NOT_REACHED',
                    'return-native-my-list-to-start',
                    'Could not return the native My List carousel to the first page',
                    { fromPage, returnedPage, selectedPage: after.position.page }
                );
            }

            // Fully discard the existing My List for Netflix session using the same
            // teardown path as a route leave, then start a fresh normal session.
            assertCurrent();
            session.restart('order-mismatch-reinitialize');
        } catch (error) {
            if (!session.isRouteSessionCancelledError(error) && error?.code !== 'NATIVE_SOURCE_REPLACED') {
                orderMismatchDismissed = false;
                dependencies.diagnostics.reportInitializationFailure(error, {
                    stage: error?.stage || 'order-mismatch-reinitialize',
                    details: error?.details || null,
                });
                dependencies.display.showInitializationFailure(error, dependencies.display.captureSource()?.totalCount ?? null);
            }
        } finally {
            orderMismatchReinitializing = false;
        }
    }

    function showOrderMismatchDialog(item, expectedPage, visibleIds = []) {
        if (orderMismatchDismissed || orderMismatchDialogOpen || orderMismatchReinitializing) return;
        const state = dependencies.display.captureSource(), sessionToken = session.scope.token;
        const detail = { item: dependencies.diagnostics.itemSummary(item), expectedPage, visibleIds: [...visibleIds] };
        dependencies.gridView.showMismatch({ message: tUi('orderChangedPrompt'), acceptLabel: tUi('orderChangedOk'),
            cancelLabel: tUi('orderChangedCancel'), assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (dependencies.display.captureSource() !== state) throw session.createRouteSessionCancelledError();
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

    function findActiveSourceSlot(item) {
        dependencies.display.refreshSource('hover-source-direct');
        if (!dependencies.display.captureSource()?.track?.isConnected || !dependencies.display.captureSource()?.scroller?.isConnected) return null;
        return dependencies.nativeCarousel.sample(() => dependencies.nativeCarousel.mountedCard({ section: dependencies.display.captureSource().section,
            scroller: dependencies.display.captureSource().scroller, track: dependencies.display.captureSource().track, item: { href: item.href, videoId: item.videoId },
            activeOnly: true, sessionToken: session.scope.token })?.slot || null);
    }

    function nativePositionDeviation(item, source) {
        if (!item || !source || !dependencies.display.captureSource()?.items?.length) return null;
        dependencies.nativeCarousel.assertSource(source);
        return dependencies.display.positionDeviation(item, source.itemIndex);
    }

    function firstVisibleNativePositionMismatch(cards) {
        return dependencies.display.firstPositionMismatch(cards, ORDER_MISMATCH_POSITION_THRESHOLD);
    }

    function rejectLargeNativePositionDeviation(item, source, expectedPage, visibleIds = []) {
        const state = dependencies.display.captureSource();
        const deviation = nativePositionDeviation(item, source);
        if (!deviation || deviation.absoluteDelta < ORDER_MISMATCH_POSITION_THRESHOLD) return false;
        const actualVideoId = source.videoId;
        const diagnostic = {
            item: dependencies.diagnostics.itemSummary(item),
            expectedPage,
            expectedIndex: deviation.expectedIndex,
            actualIndex: deviation.actualIndex,
            delta: deviation.delta,
            threshold: ORDER_MISMATCH_POSITION_THRESHOLD,
            source: dependencies.diagnostics.slotDescriptor(source.slot)
        };
        warn('Native My List position deviates beyond order-mismatch threshold', diagnostic);
        dependencies.nativeCarousel.assertSource(source);
        if (dependencies.display.captureSource() !== state) throw session.createRouteSessionCancelledError();
        showOrderMismatchDialog(
            item,
            expectedPage,
            [...new Set([...visibleIds, actualVideoId].filter(Boolean))]
        );
        return true;
    }

    function findGridClone(item) {
        return dependencies.gridView.getCard(item)?.node || null;
    }

    function findItemForSourceSlot(slot) {
        const identity = dependencies.nativeCarousel.cardIdentity(slot);
        return identity ? dependencies.display.findRecord(identity) : null;
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
            mutationSourceRecoveryPending = false;
            targetSourceSlot = located.slot;
            resolvedSource = located.source || null;
            actualPage = located.page;
        } else {
            const runtime = dependencies.display.observeSource();
            const staleLogicalMapping = runtime?.mode === 'logical' && runtime.needsRemapping;
            const mutationRecoveryPending = mutationSourceRecoveryPending;
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
                        maxRadius: mutationSourceRecoveryPending ? null : 2 });
                }
                if (preparationCancelled('token-changed-after-stale-page-search')) return null;
                assertCurrent();
                if (repaired?.slot) {
                    if (rejectLargeNativePositionDeviation(targetItem, repaired.source, page, located?.visibleIds || [])) return null;
                    mutationSourceRecoveryPending = false;
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

    function reportListChange(change, { assertCurrent }) {
        assertCurrent();
        if (change.kind === 'order') log(tLog('legacyVisibleOrderAligned'), { page: change.page, ids: change.ids });
        else {
            mutationSourceRecoveryPending = true;
            if (change.kind === 'remove') log(tLog('legacyItemRemovedByDifferentialUpdate'), {
                reason: change.reason, removed: dependencies.diagnostics.itemSummary(change.record), remaining: change.count });
            else log(tLog('legacyItemAddedByDifferentialUpdate'), {
                reason: change.reason, index: change.index, added: dependencies.diagnostics.itemSummary(change.record), total: change.count });
        }
        assertCurrent();
    }

    return Object.freeze({ get blockedReason() { return orderMismatchDialogOpen ? 'order-mismatch-dialog-open' : orderMismatchReinitializing ? 'order-mismatch-reinitializing' : ''; },
        closeState() { orderMismatchDialogOpen = false; },
        clearMutationRecovery() { mutationSourceRecoveryPending = false; },
        retire() { orderMismatchDismissed = false; orderMismatchDialogOpen = false; orderMismatchReinitializing = false; },
        resolveReadyHover, prepareHoverCard, clearSourceAlignment, resetOrderMismatchStateAfterInitialization,
        findActiveSourceSlot, findItemForSourceSlot, reportListChange });
}
