import { createHoverTiming } from './timing.js';

// One route-scoped intent owner. Native mechanics and structural writes remain
// with their collaborators; this capability owns policy and resource admission.
export function createHover(options) {
    const { document, Element, performance, setTimeout, clearTimeout, readEnvironment,
        resolveReady, prepare, whenStable, assertSession: assertRouteSession,
        isCancelledError: isRouteSessionCancelledError, describeItem: itemSummary,
        log, warn, tLog } = options;
    const gridView = options.grid;
    const sessionScope = { get token() { return options.readSessionToken(); } };
    const isRouteSessionActive = options.isSessionCurrent;
    const findGridClone = item => gridView.getCard(item)?.node || null;
    const gridOwnsClone = options.gridOwnsClone || ((clone, grid) => { const handle = gridView.getCard(clone?.__tmMyListItem);
        return Boolean(handle && handle.node === clone && gridView.isCardCurrent(handle) && grid?.contains(clone) && gridView.isCardVisible(clone, grid)); });
    const HOVER_ACTIVATION_DELAY_MS = 120;
    const HOVER_SCROLL_QUIET_MS = 180;
    const HOVER_RETRY_DELAY_MS = 180;
    const HOVER_INTERRUPTION_LOG_LIMIT = 48;
    const HOVER_CANCELLATION_REASONS = Object.freeze({ scroll: 'Scroll', 'pointer-leave': 'PointerLeave',
        superseded: 'Superseded', resize: 'Resize', group: 'Group', source: 'Source', route: 'Route',
        controls: 'Controls', 'outside-grid': 'OutsideGrid', preview: 'Preview', other: 'Other' });
    let hoverToken = 0;
    let activeVideoId = null;
    let activePage = null;
    let activeClone = null;
    let lastPointerX = -1;
    let lastPointerY = -1;
    let lastTargetScrollAt = -Infinity;
    let hoverNeedsPointerMove = false;
    let pendingGridHoverClone = null;
    let pendingGridHoverDiagnostic = null;
    let activeHoverPreparationDiagnostic = null;
    let hoverSequence = 0;
    let activeAttempt = null, handoffCard = null;
    const retryWaits = new Map();
    let listenersActive = false;
    let listenerRevision = 0;
    let documentListeners = [];
    const gridListeners = new Map();
    const timing = createHoverTiming({ ...options, isRouteSessionActive, sessionScope,
        probeLimits: { delayMs: 900, routeReplays: 48, roots: 6 } });
    let performanceDiagnostics = timing.counters;
    const recordHoverTiming = (...args) => timing.record(...args);
    const startHoverFrameDiagnostics = phase => timing.start(phase);
    const stopHoverFrameDiagnostics = reason => timing.stop(reason);
    const nativePopup = options.createPopup({
        readIntent: () => intent(), readDiagnostics: () => performanceDiagnostics,
        gridCloneFromPointerEvent, gridOwnsClone, isCancelled: hoverPreparationCancelled,
        isTargetCurrent: gridHoverTargetActive, recordTiming: recordHoverTiming,
        onReplay: startHoverFrameDiagnostics, rejectionDiagnostic: hoverReplayGuardDiagnostic,
        onFailed: releaseFailedGridHover, associateGridHoverItem,
        ensureGridHoverBehavior: () => ensureGridHoverBehavior(readEnvironment().grid),
        onPreviewRelease: (clone, reason, target, release) => {
            const token = advanceHoverToken('preview'); release();
            if (hoverToken === token && activeClone === clone) clearActive();
        }
    });
    function clearSourceAlignment(slot, reason = 'source-release', relatedTarget = null) { nativePopup.release(reason, relatedTarget, slot); }
    function clearActive() { activeClone = null; activeVideoId = null; activePage = null; }
    function intent() { return Object.freeze({ token: hoverToken, sessionToken: sessionScope.token, clone: activeClone,
        videoId: activeVideoId, page: activePage, pointerX: lastPointerX, pointerY: lastPointerY }); }
    function hoverPreparationCancelled(token) {
        return token !== null && token !== undefined && token !== hoverToken;
    }
    function hoverScrollElapsed(now = performance.now()) {
        return Number.isFinite(lastTargetScrollAt) ? Math.max(0, Math.round(now - lastTargetScrollAt)) : null;
    }
    function recordHoverCancellation(counters, kind, reason) {
        const knownReason = Object.hasOwn(HOVER_CANCELLATION_REASONS, reason) ? reason : 'other';
        if (performanceDiagnostics.hoverScroll === counters) {
            counters[`${kind}Cancelled${HOVER_CANCELLATION_REASONS[knownReason]}`]++;
        }
        return knownReason;
    }
    function advanceHoverToken(reason = 'other') {
        const token = ++hoverToken;
        activeAttempt = null; handoffCard = null;
        const retiredWaits = [...retryWaits]; retryWaits.clear();
        for (const [timer, resolve] of retiredWaits) { clearTimeout(timer); resolve(); }
        const owner = activeHoverPreparationDiagnostic;
        // Dispose before logging: a newer intent or native exit may reenter.
        activeHoverPreparationDiagnostic = null;
        if (!owner || owner.token !== token - 1) return token;
        try {
            const counters = owner.counters;
            if (performanceDiagnostics.hoverScroll !== counters) return token;
            const knownReason = recordHoverCancellation(counters, 'preparation', reason);
            counters.preparationInterruptions++;
            counters.lastPreparationCancellationReason = knownReason;
            if (counters.interruptionLogs >= HOVER_INTERRUPTION_LOG_LIMIT) {
                counters.interruptionLogsSkipped++;
                return token;
            }
            counters.interruptionLogs++;
            log('Hover preparation interrupted', { seq: owner.seq, token: owner.token, nextToken: token,
                group: owner.group, reason: knownReason, elapsedMs: Math.round(performance.now() - owner.started),
                sinceScrollMs: hoverScrollElapsed(), intent: owner.intent });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
        return token;
    }
    function hoverIntentDiagnosticSnapshot(owner) {
        if (!owner) return null;
        return { physicalMove: owner.physicalMove, sinceScrollAtQueueMs: owner.sinceScrollAtQueueMs,
            quietRemainingAtQueueMs: owner.quietRemainingAtQueueMs, needsMovementAtQueue: owner.needsMovementAtQueue,
            scheduledDwellMs: owner.scheduledDwellMs, actualDwellMs: Math.round(performance.now() - owner.started),
            sinceScrollAtActivationMs: hoverScrollElapsed() };
    }
    function hoverScrollStateSnapshot() {
        const sinceScrollMs = hoverScrollElapsed();
        return { needsPointerMove: hoverNeedsPointerMove, sinceScrollMs,
            quietRemainingMs: sinceScrollMs === null ? 0 : Math.max(0, HOVER_SCROLL_QUIET_MS - sinceScrollMs),
            pendingIntent: Boolean(pendingGridHoverClone), preparing: Boolean(activeHoverPreparationDiagnostic),
            lastEvent: performanceDiagnostics.hoverScroll.lastScrollEvent };
    }
    function hoverReplayGuardDiagnostic(clone, generation, token, sessionToken, item) {
        // Failure-only scalar checks: no rectangles, styles, DOM search or React data.
        try {
            return { token, currentToken: hoverToken, routeActive: isRouteSessionActive(sessionToken),
                preparationCancelled: hoverPreparationCancelled(token), targetConnected: Boolean(clone?.isConnected),
                gridConnected: Boolean(readEnvironment().grid?.isConnected),
                gridOwned: Boolean(clone && readEnvironment().grid && gridOwnsClone(clone, readEnvironment().grid)),
                generationMatches: generation === clone?.__tmHoverActivationGeneration,
                targetHovered: Boolean(clone?.matches(':hover')), viewingControlHovered: Boolean(clone?.__tmViewingControlHovered),
                hoverSuppressed: gridHoverSuppressed(), activeCloneMatches: activeClone === clone,
                activeVideoMatches: activeVideoId === item.videoId,
                replacementHoveredAtInsertion: clone?.__tmHoverReplacementHovered ?? null,
                replacementPointerVerified: clone?.__tmHoverReplacementPointerVerified ?? null,
                sinceScrollMs: Number.isFinite(lastTargetScrollAt) ? Math.round(performance.now() - lastTargetScrollAt) : null };
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; return { unavailable: true }; }
    }
    function hoverLeaveDestinationDiagnostic(target) {
        // Class names are inspected only for fixed UI hints, never exported.
        // Six ancestors / eight class tokens each; no text, URLs, IDs or HTML.
        const result = { element: target instanceof Element, tag: '', inGrid: false,
            viewingControlHint: false, previewHint: false, ancestorsExamined: 0, truncated: false };
        let node = target instanceof Element ? target : target?.parentElement;
        for (; node && result.ancestorsExamined < 6; node = node.parentElement) {
            result.ancestorsExamined++;
            if (!result.tag && /^[a-z][a-z0-9-]{0,15}$/i.test(node.localName || '')) result.tag = node.localName;
            if (node === readEnvironment().grid) result.inGrid = true;
            if (node.getAttribute('data-tm-viewing-actions') === 'true') result.viewingControlHint = true;
            const classes = node.classList;
            for (let index = 0; classes && index < Math.min(classes.length, 8); index++) {
                if (/^(?:previewModal|mini-modal|bob|jawbone)(?:$|[-_])/i.test(classes.item(index) || '')) {
                    result.previewHint = true;
                }
            }
        }
        result.truncated = Boolean(node);
        return result;
    }
    function recordGridHoverLeave(clone, relatedTarget, event) {
        const counters = performanceDiagnostics.hoverInteraction;
        try {
            const replay = nativePopup.replayFacts(clone);
            const afterReplay = Boolean(replay && replay.sessionToken === sessionScope.token);
            const sinceReplayMs = afterReplay ? Math.max(0, Math.round(performance.now() - replay.replayedAt)) : null;
            const coordinatesKnown = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY);
            const pointerDeltaPx = afterReplay && coordinatesKnown ? Math.round(Math.hypot(
                event.clientX - replay.coordinates.clientX, event.clientY - replay.coordinates.clientY) * 10) / 10 : null;
            const destination = hoverLeaveDestinationDiagnostic(relatedTarget);
            if (afterReplay) {
                counters.leavesAfterReplay++;
                if (sinceReplayMs <= 600) counters.leavesWithin600ms++;
                if (pointerDeltaPx !== null && pointerDeltaPx <= 1) counters.stationaryLeaves++;
            } else counters.leavesBeforeReplay++;
            if (destination.previewHint) counters.leavesToPreviewHint++;
            log(tLog('hoverPointerLeaveObserved'), { afterReplay, sinceReplayMs, pointerDeltaPx,
                eventType: event?.type === 'pointerout' ? 'pointerout' : event?.type === 'pointerover' ? 'pointerover' : 'unspecified',
                trusted: Boolean(event?.isTrusted), targetConnected: Boolean(clone.isConnected),
                targetHovered: clone.matches(':hover'), sameCloneDestination: Boolean(relatedTarget && clone.contains(relatedTarget)),
                destination });
        } catch (_) { counters.diagnosticFailures++; }
    }
    function retireHoverCard(handle, detail) {
        const clone = handle.node;
        if (detail.reason === 'replacement' && activeAttempt?.card === handle &&
            detail.attempt?.token === activeAttempt.token && detail.attempt.sessionToken === activeAttempt.sessionToken && isRouteSessionActive(detail.attempt.sessionToken)) {
            handoffCard = handle; return;
        }
        if (activeAttempt?.card === handle || clone === activeClone || clone === pendingGridHoverClone ||
            (clone.getAttribute('data-tm-preparing') === 'true' && clone.getAttribute('data-tm-hover-token') === String(hoverToken))) {
            cancel('source');
        }
    }

    function releaseFailedGridHover(clone, token) {
        if (!clone || token !== hoverToken || activeClone !== clone) return;
        clearActive();
        clearSourceAlignment();
    }

    async function activateClone(item, clone, triggerEvent = null, generation = clone?.__tmHoverActivationGeneration, intentDiagnostic = null) {
        if (!gridHoverTargetActive(clone, generation)) return;
        const admittedCard = gridView.getCard(item);
        if (!admittedCard || admittedCard.node !== clone || !gridView.isCardCurrent(admittedCard)) return;
        const seq = ++hoverSequence;
        const started = performance.now();
        const timing = performanceDiagnostics.hoverTiming;
        const group = clone.parentElement?.getAttribute('data-tm-watch-grid') === 'true' ? 'watched' : 'main';

        if (Boolean(readEnvironment().blockedReason)) {
            log(tLog('hoverCancelled'), {
                seq,
                reason: readEnvironment().blockedReason,
                item: itemSummary(item)
            });
            return;
        }

        const waitingSession = sessionScope.token, waitingToken = hoverToken;
        const stability = whenStable();
        if (stability) await stability;
        if (hoverToken !== waitingToken || !isRouteSessionActive(waitingSession) || !gridView.isCardCurrent(admittedCard) || !gridHoverTargetActive(clone, generation)) return;
        if (!clone?.isConnected) {
            warn(tLog('hoverCancelled'), { seq, reason: 'clone-disconnected', item: itemSummary(item) });
            return;
        }
        if (clone.getAttribute('data-tm-preparing') === 'true') {
            const preparingTokenText = clone.getAttribute('data-tm-hover-token');
            const preparingToken = preparingTokenText === null ? NaN : Number(preparingTokenText);
            if (Number.isFinite(preparingToken) && preparingToken !== hoverToken) {
                // The previous hover was already cancelled (typically by pointerleave),
                // but its async cleanup has not reached finally yet. Clear only that
                // stale marker so a new hover can start immediately; the old token will
                // make the previous async path self-cancel at its next checkpoint.
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            } else {
                log(tLog('hoverCancelled'), { seq, reason: 'already-preparing', item: itemSummary(item) });
                return;
            }
        }

        const token = advanceHoverToken('superseded');
        const sessionToken = sessionScope.token;
        startHoverFrameDiagnostics('preparation');
        clone.setAttribute('data-tm-hover-token', String(token));
        clone.setAttribute('data-tm-preparing', 'true');
        const diagnosticOwner = { seq, token, group, started, intent: intentDiagnostic,
            counters: performanceDiagnostics.hoverScroll };
        activeHoverPreparationDiagnostic = diagnosticOwner;
        let fresh = null;
        activeAttempt = { token, sessionToken, card: admittedCard };
        try {
            assertRouteSession(sessionToken);
            // One recovery attempt for this intent, including failed ready-source
            // replay. Follow the current card after preparation replaces its DOM.
            for (let attempt = 0; attempt < 2; attempt++) {
                if (attempt) await waitRetry();
                const current = activeAttempt?.token === token ? activeAttempt.card.node : null;
                if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    Boolean(readEnvironment().blockedReason) ||
                    !gridHoverTargetActive(current, generation, triggerEvent) ||
                    current.getAttribute('data-tm-hover-token') !== String(token)) break;

                clearSourceAlignment();
                const openPrepared = prepared => {
                    const card = prepared.card;
                    if (activeAttempt?.token !== token || activeAttempt.card !== card || !gridView.isCardCurrent(card) ||
                        card.node !== findGridClone(item) || card.node.getAttribute('data-tm-hover-token') !== String(token) ||
                        generation !== card.node.__tmHoverActivationGeneration) return Promise.resolve(false);
                    activeClone = card.node; activeVideoId = item.videoId; activePage = prepared.page;
                    performanceDiagnostics.hoverLifecycle.duplicateAlignmentsAvoided++;
                    return nativePopup.open({ source: prepared.source, card, page: prepared.page, item, event: triggerEvent,
                        reason: ready ? 'immediate-reuse' : 'prepared-page', token, sessionToken });
                };
                let ready = null, replay = null;
                (options.sample || (callback => callback()))(() => {
                    const resolution = !attempt ? resolveReady(item, gridView.getCard(item)) : null;
                    ready = resolution?.source ? resolution : null;
                    log(tLog(ready ? 'hoverReusedImmediately' : 'hoverRequestedNativePagePreparation'), {
                        seq, group, intent: intentDiagnostic, item: itemSummary(item), token,
                        selectedPage: resolution?.page ?? null, backedPage: resolution?.backedPage ?? null,
                        targetPage: resolution?.targetPage ?? null,
                        directPageDistance: resolution ? Math.abs(resolution.page - resolution.targetPage) : null,
                        elapsedMs: Math.round(performance.now() - started) });
                    resolution?.assertCurrent?.();
                    if (ready) replay = openPrepared(ready);
                });
                if (ready) fresh = await replay ? ready.card.node : null;
                else {
                    const prepared = await prepare(item, gridView.getCard(item), triggerEvent, token, sessionToken);
                    if (prepared && !hoverPreparationCancelled(token)) fresh = await openPrepared(prepared) ? prepared.card.node : null;
                }
                if (fresh || hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                    Boolean(readEnvironment().blockedReason)) break;
            }
            if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken)) return;
            if (fresh) recordHoverTiming(timing, group === 'watched' ? 'watchedPreparation' : 'mainPreparation', started);
            log(tLog('hoverNativePagePreparationResult'), {
                seq,
                group,
                intent: intentDiagnostic,
                item: itemSummary(item),
                success: Boolean(fresh),
                replayDispatched: Boolean(fresh),
                activePage,
                activeVideoId,
                elapsedMs: Math.round(performance.now() - started)
            });
        } catch (error) {
            if (!isRouteSessionCancelledError(error)) {
                warn(tLog('liveClonePreparationFailed'), { seq, item: itemSummary(item), error });
            }
        } finally {
            if (activeAttempt?.token === token) activeAttempt = null;
            if (activeHoverPreparationDiagnostic === diagnosticOwner) activeHoverPreparationDiagnostic = null;
            if (!fresh) releaseFailedGridHover(activeClone, token);
            const current = findGridClone(item);
            if (current?.isConnected && current.getAttribute('data-tm-hover-token') === String(token)) {
                current.removeAttribute('data-tm-preparing');
                current.removeAttribute('data-tm-hover-token');
            }
            if (clone?.isConnected && clone.getAttribute('data-tm-hover-token') === String(token)) {
                clone.removeAttribute('data-tm-preparing');
                clone.removeAttribute('data-tm-hover-token');
            }
        }
    }
    function waitRetry() {
        return new Promise(resolve => {
            const timer = setTimeout(() => { if (retryWaits.delete(timer)) resolve(); }, HOVER_RETRY_DELAY_MS);
            retryWaits.set(timer, resolve);
        });
    }
    function gridCloneFromPointerEvent(event, grid, includeViewingControls = false) {
        let node = event.target instanceof Element ? event.target : event.target?.parentElement;
        while (node && node !== grid) {
            if (!includeViewingControls && node.getAttribute('data-tm-viewing-actions') === 'true') return null;
            if (node.__tmMyListItem && gridOwnsClone(node, grid)) return node;
            node = node.parentElement;
        }
        return null;
    }
    function gridHoverSuppressed() {
        return hoverNeedsPointerMove || performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS;
    }
    function gridHoverReplacementUnderPointer(clone, triggerEvent) {
        // Only a replacement in this still-current preparation can use hit testing.
        // Never infer hover merely from a saved rectangle or a nearby popup.
        if (clone.__tmHoverReplacementToken !== hoverToken ||
            clone.getAttribute('data-tm-hover-token') !== String(hoverToken) ||
            clone.getAttribute('data-tm-preparing') !== 'true') return false;
        const counters = performanceDiagnostics.hoverInteraction;
        counters.replacementPointerChecks++;
        const current = lastPointerX !== -1 && lastPointerY !== -1;
        const x = current ? lastPointerX : triggerEvent?.clientX;
        const y = current ? lastPointerY : triggerEvent?.clientY;
        try {
            if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document?.elementFromPoint !== 'function') {
                counters.replacementPointerUnavailable++;
                clone.__tmHoverReplacementPointerVerified = null;
                return false;
            }
            const target = document.elementFromPoint(x, y);
            const matches = Boolean(target && gridCloneFromPointerEvent({ target }, readEnvironment().grid) === clone);
            clone.__tmHoverReplacementPointerVerified = matches;
            if (matches) counters.replacementPointerAccepted++;
            else counters.replacementPointerRejected++;
            return matches;
        } catch (_) {
            counters.replacementPointerUnavailable++;
            clone.__tmHoverReplacementPointerVerified = null;
            return false;
        }
    }
    function gridHoverTargetActive(clone, generation, triggerEvent = null) {
        const handle = clone?.__tmMyListItem ? gridView.getCard(clone.__tmMyListItem) : null;
        return Boolean(handle && handle.node === clone && gridView.isCardCurrent(handle)) && !gridHoverSuppressed() && Boolean(readEnvironment().grid?.isConnected) &&
            Boolean(clone?.isConnected) && gridOwnsClone(clone, readEnvironment().grid) &&
            !clone.__tmViewingControlHovered &&
            generation === clone.__tmHoverActivationGeneration &&
            (clone.matches(':hover') || gridHoverReplacementUnderPointer(clone, triggerEvent));
    }
    function cancelPendingGridHover(reason = 'other') {
        const clone = pendingGridHoverClone;
        const diagnostic = pendingGridHoverDiagnostic;
        pendingGridHoverClone = null;
        pendingGridHoverDiagnostic = null;
        if (!clone) return;
        performanceDiagnostics.hoverInteraction.intentsCancelled++;
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clearTimeout(clone.__tmHoverActivationTimer);
        clone.__tmHoverActivationTimer = null;
        try {
            if (diagnostic && performanceDiagnostics.hoverScroll === diagnostic.counters) {
                const counters = diagnostic.counters;
                const elapsed = Math.max(0, Math.round(performance.now() - diagnostic.started));
                counters.cancelledDwellTotalMs += elapsed;
                counters.cancelledDwellMaxMs = Math.max(counters.cancelledDwellMaxMs, elapsed);
                counters.lastIntentCancellationReason = recordHoverCancellation(counters, 'intent', reason);
            }
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }
    function handleGridClonePointerOver(event, clone, item, physicalMove = false) {
        if (Boolean(readEnvironment().blockedReason)) return;
        if (event.relatedTarget && clone.contains(event.relatedTarget)) return;
        if (!readEnvironment().grid?.isConnected) return;
        if (gridHoverSuppressed() && !physicalMove) {
            const counters = performanceDiagnostics.hoverScroll;
            if (hoverNeedsPointerMove) counters.boundarySuppressedMovement++;
            if (performance.now() - lastTargetScrollAt < HOVER_SCROLL_QUIET_MS) counters.boundarySuppressedQuiet++;
            return;
        }
        if (pendingGridHoverClone === clone || activeClone === clone) return;
        if (clone.getAttribute('data-tm-preparing') === 'true' &&
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) return;

        // All preparation, including ready-source reuse, goes through the dwell.
        // Physical intent received just after a scroll survives the quiet period.
        // Boundary events alone still cannot prepare a stationary scroll target.
        cancelPendingGridHover('superseded');
        const generation = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        clone.__tmHoverActivationGeneration = generation;
        pendingGridHoverClone = clone;
        const pendingCard = gridView.getCard(item), pendingSession = sessionScope.token;
        performanceDiagnostics.hoverInteraction.intentsQueued++;
        startHoverFrameDiagnostics('intent');
        const dwellStarted = performance.now();
        const timing = performanceDiagnostics.hoverTiming;
        const counters = performanceDiagnostics.hoverScroll;
        const quietRemaining = Math.max(0, HOVER_SCROLL_QUIET_MS - (dwellStarted - lastTargetScrollAt));
        const delay = Math.max(HOVER_ACTIVATION_DELAY_MS, quietRemaining);
        const diagnostic = { started: dwellStarted, counters, physicalMove,
            sinceScrollAtQueueMs: hoverScrollElapsed(dwellStarted), quietRemainingAtQueueMs: Math.round(quietRemaining),
            needsMovementAtQueue: hoverNeedsPointerMove, scheduledDwellMs: Math.round(delay) };
        pendingGridHoverDiagnostic = diagnostic;
        if (quietRemaining > 0) counters.intentsDuringQuiet++;
        if (hoverNeedsPointerMove) counters.intentsAwaitingMovement++;
        clone.__tmHoverActivationTimer = setTimeout(() => {
            if (pendingGridHoverDiagnostic !== diagnostic || !isRouteSessionActive(pendingSession)) return;
            recordHoverTiming(timing, 'dwell', dwellStarted);
            clone.__tmHoverActivationTimer = null;
            if (pendingGridHoverClone === clone) pendingGridHoverClone = null;
            if (pendingGridHoverDiagnostic === diagnostic) pendingGridHoverDiagnostic = null;
            if (physicalMove && readEnvironment().grid?.isConnected && clone.isConnected &&
                gridOwnsClone(clone, readEnvironment().grid) && generation === clone.__tmHoverActivationGeneration &&
                clone.matches(':hover') && performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) {
                if (hoverNeedsPointerMove && performanceDiagnostics.hoverScroll === counters) counters.dwellRearms++;
                hoverNeedsPointerMove = false;
            }
            if (!isRouteSessionActive(pendingSession) || !gridView.isCardCurrent(pendingCard) ||
                pendingCard.node !== clone || !gridHoverTargetActive(clone, generation)) {
                performanceDiagnostics.hoverInteraction.dwellRejected++;
                return;
            }
            performanceDiagnostics.hoverInteraction.dwellCompleted++;
            activateClone(item, clone, event, generation, hoverIntentDiagnosticSnapshot(diagnostic));
        }, delay);
    }
    function handleGridClonePointerLeave(clone, item, relatedTarget = null, event = null) {
        if (pendingGridHoverClone === clone || activeClone === clone ||
            clone.getAttribute('data-tm-hover-token') === String(hoverToken)) {
            recordGridHoverLeave(clone, relatedTarget, event);
        }
        if (nativePopup.retainPreview(clone, relatedTarget, event)) return;
        const cancellationReason = clone.__tmViewingControlHovered ? 'controls' : 'pointer-leave';
        if (pendingGridHoverClone === clone) cancelPendingGridHover(cancellationReason);
        clone.__tmHoverActivationGeneration = (Number(clone.__tmHoverActivationGeneration) || 0) + 1;
        if (clone.__tmHoverActivationTimer !== null && clone.__tmHoverActivationTimer !== undefined) {
            clearTimeout(clone.__tmHoverActivationTimer);
            clone.__tmHoverActivationTimer = null;
        }

        const cloneTokenText = clone.getAttribute('data-tm-hover-token');
        const cloneToken = cloneTokenText === null ? NaN : Number(cloneTokenText);
        if (Number.isFinite(cloneToken) && cloneToken === hoverToken) {
            advanceHoverToken(cancellationReason);
            clone.removeAttribute('data-tm-hover-token');
            clone.removeAttribute('data-tm-preparing');
            log(tLog('pendingHoverCancelledOnLeave'), {
                item: itemSummary(item),
                token: cloneToken,
                hoverToken
            });
        }
        if (activeClone !== clone) return;
        clearSourceAlignment(undefined, 'pointer-leave', relatedTarget);
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        log(tLog('hoverCoordinateProxyReleased'), { item: itemSummary(item) });
    }
    function associateGridHoverItem(item, clone) {
        clone.__tmMyListItem = item;
    }
    function ensureGridHoverBehavior(grid) {
        if (!grid || grid.__tmHoverBehaviorInstalled) return;
        for (const [previous, listeners] of gridListeners) if (!previous.isConnected) {
            previous.removeEventListener('pointerover', listeners.over, true);
            previous.removeEventListener('pointerout', listeners.out, true);
            delete previous.__tmHoverBehaviorInstalled;
            gridListeners.delete(previous);
        }
        grid.__tmHoverBehaviorInstalled = true;
        const installedSession = sessionScope.token;
        const over = event => {
            if (!listenersActive || gridListeners.get(grid)?.over !== over || !isRouteSessionActive(installedSession)) return;
            const clone = gridCloneFromPointerEvent(event, grid);
            if (clone) {
                clone.__tmViewingControlHovered = false;
                handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
            } else {
                const controlClone = gridCloneFromPointerEvent(event, grid, true);
                if (controlClone) {
                    controlClone.__tmViewingControlHovered = true;
                    handleGridClonePointerLeave(controlClone, controlClone.__tmMyListItem, event.target, event);
                } else cancelPendingGridHover('controls');
            }
        };
        const out = event => {
            if (!listenersActive || gridListeners.get(grid)?.out !== out || !isRouteSessionActive(installedSession)) return;
            const clone = gridCloneFromPointerEvent(event, grid);
            if (!clone || (event.relatedTarget && clone.contains(event.relatedTarget))) return;
            handleGridClonePointerLeave(clone, clone.__tmMyListItem, event.relatedTarget, event);
        };
        gridListeners.set(grid, { over, out });
        grid.addEventListener('pointerover', over, { capture: true, passive: true });
        grid.addEventListener('pointerout', out, { capture: true, passive: true });
    }
    function handleTargetPointerMove(event) {
        // Synthetic native replay must not overwrite the latest physical position.
        if (!event.isTrusted) return;
        const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        if (!moved) {
            if (hoverNeedsPointerMove) performanceDiagnostics.hoverScroll.unchangedPointerEvents++;
            return;
        }
        const grid = readEnvironment().grid;
        if (!grid?.isConnected) return;
        const clone = gridCloneFromPointerEvent(event, grid);
        if (nativePopup.pointerMoved(event)) { cancelPendingGridHover('preview'); return; }
        if (performance.now() - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS) {
            if (hoverNeedsPointerMove) performanceDiagnostics.hoverScroll.physicalRearms++;
            hoverNeedsPointerMove = false;
        }
        if (clone) handleGridClonePointerOver(event, clone, clone.__tmMyListItem, true);
        else cancelPendingGridHover('outside-grid');
    }
    function handleTargetScroll(event = null) {
        const now = performance.now();
        const starting = now - lastTargetScrollAt >= HOVER_SCROLL_QUIET_MS;
        lastTargetScrollAt = now;
        const counters = performanceDiagnostics.hoverScroll;
        const kind = event?.type === 'wheel' ? 'wheel' : event?.type === 'scroll' ? 'scroll' : 'other';
        counters[kind === 'wheel' ? 'wheelEvents' : kind === 'scroll' ? 'scrollEvents' : 'otherScrollEvents']++;
        counters.lastScrollEvent = kind;
        hoverNeedsPointerMove = true;
        cancelPendingGridHover('scroll');
        if (!starting) return;
        performanceDiagnostics.hoverLifecycle.scrollBursts++;
        startHoverFrameDiagnostics('scroll');
        advanceHoverToken('scroll');
        clearSourceAlignment(undefined, 'scroll');
        activeVideoId = null;
        activeClone = null;
        activePage = null;
        // Grafted React props also receive Netflix's delegated mouse events.
        // Clear them once per scroll burst so they cannot bypass the script guard.
        nativePopup.invalidate();
    }
    function handleHoverDiagnosticVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            stopHoverFrameDiagnostics('hidden');
            nativePopup.finishProbe({ result: 'hidden' });
        }
    }

    function cancel(reason = 'source') {
        cancelPendingGridHover(reason); const token = advanceHoverToken(reason);
        if (hoverToken !== token) return;
        clearActive(); clearSourceAlignment(undefined, reason);
        if (hoverToken === token) nativePopup.invalidate();
    }
    function start() {
        if (listenersActive) return;
        listenersActive = true;
        const revision = ++listenerRevision, sessionToken = sessionScope.token;
        documentListeners = [ ['pointermove', handleTargetPointerMove, true], ['pointerout', nativePopup.previewPointerOut, true],
            ['visibilitychange', handleHoverDiagnosticVisibilityChange, false], ['wheel', handleTargetScroll, true], ['scroll', handleTargetScroll, true] ]
            .map(([type, callback, capture]) => ({ type, capture, listener: event => {
                if (listenersActive && listenerRevision === revision && isRouteSessionActive(sessionToken)) callback(event);
            } }));
        for (const entry of documentListeners) document.addEventListener(entry.type, entry.listener, { passive: true, capture: entry.capture });
    }
    function dispose() {
        listenersActive = false;
        listenerRevision++;
        const retiredListeners = documentListeners; documentListeners = [];
        for (const entry of retiredListeners) document.removeEventListener(entry.type, entry.listener, entry.capture);
        const retiredGrids = [...gridListeners]; gridListeners.clear();
        for (const [grid, listeners] of retiredGrids) {
            grid.removeEventListener('pointerover', listeners.over, true); grid.removeEventListener('pointerout', listeners.out, true);
            delete grid.__tmHoverBehaviorInstalled;
        }
        lastTargetScrollAt = -Infinity; hoverNeedsPointerMove = false; lastPointerX = -1; lastPointerY = -1;
        timing.stop('route-leave'); cancel('route');
    }
    // Public capability: complete policy operations and copied observations only.
    return Object.freeze({ start, dispose, releaseInteraction() { clearActive(); clearSourceAlignment(); }, install: ensureGridHoverBehavior, retire: retireHoverCard, cancel,
        intent, isCancelled: hoverPreparationCancelled, isTargetCurrent: gridHoverTargetActive,
        protectedCards: () => Object.freeze([activeClone, pendingGridHoverClone].filter(Boolean)),
        hasInteraction: () => Boolean(activeClone || pendingGridHoverClone || activeHoverPreparationDiagnostic?.token === hoverToken),
        resetDiagnostics() { timing.reset(); performanceDiagnostics = timing.counters; },
        diagnostics: () => Object.freeze({ ...timing.diagnostics(), hoverScrollState: Object.freeze(hoverScrollStateSnapshot()) }),
        count(section, field) { if (Object.hasOwn(performanceDiagnostics[section] || {}, field)) performanceDiagnostics[section][field]++; },
        captureTiming() { const counters = performanceDiagnostics.hoverTiming; return (phase, started) => recordHoverTiming(counters, phase, started); },
        navigationSink(token) { const lifecycle = performanceDiagnostics.hoverLifecycle, measure = token === null ? null : this.captureTiming();
            return Object.freeze({ bump(field) { if (performanceDiagnostics.hoverLifecycle === lifecycle && Object.hasOwn(lifecycle,field)) lifecycle[field]++; }, record: measure }); },
        acceptReplacement(previous, next, token, sessionToken) {
            if (handoffCard !== previous || activeAttempt?.card !== previous || activeAttempt.token !== token ||
                !isRouteSessionActive(sessionToken) || !gridView.isCardCurrent(next)) return false;
            activeAttempt.card = next; handoffCard = null; return true;
        }
    });
}
