import { createHoverPreparation } from './my-list-interaction/preparation.js';

export function createMyListInteraction(dependencies) {
    const { i18n, logger, session } = dependencies;
    const { tUi, tLog } = i18n;
    const { log, warn } = logger;
    const ORDER_MISMATCH_POSITION_THRESHOLD = 10;
    let orderMismatchDismissed = false, orderMismatchDialogOpen = false, orderMismatchReinitializing = false;
    let mutationSourceRecoveryPending = false;

    const prepareMountedPage = createHoverPreparation(dependencies, { firstVisibleNativePositionMismatch,
        rejectLargeNativePositionDeviation, showOrderMismatchDialog, findItemForSourceSlot,
        readMutationRecovery: () => mutationSourceRecoveryPending,
        acceptMutationRecovery: () => { mutationSourceRecoveryPending = false; },
        positionThreshold: ORDER_MISMATCH_POSITION_THRESHOLD });
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

    function findItemForSourceSlot(slot) {
        const identity = dependencies.nativeCarousel.cardIdentity(slot);
        return identity ? dependencies.display.findRecord(identity) : null;
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
