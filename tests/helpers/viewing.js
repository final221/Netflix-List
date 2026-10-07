import { createViewing } from '../../src/viewing/viewing.js';
import { createSessionScope } from '../../src/app/session-scope.js';

// Normalized adapter fixtures supply facts; they never own viewing state.
export async function fixture() {
    let profile = 'a', readHook = () => {}, writeHook = () => {};
    const storage = new Map(), coverage = new Map(), records = new Map(), changes = [];
    const scope = createSessionScope({ isTargetPage: () => true, AbortController, setTimeout, clearTimeout });
    const token = scope.begin();
    const unknown = type => ({ type, watched: null, bookmark: null, runtime: 100, creditsOffset: null });
    const kinds = { watched: 'missing', bookmark: 'missing', runtime: 'number' };
    const data = { limits: { titleBatch: 50, episodeBatch: 200, seasons: 40, episodes: 500 },
        beginRead: () => ({ profileGuid: profile }),
        async readTitles(ids) { return new Map(ids.map(id => [id, coverage.has(id)
            ? { ...unknown('show'), seasonCount: coverage.get(id).length, episodeCount: coverage.get(id).reduce((n, pair) => n + pair[1], 0) }
            : records.get(id) || unknown('movie')])); },
        async readSeasons(titles) { return titles.map(title => ({ videoId: title.videoId,
            expected: coverage.get(title.videoId).reduce((n, pair) => n + pair[1], 0),
            seasons: coverage.get(title.videoId).map(([id, count]) => ({ id, count })) })); },
        async readEpisodes(ranges) { return ranges.map(range => ({ episodes: Array.from({ length: range.to - range.from + 1 },
            (_, offset) => ({ id: String(Number(range.seasonId) * 100 + range.from + offset), record: unknown('episode'), kinds })) })); },
        async readDirectEpisodes(ids) { return new Map(ids.map(id => [id, { record: unknown('episode'), kinds }])); }
    };
    // Typed title records carry identity just like P07.
    const readTitles = data.readTitles;
    data.readTitles = async ids => new Map([...(await readTitles(ids))].map(([id, record]) => [id, { ...record, videoId: id }]));
    const viewing = createViewing({ activeProfile: () => profile, now: () => 1000, performanceNow: () => 0, data,
        beginRequest: scope.beginRequest, finishRequest: scope.finishRequest, setRequestTimeout: scope.setRequestTimeout,
        createCancelledError: scope.cancelledError, isCancelled: scope.isCancelled,
        getValue(key, fallback) { readHook(key); return structuredClone(storage.get(key) ?? fallback); },
        setValue(key, value) { writeHook(key); storage.set(key, structuredClone(value)); } });
    const config = { sessionToken: token, readItems: () => [{ videoId: '1' }, { videoId: '2' }, { videoId: '3' }],
        assertCurrent: () => scope.assertCurrent(token), onChange: change => changes.push(change) };
    const watch = viewing.createSession(config);
    await viewing.start(watch);
    // Isolate later action/cache evidence from the initial optional scan.
    storage.clear(); changes.length = 0;
    return { viewing, watch, storage, coverage, records, changes, config,
        refresh: () => viewing.refresh(watch), retire: () => scope.dispose(), profile(value) { profile = value; },
        onRead(value) { readHook = value; }, onWrite(value) { writeHook = value; } };
}
