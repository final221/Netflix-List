import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, Element } from './helpers/dom.js';
import { createLogger } from '../src/diagnostics/logger.js';
import { createReport } from '../src/diagnostics/report.js';
import { createPopupInspection } from '../src/netflix/popup-inspection.js';

function popupEnvironment() {
    let sourceReader = () => null;
    const e = { sessionToken: 1, active: true, connected: true, inspection: null,
        setSourceReader: reader => { sourceReader = reader; }, setSourceCard: card => { sourceReader = () => card; } };
    e.inspection = createPopupInspection({ Element, now: () => 0,
        isCurrentSession: token => e.active && token === e.sessionToken,
        readSessionToken: () => e.sessionToken, isSourceMounted: () => e.connected,
        readSourceCard: () => sourceReader() });
    return e;
}
function popupProbeFixture() {
    const e = popupEnvironment();
    const card = new Element('a');
    let calls = 0;
    const context = { popup: { open(videoId, anchor) { calls++; return { videoId, anchor, preview: 'private-title' }; } } };
    const props = { onPointerEnter(event) { calls++; return context.popup.open('private-video-id', event.currentTarget); },
        title: 'private-title', authToken: 'private-auth', children: new Element('span') };
    card.__reactFiber$test = { type: 'a', memoizedProps: props, pendingProps: props,
        dependencies: { firstContext: { memoizedValue: context } },
        return: { type: function NativeCard() {}, memoizedProps: { videoId: 'private-video-id' } } };
    e.setSourceCard(card);
    return Object.assign(e, { card, props, context, calls: () => calls });
}
function loggerFixture() {
    const writes = [];
    let verbose = false;
    const logger = createLogger({ name: 'My List for Netflix', version: 'test', Element,
        now: () => new Date('2026-10-02T12:34:56.789Z'), isTraceEnabled: () => verbose,
        console: { log: (...args) => writes.push(args), warn: (...args) => writes.push(args) } });
    return { logger, writes, enableTrace: () => { verbose = true; } };
}

test('disabled traces avoid payload construction while warnings retain existing detail', () => {
    const e = loggerFixture();
    let payloads = 0;
    const payload = () => { payloads++; return ['source trace', { videoId: '123', href: '/watch/123' }]; };
    e.logger.trace(payload);
    assert.equal(payloads, 0);
    assert.equal(e.writes.length, 0);
    e.logger.warn('failed source', { videoId: '123', href: '/watch/123' });
    assert.match(e.logger.entries()[0], /WARN.*123.*\/watch\/123/);
    e.enableTrace();
    e.logger.trace(payload);
    assert.equal(payloads, 1);
    assert.equal(e.writes.length, 2);
    assert.equal(e.writes[0][0], '[My List for Netflix vtest]');
});

test('circular diagnostics retain the newest 5000 entries in chronological copied-report order', () => {
    const { logger } = loggerFixture();
    for (let index = 0; index < 10003; index++) logger.log(String(index));
    const retained = logger.entries();
    assert.equal(logger.size(), 5000);
    assert.equal(retained.length, 5000);
    assert.match(retained[0], / 5003$/);
    assert.match(retained[4999], / 10002$/);
    for (let index = 1; index < retained.length; index++) assert.equal(Number(retained[index].split(' ').at(-1)), 5003 + index);
    retained.length = 0;
    assert.equal(logger.size(), 5000, 'callers cannot edit the retained buffer');
});

