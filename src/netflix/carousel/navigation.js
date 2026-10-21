import { createNavigationWaits } from './navigation-waits.js';
import { createMotion } from './motion.js';
import { createRestoration } from './restoration.js';

// Private native movement, acknowledgement, hydration and motion-lease owner.
export function createNavigation({ borrowBinding, assertBinding, bindingForSource, createError, fastMoveClass,
    native = {}, scope, performance, getComputedStyle, setTimeout, clearTimeout, requestAnimationFrame,
    cancelAnimationFrame, MutationObserver, cardSelector, videoIdFromHref,
    isHoverCancelled = () => false, readHoverToken = () => null,
    diagnosticsFor = () => ({ bump() {}, record: null }), log = () => {}, warn = () => {},
    tLog = value => value, logTimeout = () => {} }) {
    // Hawkins controls can apply a virtual-page transform after several paint
    // cycles when the source row is under load. Keep the observation window
    // longer than that deferred update so a legitimate move is not retried
    // while the first click is still settling.
    const PAGE_CHANGE_TIMEOUT_MS = 3000;
    const PAGE_STABLE_TIMEOUT_MS = 2000, SCRIPT_MOVE_SETTLE_TIMEOUT_MS = 260;
    const FAST_MOVE_CLASS = fastMoveClass;
    const { model: getCarouselDomRuntime, profile: detectCarouselDomProfile,
        selectedPage, pageCount,
        navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
        currentSlots: currentPageSlots, signatureOf: visibleSignature } = native;
    const assertRouteSession = token => scope.assertCurrent(token);
    const isRouteSessionCancelledError = error => scope.isCancelled?.(error) || error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED';
    const NETFLIX_DOM_SELECTORS = { standardCard: cardSelector };
    const logOperationTimeout = logTimeout;
    const initializationTimeoutError = (stage, timeoutMs, details) => createError('INITIALIZATION_TIMEOUT', stage,
        'Timeout at ' + stage + ' after ' + timeoutMs + ' ms', { timeoutMs, ...details });
    const itemKey = item => item.videoId ? 'v:' + item.videoId : 'h:' + item.href;
    const itemKeyFromCard = card => {
        const href = card?.href || card?.getAttribute?.('href') || '';
        if (!href) return '';
        const id = videoIdFromHref(href);
        return id ? 'v:' + id : 'h:' + href;
    };
    let epoch = 0;
    let sequence = 0;
    let tail = Promise.resolve();
    const moves = new Set();


    const motion = createMotion({ borrowBinding, assertBinding, fastMoveClass });
    const { suppress, restoreMotion } = motion;
    const waitResources = createNavigationWaits({ borrowBinding, assertBinding, bindingForSource, bindingGuard,
        diagnosticSink, native, scope, performance, getComputedStyle, setTimeout, clearTimeout,
        requestAnimationFrame, cancelAnimationFrame, MutationObserver, isHoverCancelled,
        initializationTimeoutError, logOperationTimeout, mountedItemKeys });
    const { scheduledWait, sleep, waitLogicalPageChange, waitPage, waitForScriptMoveSettle, waitStableCurrentPage } = waitResources;
    function bindingGuard(binding, sessionToken, assertOperation = () => {}) {
        return () => {
            assertRouteSession(sessionToken);
            assertBinding(binding);
            assertOperation();
        };
    }
    function diagnosticSink(token) {
        let sink;
        try { sink = diagnosticsFor(token); } catch (_) {}
        return {
            bump(field) { try { sink?.bump(field); } catch (_) {} },
            record: typeof sink?.record === 'function' ? (phase, started) => {
                try { return sink.record(phase, started); } catch (_) {}
            } : null
        };
    }
    function begin(section, scroller) {
        const binding = borrowBinding(section, scroller);
        assertBinding(binding);
        const ownerEpoch = epoch;
        const previous = tail;
        let resolve;
        tail = new Promise(done => { resolve = done; });
        let released = false;
        let startedSequence = null;
        const assertCurrent = () => {
            scope.assertCurrent(binding.sessionToken);
            if (ownerEpoch !== epoch || released) {
                throw createError('NATIVE_SOURCE_REPLACED', 'native-navigation', 'Native navigation owner changed');
            }
            assertBinding(binding);
        };
        const release = () => {
            if (released) return;
            released = true;
            moves.delete(ticket);
            resolve();
        };
        const ticket = Object.freeze({ ready: previous.catch(() => {}).then(assertCurrent), assertCurrent,
            start() { assertCurrent(); return startedSequence ??= ++sequence; }, release });
        moves.add(ticket);
        return ticket;
    }
    function reset() {
        epoch++;
        waitResources.reset();
        restoreMotion();
        for (const move of [...moves]) move.release();
        tail = Promise.resolve();
    }
    async function moveOnePage(section, scroller, direction, token = null, sessionToken = null, assertOperation = () => {}) {
        assertOperation();
        const hoverTiming = diagnosticSink(token).record;
        const queueStarted = hoverTiming ? performance.now() : 0;
        let moveStarted = null;
        const moveOwner = begin(section, scroller);

        try {
            await moveOwner.ready;
            assertOperation();
            if (hoverTiming) hoverTiming('queue', queueStarted);
            assertRouteSession(sessionToken);

            if (token !== null && token !== readHoverToken()) {
                log(tLog('carouselMoveCancelledBeforeStart'), {
                    token,
                    hoverToken: readHoverToken(),
                    direction: direction < 0 ? 'left' : 'right',
                    selectedPage: selectedPage(section)
                });
                return selectedPage(section);
            }

            const seq = moveOwner.start();
            const before = selectedPage(section);
            const runtime = getCarouselDomRuntime(section);
            const profile = runtime?.profile || detectCarouselDomProfile(section);
            const { button, selector } = carouselMoveButton(section, scroller, direction);
            const track = native.track(scroller);
            if (!button || !track) {
                warn(tLog('carouselMoveControlNotFound'), {
                    seq,
                    direction,
                    before,
                    selector,
                    buttonFound: Boolean(button),
                    trackFound: Boolean(track)
                });
                return before;
            }

            if (profile.pageMode === 'logical' && carouselMoveButtonDisabled(button)) {
                return before;
            }

            const started = performance.now();
            moveStarted = started;
            const beforeTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
            const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
            const sharedFastMode = section.classList.contains(FAST_MOVE_CLASS);
            const nativeTransition = sharedFastMode ? 'suppressed-by-scan' : track.style.getPropertyValue('transition');
            let motionLease = null;
            let after = before;
            let afterTransform = beforeTransform;
            let afterSignature = beforeSignature;
            let settleObservedChange = false;
            let acknowledgementMs = null;
            let settlementMs = null;

            log(tLog('carouselMoveStarted'), {
                seq,
                direction: direction < 0 ? 'left' : 'right',
                before,
                pages: pageCount(section),
                animationDisabled: true,
                sharedFastMode,
                beforeTransform,
                nativeTransition,
                token
            });

            try {
                if (!sharedFastMode) motionLease = suppress(section, track);

                assertRouteSession(sessionToken);
                moveOwner.assertCurrent();
                assertOperation();
                button.click();
                moveOwner.assertCurrent();
                assertOperation();
                const acknowledgementStarted = hoverTiming ? performance.now() : 0;
                try {
                    if (profile.pageMode === 'logical') {
                        const logicalMove = await waitLogicalPageChange(
                            section,
                            scroller,
                            track,
                            before,
                            direction,
                            beforeTransform,
                            beforeSignature,
                            PAGE_CHANGE_TIMEOUT_MS,
                            sessionToken,
                            token
                        );
                        after = logicalMove.page;
                        afterTransform = logicalMove.transform;
                        afterSignature = logicalMove.signature;
                        settleObservedChange = logicalMove.changed;
                    } else {
                        after = await waitPage(section, before, PAGE_CHANGE_TIMEOUT_MS, sessionToken, token);
                    }
                } finally { if (hoverTiming) acknowledgementMs = hoverTiming('acknowledgement', acknowledgementStarted) ?? null; }
                assertRouteSession(sessionToken);
                moveOwner.assertCurrent();
                assertOperation();
                const settlementStarted = hoverTiming ? performance.now() : 0;
                try {
                    if (sharedFastMode) {
                        // Logical moves already wait until Netflix exposes the new logical page.
                        // The caller immediately runs waitStableCurrentPage(), so another frame
                        // here duplicates that stabilization. Keep the frame for indicator mode,
                        // whose waitPage() only observes the selected indicator.
                        if (profile.pageMode !== 'logical') {
                            await scheduledWait(requestAnimationFrame, cancelAnimationFrame);
                            assertRouteSession(sessionToken);
                        }
                        moveOwner.assertCurrent();
                        assertOperation();
                        afterTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
                        afterSignature = visibleSignature(currentPageSlots(scroller, track));
                        settleObservedChange = settleObservedChange || after !== before;
                    } else {
                        const settled = await waitForScriptMoveSettle(scroller, track, beforeTransform, beforeSignature, SCRIPT_MOVE_SETTLE_TIMEOUT_MS, sessionToken);
                        moveOwner.assertCurrent();
                        assertOperation();
                        afterTransform = settled.transform;
                        afterSignature = settled.signature;
                        settleObservedChange = settled.observedChange;
                    }
                } finally { if (hoverTiming) settlementMs = hoverTiming('settlement', settlementStarted) ?? null; }
            } finally {
                motionLease?.release();
            }

            moveOwner.assertCurrent();
            assertOperation();
            log(tLog('carouselMoveCompleted'), {
                seq,
                direction: direction < 0 ? 'left' : 'right',
                before,
                after,
                changed: after !== before,
                transformChanged: afterTransform !== beforeTransform,
                contentChanged: Boolean(beforeSignature) && Boolean(afterSignature) && afterSignature !== beforeSignature,
                settleObservedChange,
                sharedFastMode,
                beforeTransform,
                afterTransform,
                elapsedMs: Math.round(performance.now() - started),
                ...(hoverTiming ? { acknowledgementMs, settlementMs } : {}),
                animationRestored: sharedFastMode ? false : Boolean(motionLease?.restored()),
                token
            });
            return after;
        } finally {
            if (hoverTiming && moveStarted !== null) hoverTiming('move', moveStarted);
            moveOwner.release();
        }
    }

    async function goToPage(section, scroller, target, token = null, sessionToken = null, preferCyclicShortest = false, assertOperation = () => {}) {
        const bindingOwner = borrowBinding(section, scroller);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken, assertOperation);
        assertCurrent();
        const diagnostic = diagnosticSink(token);
        const total = pageCount(section);
        target = Math.max(0, Math.min(total - 1, target));
        const startPage = selectedPage(section);
        const profile = getCarouselDomRuntime(section)?.profile;
        const cyclicShortestUsed = preferCyclicShortest &&
            !(profile?.navigationMode === 'hawkins' && profile.pageMode === 'logical');
        if (preferCyclicShortest && !cyclicShortestUsed && startPage !== target) {
            const rightDistance = (target - startPage + total) % total;
            const leftDistance = (startPage - target + total) % total;
            if ((rightDistance <= leftDistance ? 1 : -1) !== (startPage < target ? 1 : -1)) {
                diagnostic.bump('boundaryDetoursAvoided');
            }
        }

        if (startPage !== target) {
            log(tLog('pageMoveRequested'), { from: startPage, target, total, token, preferCyclicShortest, cyclicShortestUsed });
        }

        let guard = total + 5;
        let cancelled = false;
        let forcedDirection = null;
        let pageChangeRetryCount = 0;
        while (true) {
            assertCurrent();
            const current = selectedPage(section);
            if (current === target || guard-- <= 0) break;
            assertCurrent();
            if (token !== null && token !== readHoverToken()) {
                cancelled = true;
                break;
            }
            if (token !== null) diagnostic.bump('duplicatePageReadsAvoided');
            let direction = forcedDirection ?? (current < target ? 1 : -1);
            if (forcedDirection === null && cyclicShortestUsed && total > 1) {
                const rightDistance = (target - current + total) % total;
                const leftDistance = (current - target + total) % total;
                if (rightDistance !== 0 || leftDistance !== 0) {
                    direction = rightDistance <= leftDistance ? 1 : -1;
                }
            }
            let next;
            try {
                next = await moveOnePage(section, scroller, direction, token, sessionToken, assertOperation);
                pageChangeRetryCount = 0;
            } catch (error) {
                if (isRouteSessionCancelledError(error)) throw error;
                if (error?.code === 'INITIALIZATION_TIMEOUT' && pageChangeRetryCount < 1) {
                    pageChangeRetryCount++;
                    log('Retrying logical page move after transient timeout', {
                        current,
                        target,
                        direction: direction < 0 ? 'left' : 'right',
                        token
                    });
                    await sleep(120);
                    assertCurrent();
                    continue;
                }
                throw error;
            }
            assertCurrent();
            if (token !== null && token !== readHoverToken()) {
                cancelled = true;
                break;
            }
            if (next === current && cyclicShortestUsed && total > 1) {
                // Preserve a direct fallback for other/unknown carousel profiles
                // whose requested cyclic step turns out to stop at an edge.
                const directDirection = current < target ? 1 : -1;
                if (directDirection !== direction) {
                    log('Logical page boundary fallback', {
                        current,
                        target,
                        attemptedDirection: direction < 0 ? 'left' : 'right',
                        fallbackDirection: directDirection < 0 ? 'left' : 'right',
                        token
                    });
                    const retried = await moveOnePage(section, scroller, directDirection, token, sessionToken, assertOperation);
                    assertCurrent();
                    if (token !== null && token !== readHoverToken()) {
                        cancelled = true;
                        break;
                    }
                    if (retried !== current) {
                        // Keep using the direct direction after the boundary
                        // fallback; recomputing the cyclic shortest direction
                        // would oscillate between the two edge pages.
                        forcedDirection = directDirection;
                        continue;
                    }
                }
                break;
            }
            if (next === current) break;
        }

        assertCurrent();
        const result = selectedPage(section);
        if (startPage !== target || result !== target || cancelled) {
            log(tLog('pageMoveResult'), {
                from: startPage,
                target,
                result,
                reached: result === target,
                cancelled,
                token,
                hoverToken: readHoverToken(),
                preferCyclicShortest,
                cyclicShortestUsed,
                guardRemaining: guard
            });
        }
        return result;
    }

    function pageItemKeys(items, page) {
        return new Set(
            items
                .filter(item => item.page === page)
                .map(itemKey)
                .filter(Boolean)
        );
    }

    function mountedItemKeys(slots) {
        const keys = new Set();
        for (const slot of slots) {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const key = itemKeyFromCard(card);
            if (key) keys.add(key);
        }
        return keys;
    }

    function trackTransformValue(track) {
        if (!track) return '';
        return track.style.getPropertyValue('transform') || getComputedStyle(track).transform || '';
    }

    const restoration = createRestoration({ native, performance, log, warn, tLog,
        stableTimeoutMs: PAGE_STABLE_TIMEOUT_MS, isCancelled: isRouteSessionCancelledError,
        captureCurrent: (section, scroller, track, sessionToken) =>
            bindingGuard(borrowBinding(section, scroller, track), sessionToken),
        navigation: { move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage,
            pageKeys: pageItemKeys, mountedKeys: mountedItemKeys, transform: trackTransformValue } });

    return Object.freeze({ suppress, restoreMotion, reset, whenIdle: () => tail,
        move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage,
        restoreStrict: restoration.strict, restoreFast: restoration.fast,
        transform: trackTransformValue,
        diagnostics: () => ({ pendingMoves: moves.size,
            pendingWaits: waitResources.pending(), motionLeases: motion.pending() }) });
}
