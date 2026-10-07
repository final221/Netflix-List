export function createScan({ watch, viewing, data: viewingData, activeProfile, performanceNow,
    beginRequest, finishRequest, setRequestTimeout, isCancelled, createCancelledError,
    sessionToken, assertCurrent, readItems, onChange = () => {},
    log = () => {}, warn = () => {}, readPresentation = () => ({}), readWork = () => ({}),
    scanLimits = {} }) {
    const VIEWING_TITLE_BATCH_SIZE = viewingData.limits.titleBatch,
        VIEWING_EPISODE_BATCH_SIZE = scanLimits.episodeBatch ?? viewingData.limits.episodeBatch,
        VIEWING_MAX_SEASONS = viewingData.limits.seasons, VIEWING_MAX_EPISODES = viewingData.limits.episodes,
        VIEWING_MAX_REQUESTS = scanLimits.requests ?? 32, VIEWING_MAX_PASSES = scanLimits.passes ?? 3, VIEWING_REQUEST_CONCURRENCY = scanLimits.concurrency ?? 2,
        VIEWING_TIMEOUT_MS = scanLimits.timeout ?? 30000, VIEWING_COMPLETION_RATIO = viewing.completionRatio;
    let alive = true, started = false, currentJob = null, generation = 0, cleanupFailures = 0;
    const ownedRequests = new Set();
    function cleanup(operation) { try { operation(); } catch (_) { cleanupFailures++; } }
    function guard() { if (!alive) throw createCancelledError(); assertCurrent(); if (!alive) throw createCancelledError(); }
    function isCurrent() { try { guard(); return true; } catch (_) { return false; } }
    function owns(job) { return alive && currentJob === job && job.generation === generation; }
    function assertViewingJob(job) {
        guard();
        if (!owns(job) || activeProfile() !== job.context.profileGuid) throw createCancelledError();
    }
    function publish(ids, reason, job = null) {
        if (job) assertViewingJob(job); else guard();
        const selected = reconcile(ids);
        onChange(Object.freeze({ ids: selected === null ? null : Object.freeze([...selected].map(String)), reason }));
        if (job) assertViewingJob(job); else guard();
    }
    function resetFresh() {
        watch.results = new Map(); watch.types = new Map(); watch.seriesDetails = new Map(); watch.seriesCoverage = new Map();
    }
    function reconcile(ids = null) {
        guard();
        const change = viewing.syncProfile(watch, guard, resetFresh);
        const selected = change.changed || ids === null ? null : new Set(ids);
        const expired = viewing.reconcileCoverage(watch, selected, guard);
        if (selected) for (const id of expired) selected.add(id);
        guard(); return selected;
    }
    function recordViewingFieldKinds(kinds, counts) {
        for (const [key, kind] of Object.entries(kinds)) counts[key][kind] = (counts[key][kind] || 0) + 1;
        return kinds;
    }

    function createViewingNetworkDiagnostics() {
        const now = performanceNow();
        return { startedAt: now, lastChangeAt: now, finishedAt: null, concurrencyLimit: VIEWING_REQUEST_CONCURRENCY,
            inFlight: 0, peakInFlight: 0, succeeded: 0, failed: 0, rateLimited: 0, aborted: 0,
            totalRequestMs: 0, maxRequestMs: 0, overlapMs: 0 };
    }

    function collectViewingNetworkDiagnostics(network) {
        if (!network) return null;
        const now = network.finishedAt ?? performanceNow();
        const requests = network.succeeded + network.failed;
        return { concurrencyLimit: network.concurrencyLimit, started: requests + network.inFlight,
            inFlight: network.inFlight, peakInFlight: network.peakInFlight,
            elapsedMs: Math.round(now - network.startedAt), succeeded: network.succeeded, failed: network.failed,
            rateLimited: network.rateLimited, aborted: network.aborted,
            finishedAt: network.finishedAt, totalRequestMs: Math.round(network.totalRequestMs), maxRequestMs: Math.round(network.maxRequestMs),
            meanRequestMs: requests ? Math.round(network.totalRequestMs / requests) : 0,
            overlapMs: Math.round(network.overlapMs + (network.inFlight > 1 ? now - network.lastChangeAt : 0)) };
    }

    async function runViewingRequest(job, readBatch) {
        assertViewingJob(job);
        if (job.collectionFailure) throw job.collectionFailure;
        const now = performanceNow();
        const remaining = job.deadline - now;
        if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
        if (job.passRequests >= VIEWING_MAX_REQUESTS) {
            if (job.passes >= VIEWING_MAX_PASSES) throw new Error('VIEWING_STATUS_BUDGET');
            // Continue the same finite queue, including partial episode coverage.
            // Do not restart title requests or retry failed HTTP responses.
            job.passes++;
            job.passRequests = 0;
        }
        job.passRequests++;
        job.requests++;
        const request = beginRequest(job.sessionToken);
        const controllers = job.controllers ||= new Set();
        controllers.add(request.controller); ownedRequests.add(request);
        const network = job.network ||= createViewingNetworkDiagnostics();
        if (network.inFlight > 1) network.overlapMs += now - network.lastChangeAt;
        network.lastChangeAt = now;
        network.inFlight++;
        network.peakInFlight = Math.max(network.peakInFlight, network.inFlight);
        let succeeded = false;
        try {
            setRequestTimeout(request, Math.min(8000, remaining));
            assertViewingJob(job);
            // The scan owns quota, deadline and resource accounting; the adapter owns HTTP/wire data.
            const result = await readBatch({ signal: request.controller.signal, assertCurrent: () => assertViewingJob(job) });
            assertViewingJob(job);
            succeeded = true;
            return result;
        } catch (error) {
            if (error?.message === 'VIEWING_STATUS_HTTP_429') network.rateLimited++;
            if (error?.name === 'AbortError') network.aborted++;
            assertViewingJob(job);
            if (performanceNow() >= job.deadline) throw new Error('VIEWING_STATUS_BUDGET');
            throw error;
        } finally {
            const finishedAt = performanceNow();
            const elapsed = finishedAt - now;
            if (network.inFlight > 1) network.overlapMs += finishedAt - network.lastChangeAt;
            network.lastChangeAt = finishedAt;
            network.inFlight--;
            network.totalRequestMs += elapsed;
            network.maxRequestMs = Math.max(network.maxRequestMs, elapsed);
            if (succeeded) network.succeeded++;
            else network.failed++;
            controllers.delete(request.controller);
            ownedRequests.delete(request); cleanup(() => finishRequest(request));
        }
    }

    async function runViewingBatches(batches, job, collectBatch, requestsPerBatch = 1) {
        for (let offset = 0; offset < batches.length;) {
            assertViewingJob(job);
            if (job.collectionFailure) throw job.collectionFailure;
            const remaining = VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES - job.requests;
            if (remaining <= 0) throw new Error('VIEWING_STATUS_BUDGET');
            // Near the cap, leave enough quota to finish a series chain rather
            // than spending its last two requests on two metadata-only chains.
            const width = Math.min(VIEWING_REQUEST_CONCURRENCY, Math.max(1, Math.floor(remaining / requestsPerBatch)));
            const wave = batches.slice(offset, offset + width);
            offset += wave.length;
            await Promise.allSettled(wave.map(async batch => {
                try {
                    await collectBatch(batch);
                } catch (error) {
                    job.collectionFailure ||= error;
                    if (isCancelled(error)) {
                        for (const controller of job.controllers || []) controller.abort();
                    }
                    throw error;
                }
            }));
            // Drain allocated reads before finalizing partial results. A valid
            // peer may still publish, but a known failure stops new requests.
            if (job.collectionFailure) throw job.collectionFailure;
        }
    }

    function publishViewingProgress(job, changedIds) {
        assertViewingJob(job);
        job.watch.results = job.results;
        job.watch.types = job.types;
        job.watch.seriesDetails = job.seriesDetails;
        job.watch.requests = job.requests;
        job.watch.passes = job.passes;
        job.watch.publications++;
        publish(changedIds, 'scan-batch', job);
    }

    async function collectViewingStatuses(job) {
        const ids = [...new Set(readItems().map(item => String(item.videoId)).filter(id => /^\d+$/.test(id)))];
        const seriesById = new Map();
        const titleBatches = [];
        for (let offset = 0; offset < ids.length; offset += VIEWING_TITLE_BATCH_SIZE) {
            titleBatches.push(ids.slice(offset, offset + VIEWING_TITLE_BATCH_SIZE));
        }
        await runViewingBatches(titleBatches, job, async batch => {
            const records = await runViewingRequest(job, owner => viewingData.readTitles(batch, job.context, owner));
            for (const id of batch) {
                const record = records.get(id);
                let pendingSeries = false;
                viewing.invalidateCache(job.watch, id, { type: true });
                const type = viewing.recordType(record);
                if (type) job.types.set(id, type);
                if (record && ['show', 'series', 'tvshow'].includes(record.type)) {
                    job.seriesStats.found++;
                    if ((record.seasonCount === null || (Number.isSafeInteger(record.seasonCount) &&
                        record.seasonCount > 0 && record.seasonCount <= VIEWING_MAX_SEASONS)) &&
                        (record.episodeCount === null || (Number.isSafeInteger(record.episodeCount) &&
                        record.episodeCount > 0 && record.episodeCount <= VIEWING_MAX_EPISODES))) {
                        seriesById.set(id, record);
                        job.seriesStats.eligible++;
                        pendingSeries = true;
                    }
                }
                // A show-level flag cannot replace a cached finale result.
                // Keep that provisional result only until its episode check.
                if (!pendingSeries) {
                    viewing.invalidateCache(job.watch, id);
                    job.results.set(id, viewing.classifyVideo(record));
                }
            }
            publishViewingProgress(job, batch);
        });
        // Response arrival cannot change native order or budget priority.
        const series = ids.map(id => seriesById.get(id)).filter(Boolean);
        const seriesBatches = [];
        for (let offset = 0; offset < series.length;) {
            const batch = [];
            let episodes = 0, seasons = 0;
            while (offset < series.length && batch.length < VIEWING_TITLE_BATCH_SIZE) {
                const record = series[offset];
                const seasonCost = record.seasonCount ?? VIEWING_MAX_SEASONS;
                if (batch.length && (episodes + 1 > VIEWING_EPISODE_BATCH_SIZE ||
                    seasons + seasonCost > VIEWING_EPISODE_BATCH_SIZE)) break;
                batch.push(record);
                episodes++;
                seasons += seasonCost;
                offset++;
            }
            // Only the latest episode determines the selected caught-up rule.
            // Bound season metadata and finale checks, not historical runtimes.
            seriesBatches.push(batch);
        }
        await runViewingBatches(seriesBatches, job, batch => collectViewingSeriesBatch(batch, job), 2);
        // Preserve the complete ordinary scan before spending its remaining
        // budget on incomplete nested responses. Already verified titles win.
        await recheckViewingSeries(job);
    }

    async function collectViewingSeriesBatch(records, job) {
        const coverage = await runViewingRequest(job, owner => viewingData.readSeasons(records, job.context, owner));
        const plans = coverage.map(plan => ({ ...plan,
            seasons: plan.seasons.map(season => ({ ...season, episodes: new Map() })) }));
        job.seriesStats.planned += plans.length;
        job.seriesStats.unplanned += records.length - plans.length;
        const plannedIds = new Set(plans.map(plan => plan.videoId));
        for (const record of records) {
            if (!plannedIds.has(record.videoId)) {
                viewing.invalidateCache(job.watch, record.videoId);
                job.results.set(record.videoId, 'unknown');
                job.seriesDetails.set(record.videoId, { reason: 'season-metadata-incomplete-or-inconsistent' });
            }
        }
        for (const plan of plans) job.watch.seriesCoverage.set(plan.videoId, plan.seasons.map(season => [season.id, season.count]));
        // Coverage can expire a manual correction even before the finale arrives.
        const metadataChanges = records.filter(record => !plannedIds.has(record.videoId) || viewing.hasChoice(job.watch, record.videoId));
        if (metadataChanges.length) publishViewingProgress(job, metadataChanges.map(record => record.videoId));
        await collectViewingEpisodePlans(plans, job);
    }

    async function collectViewingEpisodePlans(plans, job) {
        const segments = [];
        for (const plan of plans) {
            const latest = viewing.latestEpisode(plan);
            if (latest && !latest.episode) segments.push({ plan, season: latest.season, from: latest.index, to: latest.index });
        }
        // Request one episode per series. Older progress cannot change the
        // latest-episode inference, including when the finale is unavailable.
        for (let offset = 0; offset < segments.length;) {
            const batch = [];
            let size = 0;
            while (offset < segments.length) {
                const segment = segments[offset];
                if (segment.plan.finished) { offset++; continue; }
                const length = segment.to - segment.from + 1;
                if (batch.length && size + length > VIEWING_EPISODE_BATCH_SIZE) break;
                batch.push(segment);
                size += length;
                offset++;
            }
            if (!batch.length) continue;
            const ranges = await runViewingRequest(job, owner => viewingData.readEpisodes(
                batch.map(({ season, from, to }) => ({ seasonId: season.id, from, to })), job.context, owner));
            for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
                const { plan, season, from, to } = batch[batchIndex];
                const latest = viewing.latestEpisode(plan);
                for (let index = from; index <= to; index++) {
                    const { id, record, kinds } = ranges[batchIndex].episodes[index - from];
                    const status = viewing.classifyVideo(record);
                    season.episodes.set(index, { id, status, ...(status === 'unknown' ? { record } : {}) });
                    if (latest?.season === season && latest.index === index) season.episodes.get(index).progress = viewing.progress(record);
                    job.seriesStats.episodesChecked++;
                    if (!id) job.seriesStats.missingEpisodeRefs++;
                    if (status === 'unknown') {
                        job.seriesStats.episodesUnknown++;
                        season.episodes.get(index).kinds = recordViewingFieldKinds(kinds, job.recheckStats.initialUnknownFields);
                    }
                    else if (status !== 'complete') job.seriesStats.episodesIncomplete++;
                }
            }
            // Keep each fully checked result even if a later request fails or
            // reaches the scan budget. Unfinished coverage remains unknown.
            for (const plan of new Set(batch.map(segment => segment.plan))) {
                if (plan.finished) continue;
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
                const result = viewing.seriesResult(plan);
                if (result === 'complete' || full || observed.some(episode => !episode.id || episode.status !== 'complete')) {
                    const status = result === 'complete' ? result : full ? result
                        : observed.some(episode => !episode.id || episode.status === 'unknown') ? 'unknown' : 'in-progress';
                    finishViewingSeriesPlan(plan, status, job);
                } else saveViewingSeriesDetails(plan, job);
            }
            publishViewingProgress(job, batch.map(segment => segment.plan.videoId));
        }
    }

    function finishViewingSeriesPlan(plan, status, job) {
        const bucket = value => value === 'complete' ? 'complete' : value === 'unknown' ? 'unknown' : 'incomplete';
        if (plan.status === undefined) job.seriesStats.checked++;
        else job.seriesStats[bucket(plan.status)]--;
        job.seriesStats[bucket(status)]++;
        plan.status = status;
        plan.finished = true;
        viewing.invalidateCache(job.watch, plan.videoId);
        job.results.set(plan.videoId, status);
        saveViewingSeriesDetails(plan, job);
        if (status === 'unknown') {
            const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
            const latest = viewing.latestEpisode(plan)?.episode;
            if ((latest?.id && latest.status === 'unknown') ||
                (observed.every(episode => episode.id && ['complete', 'unknown'].includes(episode.status)) &&
                new Set(observed.map(episode => episode.id)).size === observed.length)) {
                if (!job.unresolvedSeries.has(plan)) job.recheckStats.candidates++;
                job.unresolvedSeries.add(plan);
            }
        }
    }

    function saveViewingSeriesDetails(plan, job) {
        const observed = plan.seasons.flatMap(season => [...season.episodes.values()]);
        const complete = observed.filter(episode => episode.status === 'complete').length;
        const unfinished = observed.filter(episode => ['not-started', 'in-progress'].includes(episode.status)).length;
        const unknown = observed.filter(episode => episode.status === 'unknown').length;
        const missing = observed.filter(episode => !episode.id).length;
        const duplicates = observed.length - new Set(observed.filter(episode => episode.id).map(episode => episode.id)).size - missing;
        const fields = { watched: {}, bookmark: {}, runtime: {} };
        for (const episode of observed) {
            if (episode.status !== 'unknown' || !episode.kinds) continue;
            for (const [key, kind] of Object.entries(episode.kinds)) fields[key][kind] = (fields[key][kind] || 0) + 1;
        }
        const latest = viewing.latestEpisode(plan);
        const reason = plan.status === 'complete' ? viewing.classifySeries(plan) === 'complete'
            ? 'verified-complete' : 'latest-episode-complete' : unfinished ? 'unfinished-episodes'
            : missing || duplicates ? 'invalid-episode-references' : unknown ? 'unavailable-episode-progress' : 'episode-coverage-incomplete';
        job.seriesDetails.set(plan.videoId, { reason, seasons: plan.seasons.length, expectedEpisodes: plan.expected,
            checkedEpisodes: observed.length, completeEpisodes: complete, unfinishedEpisodes: unfinished,
            unknownEpisodes: unknown, missingEpisodeRefs: missing, duplicateEpisodeRefs: duplicates,
            latestEpisode: latest ? { season: latest.seasonNumber, episode: latest.index + 1,
                ...(latest.episode?.progress || { status: 'unknown', percent: null, thresholdPercent: VIEWING_COMPLETION_RATIO * 100,
                    reason: latest.episode ? 'episode-reference-unavailable' : 'not-checked' }),
                ...(latest.episode?.kinds ? { fields: latest.episode.kinds } : {}) } : null,
            ...(unknown ? { unknownFields: fields } : {}) });
    }

    async function recheckViewingSeries(job) {
        const attempted = new Set();
        for (;;) {
            assertViewingJob(job);
            const targets = new Map();
            for (const plan of job.unresolvedSeries) {
                if (plan.status !== 'unknown' || plan.recheckBlocked) continue;
                const latest = viewing.latestEpisode(plan)?.episode;
                const onlyLatest = plan.seasons.some(season => [...season.episodes.values()].some(episode =>
                    ['not-started', 'in-progress'].includes(episode.status)));
                for (const season of plan.seasons) {
                    for (const episode of season.episodes.values()) {
                        if (onlyLatest && episode !== latest) continue;
                        if (episode.status !== 'unknown' || attempted.has(episode.id)) continue;
                        if (!targets.has(episode.id)) {
                            if (targets.size >= VIEWING_EPISODE_BATCH_SIZE) continue;
                            targets.set(episode.id, []);
                        }
                        targets.get(episode.id).push({ plan, episode });
                    }
                }
            }
            if (!targets.size) return;
            // The reference supplied the episode ID. Ask the same read-only
            // video path directly, rather than guessing from a resume label.
            const beforeRequests = job.requests;
            let directData;
            try {
                directData = await runViewingRequest(job, owner => viewingData.readDirectEpisodes([...targets.keys()], job.context, owner));
            } finally {
                job.recheckStats.requests += job.requests - beforeRequests;
            }
            const affected = new Set();
            for (const [id, entries] of targets) {
                attempted.add(id);
                job.recheckStats.episodes++;
                const { record: direct, kinds } = directData.get(id);
                for (const { plan, episode } of entries) {
                    affected.add(plan);
                    const previous = episode.record;
                    const record = direct ? {
                        ...direct,
                        watched: typeof direct.watched === 'boolean' ? direct.watched : previous?.watched,
                        bookmark: direct.bookmark ?? previous?.bookmark ?? null,
                        runtime: direct.runtime > 0 ? direct.runtime : previous?.runtime ?? null,
                        creditsOffset: direct.creditsOffset ?? previous?.creditsOffset ?? null
                    } : previous;
                    episode.status = viewing.classifyVideo(record);
                    if (episode === viewing.latestEpisode(plan)?.episode) episode.progress = viewing.progress(record);
                    if (episode.status === 'unknown') {
                        job.recheckStats.unknownEpisodes++;
                        episode.kinds = recordViewingFieldKinds(kinds, job.recheckStats.remainingUnknownFields);
                    } else job.recheckStats.recoveredEpisodes++;
                    if (episode.status !== 'complete') plan.recheckBlocked = true;
                    if (episode.status === 'unknown') episode.record = record;
                    else { delete episode.record; delete episode.kinds; }
                }
            }
            for (const plan of affected) {
                const full = plan.seasons.every(season => season.episodes.size === season.count);
                const result = viewing.seriesResult(plan);
                if (result === 'complete' || full) finishViewingSeriesPlan(plan, result, job);
                saveViewingSeriesDetails(plan, job);
                if (plan.status === 'complete') job.recheckStats.recoveredSeries++;
            }
            publishViewingProgress(job, [...affected].map(plan => plan.videoId));
        }
    }
    function refresh() {
        if (!isCurrent()) return Promise.resolve();
        if (watch.loading) return watch.promise;
        const context = viewingData.beginRead(); guard();
        if (!context) {
            viewing.clearCache(watch); resetFresh(); watch.failure = 'VIEWING_STATUS_CONTEXT';
            publish(null, 'reconcile'); log('viewingStatusUnavailable', { reason: watch.failure });
            return Promise.resolve();
        }
        if (watch.profileGuid !== context.profileGuid) { viewing.clearCache(watch); resetFresh(); }
        else viewing.promoteCache(watch);
        watch.profileGuid = context.profileGuid; watch.loading = true; watch.seriesCoverage = new Map();
        watch.failure = null; watch.publications = 0;
        const job = {
            watch, context, sessionToken, generation: ++generation, results: new Map(), types: new Map(), seriesDetails: new Map(),
            requests: 0, passRequests: 0, passes: 1, deadline: performanceNow() + VIEWING_TIMEOUT_MS * VIEWING_MAX_PASSES,
            unresolvedSeries: new Set(), controllers: new Set(), collectionFailure: null, network: createViewingNetworkDiagnostics(),
            recheckStats: { candidates: 0, requests: 0, episodes: 0, recoveredEpisodes: 0, recoveredSeries: 0, unknownEpisodes: 0,
                initialUnknownFields: { watched: {}, bookmark: {}, runtime: {} }, remainingUnknownFields: { watched: {}, bookmark: {}, runtime: {} } },
            seriesStats: { found: 0, eligible: 0, planned: 0, checked: 0, complete: 0, unknown: 0,
                incomplete: 0, unplanned: 0, episodesChecked: 0, episodesIncomplete: 0, episodesUnknown: 0, missingEpisodeRefs: 0 }
        };
        currentJob = job; watch.network = job.network;
        // Reserve the exact promise before publication/log callbacks can refresh.
        let finish;
        watch.promise = new Promise(resolve => { finish = resolve; });
        const promise = watch.promise;
        (async () => {
            try {
                publish([], 'scan-start', job);
                log('viewingStatusStarted', { titles: readItems().length, endpointType: context.endpointType, endpointPath: context.endpointPath,
                    completionRatio: VIEWING_COMPLETION_RATIO, maxPasses: VIEWING_MAX_PASSES,
                    maxRequests: VIEWING_MAX_REQUESTS * VIEWING_MAX_PASSES, cachedTitles: viewing.cacheCount(watch), concurrencyLimit: VIEWING_REQUEST_CONCURRENCY });
                assertViewingJob(job);
                await collectViewingStatuses(job); assertViewingJob(job);
            } catch (error) {
                if (isCancelled(error)) {
                    job.network.finishedAt = performanceNow();
                    log('viewingStatusUnavailable', { reason: 'VIEWING_STATUS_CANCELLED', requests: job.requests, network: collectViewingNetworkDiagnostics(job.network) });
                    if (owns(job) && isCurrent()) {
                        viewing.clearCache(watch); resetFresh(); watch.loading = false;
                        watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED'; publish(null, 'reconcile');
                    }
                    return;
                }
                if (!owns(job) || !isCurrent()) return;
                watch.failure = /^VIEWING_STATUS_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'VIEWING_STATUS_FAILED';
                warn('viewingStatusUnavailable', { reason: watch.failure, requests: job.requests, network: collectViewingNetworkDiagnostics(job.network) });
            }
            job.network.finishedAt = performanceNow();
            if (!owns(job) || !isCurrent()) return;
            if (activeProfile() !== context.profileGuid) {
                job.results.clear(); job.types.clear(); job.seriesDetails.clear(); watch.failure = 'VIEWING_STATUS_PROFILE_CHANGED';
            }
            watch.results = job.results; watch.types = job.types; watch.seriesDetails = job.seriesDetails;
            watch.requests = job.requests; watch.passes = job.passes; watch.loading = false;
            const unresolved = viewing.cachedIds(watch); viewing.clearCache(watch);
            publish([...unresolved], 'scan-complete');
            if (!owns(job)) return;
            viewing.writeCache({ items: readItems(), profile: context.profileGuid, results: job.results, types: job.types, assertCurrent: () => assertViewingJob(job) });
            if (!owns(job) || !isCurrent()) return;
            log('viewingStatusCompleted', { ...readPresentation(), requests: watch.requests, passes: watch.passes,
                failure: watch.failure, publications: watch.publications,
                series: { ...job.seriesStats, pending: job.seriesStats.eligible - job.seriesStats.checked - job.seriesStats.unplanned },
                recheck: structuredCopy(job.recheckStats), network: collectViewingNetworkDiagnostics(job.network), work: readWork() });
        })().catch(() => {
            if (!owns(job) || !isCurrent()) return;
            watch.loading = false; viewing.clearCache(watch); resetFresh(); watch.failure = 'VIEWING_STATUS_FAILED';
            try { publish(null, 'reconcile'); } catch (_) { /* Optional presentation cannot reject startup. */ }
        }).finally(finish);
        return promise;
    }
    function start() {
        guard(); if (started) return watch.promise || Promise.resolve(); started = true;
        watch.cachedTitles = viewing.initialize(watch, readItems(), activeProfile(), guard);
        publish(null, 'reconcile'); return refresh();
    }
    function dispose() {
        if (!alive) return;
        alive = false; generation++; currentJob = null; watch.loading = false;
        viewing.retire(watch); viewing.clearCache(watch); resetFresh();
        const requests = [...ownedRequests]; ownedRequests.clear();
        for (const request of requests) cleanup(() => finishRequest(request));
    }
    function structuredCopy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function diagnostics() {
        return Object.freeze({ loading: watch.loading, requests: watch.requests, passes: watch.passes,
            failure: watch.failure, publications: watch.publications, cachedTitles: watch.cachedTitles,
            resultCount: watch.results.size, typeCount: watch.types.size, seriesDetailsCount: watch.seriesDetails.size,
            cleanupFailures, cachedCount: viewing.cacheResultCount(watch), network: watch.network ? Object.freeze(collectViewingNetworkDiagnostics(watch.network)) : null });
    }
    function seriesDiagnostics() {
        if (!isCurrent()) return [];
        return readItems().filter(item => viewing.titleType(watch, String(item.videoId)) === 'series').map(item => {
            const id = String(item.videoId);
            return { title: item.ariaLabel || '(untitled)', status: viewing.placement(watch, id).status,
                automaticStatus: viewing.automatic(watch, id), cachedStatus: !watch.results.has(id) && Boolean(viewing.cachedStatus(watch, id)),
                manualChoice: viewing.manualStatus(watch, id) || null,
                ...structuredCopy(watch.seriesDetails.get(id) || { reason: watch.loading ? 'checking' : 'series-metadata-unavailable-or-unprocessed' }) };
        });
    }
    return Object.freeze({ start, refresh, dispose, reconcile, diagnostics, seriesDiagnostics, guard,
        settled: () => watch.promise || Promise.resolve(),
        freshStatus: id => watch.results.get(id), freshType: id => watch.types.get(id) });
}
