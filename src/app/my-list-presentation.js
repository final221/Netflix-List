import { GRID_ID } from '../dom-names.js';

export function createMyListPresentation(dependencies) {
    const { environment, i18n, logger, settings, session } = dependencies;
    const { document } = environment;
    const { getUiLocale, tUi, tUiPlural, tLog, formatUiNumber, formatItemCount, formatInitializationTime } = i18n;
    const { log } = logger;
    const watches = new WeakMap();

    function formatInitializationErrorMeta(error, fallbackTotalCount = null) {
        const details = error?.details || {};
        const rawCollected = Number(
            details.collected ??
            details.actual ??
            dependencies.source.current?.collectedCount ??
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
        if (finalized && dependencies.source.current?.watchStatus && current === dependencies.source.current.items?.length && total === current) {
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
        const state = dependencies.source.current, sessionToken = session.scope.token;
        dependencies.source.markOriginalHeader(section);

        const geometry = dependencies.source.currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(0, totalCount, elapsedMs, finalized));
        const header = dependencies.source.markOriginalHeader(section);
        const grid = dependencies.gridView.mount({ section, anchor: scroller?.isConnected ? scroller : header,
            status, geometry, layout, visible: settings.preferences().viewOriginalMyList,
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (dependencies.source.current !== state) throw session.initializationError('NATIVE_SOURCE_REPLACED', 'grid-frame', 'Frame caller changed');
            } });
        dependencies.source.syncStatusTypography(section, status);

        return { status, grid, geometry };
    }

    function applyManualViewingChoice(state, item) {
        const watch = state.watchStatus, grid = state.grid;
        const assertCurrent = () => {
            dependencies.viewing.assertCurrent(watch);
            if (dependencies.source.current !== state || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected || !state.items.includes(item)) throw session.createRouteSessionCancelledError();
        };
        if (dependencies.netflixContext.activeProfile() !== dependencies.viewing.presentation(watch).profile) {
            syncWatchGroups(state); return;
        }
        const result = dependencies.viewing.place(watch, String(item.videoId), { assertCurrent });
        assertCurrent();
        const beforeWork = { ...dependencies.gridView.groupDiagnostics() };
        syncWatchGroups(state, result.changed, 'manual-choice');
        log(tLog('viewingChoiceApplied'), {
            saved: result.saved, action: result.action, targetGroup: result.targetGroup,
            automaticStatus: result.automaticStatus, placement: result.placement,
            restoredAutomatic: result.restoredAutomatic, manualMarkerVisible: result.manualMarkerVisible,
            changedTitles: result.changedTitles, completed: dependencies.gridView.presentation().completedCount,
            work: Object.fromEntries(Object.entries(dependencies.gridView.groupDiagnostics())
                .filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, value - beforeWork[key]]))
        });
    }

    function cancelGroupHover() {
        dependencies.hover.cancel('group');
    }

    function syncWatchGroups(state, changedIds = null, reason = 'reconcile') {
        if (dependencies.source.current !== state || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus, grid = state.grid;
        const guard = () => {
            dependencies.viewing.assertCurrent(watch);
            if (dependencies.source.current !== state || state.watchStatus !== watch || state.grid !== grid || dependencies.gridView.root !== grid) throw session.createRouteSessionCancelledError();
        };
        guard();
        const reconciled = dependencies.viewing.reconcile(watch, changedIds);
        const ids = reconciled === null || !dependencies.gridView.presentation().initialized ? null : new Set(reconciled);
        guard();
        dependencies.gridView.applyViewingChange({ items: state.items || [], changedIds: ids, reason, assertCurrent: guard,
            metadata: { disabled: dependencies.viewing.presentation(watch).disabled, loading: dependencies.viewing.presentation(watch).loading,
                manualFailure: dependencies.viewing.presentation(watch).manualFailure, locale: getUiLocale(), totalCount: state.totalCount,
                initializationElapsedMs: state.initializationElapsedMs },
            readPlacement(item, classify) {
                const id = String(item.videoId);
                return classify ? dependencies.viewing.placement(watch, id) : { manual: dependencies.viewing.hasChoice(watch, id) };
            },
            onAction: item => applyManualViewingChoice(state, item), onRefresh: () => refreshViewingStatus(state),
            onRequest: request => syncWatchGroups(state, [], request), onHoverChanged: cancelGroupHover,
            readProtectedCards: () => dependencies.hover.protectedCards(),
            isProtectedSourceCurrent: () => !dependencies.nativePopup.diagnostics().geometryOwned || dependencies.nativePopup.diagnostics().sourceConnected,
            releaseInteraction: handle => dependencies.nativePopup.retire(handle),
            formatHeader: summary => formatHeaderParts(state.items.length, state.totalCount, state.initializationElapsedMs, true, summary)
        });
        guard(); dependencies.source.acceptStatus(state, dependencies.gridView.status);
    }

    function bindViewingSession(state, sessionToken, preserve = false) {
        const grid = state.grid, previous = state.watchStatus;
        const watch = dependencies.viewing.createSession({ previous: preserve ? previous : null,
            sessionToken, readItems: () => state.items || [],
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (dependencies.source.current !== state || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected) throw session.createRouteSessionCancelledError();
            },
            onChange: change => syncWatchGroups(state, change.ids, change.reason),
            readPresentation: () => ({ completed: dependencies.gridView.presentation().completedCount, unknown: dependencies.gridView.presentation().unknownCount }),
            readWork: dependencies.diagnostics.collectPerformanceDiagnostics });
        watches.set(state, watch);
        dependencies.viewing.dispose(previous); return watch;
    }

    function initializeWatchGroups(state, sessionToken) {
        const watch = bindViewingSession(state, sessionToken);
        dependencies.viewing.assertCurrent(watch);
        dependencies.gridView.resetViewing(); dependencies.viewing.start(watch);
    }

    function refreshViewingStatus(state) {
        if (dependencies.source.current === state && state.watchStatus) return dependencies.viewing.refresh(state.watchStatus);
    }

    function retireMutationCard(record, { correlationId, parent, assertCurrent, onAccepted }) {
        assertCurrent();
        const clone = parent.cloneMap?.get(dependencies.source.itemKey(record));
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
        const clone = parent.cloneMap?.get(dependencies.source.itemKey(record));
        if (clone?.isConnected) dependencies.source.copyItemAttributes(clone, record, index);
        assertCurrent();
    }

    function presentListOrder(change, { parent, assertCurrent }) {
        assertCurrent();
        if (parent.grid && !parent.watchStatus) dependencies.gridView.applyMembershipOrder(change, assertCurrent);
    }

    function presentListChange({ count, empty, logical }, { parent, assertCurrent }) {
        assertCurrent(); dependencies.source.acceptEmpty(parent, empty);
        if (logical && count) { dependencies.responsive.requestCheck(140, 'my-list-delta'); assertCurrent(); }
        dependencies.gridView.setEmpty(empty); assertCurrent();
        dependencies.source.waitForEmpty(empty);
        if (empty) dependencies.source.syncLegacyEmptyState(parent.section, { allowProvisional: true });
        else dependencies.gridView.clearEmpty();
        assertCurrent(); dependencies.nativePopup.invalidate(); assertCurrent();
        if (parent.watchStatus) { syncWatchGroups(parent); assertCurrent(); }
        const status = updateStatus(formatHeaderParts(count, count, parent.initializationElapsedMs, true));
        assertCurrent(); dependencies.source.acceptStatus(parent, status);
        if (status && parent.layout) {
            dependencies.source.layoutFrameStatus(status, null, settings.preferences().viewOriginalMyList && !empty ? (parent.layout.rowGap || 0) : 0);
            assertCurrent();
        }
    }

    function updateStatus(content) {
        return dependencies.gridView.updateStatus(content);
    }

    async function buildGrid(section, scroller, transfer, layout, totalCount, sessionToken = session.scope.token) {
        const buildState = dependencies.source.current;
        const track = buildState?.track;
        const assertBuildParent = () => {
            session.assertRouteSession(sessionToken);
            if (dependencies.source.current !== buildState) throw session.createRouteSessionCancelledError();
            if (!section.isConnected || !scroller.isConnected || !track?.isConnected ||
                buildState.section !== section || buildState.scroller !== scroller || buildState.track !== track) {
                throw session.initializationError('GRID_BUILD_SOURCE_REPLACED', 'grid-construction',
                    'Native My List source changed during grid construction');
            }
        };
        const items = transfer.records;
        const publication = dependencies.source.stageGridPublication(buildState, transfer, totalCount, { assertCurrent: assertBuildParent });
        const assertBuildActive = publication.assertCurrent;
        assertBuildActive();
        const geometry = dependencies.source.currentGridGeometry(section, layout);
        const status = updateStatus(formatHeaderParts(items.length, totalCount, null));
        dependencies.source.syncStatusTypography(section, status);
        let grid;
        try {
            grid = await dependencies.gridView.publish({ items: transfer.records, readMaterial: transfer.readMaterial, releaseMaterial: transfer.release,
                readPage: (record, index) => publication.readPage(record) ?? Math.floor(index / Math.max(1, layout.columns)),
                section, anchor: scroller, status, geometry, layout, visible: settings.preferences().viewOriginalMyList, assertCurrent: assertBuildActive,
                onAccepted(root) {
                    publication.commit({ grid: root, status, layout });
                    if (buildState.watchStatus) bindViewingSession(buildState, sessionToken, true);
                } });
        } finally { publication.discard(); transfer.discard(); }
        dependencies.gridView.clearEmpty({ restoreGrid: false });
        if (dependencies.source.current.watchStatus) syncWatchGroups(dependencies.source.current);

        dependencies.responsive.acceptLayout(layout);
        // Remember the viewport used to publish this grid before observing the
        // source's own collapse to the hidden, one-pixel standby height.
        dependencies.source.acceptViewportSignature(buildState, dependencies.responsive.viewportSignature());

        dependencies.responsive.observe();

        log(tLog('legacyGridBuilt'), {
            items: items.length,
            totalCount,
            geometry,
            layout: dependencies.diagnostics.layoutSummary(layout),
            gridCards: dependencies.gridView.cards.size
        });

        return grid;
    }

    return Object.freeze({ watchFor: parent => watches.get(parent), retireViewing: parent => dependencies.viewing.dispose(watches.get(parent)),
        formatInitializationErrorMeta, formatHeaderParts, placeLegacyFrame, initializeWatchGroups,
        retireMutationCard, prepareMutationInsertion, insertMutationCard, updateMutationCard, presentListOrder,
        presentListChange, updateStatus, buildGrid });
}
