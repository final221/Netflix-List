import { createLogicalCollection } from './collection-logical.js';
import { createIndicatorCollection } from './collection-indicator.js';
// Private native collection, bootstrap proof, captured material and diagnostics.
export function createCollection({ native, navigation, scope, performance, requestAnimationFrame,
    cancelAnimationFrame, captureItem, videoIdFromHref, cardSelector, createError: initializationError,
    log = () => {}, warn = () => {}, tLog = value => value, logTimeout: logOperationTimeout = () => {} }) {
    const assertRouteSession = token => scope.assertCurrent(token);
    const { model: getCarouselDomRuntime, profile: detectCarouselDomProfile,
        currentSlots: currentPageSlots, selectedPage } = native;
    const { restoreFast: restoreNativePageFast } = navigation;
    const itemFromSlot = captureItem;
    const itemKeyFromCard = card => {
        const href = card?.href || card?.getAttribute?.('href') || '';
        if (!href) return '';
        const id = videoIdFromHref(href);
        return id ? 'v:' + id : 'h:' + href;
    };
    const itemSummary = item => item ? { videoId: item.videoId || '', page: item.page,
        href: item.href || '', ariaLabel: item.ariaLabel || '' } : null;
    const strategyOptions = { native, navigation, scope, performance, captureItem,
        videoIdFromHref, cardSelector, initializationError, log, warn, tLog, logOperationTimeout };
    const collectLogical = createLogicalCollection(strategyOptions);
    const collectIndicator = createIndicatorCollection(strategyOptions);
    const newCounters = () => ({ metadataReads: 0, snapshotsCaptured: 0, duplicateSnapshotsAvoided: 0,
        invalidMetadata: 0, consistencyFailures: 0 });
    let counters = newCounters();
    let counterSession = scope.token;
    let mountedProofs = new WeakMap();
    const operations = new Set(), frames = new Set();
    function currentCounters() {
        if (counterSession !== scope.token) {
            counterSession = scope.token;
            counters = newCounters();
        }
        return counters;
    }
    function assertOperation(operation) {
        assertRouteSession(operation.sessionToken);
        native.assertBinding(operation.binding);
    }
    function publish(operation, facts) {
        assertOperation(operation);
        operation.onProgress(facts);
        assertOperation(operation);
    }
    function captureMaterial(operation, item, slot) {
        assertOperation(operation);
        item.snapshot = slot.cloneNode(true);
        operation.material.add(item);
        assertOperation(operation);
    }
    function releaseMaterial(operation) {
        for (const item of operation.material) item.snapshot = null;
        operation.material.clear();
    }
    function nextFrame(operation) {
        assertOperation(operation);
        return new Promise((resolve, reject) => {
            let frame = null, closed = false;
            const close = () => {
                if (closed) return;
                closed = true;
                frames.delete(close);
                try { if (frame !== null) cancelAnimationFrame(frame); } catch (_) {}
                resolve();
            };
            frames.add(close);
            try { frame = requestAnimationFrame(close); }
            catch (error) { reject(error); close(); }
        });
    }
    function reset() {
        for (const close of [...frames]) close();
        for (const operation of operations) releaseMaterial(operation);
        mountedProofs = new WeakMap();
    }
    function readMountedMembership(section, scroller, track) {
        if (!section || !scroller || !track) return null;
        return native.sample(() => {
            const state = native.readiness(section, scroller, track);
            const countState = native.readCount(scroller, track);
            const totalCount = countState.totalCount;
            const slots = currentPageSlots(scroller, track);
            const itemIndices = slots.map(native.itemIndex);
            const videoIds = slots.map(native.cardIdentity).filter(Boolean);
            if (!state.connected || state.pageMode !== 'logical' || state.pages !== 1 ||
                !Number.isSafeInteger(totalCount) || totalCount <= 0 || totalCount > state.columns ||
                state.slots !== totalCount || state.cards !== totalCount || state.currentCards !== totalCount ||
                countState.slots !== totalCount || countState.uniqueReadings.length !== 1 ||
                countState.uniqueReadings[0] !== totalCount || itemIndices.length !== totalCount ||
                !itemIndices.every((value, index) => value === index) || videoIds.length !== slots.length ||
                new Set(videoIds).size !== videoIds.length) return null;
            const signature = [totalCount, state.signature, itemIndices.join(','), videoIds.join('|')].join('||');
            return { state, totalCount, slots, itemIndices, videoIds, signature };
        });
    }
    async function mountedBootstrap({ section, scroller, track, sessionToken = null }) {
        assertRouteSession(sessionToken);
        if (!section || !scroller || !track || section.isConnected === false ||
            scroller.isConnected === false || track.isConnected === false) return null;
        const operation = { binding: native.borrowBinding(section, scroller, track), sessionToken, material: new Set() };
        assertOperation(operation);
        operations.add(operation);
        try {
            const started = performance.now();
            let previousSignature = '';
            // Two identical mounted React samples, separated by the existing two frames.
            for (let sample = 0; sample < 2; sample++) {
                assertOperation(operation);
                const membership = readMountedMembership(section, scroller, track);
                if (!membership) return null;
                const { state, totalCount, itemIndices, videoIds, signature } = membership;
                if (previousSignature && signature === previousSignature) {
                    const result = Object.freeze({ totalCount, firstVideoId: videoIds[0] || null,
                        source: 'mounted-single-page-fast-path', elapsedMs: Math.round(performance.now() - started) });
                    assertOperation(operation);
                    mountedProofs.set(result, { binding: operation.binding, section, scroller, track, signature });
                    log('Mounted single-page My List fast bootstrap confirmed', {
                        ...result, slots: state.slots, cards: state.cards, currentCards: state.currentCards,
                        columns: state.columns, itemIndices });
                    assertOperation(operation);
                    return result;
                }
                previousSignature = signature;
                await nextFrame(operation);
                assertOperation(operation);
                await nextFrame(operation);
            }
            assertOperation(operation);
            return null;
        } finally { operations.delete(operation); }
    }
    function collectMounted({ bootstrap, totalCount, columns, section, scroller, track, sessionToken = null }) {
        assertRouteSession(sessionToken);
        const proof = mountedProofs.get(bootstrap);
        if (!proof || bootstrap.totalCount !== totalCount || !Number.isSafeInteger(columns) || totalCount > columns) {
            return { items: null, reason: 'proof-or-entry-no-longer-valid' };
        }
        if (!native.isBindingCurrent(proof.binding) || proof.section !== section || proof.scroller !== scroller ||
            proof.track !== track || !native.matchesMountedSource(section, scroller, track)) {
            return { items: null, reason: 'native-source-replaced' };
        }
        const operation = { binding: proof.binding, sessionToken, material: new Set() };
        assertOperation(operation);
        operations.add(operation);
        try {
            return native.sample(() => {
                const sample = readMountedMembership(section, scroller, track);
                assertOperation(operation);
                if (!sample || sample.totalCount !== totalCount || sample.signature !== proof.signature) {
                    return { items: null, reason: 'native-membership-or-layout-changed' };
                }
                // All metadata identities qualify before any native variant is cloned.
                const items = sample.slots.map(slot => itemFromSlot(slot, 0, false));
                assertOperation(operation);
                if (!items.every((item, index) => item?.videoId === sample.videoIds[index])) {
                    return { items: null, reason: 'native-card-metadata-incomplete' };
                }
                items.forEach((item, index) => captureMaterial(operation, item, sample.slots[index]));
                assertOperation(operation);
                operation.material.clear();
                return { items, reason: null };
            });
        } catch (error) {
            releaseMaterial(operation);
            throw error;
        } finally { operations.delete(operation); }
    }
    async function collect({ section, scroller, track, totalCount, columns, sessionToken = null, onProgress = () => {} }) {
        const binding = native.borrowBinding(section, scroller, track);
        assertRouteSession(sessionToken);
        native.assertBinding(binding);
        const operation = { binding, sessionToken, section, scroller, track, totalCount, counters: currentCounters(), onProgress, material: new Set(), initialPage: null,
            columns: columns || currentPageSlots(scroller, track).length || 1 };
        assertOperation(operation);
        operations.add(operation);
        try {
            const profile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);
            assertOperation(operation);
            const work = Object.freeze({ section, scroller, track, totalCount, sessionToken, columns: operation.columns,
                guard: () => assertOperation(operation),
                capture: (item, slot) => captureMaterial(operation, item, slot),
                nextFrame: () => nextFrame(operation), publish: facts => publish(operation, facts),
                acceptInitialPage(page) { assertOperation(operation); operation.initialPage = page; },
                bump(field) { assertOperation(operation); operation.counters[field]++; },
                snapshotWork: () => ({ ...operation.counters }),
                report: (...args) => scanReporter(operation, ...args) });
            const items = await (profile.pageMode === 'logical' ? collectLogical : collectIndicator)(work);
            assertOperation(operation);
            operation.material.clear(); // Successful return transfers material to the caller.
            return Object.freeze({ items, initialPage: operation.initialPage, collectedCount: items.length,
                complete: !Number.isFinite(totalCount) || items.length === totalCount });
        } catch (error) {
            releaseMaterial(operation);
            throw error;
        } finally { operations.delete(operation); }
    }

    function scanReporter(operation, goal, started, extra = {}) {
        const { section, scroller, track, totalCount, sessionToken, counters } = operation;
        const mode = extra.pageMode ? { pageMode: extra.pageMode } : {};
        return {
            pageFacts(requestedPage, actualPage, slots, minimumSlots, minimumNewItems, seen) {
                const newKeys = new Set(slots.map(slot => itemKeyFromCard(slot.querySelector(cardSelector)))
                    .filter(key => key && !seen.has(key)));
                return { requestedPage, actualPage, slots: slots.length, minimumSlots,
                    newItemsReady: newKeys.size, minimumNewItems, ...mode };
            },
            pageResult(actualPage, added, total, details = {}) {
                log(tLog('collectionPageResult'), { actualPage, added: added.length, total, goal,
                    ...mode, ...details, snapshotWork: { ...counters }, items: added.map(itemSummary) });
                publish(operation, { collectedCount: total, totalCount });
            },
            async restore(items, columns, initialPage, endingPage, canonicalTargetTransform, restorationStarted = performance.now()) {
                const restored = await restoreNativePageFast(section, scroller, track, items, columns,
                    initialPage, canonicalTargetTransform, sessionToken);
                assertOperation(operation);
                log(tLog('nativeRestorationResult'), { from: endingPage, target: initialPage,
                    selectedPage: selectedPage(section), complete: restored && selectedPage(section) === initialPage,
                    elapsedMs: Math.round(performance.now() - restorationStarted), ...mode });
                // Callers recheck selection after logging, which can invoke host code.
                return restored;
            },
            complete(items, endingPage, initialPage, details = {}) {
                assertOperation(operation);
                log(tLog('fullCollectionCompleted'), { collected: items.length, totalCount, goal,
                    ...details, elapsedMs: Math.round(performance.now() - started), endingPage,
                    restoredPage: selectedPage(section), initialPage, ...extra,
                    snapshotWork: { ...counters }, ids: items.map(item => item.videoId || item.href) });
            }
        };
    }

    return Object.freeze({ collect, mountedBootstrap, collectMounted, reset, resetDiagnostics() { counterSession = scope.token; counters = newCounters(); },
        diagnostics: () => ({ ...currentCounters() }), pending: () => operations.size });
}
