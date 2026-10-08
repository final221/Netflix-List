// Private native movement, acknowledgement, hydration and restoration owner.
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
    const PAGE_CHANGE_TIMEOUT_MS = 3000, PAGE_CHANGE_OBSERVER_PRIMARY_MS = 320;
    const PAGE_STABLE_TIMEOUT_MS = 2000, SCRIPT_MOVE_SETTLE_TIMEOUT_MS = 260;
    const FAST_RESTORE_VERIFY_TIMEOUT_MS = 260, CANCELLED_MOVE_POLL_MS = 80;
    const FAST_MOVE_CLASS = fastMoveClass;
    const { model: getCarouselDomRuntime, profile: detectCarouselDomProfile,
        registerPage: registerLogicalPageSignature, selectedPage, pageCount,
        navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
        currentSlots: currentPageSlots, signatureOf: visibleSignature } = native;
    const assertRouteSession = token => scope.assertCurrent(token);
    const isRouteSessionActive = token => scope.isCurrent(token);
    const isRouteSessionCancelledError = error => scope.isCancelled?.(error) || error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED';
    const hoverPreparationCancelled = isHoverCancelled;
    const NETFLIX_DOM_SELECTORS = { standardCard: cardSelector };
    const logOperationTimeout = logTimeout;
    const initializationTimeoutError = (stage, timeoutMs, details) => createError('INITIALIZATION_TIMEOUT', stage,
        'Timeout at ' + stage + ' after ' + timeoutMs + ' ms', { timeoutMs, ...details });
    const sleep = ms => scheduledWait(close => setTimeout(close, ms), clearTimeout);
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
    const motionOwners = new Map();
    const waits = new Set();

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
    function scheduledWait(schedule, cancel) {
        return new Promise((resolve, reject) => {
            let handle = null, closed = false;
            const close = () => {
                if (closed) return;
                closed = true;
                waits.delete(close);
                try { if (handle !== null) cancel(handle); } catch (_) {}
                resolve();
            };
            waits.add(close);
            try { handle = schedule(close); }
            catch (error) { reject(error); close(); }
        });
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
    function capture(track, property) {
        return Object.freeze({ value: track.style.getPropertyValue(property),
            priority: track.style.getPropertyPriority(property) });
    }
    function restore(track, property, saved) {
        if (!saved.value) track.style.removeProperty(property);
        else track.style.setProperty(property, saved.value, saved.priority || '');
    }
    function restoreOwner(owner) {
        if (motionOwners.get(owner.track) !== owner) return;
        // Retire before restoring: failed writes cannot leave a live owner.
        motionOwners.delete(owner.track);
        owner.leases.clear();
        let failure;
        for (const operation of [
            () => { if (!owner.hadClass) owner.section.classList.remove(fastMoveClass); },
            () => restore(owner.track, 'transition', owner.transition),
            () => restore(owner.track, 'animation', owner.animation),
            () => { void owner.track.offsetWidth; }
        ]) {
            try { operation(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    }
    function suppress(section, track) {
        const binding = borrowBinding(section, null, track);
        assertBinding(binding);
        let owner = motionOwners.get(track);
        if (owner) assertBinding(owner.binding);
        else {
            owner = { section, track, binding, leases: new Set(),
                hadClass: section.classList.contains(fastMoveClass),
                transition: capture(track, 'transition'), animation: capture(track, 'animation') };
            motionOwners.set(track, owner);
            try {
                section.classList.add(fastMoveClass);
                track.style.setProperty('transition', 'none', 'important');
                track.style.setProperty('animation', 'none', 'important');
                void track.offsetWidth;
            } catch (error) {
                try { restoreOwner(owner); } catch (_) {}
                throw error;
            }
        }
        let released = false;
        const lease = Object.freeze({
            release() {
                if (released) return;
                released = true;
                if (motionOwners.get(track) !== owner) return;
                owner.leases.delete(lease);
                if (!owner.leases.size) restoreOwner(owner);
            },
            restored: () => track.style.getPropertyValue('transition') === owner.transition.value &&
                track.style.getPropertyPriority('transition') === owner.transition.priority &&
                section.classList.contains(fastMoveClass) === owner.hadClass
        });
        owner.leases.add(lease);
        return lease;
    }
    function restoreMotion() {
        for (const owner of [...motionOwners.values()]) {
            try { restoreOwner(owner); } catch (_) {}
        }
    }
    function reset() {
        epoch++;
        for (const close of [...waits]) close();
        restoreMotion();
        for (const move of [...moves]) move.release();
        tail = Promise.resolve();
    }
    function createLogicalMoveSignal(scroller, token, sessionToken, bindingOwner = bindingForSource(scroller, null)) {
        const diagnostic = diagnosticSink(token);
        const bump = diagnostic.bump;
        if (typeof MutationObserver !== 'function') {
            bump('logicalMoveObserverUnsupported');
            return null;
        }
        let observer = null, frame = null, timer = null, pending = null;
        let closed = false, dirty = true;
        const wake = available => {
            const oldTimer = timer, oldFrame = frame;
            timer = null;
            frame = null;
            dirty = false;
            const resolve = pending;
            pending = null;
            try { if (oldTimer !== null) clearTimeout(oldTimer); } catch (_) { bump('logicalMoveObserverFailures'); }
            try { if (oldFrame !== null) cancelAnimationFrame(oldFrame); } catch (_) { bump('logicalMoveObserverFailures'); }
            resolve?.(available);
        };
        const close = () => {
            if (closed) return;
            closed = true;
            waits.delete(close);
            try { observer?.disconnect(); } catch (_) { bump('logicalMoveObserverFailures'); }
            observer = null;
            wake(false);
        };
        waits.add(close);
        const queueFrame = () => {
            try { assertBinding(bindingOwner); } catch (_) { close(); return; }
            if (closed || !pending || frame !== null || hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken)) return;
            try {
                frame = requestAnimationFrame(() => {
                    frame = null;
                    if (closed) return;
                    bump('logicalMoveSignalFrames');
                    wake(true);
                });
            } catch (_) { bump('logicalMoveObserverFailures'); close(); }
        };
        try {
            observer = new MutationObserver(() => {
                if (closed) return;
                bump('logicalMoveNotifications');
                dirty = true;
                queueFrame();
            });
            observer.observe(scroller, { childList: true, subtree: true, attributes: true,
                attributeFilter: ['href', 'style', 'class', 'tabindex'] });
            bump('logicalMoveObserverStarts');
            return { close, wait: () => new Promise(resolve => {
                if (closed) { resolve(false); return; }
                pending = resolve;
                // One initial frame covers a synchronous click update. Later
                // mutations coalesce into one frame; a coarse fallback covers
                // computed visibility changes that produce no observed record.
                timer = setTimeout(() => {
                    if (closed) return;
                    bump('logicalMoveFallbackWakes');
                    wake(true);
                }, CANCELLED_MOVE_POLL_MS);
                if (dirty) queueFrame();
            }) };
        } catch (_) { bump('logicalMoveObserverFailures'); close(); return null; }
    }

    async function waitLogicalPageChange(section, scroller, track, beforePage, direction, beforeTransform, beforeSignature, timeout = PAGE_CHANGE_TIMEOUT_MS, sessionToken = null, token = null) {
        assertRouteSession(sessionToken);
        const bindingOwner = borrowBinding(section, scroller, track);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken);
        assertBinding(bindingOwner);
        const runtime = getCarouselDomRuntime(section);
        const started = performance.now();
        let lastTransform = beforeTransform;
        let lastSignature = beforeSignature;
        const diagnostic = diagnosticSink(token);
        let signal = token === null || hoverPreparationCancelled(token) ? null : createLogicalMoveSignal(scroller, token, sessionToken, bindingOwner);
        try {
            while (performance.now() - started < timeout) {
                // A click cannot be undone. Keep its acknowledgement serialized, but
                // stop spending every animation frame on an obsolete hover request.
                if (hoverPreparationCancelled(token)) {
                    signal?.close(); signal = null;
                    await sleep(CANCELLED_MOVE_POLL_MS);
                } else {
                    let signalled = false;
                    try { if (signal) signalled = await signal.wait(); }
                    catch (_) { diagnostic.bump('logicalMoveObserverFailures'); }
                    assertCurrent();
                    if (!signalled) {
                        signal?.close(); signal = null;
                        await scheduledWait(requestAnimationFrame, cancelAnimationFrame);
                    }
                }
                assertCurrent();
                if (token !== null) diagnostic.bump('logicalMoveReads');
                const transform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
                const signature = visibleSignature(currentPageSlots(scroller, track));
                const signatureChanged = Boolean(signature) && signature !== beforeSignature;
                lastTransform = transform;
                lastSignature = signature;
                if (!signatureChanged) continue;

                const existingPage = runtime?.signatureToPage.get(signature);
                const proposedPage = Math.max(0, beforePage + (direction < 0 ? -1 : 1));
                const mapped = Number.isFinite(existingPage)
                    ? existingPage
                    : registerLogicalPageSignature(section, signature, proposedPage);
                if (runtime) {
                    native.notePage(section, mapped, Number.isFinite(existingPage) && existingPage !== beforePage);
                }
                return {
                    page: mapped,
                    changed: true,
                    transform,
                    signature,
                    transformChanged: transform !== beforeTransform,
                    signatureChanged: true,
                    cycleDetected: Boolean(runtime?.cycleDetected)
                };
            }
            assertCurrent();
            if (hoverPreparationCancelled(token)) {
                return { page: beforePage, changed: false, transform: lastTransform, signature: lastSignature };
            }
            const details = {
                direction: direction < 0 ? 'left' : 'right',
                beforePage,
                beforeTransform,
                lastTransform,
                beforeSignature,
                lastSignature,
                domGeneration: runtime?.profile?.generation || null,
                navigationMode: runtime?.profile?.navigationMode || null,
                pageMode: runtime?.profile?.pageMode || null
            };
            logOperationTimeout('logical-page-change', timeout, details);
            throw initializationTimeoutError('logical-page-change', timeout, details);
        } finally { signal?.close(); }
    }

    async function waitPageByPolling(section, before, timeout, sessionToken = null, token = null) {
        const bindingOwner = borrowBinding(section);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken);
        assertCurrent();
        const start = performance.now();
        while (performance.now() - start < timeout) {
            await sleep(hoverPreparationCancelled(token) ? CANCELLED_MOVE_POLL_MS : 12);
            assertCurrent();
            const now = selectedPage(section);
            if (now !== before) return now;
        }
        assertCurrent();
        return selectedPage(section);
    }

    async function waitPage(section, before, timeout = PAGE_CHANGE_TIMEOUT_MS, sessionToken = null, token = null) {
        const bindingOwner = borrowBinding(section);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken);
        assertCurrent();
        const immediate = selectedPage(section);
        if (immediate !== before) return immediate;
        if (timeout <= 0) return immediate;

        // Page-indicator mutations are the primary signal. A short legacy polling
        // window remains as a fallback in case Netflix changes the indicator in a
        // way that does not trigger the expected mutation record.
        if (typeof MutationObserver !== 'function') {
            return waitPageByPolling(section, before, timeout, sessionToken, token);
        }

        const started = performance.now();
        const observerBudget = Math.min(timeout, PAGE_CHANGE_OBSERVER_PRIMARY_MS);
        const observedPage = await new Promise((resolve, reject) => {
            let observer = null;
            let timer = null;
            let finished = false;

            const finish = value => {
                if (finished) return;
                finished = true;
                waits.delete(close);
                try { if (timer !== null) clearTimeout(timer); } catch (_) {}
                try { observer?.disconnect(); } catch (_) {}
                resolve(value);
            };

            const close = () => finish(null);
            waits.add(close);
            const check = () => {
                if (finished) return;
                try { assertCurrent(); } catch (_) { close(); return; }
                const now = selectedPage(section);
                if (now !== before) finish(now);
            };

            try {
                observer = new MutationObserver(check);
                observer.observe(section, { subtree: true, childList: true, attributes: true,
                    attributeFilter: ['data-indicator-selected'] });
                check();
                if (!finished) timer = setTimeout(() => finish(null), observerBudget);
            } catch (error) { reject(error); close(); }
        });

        assertCurrent();
        if (observedPage !== null) return observedPage;

        const elapsed = performance.now() - started;
        const remaining = Math.max(0, timeout - elapsed);
        return waitPageByPolling(section, before, remaining, sessionToken, token);
    }

    async function waitForScriptMoveSettle(scroller, track, beforeTransform, beforeSignature, timeout = SCRIPT_MOVE_SETTLE_TIMEOUT_MS, sessionToken = null) {
        const bindingOwner = bindingForSource(scroller, track);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken);
        assertCurrent();
        const started = performance.now();
        let currentTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
        let currentSignature = visibleSignature(currentPageSlots(scroller, track));
        let observedChange = currentTransform !== beforeTransform ||
            (Boolean(beforeSignature) && Boolean(currentSignature) && currentSignature !== beforeSignature);
        let stableFrames = 0;
        let previousSignature = currentSignature;

        while (performance.now() - started < timeout) {
            await scheduledWait(requestAnimationFrame, cancelAnimationFrame);
            assertCurrent();
            currentTransform = track.style.getPropertyValue('transform') || getComputedStyle(track).transform;
            currentSignature = visibleSignature(currentPageSlots(scroller, track));

            if (currentTransform !== beforeTransform ||
                (Boolean(beforeSignature) && Boolean(currentSignature) && currentSignature !== beforeSignature)) {
                observedChange = true;
            }

            if (observedChange && currentSignature && currentSignature === previousSignature) {
                stableFrames++;
                if (stableFrames >= 2) break;
            } else {
                stableFrames = 0;
            }
            previousSignature = currentSignature;
        }

        // Keep suppression through one additional paint opportunity after the native
        // content settles so a deferred Netflix transform write cannot animate.
        await scheduledWait(requestAnimationFrame, cancelAnimationFrame);
        assertCurrent();
        return {
            transform: currentTransform,
            signature: currentSignature,
            observedChange
        };
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

    async function waitStableCurrentPage(scroller, track, options = {}) {
        const assertOperation = options.assertOperation || (() => {});
        const timeout = options.timeout ?? PAGE_STABLE_TIMEOUT_MS;
        const previousSignature = options.previousSignature ?? '';
        const requiredStableFrames = options.requiredStableFrames ?? 2;
        const minimumSlots = Math.max(0, options.minimumSlots ?? 0);
        const minimumNewItems = Math.max(0, options.minimumNewItems ?? 0);
        const seenKeys = options.seenKeys instanceof Set || options.seenKeys instanceof Map ? options.seenKeys : null;
        const requiredKeys = options.requiredKeys instanceof Set ? options.requiredKeys : null;
        const sessionToken = options.sessionToken ?? null;
        const token = options.hoverToken ?? null;
        const bindingOwner = bindingForSource(scroller, track);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken, assertOperation);
        assertCurrent();
        if (hoverPreparationCancelled(token)) return [];
        const start = performance.now();
        let lastSignature = '';
        let stableFrames = 0;
        let best = [];
        let bestNewItems = 0;
        let bestRequiredMatches = 0;
        let freshContentSeen = !previousSignature;

        while (performance.now() - start < timeout) {
            await scheduledWait(requestAnimationFrame, cancelAnimationFrame);
            assertCurrent();
            if (hoverPreparationCancelled(token)) return [];
            const slots = currentPageSlots(scroller, track);
            let newItems = 0, requiredMatches = 0;
            if ((seenKeys && minimumNewItems > 0) || requiredKeys?.size) {
                for (const key of mountedItemKeys(slots)) {
                    if (seenKeys && minimumNewItems > 0 && !seenKeys.has(key)) newItems++;
                    if (requiredKeys?.has(key)) requiredMatches++;
                }
            }
            if (requiredMatches > bestRequiredMatches ||
                (requiredMatches === bestRequiredMatches &&
                    (slots.length > best.length || (slots.length === best.length && newItems >= bestNewItems)))) {
                best = slots;
                bestNewItems = newItems;
                bestRequiredMatches = requiredMatches;
            }

            const signature = visibleSignature(slots);
            if (!signature) continue;

            if (!freshContentSeen && signature !== previousSignature) {
                freshContentSeen = true;
                stableFrames = 0;
                lastSignature = '';
            }
            if (!freshContentSeen) continue;

            const slotCountReady = slots.length >= minimumSlots;
            const newItemCountReady = !seenKeys || minimumNewItems <= 0 || newItems >= minimumNewItems;
            const requiredKeysReady = !requiredKeys || requiredKeys.size === 0 || requiredMatches >= requiredKeys.size;
            if (!slotCountReady || !newItemCountReady || !requiredKeysReady) {
                stableFrames = 0;
                lastSignature = signature;
                continue;
            }

            if (signature === lastSignature) {
                stableFrames++;
                if (stableFrames >= requiredStableFrames) return slots;
            } else {
                lastSignature = signature;
                stableFrames = 1;
                if (requiredStableFrames <= 1) return slots;
            }
        }
        assertCurrent();
        if (hoverPreparationCancelled(token)) return [];
        return best;
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

    function createRestoration(section, scroller, track, items, expectedPageSlots, sessionToken) {
        const bindingOwner = borrowBinding(section, scroller, track);
        const assertCurrent = bindingGuard(bindingOwner, sessionToken);

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
        return createRestoration(section, scroller, track, items, expectedPageSlots, sessionToken).strict(targetPage);
    }

    async function restoreNativePageFast(section, scroller, track, items, expectedPageSlots, targetPage, canonicalTargetTransform = '', sessionToken = null) {
        return createRestoration(section, scroller, track, items, expectedPageSlots, sessionToken).fast(targetPage, canonicalTargetTransform);
    }

    return Object.freeze({ suppress, restoreMotion, reset, whenIdle: () => tail,
        move: moveOnePage, navigate: goToPage, stable: waitStableCurrentPage,
        restoreStrict: restoreNativePageByPage, restoreFast: restoreNativePageFast,
        pageKeys: pageItemKeys, transform: trackTransformValue,
        acknowledgeLogical: waitLogicalPageChange, acknowledgeIndicator: waitPage,
        logicalSignal: createLogicalMoveSignal,
        diagnostics: () => ({ pendingMoves: moves.size,
            pendingWaits: waits.size, motionLeases: [...motionOwners.values()].reduce((count, owner) => count + owner.leases.size, 0) }) });
}
