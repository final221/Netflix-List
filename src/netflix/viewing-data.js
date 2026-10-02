// Each public read performs one request and returns interpreted data, never a Falcor graph.
export function createViewingData({ context, fetch, createCancelledError }) {
    const limits = Object.freeze({ titleBatch: 50, episodeBatch: 200, seasons: 40, episodes: 500 });
    const VIEWING_MAX_SEASONS = limits.seasons, VIEWING_MAX_EPISODES = limits.episodes;
    const credentials = new WeakMap();

    function beginRead() {
        const request = context.viewingRequestContext();
        if (!request) return null;
        const access = Object.freeze({ profileGuid: request.profileGuid,
            endpointType: request.endpointType, endpointPath: request.endpointPath });
        credentials.set(access, request);
        return access;
    }

    function assertAccess(access, owner) {
        owner.assertCurrent();
        const request = credentials.get(access);
        if (!request) throw new Error('VIEWING_STATUS_CONTEXT');
        if (context.activeProfile() !== request.profileGuid) throw createCancelledError();
        return request;
    }

    async function requestGraph(paths, access, owner) {
        const request = assertAccess(access, owner);
        const body = new URLSearchParams();
        for (const path of paths) body.append('path', JSON.stringify(path));
        body.set('authURL', request.authURL);
        try {
            const response = await fetch(request.url, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: { 'content-type': 'application/x-www-form-urlencoded',
                    'x-netflix.nq.stack': 'prod', 'x-netflix.request.client.user.guid': request.profileGuid },
                body: body.toString(), signal: owner.signal
            });
            assertAccess(access, owner);
            if (!response.ok) throw new Error('VIEWING_STATUS_HTTP_' + response.status);
            const payload = await response.json();
            assertAccess(access, owner);
            if (!payload?.jsonGraph || typeof payload.jsonGraph !== 'object' || payload.status === 'error') {
                throw new Error('VIEWING_STATUS_RESPONSE');
            }
            return payload.jsonGraph;
        } catch (error) {
            // Preserve transport aborts for scope accounting before its stale-owner check.
            if (error?.name === 'AbortError') throw error;
            assertAccess(access, owner);
            throw error;
        }
    }

    function unwrapViewingAtom(value) {
        if (value?.$type === 'error') return undefined;
        return value?.$type === 'atom' ? value.value : value;
    }


    function readViewingGraph(graph, path) {
        let value = graph;
        const resolve = input => {
            let node = unwrapViewingAtom(input);
            const visited = new Set();
            while (node?.$type === 'ref') {
                const reference = node.value;
                if (!Array.isArray(reference) || reference.length > 12) return undefined;
                const key = JSON.stringify(reference);
                if (visited.has(key) || visited.size >= 12) return undefined;
                visited.add(key);
                node = readViewingGraphReference(graph, reference);
                node = unwrapViewingAtom(node);
            }
            return node;
        };
        for (const key of path) {
            value = resolve(value);
            if (!value || typeof value !== 'object') return undefined;
            value = value[key];
        }
        return resolve(value);
    }


    function readViewingGraphReference(graph, path) {
        let value = graph;
        for (const key of path) {
            value = unwrapViewingAtom(value);
            if (!value || typeof value !== 'object') return undefined;
            value = value[key];
        }
        return value;
    }


    function viewingNumber(value) {
        const unwrapped = unwrapViewingAtom(value);
        return typeof unwrapped === 'number' && Number.isFinite(unwrapped) && unwrapped >= 0
            ? unwrapped : null;
    }


    function viewingCount(value) {
        const unwrapped = unwrapViewingAtom(value);
        // Missing counts can be recovered from covered lists; malformed counts
        // must not become permission to ignore inconsistent metadata.
        if (unwrapped == null) return null;
        return Number.isSafeInteger(unwrapped) && unwrapped >= 0 ? unwrapped : NaN;
    }


    function viewingVideoRecord(graph, videoId, type = '') {
        const video = readViewingGraph(graph, ['videos', String(videoId)]);
        if (!video || typeof video !== 'object') return null;
        const field = key => video[key]?.$type === 'ref'
            ? readViewingGraph(graph, ['videos', String(videoId), key]) : unwrapViewingAtom(video[key]);
        const summary = field('summary');
        const watched = field('watched');
        return {
            videoId: String(videoId),
            type: type || (typeof summary?.type === 'string' ? summary.type.toLowerCase() : ''),
            watched: typeof watched === 'boolean' ? watched : undefined,
            bookmark: viewingNumber(field('bookmarkPosition')),
            runtime: viewingNumber(field('runtime')),
            creditsOffset: viewingNumber(field('creditsOffset')),
            seasonCount: viewingCount(field('seasonCount')),
            episodeCount: viewingCount(field('episodeCount'))
        };
    }


    function viewingFieldKind(value, depth = 0) {
        if (value === undefined) return 'missing';
        if (value === null) return 'null';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return !Number.isFinite(value) ? 'invalid-number'
            : value < 0 ? 'negative-number' : value === 0 ? 'zero' : 'positive-number';
        if (typeof value === 'string') return 'string';
        if (value?.$type === 'error') return 'error';
        if (value?.$type === 'ref') return 'reference';
        if (value?.$type === 'atom' && depth < 2) return 'atom:' + viewingFieldKind(value.value, depth + 1);
        return 'object';
    }


    function viewingFieldKinds(graph, id) {
        const video = readViewingGraph(graph, ['videos', String(id)]);
        const kinds = {};
        for (const [key, field] of [['watched', 'watched'], ['bookmark', 'bookmarkPosition'], ['runtime', 'runtime']]) {
            const kind = viewingFieldKind(video?.[field]);
            kinds[key] = kind;
        }
        return kinds;
    }


    function viewingReferenceId(reference, kind) {
        const value = unwrapViewingAtom(reference);
        const path = Array.isArray(value) ? value : (value?.$type === 'ref' ? value.value : null);
        return Array.isArray(path) && path.length === 2 && path[0] === kind && /^\d+$/.test(String(path[1]))
            ? String(path[1]) : '';
    }


    function viewingSeasonPlan(graph, record) {
        const count = record.seasonCount ?? viewingCount(readViewingGraph(graph, ['videos', record.videoId, 'seasonList', 'length']));
        const expected = record.episodeCount;
        if (!Number.isSafeInteger(count) || count < 1 || count > VIEWING_MAX_SEASONS ||
            (expected !== null && (!Number.isSafeInteger(expected) || expected < 1 || expected > VIEWING_MAX_EPISODES))) return null;
        const list = readViewingGraph(graph, ['videos', record.videoId, 'seasonList']);
        if (!list || typeof list !== 'object') return null;
        if (Object.keys(list).some(key => /^\d+$/.test(key) && Number(key) >= count)) return null;
        const seasons = [];
        const seen = new Set();
        let total = 0;
        for (let index = 0; index < count; index++) {
            const id = viewingReferenceId(list[index], 'seasons');
            const summary = id ? readViewingGraph(graph, ['seasons', id, 'summary']) : null;
            const length = viewingCount(summary?.length ?? readViewingGraph(graph, ['seasons', id, 'length']));
            if (!id || seen.has(id) || !Number.isSafeInteger(length) || length > VIEWING_MAX_EPISODES) return null;
            seen.add(id);
            total += length;
            if (total > VIEWING_MAX_EPISODES || (expected !== null && total > expected)) return null;
            seasons.push({ id, count: length });
        }
        return total > 0 && (expected === null || total === expected)
            ? { videoId: record.videoId, expected: total, seasons } : null;
    }


    function requireBatch(values, max) {
        if (!Array.isArray(values) || !values.length || values.length > max) throw new Error('VIEWING_STATUS_BATCH');
    }

    async function readTitles(ids, access, owner) {
        requireBatch(ids, limits.titleBatch);
        const graph = await requestGraph([['videos', ids,
            ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset', 'seasonCount', 'episodeCount']]], access, owner);
        return new Map(ids.map(id => [String(id), viewingVideoRecord(graph, id)]));
    }

    async function readSeasons(records, access, owner) {
        requireBatch(records, limits.titleBatch);
        let requested = 0;
        const paths = records.flatMap(record => {
            const count = Number.isSafeInteger(record.seasonCount) && record.seasonCount > 0
                ? Math.min(record.seasonCount, limits.seasons) : limits.seasons;
            requested += count;
            const paths = [['videos', record.videoId, 'seasonList',
                { from: 0, to: count - 1 }, ['summary', 'length']]];
            if (record.seasonCount === null) paths.push(['videos', record.videoId, 'seasonList', 'length']);
            return paths;
        });
        if (requested > limits.episodeBatch) throw new Error('VIEWING_STATUS_BATCH');
        const graph = await requestGraph(paths, access, owner);
        return records.map(record => viewingSeasonPlan(graph, record)).filter(Boolean);
    }

    function episodeData(graph, id) {
        const fetched = id ? viewingVideoRecord(graph, id) : null;
        const record = fetched && (!fetched.type || fetched.type === 'episode') ? { ...fetched, type: 'episode' } : null;
        return { record, kinds: viewingFieldKinds(graph, id) };
    }

    async function readEpisodes(segments, access, owner) {
        requireBatch(segments, limits.episodeBatch);
        let size = 0;
        const paths = segments.map(({ seasonId, from, to }) => {
            if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to >= limits.episodes) {
                throw new Error('VIEWING_STATUS_BATCH');
            }
            size += to - from + 1;
            return ['seasons', seasonId, 'episodes', { from, to },
                ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset']];
        });
        if (size > limits.episodeBatch) throw new Error('VIEWING_STATUS_BATCH');
        const graph = await requestGraph(paths, access, owner);
        return segments.map(({ seasonId, from, to }) => {
            const list = readViewingGraph(graph, ['seasons', seasonId, 'episodes']);
            const episodes = [];
            for (let index = from; index <= to; index++) {
                const id = viewingReferenceId(list?.[index], 'videos');
                episodes.push({ index, id, ...episodeData(graph, id) });
            }
            return { seasonId, from, to, episodes };
        });
    }

    async function readDirectEpisodes(ids, access, owner) {
        requireBatch(ids, limits.episodeBatch);
        const graph = await requestGraph([['videos', ids,
            ['summary', 'watched', 'bookmarkPosition', 'runtime', 'creditsOffset']]], access, owner);
        return new Map(ids.map(id => [String(id), episodeData(graph, String(id))]));
    }

    return Object.freeze({ limits, beginRead, readTitles, readSeasons, readEpisodes, readDirectEpisodes });
}