test('logger preserves error, DOM, circular detail and timestamp formatting', () => {
    const { logger } = loggerFixture();
    const error = new Error('failed');
    error.stack = 'stack';
    assert.deepEqual(JSON.parse(logger.formatValue(error)), { name: 'Error', message: 'failed', stack: 'stack' });
    const node = new Element('a');
    node.id = 'title';
    node.classList = { length: 2, *[Symbol.iterator]() { yield 'first'; yield 'second'; } };
    assert.equal(logger.formatValue(node), '<a#title.first.second>');
    const details = { videoId: '123', href: '/watch/123', node, error };
    details.self = details;
    const copied = JSON.parse(logger.formatValue(details));
    assert.equal(copied.videoId, '123');
    assert.equal(copied.href, '/watch/123');
    assert.equal(copied.self, '[Circular]');
    assert.equal(copied.node, '<a#title.first.second>');
    assert.equal(copied.error.stack, 'stack');
    const timestamp = logger.formatTimestamp();
    assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.789[+-]\d{2}:\d{2}$/);
    assert.equal(Date.parse(timestamp), Date.parse('2026-10-02T12:34:56.789Z'));
});

test('popup reset and current-owner checks reject stale observations without exposing counter ownership', () => {
    const e = popupProbeFixture();
    e.inspection.recordResponse([{ node: { title: 'one' } }], 1);
    const snapshot = e.inspection.diagnostics();
    snapshot.responsePages = 999;
    assert.equal(e.inspection.diagnostics().responsePages, 1);
    e.sessionToken = 2;
    e.inspection.reset();
    e.inspection.recordResponse([{ node: { title: 'old' } }], 1);
    e.inspection.capturePreview(e.card, 1);
    assert.equal(e.inspection.diagnostics().responsePages, 0);
    assert.equal(e.inspection.diagnostics().previewCaptures, 0);
    e.inspection.recordResponse([{ node: { title: 'new' } }], 2);
    assert.equal(e.inspection.diagnostics().responsePages, 1);
});

function reportFixture({ primary, fallback = true, throws = false, providers = {} } = {}) {
    const { logger } = loggerFixture();
    const document = createDocument();
    let copied = '', selected = 0, reads = 0;
    const createElement = document.createElement;
    document.createElement = tag => {
        const node = createElement(tag);
        node.select = () => { selected++; };
        return node;
    };
    document.execCommand = command => {
        assert.equal(command, 'copy');
        copied = document.body.querySelector('textarea').value;
        if (throws) throw new Error('clipboard failed');
        return fallback;
    };
    const navigator = primary ? { clipboard: { writeText: async text => { copied = text; await primary(text); } } } : {};
    const report = createReport({ logger, version: 'test', document, navigator, tLog: key => key,
        readEnvironment: () => ({ url: 'https://www.netflix.com/browse/my-list', userAgent: 'offline', browserLanguage: 'en',
            htmlLanguage: 'ja', netflixLanguage: 'ja', displayLanguage: 'ja', logLanguage: 'ja', viewport: '1280x800', devicePixelRatio: 1 }),
        readRuntime: () => { reads++; return { performanceWork: { nativeCollection: { metadataReads: 2 } } }; },
        readSeriesViewing: () => [{ title: 'Weeds', reason: 'unavailable-episode-progress' }],
        readThumbnails: () => ({ available: true }), readNativePopup: () => ({ status: 'inactive-route' }), ...providers });
    return { logger, report, document, copied: () => copied, selected: () => selected, reads: () => reads };
}

test('report copies current explicit summaries and chronological logs only on request', async () => {
    const e = reportFixture({ primary: async () => {} });
    assert.equal(e.reads(), 0);
    e.logger.log('first', { videoId: '123' });
    e.logger.warn('second', { href: '/watch/123' });
    assert.equal(await e.report.copy(), 'navigator.clipboard');
    const text = e.copied();
    assert.equal(e.reads(), 1);
    assert.match(text, /version: test\ncopiedAt:/);
    assert.match(text, /entries: 2\nsnapshot: .*metadataReads/);
    assert.match(text, /seriesViewing: .*Weeds/);
    assert.match(text, /thumbnailDiagnostics: \{"available":true\}/);
    assert.match(text, /nativePopupDiagnostics: \{"status":"inactive-route"\}/);
    assert.ok(text.indexOf('INFO  first') < text.indexOf('WARN  second'));
    assert.ok(text.endsWith('\n'));
    assert.equal(e.selected(), 0);
    assert.equal(e.document.body.children.length, 0);
});

