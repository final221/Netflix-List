import { createKnowledge } from './knowledge.js';
import { createCompletion } from './completion.js';
import { createViewingData } from '../netflix/viewing-data.js';

// Browsing shares manual viewing policy/storage; metadata transport stays in viewing-data.
export function createBrowsingViewing({ environment, context, userscript, isCurrent, onChange, data, knowledge,
    log = () => {}, warn = () => {} }) {
    const ownsKnowledge = !knowledge;
    knowledge ||= createKnowledge({ activeProfile: () => context.activeProfile(), ...userscript, getValue: (...args) => userscript.getValue(...args), setValue: (...args) => userscript.setValue(...args) });
    let choices = knowledge.view();
    const completion = createCompletion();
    const cancelled = () => new Error('BROWSING_VIEWING_RETIRED');
    data ||= createViewingData({ context, fetch: (...args) => environment.fetch(...args), createCancelledError: cancelled });
    const { titleBatch = 50, episodeBatch = 200, seasons = 40 } = data.limits || {};
    let generation = 0, profile = null, running = false, requests = 0, controller = null, timer = null, retryTimer = null, windowStart = 0, windowRequests = 0, cooldownUntil = 0, phase = null;
    const waitingSince = new Map(), readiness = { count: 0, totalMs: 0, maxMs: 0 };
    const inFlight = new Set(), types = new Map(), coverage = new Map(), pending = new Map(), checked = new Set(), attempts = new Map(), failed = new Set();
    function guard(owner = generation) {
        if (owner !== generation || !profile || context.activeProfile() !== profile || !isCurrent()) throw cancelled();
    }
    function dispose() {
        generation++; controller?.abort(); controller = null;
        if (timer !== null) environment.clearTimeout(timer); timer = null;
        if (retryTimer !== null) environment.clearTimeout(retryTimer); retryTimer = null;
        profile = null; running = false; requests = 0; windowRequests = 0; windowStart = now(); cooldownUntil = 0;
        attempts.clear(); failed.clear(); inFlight.clear(); waitingSince.clear();
        phase = null; readiness.count = 0; readiness.totalMs = 0; readiness.maxMs = 0;
        pending.clear(); checked.clear(); types.clear(); coverage.clear(); choices.retire();
        if (ownsKnowledge) knowledge.dispose();
    }
    function reset() {
        dispose(); profile = context.activeProfile(); choices = knowledge.view(); choices.sync(() => guard());
    }
    function observe(items) {
        if (!profile) return false;
        let updated = false;
        const savedSeries = choices.summary().seriesIds.map(id => ({ id }));
        for (const { id, typeHint, title } of [...items, ...savedSeries]) {
            if (typeHint === 'movie' && !types.has(id)) { types.set(id, 'movie'); pending.delete(id); waitingSince.delete(id); checked.add(id); attempts.delete(id); failed.delete(id); updated = true;
                if (knowledge.legacy(id)?.watched && !choices.choice(id)) choices.choose(id, { status: 'complete', type: 'movie', coverage: null, name: title || '' }, () => guard());
            }
            if (!ready(id) && !failed.has(id) && !inFlight.has(id) && !pending.has(id) && pending.size < 500) { pending.set(id, 0); if (!waitingSince.has(id)) waitingSince.set(id, now()); }
        }
        pump();
        return updated;
    }
    function publishReady(ids, owner) {
        guard(owner);
        for (const id of ids) if (ready(id) && waitingSince.has(id)) {
            const elapsed = Math.max(0, now() - waitingSince.get(id)); waitingSince.delete(id);
            readiness.count++; readiness.totalMs += elapsed; readiness.maxMs = Math.max(readiness.maxMs, elapsed);
        }
        onChange(ids); guard(owner);
    }
    function seasonBatches(records) {
        const batches = []; let batch = [], size = 0;
        for (const record of records) {
            const cost = Number.isSafeInteger(record.seasonCount) && record.seasonCount > 0 ? Math.min(record.seasonCount, seasons) : seasons;
            if (size + cost > episodeBatch) { batches.push(batch); batch = []; size = 0; }
            batch.push(record); size += cost;
        }
        if (batch.length) batches.push(batch);
        return batches;
    }
    async function request(read, owner, kind) {
        guard(owner);
        if (windowRequests >= 198) throw new Error('BROWSING_VIEWING_BUDGET');
        requests++; windowRequests++;
        const access = data.beginRead();
        if (!access || access.profileGuid !== profile) throw new Error('VIEWING_STATUS_CONTEXT');
        const current = new environment.AbortController(); controller = current; phase = kind;
        const deadline = new Promise((_, reject) => { timer = environment.setTimeout(() => { current.abort(); reject(new Error('BROWSING_VIEWING_TIMEOUT')); }, 8000); });
        try { const value = await Promise.race([read(access, { signal: current.signal, assertCurrent: () => guard(owner) }), deadline]); guard(owner); return value; }
        finally { if (controller === current) { environment.clearTimeout(timer); timer = null; controller = null; phase = null; } }
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
                const ids = [...pending].filter(([, due]) => due <= now()).slice(0, titleBatch).map(([id]) => id);
                if (!ids.length) break;
                ids.forEach(id => { pending.delete(id); inFlight.add(id); attempts.set(id, (attempts.get(id) || 0) + 1); });
                try {
                    const records = await request((access, handle) => data.readTitles(ids, access, handle), owner, 'titles'), series = [];
                    for (const id of ids) {
                        const record = records.get(id), value = completion.recordType(record);
                        if (value) types.set(id, value);
                        if (value === 'movie' && knowledge.legacy(id)?.watched && !choices.choice(id)) choices.choose(id, { status: 'complete', type: 'movie', coverage: null }, () => guard(owner));
                        if (value === 'movie') knowledge.remember(id, { type: value, status: completion.classifyVideo(record) }, () => guard(owner));
                        if (value === 'series') series.push(record);
                    }
                    publishReady(ids, owner);
                    for (const batch of seasonBatches(series)) {
                        const plans = await request((access, handle) => data.readSeasons(batch, access, handle, { allowManual: true }), owner, 'seasons');
                        for (const plan of plans) coverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
                        const expired = choices.reconcile(id => coverage.get(id), batch.map(record => record.videoId), () => guard(owner));
                        if (expired.size) log('Browsing viewing coverage reconciled', { changed: expired.size });
                        publishReady(batch.map(record => record.videoId), owner);
                        if (typeof data.readEpisodes === 'function') {
                            const targets = plans.filter(plan => !plan.manualOnly).map(plan => ({ plan, season: [...plan.seasons].reverse().find(season => season.count > 0) })).filter(value => value.season);
                            if (targets.length) {
                                const episodes = await request((access, handle) => data.readEpisodes(targets.map(({ season }) =>
                                    ({ seasonId: season.id, from: season.count - 1, to: season.count - 1 })), access, handle), owner, 'finales');
                                for (const [index, { plan }] of targets.entries()) {
                                    const episode = episodes[index]?.episodes?.[0];
                                    if (episode?.id && completion.classifyVideo(episode.record) === 'complete') knowledge.remember(plan.videoId,
                                        { type: 'series', coverage: coverage.get(plan.videoId), status: 'complete' }, () => guard(owner));
                                }
                            }
                        }
                    }
                } catch (error) {
                    guard(owner);
                    if (/VIEWING_STATUS_(CONTEXT|HTTP_(401|403|429))/.test(error.message)) cooldownUntil = now() + 60000;
                    if (error.message !== 'BROWSING_VIEWING_BUDGET') warn('Browsing viewing metadata batch unavailable', { reason: error.message, requests, count: ids.length });
                }
                guard(owner);
                for (const id of ids) {
                    inFlight.delete(id);
                    if (ready(id)) { checked.add(id); attempts.delete(id); failed.delete(id); }
                    else if (windowRequests >= 198) { attempts.set(id, Math.max(0, attempts.get(id) - 1)); pending.set(id, now()); }
                    else if (attempts.get(id) >= 3) { failed.add(id); waitingSince.delete(id); }
                    else pending.set(id, now() + 1000 * attempts.get(id));
                }
                onChange(ids); guard(owner);
            }
        } catch (_) { /* Retired owners cannot schedule retries or publish. */ }
        finally { if (owner === generation) { running = false; pump(); } }
    }
    function retry(id) {
        guard(); if (ready(id) || inFlight.has(id)) return false;
        failed.delete(id); attempts.delete(id); pending.set(id, 0); waitingSince.set(id, now());
        if (retryTimer !== null) environment.clearTimeout(retryTimer); retryTimer = null;
        pump(); onChange([id]); return true;
    }
    function type(id) { return types.get(id) || choices.type(id); }
    function ready(id) { return type(id) === 'movie' || type(id) === 'series' && coverage.has(id); }
    function mark(id, name = '') {
        guard(); if (!ready(id)) return { saved: false };
        return choices.choose(id, { status: 'complete', type: type(id), coverage: coverage.get(id) || null, name }, () => guard());
    }
    function restore(id) {
        guard(); return choices.choose(id, { status: 'main', type: type(id) || 'unknown', coverage: null }, () => guard());
    }
    return Object.freeze({ reset, dispose, observe, type, ready, mark, restore, retry,
        unavailable: id => failed.has(id),
        complete: id => choices.complete(id),
        savedIds: () => choices.summary().saved.map(record => record.id), savedRecords: () => choices.summary().saved,
        unverified: id => choices.unverified(id), choice: id => choices.choice(id), ids: () => choices.summary().completeIds,
        presentation: () => choices.presentation(), diagnostics: () => ({ phase, readiness: { count: readiness.count,
            meanMs: readiness.count ? Math.round(readiness.totalMs / readiness.count) : 0, maxMs: Math.round(readiness.maxMs), waiting: waitingSince.size },
            budgetWaitMs: Math.max(0, Math.round((windowRequests >= 198 ? windowStart + 60000 : 0) - now())),
            cooldownWaitMs: Math.max(0, Math.round(cooldownUntil - now())), knowledge: knowledge.diagnostics(), coverageAdjustments: data.coverageDiagnostics?.().filter(facts => ['episode-count-adjusted', 'manual-season-coverage'].includes(facts.reason)) || [], requests, checked: checked.size, pending: pending.size, running, unavailable: failed.size > 0, failed: failed.size, failedTitles: [...failed].slice(0, 12).map(id => ({ id, type: type(id) || 'unknown', attempts: attempts.get(id) || 0, missing: type(id) === 'series' ? 'coverage' : 'type', coverageFailure: data.coverageDiagnostic?.(id) || null })), failedTitlesTruncated: failed.size > 12, retrying: retryTimer !== null, windowRequests }) });
}
