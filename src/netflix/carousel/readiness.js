import { SYNTHETIC_SECTION_ID } from '../../dom-names.js';

// Private readiness policy and wait lifetime; native facts and admission remain borrowed.
export function createReadiness({ native, scope, performance, setTimeout, clearTimeout,
    requestAnimationFrame, cancelAnimationFrame, log, warn, tLog, logTimeout: logOperationTimeout }) {
    const { borrowBinding, isBindingCurrent, readiness: nativeCarouselReadiness,
        findSection: findMyListSection, findScroller, findTrack } = native;
    const assertRouteSession = token => scope.assertCurrent(token);
    const NATIVE_READY_TIMEOUT_MS = 3000, NATIVE_SINGLE_PAGE_STABLE_MS = 700, NATIVE_EMPTY_STABLE_MS = 1200;
    const NATIVE_READY_POLL_MS = 25, NATIVE_LOGICAL_STABLE_MS = 120;
    const readinessWaits = new Set();
    let readinessCleanupFailures = 0;
    function readinessWait(schedule, cancel) {
        return new Promise(resolve => {
            const ticket = { id: null, cancel, settle: resolve }; readinessWaits.add(ticket);
            try { ticket.id = schedule(() => { if (readinessWaits.delete(ticket)) resolve(); }); }
            catch (error) { readinessWaits.delete(ticket); throw error; }
        });
    }
    const sleep = ms => readinessWait(resolve => setTimeout(resolve, ms), clearTimeout);
    const readinessFrame = () => readinessWait(requestAnimationFrame, cancelAnimationFrame);
    function resetReadinessWaits() {
        const retired = [...readinessWaits]; readinessWaits.clear();
        for (const ticket of retired) {
            try { ticket.cancel(ticket.id); } catch (_) { readinessCleanupFailures++; }
            finally { ticket.settle(); }
        }
    }

    async function waitForNativeSource(section, timeout = NATIVE_READY_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const bindingOwner = borrowBinding(section);
        const started = performance.now();
        while (performance.now() - started < timeout) {
            assertRouteSession(sessionToken);
            if (!isBindingCurrent(bindingOwner)) return { found: false, empty: false, reason: 'detached',
                stage: 'native-source', elapsedMs: Math.round(performance.now() - started) };
            if (section.id === SYNTHETIC_SECTION_ID) {
                const nativeSection = findMyListSection();
                if (nativeSection && nativeSection !== section) {
                    return { found: false, nativeSection, elapsedMs: Math.round(performance.now() - started) };
                }
            }

            const scroller = findScroller(section);
            const track = scroller && findTrack(scroller);
            if (scroller && track) return { found: true, scroller, track, elapsedMs: Math.round(performance.now() - started) };
            await sleep(NATIVE_READY_POLL_MS);
        }
        assertRouteSession(sessionToken);
        if (!isBindingCurrent(bindingOwner)) return { found: false, empty: false, reason: 'detached',
            stage: 'native-source', elapsedMs: Math.round(performance.now() - started) };
        return {
            found: false,
            empty: false,
            reason: 'timeout',
            stage: 'native-source',
            timeoutMs: timeout,
            elapsedMs: Math.round(performance.now() - started)
        };
    }

    async function waitForNativeCarouselReady(section, scroller, track, sessionToken = null, options = {}) {
        const assertAdmission = options.assertAdmission || (() => {});
        assertAdmission();
        assertRouteSession(sessionToken);
        const bindingOwner = borrowBinding(section, scroller, track);
        const started = performance.now();
        const fastSinglePageTotalCount = Number.isSafeInteger(options.fastSinglePageTotalCount)
            ? options.fastSinglePageTotalCount
            : null;
        let lastSignature = '';
        let stableSince = started;
        let lastState = nativeCarouselReadiness(section, scroller, track);
        const outcome = (ready, reason, state, extra = {}) => ({ ready, reason,
            elapsedMs: Math.round(performance.now() - started), state, ...extra });
        const detached = () => outcome(false, 'detached', { ...lastState, connected: false });

        const { connected, signature, ...initialDetails } = lastState;
        log(tLog('waitingForNativeCarouselInitialization'), initialDetails);
        assertAdmission();

        while (performance.now() - started < NATIVE_READY_TIMEOUT_MS) {
            assertAdmission();
            assertRouteSession(sessionToken);
            if (!isBindingCurrent(bindingOwner)) return detached();
            const state = nativeCarouselReadiness(section, scroller, track);
            lastState = state;
            if (!state.connected) {
                return outcome(false, 'detached', state);
            }

            const now = performance.now();
            if (state.signature !== lastSignature) {
                lastSignature = state.signature;
                stableSince = now;
            }

            const stableMs = now - stableSince;
            const multiPageReady =
                state.pages > 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                (state.controlsEnabled || state.trackInitialized || state.slots >= state.columns);

            const logicalCarouselReady =
                state.pageMode === 'logical' &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.controlsPresent &&
                state.trackInitialized &&
                stableMs >= NATIVE_LOGICAL_STABLE_MS;

            // A genuine short list can legitimately have one page and fewer cards than
            // the responsive column count. Do not accept that state immediately: the
            // same shape also appears briefly while Netflix is still building a larger
            // virtual carousel. Let it remain unchanged before treating it as complete.
            const fastSinglePageReady =
                Number.isSafeInteger(fastSinglePageTotalCount) &&
                fastSinglePageTotalCount > 0 &&
                fastSinglePageTotalCount <= state.columns &&
                state.pageMode === 'logical' &&
                state.pages === 1 &&
                state.cards === fastSinglePageTotalCount &&
                state.currentCards === fastSinglePageTotalCount &&
                state.slots === fastSinglePageTotalCount;

            const singlePageReady =
                state.pages === 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.slots === state.cards &&
                (fastSinglePageReady || stableMs >= NATIVE_SINGLE_PAGE_STABLE_MS);

            const emptyPageReady =
                state.pages === 1 &&
                state.cards === 0 &&
                state.slots === 0 &&
                stableMs >= NATIVE_EMPTY_STABLE_MS;

            if (emptyPageReady) {
                return outcome(true, 'stable-empty-page', state, { empty: true });
            }

            if (logicalCarouselReady || multiPageReady || singlePageReady) {
                await readinessFrame();
                assertAdmission();
                assertRouteSession(sessionToken);
                await readinessFrame();
                assertAdmission();
                assertRouteSession(sessionToken);
                if (!isBindingCurrent(bindingOwner)) return detached();
                const confirmed = nativeCarouselReadiness(section, scroller, track);
                if (confirmed.connected && confirmed.signature === state.signature) {
                    const result = outcome(true, logicalCarouselReady ? 'logical-carousel'
                        : (multiPageReady ? 'multi-page' : (fastSinglePageReady ? 'fast-single-page' : 'stable-single-page')), confirmed);
                    log(tLog('nativeCarouselInitializationReady'), result);
                    assertAdmission();
                    return result;
                }
                lastSignature = confirmed.signature;
                stableSince = performance.now();
                lastState = confirmed;
            }

            await sleep(NATIVE_READY_POLL_MS);
            assertAdmission();
            assertRouteSession(sessionToken);
        }

        assertRouteSession(sessionToken);
        if (!isBindingCurrent(bindingOwner)) return detached();
        const finalState = nativeCarouselReadiness(section, scroller, track);
        const result = outcome(false, 'timeout', finalState,
            { stage: 'native-carousel-readiness', timeoutMs: NATIVE_READY_TIMEOUT_MS });
        logOperationTimeout(result.stage, result.timeoutMs, {
            elapsedMs: result.elapsedMs,
            state: finalState
        });
        assertAdmission();
        warn(tLog('nativeCarouselInitializationIsStillIncompleteInitializationDeferred'), result);
        assertAdmission();
        return result;
    }

    return { waitForSource: waitForNativeSource, waitUntilReady: waitForNativeCarouselReady,
        reset: resetReadinessWaits, diagnostics: () => ({ readinessWaits: readinessWaits.size, readinessCleanupFailures }) };
}
