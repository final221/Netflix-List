import { createKnowledgeStorage } from './knowledge-storage.js';
import { addedEpisodes, validCoverage, validChoice, titleName } from './knowledge-migration.js';

// Shared semantic authority. Neither route presentation nor scan jobs own persisted knowledge.
export function createKnowledge(options) {
    const storage = createKnowledgeStorage(options), subscribers = new Map();
    const activeProfile = options.activeProfile, now = options.now || Date.now;
    const enqueue = options.queueMicrotask || globalThis.queueMicrotask;
    let profile = null, records = new Map(), signature = null, revision = 0, release = null, queued = false, failure = false, notificationGeneration = 0, reload = null;
    const work = { storageReloads: 0, remoteInvalidations: 0, coalescedInvalidations: 0, incidentalSkipped: 0 };
    const emptySummary = Object.freeze({ completeIds: Object.freeze([]), saved: Object.freeze([]), seriesIds: Object.freeze([]), hidden: Object.freeze({}) });
    let summaryCache = null;
    const changed = new Map();
    function guard(expected, assertCurrent = () => {}) {
        assertCurrent(); if (!expected || activeProfile() !== expected || profile !== expected) throw new Error('viewing-owner-replaced');
    }
    function notify(ids = [], origin) {
        ids.forEach(id => { if (!changed.has(id)) changed.set(id, new Set()); changed.get(id).add(origin); }); if (queued) return;
        queued = true; const expected = profile, generation = notificationGeneration;
        enqueue(() => {
            if (generation !== notificationGeneration) return;
            queued = false; const changes = new Map(changed); changed.clear();
            if (profile !== expected || activeProfile() !== expected) return;
            for (const [subscriber, owner] of [...subscribers]) try {
                const ids = [...changes].filter(([, origins]) => [...origins].some(origin => !owner || origin !== owner)).map(([id]) => id);
                if (ids.length) subscriber({ profile: expected, ids });
            } catch (_) { /* One retired page cannot block another. */ }
        });
    }
    function ensure(assertCurrent = () => {}, force = false) {
        assertCurrent(); const next = activeProfile();
        if (typeof next !== 'string' || !next) throw new Error('storage-unavailable');
        const reset = profile !== next;
        if (reset) {
            const previousRelease = release;
            notificationGeneration++; queued = false; changed.clear(); release = null; reload = null;
            profile = next; records = new Map(); signature = null; revision++; summaryCache = null;
            previousRelease?.();
        }
        const check = () => guard(next, assertCurrent);
        if (!force && !reset && release && typeof options.addValueChangeListener === 'function' && signature !== undefined) return records;
        const current = storage.signature(next); check();
        if (reset || current !== signature) {
            const loaded = storage.read(next, check); check(); work.storageReloads++;
            for (const value of loaded.values()) {
                const metadata = Object.entries(value).filter(([kind]) => kind.startsWith('metadata')).map(([, fact]) => fact);
                const coverage = new Map();
                for (const fact of metadata) for (const [id, count] of fact.coverage || []) coverage.set(id, Math.max(count, coverage.get(id) || 0));
                if (coverage.size) value.metadata = { ...value.metadata, type: 'series', coverage: validCoverage([...coverage]) ? [...coverage] : value.metadata?.coverage || metadata.find(fact => validCoverage(fact.coverage))?.coverage,
                    baseline: value.metadata?.baseline || metadata.find(fact => fact.baseline)?.baseline || null };
                const completions = Object.entries(value).filter(([kind]) => kind.startsWith('completion')).map(([, fact]) => fact);
                const verified = completions.filter(fact => fact.type === 'movie' || validCoverage(fact.coverage));
                if (verified.length) value.completion = verified.reduce((best, fact) =>
                    fact.type === 'series' && addedEpisodes(best.coverage, fact.coverage) || fact.observedAt > best.observedAt && !addedEpisodes(fact.coverage, best.coverage) ? fact : best);
            }
            records = loaded; signature = storage.signature(next); check(); revision++; failure = false; summaryCache = null;
        }
        const subscriptionGeneration = notificationGeneration;
        if (!release) release = storage.subscribe(next, (_key, _old, _new, remote) => {
            if (remote === false || subscriptionGeneration !== notificationGeneration || activeProfile() !== next || profile !== next) return;
            work.remoteInvalidations++;
            if (reload) { work.coalescedInvalidations++; return; }
            const owner = { profile: next, generation: subscriptionGeneration }; reload = owner;
            enqueue(() => {
                if (reload !== owner) return;
                reload = null;
                if (owner.generation !== notificationGeneration || profile !== next || activeProfile() !== next) return;
                try { reloadChanges(); } catch (_) { failure = true; }
            });
        });
        return records;
    }
    function facts(id) { ensure(); return records.get(String(id)) || {}; }
    function effectiveManual(value) {
        if (!validChoice(value.manual) || value.manual.status === 'automatic') return null;
        if (value.manual.status === 'complete' && value.manual.type === 'series' && addedEpisodes(value.manual.coverage || value.metadata?.baseline, value.metadata?.coverage)) return null;
        return value.manual.type === 'series' && !value.manual.coverage && value.metadata?.baseline
            ? { ...value.manual, coverage: value.metadata.baseline } : value.manual;
    }
    function completion(value) {
        const entry = value.completion;
        if (!entry || !['movie', 'series'].includes(entry.type)) return false;
        if (entry.type === 'movie') return true;
        return validCoverage(entry.coverage) && !addedEpisodes(entry.coverage, value.metadata?.coverage);
    }
    function unverified(value) {
        return !effectiveManual(value) && !completion(value) &&
            Boolean(value.completion?.type === 'series' && !validCoverage(value.completion.coverage) || !value.manual && value.legacy?.watched === true);
    }
    function summary() {
        ensure();
        if (summaryCache) return summaryCache;
        const completeIds = [], saved = [], seriesIds = [], hidden = {};
        for (const [id, value] of records) {
            const manual = effectiveManual(value), type = manual?.type || value.metadata?.type || value.completion?.type;
            const complete = manual ? manual.status === 'complete' : completion(value), pending = unverified(value);
            if (complete) completeIds.push(id);
            if (complete || pending) saved.push(Object.freeze({ id, type: type || 'unknown', unverified: pending }));
            if ((manual?.status === 'complete' || type === 'series' || !value.manual && value.legacy?.watched) && type !== 'movie') seriesIds.push(id);
            if (value.hidden?.hidden) hidden[id] = 'hide';
        }
        summaryCache = Object.freeze({ completeIds: Object.freeze(completeIds), saved: Object.freeze(saved),
            seriesIds: Object.freeze(seriesIds), hidden: Object.freeze(hidden) });
        return summaryCache;
    }
    function mutate(id, kind, value, assertCurrent = () => {}, origin) {
        if (!/^\d+$/.test(String(id))) throw new Error('invalid-title');
        ensure(assertCurrent); const expected = profile;
        // Encountered names/metadata must never consume admission for a user decision.
        if (!records.has(String(id)) && records.size >= 5000 && ['label', 'metadata'].includes(kind)) {
            work.incidentalSkipped++; return false;
        }
        const check = () => guard(expected, assertCurrent);
        const existing = records.get(String(id))?.[kind];
        if (kind !== 'manual' && JSON.stringify(existing) === JSON.stringify(value)) { check(); return false; }
        const didWrite = storage.write(expected, String(id), kind, value, check);
        check();
        const previous = records.get(String(id)) || {};
        records.set(String(id), { ...previous, [kind]: structuredCopy(value) });
        summaryCache = null;
        if (didWrite) { storage.signal(expected); check(); signature = storage.signature(expected); check(); notify([String(id)], origin); }
        return didWrite;
    }
    function remember(id, { type, coverage = null, name = '', status = 'unknown', observedAt = now(), source = 'netflix' }, assertCurrent = () => {}, origin) {
        if (!/^\d+$/.test(String(id))) return;
        ensure(assertCurrent);
        if (titleName(name)) mutate(id, 'label', { name: titleName(name) }, assertCurrent, origin);
        if (type === 'movie' || type === 'series' && validCoverage(coverage)) {
            const prior = records.get(String(id))?.metadata, manualBefore = records.get(String(id))?.manual;
            const combined = new Map(prior?.coverage || []);
            for (const [season, count] of coverage || []) combined.set(season, Math.max(count, combined.get(season) || 0));
            const retainedCoverage = type === 'series' ? validCoverage([...combined]) ? [...combined] : coverage : null;
            const metadata = { type, coverage: retainedCoverage, baseline: prior?.baseline || retainedCoverage };
            try { mutate(id, 'metadata', metadata, assertCurrent, origin); }
            catch (error) { guard(profile, assertCurrent); if (records.get(String(id))?.manual !== manualBefore) return;
                records.set(String(id), { ...records.get(String(id)), metadata }); summaryCache = null; failure = true; throw error; }
        }
        if (status === 'complete' && (type === 'movie' || type === 'series' && validCoverage(coverage))) {
            const prior = records.get(String(id))?.completion;
            // An older/smaller series observation cannot revive completion after added episodes.
            if (prior?.type === 'series' && addedEpisodes(coverage, prior.coverage)) return;
            mutate(id, 'completion', { type, coverage: type === 'series' ? coverage : null, name: titleName(name) || prior?.name || '', observedAt, source }, assertCurrent, origin);
        }
    }
    function createView(initialProfile, origin) {
        let viewProfile = initialProfile, viewRevision = -1, viewFailure = false, alive = true;
        const current = () => alive && Boolean(viewProfile) && activeProfile() === viewProfile;
        function sync(assertCurrent = () => {}, onReset = () => {}) {
            assertCurrent(); const next = activeProfile(), reset = viewProfile !== undefined && next !== viewProfile;
            viewProfile = next; if (reset) { onReset(); assertCurrent(); }
            const before = viewRevision;
            try { ensure(assertCurrent, before === -1); if (before === -1 || reset) viewFailure = false; } catch (error) { assertCurrent(); if (activeProfile() === next) viewFailure = true; }
            assertCurrent(); viewRevision = revision;
            return { changed: reset || before !== revision, reset };
        }
        function value(id) { if (!current()) return {}; try { return facts(id); } catch (_) { viewFailure = true; return {}; } }
        function choice(id) { const manual = effectiveManual(value(id)); if (!manual) return null;
            const copied = structuredCopy(manual);
            if (copied.coverage) copied.coverage = Object.freeze(copied.coverage.map(pair => Object.freeze(pair)));
            return Object.freeze(copied); }
        function choose(id, input, assertCurrent = () => {}) {
            const expected = viewProfile;
            const check = () => { assertCurrent(); if (!current() || viewProfile !== expected) throw new Error('viewing-owner-replaced'); };
            try {
                check(); ensure(check);
                const prior = value(id).manual;
                const next = input ? { ...input, name: titleName(input.name) || titleName(prior?.name) || name(id) }
                    : { status: 'automatic', type: prior?.type || 'unknown', coverage: null, name: name(id),
                        previous: prior?.status === 'automatic' ? prior.previous : prior || null };
                if (!validChoice(next)) throw new Error('invalid-choice');
                mutate(id, 'manual', next, check, origin);
                check(); viewFailure = false; failure = false;
                return { saved: true, changed: new Set([String(id)]) };
            } catch (_) {
                const admitted = current() && viewProfile === expected;
                if (admitted) viewFailure = true;
                return { saved: false, changed: new Set(), admitted };
            }
        }
        function reconcile(coverageFor, ids = null, assertCurrent = () => {}) {
            const changed = new Set();
            for (const id of ids === null ? allIds() : ids) {
                const before = choice(id), coverage = coverageFor(id);
                if (!validCoverage(coverage)) continue;
                try { remember(id, { type: 'series', coverage }, assertCurrent, origin); }
                catch (_) { viewFailure = true; failure = true; continue; }
                const after = choice(id); if (JSON.stringify(before) !== JSON.stringify(after)) changed.add(id);
            }
            return changed;
        }
        function allIds() { if (!current()) return []; try { return [...ensure().keys()]; } catch (_) { return []; } }
        return { sync, choose, reconcile, choice, ids: allIds,
            has: id => Boolean(choice(id)), status: id => choice(id)?.status, type: id => {
                const entry = value(id); return choice(id)?.type || entry.metadata?.type || entry.completion?.type; },
            complete: id => { const entry = value(id), manual = effectiveManual(entry); return manual ? manual.status === 'complete' : completion(entry); },
            automatic: id => completion(value(id)),
            unverified: id => unverified(value(id)),
            summary() { if (!current()) return emptySummary; try { return summary(); } catch (_) { viewFailure = true; return emptySummary; } },
            retire() { alive = false; viewProfile = undefined; }, fork: nextOrigin => createView(viewProfile, nextOrigin),
            presentation: () => Object.freeze({ profile: viewProfile, manualFailure: viewFailure || failure, disabled: !current() || viewFailure || failure }) };
    }
    function name(id) { const entry = facts(id); return titleName(entry.label?.name) || titleName(entry.manual?.name) || titleName(entry.hidden?.name) || titleName(entry.completion?.name); }
    function hidden() { return { ...summary().hidden }; }
    function setHidden(id, hidden, label = '', assertCurrent = () => {}) { mutate(id, 'hidden', { hidden: Boolean(hidden), name: titleName(label) || name(id) }, assertCurrent); }
    function reloadChanges() {
        const before = records; signature = undefined; ensure();
        // Evidence keys fold into these effective facts; loading their storage
        // representation alone is not a change to the title's semantic state.
        const projection = value => JSON.stringify(value && ['manual', 'completion', 'metadata', 'label', 'hidden', 'legacy']
            .map(kind => value[kind] ?? null));
        const ids = [...new Set([...before.keys(), ...records.keys()])]
            .filter(id => projection(before.get(id)) !== projection(records.get(id)));
        notify(ids);
    }
    function resync() { reload = null; try { reloadChanges(); } catch (_) { failure = true; } }
    function dispose() {
        notificationGeneration++; queued = false; changed.clear(); release = null; reload = null;
        subscribers.clear(); profile = null; records = new Map(); signature = null; summaryCache = null;
        storage.dispose();
    }
    return Object.freeze({ view: origin => createView(undefined, origin), remember, name, hidden, setHidden, resync, dispose,
        subscribe(callback, origin) { subscribers.set(callback, origin); return () => subscribers.delete(callback); },
        legacy(id) { try { const value = facts(id); return value.manual ? null : value.legacy; } catch (_) { return null; } },
        diagnostics: () => ({ ...storage.diagnostics(), ...work, titles: records.size, subscribers: subscribers.size, failure,
            rememberedCompletions: [...records.values()].filter(value => value.completion).length,
            unverifiedSeries: [...records.values()].filter(value => value.completion?.type === 'series' && !validCoverage(value.completion.coverage)).length,
            missingNames: [...records.values()].filter(value => (value.manual || value.completion || value.hidden?.hidden) &&
                ![value.label, value.manual, value.completion, value.hidden].some(fact => titleName(fact?.name))).length }) });
}
function structuredCopy(value) { return JSON.parse(JSON.stringify(value)); }
