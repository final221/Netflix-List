// Acknowledgement, hydration and settlement own all their temporary resources.
export function createNavigationWaits({ borrowBinding, assertBinding, bindingForSource, bindingGuard,
    diagnosticSink, native, scope, performance, getComputedStyle, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, isHoverCancelled,
    initializationTimeoutError, logOperationTimeout, mountedItemKeys }) {
    // Hawkins controls can apply a virtual-page transform after several paint
    // cycles when the source row is under load. Keep the observation window
    // longer than that deferred update so a legitimate move is not retried
    // while the first click is still settling.
    const PAGE_CHANGE_TIMEOUT_MS = 3000, PAGE_CHANGE_OBSERVER_PRIMARY_MS = 320;
    const PAGE_STABLE_TIMEOUT_MS = 2000, SCRIPT_MOVE_SETTLE_TIMEOUT_MS = 260;
    const CANCELLED_MOVE_POLL_MS = 80;

    const { model: getCarouselDomRuntime, registerPage: registerLogicalPageSignature,
        selectedPage, currentSlots: currentPageSlots, signatureOf: visibleSignature } = native;
    const assertRouteSession = token => scope.assertCurrent(token);
    const isRouteSessionActive = token => scope.isCurrent(token);
    const hoverPreparationCancelled = isHoverCancelled;
    const waits = new Set();
    const sleep = ms => scheduledWait(close => setTimeout(close, ms), clearTimeout);
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


    return Object.freeze({ scheduledWait, sleep, waitLogicalPageChange, waitPage, waitForScriptMoveSettle,
        waitStableCurrentPage, reset() { for (const close of [...waits]) close(); }, pending: () => waits.size });
}
