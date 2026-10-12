// Private accepted-source facts and exact resource receipts.
export function createDisplaySource(dependencies) {
    const { environment, settings, session } = dependencies;
    const { window } = environment;
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
        Object.defineProperty(view, 'watchStatus', { enumerable: true, get: () => value.watchStatus });
        parents.set(view, value); return Object.freeze(view);
    }
    function accept(parent) {
        if (!parent || parent !== sourceState) throw session.createRouteSessionCancelledError();
        return owned(parent);
    }

    // Commit membership, hints and grid references in the rendering acceptance callback.
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

    function attachGridRegistry(state) {
        Object.defineProperty(owned(state), 'cloneMap', { enumerable: true, configurable: true, get: () => dependencies.gridView.cards });
        return state;
    }

    function applyOriginalMyListVisibility() {
        if (!sourceState?.section && !session.isTargetPage()) return;
        if (!nativeSourcePresentation(undefined, undefined, undefined, { visible: settings.preferences().viewOriginalMyList })) return;
        if (sourceState?.status) {
            layoutFrameStatus(sourceState.status, null, settings.preferences().viewOriginalMyList ? (sourceState.layout?.rowGap || 0) : 0);
        }
    }

    function measureNativeCarouselGap(section) {
        const state = sourceState, sessionToken = session.scope.token;
        const gap = dependencies.netflixDom.readRowGap(section, window.innerWidth);
        session.assertRouteSession(sessionToken);
        if (sourceState !== state) throw session.createRouteSessionCancelledError();
        return gap;
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

    function layoutSummary(layout) {
        if (!layout) return null;
        return {
            columns: layout.columns,
            cardWidth: Math.round((layout.cardWidth || 0) * 10) / 10,
            gap: Math.round((layout.gap || 0) * 10) / 10,
            rowGap: Math.round((layout.rowGap || 0) * 10) / 10,
            gridLeft: Math.round((layout.gridLeft || 0) * 10) / 10,
            gridWidth: Math.round((layout.gridWidth || 0) * 10) / 10,
            sidePadding: Math.round((layout.sidePadding || 0) * 10) / 10,
            sidePaddingLeft: Math.round((layout.sidePaddingLeft ?? layout.sidePadding ?? 0) * 10) / 10,
            sidePaddingRight: Math.round((layout.sidePaddingRight ?? layout.sidePadding ?? 0) * 10) / 10,
            scrollerWidth: Math.round((layout.scrollerWidth || 0) * 10) / 10,
            scrollerHeight: Math.round((layout.scrollerHeight || 0) * 10) / 10,
            widthRatio: Number.isFinite(layout.widthRatio)
                ? Math.round(layout.widthRatio * 100000) / 100000
                : null,
            formulaBased: Boolean(layout.formulaBased)
        };
    }

    const receipts = new WeakMap(), receiptParents = new WeakMap();
    function captureSource() {
        const parent = sourceState;
        if (!parent) return null;
        if (!receipts.has(parent)) {
            const fields = ['section', 'scroller', 'track', 'layout', 'grid', 'status', 'items', 'totalCount', 'collectedCount',
                'empty', 'resizeViewportSignature', 'initialPage', 'initializationStartedAt', 'initializationElapsedMs'];
            const receipt = Object.defineProperties({}, Object.fromEntries(fields.map(key => [key, { enumerable: true, get: () => parent[key] }])));
            Object.defineProperty(receipt, 'viewingActive', { enumerable: true, get: () => Boolean(parent.watchStatus) });
            Object.defineProperty(receipt, 'cardCount', { enumerable: true, get: () => parent.cloneMap?.size ?? 0 });
            Object.freeze(receipt); receipts.set(parent, receipt); receiptParents.set(receipt, parent);
        }
        return receipts.get(parent);
    }
    const unwrap = value => receiptParents.get(value) || value;
    return Object.freeze({ get current() { return sourceState; }, get completed() { return completedSection; },
        get waitingForEmpty() { return waitingForNativeEmpty; },
        replace(next) { sourceState = parentView(next); return sourceState; },
        retireParent(parent) { parent?.listMembership?.dispose(); parent?.nativePageHints?.dispose(); },
        complete(section) { completedSection = section; }, waitForEmpty(value) { waitingForNativeEmpty = value; },
        acceptLayout(parent, layout) { accept(parent).layout = layout; },
        acceptInitialPage(parent, page) { accept(parent).initialPage = page; },
        acceptViewportSignature(parent, signature) { accept(parent).resizeViewportSignature = signature; },
        acceptStatus(parent, status) { accept(parent).status = status; },
        acceptEmpty(parent, empty) { accept(parent).empty = empty; },
        acceptElapsed(parent, elapsed) { accept(parent).initializationElapsedMs = elapsed; },
        acceptViewing(parent, watch) { accept(parent).watchStatus = watch; },
        releasePresentation() { const lease = nativePresentationLease; nativePresentationLease = null; lease?.release(); },
        captureSource, unwrap, layoutSummary, applyOriginalMyListVisibility, measureNativeCarouselGap, applyLegacyEmptyStateGeometry, layoutFrameStatus, syncStatusTypography, currentGridGeometry, applyGridGeometry, copyItemAttributes, owned, stageGridPublication, pageForItem, setPageForItem, ensureListMembership, attachNativeBinding, nativeSourcePresentation, markOriginalHeader, nativeLayoutObservation, nativeDiscoveryObservation, nativeSourceDiagnostics, nativeSourceObservation, nativePageObservation, itemKey, attachGridRegistry });
}