test('compact reports summarize large collections and repeated events while detailed exports retain every entry', async () => {
    const series = Array.from({ length: 500 }, (_, index) => ({ title: 'Series ' + index,
        status: index < 300 ? 'complete' : 'unknown', reason: index < 300 ? 'latest-episode-complete' : 'unavailable-episode-progress' }));
    const e = reportFixture({ primary: async () => {}, providers: { readSeriesViewing: () => series } });
    const items = Array.from({ length: 500 }, (_, index) => ({ videoId: String(index), href: '/watch/' + index }));
    for (let index = 0; index < 1000; index++) e.logger.log('Move', { seq: index, elapsedMs: index === 400 ? 900 : 10, items });
    e.logger.warn('Source replaced', { code: 'NATIVE_SOURCE_REPLACED', videoId: '123' });
    await e.report.copy();
    const compact = e.copied();
    const summary = JSON.parse(compact.split('\n').find(line => line.startsWith('seriesViewing: ')).slice(15));
    assert.equal(summary.count, 500);
    assert.deepEqual(summary.groups.map(group => [group.status, group.count, group.samples.length]), [['complete', 300, 1], ['unknown', 200, 1]]);
    assert.match(compact, /occurrences: 1000/);
    assert.match(compact, /"seq":0/);
    assert.match(compact, /"seq":999/);
    assert.match(compact, /"seq":400,"elapsedMs":900/);
    assert.match(compact, /"count":500,"samples":.*"omitted":497/);
    assert.match(compact, /WARN.*NATIVE_SOURCE_REPLACED/);
    assert.equal(e.logger.size(), 1001);
    await e.report.copy({ detailed: true });
    assert.match(e.copied(), /exportMode: detailed/);
    assert.equal(JSON.parse(e.copied().split('\n').find(line => line.startsWith('seriesViewing: ')).slice(15)).length, 500);
    assert.ok(e.copied().includes(e.logger.entries()[400]));
    assert.ok(e.copied().length > compact.length * 20);
});

test('compact export retains late decisions and warnings even when essential summaries exceed the target', async () => {
    const snapshot = Object.fromEntries(Array.from({ length: 60 }, (_, index) => ['counter' + index, 'x'.repeat(350)]));
    const e = reportFixture({ primary: async () => {}, providers: { readRuntime: () => snapshot } });
    for (let index = 0; index < 80; index++) e.logger.log('Routine ' + index, { detail: '日'.repeat(1000) });
    e.logger.log('Fresh Netflix My List carousel bootstrap fetched', { graphqlKey: 'actual-requested-row',
        totalCount: 10, graphqlEdgeCount: 10, hasNextPage: true });
    e.logger.warn('Count reconciled', { provisionalTotalCount: 10, mountedTotalCount: 500 });
    e.logger.log('Full collection completed', { collected: 500, elapsedMs: 6961 });
    await e.report.copy();
    const text = e.copied();
    assert.match(text, /actual-requested-row/);
    assert.match(text, /"hasNextPage":true/);
    assert.match(text, /WARN.*"mountedTotalCount":500/);
    assert.match(text, /Full collection completed.*"elapsedMs":6961/);
    assert.match(text, /essential summaries exceed target/);
    assert.match(text, /omitted event groups: 0/);
    assert.ok(text.length > 20000);
    assert.equal(e.logger.size(), 83);
    for (const line of text.split('\n').filter(line => line.includes(' {'))) JSON.parse(line.slice(line.indexOf(' {') + 1));
});

