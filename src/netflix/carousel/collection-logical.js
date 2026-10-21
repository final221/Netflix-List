// Complete logical traversal; material and scheduled resources remain with collection.
export function createLogicalCollection({ native, navigation, scope, performance,
    captureItem, videoIdFromHref, cardSelector, initializationError, log, warn, tLog, logOperationTimeout }) {
    const LOGICAL_COLLECTION_TIMEOUT_MS = 120000, PARTIAL_PAGE_RECOVERY_TIMEOUT_MS = 2500, PAGE_STABLE_TIMEOUT_MS = 2000;
    const { resetModel: resetCarouselDomRuntime, profileSummary: carouselDomProfileSummary,
        currentSlots: currentPageSlots, signatureOf: visibleSignature, selectedPage, pageCount,
        logicalWindow: nativeLogicalPageState, requireLogicalWindow: requireNativeLogicalPageState,
        forcePage: forceLogicalPageSignature, navigationControl: carouselMoveButton,
        controlDisabled: carouselMoveButtonDisabled } = native;
    const { move: moveOnePage, stable: waitStableCurrentPage, transform: trackTransformValue } = navigation;
    const itemFromSlot = captureItem;
    const itemKey = item => item.videoId ? 'v:' + item.videoId : 'h:' + item.href;
    const itemSummary = item => item ? { videoId: item.videoId || '', page: item.page,
        href: item.href || '', ariaLabel: item.ariaLabel || '' } : null;
    const initializationTimeoutError = (stage, timeoutMs, details) => initializationError('INITIALIZATION_TIMEOUT', stage,
        'Timeout at ' + stage + ' after ' + timeoutMs + ' ms', { timeoutMs, ...details });

    async function collectAllItemsLogical(operation) {
        const { section, scroller, track, totalCount, sessionToken } = operation;
        operation.guard();
        const snapshotWork = operation.snapshotWork;
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
        const visitedSignatures = new Set();
        const responsiveColumns = operation.columns || currentPageSlots(scroller, track).length || 1;
        const estimatedPages = Math.max(1, Math.ceil(totalCount / Math.max(1, responsiveColumns)));
        const started = performance.now();
        const report = operation.report(goal, started, { pageMode: 'logical' });
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
                snapshotWork: snapshotWork(),
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
                    seenKeys: videoIndex,
                    sessionToken
                });
                operation.guard();
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
                        seenKeys: videoIndex,
                        requiredStableFrames: 2,
                        timeout: PARTIAL_PAGE_RECOVERY_TIMEOUT_MS,
                        sessionToken
                    });
                    operation.guard();
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
                    operation.acceptInitialPage(initialPage);
                    operation.publish({ initialPage });
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

                const pageFacts = report.pageFacts(page, page, pageState.positions.map(position => position.slot),
                    expectedSlots, 1, videoIndex);
                // Positions supply identities; the mounted window supplies the slot count.
                pageFacts.slots = pageState.slots.length;
                const indexFacts = { itemIndices: pageState.itemIndices, logicalIndices: pageState.logicalIndices };

                log(tLog('collectionPageStabilized'), {
                    ...pageFacts,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    ...indexFacts,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted),
                });

                if (pageState.slots.length < expectedSlots || pageFacts.newItemsReady < 1 || !stabilizedSignature) {
                    const details = {
                        ...pageFacts,
                        signaturePresent: Boolean(stabilizedSignature),
                        ...indexFacts
                    };
                    logOperationTimeout('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                    throw initializationTimeoutError('logical-page-stabilization', PAGE_STABLE_TIMEOUT_MS, details);
                }

                const added = [];
                for (const position of pageState.positions) {
                    const logicalIndex = position.logicalIndex;
                    if (!Number.isSafeInteger(logicalIndex) || logicalIndex < 0 || logicalIndex >= totalCount) {
                        operation.bump('consistencyFailures');
                        incomplete('collect-page', 'invalid-logical-index', {
                            page,
                            itemIndex: position.itemIndex,
                            logicalIndex
                        });
                    }
                    const canonicalPage = Math.min(estimatedPages - 1, Math.floor(logicalIndex / responsiveColumns));
                    operation.bump('metadataReads');
                    const item = itemFromSlot(position.slot, canonicalPage, false);
                    if (!item) { operation.bump('invalidMetadata'); continue; }
                    const key = itemKey(item);
                    const existingAtIndex = itemsByLogicalIndex.get(logicalIndex);
                    if (existingAtIndex && itemKey(existingAtIndex) !== key) {
                        operation.bump('consistencyFailures');
                        incomplete('collect-page', 'logical-index-content-changed-during-scan', {
                            page,
                            logicalIndex,
                            previous: itemSummary(existingAtIndex),
                            current: itemSummary(item)
                        });
                    }
                    const existingIndex = videoIndex.get(key);
                    if (Number.isSafeInteger(existingIndex) && existingIndex !== logicalIndex) {
                        operation.bump('consistencyFailures');
                        incomplete('collect-page', 'video-id-moved-during-scan', {
                            page,
                            key,
                            previousLogicalIndex: existingIndex,
                            currentLogicalIndex: logicalIndex
                        });
                    }
                    if (existingAtIndex) { operation.bump('duplicateSnapshotsAvoided'); continue; }
                    // Capture only after identity/index consistency checks in
                    // this synchronous sample, before native navigation resumes.
                    operation.capture(item, position.slot);
                    operation.bump('snapshotsCaptured');
                    item.logicalIndex = logicalIndex;
                    itemsByLogicalIndex.set(logicalIndex, item);
                    videoIndex.set(key, logicalIndex);
                    added.push(item);
                }

                report.pageResult(page, added, collectedCount(), { missing: Math.max(0, goal - collectedCount()) });

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
                operation.guard();
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

            const items = Array.from({ length: totalCount }, (_, logicalIndex) => itemsByLogicalIndex.get(logicalIndex));
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
            operation.acceptInitialPage(initialPage);
            operation.publish({ initialPage });
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
                const restorationComplete = await report.restore(items, responsiveColumns, initialPage,
                    endingPage, canonicalTargetTransform, restorationStarted);
                operation.guard();
                if (!restorationComplete || selectedPage(section) !== initialPage) {
                    incomplete('restore-initial-page', 'native-restoration-incomplete', {
                        from: endingPage,
                        target: initialPage,
                        selectedPage: selectedPage(section)
                    });
                }
            }

            report.complete(items, endingPage, initialPage, { completionReason, cycleDetected: runtime.cycleDetected,
                domGeneration: runtime.profile.generation });
            return items;
        } finally {
            motionLease.release();
        }
    }


    return collectAllItemsLogical;
}
