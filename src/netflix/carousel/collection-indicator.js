// Complete indicator traversal; material and scheduled resources remain with collection.
export function createIndicatorCollection({ native, navigation, scope, performance,
    captureItem, videoIdFromHref, cardSelector, initializationError, log, warn, tLog, logOperationTimeout }) {
    const PAGE_STABLE_TIMEOUT_MS = 2000;
    const { currentSlots: currentPageSlots, signatureOf: visibleSignature, selectedPage, pageCount } = native;
    const { move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage, transform: trackTransformValue } = navigation;
    const itemFromSlot = captureItem;
    const itemKey = item => item.videoId ? 'v:' + item.videoId : 'h:' + item.href;
    async function collectAllItems(operation) {
        const { section, scroller, track, totalCount, sessionToken } = operation;
        operation.guard();
        const snapshotWork = operation.snapshotWork;
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
        const report = operation.report(goal, started);
        const initialPage = selectedPage(section);
        operation.acceptInitialPage(initialPage);
        operation.publish({ initialPage });

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
            operation.guard();
            const signatureBeforeStartMove = visibleSignature(currentPageSlots(scroller, track));
            await goToPage(section, scroller, 0, null, sessionToken);
            operation.guard();
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
                operation.guard();
                const stabilizedSignature = visibleSignature(slots);
                const stabilizedTransform = trackTransformValue(track);
                stablePageTransforms.set(actualPage, stabilizedTransform);
                const pageFacts = report.pageFacts(page, actualPage, slots, minimumSlots, minimumNewItems, seen);

                log(tLog('collectionPageStabilized'), {
                    ...pageFacts,
                    signature: stabilizedSignature,
                    transform: stabilizedTransform,
                    stabilizeElapsedMs: Math.round(performance.now() - stabilizeStarted)
                });

                if (slots.length < minimumSlots || pageFacts.newItemsReady < minimumNewItems) {
                    warn(tLog('collectionStoppedBecauseThePageNeverReachedTheExpectedStableState'), {
                        ...pageFacts,
                        timeoutMs: PAGE_STABLE_TIMEOUT_MS
                    });
                    break;
                }

                for (const slot of slots) {
                    if (Number.isFinite(goal) && items.length >= goal) break;
                    operation.bump('metadataReads');
                    const item = itemFromSlot(slot, actualPage, false);
                    if (!item) { operation.bump('invalidMetadata'); continue; }
                    const key = itemKey(item);
                    if (seen.has(key)) { operation.bump('duplicateSnapshotsAvoided'); continue; }
                    operation.capture(item, slot);
                    operation.bump('snapshotsCaptured');
                    seen.add(key);
                    items.push(item);
                }

                const added = items.slice(beforeCount);
                report.pageResult(actualPage, added, items.length);

                if ((Number.isFinite(goal) && items.length >= goal) || actualPage >= pages - 1) break;
                previousPageSignature = stabilizedSignature;
                const next = await moveOnePage(section, scroller, 1, null, sessionToken);
                operation.guard();
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
                const restorationComplete = await report.restore(items, expectedPageSlots, initialPage,
                    endingPage, canonicalTargetTransform, restorationStarted);
                operation.guard();

                // Keep suppression through two more paints after the expected original
                // page is mounted so deferred Netflix writes cannot animate on release.
                if (restorationComplete && selectedPage(section) === initialPage) {
                    await operation.nextFrame();
                    operation.guard();
                    await operation.nextFrame();
                    operation.guard();
                }
            }
        } finally {
            motionLease.release();
        }

        report.complete(items, endingPage, initialPage);
        return items;
    }


    return collectAllItems;
}
