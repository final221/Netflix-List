import { KNOWLEDGE_PREFIX, legacyFacts, validChoice, validCoverage, titleName } from './knowledge-migration.js';

// One application-lifetime storage adapter. Signals are invalidations, never indexes.
export function createKnowledgeStorage(options) {
    const { getValue, setValue, listValues, addValueChangeListener, removeValueChangeListener } = options;
    const known = new Map(), migrated = new Set(), listeners = new Map(), deniedSubscriptions = new Set();
    const stats = { imports: 0, writes: 0, notificationFailures: 0, invalidRecords: 0 };
    let sequence = 0;
    const prefix = profile => KNOWLEDGE_PREFIX + encodeURIComponent(profile) + '.';
    function requireStorage() { if (typeof getValue !== 'function' || typeof setValue !== 'function') throw new Error('storage-unavailable'); }
    function remember(profile, key) { if (!known.has(profile)) known.set(profile, new Set()); known.get(profile).add(key); }
    function signal(profile) {
        try { setValue(prefix(profile) + 'signal', { sequence: ++sequence, nonce: Math.random().toString(36), at: Date.now() }); }
        catch (_) { stats.notificationFailures++; }
    }
    function write(profile, id, kind, value, guard = () => {}, onlyMissing = false) {
        requireStorage(); const key = prefix(profile) + id + '.' + kind;
        guard(); const prior = getValue(key, null); guard();
        if (onlyMissing && prior !== null) { remember(profile, key); return false; }
        if (JSON.stringify(prior) === JSON.stringify(value)) { remember(profile, key); return false; }
        // Distinct episode snapshots are retained independently: racing tabs cannot erase
        // a larger observed coverage or its completion by writing a smaller snapshot last.
        if (['metadata', 'completion'].includes(kind) && validCoverage(value.coverage)) {
            const identity = [...value.coverage].sort(([a], [b]) => a.localeCompare(b)).map(pair => pair.join('-')).join('_');
            const evidenceKey = prefix(profile) + id + '.' + kind + '_' + identity;
            guard(); const evidence = getValue(evidenceKey, null); guard();
            if (!evidence) { setValue(evidenceKey, value); guard(); stats.writes++; }
            remember(profile, evidenceKey);
        }
        setValue(key, value); guard(); remember(profile, key); stats.writes++; return true;
    }
    function migrate(profile, guard) {
        if (migrated.has(profile)) return;
        requireStorage(); guard();
        const marker = prefix(profile) + 'migrated';
        const done = getValue(marker, false); guard();
        if (done !== true && done !== false && done !== null) throw new Error('invalid-storage');
        if (!done) {
            const facts = legacyFacts(profile, getValue, guard, options);
            for (const [id, kind, value] of facts) if (write(profile, id, kind, value, guard, true)) stats.imports++;
            guard(); setValue(marker, true); guard();
        }
        migrated.add(profile);
    }
    function read(profile, guard = () => {}) {
        migrate(profile, guard);
        guard(); const keys = typeof listValues === 'function' ? listValues() : [...(known.get(profile) || [])]; guard();
        const records = new Map(), start = prefix(profile);
        for (const key of keys) {
            if (!key.startsWith(start)) continue;
            const match = key.slice(start.length).match(/^(\d+)\.(manual|completion(?:_[0-9_-]+)?|metadata(?:_[0-9_-]+)?|label|hidden|legacy)$/);
            if (!match) continue;
            guard(); const value = getValue(key, null); guard();
            if (!value || typeof value !== 'object' || Array.isArray(value)) { stats.invalidRecords++; continue; }
            if (!records.has(match[1])) records.set(match[1], {});
            const kind = match[2];
            const valid = kind === 'manual' ? validChoice(value) : kind.startsWith('completion')
                ? ['movie', 'series'].includes(value.type) && Number.isFinite(value.observedAt) && (value.coverage === null || validCoverage(value.coverage))
                : kind.startsWith('metadata') ? ['movie', 'series'].includes(value.type) && (value.coverage === null || validCoverage(value.coverage))
                : kind === 'hidden' ? typeof value.hidden === 'boolean' : kind === 'legacy' ? value.watched === true : Boolean(titleName(value.name));
            if (!valid) { stats.invalidRecords++; continue; }
            records.get(match[1])[kind] = value; remember(profile, key);
        }
        return records;
    }
    function subscribe(profile, callback) {
        if (typeof addValueChangeListener !== 'function' || typeof removeValueChangeListener !== 'function' || deniedSubscriptions.has(profile)) return null;
        let handle;
        try { handle = addValueChangeListener(prefix(profile) + 'signal', callback); }
        catch (_) { stats.notificationFailures++; deniedSubscriptions.add(profile); return null; }
        listeners.set(handle, true);
        return () => { if (!listeners.delete(handle)) return; try { removeValueChangeListener?.(handle); } catch (_) { stats.notificationFailures++; } };
    }
    function dispose() {
        const retired = [...listeners.keys()]; listeners.clear();
        for (const handle of retired) try { removeValueChangeListener?.(handle); } catch (_) { stats.notificationFailures++; }
    }
    return { read, write, signal, subscribe, dispose, signature(profile) { requireStorage(); return JSON.stringify(getValue(prefix(profile) + 'signal', null)); }, diagnostics: () => ({ ...stats, listeners: listeners.size }) };
}
