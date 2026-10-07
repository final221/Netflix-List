export function createChoices({ activeProfile, getValue, setValue,
    limits = { seasons: 40, episodes: 500 }, storageKey = 'legacyMyListForNetflix.viewingChoices.v1.', initial = null }) {
    let profile = initial?.profile, choices = initial?.choices || new Map(), failure = initial?.failure || false, generation = 0;
    function validViewingCoverage(value) {
        return Array.isArray(value) && value.length > 0 && value.length <= limits.seasons &&
            value.every(pair => Array.isArray(pair) && pair.length === 2 && /^\d+$/.test(pair[0]) &&
                Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= limits.episodes) &&
            new Set(value.map(pair => pair[0])).size === value.length &&
            value.reduce((sum, pair) => sum + pair[1], 0) > 0 &&
            value.reduce((sum, pair) => sum + pair[1], 0) <= limits.episodes;
    }

    function readManualViewingChoices(profile) {
        if (typeof getValue !== 'function' || typeof setValue !== 'function') throw new Error('storage-unavailable');
        const choices = new Map();
        const stored = getValue(storageKey + encodeURIComponent(profile), null);
        if (stored == null) return choices;
        if (stored.version !== 1 || !stored.choices || typeof stored.choices !== 'object' ||
            Array.isArray(stored.choices) || Object.keys(stored.choices).length > 5000) throw new Error('invalid-storage');
        for (const [id, choice] of Object.entries(stored.choices)) {
            if (!/^\d+$/.test(id) || !choice || !['complete', 'main'].includes(choice.status) ||
                !['movie', 'series', 'unknown'].includes(choice.type) ||
                (choice.coverage !== null && !validViewingCoverage(choice.coverage))) continue;
            choices.set(id, { status: choice.status, type: choice.type,
                coverage: choice.coverage ? choice.coverage.map(pair => [...pair]) : null });
        }
        return choices;
    }

    function changedManualViewingIds(previous, next) {
        const changed = new Set();
        for (const id of new Set([...previous.keys(), ...next.keys()])) {
            if (JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id))) changed.add(id);
        }
        return changed;
    }
    function guard(expected, epoch, assertCurrent) {
        assertCurrent();
        if (profile !== expected || generation !== epoch || activeProfile() !== expected) throw new Error('viewing-owner-replaced');
    }
    function sync(assertCurrent = () => {}, onReset = () => {}) {
        assertCurrent();
        const raw = activeProfile(), next = typeof raw === 'string' && raw ? raw : null;
        if (profile === next) return { changed: false, reset: false };
        const reset = profile !== undefined;
        profile = next; choices = new Map(); failure = false;
        const epoch = ++generation;
        if (reset) { onReset(); assertCurrent(); }
        if (next) try {
            guard(next, epoch, assertCurrent);
            const loaded = readManualViewingChoices(next);
            guard(next, epoch, assertCurrent); choices = loaded;
        } catch (_) { if (profile === next && generation === epoch) failure = true; }
        assertCurrent();
        return { changed: true, reset };
    }
    function save(changes, conditional, assertCurrent) {
        const expected = profile, epoch = ++generation;
        try {
            if (!expected) throw new Error('storage-unavailable');
            guard(expected, epoch, assertCurrent);
            const latest = readManualViewingChoices(expected);
            guard(expected, epoch, assertCurrent);
            let applied = false;
            for (const [id, choice] of changes) {
                if (conditional && JSON.stringify(latest.get(id)) !== JSON.stringify(choices.get(id))) continue;
                if (choice) latest.set(id, choice); else latest.delete(id);
                applied = true;
            }
            if (latest.size > 5000) throw new Error('storage-full');
            guard(expected, epoch, assertCurrent);
            if (applied) setValue(storageKey + encodeURIComponent(expected), { version: 1, choices: Object.fromEntries(latest) });
            guard(expected, epoch, assertCurrent);
            const changed = changedManualViewingIds(choices, latest);
            choices = latest; failure = false;
            return { saved: true, changed };
        } catch (_) {
            const admitted = profile === expected && generation === epoch && activeProfile() === expected;
            if (admitted) failure = true;
            return { saved: false, changed: new Set(), admitted };
        }
    }
    function reconcile(coverageFor, ids = null, assertCurrent = () => {}) {
        const changes = new Map(), expected = profile;
        for (const id of ids === null ? choices.keys() : ids) {
            const choice = choices.get(id), coverage = coverageFor(id);
            if (!choice || choice.status !== 'complete' || !coverage || !validViewingCoverage(coverage)) continue;
            if (!choice.coverage) changes.set(id, { ...choice, type: 'series', coverage: coverage.map(pair => [...pair]) });
            else {
                const previous = new Map(choice.coverage);
                if (coverage.some(([season, count]) => count > 0 && (!previous.has(season) || count > previous.get(season)))) changes.set(id, null);
            }
        }
        if (!changes.size) return new Set();
        const result = save(changes, true, assertCurrent);
        if (result.saved) return result.changed;
        assertCurrent();
        if (!result.admitted || profile !== expected || activeProfile() !== expected) return new Set();
        // Reliable new episodes remain visible even if saving expiry fails.
        for (const [id, choice] of changes) { if (choice) choices.set(id, choice); else choices.delete(id); }
        return new Set(changes.keys());
    }
    function choice(id) {
        const value = choices.get(id);
        return value ? Object.freeze({ ...value, coverage: value.coverage ? Object.freeze(value.coverage.map(pair => Object.freeze([...pair]))) : null }) : null;
    }
    return Object.freeze({ sync, save, reconcile, choice,
        retire() { generation++; profile = undefined; choices = new Map(); failure = false; },
        fork() { return createChoices({ activeProfile, getValue, setValue, limits, storageKey,
            initial: { profile, failure, choices: new Map([...choices.keys()].map(id => [id, choice(id)])) } }); },
        has: id => choices.has(id), status: id => choices.get(id)?.status, type: id => choices.get(id)?.type,
        ids: () => Object.freeze([...choices.keys()]),
        presentation: () => Object.freeze({ profile, manualFailure: failure, disabled: !profile || failure }) });
}
