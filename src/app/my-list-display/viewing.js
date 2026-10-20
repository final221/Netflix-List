// Private viewing attachments: publish the replacement before retiring its predecessor.
export function createDisplayViewing(dependencies) {
    const { session, logger, i18n } = dependencies;
    const { log } = logger, { tLog, getUiLocale } = i18n;
    const watches = new WeakMap();
    function applyManualViewingChoice(state, item) {
        const watch = state.watchStatus, grid = state.grid;
        const assertCurrent = () => {
            dependencies.viewing.assertCurrent(watch);
            if (!dependencies.isCurrent(state) || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected || !state.items.includes(item)) throw session.createRouteSessionCancelledError();
        };
        if (dependencies.netflixContext.activeProfile() !== dependencies.viewing.presentation(watch).profile) {
            syncWatchGroups(state); return;
        }
        const result = dependencies.viewing.place(watch, String(item.videoId), { assertCurrent, name: item.ariaLabel });
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
        if (!dependencies.isCurrent(state) || !state.grid?.isConnected || !state.watchStatus) return;
        const watch = state.watchStatus, grid = state.grid;
        const guard = () => {
            dependencies.viewing.assertCurrent(watch);
            if (!dependencies.isCurrent(state) || state.watchStatus !== watch || state.grid !== grid || dependencies.gridView.root !== grid) throw session.createRouteSessionCancelledError();
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
            formatHeader: summary => dependencies.formatHeaderParts(state.items.length, state.totalCount, state.initializationElapsedMs, true, summary)
        });
        guard(); dependencies.onStatus(state, dependencies.gridView.status);
    }

    function bindViewingSession(state, sessionToken, preserve = false) {
        const grid = state.grid, previous = state.watchStatus;
        const watch = dependencies.viewing.createSession({ previous: preserve ? previous : null,
            sessionToken, readItems: () => state.items || [],
            assertCurrent() {
                session.assertRouteSession(sessionToken);
                if (!dependencies.isCurrent(state) || state.watchStatus !== watch || state.grid !== grid || !grid?.isConnected) throw session.createRouteSessionCancelledError();
            },
            onChange: change => syncWatchGroups(state, change.ids, change.reason),
            readPresentation: () => ({ completed: dependencies.gridView.presentation().completedCount, unknown: dependencies.gridView.presentation().unknownCount }),
            readWork: dependencies.readWork });
        watches.set(state, watch); dependencies.onAttached(state, watch);
        dependencies.viewing.dispose(previous); return watch;
    }

    function initializeWatchGroups(state, sessionToken) {
        const watch = bindViewingSession(state, sessionToken);
        dependencies.viewing.assertCurrent(watch);
        dependencies.gridView.resetViewing(); dependencies.viewing.start(watch);
    }

    function refreshViewingStatus(state) {
        if (dependencies.isCurrent(state) && state.watchStatus) return dependencies.viewing.refresh(state.watchStatus);
    }

    return Object.freeze({ retire: parent => dependencies.viewing.dispose(watches.get(parent)),
        bindViewingSession, initializeWatchGroups, syncWatchGroups });
}
