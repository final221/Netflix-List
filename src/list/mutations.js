// Private membership-action lifetimes. Grid alone retains removal markup.
export function createMutations({ now, readSession, isSessionActive, setTimeout, clearTimeout, ttl,
    hasRetained, releaseRetained, readPending = () => null, normalizeTitle = String,
    onCounter = () => {}, onExpired = () => {} }) {
    let entries = new Map(), timer = null, generation = 0;
    function cancelExpiry() {
        const old = timer; timer = null;
        if (old) clearTimeout(old.id);
    }
    function scheduleExpiry() {
        let dueAt = Infinity;
        for (const entry of entries.values()) dueAt = Math.min(dueAt, entry.removedAt + ttl);
        const token = readSession();
        if (!Number.isFinite(dueAt) || !isSessionActive(token)) { cancelExpiry(); return; }
        if (timer?.dueAt === dueAt && timer.token === token) return;
        cancelExpiry();
        const owner = { id: null, token, dueAt }; timer = owner;
        onCounter('schedules', 1);
        if (timer !== owner) return;
        owner.id = setTimeout(() => {
            if (timer !== owner) return;
            timer = null;
            if (!isSessionActive(owner.token)) return;
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
        if (!isSessionActive(token) || !hasRetained(correlationId, item)) return;
        if (owner !== generation || !isSessionActive(token)) return;
        if (!pruneUndo() || !isSessionActive(token)) return;
        const admitted = generation, title = normalizeTitle(item.ariaLabel || ''), removedAt = now();
        if (generation !== admitted || !isSessionActive(token)) return;
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
    return Object.freeze({ rememberUndo, forgetUndo, pruneUndo, clearUndo, latestUndo, correlationFor,
        ownsUndoCorrelation: (videoId, id) => entries.get(String(videoId))?.correlationId === id,
        undoEntries: () => Object.freeze([...entries.values()]),
        undoDiagnostics: () => ({ entries: entries.size, expiryScheduled: Boolean(timer),
            nextExpiryInMs: timer ? Math.max(0, Math.round(timer.dueAt - now())) : null }) });
}