test('compact aggregation retains intermediate outcomes, nested timing totals and distinguishing array samples', async () => {
    const rows = [0, 1, 2].map(index => ({ title: 'same outcome ' + index, status: 'complete', reason: 'ready' }));
    rows.push({ title: 'distinct failure', status: 'unknown', reason: 'missing-reference' });
    const e = reportFixture({ primary: async () => {}, providers: { readRuntime: () => ({ readings: [500, 500, 500, 10], rows }) } });
    e.logger.log('Preparation', { outcome: 'complete', phase: 'initial', elapsedMs: 10, nested: { settleMs: 2 } });
    e.logger.log('Preparation', { outcome: 'mismatch', phase: 'initial', elapsedMs: 3, nested: { settleMs: 1 } });
    e.logger.log('Preparation', { outcome: 'complete', phase: 'initial', elapsedMs: 20, nested: { settleMs: 4 } });
    e.logger.log('Preparation', { outcome: 'complete', phase: 'retry', elapsedMs: 5 });
    await e.report.copy();
    const text = e.copied();
    assert.match(text, /"outcome":"mismatch"/);
    assert.match(text, /"phase":"retry"/);
    assert.match(text, /distinct failure/);
    const snapshot = JSON.parse(text.split('\n').find(line => line.startsWith('snapshot: ')).slice(10));
    assert.deepEqual(snapshot.readings.values, [{ value: 500, count: 3 }, { value: 10, count: 1 }]);
    const summary = JSON.parse(text.split('\n').find(line => line.includes('eventSummary: ') && line.includes('"occurrences":2')).split('eventSummary: ')[1]);
    assert.deepEqual(summary.numbers.elapsedMs, { count: 2, min: 10, max: 20, total: 30 });
    assert.deepEqual(summary.numbers['nested.settleMs'], { count: 2, min: 2, max: 4, total: 6 });
});

test('compact reports distinguish manual and automatic results and retain long diagnostic reasons', async () => {
    const reason = 'distinct-reason-'.repeat(40);
    const series = [{ status: 'complete', reason: 'unavailable', automaticStatus: 'unknown', manualChoice: 'complete' },
        { status: 'complete', reason: 'unavailable', automaticStatus: 'complete', manualChoice: null }];
    const e = reportFixture({ primary: async () => {}, providers: { readSeriesViewing: () => series } });
    e.logger.log('Decision', { reason });
    await e.report.copy();
    assert.ok(e.copied().includes(reason));
    const summary = JSON.parse(e.copied().split('\n').find(line => line.startsWith('seriesViewing: ')).slice(15));
    assert.equal(summary.groups.length, 2);
    assert.equal(summary.groups[0].samples[0].manualChoice, 'complete');
    assert.equal(summary.groups[1].samples[0].automaticStatus, 'complete');
    await e.report.copy({ detailed: true });
    assert.ok(e.copied().includes(reason));
    assert.deepEqual(JSON.parse(e.copied().split('\n').find(line => line.startsWith('seriesViewing: ')).slice(15)), series);
});

test('clipboard rejection falls back once and releases its owned textarea on success or failure', async () => {
    const rejected = reportFixture({ primary: async () => { throw new Error('denied'); } });
    assert.equal(await rejected.report.copy(), 'execCommand');
    assert.equal(rejected.selected(), 1);
    assert.equal(rejected.document.body.children.length, 0);
    assert.match(rejected.logger.entries()[0], /WARN.*clipboardFallback.*denied/);
    for (const options of [{ fallback: false }, { throws: true }]) {
        const failed = reportFixture(options);
        await assert.rejects(failed.report.copy(), /execCommandCopyFailed|clipboard failed/);
        assert.equal(failed.document.body.children.length, 0);
    }
});

