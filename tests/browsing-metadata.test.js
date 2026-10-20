import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowsingViewing } from '../src/viewing/viewing.js';
import { createBrowser } from './helpers/browser.js';

function setup(data) {
    const b = createBrowser(), store = new Map(); let profile = 'A';
    const viewing = createBrowsingViewing({ environment: b.context, context: { activeProfile: () => profile },
        userscript: { getValue: (key, fallback) => store.get(key) ?? fallback, setValue: (key, value) => store.set(key, value) },
        isCurrent: () => true, onChange() {}, data: { beginRead: () => ({ profileGuid: profile }), ...data } });
    viewing.reset(); return { ...b, viewing, changeProfile() { profile = 'B'; viewing.reset(); } };
}
const movies = ids => new Map(ids.map(id => [id, { videoId: id, type: 'movie' }]));

test('browsing admits later cards after 500 titles and renews its request budget', async () => {
    const b = setup({ async readTitles(ids) { return movies(ids); } });
    for (let batch = 0; batch < 220; batch++) {
        const ids = Array.from({ length: 5 }, (_, i) => String(batch * 5 + i + 1));
        b.viewing.observe(ids.map(id => ({ id })));
        await b.scheduler.flush();
    }
    assert.equal(b.viewing.ready('501'), true);
    assert.equal(b.viewing.ready('1100'), false); assert.equal(b.viewing.diagnostics().retrying, true);
    await b.scheduler.advance(60000);
    for (let i = 0; i < 20; i++) await b.scheduler.flush();
    assert.equal(b.viewing.ready('1100'), true); assert.equal(b.viewing.diagnostics().unavailable, false);
    b.viewing.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('incomplete metadata retries automatically, then offers refresh and recovers without retiring unrelated titles', async () => {
    let available = false;
    const b = setup({ async readTitles(ids) { return available ? movies(ids) : new Map(); } });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush();
    await b.scheduler.advance(1000); await b.scheduler.advance(2000);
    assert.equal(b.viewing.unavailable('1'), true); assert.equal(b.viewing.diagnostics().requests, 3);
    available = true; b.viewing.observe([{ id: '2' }]); await b.scheduler.flush();
    assert.equal(b.viewing.ready('2'), true); b.viewing.retry('1'); await b.scheduler.flush();
    assert.equal(b.viewing.ready('1'), true); assert.equal(b.viewing.unavailable('1'), false);
    b.viewing.dispose();
});

test('a season-read failure retries missing coverage despite known series type and timeout cannot strand the queue', async () => {
    let reads = 0;
    const b = setup({ async readTitles(ids) { return new Map(ids.map(id => [id, { videoId: id, type: 'show' }])); },
        async readSeasons(records) { if (++reads === 1) throw Error('temporary'); return records.map(r => ({ videoId: r.videoId, seasons: [{ id: '10', count: 3 }] })); } });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush(); assert.equal(b.viewing.ready('1'), false);
    await b.scheduler.advance(1000); assert.equal(b.viewing.ready('1'), true); b.viewing.dispose();
    const hanging = setup({ readTitles() { return new Promise(() => {}); } });
    hanging.viewing.observe([{ id: '1' }]); await hanging.scheduler.flush(); await hanging.scheduler.advance(8000);
    assert.equal(hanging.viewing.diagnostics().running, false); assert.equal(hanging.viewing.diagnostics().retrying, true);
    hanging.changeProfile(); assert.equal(hanging.scheduler.timers.size, 0); hanging.viewing.dispose();
});

test('rate-limited metadata pauses the remaining queue and resumes without retrying every title immediately', async () => {
    let calls = 0;
    const b = setup({ async readTitles(ids) { if (++calls === 1) throw Error('VIEWING_STATUS_HTTP_429'); return movies(ids); } });
    b.viewing.observe(Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1) })));
    await b.scheduler.flush(); await b.scheduler.advance(2000); assert.equal(calls, 1);
    await b.scheduler.advance(58000); await b.scheduler.flush();
    assert.equal(b.viewing.ready('1'), true); assert.equal(b.viewing.ready('10'), true); b.viewing.dispose();
});

test('an old profile batch rejection cannot pause the new profile queue', async () => {
    let rejectOld, calls = 0;
    const b = setup({ readTitles(ids) { if (++calls === 1) return new Promise((_, reject) => { rejectOld = reject; }); return Promise.resolve(movies(ids)); } });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush(); b.changeProfile();
    rejectOld(Error('VIEWING_STATUS_HTTP_429')); await b.scheduler.flush();
    b.viewing.observe([{ id: '2' }]); await b.scheduler.flush(); assert.equal(b.viewing.ready('2'), true); b.viewing.dispose();
});


test('observing an in-flight title cannot re-admit it or reset its attempt budget', async () => {
    let resolve, reads = 0;
    const b = setup({ readTitles(ids) { reads++; return new Promise(done => { resolve = () => done(movies(ids)); }); } });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush();
    b.viewing.observe([{ id: '1' }]); assert.equal(b.viewing.retry('1'), false);
    assert.equal(b.viewing.diagnostics().pending, 0); resolve(); await b.scheduler.flush();
    assert.equal(reads, 1); assert.equal(b.viewing.ready('1'), true); b.viewing.dispose();
});

