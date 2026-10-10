import { createCompletion, completionRatio } from './completion.js';
import { createChoices } from './choices.js';
import { createCache } from './cache.js';
import { createScan } from './scan.js';
export { createBrowsingViewing } from './browsing.js';

// Internal policy access stays inside the viewing capability.
function createPolicy(options) {
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
        retire: watch => owner(watch).choices.retire(),
        fork(from, to) { const current = owner(from); owners.set(to, { choices: current.choices.fork(),
            cached: { results: new Map(current.cached.results), types: new Map(current.cached.types) }, cacheGeneration: 0 }); },
        choiceIds: watch => isProfileCurrent(watch) ? owner(watch).choices.ids() : Object.freeze([]),
        hasChoice: (watch, id) => isProfileCurrent(watch) && owner(watch).choices.has(id),
        manualStatus: (watch, id) => isProfileCurrent(watch) ? owner(watch).choices.status(id) : undefined,
        choice: (watch, id) => isProfileCurrent(watch) ? owner(watch).choices.choice(id) : null,
        presentation(watch) { const facts = owner(watch).choices.presentation();
            return Object.freeze({ ...facts, disabled: facts.disabled || !isProfileCurrent(watch) }); },
        reconcileCoverage: (watch, ids = null, assertCurrent = () => {}) => owner(watch).choices.reconcile(id => watch.seriesCoverage.get(id), ids, assertCurrent),
        clearCache, writeCache: cache.write,
        invalidateCache(watch, id, { type = false } = {}) { const current = owner(watch); current.cacheGeneration++;
            (type ? current.cached.types : current.cached.results).delete(id); },
        cacheCount: watch => owner(watch).cached.types.size, cacheResultCount: watch => owner(watch).cached.results.size,
        cachedStatus: (watch, id) => isProfileCurrent(watch) ? owner(watch).cached.results.get(id) : undefined,
        cachedIds: watch => new Set([...owner(watch).cached.results.keys(), ...owner(watch).cached.types.keys()]),
        promoteCache(watch) { const current = owner(watch); current.cacheGeneration++; const cached = current.cached;
            for (const [id, status] of watch.results) cached.results.set(id, status);
            for (const [id, type] of watch.types) cached.types.set(id, type);
        }
    });
}


export function createViewing(options) {
    const policy = createPolicy(options), sessions = new WeakMap();
    function resolve(session) {
        const owned = sessions.get(session);
        if (!owned) throw new Error('VIEWING_SESSION_INVALID');
        return owned;
    }
    function createSession(config) {
        const session = Object.freeze({}), watch = { results: new Map(), types: new Map(), seriesDetails: new Map(),
            seriesCoverage: new Map(), loading: false, failure: null, requests: 0, passes: 0, publications: 0,
            profileGuid: options.activeProfile(), network: null, cachedTitles: 0, promise: null };
        if (config.previous && sessions.has(config.previous)) {
            const previous = resolve(config.previous).watch;
            for (const key of ['results', 'types']) watch[key] = new Map(previous[key]);
            watch.seriesDetails = new Map([...previous.seriesDetails].map(([id, summary]) => [id, JSON.parse(JSON.stringify(summary))]));
            watch.seriesCoverage = new Map([...previous.seriesCoverage].map(([id, coverage]) => [id, coverage.map(pair => [...pair])]));
            for (const key of ['requests', 'passes', 'publications', 'profileGuid', 'failure', 'cachedTitles']) watch[key] = previous[key];
            watch.network = !previous.loading && previous.network ? { ...previous.network } : null;
            policy.fork(previous, watch);
        }
        const scan = createScan({ ...options, ...config, watch, viewing: policy,
            scanLimits: typeof options.scanLimits === 'function' ? options.scanLimits() : options.scanLimits });
        sessions.set(session, { watch, scan }); return session;
    }
    function read(session, operation, ...args) { const { watch } = resolve(session); return policy[operation](watch, ...args); }
    return Object.freeze({ createSession,
        assertCurrent: session => resolve(session).scan.guard(),
        start: session => resolve(session).scan.start(), refresh: session => resolve(session).scan.refresh(),
        settled: session => resolve(session).scan.settled(), dispose(session) { if (sessions.has(session)) resolve(session).scan.dispose(); },
        reconcile: (session, ids = null) => resolve(session).scan.reconcile(ids),
        diagnostics: session => resolve(session).scan.diagnostics(), seriesDiagnostics: session => resolve(session).scan.seriesDiagnostics(),
        freshStatus: (session, id) => resolve(session).scan.freshStatus(id), freshType: (session, id) => resolve(session).scan.freshType(id),
        placement: (session, id) => read(session, 'placement', id), titleType: (session, id) => read(session, 'titleType', id),
        automatic: (session, id) => read(session, 'automatic', id), hasChoice: (session, id) => read(session, 'hasChoice', id),
        choice: (session, id) => read(session, 'choice', id), choiceIds: session => read(session, 'choiceIds'),
        presentation(session) { return Object.freeze({ ...read(session, 'presentation'), loading: resolve(session).scan.diagnostics().loading }); },
        place(session, id, { assertCurrent = () => {} } = {}) {
            const { scan, watch } = resolve(session); const guard = () => { scan.guard(); assertCurrent(); scan.guard(); };
            return policy.place(watch, id, { assertCurrent: guard });
        }
    });
}
