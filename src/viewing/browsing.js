import { createChoices } from './choices.js';
import { createCompletion } from './completion.js';
import { createViewingData } from '../netflix/viewing-data.js';

// Browsing shares manual viewing policy/storage; metadata transport stays in viewing-data.
export function createBrowsingViewing({ environment, context, userscript, isCurrent, onChange, data,
    log = () => {}, warn = () => {} }) {
    const choices = createChoices({ activeProfile: () => context.activeProfile(),
        getValue: (...args) => userscript.getValue(...args), setValue: (...args) => userscript.setValue(...args) });
    const completion = createCompletion();
    const cancelled = () => new Error('BROWSING_VIEWING_RETIRED');
    data ||= createViewingData({ context, fetch: (...args) => environment.fetch(...args), createCancelledError: cancelled });
    let generation = 0, profile = null, running = false, stopped = false, requests = 0, controller = null, timer = null;
    const types = new Map(), coverage = new Map(), pending = new Set(), checked = new Set();
    function guard(owner = generation) {
        if (owner !== generation || !profile || context.activeProfile() !== profile || !isCurrent()) throw cancelled();
    }
    function dispose() {
        generation++; controller?.abort(); controller = null;
        if (timer !== null) environment.clearTimeout(timer); timer = null;
        profile = null; running = false; stopped = false; requests = 0;
        pending.clear(); checked.clear(); types.clear(); coverage.clear(); choices.retire();
    }
    function reset() {
        dispose(); profile = context.activeProfile(); choices.sync(() => guard());
    }
    function observe(items) {
        if (!profile) return false;
        let updated = false;
        const savedSeries = choices.ids().filter(id => choices.status(id) === 'complete' && choices.type(id) !== 'movie').map(id => ({ id }));
        for (const { id, typeHint } of [...items, ...savedSeries]) {
            if (typeHint === 'movie' && !types.has(id)) { types.set(id, 'movie'); pending.delete(id); checked.add(id); updated = true; }
            if (!stopped && !checked.has(id) && !pending.has(id) && !types.has(id) && checked.size + pending.size < 500) pending.add(id);
        }
        if (!running && pending.size) {
            running = true; const owner = generation;
            environment.queueMicrotask(() => { if (owner === generation) void run(owner); });
        }
        return updated;
    }
    async function request(read, owner) {
        guard(owner); if (++requests > 200) throw new Error('BROWSING_VIEWING_BUDGET');
        const access = data.beginRead();
        if (!access || access.profileGuid !== profile) throw new Error('VIEWING_STATUS_CONTEXT');
        const current = new environment.AbortController(); controller = current;
        timer = environment.setTimeout(() => current.abort(), 8000);
        try { const value = await read(access, { signal: current.signal, assertCurrent: () => guard(owner) }); guard(owner); return value; }
        finally { if (controller === current) { environment.clearTimeout(timer); timer = null; controller = null; } }
    }
    async function run(owner) {
        try {
            while (pending.size) {
                guard(owner);
                // At most five series * forty seasons fits the shared 200-season read budget.
                const ids = [...pending].slice(0, 5); ids.forEach(id => { pending.delete(id); checked.add(id); });
                const records = await request((access, handle) => data.readTitles(ids, access, handle), owner);
                const series = [];
                for (const id of ids) {
                    const record = records.get(id), type = completion.recordType(record);
                    if (type) types.set(id, type);
                    if (type === 'series') series.push(record);
                }
                if (series.length) {
                    const plans = await request((access, handle) => data.readSeasons(series, access, handle), owner);
                    for (const plan of plans) coverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
                    const expired = choices.reconcile(id => coverage.get(id), ids, () => guard(owner));
                    if (expired.size) log('Browsing viewing coverage reconciled', { changed: expired.size });
                }
                guard(owner); onChange(); guard(owner);
            }
        } catch (error) {
            if (owner === generation && profile && isCurrent()) {
                stopped = true; pending.clear(); warn('Browsing viewing metadata unavailable', { reason: error.message, requests }); onChange();
            }
        } finally { if (owner === generation) running = false; }
    }
    function type(id) { return types.get(id) || choices.type(id); }
    function ready(id) { return type(id) === 'movie' || type(id) === 'series' && coverage.has(id); }
    function mark(id) {
        guard(); if (!ready(id)) return { saved: false };
        return choices.save(new Map([[id, { status: 'complete', type: type(id), coverage: coverage.get(id) || null }]]), false, () => guard());
    }
    function restore(id) {
        guard(); return choices.save(new Map([[id, { status: 'main', type: type(id) || 'unknown', coverage: null }]]), false, () => guard());
    }
    return Object.freeze({ reset, dispose, observe, type, ready, mark, restore,
        complete: id => choices.status(id) === 'complete',
        choice: choices.choice, ids: () => choices.ids().filter(id => choices.status(id) === 'complete'),
        presentation: choices.presentation, diagnostics: () => ({ requests, checked: checked.size, pending: pending.size, running, unavailable: stopped }) });
}