test('initial response diagnostics distinguish wrapped scalar metadata from absent or type-only fields without exporting values', () => {
    const e = popupEnvironment();
    const node = { id: 'private-video-id', displayString: { __typename: 'Text', text: 'private-title' },
        synopsis: { __typename: 'Text', text: null }, contextualArtwork: { url: 'https://private.test/image.jpg' },
        runtime: 3600, releaseYear: 2024, maturity: { value: '18' }, genres: ['private-genre'],
        seasons: null, preview: { url: 'https://private.test/preview' }, inMyList: false,
        authToken: 'private-auth', profile: { synopsis: 'private-profile' } };
    e.inspection.recordResponse([{ node }], e.sessionToken);
    const report = e.inspection.diagnostics();
    assert.equal(report.sampledCards, 1);
    assert.equal(report.titleScalar, 1);
    assert.equal(report.synopsisPresent, 1);
    assert.equal(report.synopsisScalar, 0, '__typename alone is not a scalar metadata value');
    assert.equal(report.artworkScalar, 1);
    assert.equal(report.seasonsPresent, 1);
    assert.equal(report.seasonsScalar, 0);
    assert.equal(report.membershipScalar, 1, 'false is an actual value');
    assert.equal(report.playbackPresent, 0);
    assert.match(report.fieldPaths, /node.displayString.text/);
    assert.doesNotMatch(JSON.stringify(report), /private-|https:|3600|2024|__typename|authToken|profile/);
    assert.ok(Object.values(report).every(value => value === null || typeof value !== 'object'));
});

test('response surveys sample across each page and cap pages, paths, nodes, depth and arrays even with cycles', () => {
    const e = popupEnvironment();
    const node = { genres: Array.from({ length: 10000 }, () => ({ text: 'private-genre' })) };
    node.self = node;
    for (let index = 0; index < 80; index++) node['field' + index] = { synopsis: { text: 'private-plot' } };
    const edges = Array.from({ length: 75 }, () => ({ node: { id: 'private-id' } }));
    edges[74] = { node: { synopsis: 'last-card-plot' } };
    for (let index = 0; index < 12; index++) e.inspection.recordResponse(edges, e.sessionToken);
    const report = e.inspection.diagnostics();
    assert.equal(report.responsePages, 8);
    assert.equal(report.skippedPages, 4);
    assert.equal(report.sampledCards, 32);
    assert.equal(report.synopsisScalar, 8, 'the final card is sampled as well as the first');
    assert.equal(report.identityScalar, 24);
    e.inspection.reset();
    e.inspection.recordResponse([{ node }], e.sessionToken);
    const survey = e.inspection.diagnostics();
    assert.ok(survey.responseNodes <= 48);
    assert.ok(survey.fieldPaths.split('|').length <= 32);
    assert.equal(survey.truncatedCards, 1);
    let deep = { synopsis: 'deep-plot' };
    for (let index = 0; index < 12; index++) deep = { wrapper: deep };
    e.inspection.reset();
    e.inspection.recordResponse([{ node: deep }], e.sessionToken);
    const deepSurvey = e.inspection.diagnostics();
    assert.equal(deepSurvey.truncatedCards, 1);
    assert.equal(deepSurvey.synopsisScalar, 0);
});

test('response diagnostic failures and private getters cannot break collection', () => {
    const e = popupEnvironment();
    let reads = 0;
    const node = {};
    Object.defineProperty(node, 'synopsis', { enumerable: true, get() { reads++; throw new Error('private-error'); } });
    e.inspection.recordResponse([{ node }], e.sessionToken);
    assert.equal(reads, 0);
    assert.equal(e.inspection.diagnostics().synopsisScalar, 0);
    const hostile = new Proxy({}, { ownKeys() { throw new Error('private-error'); } });
    assert.doesNotThrow(() => e.inspection.recordResponse([{ node: hostile }], e.sessionToken));
    assert.equal(e.inspection.diagnostics().failures, 1);
    assert.doesNotMatch(JSON.stringify(e.inspection.diagnostics()), /private-error/);
});

