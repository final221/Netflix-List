// Private membership-action lifetimes. Grid alone retains removal markup.
export function createMutations({ now, readSession, isSessionActive, setTimeout, clearTimeout, ttl,
    hasRetained, releaseRetained, normalizeTitle = String,
    isBlocked = () => false, applyMutation = null,
    readParent = () => null, canApply = () => false, assertSession = () => {}, isCancelled = () => false,
    createError = (code, message) => Object.assign(new Error(message), { code }),
    hasMember, refreshNative, observeNative,
    captureNative, hasMaterial, assertNative,
    readMembership, prepareRecords, readLayout, readVisible, sample = operation => operation(),
    hasCard, retireCard, canInsertCard, insertCard, readPage, writePage, updateCard,
    refreshMapping = () => {}, onReindexed = () => {}, onOrder = () => {}, onChanged = () => {},
    createCancelledError = () => createError('NATIVE_SOURCE_REPLACED', 'Mutation publication was replaced'),
    findFallback = () => null, observeChanges = () => null, queueMicrotask = () => {},
    mutationTimeout = 1800, onQueued = () => {}, onTimeout = () => {},
    onCounter = () => {}, onExpired = () => {} }) {
    let entries = new Map(), timer = null, generation = 0;
    let pending = new Map(), sequence = 0;
    let publicationGeneration = 0;
    let deferralEpoch = 0, disposedToken = null, cleanupFailures = 0;
    const undoWork = { remembered: 0, expired: 0, consumed: 0, cleared: 0, schedules: 0, expiryCallbacks: 0 };
    function recordCounter(name, amount) { undoWork[name] += amount; onCounter(name, amount); }
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
        deferrals.clear(); deferralEpoch++; sequence++; generation++; publicationGeneration++; disposedToken = readSession();
        if (oldTimer) cleanup(() => clearTimeout(oldTimer.id));
        cleanup(() => recordCounter('cleared', oldEntries.size));
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
                const changed = call(remove, videoId, reason, { assertCurrent: guard });
                if (!changed && !call(hasMember, videoId)) { disposeMutation(videoId, intent); return true; }
                if (!changed) return false;
                live = call(refreshNative) || live;
                if (live?.track) call(reconcileOrder, live, { assertCurrent: guard });
                disposeMutation(videoId, intent); return true;
            }
            if (call(hasMember, videoId)) { disposeMutation(videoId, intent); return true; }
            const nativeItem = call(captureNative, videoId, live);
            const candidate = nativeItem || intent.fallbackItem || call(findFallback, videoId);
            const correlationId = candidate === intent.fallbackItem ? intent.correlationId : null;
            if (!call(hasMaterial, candidate, correlationId)) return false;
            const index = nativeItem ? call(preferredIndex, videoId, live, { assertCurrent: guard })
                : (Number.isFinite(intent.preferredIndex) ? intent.preferredIndex : 0);
            call(assertNative, live);
            const changed = call(add, candidate, index, nativeItem ? reason + '-native' : reason + '-captured', correlationId, { assertCurrent: guard });
            if (changed || call(hasMember, videoId)) {
                live = call(refreshNative) || live;
                // Retained Undo material can be restored before Netflix mounts the
                // title again. That incomplete native window cannot supersede its
                // saved insertion position. A mounted candidate can supply order.
                if (live?.track && (nativeItem || !correlationId)) call(reconcileOrder, live, { assertCurrent: guard });
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
    function observeClick(readFacts) {
        const token = readSession(), parent = readParent(), owner = sequence, undoOwner = generation;
        const admitted = () => isAdmitted(token) && readParent() === parent && sequence === owner;
        if (!admitted() || !canApply() || !admitted()) return null;
        const facts = readFacts();
        if (!admitted() || generation !== undoOwner) return null;
        let descriptor;
        if (facts?.membership?.videoId) {
            const { videoId, uia, uiaAction } = facts.membership;
            // Netflix's Undo control can advertise remove while restoring an absent title.
            const present = hasMember(videoId);
            if (!admitted() || generation !== undoOwner) return null;
            // Before publication, explicit native removal is the available proof.
            // An accepted empty membership still means Add, including native Undo.
            const remove = present == null ? uiaAction === 'remove' : Boolean(present);
            descriptor = { videoId, uia, uiaAction, action: remove ? 'remove' : 'add' };
        } else if (facts?.toastAction) {
            const entry = latestUndo();
            if (!entry || !admitted()) return null;
            descriptor = { videoId: entry.videoId, action: 'add', uiaAction: 'undo', uia: 'toast-undo',
                fallbackItem: entry.item, correlationId: entry.correlationId, preferredIndex: entry.index, undo: true };
        }
        if (!descriptor || !admitted()) return null;
        return queueMutation(descriptor);
    }
    function queueMutation(descriptor) {
        if (!descriptor?.videoId) return null;
        const token = readSession(), owner = sequence, parent = readParent();
        const fallbackItem = descriptor.action === 'add' ? (descriptor.fallbackItem || findFallback(String(descriptor.videoId))) : null;
        if (sequence !== owner || !isAdmitted(token) || readParent() !== parent) return null;
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
        recordCounter('schedules', 1);
        if (timer !== owner) return;
        owner.id = setTimeout(() => {
            if (timer !== owner) return;
            timer = null;
            if (!isAdmitted(owner.token)) return;
            recordCounter('expiryCallbacks', 1); pruneUndo();
        }, Math.max(0, dueAt - now()));
        if (timer !== owner) clearTimeout(owner.id);
    }
    function clearUndo() {
        const old = entries; entries = new Map(); generation++; cancelExpiry();
        recordCounter('cleared', old.size);
        for (const entry of old.values()) releaseRetained(entry.correlationId);
    }
    function forgetUndo(videoId) {
        const key = String(videoId), entry = entries.get(key);
        if (!entries.delete(key)) return;
        generation++;
        releaseRetained(entry.correlationId); recordCounter('consumed', 1); scheduleExpiry();
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
        recordCounter('expired', expired); scheduleExpiry();
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
        generation++; recordCounter('remembered', 1); scheduleExpiry();
    }
    function correlationFor(item) {
        if (!item?.videoId) return null;
        const key = String(item.videoId), entry = entries.get(key);
        if (entry?.item === item) return entry.correlationId;
        const pending = readPending(key);
        return pending?.fallbackItem === item ? pending.correlationId || null : null;
    }
    function latestUndo() {
        if (!pruneUndo()) return null;
        let latest = null;
        for (const entry of entries.values()) if (!latest || entry.removedAt > latest.removedAt) latest = entry;
        return latest;
    }
    function nextCorrelation() { return `undo:${readSession()}:${++sequence}`; }
    function publicationOwner({ assertCurrent = () => {} } = {}) {
        const token = readSession(), parent = readParent();
        if (!isAdmitted(token) || !parent) return null;
        const epoch = ++publicationGeneration;
        const parentGuard = () => {
            assertSession(token); assertCurrent();
            if (!isAdmitted(token) || readParent() !== parent || publicationGeneration !== epoch) throw createCancelledError();
        };
        parentGuard();
        const membership = readMembership(parent); parentGuard();
        let records = membership.records, revision = membership.revision;
        const guard = () => {
            parentGuard();
            if (membership.records !== records || membership.revision !== revision) throw createCancelledError();
        };
        return { membership, parent, guard, call(operation, ...args) { guard(); const result = operation(...args); guard(); return result; },
            accept(operation) { guard(); const result = operation(); parentGuard(); records = membership.records; revision = membership.revision; guard(); return result; } };
    }
    function reindexOwned(owner, reason) {
        const { membership, guard, parent } = owner, records = membership.records;
        const layout = owner.call(readLayout, parent);
        const assertLayout = () => { guard(); layout.assertCurrent(); guard(); };
        const columns = Math.max(1, layout.columns || 1), logical = layout.mode === 'logical';
        owner.call(sample, () => records.forEach((record, index) => {
            assertLayout();
            if (!logical || reason === 'mutation-reindex' || !Number.isFinite(owner.call(readPage, record))) {
                owner.call(writePage, record, Math.floor(index / columns), { parent, assertCurrent: assertLayout });
            }
            owner.call(updateCard, record, index, { parent, assertCurrent: assertLayout });
            assertLayout();
        }));
        assertLayout();
        owner.accept(() => membership.observeCount({ totalCount: records.length, collectedCount: records.length }, { assertCurrent: assertLayout }));
        if (logical) owner.call(refreshMapping, reason, { parent, assertCurrent: guard });
        owner.call(onReindexed, Object.freeze({ records, count: records.length, empty: records.length === 0, logical, reason }), { parent, assertCurrent: guard });
    }
    function reindex(reason = 'delta-reindex', admission = {}) {
        const owner = publicationOwner(admission); if (!owner) return false;
        reindexOwned(owner, reason); return true;
    }
    function remove(videoId, reason = 'click-delta', admission = {}) {
        const owner = publicationOwner(admission); if (!owner) return false;
        const { membership, guard, parent } = owner, key = 'v:' + videoId;
        const record = membership.lookup.get(key); if (!record) return false;
        const index = membership.records.indexOf(record);
        const correlationId = owner.call(hasCard, record) ? nextCorrelation() : null;
        let accepted = false;
        try {
            owner.call(retireCard, record, { correlationId, parent, assertCurrent: guard, onAccepted() {
                if (accepted) { guard(); return; }
                owner.accept(() => membership.remove(key, { assertCurrent: guard })); accepted = true;
            } });
            if (!accepted) throw createError('LIST_PUBLICATION_REJECTED', 'Card retirement did not accept membership');
            owner.call(rememberUndo, record, index, correlationId);
            reindexOwned(owner, 'mutation-reindex');
            owner.call(onChanged, Object.freeze({ kind: 'remove', reason, record, index, count: membership.records.length }), { parent, assertCurrent: guard });
            return true;
        } finally {
            const entry = entries.get(String(record.videoId)), intent = readPending(record.videoId);
            const retained = (entry?.item === record && entry?.correlationId === correlationId) ||
                (intent?.fallbackItem === record && intent?.correlationId === correlationId);
            if (correlationId && !retained) cleanup(() => releaseRetained(correlationId));
        }
    }
    function add(input, preferred = 0, reason = 'click-delta', correlationId = correlationFor(input), admission = {}) {
        const owner = publicationOwner(admission); if (!owner || !input?.videoId) return false;
        const { membership, guard, parent } = owner;
        if (!owner.call(hasMaterial, input, correlationId) || membership.lookup.has('v:' + input.videoId)) return false;
        if (!owner.call(canInsertCard, { parent, assertCurrent: guard })) return false;
        const index = Math.max(0, Math.min(membership.records.length, Number.isFinite(preferred) ? Math.floor(preferred) : 0));
        guard();
        const transfer = prepareRecords([input], { assertCurrent: guard });
        let record, accepted = false;
        try {
            guard();
            record = transfer.records[0];
            const layout = owner.call(readLayout, parent, { positionOnly: true });
            const assertLayout = () => { guard(); layout.assertCurrent(); guard(); };
            assertLayout();
            const page = Math.floor(index / Math.max(1, layout.columns || 1));
            owner.call(insertCard, record, { index, correlationId, parent, page, material: transfer.readMaterial(record),
                releaseMaterial: transfer.release, assertCurrent: assertLayout,
                onAccepted() {
                    if (accepted) { assertLayout(); return; }
                    owner.call(writePage, record, page, { parent, assertCurrent: assertLayout });
                    owner.accept(() => membership.insert(record, index, { assertCurrent: assertLayout })); accepted = true;
                } });
            if (!accepted) throw createError('LIST_PUBLICATION_REJECTED', 'Card insertion did not accept membership');
        } finally { transfer.discard(); }
        owner.call(forgetUndo, record.videoId);
        reindexOwned(owner, 'mutation-reindex');
        owner.call(onChanged, Object.freeze({ kind: 'add', reason, record, index, count: membership.records.length }), { parent, assertCurrent: guard });
        return true;
    }
    function visibleFacts(owner, live, options = {}) {
        const facts = owner.call(readVisible, live, owner.parent, options);
        owner.call(facts.assertCurrent); return facts;
    }
    function preferredIndex(videoId, live, admission = {}) {
        const owner = publicationOwner(admission); if (!owner) return 0;
        const facts = visibleFacts(owner, live), position = facts.ids.indexOf(String(videoId));
        if (position < 0) return 0;
        const columns = Math.max(1, facts.columns || facts.ids.length || 1);
        return Math.min(owner.membership.records.length, (facts.page || 0) * columns + position);
    }
    function reconcileOrder(live, admission = {}) {
        const owner = publicationOwner(admission); if (!owner || !owner.membership.records.length) return false;
        const facts = visibleFacts(owner, live, { order: true }); if (!facts.available) return false;
        const { membership, guard, parent } = owner;
        const columns = Math.max(1, facts.columns || facts.ids.length || 1);
        const base = Math.min(membership.records.length, (facts.page || 0) * columns);
        const assertVisible = () => { guard(); facts.assertCurrent(); guard(); };
        const change = owner.accept(() => membership.alignVisible(facts.ids, base, { assertCurrent: assertVisible }));
        if (!change) return false;
        owner.call(onOrder, change, { parent, assertCurrent: assertVisible });
        assertVisible(); reindexOwned(owner, 'delta-reindex');
        // Native remapping may retire the consumed observation; publication now
        // follows the accepted membership owner rather than that old receipt.
        owner.call(onChanged, Object.freeze({ kind: 'order', page: facts.page, ids: Object.freeze([...facts.ids]) }), { parent, assertCurrent: guard });
        return true;
    }
    return Object.freeze({ start, deferReconciliation, dispose,
        workDiagnostics: () => ({ ...undoWork }),
        deferralDiagnostics: () => ({ cleanupFailures, active: [...deferrals.values()].filter(owner => isAdmitted(owner.token)).map(owner => owner.reason) }),
        observeMembership, observeClick, queueMutation, reconcileMutation, disposeMutation, clearPending,
        remove, add, reindex, preferredIndex, reconcileOrder,
        scheduleMutationTimeout, retryMutations, deferPending, isMutationCurrent, pendingMutation: readPending,
        pendingIntents: () => Object.freeze([...pending.values()]), pendingDiagnostics,
        nextCorrelation, rememberUndo, forgetUndo, pruneUndo, clearUndo, latestUndo, correlationFor,
        undoEntries: () => Object.freeze([...entries.values()]),
        undoDiagnostics: () => ({ entries: entries.size, expiryScheduled: Boolean(timer),
            nextExpiryInMs: timer ? Math.max(0, Math.round(timer.dueAt - now())) : null }) });
}
