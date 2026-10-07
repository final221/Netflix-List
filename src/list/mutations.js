// Private membership-action lifetimes. Grid alone retains removal markup.
export function createMutations({ now, readSession, isSessionActive, setTimeout, clearTimeout, ttl,
    hasRetained, releaseRetained, normalizeTitle = String,
    isBlocked = () => false, applyMutation = null,
    readParent = () => null, canApply = () => false, assertSession = () => {}, isCancelled = () => false,
    createError = (code, message) => Object.assign(new Error(message), { code }),
    hasMember, refreshNative, observeNative, removeMember, addMember, alignVisible,
    captureNative, hasMaterial, preferredIndexForNative, assertNative,
    findFallback = () => null, observeChanges = () => null, queueMicrotask = () => {},
    mutationTimeout = 1800, onQueued = () => {}, onTimeout = () => {},
    onCounter = () => {}, onExpired = () => {} }) {
    let entries = new Map(), timer = null, generation = 0;
    let pending = new Map(), sequence = 0;
    let deferralEpoch = 0, disposedToken = null, cleanupFailures = 0;
    function cleanup(operation) { try { operation(); } catch (_) { cleanupFailures++; } }
    const isAdmitted = token => token !== disposedToken && isSessionActive(token);
    function start(token = readSession()) { if (!isSessionActive(token)) return false; disposedToken = null; return true; }
    const deferrals = new Map();
    function isDeferred() { for (const owner of deferrals.values()) if (isAdmitted(owner.token)) return true; return false; }
    function deferReconciliation(reason) {
        const owner = { token: readSession(), epoch: deferralEpoch, reason };
        const ticket = Object.freeze({ reason, release({ resume = true, reason: retryReason = 'after-' + reason } = {}) {
            if (!deferrals.delete(ticket)) return false;
            if (owner.epoch !== deferralEpoch || !isAdmitted(owner.token)) return false;
            if (resume && !isDeferred()) retryMutations(retryReason);
            return true;
        } });
        if (isAdmitted(owner.token)) deferrals.set(ticket, owner);
        return ticket;
    }
    function dispose() {
        const oldPending = pending, oldEntries = entries, oldTimer = timer;
        pending = new Map(); entries = new Map(); timer = null;
        deferrals.clear(); deferralEpoch++; sequence++; generation++; disposedToken = readSession();
        if (oldTimer) cleanup(() => clearTimeout(oldTimer.id));
        cleanup(() => onCounter('cleared', oldEntries.size));
        for (const intent of oldPending.values()) releaseIntent(intent, oldEntries);
        for (const entry of oldEntries.values()) {
            const current = entries.get(entry.videoId), intent = readPending(entry.videoId);
            const retained = (current?.item === entry.item && current?.correlationId === entry.correlationId) ||
                (intent?.fallbackItem === entry.item && intent?.correlationId === entry.correlationId);
            if (!retained) cleanup(() => releaseRetained(entry.correlationId));
        }
    }
    const phases = new WeakMap();
    const readPending = videoId => pending.get(String(videoId)) || null;
    const isMutationCurrent = intent => Boolean(intent && readPending(intent.videoId) === intent &&
        isAdmitted(phases.get(intent)?.token));
    function releaseIntent(intent, oldEntries = entries) {
        const phase = phases.get(intent), oldTimer = phase.timer, observer = phase.observer;
        phase.timer = null; phase.observer = null;
        if (oldTimer) cleanup(() => clearTimeout(oldTimer.id));
        cleanup(() => observer?.disconnect());
        const next = readPending(intent.videoId);
        const transferred = next?.fallbackItem === intent.fallbackItem && next?.correlationId === intent.correlationId;
        if (intent.correlationId && entries.get(intent.videoId)?.correlationId !== intent.correlationId &&
            oldEntries.get(intent.videoId)?.correlationId !== intent.correlationId && !transferred) {
            cleanup(() => releaseRetained(intent.correlationId));
        }
    }
    function disposeMutation(videoId, expected = null) {
        const key = String(videoId || ''), intent = readPending(key);
        if (!intent || (expected && expected !== intent)) return;
        pending.delete(key); releaseIntent(intent);
    }
    function clearPending() {
        const old = pending; pending = new Map(); sequence++;
        for (const intent of old.values()) releaseIntent(intent);
    }
    function observeMembership(descriptor) {
        if (!descriptor?.videoId) return null;
        const token = readSession(), seq = ++sequence, videoId = String(descriptor.videoId);
        if (!isAdmitted(token)) return null;
        const previous = readPending(videoId);
        const phase = { token, timer: null, observer: null, deferred: Boolean(descriptor.deferredWhileBusy) };
        const intent = Object.freeze({ seq, videoId, action: descriptor.action,
            uia: descriptor.uia || '', uiaAction: descriptor.uiaAction || 'unknown', source: descriptor.source || 'user-click',
            detectedAt: Number.isFinite(descriptor.detectedAt) ? descriptor.detectedAt : now(),
            fallbackItem: descriptor.fallbackItem || null, correlationId: descriptor.correlationId || null,
            preferredIndex: Number.isFinite(descriptor.preferredIndex) ? Math.max(0, Math.floor(descriptor.preferredIndex)) : null,
            undo: Boolean(descriptor.undo), get deferredWhileBusy() { return phase.deferred; } });
        if (sequence !== seq || !isAdmitted(token)) return null;
        phases.set(intent, phase); pending.set(videoId, intent);
        if (previous) releaseIntent(previous);
        if (sequence !== seq || !isMutationCurrent(intent)) return null;
        return intent;
    }
    function applyObservedMutation(intent, reason) {
        if (!canApply()) return false;
        const parent = readParent(), token = readSession();
        const guard = () => {
            assertSession(token);
            if (readParent() !== parent || !isMutationCurrent(intent) || !canApply() || isDeferred()) {
                throw createError('NATIVE_SOURCE_REPLACED', 'Mutation admission was replaced');
            }
        };
        const call = (operation, ...args) => { const result = operation(...args); guard(); return result; };
        try {
            guard();
            const videoId = intent.videoId;
            let live = call(refreshNative) || call(observeNative);
            if (intent.action === 'remove') {
                const changed = call(removeMember, videoId, reason);
                if (!changed && !call(hasMember, videoId)) { disposeMutation(videoId, intent); return true; }
                if (!changed) return false;
                live = call(refreshNative) || live;
                if (live?.track) call(alignVisible, live);
                disposeMutation(videoId, intent); return true;
            }
            if (call(hasMember, videoId)) { disposeMutation(videoId, intent); return true; }
            const nativeItem = call(captureNative, videoId, live);
            const candidate = nativeItem || intent.fallbackItem || call(findFallback, videoId);
            const correlationId = candidate === intent.fallbackItem ? intent.correlationId : null;
            if (!call(hasMaterial, candidate, correlationId)) return false;
            const index = nativeItem ? call(preferredIndexForNative, videoId, live)
                : (Number.isFinite(intent.preferredIndex) ? intent.preferredIndex : 0);
            call(assertNative, live);
            const changed = call(addMember, candidate, index, nativeItem ? reason + '-native' : reason + '-captured', correlationId);
            if (changed || call(hasMember, videoId)) {
                live = call(refreshNative) || live;
                if (live?.track) call(alignVisible, live);
                disposeMutation(videoId, intent); return true;
            }
            return false;
        } catch (error) {
            if (error?.code !== 'NATIVE_SOURCE_REPLACED' && !isCancelled(error)) throw error;
            return false;
        }
    }
    function reconcileMutation(intent, reason = 'event') {
        if (!isMutationCurrent(intent)) return false;
        const phase = phases.get(intent);
        if (isDeferred() || isBlocked()) { phase.deferred = true; return false; }
        if (!isMutationCurrent(intent)) return false;
        phase.deferred = false;
        return (applyMutation || applyObservedMutation)(intent, reason);
    }
    function scheduleMutationTimeout(intent) {
        if (!isMutationCurrent(intent)) return;
        const phase = phases.get(intent), old = phase.timer;
        const owner = { id: null }; phase.timer = owner;
        if (old) clearTimeout(old.id);
        if (!isMutationCurrent(intent) || phase.timer !== owner) return;
        owner.id = setTimeout(() => {
            if (!isMutationCurrent(intent) || phase.timer !== owner) return;
            phase.timer = null;
            const applied = reconcileMutation(intent, 'observer-timeout');
            if (applied || !isMutationCurrent(intent)) return;
            if (isDeferred()) { phase.deferred = true; return; }
            onTimeout({ seq: intent.seq, videoId: intent.videoId, action: intent.action, timeoutMs: mutationTimeout });
            disposeMutation(intent.videoId, intent);
        }, mutationTimeout);
        if (!isMutationCurrent(intent) || phase.timer !== owner) clearTimeout(owner.id);
    }
    function retryMutations(reason) {
        if (isDeferred() || !isAdmitted(readSession())) return;
        for (const intent of [...pending.values()]) {
            if (!phases.get(intent).deferred) continue;
            const applied = reconcileMutation(intent, reason);
            if (!applied && isMutationCurrent(intent)) scheduleMutationTimeout(intent);
        }
    }
    function deferPending() { for (const intent of pending.values()) phases.get(intent).deferred = true; }
    function queueMutation(descriptor) {
        if (!descriptor?.videoId) return null;
        const token = readSession(), owner = sequence;
        const fallbackItem = descriptor.action === 'add' ? (descriptor.fallbackItem || findFallback(String(descriptor.videoId))) : null;
        if (sequence !== owner || !isAdmitted(token)) return null;
        const intent = observeMembership({ ...descriptor, fallbackItem,
            correlationId: descriptor.correlationId || correlationFor(fallbackItem) });
        if (!intent) return null;
        const phase = phases.get(intent);
        try {
            const observer = observeChanges(() => reconcileMutation(intent, 'mutation-observer'));
            if (!isMutationCurrent(intent)) { try { observer?.disconnect(); } catch (_) {} return null; }
            phase.observer = observer; scheduleMutationTimeout(intent);
        } catch (error) { disposeMutation(intent.videoId, intent); throw error; }
        if (!isMutationCurrent(intent)) return null;
        onQueued(intent);
        queueMicrotask(() => reconcileMutation(intent, 'post-click'));
        return intent;
    }
    function pendingDiagnostics() {
        return [...pending.values()].map(intent => ({ videoId: intent.videoId, action: intent.action,
            ageMs: Math.round(now() - intent.detectedAt), source: intent.source,
            observerActive: Boolean(phases.get(intent).observer) }));
    }
    function cancelExpiry() {
        const old = timer; timer = null;
        if (old) clearTimeout(old.id);
    }
    function scheduleExpiry() {
        let dueAt = Infinity;
        for (const entry of entries.values()) dueAt = Math.min(dueAt, entry.removedAt + ttl);
        const token = readSession();
        if (!Number.isFinite(dueAt) || !isAdmitted(token)) { cancelExpiry(); return; }
        if (timer?.dueAt === dueAt && timer.token === token) return;
        cancelExpiry();
        const owner = { id: null, token, dueAt }; timer = owner;
        onCounter('schedules', 1);
        if (timer !== owner) return;
        owner.id = setTimeout(() => {
            if (timer !== owner) return;
            timer = null;
            if (!isAdmitted(owner.token)) return;
            onCounter('expiryCallbacks', 1); pruneUndo();
        }, Math.max(0, dueAt - now()));
        if (timer !== owner) clearTimeout(owner.id);
    }
    function clearUndo() {
        const old = entries; entries = new Map(); generation++; cancelExpiry();
        onCounter('cleared', old.size);
        for (const entry of old.values()) releaseRetained(entry.correlationId);
    }
    function forgetUndo(videoId) {
        const key = String(videoId), entry = entries.get(key);
        if (!entries.delete(key)) return;
        generation++;
        releaseRetained(entry.correlationId); onCounter('consumed', 1); scheduleExpiry();
    }
    function pruneUndo(at = now()) {
        let expired = 0, pendingFallbacksPreserved = 0;
        for (const [videoId, entry] of [...entries]) {
            if (entries.get(videoId) !== entry) continue;
            if (!Number.isFinite(entry.removedAt) || at - entry.removedAt >= ttl) {
                const admitted = generation, pending = readPending(videoId);
                if (generation !== admitted || entries.get(videoId) !== entry) return false;
                const keep = pending?.fallbackItem === entry.item && pending?.correlationId === entry.correlationId;
                entries.delete(videoId); generation++; expired++;
                if (keep) pendingFallbacksPreserved++; else {
                    const admittedRelease = generation; releaseRetained(entry.correlationId);
                    if (generation !== admittedRelease) return false;
                }
            }
        }
        const admitted = generation;
        onCounter('expired', expired); scheduleExpiry();
        if (expired) onExpired({ expired, remaining: entries.size, pendingFallbacksPreserved });
        return generation === admitted;
    }
    function rememberUndo(item, index, correlationId) {
        if (!item?.videoId) return;
        const token = readSession(), owner = generation;
        if (!isAdmitted(token) || !hasRetained(correlationId, item)) return;
        if (owner !== generation || !isAdmitted(token)) return;
        if (!pruneUndo() || !isAdmitted(token)) return;
        const admitted = generation, title = normalizeTitle(item.ariaLabel || ''), removedAt = now();
        if (generation !== admitted || !isAdmitted(token)) return;
        entries.set(String(item.videoId), Object.freeze({ videoId: String(item.videoId), correlationId, item,
            index: Math.max(0, Number.isFinite(index) ? Math.floor(index) : 0),
            title, removedAt }));
        generation++; onCounter('remembered', 1); scheduleExpiry();
    }
    function correlationFor(item) {
        if (!item?.videoId) return null;
        const key = String(item.videoId), entry = entries.get(key);
        if (entry?.item === item) return entry.correlationId;
        const pending = readPending(key);
        return pending?.fallbackItem === item ? pending.correlationId || null : null;
    }
    function latestUndo() {
        pruneUndo(); let latest = null;
        for (const entry of entries.values()) if (!latest || entry.removedAt > latest.removedAt) latest = entry;
        return latest;
    }
    return Object.freeze({ start, deferReconciliation, dispose,
        deferralDiagnostics: () => ({ cleanupFailures, active: [...deferrals.values()].filter(owner => isAdmitted(owner.token)).map(owner => owner.reason) }),
        observeMembership, queueMutation, reconcileMutation, disposeMutation, clearPending,
        scheduleMutationTimeout, retryMutations, deferPending, isMutationCurrent, pendingMutation: readPending,
        pendingIntents: () => Object.freeze([...pending.values()]), pendingDiagnostics,
        nextCorrelation: () => `undo:${readSession()}:${++sequence}`, rememberUndo, forgetUndo, pruneUndo, clearUndo, latestUndo, correlationFor,
        undoEntries: () => Object.freeze([...entries.values()]),
        undoDiagnostics: () => ({ entries: entries.size, expiryScheduled: Boolean(timer),
            nextExpiryInMs: timer ? Math.max(0, Math.round(timer.dueAt - now())) : null }) });
}
