// Private native collection, bootstrap proof, captured material and diagnostics.
export function createCollection({ native, navigation, scope, performance, requestAnimationFrame,
    cancelAnimationFrame, captureItem, videoIdFromHref, cardSelector, createError: initializationError,
    log = () => {}, warn = () => {}, tLog = value => value, logTimeout: logOperationTimeout = () => {} }) {
    const LOGICAL_COLLECTION_TIMEOUT_MS = 120000, PARTIAL_PAGE_RECOVERY_TIMEOUT_MS = 2500, PAGE_STABLE_TIMEOUT_MS = 2000;
    const NETFLIX_DOM_SELECTORS = { standardCard: cardSelector };
    const assertRouteSession = token => scope.assertCurrent(token);
    const { model: getCarouselDomRuntime, resetModel: resetCarouselDomRuntime,
        profile: detectCarouselDomProfile, profileSummary: carouselDomProfileSummary,
        currentSlots: currentPageSlots, signatureOf: visibleSignature, selectedPage, pageCount,
        logicalWindow: nativeLogicalPageState, requireLogicalWindow: requireNativeLogicalPageState,
        forcePage: forceLogicalPageSignature, navigationControl: carouselMoveButton,
        controlDisabled: carouselMoveButtonDisabled } = native;
    const { move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage,
        transform: trackTransformValue, restoreFast: restoreNativePageFast } = navigation;
    const itemFromSlot = captureItem;
    const itemKey = item => item.videoId ? 'v:' + item.videoId : 'h:' + item.href;
    const itemKeyFromCard = card => {
        const href = card?.href || card?.getAttribute?.('href') || '';
        if (!href) return '';
        const id = videoIdFromHref(href);
        return id ? 'v:' + id : 'h:' + href;
    };
    const itemSummary = item => item ? { videoId: item.videoId || '', page: item.page,
        href: item.href || '', ariaLabel: item.ariaLabel || '' } : null;
    const initializationTimeoutError = (stage, timeoutMs, details) => initializationError('INITIALIZATION_TIMEOUT', stage,
        'Timeout at ' + stage + ' after ' + timeoutMs + ' ms', { timeoutMs, ...details });
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
        const operation = { binding, sessionToken, counters: currentCounters(), onProgress, material: new Set(), initialPage: null,
            columns: columns || currentPageSlots(scroller, track).length || 1 };
        assertOperation(operation);
        operations.add(operation);
        try {
            const items = await collectAllItems(section, scroller, track, totalCount, sessionToken, operation);
            assertOperation(operation);
            operation.material.clear(); // Successful return transfers material to the caller.
            return Object.freeze({ items, initialPage: operation.initialPage, collectedCount: items.length,
                complete: !Number.isFinite(totalCount) || items.length === totalCount });
        } catch (error) {
            releaseMaterial(operation);
            throw error;
        } finally { operations.delete(operation); }
    }

    async function collectAllItemsLogical(section, scroller, track, totalCount, sessionToken = null, operation) {
        assertRouteSession(sessionToken);
        const bindingOwner = native.borrowBinding(section, scroller, track);
        native.assertBinding(bindingOwner);
        const snapshotWork = operation.counters;
        if (!Number.isFinite(totalCount) || totalCount < 0) {
            throw initializationError(
                'TOTAL_COUNT_REQUIRED',
                'total-count-detection',
                'Generation 2 collection requires a known My List totalCount',
                { totalCount, carouselDom: carouselDomProfileSummary(section) }
            );
        }

        let runtime = resetCarouselDomRuntime(section);
        native.beginCollection(section);
        const goal = totalCount;
        const itemsByLogicalIndex = new Map();
        const videoIndex = new Map();
        const seenKeys = new Set();
        const visitedSignatures = new Set();
        const responsiveColumns = operation.columns || currentPageSlots(scroller, track).length || 1;
        const estimatedPages = Math.max(1, Math.ceil(totalCount / Math.max(1, responsiveColumns)));
        const started = performance.now();
        const stablePageTransforms = new Map();
        let initialPage = null;
        let endingPage = 0;
        let completionReason = '';

        const collectedCount = () => itemsByLogicalIndex.size;

        const ensureCollectionTime = stage => {
            const elapsedMs = performance.now() - started;
            if (elapsedMs < LOGICAL_COLLECTION_TIMEOUT_MS) return;
            const details = {
                stage,
                elapsedMs: Math.round(elapsedMs),
                collected: collectedCount(),
                totalCount,
                missing: Math.max(0, totalCount - collectedCount()),
                logicalPage: runtime.currentPage,
                carouselDom: carouselDomProfileSummary(section)
            };
            logOperationTimeout('logical-full-collection', LOGICAL_COLLECTION_TIMEOUT_MS, details);
            throw initializationTimeoutError('logical-full-collection', LOGICAL_COLLECTION_TIMEOUT_MS, details);
        };

        const incomplete = (stage, reason, details = {}) => {
            const payload = {
                stage,
                reason,
                collected: collectedCount(),
                totalCount,
                missing: Math.max(0, totalCount - collectedCount()),
                logicalPage: runtime.currentPage,
                cycleDetected: runtime.cycleDetected,
                snapshotWork: { ...snapshotWork },
                carouselDom: carouselDomProfileSummary(section),
                ...details
            };
            warn(tLog('fullCollectionIncomplete'), payload);
            throw initializationError('COLLECTION_INCOMPLETE', stage, `Collection incomplete at ${stage}: ${reason}`, payload);
        };

        log(tLog('fullCollectionStarted'), {
            totalCount,
            goal,
            domGeneration: runtime.profile.generation,
            navigationMode: runtime.profile.navigationMode,
            pageMode: runtime.profile.pageMode,
            selectedPage: selectedPage(section),
            currentPageCards: currentPageSlots(scroller, track).length,
            expectedPageSlots: responsiveColumns,
            internalIndicator: 'netflix-react-item-index'
        });

        const motionLease = native.suppressMotion(section, track);

        try {
            let guard = estimatedPages * 3 + 12;
            let previousPageSignature = '';

            while (guard-- > 0 && collectedCount() < goal) {
                ensureCollectionTime('collect-page');
                const beforeCount = collectedCount();
                const remaining = Math.max(0, goal - beforeCount);
                const expectedSlots = Math.max(1, Math.min(responsiveColumns, remaining));
                const stabilizeStarted = performance.now();
                const slots = await waitStableCurrentPage(scroller, track, {
                    previousSignature: previousPageSignature,
                    minimumSlots: expectedSlots,
                    minimumNewItems: 1,
                    seenKeys,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);
                let stabilizedSignature = visibleSignature(slots);
                let stabilizedTransform = trackTransformValue(track);
                let pageState = nativeLogicalPageState(
                    scroller,
                    track,
                    totalCount,
                    responsiveColumns
                );
                const initialLogicalPageStateValid =
                    pageState.positions.length > 0 &&
                    pageState.positions.every(position => Number.isSafeInteger(position.itemIndex)) &&
                    Number.isFinite(pageState.page);

                if (!initialLogicalPageStateValid) {
                    const fullWindowSlots = Math.max(1, Math.min(responsiveColumns, totalCount));
                    log('Transient partial logical page detected; waiting for native window completion', {
                        totalCount,
                        columns: responsiveColumns,
                        requestedMinimumSlots: expectedSlots,
                        recoveryMinimumSlots: fullWindowSlots,
                        slots: pageState.slots.length,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        resolvedPage: pageState.page
                    });
                    const recoveredSlots = await waitStableCurrentPage(scroller, track, {
                        previousSignature: '',
                        minimumSlots: fullWindowSlots,
                        minimumNewItems: 1,
                        seenKeys,
                        requiredStableFrames: 2,
                        timeout: PARTIAL_PAGE_RECOVERY_TIMEOUT_MS,
                        sessionToken
                    });
                    assertRouteSession(sessionToken);
                    native.assertBinding(bindingOwner);
                    stabilizedSignature = visibleSignature(recoveredSlots);
                    stabilizedTransform = trackTransformValue(track);
                    pageState = requireNativeLogicalPageState(
                        scroller,
                        track,
                        totalCount,
                        responsiveColumns,
                        'logical-item-index-detection-retry'
                    );
                } else {
                    pageState = requireNativeLogicalPageState(
                        scroller,
                        track,
                        totalCount,
                        responsiveColumns,
                        'logical-item-index-detection'
                    );
                }
                if (visibleSignature(pageState.slots) !== stabilizedSignature) {
                    incomplete('collect-page', 'raw-index-page-changed-during-stabilization', {
                        stabilizedSignature,
                        currentSignature: visibleSignature(pageState.slots),
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices
                    });
                }
                const page = pageState.page;
                native.notePage(section, page);
                forceLogicalPageSignature(section, stabilizedSignature, page);
                stablePageTransforms.set(page, stabilizedTransform);
                if (initialPage === null) {
                    initialPage = page;
                    operation.initialPage = initialPage;
                    publish(operation, { initialPage });
                    log('Logical My List native position located', {
                        page,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        signature: stabilizedSignature
                    });
                }

                if (visitedSignatures.has(stabilizedSignature) && collectedCount() < goal) {
                    native.markCycle(section);
                    incomplete('collect-page', 'known-signature-cycle-before-total-count', {
                        page,
                        signature: stabilizedSignature,
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices
                    });
                }
                visitedSignatures.add(stabilizedSignature);

                const newKeys = new Set();
                for (const position of pageState.positions) {
                    const card = position.slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const key = itemKeyFromCard(card);
                    if (key && !seenKeys.has(key)) newKeys.add(key);
                }

                log(tLog('collectionPageStabilized'), {
                    requestedPage: page,
                    actualPage: page,
                    slots: pageState.slots.length,
                    minimumSlots: expectedSlots,
                    newItemsReady: newKeys.size,
                    minimumNewItems: 1,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    itemIndices: pageState.itemIndices,
                    logicalIndices: pageState.logicalIndices,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted),
                    pageMode: 'logical'
                });

                if (pageState.slots.length < expectedSlots || newKeys.size < 1 || !stabilizedSignature) {
                    const details = {
                        requestedPage: page,
                        actualPage: page,
                        slots: pageState.slots.length,
                        minimumSlots: expectedSlots,
                        newItemsReady: newKeys.size,
                        minimumNewItems: 1,
                        signaturePresent: Boolean(stabilizedSignature),
                        itemIndices: pageState.itemIndices,
                        logicalIndices: pageState.logicalIndices,
                        pageMode: 'logical'
                    };
                    logOperationTimeout('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                    throw initializationTimeoutError('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                }

                const added = [];
                for (const position of pageState.positions) {
                    const logicalIndex = position.logicalIndex;
                    if (!Number.isSafeInteger(logicalIndex) || logicalIndex < 0 || logicalIndex >= totalCount) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'invalid-logical-index', {
                            page,
                            itemIndex: position.itemIndex,
                            logicalIndex
                        });
                    }
                    const canonicalPage = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                    snapshotWork.metadataReads++;
                    const item = itemFromSlot(position.slot, canonicalPage, false);
                    if (!item) { snapshotWork.invalidMetadata++; continue; }
                    const key = itemKey(item);
                    const existingAtIndex = itemsByLogicalIndex.get(logicalIndex);
                    if (existingAtIndex && itemKey(existingAtIndex) !== key) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'logical-index-content-changed-during-scan', {
                            page,
                            logicalIndex,
                            previous: itemSummary(existingAtIndex),
                            current: itemSummary(item)
                        });
                    }
                    const existingIndex = videoIndex.get(key);
                    if (Number.isSafeInteger(existingIndex) && existingIndex !== logicalIndex) {
                        snapshotWork.consistencyFailures++;
                        incomplete('collect-page', 'video-id-moved-during-scan', {
                            page,
                            key,
                            previousLogicalIndex: existingIndex,
                            currentLogicalIndex: logicalIndex
                        });
                    }
                    if (existingAtIndex) { snapshotWork.duplicateSnapshotsAvoided++; continue; }
                    // Capture only after identity/index consistency checks in
                    // this synchronous sample, before native navigation resumes.
                    captureMaterial(operation, item, position.slot);
                    snapshotWork.snapshotsCaptured++;
                    item.logicalIndex = logicalIndex;
                    itemsByLogicalIndex.set(logicalIndex, item);
                    videoIndex.set(key, logicalIndex);
                    seenKeys.add(key);
                    added.push(item);
                }

                log(tLog('collectionPageResult'), {
                    actualPage: page,
                    added: added.length,
                    total: collectedCount(),
                    goal,
                    missing: Math.max(0, goal - collectedCount()),
                    pageMode: 'logical',
                    snapshotWork: { ...snapshotWork },
                    items: added.map(itemSummary)
                });
                publish(operation, { collectedCount: collectedCount(), totalCount });

                endingPage = page;
                if (collectedCount() >= goal) {
                    completionReason = 'total-count-and-logical-index-range-reached';
                    break;
                }

                previousPageSignature = stabilizedSignature;
                const rightControl = carouselMoveButton(section, scroller, 1);
                if (!rightControl.button) {
                    incomplete('advance-right', 'right-control-not-found', { selector: rightControl.selector, page });
                }
                if (carouselMoveButtonDisabled(rightControl.button)) {
                    incomplete('advance-right', 'right-edge-before-total-count', { page });
                }

                const beforeSignature = stabilizedSignature;
                await moveOnePage(section, scroller, 1, null, sessionToken);
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);
                const afterSignature = visibleSignature(currentPageSlots(scroller, track));
                if (!afterSignature || afterSignature === beforeSignature) {
                    incomplete('advance-right', 'enabled-control-did-not-change-page', {
                        page,
                        beforeSignature,
                        afterSignature
                    });
                }
            }

            if (collectedCount() !== totalCount) {
                incomplete('validate-count', guard <= 0 ? 'guard-exhausted' : 'collected-count-mismatch', {
                    expected: totalCount,
                    actual: collectedCount()
                });
            }

            const missingLogicalIndices = [];
            for (let index = 0; index < totalCount; index++) {
                if (!itemsByLogicalIndex.has(index)) missingLogicalIndices.push(index);
            }
            if (missingLogicalIndices.length) {
                incomplete('validate-logical-index-range', 'logical-index-gap', {
                    missingLogicalIndices
                });
            }

            const items = Array.from({ length: totalCount }, (_, logicalIndex) => {
                const item = itemsByLogicalIndex.get(logicalIndex);
                item.logicalIndex = logicalIndex;
                item.page = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                return item;
            });
            const uniqueKeys = new Set(items.map(itemKey).filter(Boolean));
            if (uniqueKeys.size !== totalCount) {
                incomplete('validate-logical-index-range', 'duplicate-item-key-across-logical-indices', {
                    expected: totalCount,
                    uniqueKeys: uniqueKeys.size
                });
            }

            completionReason = completionReason || 'total-count-and-logical-index-range-reached';
            native.completeCollection(section, estimatedPages);
            initialPage = Number.isFinite(initialPage) ? initialPage : 0;
            operation.initialPage = initialPage;
            publish(operation, { initialPage });
            forceLogicalPageSignature(section, visibleSignature(currentPageSlots(scroller, track)), endingPage);
            log(tLog('logicalCarouselPagesFinalized'), {
                pageCount: runtime.knownPageCount,
                pageCountFinalized: runtime.pageCountFinalized,
                endingPage,
                initialPage,
                signatures: runtime.signatureToPage.size,
                totalCount,
                collected: items.length,
                completionReason,
                cycleDetected: runtime.cycleDetected,
                indexCoverage: `${itemsByLogicalIndex.size}/${totalCount}`
            });

            if (endingPage !== initialPage) {
                const restorationStarted = performance.now();
                const canonicalTargetTransform = stablePageTransforms.get(initialPage) || '';
                const restorationComplete = await restoreNativePageFast(
                    section,
                    scroller,
                    track,
                    items,
                    responsiveColumns,
                    initialPage,
                    canonicalTargetTransform,
                    sessionToken
                );
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);
                log(tLog('nativeRestorationResult'), {
                    from: endingPage,
                    target: initialPage,
                    selectedPage: selectedPage(section),
                    complete: restorationComplete && selectedPage(section) === initialPage,
                    elapsedMs: Math.round(performance.now() - restorationStarted),
                    pageMode: 'logical'
                });
                if (!restorationComplete || selectedPage(section) !== initialPage) {
                    incomplete('restore-initial-page', 'native-restoration-incomplete', {
                        from: endingPage,
                        target: initialPage,
                        selectedPage: selectedPage(section)
                    });
                }
            }

            assertRouteSession(sessionToken);
            native.assertBinding(bindingOwner);
            log(tLog('fullCollectionCompleted'), {
                collected: items.length,
                totalCount,
                goal,
                completionReason,
                cycleDetected: runtime.cycleDetected,
                elapsedMs: Math.round(performance.now() - started),
                endingPage,
                restoredPage: selectedPage(section),
                initialPage,
                pageMode: 'logical',
                domGeneration: runtime.profile.generation,
                snapshotWork: { ...snapshotWork },
                ids: items.map(item => item.videoId || item.href)
            });
            return items;
        } finally {
            motionLease.release();
        }
    }

    async function collectAllItems(section, scroller, track, totalCount, sessionToken = null, operation) {
        assertRouteSession(sessionToken);
        const bindingOwner = native.borrowBinding(section, scroller, track);
        native.assertBinding(bindingOwner);
        const profile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'logical') {
            return collectAllItemsLogical(section, scroller, track, totalCount, sessionToken, operation);
        }
        assertRouteSession(sessionToken);
        native.assertBinding(bindingOwner);
        const snapshotWork = operation.counters;
        const items = [];
        const seen = new Set();
        const pages = pageCount(section);
        const goal = Number.isFinite(totalCount) ? totalCount : Infinity;
        const initialCurrentSlots = currentPageSlots(scroller, track);
        const responsiveColumns = operation.columns || initialCurrentSlots.length || 1;
        // A genuine one-page My List may contain fewer cards than the responsive
        // column count. waitForNativeCarouselReady() has already required that
        // one-page shape to remain stable, so use its actual mounted card count
        // as the completion target instead of waiting forever for nonexistent slots.
        const expectedPageSlots = pages === 1
            ? Math.max(1, initialCurrentSlots.length)
            : Math.max(
                1,
                Math.min(
                    responsiveColumns,
                    Number.isFinite(totalCount) ? totalCount : responsiveColumns
                )
            );
        const started = performance.now();
        const initialPage = selectedPage(section);
        operation.initialPage = initialPage;
        publish(operation, { initialPage });

        log(tLog('fullCollectionStarted'), {
            totalCount,
            goal,
            pages,
            selectedPage: selectedPage(section),
            currentPageCards: currentPageSlots(scroller, track).length,
            expectedPageSlots
        });

        const stablePageTransforms = new Map();
        let endingPage = initialPage;

        // Keep animation suppression active for the whole scan. This avoids paying a
        // second DOM-settle wait in moveOnePage() while still preventing native slide animation.
        const motionLease = native.suppressMotion(section, track);

        try {
            assertRouteSession(sessionToken);
            native.assertBinding(bindingOwner);
            const signatureBeforeStartMove = visibleSignature(currentPageSlots(scroller, track));
            await goToPage(section, scroller, 0, null, sessionToken);
            assertRouteSession(sessionToken);
            native.assertBinding(bindingOwner);
            let previousPageSignature = initialPage === 0 ? '' : signatureBeforeStartMove;

            for (let page = 0; page < pages && (!Number.isFinite(goal) || items.length < goal); page++) {
                const actualPage = selectedPage(section);
                const beforeCount = items.length;
                const remaining = Number.isFinite(goal) ? Math.max(0, goal - items.length) : Infinity;
                const singlePageList = pages === 1;
                const minimumNewItems = singlePageList
                    ? expectedPageSlots
                    : (page < pages - 1
                        ? Math.min(expectedPageSlots, remaining)
                        : (Number.isFinite(remaining) ? Math.min(expectedPageSlots, remaining) : 1));
                const minimumSlots = singlePageList
                    ? expectedPageSlots
                    : (page < pages - 1
                        ? expectedPageSlots
                        : (Number.isFinite(remaining) ? Math.min(expectedPageSlots, Math.max(1, remaining)) : expectedPageSlots));
                const stabilizeStarted = performance.now();
                const slots = await waitStableCurrentPage(scroller, track, {
                    previousSignature: previousPageSignature,
                    minimumSlots,
                    minimumNewItems,
                    seenKeys: seen,
                    sessionToken
                });
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);
                const stabilizedSignature = visibleSignature(slots);
                const stabilizedTransform = trackTransformValue(track);
                stablePageTransforms.set(actualPage, stabilizedTransform);
                const newKeys = new Set();
                for (const slot of slots) {
                    const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const key = itemKeyFromCard(card);
                    if (key && !seen.has(key)) newKeys.add(key);
                }

                log(tLog('collectionPageStabilized'), {
                    requestedPage: page,
                    actualPage,
                    slots: slots.length,
                    minimumSlots,
                    newItemsReady: newKeys.size,
                    minimumNewItems,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted)
                });

                if (slots.length < minimumSlots || newKeys.size < minimumNewItems) {
                    warn(tLog('collectionStoppedBecauseThePageNeverReachedTheExpectedStableState'), {
                        requestedPage: page,
                        actualPage,
                        slots: slots.length,
                        minimumSlots,
                        newItemsReady: newKeys.size,
                        minimumNewItems,
                        timeoutMs: PAGE_STABLE_TIMEOUT_MS
                    });
                    break;
                }

                for (const slot of slots) {
                    if (Number.isFinite(goal) && items.length >= goal) break;
                    snapshotWork.metadataReads++;
                    const item = itemFromSlot(slot, actualPage, false);
                    if (!item) { snapshotWork.invalidMetadata++; continue; }
                    const key = itemKey(item);
                    if (seen.has(key)) { snapshotWork.duplicateSnapshotsAvoided++; continue; }
                    captureMaterial(operation, item, slot);
                    snapshotWork.snapshotsCaptured++;
                    seen.add(key);
                    items.push(item);
                }

                const added = items.slice(beforeCount);
                log(tLog('collectionPageResult'), {
                    actualPage,
                    added: added.length,
                    total: items.length,
                    goal,
                    snapshotWork: { ...snapshotWork },
                    items: added.map(itemSummary)
                });

                publish(operation, { collectedCount: items.length, totalCount });

                if ((Number.isFinite(goal) && items.length >= goal) || actualPage >= pages - 1) break;
                previousPageSignature = stabilizedSignature;
                const next = await moveOnePage(section, scroller, 1, null, sessionToken);
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);
                if (next === actualPage) {
                    warn(tLog('couldNotAdvanceDuringFullCollection'), {
                        actualPage,
                        items: items.length,
                        goal
                    });
                    break;
                }
            }

            endingPage = selectedPage(section);
            if (endingPage !== initialPage) {
                const restorationStarted = performance.now();
                const canonicalTargetTransform = stablePageTransforms.get(initialPage) || '';
                log(tLog('nativeRestorationBaselineCaptured'), {
                    from: endingPage,
                    target: initialPage,
                    pages,
                    pageCountParity: pages % 2 === 0 ? 'even' : 'odd',
                    moveCount: Math.abs(endingPage - initialPage),
                    moveCountParity: Math.abs(endingPage - initialPage) % 2 === 0 ? 'even' : 'odd',
                    canonicalTargetTransform
                });
                const restorationComplete = await restoreNativePageFast(
                    section,
                    scroller,
                    track,
                    items,
                    expectedPageSlots,
                    initialPage,
                    canonicalTargetTransform,
                    sessionToken
                );
                assertRouteSession(sessionToken);
                native.assertBinding(bindingOwner);

                log(tLog('nativeRestorationResult'), {
                    from: endingPage,
                    target: initialPage,
                    selectedPage: selectedPage(section),
                    complete: restorationComplete && selectedPage(section) === initialPage,
                    elapsedMs: Math.round(performance.now() - restorationStarted)
                });

                // Keep suppression through two more paints after the expected original
                // page is mounted so deferred Netflix writes cannot animate on release.
                if (restorationComplete && selectedPage(section) === initialPage) {
                    await nextFrame(operation);
                    assertRouteSession(sessionToken);
                    native.assertBinding(bindingOwner);
                    await nextFrame(operation);
                    assertRouteSession(sessionToken);
                    native.assertBinding(bindingOwner);
                }
            }
        } finally {
            motionLease.release();
        }

        assertRouteSession(sessionToken);
        native.assertBinding(bindingOwner);
        log(tLog('fullCollectionCompleted'), {
            collected: items.length,
            totalCount,
            goal,
            elapsedMs: Math.round(performance.now() - started),
            endingPage,
            restoredPage: selectedPage(section),
            initialPage,
            snapshotWork: { ...snapshotWork },
            ids: items.map(item => item.videoId || item.href)
        });
        return items;
    }

    return Object.freeze({ collect, mountedBootstrap, collectMounted, reset, resetDiagnostics() { counterSession = scope.token; counters = newCounters(); },
        diagnostics: () => ({ ...currentCounters() }), pending: () => operations.size });
}