test('native source and context reports expose callback shapes without calling them or retaining their objects or source', () => {
    const e = popupProbeFixture();
    const report = e.inspection.collect();
    assert.equal(report.source.status, 'read-only-candidates');
    assert.equal(report.source.components.length, 2);
    assert.ok(report.source.functions.some(row => row.path.endsWith('.props.onPointerEnter') &&
        row.arity === 1 && row.hints.includes('currentTarget')));
    assert.ok(report.source.functions.some(row => row.path.endsWith('.context0.popup.open') && row.arity === 2));
    assert.equal(e.calls(), 0);
    assert.doesNotMatch(JSON.stringify(report), /private-|authToken|return \{|calls\+\+|function NativeCard/);
    assert.equal(report.preview, null);
    e.inspection.capturePreview(e.card, e.sessionToken);
    const saved = e.inspection.diagnostics().previewShape;
    e.card.__reactFiber$test.memoizedProps = null;
    e.inspection.capturePreview(e.card, e.sessionToken);
    assert.equal(e.inspection.diagnostics().previewCaptures, 1);
    assert.equal(e.inspection.diagnostics().previewShape, saved);
    assert.equal(e.inspection.collect().preview.status, 'read-only-candidates');
    assert.equal(e.calls(), 0);
});

test('native shape probes skip getters and custom toString, cap cyclic/wide graphs and inspect only a bounded function prefix', () => {
    const e = popupProbeFixture();
    let reads = 0;
    Object.defineProperty(e.props, 'onMouseOver', { enumerable: true, get() { reads++; throw new Error('private-error'); } });
    e.props.onPointerEnter.toString = () => { reads++; throw new Error('private-error'); };
    e.context.self = e.context;
    e.props.longHandler = function longNativeHandler() {/*native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. native handler source padding. */ return "preview";};
    for (let index = 0; index < 80; index++) e.props['handler' + index] = () => { reads++; };
    const report = e.inspection.collect().source;
    assert.equal(reads, 0);
    assert.equal(report.accessorsSkipped, 1);
    assert.ok(report.functions.length <= 24);
    assert.ok(report.holders <= 32);
    assert.ok(report.fields.length <= 32);
    assert.equal(report.truncated, true);
    const long = report.functions.find(row => row.path.endsWith('.longHandler'));
    assert.equal(long.sourceTruncated, true);
    assert.equal(long.hints.includes('preview'), false, 'hints after the bounded prefix are not inspected');
});

test('Copy Logs guards inactive routes and isolates private probe failures', () => {
    const e = popupProbeFixture();
    e.setSourceReader(() => { throw new Error('private-error'); });
    e.active = false;
    assert.equal(e.inspection.collect().status, 'inactive-route');
    e.active = true;
    assert.equal(e.inspection.collect().status, 'probe-failed');
    const hostile = new Proxy({}, { ownKeys() { throw new Error('private-error'); } });
    assert.doesNotThrow(() => e.inspection.capturePreview(hostile, e.sessionToken));
    assert.equal(JSON.parse(e.inspection.diagnostics().previewShape).status, 'partial-probe');
    assert.doesNotMatch(e.inspection.diagnostics().previewShape, /private-error/);
});


test('compact logs preserve bounded navigation order, four-coordinate rectangles and deeply nested action samples', async () => {
    const { logger } = loggerFixture(); let text;
    const navigation = { recent: [{ loading: { control: { parents: [{ rect: [0, 565, 2560, 279] }] } } }],
        movements: Array.from({ length: 12 }, (_, at) => ({ at, kind: 'hover', id: String(at) })),
        actions: [{ before: { ids: ['1','2','3','4'] }, samples: [{ state: { cardPositions: [{ id: '2', rect: [10,20,30,40] }] } }] }] };
    const report = createReport({ logger, version: 'test', document: createDocument(), navigator: {}, tLog: key => key,
        readEnvironment: () => ({}), writeText: value => { text = value; }, readRuntime: () => ({ recommendations: { navigation } }),
        readSeriesViewing: () => [], readThumbnails: () => ({}), readNativePopup: () => ({}) });
    await report.copy();
    const snapshot = JSON.parse(text.split('\n').find(line => line.startsWith('snapshot: ')).slice(10));
    assert.deepEqual(snapshot.recommendations.navigation, navigation);
});
