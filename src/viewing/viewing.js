import { createCompletion, completionRatio } from './completion.js';
import { createChoices } from './choices.js';
import { createCache } from './cache.js';

// P16 supplies scan ownership; only normalized scan facts are borrowed here.
export function createViewing(options) {
    const completion = createCompletion(), cache = createCache(options), owners = new WeakMap();
    function owner(watch) {
        if (!owners.has(watch)) owners.set(watch, { choices: createChoices({ ...options, storageKey: options.choicesKey }),
            cached: { results: new Map(), types: new Map() }, cacheGeneration: 0 });
        return owners.get(watch);
    }
    function initialize(watch, items, profile, assertCurrent = () => {}) {
        const current = owner(watch), epoch = ++current.cacheGeneration;
        const cached = cache.read(items, profile, assertCurrent);
        assertCurrent();
        if (current.cacheGeneration !== epoch || options.activeProfile() !== profile) return 0;
        current.cached = cached;
        return cached.types.size;
    }
    function clearCache(watch) { const current = owner(watch); current.cacheGeneration++;
        current.cached = { results: new Map(), types: new Map() }; }
    function syncProfile(watch, assertCurrent = () => {}, onReset = () => {}) {
        return owner(watch).choices.sync(assertCurrent, () => { clearCache(watch); onReset(); assertCurrent(); });
    }
    function isProfileCurrent(watch) {
        const profile = owner(watch).choices.presentation().profile;
        return Boolean(profile) && options.activeProfile() === profile;
    }
    function automatic(watch, id) {
        return isProfileCurrent(watch) ? watch.results.get(id) || owner(watch).cached.results.get(id) || 'unknown' : 'unknown';
    }
    function titleType(watch, id) {
        return isProfileCurrent(watch) ? watch.types.get(id) || owner(watch).cached.types.get(id) || owner(watch).choices.type(id) : undefined;
    }
    function placement(watch, id) {
        if (!isProfileCurrent(watch)) return Object.freeze({ status: 'unknown', type: undefined, manual: false });
        const current = owner(watch), manual = current.choices.status(id);
        return Object.freeze({ status: manual ? manual === 'complete' ? 'complete' : 'in-progress'
            : watch.results.get(id) || current.cached.results.get(id) || 'unknown',
            type: watch.types.get(id) || current.cached.types.get(id) || current.choices.type(id), manual: Boolean(manual) });
    }
    function place(watch, id, { assertCurrent = () => {} } = {}) {
        const current = owner(watch), before = current.choices.presentation();
        assertCurrent();
        if (!before.profile || options.activeProfile() !== before.profile) return Object.freeze({ saved: false, changed: new Set() });
        const status = placement(watch, id).status === 'complete' ? 'main' : 'complete', auto = automatic(watch, id);
        const restoreAutomatic = auto !== 'unknown' && (auto === 'complete') === (status === 'complete');
        const coverage = status === 'complete' ? watch.seriesCoverage.get(id) || null : null;
        const choice = restoreAutomatic ? null : { status, type: titleType(watch, id) || 'unknown',
            coverage: coverage ? coverage.map(pair => [...pair]) : null };
        const result = current.choices.save(new Map([[id, choice]]), false, assertCurrent);
        return Object.freeze({ ...result, action: 'toggle', targetGroup: status === 'complete' ? 'watched' : 'main',
            automaticStatus: auto, placement: choice ? 'manual' : 'automatic', restoredAutomatic: result.saved && restoreAutomatic,
            manualMarkerVisible: current.choices.has(id), changedTitles: result.changed.size });
    }
    return Object.freeze({ ...completion, completionRatio, initialize, syncProfile, place, placement, automatic, titleType,
        choiceIds: watch => isProfileCurrent(watch) ? owner(watch).choices.ids() : Object.freeze([]),
        hasChoice: (watch, id) => isProfileCurrent(watch) && owner(watch).choices.has(id),
        manualStatus: (watch, id) => isProfileCurrent(watch) ? owner(watch).choices.status(id) : undefined,
        choice: (watch, id) => isProfileCurrent(watch) ? owner(watch).choices.choice(id) : null,
        presentation(watch) { const facts = owner(watch).choices.presentation();
            return Object.freeze({ ...facts, disabled: facts.disabled || !isProfileCurrent(watch) }); },
        reconcileCoverage: (watch, ids = null, assertCurrent = () => {}) => owner(watch).choices.reconcile(id => watch.seriesCoverage.get(id), ids, assertCurrent),
        clearCache, readCache: cache.read, writeCache: cache.write,
        invalidateCache(watch, id, { type = false } = {}) { const current = owner(watch); current.cacheGeneration++;
            (type ? current.cached.types : current.cached.results).delete(id); },
        cacheCount: watch => owner(watch).cached.types.size,
        cachedStatus: (watch, id) => isProfileCurrent(watch) ? owner(watch).cached.results.get(id) : undefined,
        cachedIds: watch => new Set([...owner(watch).cached.results.keys(), ...owner(watch).cached.types.keys()]),
        promoteCache(watch) { const current = owner(watch); current.cacheGeneration++; const cached = current.cached;
            for (const [id, status] of watch.results) cached.results.set(id, status);
            for (const [id, type] of watch.types) cached.types.set(id, type);
        }
    });
}
