// Private hover instrumentation. Importing this module allocates no resources.
export function createHoverTiming(options) {
    const { performance, document, requestAnimationFrame, cancelAnimationFrame,
        isRouteSessionActive, sessionScope, probeLimits } = options;
    const HOVER_FRAME_DIAGNOSTIC_LIMITS = Object.freeze({ routeFrames: 12000, windowFrames: 1800,
        intentMs: 600, preparationMs: 6000, replayMs: 2000, scrollMs: 1000 });
    const HOVER_INTERRUPTION_LOG_LIMIT = 48;
    const HOVER_CANCELLATION_REASONS = Object.freeze({ scroll: 'Scroll', 'pointer-leave': 'PointerLeave',
        superseded: 'Superseded', resize: 'Resize', group: 'Group', source: 'Source', route: 'Route',
        controls: 'Controls', 'outside-grid': 'OutsideGrid', preview: 'Preview', other: 'Other' });
    let hoverFrameDiagnosticOwner = null;
    let performanceDiagnostics = createCounters();
    function createCounters() { return {
            hoverPreparation: { calls: 0, slotsConsidered: 0, clonesRebuilt: 0, neighborsSkipped: 0 },
            hoverLifecycle: { replayAttempts: 0, replaysDispatched: 0, replayCancelled: 0, replayFailed: 0,
                exitsDispatched: 0, exitSkipped: 0, exitFailed: 0, scrollBursts: 0, scrollExits: 0,
                lastExitReason: '', boundaryDetoursAvoided: 0, duplicateAlignmentsAvoided: 0,
                duplicatePageReadsAvoided: 0, logicalMoveReads: 0, logicalMoveObserverStarts: 0,
                logicalMoveNotifications: 0, logicalMoveSignalFrames: 0, logicalMoveFallbackWakes: 0,
                logicalMoveObserverUnsupported: 0, logicalMoveObserverFailures: 0,
                previewTransfers: 0, previewReturns: 0, previewReleases: 0, previewRejected: 0, lastPreviewReason: '' },
            hoverTiming: { dwellSamples: 0, dwellTotalMs: 0, dwellMaxMs: 0,
                queueSamples: 0, queueTotalMs: 0, queueMaxMs: 0,
                moveSamples: 0, moveTotalMs: 0, moveMaxMs: 0,
                acknowledgementSamples: 0, acknowledgementTotalMs: 0, acknowledgementMaxMs: 0,
                settlementSamples: 0, settlementTotalMs: 0, settlementMaxMs: 0,
                mainPreparationSamples: 0, mainPreparationTotalMs: 0, mainPreparationMaxMs: 0,
                watchedPreparationSamples: 0, watchedPreparationTotalMs: 0, watchedPreparationMaxMs: 0,
                graftSamples: 0, graftTotalMs: 0, graftMaxMs: 0,
                alignmentSamples: 0, alignmentTotalMs: 0, alignmentMaxMs: 0,
                replaySamples: 0, replayTotalMs: 0, replayMaxMs: 0,
                exitSamples: 0, exitTotalMs: 0, exitMaxMs: 0,
                previewSamples: 0, previewTotalMs: 0, previewMaxMs: 0 },
            hoverInteraction: { intentsQueued: 0, intentsCancelled: 0, dwellCompleted: 0, dwellRejected: 0,
                replacementNotHovered: 0, replayGuardRejected: 0, leavesBeforeReplay: 0, leavesAfterReplay: 0,
                leavesWithin600ms: 0, stationaryLeaves: 0, leavesToPreviewHint: 0, diagnosticFailures: 0,
                replacementPointerChecks: 0, replacementPointerAccepted: 0, replacementPointerRejected: 0,
                replacementPointerUnavailable: 0 },
            hoverScroll: { scope: 'scroll-intent-and-interruptions', interruptionLogLimit: HOVER_INTERRUPTION_LOG_LIMIT,
                wheelEvents: 0, scrollEvents: 0, otherScrollEvents: 0, lastScrollEvent: '',
                boundarySuppressedQuiet: 0, boundarySuppressedMovement: 0, unchangedPointerEvents: 0,
                physicalRearms: 0, dwellRearms: 0, intentsDuringQuiet: 0, intentsAwaitingMovement: 0,
                cancelledDwellTotalMs: 0, cancelledDwellMaxMs: 0, lastIntentCancellationReason: '',
                preparationInterruptions: 0, interruptionLogs: 0, interruptionLogsSkipped: 0,
                lastPreparationCancellationReason: '',
                ...Object.fromEntries(Object.values(HOVER_CANCELLATION_REASONS).flatMap(reason =>
                    [[`intentCancelled${reason}`, 0], [`preparationCancelled${reason}`, 0]])) },
            hoverPreview: { scope: 'bounded-preview-presence', delayMs: probeLimits.delayMs,
                routeReplayLimit: probeLimits.routeReplays, rootLimit: probeLimits.roots,
                scheduled: 0, completed: 0, checks: 0, pointerChecks: 0, rootSearches: 0,
                checkTotalMs: 0, checkMaxMs: 0,
                matchedTransfers: 0, matchedAtPointer: 0, matchedElsewhere: 0, noPreviewRoot: 0,
                unverifiedRoots: 0, earlyRelease: 0, invalidOwner: 0, hidden: 0, failed: 0,
                skippedAtLimit: 0, lastResult: '' },
            hoverFrames: { scope: 'bounded-animation-callback-gaps', supported: false, active: false, stopReason: '',
                routeFrameLimit: HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames,
                windowFrameLimit: HOVER_FRAME_DIAGNOSTIC_LIMITS.windowFrames,
                windows: 0, callbacks: 0, gapSamples: 0, totalGapMs: 0, maxGapMs: 0,
                gapsOver32ms: 0, gapsOver50ms: 0, gapsOver100ms: 0,
                mixedPhaseSamples: 0, mixedPhaseMaxMs: 0,
                intentSamples: 0, intentMaxMs: 0, preparationSamples: 0, preparationMaxMs: 0,
                replaySamples: 0, replayMaxMs: 0, scrollSamples: 0, scrollMaxMs: 0 },
    }; }
    function recordHoverTiming(counters, phase, started) {
        if (performanceDiagnostics.hoverTiming !== counters) return;
        const elapsed = Math.max(0, Math.round((performance.now() - started) * 10) / 10);
        counters[`${phase}Samples`]++;
        counters[`${phase}TotalMs`] = Math.round((counters[`${phase}TotalMs`] + elapsed) * 10) / 10;
        counters[`${phase}MaxMs`] = Math.max(counters[`${phase}MaxMs`], elapsed);
        return elapsed;
    }
    function stopHoverFrameDiagnostics(reason = 'route-leave') {
        const owner = hoverFrameDiagnosticOwner;
        if (!owner) return;
        hoverFrameDiagnosticOwner = null;
        owner.counters.active = false;
        owner.counters.stopReason = reason;
        try { if (owner.frame !== null) cancelAnimationFrame(owner.frame); } catch (_) {}
    }
    function startHoverFrameDiagnostics(phase) {
        const counters = performanceDiagnostics.hoverFrames;
        try {
            if (!Object.hasOwn(HOVER_FRAME_DIAGNOSTIC_LIMITS, `${phase}Ms`)) return;
            if (!isRouteSessionActive(sessionScope.token)) return;
            if (hoverFrameDiagnosticOwner && hoverFrameDiagnosticOwner.counters !== counters) {
                stopHoverFrameDiagnostics('owner-replaced');
            }
            counters.supported = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
            if (!counters.supported) { counters.stopReason = 'unsupported'; return; }
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                stopHoverFrameDiagnostics('hidden'); counters.stopReason = 'hidden'; return;
            }
            if (counters.callbacks >= HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames) {
                counters.stopReason = 'route-frame-limit'; return;
            }
            const now = performance.now();
            let owner = hoverFrameDiagnosticOwner;
            if (!owner) {
                owner = { counters, sessionToken: sessionScope.token, frame: null, previousAt: now, mixedPhase: false };
                hoverFrameDiagnosticOwner = owner;
            }
            // Preserve an outstanding callback's baseline across phase changes:
            // a delayed dwell timer must not erase the stall that preceded it.
            // Intervals spanning phases are reported separately, not attributed
            // entirely to preparation or entirely to Netflix's popup replay.
            if (owner.phase !== phase && now > owner.previousAt) owner.mixedPhase = true;
            owner.phase = phase;
            owner.deadline = now + HOVER_FRAME_DIAGNOSTIC_LIMITS[`${phase}Ms`];
            owner.windowFrames = 0;
            counters.windows++;
            counters.active = true;
            counters.stopReason = '';
            if (owner.frame === null) owner.frame = requestAnimationFrame(() => sampleHoverFrameDiagnostics(owner));
        } catch (_) {
            stopHoverFrameDiagnostics('api-failed'); counters.active = false; counters.stopReason = 'api-failed';
        }
    }
    function sampleHoverFrameDiagnostics(owner) {
        if (hoverFrameDiagnosticOwner !== owner) return;
        owner.frame = null;
        try {
            if (performanceDiagnostics.hoverFrames !== owner.counters || !isRouteSessionActive(owner.sessionToken)) {
                stopHoverFrameDiagnostics('owner-replaced'); return;
            }
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                stopHoverFrameDiagnostics('hidden'); return;
            }
            const now = performance.now();
            const gap = Math.max(0, Math.round((now - owner.previousAt) * 10) / 10);
            owner.previousAt = now;
            const counters = owner.counters;
            counters.callbacks++;
            counters.gapSamples++;
            counters.totalGapMs = Math.round((counters.totalGapMs + gap) * 10) / 10;
            counters.maxGapMs = Math.max(counters.maxGapMs, gap);
            if (gap > 32) counters.gapsOver32ms++;
            if (gap > 50) counters.gapsOver50ms++;
            if (gap > 100) counters.gapsOver100ms++;
            const phase = owner.mixedPhase ? 'mixedPhase' : owner.phase;
            counters[`${phase}Samples`]++;
            counters[`${phase}MaxMs`] = Math.max(counters[`${phase}MaxMs`], gap);
            owner.mixedPhase = false;
            // Include a late callback's gap before stopping at the deadline.
            if (counters.callbacks >= HOVER_FRAME_DIAGNOSTIC_LIMITS.routeFrames) {
                stopHoverFrameDiagnostics('route-frame-limit'); return;
            }
            if (++owner.windowFrames >= HOVER_FRAME_DIAGNOSTIC_LIMITS.windowFrames) {
                stopHoverFrameDiagnostics('window-frame-limit'); return;
            }
            if (now >= owner.deadline) { stopHoverFrameDiagnostics('window-complete'); return; }
            owner.frame = requestAnimationFrame(() => sampleHoverFrameDiagnostics(owner));
        } catch (_) { stopHoverFrameDiagnostics('api-failed'); }
    }

    return Object.freeze({
        get counters() { return performanceDiagnostics; },
        reset() { stopHoverFrameDiagnostics('owner-replaced'); performanceDiagnostics = createCounters(); },
        record: recordHoverTiming, start: startHoverFrameDiagnostics, stop: stopHoverFrameDiagnostics,
        diagnostics: () => Object.freeze(Object.fromEntries(Object.entries(performanceDiagnostics).map(([key,value]) => [key,{...value}])))
    });
}
