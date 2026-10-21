import { createInitializationAttempt } from './my-list-initialization/attempt.js';

export function createMyListInitialization(dependencies) {
    const { environment, i18n, logger, session } = dependencies;
    const { performance, setTimeout, clearTimeout } = environment;
    const { tLog } = i18n;
    const { log } = logger;
    const NATIVE_READY_POLL_MS = 25, TOTAL_COUNT_TIMEOUT_MS = 5000;
    let runningInitialization = null, initializationDeferral = null, scheduledRun = null;
    let missingSectionSince = 0, blockedInitialization = null;
    let performanceDiagnostics = createPerformanceDiagnostics();

    function createPerformanceDiagnostics() {
        return {
            nativeRecovery: { attempts: 0, completed: 0, exhausted: 0 }
        };
    }

    function beginRunningSession(sessionToken) {
        session.assertRouteSession(sessionToken);
        dependencies.listMutations.start(sessionToken);
        initializationDeferral?.ticket.release({ resume: false });
        const owner = { sessionToken, ticket: dependencies.listMutations.deferReconciliation('initialization') };
        initializationDeferral = owner; runningInitialization = owner;
        return Object.freeze({
            finish({ resume = true, retry = null } = {}) {
                if (runningInitialization !== owner || initializationDeferral !== owner) return;
                clearRunningSession(sessionToken, resume, owner);
                if (!session.isRouteSessionActive(sessionToken)) return;
                if (retry === 'scheduled') scheduleRun(0, sessionToken);
                else if (retry === 'immediate') runScript(sessionToken);
            },
            block(native = null) {
                if (runningInitialization !== owner || initializationDeferral !== owner) return;
                blockedInitialization = { sessionToken, ...(native ? { native } : {}) };
            },
            recover(reason) {
                if (runningInitialization && runningInitialization !== owner) return false;
                return recoverNativeInitialization(sessionToken, reason);
            }
        });
    }

    function clearRunningSession(sessionToken, retryMutations = true, expected = initializationDeferral) {
        if (runningInitialization?.sessionToken !== sessionToken || initializationDeferral !== expected) return;
        runningInitialization = null;
        initializationDeferral = null;
        expected?.ticket.release({ resume: retryMutations, reason: 'after-initialization' });
    }

    function initializationTimeoutError(stage, timeoutMs, details = {}) {
        return session.initializationError(
            'INITIALIZATION_TIMEOUT',
            stage,
            `Timeout at ${stage} after ${timeoutMs} ms`,
            { timeoutMs, ...details }
        );
    }

    async function waitForMyListTotalCount(timeout = TOTAL_COUNT_TIMEOUT_MS, sessionToken = null) {
        return dependencies.listView.waitForInitialCount({ timeout, sessionToken, now: () => performance.now(), pause: session.sleep,
            pollMs: NATIVE_READY_POLL_MS,
            read: () => ({ available: dependencies.listData.isAvailable(), count: dependencies.listData.detectMyListTotalCount() }),
            onTimeout({ available }) {
                const details = { graphqlAvailable: available, graphqlKey: dependencies.listData.diagnostics().graphqlKey,
                    domGeneration: dependencies.display.inspectSource()?.carouselDom?.generation ?? null };
                dependencies.diagnostics.logOperationTimeout('total-count-detection', timeout, details);
                return initializationTimeoutError('total-count-detection', timeout, details);
            } });
    }

    function collectMountedSinglePageItems(bootstrap, totalCount, columns, sessionToken = null) {
        session.assertRouteSession(sessionToken);
        if (session.entryKind !== 'spa' || !session.entryReason.startsWith('route:')) {
            return { items: null, reason: 'proof-or-entry-no-longer-valid' };
        }
        return dependencies.nativeCarousel.collect({ mode: 'mounted-single-page', bootstrap, totalCount, columns, sessionToken,
            section: dependencies.display.captureSource()?.section, scroller: dependencies.display.captureSource()?.scroller, track: dependencies.display.captureSource()?.track });
    }

    function recoverNativeInitialization(sessionToken, reason) {
        const failure = blockedInitialization?.native;
        if (!failure || failure.sessionToken !== sessionToken || !session.isRouteSessionActive(sessionToken)) return false;
        if (performanceDiagnostics.nativeRecovery.attempts >= 1) {
            if (!failure.exhaustedReported) {
                failure.exhaustedReported = true;
                performanceDiagnostics.nativeRecovery.exhausted++;
                log(tLog('nativeInitializationRecoveryExhausted'), { sessionToken, reason, maxAttempts: 1 });
            }
            return false;
        }
        try {
            const discovered = dependencies.display.discoverSource({ bindingOnly: true });
            const { section, scroller, track } = discovered;
            if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected ||
                !section.contains(scroller) || !scroller.contains(track) ||
                (section === failure.section && scroller === failure.scroller && track === failure.track)) return false;

            dependencies.hover.cancel('source');
            dependencies.nativeCarousel.assertObservation(discovered);
            if (blockedInitialization?.native !== failure) return false;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !session.isRouteSessionCancelledError(error)) throw error;
            return false;
        }

        performanceDiagnostics.nativeRecovery.attempts++;
        dependencies.listMutations.deferPending();
        session.cleanupTargetSessionDom();
        dependencies.stopResponsive();
        dependencies.display.discardSource();
        blockedInitialization = null;
        clearRunningSession(sessionToken, false);
        dependencies.nativeCarousel.refreshDiscovery();
        // A replacement may have a different membership/count. Use the existing
        // fresh SPA bootstrap rather than an old initial-page cache on this retry.
        session.useFreshEntry();
        log(tLog('nativeInitializationRecovered'), {
            sessionToken, reason, attempt: performanceDiagnostics.nativeRecovery.attempts,
            pendingMutations: dependencies.listMutations.pendingIntents().length
        });
        scheduleRun(40, sessionToken);
        return true;
    }

    const attempt = createInitializationAttempt(dependencies, { beginRunningSession, scheduleRun,
        missingElapsed(now) { if (!missingSectionSince) missingSectionSince = now; return now - missingSectionSince; },
        resetMissing() { missingSectionSince = 0; }, initializationTimeoutError,
        waitForMyListTotalCount, collectMountedSinglePageItems });
    function runScript(sessionToken = session.scope.token) {
        if (!session.isRouteSessionActive(sessionToken)) return;
        if (blockedInitialization?.sessionToken === sessionToken) {
            recoverNativeInitialization(sessionToken, 'run'); return;
        }
        if (runningInitialization?.sessionToken === sessionToken) return;
        return attempt.run(sessionToken);
    }
    function scheduleRun(delayMs = 40, sessionToken = session.scope.token) {
        if (!session.isRouteSessionActive(sessionToken)) return;
        if (blockedInitialization?.sessionToken === sessionToken) return;
        const normalizedDelay = Math.max(0, delayMs);
        const dueAt = performance.now() + normalizedDelay;
        // Keep the earliest run; DOM discovery can pull a fallback wait forward.
        if (scheduledRun?.sessionToken === sessionToken && scheduledRun.dueAt > 0 && scheduledRun.dueAt <= dueAt + 1) return;
        if (scheduledRun) clearTimeout(scheduledRun.timer);
        const owner = { sessionToken, dueAt, timer: null };
        scheduledRun = owner;
        owner.timer = setTimeout(() => {
            if (scheduledRun !== owner || session.disposed) return;
            scheduledRun = null;
            if (!session.isRouteSessionActive(sessionToken)) return;
            runScript(sessionToken);
        }, normalizedDelay);
    }

    return Object.freeze({ get running() { return runningInitialization ? Object.freeze({ sessionToken: runningInitialization.sessionToken }) : null; },
        get hasWork() { return Boolean(runningInitialization || scheduledRun); },
        isBlocked: token => blockedInitialization?.sessionToken === token,
        isNativeBlocked: token => blockedInitialization?.native?.sessionToken === token,
        workCounters: () => ({ nativeRecovery: { ...performanceDiagnostics.nativeRecovery } }),
        resetMissingSourceWait() { missingSectionSince = 0; },
        acceptPublication() {
            if (performanceDiagnostics.nativeRecovery.attempts > performanceDiagnostics.nativeRecovery.completed) performanceDiagnostics.nativeRecovery.completed++;
            dependencies.onAccepted();
        },
        begin() { blockedInitialization = null; performanceDiagnostics = createPerformanceDiagnostics(); },
        dropDeferral() { initializationDeferral = null; },
        cancelScheduled() { if (scheduledRun) clearTimeout(scheduledRun.timer); scheduledRun = null; },
        retire() { runningInitialization = null; blockedInitialization = null; missingSectionSince = 0; },
        waitForMyListTotalCount, collectMountedSinglePageItems, recoverNativeInitialization, scheduleRun });
}
