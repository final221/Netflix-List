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
    let generation = 0, profile = null, running = false, requests = 0, controller = null, timer = null, retryTimer = null, windowStart = 0, windowRequests = 0, cooldownUntil = 0;
    const types = new Map(), coverage = new Map(), pending = new Map(), checked = new Set(), attempts = new Map(), failed = new Set();
    function guard(owner = generation) {
        if (owner !== generation || !profile || context.activeProfile() !== profile || !isCurrent()) throw cancelled();
    }
    function dispose() {
        generation++; controller?.abort(); controller = null;
        if (timer !== null) environment.clearTimeout(timer); timer = null;
        if (retryTimer !== null) environment.clearTimeout(retryTimer); retryTimer = null;
        profile = null; running = false; requests = 0; windowRequests = 0; windowStart = now(); cooldownUntil = 0;
        attempts.clear(); failed.clear();
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
            if (typeHint === 'movie' && !types.has(id)) { types.set(id, 'movie'); pending.delete(id); checked.add(id); attempts.delete(id); failed.delete(id); updated = true; }
            if (!ready(id) && !failed.has(id) && !pending.has(id) && pending.size < 500) pending.set(id, 0);
        }
        pump();
        return updated;
    }
    async function request(read, owner) {
        guard(owner); requests++; windowRequests++;
        const access = data.beginRead();
        if (!access || access.profileGuid !== profile) throw new Error('VIEWING_STATUS_CONTEXT');
        const current = new environment.AbortController(); controller = current;
        const deadline = new Promise((_, reject) => { timer = environment.setTimeout(() => { current.abort(); reject(new Error('BROWSING_VIEWING_TIMEOUT')); }, 8000); });
        try { const value = await Promise.race([read(access, { signal: current.signal, assertCurrent: () => guard(owner) }), deadline]); guard(owner); return value; }
        finally { if (controller === current) { environment.clearTimeout(timer); timer = null; controller = null; } }
    }
    const now = () => environment.performance?.now() ?? Date.now();
    function pump() {
        if (running || retryTimer !== null || !pending.size || !profile || !isCurrent()) return;
        const time = now();
        if (time - windowStart >= 60000) { windowStart = time; windowRequests = 0; }
        const due = Math.min(...pending.values());
        const delay = Math.max(0, due - time, cooldownUntil - time, windowRequests >= 198 ? windowStart + 60000 - time : 0);
        const owner = generation;
        if (delay > 0) retryTimer = environment.setTimeout(() => { retryTimer = null; if (owner === generation) pump(); }, delay);
        else { running = true; environment.queueMicrotask(() => { if (owner === generation) void run(owner); }); }
    }
    async function run(owner) {
        try {
            while (pending.size && windowRequests < 198 && now() >= cooldownUntil) {
                guard(owner);
                const ids = [...pending].filter(([, due]) => due <= now()).slice(0, 5).map(([id]) => id);
                if (!ids.length) break;
                ids.forEach(id => { pending.delete(id); attempts.set(id, (attempts.get(id) || 0) + 1); });
                try {
                    const records = await request((access, handle) => data.readTitles(ids, access, handle), owner), series = [];
                    for (const id of ids) {
                        const record = records.get(id), value = completion.recordType(record);
                        if (value) types.set(id, value);
                        if (value === 'series') series.push(record);
                    }
                    if (series.length) {
                        const plans = await request((access, handle) => data.readSeasons(series, access, handle), owner);
                        for (const plan of plans) coverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
                        const expired = choices.reconcile(id => coverage.get(id), ids, () => guard(owner));
                        if (expired.size) log('Browsing viewing coverage reconciled', { changed: expired.size });
                    }
                } catch (error) {
                    guard(owner);
                    if (/VIEWING_STATUS_(CONTEXT|HTTP_(401|403|429))/.test(error.message)) cooldownUntil = now() + 60000;
                    warn('Browsing viewing metadata batch unavailable', { reason: error.message, requests, count: ids.length });
                }
                guard(owner);
                for (const id of ids) {
                    if (ready(id)) { checked.add(id); attempts.delete(id); failed.delete(id); }
                    else if (attempts.get(id) >= 3) failed.add(id);
                    else pending.set(id, now() + 1000 * attempts.get(id));
                }
                onChange(); guard(owner);
            }
        } catch (_) { /* Retired owners cannot schedule retries or publish. */ }
        finally { if (owner === generation) { running = false; pump(); } }
    }
    function retry(id) {
        guard(); if (ready(id)) return false;
        failed.delete(id); attempts.delete(id); pending.set(id, 0);
        if (retryTimer !== null) environment.clearTimeout(retryTimer); retryTimer = null;
        pump(); onChange(); return true;
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
    return Object.freeze({ reset, dispose, observe, type, ready, mark, restore, retry,
        unavailable: id => failed.has(id),
        complete: id => choices.status(id) === 'complete',
        choice: choices.choice, ids: () => choices.ids().filter(id => choices.status(id) === 'complete'),
        presentation: choices.presentation, diagnostics: () => ({ requests, checked: checked.size, pending: pending.size, running, unavailable: failed.size > 0, failed: failed.size, retrying: retryTimer !== null, windowRequests }) });
}