test('failed series export the season-validation reason and stop after three attempts despite rescans', async () => {
    let b, reads = 0;
    b = setup({ async readTitles(ids) { reads++; b.viewing.observe(ids.map(id => ({ id })));
        return new Map(ids.map(videoId => [videoId, { videoId, type: 'show' }])); },
        async readSeasons() { return []; }, coverageDiagnostic: () => ({ reason: 'season-length-missing', index: 0 }) });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush(); await b.scheduler.advance(1000); await b.scheduler.advance(2000);
    assert.equal(reads, 3); assert.equal(b.viewing.diagnostics().pending, 0);
    assert.equal(b.viewing.diagnostics().failedTitles[0].coverageFailure.reason, 'season-length-missing'); b.viewing.dispose();
});


test('500 series become actionable within one request window while every transport batch respects its limits', async () => {
    let titleReads = 0, seasonReads = 0;
    const b = setup({
        async readTitles(ids) {
            titleReads++; assert.ok(ids.length <= 50);
            return new Map(ids.map(videoId => [videoId, { videoId, type: 'show', seasonCount: 1 }]));
        },
        async readSeasons(records) {
            seasonReads++; assert.ok(records.length <= 50);
            return records.map(record => ({ videoId: record.videoId, seasons: [{ id: String(1000 + Number(record.videoId)), count: 3 }] }));
        },
        async readEpisodes(targets) { assert.ok(targets.length <= 200); return targets.map(() => ({ episodes: [] })); }
    });
    b.viewing.observe(Array.from({ length: 500 }, (_, i) => ({ id: String(i + 1) })));
    for (let i = 0; i < 100; i++) await b.scheduler.flush();
    assert.equal(b.viewing.ready('500'), true);
    assert.equal(b.viewing.diagnostics().pending, 0);
    assert.equal(b.viewing.diagnostics().budgetWaitMs, 0);
    assert.ok(titleReads <= 10); assert.ok(seasonReads <= 10);
    b.viewing.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('missing season counts partition conservative metadata requests within the adapter ceiling', async () => {
    let seasons = 0;
    const b = setup({
        async readTitles(ids) { return new Map(ids.map(videoId => [videoId, { videoId, type: 'show' }])); },
        async readSeasons(records) {
            assert.ok(records.length * 40 <= 200); seasons += records.length;
            return records.map(record => ({ videoId: record.videoId, seasons: [{ id: record.videoId, count: 1 }] }));
        }
    });
    b.viewing.observe(Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1) })));
    for (let i = 0; i < 15; i++) await b.scheduler.flush();
    assert.equal(seasons, 26); assert.equal(b.viewing.ready('26'), true); b.viewing.dispose();
});


test('season partitions stop exactly at the request ceiling and resume missing coverage without spending a retry', async () => {
    const b = setup({
        async readTitles(ids) { return new Map(ids.map(videoId => [videoId, { videoId, type: 'show' }])); },
        async readSeasons(records) { return records.map(record => ({ videoId: record.videoId, seasons: [{ id: record.videoId, count: 1 }] })); },
        async readEpisodes(targets) { return targets.map(() => ({ episodes: [] })); }
    });
    b.viewing.observe(Array.from({ length: 500 }, (_, i) => ({ id: String(i + 1) })));
    for (let i = 0; i < 120; i++) await b.scheduler.flush();
    assert.equal(b.viewing.diagnostics().requests, 198);
    assert.equal(b.viewing.diagnostics().failed, 0);
    assert.ok(b.viewing.diagnostics().budgetWaitMs > 0);
    assert.equal(b.viewing.ready('500'), false);
    await b.scheduler.advance(60000);
    for (let i = 0; i < 20; i++) await b.scheduler.flush();
    assert.equal(b.viewing.ready('500'), true); assert.equal(b.viewing.diagnostics().pending, 0);
    b.viewing.dispose(); assert.equal(b.scheduler.timers.size, 0);
});


test('manual-only season plans enable caught-up choices without inferring automatic finale completion', async () => {
    let finaleReads = 0;
    const b = setup({ async readTitles() { return new Map([['1', { videoId: '1', type: 'show' }]]); },
        async readSeasons(records, access, handle, options) {
            assert.equal(options.allowManual, true);
            return [{ videoId: '1', seasons: [{ id: '10', count: 27 }], manualOnly: true }];
        }, async readEpisodes() { finaleReads++; return [{ episodes: [{ id: '100', record: { type: 'episode', watched: true } }] }]; } });
    b.viewing.observe([{ id: '1' }]); await b.scheduler.flush();
    assert.equal(b.viewing.ready('1'), true); assert.equal(b.viewing.complete('1'), false); assert.equal(finaleReads, 0);
    assert.equal(b.viewing.mark('1', 'Named series').saved, true);
    assert.equal(b.viewing.complete('1'), true); assert.deepEqual(b.viewing.choice('1').coverage, [['10', 27]]);
    b.viewing.dispose();
});
