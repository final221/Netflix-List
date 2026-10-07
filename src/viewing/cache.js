import { completionRatio } from './completion.js';

export function createCache({ activeProfile, now, getValue, setValue,
    storageKey = 'legacyMyListForNetflix.viewingCache.v1.', maxAge = 6 * 60 * 60 * 1000 }) {
    function read(items, profile, assertCurrent = () => {}) {
        const cached = { results: new Map(), types: new Map() };
        if (!profile || typeof getValue !== 'function') return cached;
        try {
            assertCurrent();
            if (activeProfile() !== profile) return cached;
            const stored = getValue(storageKey + encodeURIComponent(profile), null);
            assertCurrent();
            if (activeProfile() !== profile) return cached;
            const age = now() - stored?.savedAt;
            if (stored?.version !== 1 || stored.completionRatio !== completionRatio ||
                !Number.isFinite(stored.savedAt) || age < 0 || age > maxAge ||
                !stored.entries || typeof stored.entries !== 'object' || Array.isArray(stored.entries) ||
                Object.keys(stored.entries).length > 5000) return cached;
            for (const item of items || []) {
                const id = String(item.videoId), entry = stored.entries[id];
                if (!/^\d+$/.test(id) || !Array.isArray(entry) || entry.length !== 2 ||
                    !['movie', 'series'].includes(entry[0]) ||
                    !['complete', 'in-progress', 'not-started', 'unknown'].includes(entry[1])) continue;
                cached.types.set(id, entry[0]); cached.results.set(id, entry[1]);
            }
        } catch (_) { /* Optional reuse cannot block publication. */ }
        return cached;
    }
    function write({ items, profile, results, types, assertCurrent = () => {} }) {
        if (typeof setValue !== 'function') return false;
        try {
            assertCurrent();
            if (!profile || activeProfile() !== profile) return false;
            const entries = {};
            for (const item of items || []) {
                const id = String(item.videoId), type = types.get(id);
                if (/^\d+$/.test(id) && ['movie', 'series'].includes(type)) entries[id] = [type, results.get(id) || 'unknown'];
            }
            if (Object.keys(entries).length > 5000) return false;
            assertCurrent();
            if (activeProfile() !== profile) return false;
            setValue(storageKey + encodeURIComponent(profile), { version: 1, completionRatio, savedAt: now(), entries });
            assertCurrent(); return activeProfile() === profile;
        } catch (_) { return false; }
    }
    return Object.freeze({ read, write });
}
