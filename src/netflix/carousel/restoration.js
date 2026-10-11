// Private restoration policy; movement, waits and motion leases remain navigation-owned.
export function createRestoration({ native, navigation, captureCurrent, performance, isCancelled,
    stableTimeoutMs, log, warn, tLog }) {
    const { selectedPage, pageCount, currentSlots: currentPageSlots, signatureOf: visibleSignature,
        navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled } = native;
    const { move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage,
        pageKeys: pageItemKeys, mountedKeys: mountedItemKeys, transform: trackTransformValue } = navigation;
    const PAGE_STABLE_TIMEOUT_MS = stableTimeoutMs, FAST_RESTORE_VERIFY_TIMEOUT_MS = 260;
    const isRouteSessionCancelledError = isCancelled;

    function createOperation(section, scroller, track, items, expectedPageSlots, sessionToken) {
        const assertCurrent = captureCurrent(section, scroller, track, sessionToken);

        function immediateRestoredPageState(targetPage) {
            const requiredPageKeys = pageItemKeys(items, targetPage);
            const slots = currentPageSlots(scroller, track);
            const mountedKeys = mountedItemKeys(slots);
            const missingKeys = [...requiredPageKeys].filter(key => !mountedKeys.has(key));
            return {
                expectedKeys: requiredPageKeys.size,
                mountedKeys: requiredPageKeys.size - missingKeys.length,
                slots: slots.length,
                missingKeys
            };
        }

        async function verifyRestoredPage(targetPage, previousSignature = '', timeout = PAGE_STABLE_TIMEOUT_MS) {
            assertCurrent();
            const requiredPageKeys = pageItemKeys(items, targetPage);
            const started = performance.now();
            const restoredSlots = await waitStableCurrentPage(scroller, track, {
                previousSignature,
                minimumSlots: Math.min(expectedPageSlots, Math.max(1, requiredPageKeys.size)),
                requiredKeys: requiredPageKeys,
                requiredStableFrames: 2,
                timeout,
                sessionToken
            });
            assertCurrent();
            const restoredKeys = mountedItemKeys(restoredSlots);
            const missingKeys = [...requiredPageKeys].filter(key => !restoredKeys.has(key));

            return {
                ok: selectedPage(section) === targetPage && missingKeys.length === 0,
                selectedPage: selectedPage(section),
                expectedKeys: requiredPageKeys.size,
                mountedKeys: requiredPageKeys.size - missingKeys.length,
                slots: restoredSlots.length,
                missingKeys,
                elapsedMs: Math.round(performance.now() - started)
            };
        }

        async function restoreNativePageByPage(targetPage) {
            assertCurrent();
            const started = performance.now();
            let currentRestorePage = selectedPage(section);
            let restorationComplete = true;

            // If the target indicator is already selected but its virtual cards did not
            // mount correctly, force one adjacent round-trip before using the strict
            // v4.9 page-by-page verification path.
            if (currentRestorePage === targetPage) {
                const directCheck = await verifyRestoredPage(targetPage, '', PAGE_STABLE_TIMEOUT_MS);
                assertCurrent();
                if (directCheck.ok) return { complete: true, elapsedMs: directCheck.elapsedMs };

                const total = pageCount(section);
                const repairDirection = targetPage < total - 1 ? 1 : (targetPage > 0 ? -1 : 0);
                if (repairDirection !== 0) {
                    const moved = await moveOnePage(section, scroller, repairDirection, null, sessionToken);
                    assertCurrent();
                    if (moved !== targetPage + repairDirection) {
                        return { complete: false, elapsedMs: Math.round(performance.now() - started) };
                    }
                    currentRestorePage = moved;
                } else {
                    return { complete: false, elapsedMs: Math.round(performance.now() - started) };
                }
            }

            const direction = targetPage < currentRestorePage ? -1 : 1;

            log(tLog('nativePageByPageRestorationStarted'), {
                from: currentRestorePage,
                target: targetPage,
                direction: direction < 0 ? 'left' : 'right'
            });

            while (currentRestorePage !== targetPage) {
                assertCurrent();
                const nextPage = currentRestorePage + direction;
                const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
                const stepStarted = performance.now();
                const movedPage = await moveOnePage(section, scroller, direction, null, sessionToken);
                assertCurrent();

                if (movedPage !== nextPage) {
                    restorationComplete = false;
                    warn(tLog('nativePageRestorationMoveFailed'), {
                        from: currentRestorePage,
                        target: nextPage,
                        result: movedPage
                    });
                    break;
                }

                const verification = await verifyRestoredPage(nextPage, beforeSignature, PAGE_STABLE_TIMEOUT_MS);
                assertCurrent();

                log(tLog('nativeRestorationPageStabilized'), {
                    requestedPage: nextPage,
                    selectedPage: verification.selectedPage,
                    expectedKeys: verification.expectedKeys,
                    mountedKeys: verification.mountedKeys,
                    slots: verification.slots,
                    missingKeys: verification.missingKeys,
                    elapsedMs: Math.round(performance.now() - stepStarted)
                });

                if (!verification.ok) {
                    restorationComplete = false;
                    warn(tLog('nativeRestorationStoppedBecauseTheTargetPageDidNotFullyMount'), {
                        requestedPage: nextPage,
                        selectedPage: verification.selectedPage,
                        missingKeys: verification.missingKeys,
                        timeoutMs: PAGE_STABLE_TIMEOUT_MS
                    });
                    break;
                }

                currentRestorePage = nextPage;
            }

            const complete = restorationComplete && selectedPage(section) === targetPage;
            log(tLog('nativePageByPageRestorationCompleted'), {
                target: targetPage,
                selectedPage: selectedPage(section),
                complete,
                elapsedMs: Math.round(performance.now() - started)
            });
            return { complete, elapsedMs: Math.round(performance.now() - started) };
        }

        async function repairFastRestoredPage(targetPage, canonicalTargetTransform = '', reason = 'verification-failed') {
            assertCurrent();
            const started = performance.now();
            const result = (complete, verification = null) => ({ complete, verification,
                elapsedMs: Math.round(performance.now() - started) });
            const total = pageCount(section);
            const repairDirection = targetPage < total - 1 ? 1 : (targetPage > 0 ? -1 : 0);
            if (repairDirection === 0) return result(false);
            const adjacentPage = targetPage + repairDirection;
            const beforeTransform = trackTransformValue(track);
            const beforeState = immediateRestoredPageState(targetPage);
            log(tLog('nativeFastRestorationPhaseRepairStarted'), {
                reason, target: targetPage, adjacentPage,
                direction: repairDirection < 0 ? 'left' : 'right', selectedPage: selectedPage(section),
                canonicalTargetTransform, beforeTransform,
                transformMatchesCanonical: Boolean(canonicalTargetTransform) && beforeTransform === canonicalTargetTransform,
                expectedKeys: beforeState.expectedKeys, mountedKeys: beforeState.mountedKeys, missingKeys: beforeState.missingKeys
            });

            let adjacentVerification;
            for (const [from, destination, direction] of [
                [targetPage, adjacentPage, repairDirection], [adjacentPage, targetPage, -repairDirection]
            ]) {
                const signature = visibleSignature(currentPageSlots(scroller, track));
                const moved = await moveOnePage(section, scroller, direction, null, sessionToken);
                assertCurrent();
                if (moved !== destination) {
                    warn(tLog('nativeFastRestorationPhaseRepairMoveFailed'), {
                        reason, from, target: destination, result: moved, transform: trackTransformValue(track)
                    });
                    return result(false);
                }
                const verification = await verifyRestoredPage(destination, signature, FAST_RESTORE_VERIFY_TIMEOUT_MS);
                assertCurrent();
                const transform = trackTransformValue(track);
                if (destination === adjacentPage) {
                    adjacentVerification = verification;
                    log(tLog('nativeFastRestorationPhaseRepairAdjacentPageVerified'), {
                        reason, requestedPage: adjacentPage, selectedPage: verification.selectedPage,
                        complete: verification.ok, expectedKeys: verification.expectedKeys,
                        mountedKeys: verification.mountedKeys, missingKeys: verification.missingKeys,
                        transform, verificationElapsedMs: verification.elapsedMs
                    });
                    if (!verification.ok) {
                        warn(tLog('nativeFastRestorationPhaseRepairAdjacentPageDidNotStabilize'), {
                            requestedPage: adjacentPage, selectedPage: verification.selectedPage,
                            expectedKeys: verification.expectedKeys, mountedKeys: verification.mountedKeys,
                            missingKeys: verification.missingKeys
                        });
                        return result(false, verification);
                    }
                } else {
                    log(tLog('nativeFastRestorationPhaseRepairCompleted'), {
                        reason, target: targetPage, selectedPage: verification.selectedPage, complete: verification.ok,
                        expectedKeys: verification.expectedKeys, mountedKeys: verification.mountedKeys,
                        missingKeys: verification.missingKeys, canonicalTargetTransform, finalTransform: transform,
                        transformMatchesCanonical: Boolean(canonicalTargetTransform) && transform === canonicalTargetTransform,
                        adjacentVerificationElapsedMs: adjacentVerification.elapsedMs,
                        targetVerificationElapsedMs: verification.elapsedMs,
                        elapsedMs: Math.round(performance.now() - started)
                    });
                    return result(verification.ok, verification);
                }
            }
        }

        async function restoreNativePageFast(targetPage, canonicalTargetTransform = '') {
            assertCurrent();
            const started = performance.now();
            const originalFromPage = selectedPage(section);
            const pages = pageCount(section);
            const adjacentDirection = targetPage < originalFromPage ? -1 : 1;
            const adjacentMoveCount = Math.abs(originalFromPage - targetPage);
            let direction = adjacentDirection;
            let moveCount = adjacentMoveCount;
            let restorationStrategy = 'adjacent';
            let currentPage = originalFromPage;
            let previousSignature = '';
            let fastComplete = true;
            let verification = null;
            let completionPath = 'strict-verify';
            let phaseMismatchDetected = false;
            let initialVerificationWaitSkipped = false;
            let cycleShortcutAttempted = false;
            let cycleShortcutSucceeded = false;

            // Netflix's logical My List carousel wraps from its final page back to page 0
            // with one native right move. Prefer that O(1) restoration after a complete
            // forward scan, but keep the 1.6.6 adjacent-page restoration as fallback.
            const cycleShortcutEligible =
                pages > 1 &&
                targetPage === 0 &&
                originalFromPage === pages - 1;

            log(tLog('nativeFastRestorationStarted'), {
                from: originalFromPage,
                target: targetPage,
                direction: cycleShortcutEligible ? 'right' : (direction < 0 ? 'left' : 'right'),
                strategy: cycleShortcutEligible ? 'cycle-right-once-preferred' : 'adjacent',
                cycleShortcutEligible,
                pages,
                pageCountParity: pages % 2 === 0 ? 'even' : 'odd',
                moveCount: cycleShortcutEligible ? 1 : moveCount,
                moveCountParity: (cycleShortcutEligible ? 1 : moveCount) % 2 === 0 ? 'even' : 'odd',
                canonicalTargetTransform
            });

            if (cycleShortcutEligible) {
                const rightControl = carouselMoveButton(section, scroller, 1);
                if (rightControl.button && !carouselMoveButtonDisabled(rightControl.button)) {
                    cycleShortcutAttempted = true;
                    previousSignature = visibleSignature(currentPageSlots(scroller, track));
                    try {
                        const movedPage = await moveOnePage(section, scroller, 1, null, sessionToken);
                        assertCurrent();
                        if (movedPage === targetPage && selectedPage(section) === targetPage) {
                            cycleShortcutSucceeded = true;
                            restorationStrategy = 'cycle-right-once';
                            direction = 1;
                            moveCount = 1;
                            currentPage = targetPage;
                        } else {
                            warn(tLog('nativeFastRestorationMoveFailed'), {
                                strategy: 'cycle-right-once',
                                from: originalFromPage,
                                target: targetPage,
                                result: movedPage,
                                selectedPage: selectedPage(section)
                            });
                        }
                    } catch (error) {
                        if (isRouteSessionCancelledError(error)) throw error;
                        assertCurrent();
                        warn(tLog('nativeFastRestorationMoveFailed'), {
                            strategy: 'cycle-right-once',
                            from: originalFromPage,
                            target: targetPage,
                            selectedPage: selectedPage(section),
                            error
                        });
                    }

                    if (!cycleShortcutSucceeded && selectedPage(section) !== originalFromPage) {
                        try {
                            await goToPage(section, scroller, originalFromPage, null, sessionToken);
                            assertCurrent();
                        } catch (error) {
                            if (isRouteSessionCancelledError(error)) throw error;
                            assertCurrent();
                            warn(tLog('nativeFastRestorationMoveFailed'), {
                                strategy: 'cycle-restage-before-adjacent-fallback',
                                from: selectedPage(section),
                                target: originalFromPage,
                                error
                            });
                        }
                    }
                    currentPage = selectedPage(section);
                    previousSignature = '';
                }
            }

            if (!cycleShortcutSucceeded) {
                direction = targetPage < currentPage ? -1 : 1;
                moveCount = Math.abs(currentPage - targetPage);
                restorationStrategy = cycleShortcutAttempted ? 'adjacent-after-cycle-fallback' : 'adjacent';
            }

            while (!cycleShortcutSucceeded && currentPage !== targetPage) {
                assertCurrent();
                const nextPage = currentPage + direction;
                previousSignature = visibleSignature(currentPageSlots(scroller, track));
                const movedPage = await moveOnePage(section, scroller, direction, null, sessionToken);
                assertCurrent();
                if (movedPage !== nextPage) {
                    fastComplete = false;
                    completionPath = 'move-failed';
                    warn(tLog('nativeFastRestorationMoveFailed'), {
                        strategy: restorationStrategy,
                        from: currentPage,
                        target: nextPage,
                        result: movedPage
                    });
                    break;
                }
                currentPage = nextPage;
            }

            if (fastComplete && selectedPage(section) === targetPage) {
                const diagnosisStarted = performance.now();
                const immediateState = immediateRestoredPageState(targetPage);
                const arrivalTransform = trackTransformValue(track);
                const hasCanonicalTransform = Boolean(canonicalTargetTransform);
                const transformMatchesCanonical = !hasCanonicalTransform || arrivalTransform === canonicalTargetTransform;
                phaseMismatchDetected = hasCanonicalTransform &&
                    !transformMatchesCanonical &&
                    immediateState.missingKeys.length > 0;

                log(tLog('nativeFastRestorationPhaseDiagnosis'), {
                    from: originalFromPage,
                    target: targetPage,
                    selectedPage: selectedPage(section),
                    pages: pageCount(section),
                    pageCountParity: pageCount(section) % 2 === 0 ? 'even' : 'odd',
                    moveCount,
                    moveCountParity: moveCount % 2 === 0 ? 'even' : 'odd',
                    canonicalTargetTransform,
                    arrivalTransform,
                    transformMatchesCanonical,
                    expectedKeys: immediateState.expectedKeys,
                    mountedKeys: immediateState.mountedKeys,
                    missingKeys: immediateState.missingKeys,
                    phaseMismatchDetected,
                    diagnosisElapsedMs: Math.round(performance.now() - diagnosisStarted)
                });

                if (phaseMismatchDetected) {
                    initialVerificationWaitSkipped = true;
                    completionPath = 'phase-repair-before-timeout';
                    const repair = await repairFastRestoredPage(targetPage, canonicalTargetTransform, 'transform-mismatch-with-missing-target-keys');
                    assertCurrent();
                    verification = repair.verification;
                    fastComplete = repair.complete;
                } else {
                    verification = await verifyRestoredPage(targetPage, previousSignature, FAST_RESTORE_VERIFY_TIMEOUT_MS);
                    assertCurrent();
                    fastComplete = verification.ok;

                    if (!fastComplete && selectedPage(section) === targetPage) {
                        completionPath = 'phase-repair-after-verification';
                        const repair = await repairFastRestoredPage(targetPage, canonicalTargetTransform, 'strict-verification-failed');
                        assertCurrent();
                        verification = repair.verification || verification;
                        fastComplete = repair.complete;
                    }
                }
            }

            const finalTransform = trackTransformValue(track);
            log(tLog('nativeFastRestorationCompleted'), {
                from: originalFromPage,
                target: targetPage,
                selectedPage: selectedPage(section),
                complete: fastComplete,
                strategy: restorationStrategy,
                cycleShortcutAttempted,
                cycleShortcutSucceeded,
                completionPath,
                phaseMismatchDetected,
                initialVerificationWaitSkipped,
                expectedKeys: verification?.expectedKeys ?? null,
                mountedKeys: verification?.mountedKeys ?? null,
                missingKeys: verification?.missingKeys ?? [],
                canonicalTargetTransform,
                finalTransform,
                transformMatchesCanonical: Boolean(canonicalTargetTransform) && finalTransform === canonicalTargetTransform,
                elapsedMs: Math.round(performance.now() - started)
            });

            if (fastComplete) return true;

            warn(tLog('fastRestorationVerificationFailedUsingV49PageByPageFallback'), {
                from: originalFromPage,
                target: targetPage,
                selectedPage: selectedPage(section),
                strategy: restorationStrategy,
                cycleShortcutAttempted,
                cycleShortcutSucceeded,
                completionPath,
                phaseMismatchDetected,
                canonicalTargetTransform,
                finalTransform
            });

            // Re-stage the scan ending page when possible, then run the strict v4.9
            // restoration path that validates every intermediate page. If re-staging
            // cannot reach the original ending page, the strict fallback starts from
            // whichever page is currently selected.
            if (selectedPage(section) !== originalFromPage) {
                await goToPage(section, scroller, originalFromPage, null, sessionToken);
                assertCurrent();
            }
            const fallback = await restoreNativePageByPage(targetPage);
            assertCurrent();
            return fallback.complete;
        }

        return { strict: restoreNativePageByPage, fast: restoreNativePageFast };
    }

    async function restoreNativePageByPage(section, scroller, track, items, expectedPageSlots, targetPage, sessionToken = null) {
        return createOperation(section, scroller, track, items, expectedPageSlots, sessionToken).strict(targetPage);
    }

    async function restoreNativePageFast(section, scroller, track, items, expectedPageSlots, targetPage, canonicalTargetTransform = '', sessionToken = null) {
        return createOperation(section, scroller, track, items, expectedPageSlots, sessionToken).fast(targetPage, canonicalTargetTransform);
    }

    return Object.freeze({ strict: restoreNativePageByPage, fast: restoreNativePageFast });
}
