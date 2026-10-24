import { queryFixture } from './helpers/recommendation-query.js';
import { knowledgeSnapshot, fact, storageClient } from './helpers/knowledge.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionBrowser } from './helpers/session-browser.js';
import { createRecommendations } from '../src/recommendations/recommendations.js';
import { createRecommendationDom } from '../src/netflix/recommendation-dom.js';
import { createApplication } from '../src/app/application.js';
import { createKnowledge } from '../src/viewing/knowledge.js';
import { createI18n } from '../src/i18n/i18n.js';
import { UI_MESSAGES } from '../src/i18n/ui-messages.js';
import { createBrowser } from './helpers/browser.js';
import { Element } from './helpers/dom.js';

function mount(b, id = '1', { legacy = false, progress = false } = {}) {
    const row = b.document.body.appendChild(new Element('section'));
    const host = row.appendChild(new Element('div'));
    if (legacy) host.className = 'slider-item'; else host.setAttribute('data-virtual-slot', '0');
    const card = host.appendChild(new Element(legacy ? 'div' : 'a'));
    card.setAttribute('data-video-type', 'movie');
    if (legacy) { card.className = 'title-card'; const link = card.appendChild(new Element('a')); link.setAttribute('href', '/title/' + id); }
    else { card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/browse?jbv=' + id); }
    if (progress) row.appendChild(new Element('div')).setAttribute('data-uia', 'progress-card');
    return { row, host, card };
}
function setup(options = {}) {
    const b = createBrowser(), saved = options.storage || new Map(); let profile = 'A';
    if (options.PerformanceObserver) b.context.PerformanceObserver = options.PerformanceObserver;
    const userscript = { ...storageClient(saved), ...options };
    const tUi = createI18n({ readLanguage: () => 'en' }).tUi;
    const feature = createRecommendations({ environment: b.context, context: { activeProfile: () => { options.onProfileRead?.(); return profile; } }, userscript, tUi, viewingData: options.viewingData, log: options.log });
    return { ...b, saved, userscript, feature, select: value => { profile = value; },
        click(host, label) { const button = host.querySelectorAll('button').find(node => node.textContent === label);
            assert.ok(button, label); this.document.dispatchEvent({ type: 'click', target: button, preventDefault() {}, stopImmediatePropagation() {} }); },
        restore(id) {
            const root = this.document.querySelector('.tm-rec-manager');
            if (root.querySelector('section').hidden) this.click(root, root.querySelector('button').textContent);
            const row = root.querySelectorAll('.tm-rec-saved-row').find(node => node.querySelector('a').getAttribute('href') === `/title/${id}`);
            assert.ok(row); this.click(row, '\u00d7');
        },
        mutate(target, extra = {}) { this.observers.find(o => o.active).callback([{ type: 'childList', target, ...extra }]); } };
}
function nextControl(b, row, click, hawkins = true) {
    const button = row.appendChild(new Element('button'));
    button.setAttribute('data-uia', hawkins ? 'carousel-hawkins-right-button' : 'carousel-right-button'); button.click = click;
    return button;
}

test('retirement continues after a control removal failure and releases native leases and later cards', () => {
    const b = setup(), first = mount(b), second = mount(b, '2');
    b.feature.check(); b.click(first.host, 'Hide suggestion'); b.click(second.host, 'Hide suggestion');
    first.host.querySelector('.tm-rec-controls').remove = () => { throw Error('remove failed'); };
    assert.doesNotThrow(() => b.feature.dispose());
    assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(b.document.head.querySelectorAll('style').length, 0);
    for (const item of [first, second]) {
        assert.equal(item.host.style.getPropertyValue('display'), '');
        assert.equal(item.row.style.getPropertyValue('padding-bottom'), '');
        assert.equal(item.card.style.getPropertyValue('visibility'), '');
    }
    assert.equal(b.document.listenerCount('click'), 0);
    assert.equal(b.scheduler.frames.size, 0); assert.equal(b.scheduler.timers.size, 0);
    assert.equal(b.feature.diagnostics().work.cleanupFailures, 1);
});

test('a failed native property restoration cannot retain other properties or shared row leases', () => {
    const b = setup(), first = mount(b), second = mount(b, '2');
    first.row.appendChild(second.host); second.row.remove();
    b.feature.check(); b.click(first.host, 'Hide suggestion'); b.click(second.host, 'Hide suggestion');
    const remove = first.card.style.removeProperty.bind(first.card.style);
    first.card.style.removeProperty = key => { if (key === 'visibility') throw Error('native property failed'); return remove(key); };
    assert.doesNotThrow(() => b.feature.dispose());
    assert.equal(first.card.style.getPropertyValue('pointer-events'), '');
    assert.equal(first.card.getAttribute('aria-hidden'), null);
    assert.equal(first.card.getAttribute('tabindex'), null);
    assert.equal(first.row.style.getPropertyValue('padding-bottom'), '');
    assert.equal(second.card.style.getPropertyValue('visibility'), '');
    assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(b.feature.diagnostics().layout.retirementErrors, 1);
});

test('a reentrant check starts only after retired leases finish and survives the old disposal', async () => {
    const b = setup(), item = mount(b); b.feature.check();
    const old = item.host.querySelector('.tm-rec-controls'), remove = old.remove.bind(old);
    const oldDelivery = b.observers.find(observer => observer.active).callback;
    const initialScans = b.feature.diagnostics().work.scans;
    let checks = 0;
    old.remove = () => { b.feature.check(); b.feature.check(); checks++; remove(); };
    b.feature.dispose();
    assert.equal(checks, 1);
    assert.equal(b.feature.diagnostics().active, true);
    assert.equal(b.feature.diagnostics().work.scans, initialScans + 1, 'reentrant checks coalesce into one activation');
    const replacement = item.host.querySelector('.tm-rec-controls');
    assert.ok(replacement); assert.notEqual(replacement, old);
    assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 1);
    assert.equal(b.document.head.querySelectorAll('style').length, 1);
    assert.equal(b.window.listenerCount('resize'), 1);
    assert.equal(item.row.style.getPropertyValue('padding-bottom'), '72px');
    const scans = b.feature.diagnostics().work.scans;
    oldDelivery([{ type: 'childList', target: item.row, addedNodes: [item.host] }]); await b.scheduler.flush();
    assert.equal(b.feature.diagnostics().work.scans, scans, 'retired observer delivery cannot reconcile the replacement');
    b.feature.dispose(); b.feature.dispose();
    assert.equal(item.row.style.getPropertyValue('padding-bottom'), '');
    assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(b.scheduler.frames.size, 0); assert.equal(b.scheduler.timers.size, 0);
});

test('a nested disposal cancels an earlier reentrant restart request', () => {
    const b = setup(), item = mount(b); b.feature.check();
    const old = item.host.querySelector('.tm-rec-controls'), remove = old.remove.bind(old);
    old.remove = () => { b.feature.check(); b.feature.dispose(); remove(); };
    b.feature.dispose();
    assert.equal(b.feature.diagnostics().active, false);
    assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(b.document.head.querySelectorAll('style').length, 0);
    assert.equal(b.scheduler.frames.size, 0);
});

test('native card leases retire once and a repeated release cannot restore over a replacement', () => {
    const b = createBrowser(), item = mount(b), dom = createRecommendationDom(b.context);
    const value = dom.describe(item.card), old = dom.lease(value);
    old.hide(true); old.release();
    assert.equal(old.current(), false);
    const replacement = dom.lease(value);
    replacement.hide(true); old.release();
    assert.equal(replacement.current(), true);
    assert.equal(item.host.style.getPropertyValue('display'), 'none');
    assert.equal(item.row.style.getPropertyValue('padding-bottom'), '72px');
    replacement.release();
    assert.equal(item.host.style.getPropertyValue('display'), '');
    assert.equal(item.row.style.getPropertyValue('padding-bottom'), '');
});

test('recommendation timing measures actual scan phases and retires activity probes on profile and route changes', async () => {
    const b = setup(), a = mount(b);
    const describe = a.card.getAttribute.bind(a.card);
    let clock = 0;
    b.context.performance.now = () => clock++;
    a.card.getAttribute = name => { clock += 2; return describe(name); };
    b.feature.check(); await b.scheduler.flush();
    const timing = b.feature.diagnostics().workTiming;
    assert.ok(timing.tasks > 0); assert.ok(timing.worstTask.elapsedMs > 16);
    assert.ok(Object.hasOwn(timing.worstTask.phases, 'validation'));
    assert.ok(Object.hasOwn(timing.worstTask.phases, 'nativeRows'));
    clock += 100; await b.scheduler.frame();
    assert.ok(b.feature.diagnostics().workTiming.worstFrame.work.scans > 0);
    const old = [...b.scheduler.frames.values()][0];
    b.select('B'); b.feature.check(); await b.scheduler.flush();
    const before = b.feature.diagnostics().workTiming.callbacks; old();
    assert.equal(b.feature.diagnostics().workTiming.callbacks, before);
    b.location.pathname = '/watch/1'; b.feature.check();
    assert.equal(b.scheduler.frames.size, 0);
});
test('dismissals preserve the page while native flow pulls mounted later cards into view', async () => {
    for (const label of ['Mark watched', 'Mark caught up', 'Hide suggestion']) {
        const b = setup({ viewingData: seriesMetadata() }), a = mount(b), second = mount(b, '2'), buffered = mount(b, '3'), other = mount(b, '4');
        for (const item of [second, buffered]) { a.row.appendChild(item.host); item.row.remove(); }
        a.row.setAttribute('data-uia', 'carousel-scroller'); a.row.scrollLeft = 400;
        a.row.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 100 });
        for (const item of [a, second, buffered]) item.host.getBoundingClientRect = () => {
            const visible = [a, second, buffered].filter(item => item.host.style.getPropertyValue('display') !== 'none');
            const left = visible.indexOf(item) * 200;
            return { left, right: left + 200, width: visible.includes(item) ? 200 : 0 };
        };
        const indicator = a.row.appendChild(new Element('span')); indicator.setAttribute('data-indicator-selected', 'true');
        if (label === 'Mark caught up') a.card.removeAttribute('data-video-type');
        let moves = 0; nextControl(b, a.row, () => { moves++; a.row.scrollLeft += 400; });
        nextControl(b, other.row, () => { moves++; });
        b.feature.check(); await b.scheduler.flush(); assert.equal(buffered.host.getBoundingClientRect().left, 400);
        b.click(a.host, label); await b.scheduler.advance(250);
        assert.equal(moves, 0); assert.equal(a.row.scrollLeft, 400);
        assert.equal(indicator.getAttribute('data-indicator-selected'), 'true');
        assert.equal(second.host.getBoundingClientRect().left, 0); assert.equal(buffered.host.getBoundingClientRect().left, 200);
        assert.equal(buffered.card.getAttribute('href'), '/browse?jbv=3');
        assert.equal(buffered.host.parentElement, a.row); assert.equal(second.host.style.getPropertyValue('display'), '');
        assert.equal(b.feature.diagnostics().refill.checks, 1);
        b.feature.check(); await b.scheduler.advance(1000); assert.equal(moves, 0);
        b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});

test('rapid dismissals share one stationary check without replaying navigation', async () => {
    const b = setup(), a = mount(b), second = mount(b, '2');
    a.row.appendChild(second.host); second.row.remove(); let moves = 0;
    nextControl(b, a.row, () => { moves++; }); b.feature.check();
    b.click(a.host, 'Hide suggestion'); b.click(second.host, 'Mark watched');
    assert.equal(b.feature.diagnostics().refill.pending, 1);
    await b.scheduler.advance(250); assert.equal(b.feature.diagnostics().refill.checks, 1);
    b.feature.check(); await b.scheduler.advance(5000); assert.equal(moves, 0); assert.equal(b.scheduler.timers.size, 0);
    assert.equal(b.feature.diagnostics().refill.unavailable, 1); b.feature.dispose();
});

test('empty rows and saved dismissals never auto-advance, including after scrolling or control changes', async () => {
    const b = setup(), a = mount(b); let moves = 0;
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'hide' } });
    const next = nextControl(b, a.row, () => { moves++; }); next.disabled = true;
    b.feature.check(); await b.scheduler.advance(250); next.disabled = false;
    b.feature.check(); b.window.dispatchEvent({ type: 'scroll' }); await b.scheduler.advance(5000);
    assert.equal(moves, 0); assert.equal(b.scheduler.timers.size, 0); b.feature.dispose();
});

test('failed saves cannot schedule stationary checks or navigation', async () => {
    const b = setup(), a = mount(b); let moves = 0; nextControl(b, a.row, () => { moves++; }); b.feature.check();
    b.userscript.setValue = () => { throw new Error('save failed'); }; b.click(a.host, 'Hide suggestion');
    await b.scheduler.advance(1000); assert.equal(moves, 0); assert.equal(b.feature.diagnostics().refill.checks, 0);
    assert.equal(a.host.style.getPropertyValue('display'), ''); b.feature.dispose();
});

test('restoring rapid dismissals cancels the check only when every triggering choice is restored', async () => {
    for (const restoreAll of [true, false]) {
        const b = setup(), a = mount(b), second = mount(b, '2');
        a.row.appendChild(second.host); second.row.remove();
        b.feature.check(); b.click(a.host, 'Mark watched'); b.click(second.host, 'Hide suggestion');
        b.restore('1'); if (restoreAll) b.restore('2');
        await b.scheduler.advance(250); assert.equal(b.feature.diagnostics().refill.checks, restoreAll ? 0 : 1);
        b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});

function seriesMetadata(readCoverage = () => [['101', 2]]) {
    return { beginRead: () => ({ profileGuid: 'A' }),
        async readTitles(ids) { return new Map(ids.map(id => [id, { videoId: id, type: 'show' }])); },
        async readSeasons(records) { return records.map(record => ({ videoId: record.videoId,
            seasons: readCoverage().map(([id, count]) => ({ id, count })) })); } };
}

test('unchanged browsing scans do not repeatedly resolve every saved film against page context', async () => {
    const counts = [];
    for (const saved of [0, 1000]) {
        const prefix = 'legacyMyListForNetflix.knowledge.v2.A.', storage = new Map([[prefix + 'migrated', true]]);
        for (let id = 10000; id < 10000 + saved; id++) storage.set(prefix + id + '.completion', { type: 'movie', coverage: null, observedAt: 1 });
        let reads = 0;
        const b = setup({ storage, onProfileRead: () => reads++ });
        for (let id = 1; id <= 40; id++) mount(b, String(id));
        b.feature.check(); await b.scheduler.flush();
        reads = 0; b.feature.check(); counts.push(reads); b.feature.dispose();
    }
    assert.ok(counts[1] <= counts[0] + 20, 'unchanged page work does not grow with saved-film history: ' + counts);
});

test('remote knowledge changes repaint only affected mounted recommendation cards', async () => {
    const b = setup(), first = mount(b, '1'), second = mount(b, '2');
    b.feature.check(); await b.scheduler.flush();
    const writer = createKnowledge({ ...storageClient(b.saved), activeProfile: () => 'A' }); writer.view().sync();
    const before = b.feature.diagnostics().work.paintCalls;
    writer.remember('1', { type: 'movie', status: 'complete' }); await b.scheduler.flush();
    assert.equal(first.host.style.getPropertyValue('display'), 'none');
    assert.equal(second.host.style.getPropertyValue('display'), '');
    assert.equal(b.feature.diagnostics().work.paintCalls - before, 1);
    writer.dispose(); b.feature.dispose();
});

test('full incidental name history keeps browsing choices and panel restoration usable', async () => {
    const prefix = 'legacyMyListForNetflix.knowledge.v2.A.', storage = new Map([[prefix + 'migrated', true]]);
    for (let id = 1; id <= 5000; id++) storage.set(prefix + id + '.label', { name: 'Encountered ' + id });
    const b = setup({ storage }), first = mount(b, '6001'), second = mount(b, '6002');
    b.feature.check(); await b.scheduler.flush();
    b.click(first.host, 'Mark watched'); b.click(second.host, 'Hide suggestion');
    assert.equal(first.host.style.getPropertyValue('display'), 'none');
    assert.equal(second.host.style.getPropertyValue('display'), 'none');
    assert.equal(b.feature.diagnostics().storageFailed, false);
    b.restore('6001'); b.restore('6002');
    assert.equal(first.host.style.getPropertyValue('display'), ''); assert.equal(second.host.style.getPropertyValue('display'), '');
    b.feature.dispose();
});

test('series Mark caught up and movie Mark watched share My List storage, with separate panel groups', async () => {
    const b = setup({ viewingData: seriesMetadata() }), series = mount(b), movie = mount(b, '2'), hidden = mount(b, '3');
    series.card.removeAttribute('data-video-type'); b.feature.check();
    assert.equal(series.host.querySelector('button').disabled, true); await b.scheduler.flush();
    b.click(series.host, 'Mark caught up'); b.click(movie.host, 'Mark watched'); b.click(hidden.host, 'Hide suggestion');
    const shared = knowledgeSnapshot(b.saved, 'A').choices;
    assert.deepEqual(shared['1'], { status: 'complete', type: 'series', coverage: [['101', 2]] });
    assert.deepEqual(shared['2'], { status: 'complete', type: 'movie', coverage: null });
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations.choices, { 3: 'hide' });
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, root.querySelector('button').textContent);
    assert.deepEqual(root.querySelectorAll('h3').map(node => node.textContent), ['Films', 'Series', 'Suggestion hidden']);
    b.restore('1'); assert.equal(series.host.style.getPropertyValue('display'), '');
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'].status, 'main');
});

test('caught-up expiry uses shared policy for added episodes and a new season on later page entry', async () => {
    for (const added of [[['101', 3]], [['101', 2], ['102', 1]]]) {
        let coverage = [['101', 2]];
        const b = setup({ viewingData: seriesMetadata(() => coverage) }), a = mount(b); a.card.removeAttribute('data-video-type');
        b.feature.check(); await b.scheduler.flush(); b.click(a.host, 'Mark caught up');
        b.feature.dispose(); coverage = added; b.feature.check(); await b.scheduler.flush();
        assert.equal(a.host.style.getPropertyValue('display'), '');
        assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'], undefined);
        assert.equal(b.feature.diagnostics().hiddenCount, 0);
    }
});

test('saved caught-up series are rechecked even when Netflix has no mounted card for them', async () => {
    const b = setup({ viewingData: seriesMetadata(() => [['101', 3]]) });
    b.saved.set('legacyMyListForNetflix.viewingChoices.v1.A', { version: 1,
        choices: { 1: { status: 'complete', type: 'series', coverage: [['101', 2]] } } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(b.feature.diagnostics().hiddenCount, 0);
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'], undefined);
});

test('legacy browsing series remain unverified while films migrate and hides survive', async () => {
    const b = setup({ viewingData: { ...seriesMetadata(),
        async readTitles(ids) { return new Map(ids.map(id => [id, { videoId: id, type: id === '2' ? 'movie' : 'show' }])); } } });
    const a = mount(b), film = mount(b, '2'); a.card.removeAttribute('data-video-type'); film.card.removeAttribute('data-video-type');
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'watched', 2: 'watched', 3: 'hide' }, titles: { 1: 'Series', 2: 'Film' } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(a.host.style.getPropertyValue('display'), ''); assert.equal(film.host.style.getPropertyValue('display'), 'none');
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations.choices, { 3: 'hide' });
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'], undefined);
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['2'].type, 'movie');
});

test('missing series metadata preserves existing coverage and disables new caught-up choices without affecting Hide', async () => {
    const b = setup({ viewingData: { ...seriesMetadata(), async readSeasons() { return []; } } }), a = mount(b); a.card.removeAttribute('data-video-type');
    b.saved.set('legacyMyListForNetflix.viewingChoices.v1.A', { version: 1,
        choices: { 9: { status: 'complete', type: 'series', coverage: [['101', 2]] } } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(a.host.querySelector('button').textContent, 'Mark caught up'); assert.equal(a.host.querySelector('button').disabled, true);
    b.click(a.host, 'Mark caught up'); assert.equal(a.host.style.getPropertyValue('display'), '');
    b.click(a.host, 'Hide suggestion'); assert.equal(a.host.style.getPropertyValue('display'), 'none');
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').choices['9'].coverage, [['101', 2]]);
});

test('an exhausted metadata lookup shows unavailable and a new visit recovers the watched action', async () => {
    let available = false;
    const b = setup({ viewingData: { ...seriesMetadata(), async readTitles(ids) {
        return available ? new Map(ids.map(id => [id, { videoId: id, type: 'movie' }])) : new Map();
    } } }), a = mount(b); a.card.removeAttribute('data-video-type');
    b.feature.check(); await b.scheduler.flush(); await b.scheduler.advance(1000); await b.scheduler.advance(2000);
    let button = a.host.querySelector('button'); assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Viewing details unavailable');
    available = true; b.feature.dispose(); b.feature.check(); await b.scheduler.flush();
    button = a.host.querySelector('button'); assert.equal(button.textContent, 'Mark watched'); assert.equal(button.disabled, false);
    b.click(a.host, 'Mark watched'); assert.equal(a.host.style.getPropertyValue('display'), 'none'); b.feature.dispose();
});

test('mounted titles beyond the pending-queue capacity are admitted as earlier metadata batches finish', async () => {
    const b = setup({ viewingData: { ...seriesMetadata(), async readTitles(ids) {
        return new Map(ids.map(id => [id, { videoId: id, type: 'movie' }]));
    } } });
    const items = [];
    for (let i = 1; i <= 510; i++) { const item = mount(b, String(i)); item.card.removeAttribute('data-video-type'); items.push(item); }
    b.feature.check(); for (let i = 0; i < 50; i++) await b.scheduler.flush();
    const button = items.at(-1).host.querySelector('button');
    assert.equal(button.textContent, 'Mark watched'); assert.equal(button.disabled, false);
    assert.equal(b.feature.diagnostics().viewing.checked, 510); b.feature.dispose();
});

test('metadata delivered after a profile switch cannot classify, expire or write into the new profile', async () => {
    let resolve;
    const b = setup({ viewingData: { ...seriesMetadata(), readTitles: () => new Promise(done => { resolve = done; }) } }), a = mount(b);
    a.card.removeAttribute('data-video-type'); b.feature.check(); await b.scheduler.flush();
    b.select('B'); b.feature.check(); resolve(new Map([['1', { videoId: '1', type: 'show' }]])); await b.scheduler.flush();
    assert.equal([...b.saved.keys()].filter(key => /\.\d+\.(manual|completion|hidden)$/.test(key)).length, 0); assert.equal(a.host.style.getPropertyValue('display'), '');
    b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('stationary checks cancel on Undo, profile change, route exit and disposal', async () => {
    for (const change of [b => b.restore('1'), b => b.select('B'), b => { b.location.pathname = '/watch/1'; }, b => b.feature.dispose()]) {
        const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched'); change(b);
        await b.scheduler.advance(250); assert.equal(b.feature.diagnostics().refill.checks, 0);
        b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});

test('user navigation remains usable and newly mounted cards honor saved dismissals', async () => {
    const b = setup(), a = mount(b); let moves = 0;
    const next = nextControl(b, a.row, () => { moves++; a.card.setAttribute('href', '/title/2'); });
    b.feature.check(); b.click(a.host, 'Hide suggestion'); await b.scheduler.advance(250); assert.equal(moves, 0);
    next.click(); b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush();
    assert.equal(a.host.style.getPropertyValue('display'), ''); assert.equal(a.host.querySelectorAll('button').length, 2);
    a.card.setAttribute('href', '/title/1'); b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush();
    assert.equal(a.host.style.getPropertyValue('display'), 'none'); assert.equal(moves, 1); assert.equal(b.requests.length, 0);
    b.feature.dispose();
});

test('replacement of the row scroller rejects a pending stationary check', async () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    const scroller = a.row.appendChild(new Element('div')); scroller.setAttribute('data-uia', 'carousel-scroller');
    scroller.appendChild(a.host); b.feature.check(); await b.scheduler.advance(250);
    assert.equal(b.feature.diagnostics().refill.checks, 0); b.feature.dispose();
});

test('stationary loading diagnostics are bounded and never invoke callbacks or read cursor/credential values', async () => {
    const events = [], b = setup({ log: (...args) => events.push(args) }), a = mount(b); let calls = 0;
    const props = { loadMore() { calls++; }, endCursor: 'private-cursor', authURL: 'private-auth' };
    Object.defineProperty(props, 'fetchMore', { enumerable: true, get() { calls++; throw new Error('must not read'); } });
    let fiber = { type: 'Carousel', memoizedProps: props };
    a.card.__reactFiber$test = fiber;
    for (let i = 0; i < 40; i++) { fiber.return = { type: 'Parent', memoizedProps: props }; fiber = fiber.return; }
    fiber.return = a.card.__reactFiber$test;
    b.feature.check(); b.click(a.host, 'Hide suggestion'); await b.scheduler.advance(250);
    const facts = events.find(([name]) => name === 'Stationary recommendation refill checked')[1];
    assert.equal(facts.loading.length, 6); assert.equal(calls, 0);
    assert.ok(facts.loading[0].properties.some(property => property.name === 'loadMore' && property.type === 'function'));
    assert.ok(!JSON.stringify(facts).includes('private-cursor')); assert.ok(!JSON.stringify(facts).includes('private-auth'));
    b.feature.dispose();
});

test('live recommendation controls persist both reasons, hide duplicates and Undo without server requests', () => {
    const b = setup(), a = mount(b), duplicate = mount(b), other = mount(b, '2', { legacy: true });
    other.card.querySelector('a').setAttribute('href', '/watch/2');
    b.feature.check(); assert.equal(a.host.querySelectorAll('button').length, 2);
    b.click(a.host, 'Mark watched');
    assert.equal(a.card.style.visibility, 'hidden'); assert.equal(duplicate.card.style.visibility, 'hidden');
    assert.equal(other.card.style.visibility, undefined); assert.equal(b.requests.length, 0);
    b.restore('1'); assert.equal(a.card.style.visibility, undefined);
    b.click(other.host, 'Hide suggestion'); assert.equal(other.card.style.visibility, 'hidden');
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations, { version: 1, choices: { 2: 'hide' }, titles: {} });
    b.feature.dispose(); b.feature.check(); assert.equal(other.card.style.visibility, 'hidden');
    b.feature.dispose(); assert.equal(other.card.style.visibility, undefined);
    assert.equal(b.document.head.querySelectorAll('style').length, 0); assert.equal(b.requests.length, 0);
});
test('recommendation profile changes reject old controls and isolate saved choices', async () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    b.select('B'); b.click(a.host, 'Mark watched'); assert.equal(a.card.style.visibility, undefined);
    assert.ok(b.saved.size >= 2); b.click(a.host, 'Hide suggestion');
    assert.equal(fact(b.saved, 'B', '1', 'hidden').hidden, true); b.select('A'); b.feature.check();
    assert.equal(a.host.style.getPropertyValue('display'), 'none');
    const next = mount(b, '2'); b.mutate(next.row, { addedNodes: [next.host] }); await b.scheduler.flush();
    assert.ok(next.host.querySelector('.tm-rec-controls'), 'the active observer remains admitted across profile changes');
    b.select(null); b.feature.check(); assert.equal(a.host.querySelectorAll('button').length, 0);
    assert.equal(a.card.style.visibility, undefined);
    b.feature.dispose();
});
test('recycled native slots retire old visibility and controls; newly mounted titles receive choices', async () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    a.card.setAttribute('href', '/title/2'); b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush();
    assert.equal(a.card.style.visibility, undefined); assert.equal(a.host.querySelectorAll('button').length, 2);
    const newCard = mount(b); b.mutate(b.document.body, { addedNodes: [newCard.row] }); await b.scheduler.flush();
    assert.equal(newCard.card.style.visibility, 'hidden');
    const old = a.host.querySelectorAll('button')[0]; a.card.remove(); b.mutate(a.host, { removedNodes: [a.card] }); await b.scheduler.flush();
    b.document.dispatchEvent({ type: 'click', target: old, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations.choices, { 1: 'hide' });
});
test('missing grants, malformed choices and save failures keep titles visible and disable choices', () => {
    for (const options of [{ getValue: undefined }, { getValue: () => ({ version: 2 }) }, { setValue: () => { throw new Error('denied'); } }]) {
        const b = setup(options), a = mount(b); b.feature.check();
        b.click(a.host, 'Hide suggestion'); assert.equal(a.card.style.visibility, undefined);
        assert.equal(a.host.querySelector('button').disabled, true);
        assert.equal(b.feature.diagnostics().storageFailed, true);
    }
});
test('route retirement releases exact resources and skips Continue Watching and My List', async () => {
    const b = setup(), a = mount(b), progress = mount(b, '3', { progress: true }); b.feature.check();
    assert.equal(progress.host.querySelectorAll('button').length, 0);
    b.click(a.host, 'Hide suggestion'); b.mutate(a.host);
    b.location.pathname = '/browse/my-list'; b.feature.check(); await Promise.resolve();
    assert.equal(a.card.style.visibility, undefined); assert.equal(a.host.querySelectorAll('button').length, 0);
    assert.equal(b.observers.filter(o => o.active).length, 0); assert.equal(b.document.listenerCount('click'), 0);
    b.location.pathname = '/browse/genre/1'; b.feature.check(); assert.equal(a.card.style.visibility, 'hidden');
    b.feature.dispose(); b.feature.dispose(); assert.equal(b.document.head.querySelectorAll('style').length, 0);
});
test('visibility retirement preserves native changes made after a dismissal', () => {
    const b = setup(), a = mount(b); a.card.style.setProperty('visibility', 'visible', 'important');
    b.feature.check(); b.click(a.host, 'Hide suggestion'); b.restore('1');
    assert.equal(a.card.style.visibility, 'visible'); assert.equal(a.card.style.getPropertyPriority('visibility'), 'important');
    b.click(a.host, 'Hide suggestion'); a.card.style.setProperty('visibility', 'collapse'); a.host.style.setProperty('position', 'absolute');
    b.feature.dispose(); assert.equal(a.card.style.visibility, 'collapse'); assert.equal(a.host.style.position, 'absolute');
});
test('real application wires browsing controls and retires them before playback', async () => {
    const b = createBrowser(), a = mount(b), stored = new Map();
    b.window.netflix.reactContext = { models: { userInfo: { data: { userGuid: 'A' } } } };
    const app = createApplication({ environment: b.context, userscript: {
        getValue: (key, fallback) => stored.get(key) ?? fallback, setValue: (key, value) => stored.set(key, value) } });
    app.start(); const button = a.host.querySelectorAll('button').find(n => n.textContent === 'Hide suggestion');
    b.document.dispatchEvent({ type: 'click', target: button, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, 'hidden'); assert.equal(app.diagnostics().recommendations.hiddenCount, 1);
    await b.navigate('/watch/1'); assert.equal(a.card.style.visibility, undefined);
    await b.navigate('/browse'); assert.equal(a.card.style.visibility, 'hidden');
    app.dispose(); assert.equal(b.observers.filter(o => o.active).length, 0); assert.equal(b.requests.length, 0);
});
test('recommendation controls translate every supported UI locale', () => {
    for (const [locale, messages] of Object.entries(UI_MESSAGES)) for (const key of ['hideRecommendation', 'undoRecommendation', 'recommendationWatched', 'recommendationHidden', 'closeRecommendationPanel', 'noRecommendationChoices']) {
        assert.equal(typeof messages[key], 'string', locale + ': ' + key); assert.ok(messages[key].length);
    }
});

test('saved-choices panel restores both reasons without mounted cards and remembers safe title labels', () => {
    const b = setup(), watched = mount(b, '11'), hidden = mount(b, '22');
    watched.card.appendChild(new Element('img')).setAttribute('alt', '<Watched film>');
    hidden.card.setAttribute('aria-label', 'Hidden series');
    b.feature.check(); b.click(watched.host, 'Mark watched'); b.click(hidden.host, 'Hide suggestion');
    watched.row.remove(); hidden.row.remove(); b.feature.dispose(); b.feature.check();
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (2)');
    assert.equal(root.querySelector('section').hidden, false);
    assert.deepEqual(root.querySelectorAll('a').map(a => a.textContent), ['<Watched film>', 'Hidden series']);
    assert.equal(root.querySelectorAll('a')[0].getAttribute('href'), '/title/11');
    b.click(root, '\u00d7'); // Panel close comes first.
    b.click(root, 'Watched / Caught up / Suggestion hidden (2)');
    const remove = root.querySelectorAll('.tm-rec-saved-row')[0].querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations, { version: 1, choices: { 22: 'hide' }, titles: { 22: 'Hidden series' } });
    const next = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: next, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(root.querySelectorAll('.tm-rec-saved-row').length, 0);
    assert.equal(root.querySelector('p').textContent, 'No saved choices.');
    b.document.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(root.querySelector('section').hidden, true);
    assert.equal(root.querySelector('button').getAttribute('aria-expanded'), 'false');
    assert.equal(b.requests.length, 0);
    b.feature.dispose(); assert.equal(root.isConnected, false); assert.equal(b.document.listenerCount('keydown'), 0);
});

test('saved panel preserves focus across row removal, Escape, toggle and close', () => {
    const b = setup(), createElement = b.document.createElement.bind(b.document);
    b.document.createElement = tag => {
        const node = createElement(tag); node.focus = () => { b.document.activeElement = node; }; return node;
    };
    const a = mount(b, '1'), second = mount(b, '2');
    b.feature.check(); b.click(a.host, 'Hide suggestion'); b.click(second.host, 'Hide suggestion');
    const root = b.document.querySelector('.tm-rec-manager'), toggle = root.querySelector('button');
    const panel = root.querySelector('section'), close = panel.querySelector('button');
    b.click(root, toggle.textContent); assert.equal(b.document.activeElement, close);
    const last = root.querySelectorAll('.tm-rec-saved-row')[1].querySelector('button');
    last.focus(); b.document.dispatchEvent({ type: 'click', target: last, preventDefault() {}, stopImmediatePropagation() {} });
    const remaining = root.querySelector('.tm-rec-saved-row').querySelector('button');
    assert.equal(b.document.activeElement, remaining);
    b.document.dispatchEvent({ type: 'click', target: remaining, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(b.document.activeElement, close);
    b.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(b.document.activeElement, toggle); assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    b.click(root, toggle.textContent); assert.equal(b.document.activeElement, close);
    b.click(root, toggle.textContent); assert.equal(b.document.activeElement, toggle);
    b.click(root, toggle.textContent); b.click(root, '\u00d7');
    assert.equal(b.document.activeElement, toggle); assert.equal(panel.hidden, true);
    b.feature.dispose(); b.feature.dispose(); b.feature.check();
    assert.equal(b.document.listenerCount('keydown'), 1); assert.equal(root.isConnected, false);
    b.feature.dispose(); assert.equal(b.document.listenerCount('keydown'), 0);
});

test('old choices can be restored from the panel and visible duplicate cards return immediately', () => {
    const b = setup(); b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'watched', 2: 'hide' } });
    const a = mount(b), duplicate = mount(b); b.feature.check();
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (2)');
    assert.equal(root.querySelector('a').textContent, '#1');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, undefined); assert.equal(duplicate.card.style.visibility, undefined);
    assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations.choices, { 2: 'hide' });
});

test('profile replacement closes the panel and stale row actions cannot restore another profile', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button'); b.select('B');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(root.querySelector('section').hidden, true); assert.equal(root.querySelectorAll('a').length, 0);
    assert.ok(b.saved.size >= 2); assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'].status, 'complete');
    b.select('A'); b.feature.check(); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'].status, 'complete');
});

test('failed panel restoration preserves the saved dismissal and reports unavailable storage', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    b.userscript.setValue = () => { throw new Error('denied'); };
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, 'hidden'); assert.deepEqual(knowledgeSnapshot(b.saved, 'A').recommendations.choices, { 1: 'hide' });
    assert.ok(root.querySelector('p').textContent.includes('Could not save'));
});

test('profile replacement during storage cannot publish a dismissal into the new profile', () => {
    const b = setup(), a = mount(b); b.feature.check();
    const save = b.userscript.setValue;
    b.userscript.setValue = (key, value) => { save(key, value); b.select('B'); };
    b.click(a.host, 'Hide suggestion');
    assert.equal(a.card.style.visibility, undefined); assert.equal(b.feature.diagnostics().hiddenCount, 0);
    assert.equal(fact(b.saved, 'B', '1', 'hidden'), undefined); assert.ok(fact(b.saved, 'A', '1', 'hidden'));
});

test('browsing actions share the under-card rail and dismissals collapse the whole slot without placeholders', () => {
    const b = setup(), a = mount(b); b.feature.check();
    const rail = a.host.querySelector('[data-tm-card-actions]');
    assert.ok(rail); assert.equal(rail.parentElement, a.host);
    assert.ok(a.host.children.indexOf(rail) > a.host.children.indexOf(a.card));
    assert.equal(rail.querySelectorAll('button').length, 2);
    assert.ok(b.document.head.querySelector('style').textContent.includes('padding-top: 6px'));
    assert.ok(!b.document.head.querySelector('style').textContent.includes('opacity:0'));
    b.click(a.host, 'Hide suggestion');
    assert.equal(a.host.style.getPropertyValue('display'), 'none');
    assert.equal(a.host.style.getPropertyPriority('display'), 'important');
    assert.equal(a.host.querySelector('.tm-rec-placeholder'), null);
    b.restore('1'); assert.equal(a.card.style.visibility, undefined);
    assert.equal(a.host.style.getPropertyValue('display'), '');
});

test('whole-slot collapse restores exact display on Undo, recycling and retirement while preserving native updates', () => {
    const b = setup(), a = mount(b), other = mount(b, '2', { legacy: true });
    a.row.appendChild(other.host); other.row.remove(); a.host.style.setProperty('display', 'inline-block', 'important');
    b.feature.check(); b.click(a.host, 'Mark watched');
    assert.equal(a.host.style.getPropertyValue('display'), 'none');
    assert.equal(other.host.style.getPropertyValue('display'), '');
    assert.deepEqual(a.row.children, [a.host, other.host]); // No React-owned nodes are removed or reordered.
    b.restore('1'); assert.equal(a.host.style.getPropertyValue('display'), 'inline-block');
    assert.equal(a.host.style.getPropertyPriority('display'), 'important');
    b.click(a.host, 'Hide suggestion'); a.card.setAttribute('href', '/title/3'); b.feature.check();
    assert.equal(a.host.style.getPropertyValue('display'), 'inline-block');
    b.click(other.host, 'Hide suggestion'); assert.equal(other.host.style.getPropertyValue('display'), 'none');
    b.feature.dispose(); assert.equal(other.host.style.getPropertyValue('display'), '');
    b.feature.check(); assert.equal(other.host.style.getPropertyValue('display'), 'none');
    other.host.style.setProperty('display', 'flex'); b.feature.dispose();
    assert.equal(other.host.style.getPropertyValue('display'), 'flex');
});

test('shared scroller space survives one card retirement and restores after the last lease', () => {
    const b = setup(), a = mount(b), other = mount(b, '2');
    a.row.appendChild(other.host); other.row.remove();
    a.row.style.setProperty('padding-bottom', '8px', 'important');
    a.host.style.setProperty('overflow', 'hidden');
    b.feature.check(); assert.equal(a.row.style.getPropertyValue('padding-bottom'), '72px');
    assert.equal(a.host.style.getPropertyValue('overflow'), 'visible');
    a.host.remove(); b.feature.check();
    assert.equal(a.row.style.getPropertyValue('padding-bottom'), '72px');
    assert.equal(a.host.style.getPropertyValue('overflow'), 'hidden');
    b.feature.dispose(); b.feature.dispose();
    assert.equal(a.row.style.getPropertyValue('padding-bottom'), '8px');
    assert.equal(a.row.style.getPropertyPriority('padding-bottom'), 'important');
    b.feature.check(); a.row.style.setProperty('padding-bottom', '100px'); b.feature.dispose();
    assert.equal(a.row.style.getPropertyValue('padding-bottom'), '100px');
});

test('native arrow evidence captures the clicked row before navigation and distinguishes buffered visibility from new IDs', async () => {
    const logs = [], b = setup({ log: (name, facts) => logs.push({ name, facts }) }), a = mount(b), other = mount(b, '2');
    a.row.appendChild(other.host); other.row.remove();
    a.row.setAttribute('data-uia', 'carousel-scroller'); a.row.appendChild(new Element('h2')).textContent = 'Because you watched';
    a.row.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 100 });
    let page = 0, nativeClicks = 0;
    a.host.getBoundingClientRect = () => ({ left: page ? 400 : 0, width: 100 });
    other.host.getBoundingClientRect = () => ({ left: page ? 0 : 400, width: 100 });
    const next = nextControl(b, a.row, () => { nativeClicks++; page = 1; }); b.feature.check();
    const event = { type: 'click', target: next, preventDefault() { throw new Error('prevented native click'); }, stopImmediatePropagation() { throw new Error('stopped native click'); } };
    b.document.dispatchEvent(event); assert.equal(nativeClicks, 0); // Diagnostics never operate the arrow.
    next.click(); const facts = b.feature.diagnostics().navigation.recent[0];
    assert.equal(facts.before.label, 'Because you watched'); assert.equal(facts.before.mounted, 2);
    assert.equal(facts.before.visible, 1); assert.equal(facts.before.offscreen, 1);
    assert.equal(facts.afterAtExport.mounted, 2); assert.deepEqual(facts.addedIdSample, []);
    assert.ok(logs.some(value => value.name === 'Native recommendation arrow clicked'));
    const added = mount(b, '3'); a.row.appendChild(added.host); added.row.remove(); b.feature.check();
    assert.deepEqual(b.feature.diagnostics().navigation.recent[0].addedIdSample, ['3']);
    other.card.setAttribute('href', '/title/4'); b.feature.check();
    const changed = b.feature.diagnostics().navigation.recent[0];
    assert.deepEqual(changed.removedIdSample, ['2']); assert.ok(changed.addedIdSample.includes('4'));
    assert.equal(b.feature.diagnostics().refill.checks, 0); assert.equal(nativeClicks, 1);
    b.feature.dispose(); assert.equal(b.feature.diagnostics().navigation.retained, 0);
});

test('native arrow records are bounded and profile changes retire exact rows without handling unrelated controls', () => {
    const b = setup(), a = mount(b), next = nextControl(b, a.row, () => {}); b.feature.check();
    for (let i = 0; i < 25; i++) b.document.dispatchEvent({ type: 'click', target: next });
    const facts = b.feature.diagnostics().navigation;
    assert.equal(facts.interactions, 25); assert.equal(facts.retained, 20); assert.equal(facts.recent[0].sequence, 6);
    b.document.dispatchEvent({ type: 'click', target: b.document.body }); assert.equal(b.feature.diagnostics().navigation.interactions, 25);
    b.select('B'); b.feature.check(); assert.equal(b.feature.diagnostics().navigation.retained, 0);
    a.row.remove(); assert.equal(b.feature.diagnostics().rows.total, 0); b.feature.dispose();
});

test('row diagnostics explicitly bound row and ID samples and safely tolerate failed native geometry reads', () => {
    const b = setup(), a = mount(b);
    for (let i = 2; i <= 125; i++) { const item = mount(b, String(i)); a.row.appendChild(item.host); item.row.remove(); }
    for (let i = 0; i < 41; i++) mount(b, String(1000 + i));
    b.feature.check(); const rows = b.feature.diagnostics().rows;
    assert.equal(rows.total, 42); assert.equal(rows.rows.length, 40); assert.equal(rows.truncated, true);
    const facts = rows.rows[0]; assert.equal(facts.mounted, 125); assert.equal(facts.ids.length, 120); assert.equal(facts.idsTruncated, true);
    a.row.getBoundingClientRect = () => { throw new Error('native geometry unavailable'); };
    assert.doesNotThrow(() => b.feature.diagnostics()); b.feature.dispose();
});

test('consecutive native clicks partition request windows and retire the handler survey on profile replacement', () => {
    const b = setup(), a = mount(b); let now = 100, calls = 0;
    b.context.performance.now = () => now;
    b.context.performance.getEntriesByType = () => [120, 220].map(startTime => ({
        name: 'https://www.netflix.com/graphql?secret=excluded', startTime, initiatorType: 'fetch', duration: 10, transferSize: 10 }));
    const next = nextControl(b, a.row, () => { calls++; });
    next.__reactFiber$test = { memoizedProps: { onClick() { calls++; }, rowData: { items: [1, 2, 3] } } };
    b.feature.check(); b.document.dispatchEvent({ type: 'click', target: next, shiftKey: true });
    now = 200; b.document.dispatchEvent({ type: 'click', target: next }); now = 300;
    const recent = b.feature.diagnostics().navigation.recent;
    assert.deepEqual(recent.map(x => x.requests.entries.map(e => e.offsetMs)), [[20], [20]]);
    assert.equal(recent[0].loading.components[0].fields[0].name, 'onClick'); assert.equal(calls, 0);
    b.select('B'); b.feature.check(); assert.equal(b.feature.diagnostics().navigation.retained, 0);
    b.feature.dispose();
});

test('native request observation starts only on user navigation and disconnects on profile and route retirement', () => {
    const instances = [];
    class PerformanceObserver {
        constructor(callback) { this.callback = callback; this.disconnected = false; instances.push(this); }
        observe() {}
        takeRecords() { return []; }
        disconnect() { this.disconnected = true; }
    }
    const b = setup({ PerformanceObserver }), a = mount(b), next = nextControl(b, a.row, () => {});
    b.feature.check(); b.feature.diagnostics(); assert.equal(instances.length, 0);
    b.document.dispatchEvent({ type: 'click', target: next }); assert.equal(instances.length, 1);
    b.select('B'); b.feature.check(); assert.equal(instances[0].disconnected, true);
    instances[0].callback({ getEntries() { throw Error('retired callback read'); } });
    b.document.dispatchEvent({ type: 'click', target: next }); assert.equal(instances.length, 2);
    b.location.pathname = '/watch/1'; b.feature.check(); assert.equal(instances[1].disconnected, true);
    assert.equal(b.feature.diagnostics().navigation.retained, 0); b.feature.dispose();
});

test('arrow height uses card geometry rather than a percentage of its short parent and restores on retirement', () => {
    const b = setup(), a = mount(b), arrow = nextControl(b, a.row, () => {});
    arrow.style.setProperty('height', '64px'); arrow.style.setProperty('top', '0px');
    arrow.offsetParent = { getBoundingClientRect: () => ({ top: 180 }), clientTop: 2, scrollTop: 0 };
    a.card.getBoundingClientRect = () => ({ left: 0, top: 100, width: 250, height: 140 });
    b.feature.check();
    assert.equal(arrow.style.getPropertyValue('height'), '140px');
    assert.equal(arrow.style.getPropertyValue('top'), '-82px');
    a.card.getBoundingClientRect = () => ({ left: 0, top: 80, width: 200, height: 112 }); b.feature.check();
    assert.equal(arrow.style.getPropertyValue('height'), '112px');
    assert.equal(arrow.style.getPropertyValue('top'), '-102px');
    b.feature.dispose(); assert.equal(arrow.style.getPropertyValue('height'), '64px');
    assert.equal(arrow.style.getPropertyValue('top'), '0px'); assert.equal(arrow.style.getPropertyValue('bottom'), '');
    assert.equal(b.window.listenerCount('resize'), 0);
});

test('arrow retirement preserves a newer native height override', () => {
    const b = setup(), a = mount(b), arrow = nextControl(b, a.row, () => {}); b.feature.check();
    arrow.style.setProperty('height', '333px', 'important'); b.feature.dispose();
    assert.equal(arrow.style.getPropertyValue('height'), '333px');
});


test('arrow edge strip covers viewport margin and ends at measured actions, restoring horizontal leases', () => {
    const b = setup(), a = mount(b), arrow = nextControl(b, a.row, () => {});
    b.window.innerWidth = 2560;
    arrow.offsetParent = { getBoundingClientRect: () => ({ left: 2488, top: 704 }), clientTop: 0 };
    arrow.getBoundingClientRect = () => ({ left: 2460, right: 2516, top: 568, width: 56, height: 238 });
    a.card.getBoundingClientRect = () => ({ left: 100, top: 568, width: 296, height: 166 });
    b.feature.check();
    const actions = a.host.querySelector('.tm-rec-controls');
    actions.getBoundingClientRect = () => ({ top: 738, height: 28 }); b.feature.check();
    assert.equal(arrow.style.getPropertyValue('width'), '100px');
    assert.equal(arrow.style.getPropertyValue('left'), '-28px');
    assert.equal(arrow.style.getPropertyValue('height'), '198px');
    b.window.innerWidth = 1920; b.feature.check();
    assert.equal(arrow.style.getPropertyValue('width'), '100px');
    assert.equal(arrow.style.getPropertyValue('left'), '-668px');
    b.feature.dispose();
    for (const name of ['left', 'right', 'width']) assert.equal(arrow.style.getPropertyValue(name), '');
});

test('hiding a suggestion records same-row state before and immediately after collapse', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    const action = b.feature.diagnostics().navigation.actions[0];
    assert.equal(action.action, 'hide'); assert.equal(action.before.hidden, 0);
    assert.equal(action.samples[0].state.hidden, 1); assert.equal(action.samples[0].reason, 'saved');
    b.feature.dispose();
});


test('active My List and browsing presentations synchronize saved names and reversals through storage events', async () => {
    const list = sessionBrowser({ count: 2, viewing: true });
    await list.start();
    const browsing = setup({ storage: list.storage });
    browsing.select('profile-a');
    const card = mount(browsing, '1');
    browsing.feature.check();
    const node = list.grid().querySelector('[data-tm-item-video-id="1"]');
    const button = node.querySelector('[data-tm-viewing-action]');
    list.grid().dispatchEvent({ type: 'click', target: button, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    for (let i = 0; i < 5; i++) { await list.scheduler.flush(); await browsing.scheduler.flush(); }
    assert.equal(card.host.style.getPropertyValue('display'), 'none');
    assert.ok(fact(list.storage, 'profile-a', '1', 'manual').name);
    const root = browsing.document.querySelector('.tm-rec-manager');
    browsing.click(root, root.querySelector('button').textContent);
    assert.notEqual(root.querySelector('.tm-rec-saved-row').querySelector('a').textContent, '#1');
    browsing.restore('1');
    for (let i = 0; i < 5; i++) { await list.scheduler.flush(); await browsing.scheduler.flush(); }
    assert.equal(card.host.style.getPropertyValue('display'), '');
    assert.equal(list.grid().querySelector('[data-tm-item-video-id="1"]').parentElement, list.grid());
    browsing.feature.dispose(); list.dispose();
});

test('browsing acknowledges a completed finale with its coverage and preserves a manual reversal', async () => {
    const metadata = seriesMetadata();
    metadata.readEpisodes = async ranges => ranges.map(() => ({ episodes: [{ id: '999', record: { type: 'episode', watched: true } }] }));
    const b = setup({ viewingData: metadata }), card = mount(b);
    card.card.removeAttribute('data-video-type'); card.card.setAttribute('aria-label', 'Named series');
    b.feature.check(); for (let i = 0; i < 5; i++) await b.scheduler.flush();
    assert.equal(card.host.style.getPropertyValue('display'), 'none');
    assert.deepEqual(fact(b.saved, 'A', '1', 'completion').coverage, [['101', 2]]);
    assert.equal(fact(b.saved, 'A', '1', 'manual'), undefined);
    b.restore('1'); assert.equal(card.host.style.getPropertyValue('display'), '');
    assert.equal(fact(b.saved, 'A', '1', 'manual').status, 'main');
    b.feature.dispose();
});


test('validated caught-up controls accept a named choice while the optional finale lookup is still pending', async () => {
    let rejectFinale;
    const b = setup({ viewingData: { ...seriesMetadata(), readEpisodes() {
        return new Promise((_, reject) => { rejectFinale = reject; });
    } } });
    const a = mount(b); a.card.removeAttribute('data-video-type'); a.card.setAttribute('aria-label', 'Example series');
    b.feature.check(); await b.scheduler.flush();
    const button = a.host.querySelector('button');
    assert.equal(b.feature.diagnostics().viewing.phase, 'finales');
    assert.equal(button.textContent, 'Mark caught up'); assert.equal(button.disabled, false);
    b.click(a.host, 'Mark caught up');
    assert.equal(a.host.style.getPropertyValue('display'), 'none');
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'].status, 'complete');
    assert.equal(fact(b.saved, 'A', '1', 'manual').name, 'Example series');
    rejectFinale(Error('optional progress unavailable')); await b.scheduler.flush();
    assert.equal(knowledgeSnapshot(b.saved, 'A').choices['1'].status, 'complete');
    assert.equal(b.feature.diagnostics().viewing.failed, 0); b.feature.dispose();
});


test('live row inventories survive recycled native slots, filter saved choices and retire with the profile', () => {
    const b = setup(), a = mount(b, '1'), old = mount(b, '2');
    a.row.appendChild(old.host); old.row.remove(); b.feature.check();
    old.host.remove(); a.card.setAttribute('href', '/title/3'); b.feature.check();
    const retained = () => b.feature.diagnostics().rows.rows[0].retained;
    assert.equal(retained().known, 3); assert.equal(retained().retainedUnmounted, 2);
    b.click(a.host, 'Hide suggestion');
    assert.equal(retained().filtered, 2); assert.equal(retained().excluded, 1);
    assert.deepEqual(retained().page, ['1', '2']);
    a.row.setAttribute('data-list-id', 'new-row'); b.feature.check();
    assert.equal(retained().known, 1); assert.equal(retained().retainedUnmounted, 0);
    b.select('B'); b.feature.check(); assert.equal(retained().known, 1);
    b.feature.dispose(); assert.equal(b.feature.diagnostics().inventory.rows, 0);
});


test('idle scans and scrolling avoid refill geometry and unchanged control writes', async () => {
    const b = setup(), a = mount(b), other = mount(b, '2'); let reads = 0;
    for (const item of [a, other]) item.host.getBoundingClientRect = () => { reads++; return { left: 0, width: 200 }; };
    b.feature.check(); await b.scheduler.flush(); reads = 0;
    const writes = b.feature.diagnostics().work.controlWrites; reads = 0;
    b.feature.check(); await b.scheduler.flush();
    b.window.dispatchEvent({ type: 'scroll' }); await b.scheduler.advance(250);
    assert.equal(reads, 0);
    assert.equal(b.feature.diagnostics().work.controlWrites, writes);
    b.feature.dispose();
});

test('normal native arrows skip React surveys and Shift-click explicitly captures one', () => {
    const b = setup(), a = mount(b); let surveys = 0;
    const next = nextControl(b, a.row, () => {});
    next.__reactFiber$test = { memoizedProps: new Proxy({}, { ownKeys() { surveys++; return []; } }), return: null };
    const fetch = b.context.fetch;
    b.feature.check(); b.document.dispatchEvent({ type: 'click', target: next });
    assert.equal(b.context.fetch, fetch);
    assert.equal(surveys, 0); assert.equal(b.feature.diagnostics().navigation.recent[0].loading.detailed, false);
    b.document.dispatchEvent({ type: 'click', target: next, shiftKey: true });
    assert.notEqual(b.context.fetch, fetch);
    assert.ok(surveys > 0); assert.ok(b.feature.diagnostics().navigation.recent[1].loading.components);
    b.feature.dispose();
});


test('overlapping native mutation roots share one scan in the same observer turn', async () => {
    const b = setup(), a = mount(b); b.feature.check(); await b.scheduler.flush();
    const scans = b.feature.diagnostics().work.scans;
    b.mutate(a.card, { type: 'attributes' }); b.mutate(a.host, { type: 'attributes' });
    await b.scheduler.flush();
    assert.equal(b.feature.diagnostics().work.scans, scans + 1); b.feature.dispose();
});

test('row replacement diagnostics retain native cache activity and population loss in one chronology', async () => {
    const b = setup(), old = Array.from({ length: 6 }, (_, index) => mount(b, String(index * 2 + 1)));
    for (const [index, item] of old.entries()) {
        const second = mount(b, String(index * 2 + 2)); item.row.appendChild(second.host); second.row.remove();
        item.row.id = Buffer.from(JSON.stringify({ pageId: 'private-old-page', sectionId: 'private-row-' + index })).toString('base64');
    }
    const native = queryFixture(['1', '2', '13']); native.attach(old[0].card);
    b.feature.check(); b.click(old[0].host, 'Hide suggestion'); await b.scheduler.advance(200); await b.scheduler.flush();
    const initial = b.feature.diagnostics().rowLifecycle;
    assert.ok(initial?.recent.some(event => event.kind === 'cache' && event.operation === 'publish' && event.stage === 'verified'));
    const incoming = [mount(b, '101'), mount(b, '102')];
    for (const item of incoming) item.row.id = Buffer.from(JSON.stringify({ pageId: 'private-new-page', sectionId: 'private-new-row' })).toString('base64');
    old.forEach(item => item.row.remove());
    b.mutate(b.document.body, { removedNodes: old.map(item => item.row), addedNodes: incoming.map(item => item.row) });
    await b.scheduler.flush();
    const trace = b.feature.diagnostics().rowLifecycle, incident = trace.incidents.at(-1);
    assert.equal(incident.event.beforeRows, 6); assert.equal(incident.event.rows, 2);
    assert.equal(incident.event.removed, 6); assert.equal(incident.event.added, 2);
    assert.equal(incident.event.pageChanged, true);
    assert.ok(incident.before.some(event => event.kind === 'cache' && event.operation === 'publish'));
    assert.ok(incident.after.some(event => event.kind === 'cache' && event.operation === 'restore'));
    assert.doesNotMatch(JSON.stringify(trace), /private-|cursor|auth|variables|sectionId/);
    trace.recent.length = 0; assert.ok(b.feature.diagnostics().rowLifecycle.recent.length);
    b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    assert.equal(b.feature.diagnostics().rowLifecycle.recent.length, 0);
});

test('sibling mutation roots validate only affected cards and share metadata admission without repainting unrelated cards', async () => {
    const b = setup(), cards = Array.from({ length: 40 }, (_, index) => mount(b, String(index + 1)));
    const row = cards[0].row;
    for (const item of cards.slice(1)) { row.appendChild(item.host); item.row.remove(); }
    b.feature.check(); await b.scheduler.flush();
    const before = b.feature.diagnostics().work, reads = new Map();
    for (const { card } of cards) {
        const closest = card.closest.bind(card);
        card.closest = selector => {
            if (selector === '[data-virtual-slot], .slider-item') reads.set(card, (reads.get(card) || 0) + 1);
            return closest(selector);
        };
    }
    for (const { host } of cards.slice(0, 20)) b.mutate(host, { addedNodes: [new Element('span')] });
    await b.scheduler.flush();
    for (const { card } of cards.slice(20)) assert.equal(reads.get(card) || 0, 0, 'unrelated card identity is not reread');
    const work = b.feature.diagnostics().work;
    assert.equal(work.scans - before.scans, 1);
    assert.equal(work.scanRoots - before.scanRoots, 20);
    assert.equal(work.connectionChecks - before.connectionChecks, 40);
    assert.equal(work.leaseChecks - before.leaseChecks, 20);
    assert.equal(work.viewingPasses - before.viewingPasses, 1);
    assert.equal(work.scannedCards - before.scannedCards, 20);
    assert.equal(work.paintCalls - before.paintCalls, 20);
    b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('a mutation inside a card validates its owned host even after the native href becomes invalid', async () => {
    const b = setup(), first = mount(b, '1'), other = mount(b, '2');
    const inner = first.card.appendChild(new Element('span'));
    b.feature.check(); b.click(first.host, 'Hide suggestion'); await b.scheduler.flush();
    first.card.setAttribute('href', '/unavailable');
    b.mutate(inner, { addedNodes: [new Element('span')] }); await b.scheduler.flush();
    assert.equal(first.host.style.getPropertyValue('display'), '');
    assert.equal(first.host.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(other.host.querySelectorAll('.tm-rec-controls').length, 1);
    assert.equal(b.feature.diagnostics().decorated, 1); b.feature.dispose();
});

test('a moved scroller rebinds card leases to its new row using the removed subtree', async () => {
    const b = setup(), first = mount(b, '1'), other = mount(b, '2');
    const scroller = first.row.appendChild(new Element('div')); scroller.setAttribute('data-uia', 'carousel-scroller');
    scroller.appendChild(first.host); const oldArrow = nextControl(b, first.row, () => {});
    nextControl(b, other.row, () => {});
    b.feature.check(); b.click(first.host, 'Hide suggestion'); await b.scheduler.flush();
    const oldControls = first.host.querySelector('.tm-rec-controls');
    assert.notEqual(oldArrow.style.getPropertyValue('height'), '');
    other.row.appendChild(scroller);
    b.mutate(first.row, { removedNodes: [scroller] }); await b.scheduler.flush();
    assert.equal(oldArrow.style.getPropertyValue('height'), '');
    assert.notEqual(first.host.querySelector('.tm-rec-controls'), oldControls);
    assert.equal(oldControls.isConnected, false);
    assert.equal(first.host.style.getPropertyValue('display'), 'none');
    assert.equal(b.feature.diagnostics().decorated, 2);
    b.feature.dispose(); assert.equal(scroller.style.getPropertyValue('padding-bottom'), '');
});

test('a mutation whose entire scope detached still retires disconnected hidden cards', async () => {
    const b = setup(), first = mount(b, '1'), other = mount(b, '2');
    b.feature.check(); b.click(first.host, 'Hide suggestion'); await b.scheduler.flush();
    first.row.remove(); b.mutate(first.host, { addedNodes: [new Element('span')] }); await b.scheduler.flush();
    assert.equal(first.host.style.getPropertyValue('display'), '');
    assert.equal(first.host.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(first.row.style.getPropertyValue('padding-bottom'), '');
    assert.equal(other.host.querySelectorAll('.tm-rec-controls').length, 1);
    assert.equal(b.feature.diagnostics().decorated, 1); b.feature.dispose();
});

test('native row classification changes retire its cards through the observed class mutation', async () => {
    const b = setup(), first = mount(b, '1'), other = mount(b, '2');
    b.feature.check(); await b.scheduler.flush();
    first.row.classList.add('continueWatching');
    const observer = b.observers.find(observer => observer.active);
    if (observer.options?.attributeFilter.includes('class')) observer.callback([{ type: 'attributes', target: first.row, attributeName: 'class' }]);
    await b.scheduler.flush();
    assert.equal(first.host.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(first.row.style.getPropertyValue('padding-bottom'), '');
    assert.equal(other.host.querySelectorAll('.tm-rec-controls').length, 1); b.feature.dispose();
});

test('routine native hover classes do not schedule reconciliation and removing structural classes does', async () => {
    const b = setup(), first = mount(b, '1', { legacy: true });
    b.feature.check(); await b.scheduler.flush();
    const observer = b.observers.find(observer => observer.active), before = b.feature.diagnostics().work.scans;
    const oldValue = first.card.className;
    first.card.classList.add('hovered');
    observer.callback([{ type: 'attributes', attributeName: 'class', target: first.card, oldValue }]);
    await b.scheduler.flush(); assert.equal(b.feature.diagnostics().work.scans, before);
    const structural = first.card.className; first.card.classList.remove('title-card');
    // Deliver the fields supplied by the subscribed native observer.
    observer.callback([{ type: 'attributes', attributeName: 'class', target: first.card,
        oldValue: observer.options.attributeOldValue ? structural : null }]);
    await b.scheduler.flush();
    assert.equal(first.host.querySelectorAll('.tm-rec-controls').length, 0);
    assert.equal(first.row.style.getPropertyValue('padding-bottom'), ''); b.feature.dispose();
});

test('explicit checks and mutation-root overflow retain complete card validation', async () => {
    for (const mode of ['check', 'overflow']) {
        const b = setup(), cards = Array.from({ length: 30 }, (_, index) => mount(b, String(index + 1)));
        b.feature.check(); b.click(cards[0].host, 'Hide suggestion'); await b.scheduler.flush();
        // An unrelated title change omitted from this delivery must be found by a full pass.
        cards[0].card.setAttribute('href', '/title/1000');
        const before = b.feature.diagnostics().work.leaseChecks;
        if (mode === 'check') b.feature.check();
        else for (const { host } of cards.slice(1, 26)) b.mutate(host, { addedNodes: [new Element('span')] });
        await b.scheduler.flush();
        assert.equal(cards[0].host.style.getPropertyValue('display'), '');
        assert.equal(cards[0].host.querySelectorAll('.tm-rec-controls').length, 1);
        assert.equal(b.feature.diagnostics().work.leaseChecks - before, 30);
        b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});

test('a sibling mutation batch restores recycled hidden cards and preserves a shared row reservation', async () => {
    const b = setup(), first = mount(b, '1'), second = mount(b, '2');
    first.row.appendChild(second.host); second.row.remove();
    b.feature.check(); b.click(first.host, 'Hide suggestion'); await b.scheduler.flush();
    assert.equal(first.host.style.getPropertyValue('display'), 'none');
    const restored = [], remove = first.row.style.removeProperty.bind(first.row.style);
    first.row.style.removeProperty = name => { if (name === 'padding-bottom') restored.push(name); return remove(name); };
    first.card.setAttribute('href', '/browse?jbv=3'); second.card.setAttribute('href', '/browse?jbv=4');
    b.mutate(first.card, { type: 'attributes' }); b.mutate(second.card, { type: 'attributes' });
    await b.scheduler.flush();
    assert.equal(first.host.style.getPropertyValue('display'), '');
    assert.equal(first.card.getAttribute('aria-hidden'), null);
    assert.equal(first.host.querySelectorAll('.tm-rec-controls').length, 1);
    assert.equal(second.host.querySelectorAll('.tm-rec-controls').length, 1);
    assert.deepEqual(restored, []); assert.equal(first.row.style.getPropertyValue('padding-bottom'), '72px');
    assert.equal(knowledgeSnapshot(b.saved, 'A').recommendations.choices['1'], 'hide');
    b.feature.dispose(); assert.deepEqual(restored, ['padding-bottom']);
});

test('queued sibling mutation batches cannot scan after profile or route retirement', async () => {
    for (const replacement of ['profile', 'route', 'dispose']) {
        const b = setup(), first = mount(b, '1'), second = mount(b, '2');
        b.feature.check(); await b.scheduler.flush();
        b.mutate(first.host, { addedNodes: [new Element('span')] }); b.mutate(second.host, { addedNodes: [new Element('span')] });
        if (replacement === 'profile') { b.select('B'); b.feature.check(); }
        else if (replacement === 'route') { b.location.pathname = '/watch/1'; b.feature.check(); }
        else b.feature.dispose();
        const scans = b.feature.diagnostics().work.scans;
        await b.scheduler.flush(); assert.equal(b.feature.diagnostics().work.scans, scans);
        if (replacement !== 'profile') assert.equal(b.document.querySelectorAll('.tm-rec-controls').length, 0);
        b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});


test('matched native query filtering feeds complete candidate pages through the real recommendation owner', async () => {
    const b = setup(), a = mount(b, '1'), second = mount(b, '2');
    a.row.appendChild(second.host); second.row.remove();
    const native = queryFixture(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    native.attach(a.card); native.attach(second.card);
    native.state.onWrite = data => {
        const old = a.row.querySelectorAll('[data-virtual-slot]'); old.forEach(host => host.remove());
        const incoming = [];
        for (const edge of data.node.entities.edges.slice(0, 3)) {
            const value = mount(b, edge.node.unifiedEntity.videoId); native.attach(value.card);
            a.row.appendChild(value.host); value.row.remove(); incoming.push(value.host);
        }
        b.mutate(a.row, { addedNodes: incoming, removedNodes: old });
    };
    b.feature.check(); b.click(a.host, 'Hide suggestion'); await b.scheduler.advance(200); await b.scheduler.flush();
    assert.deepEqual(native.state.data.node.entities.edges.slice(0, 3).map(e => e.node.unifiedEntity.videoId), ['2', '3', '4']);
    assert.equal(b.feature.diagnostics().nativeRows.writes, 1);
    assert.equal(knowledgeSnapshot(b.saved, 'A').recommendations.choices['1'], 'hide');
    assert.equal(native.state.requests.length, 0);
    assert.equal(a.row.querySelectorAll('.tm-rec-controls').length, 3);
    b.feature.dispose(); await b.scheduler.flush();
    assert.equal(native.state.data.node.entities.edges.length, 12); assert.equal(b.scheduler.timers.size, 0);
});


test('failed known-series metadata keeps the caught-up action label without substituting refresh', async () => {
    const b = setup({ viewingData: { beginRead: () => ({ profileGuid: 'A' }),
        async readTitles() { return new Map([['1', { videoId: '1', type: 'show' }]]); }, async readSeasons() { return []; } } });
    const a = mount(b); a.card.removeAttribute('data-video-type'); b.feature.check(); await b.scheduler.flush();
    await b.scheduler.advance(1000); await b.scheduler.advance(2000);
    const button = a.host.querySelectorAll('button').find(node => node.textContent === 'Mark caught up');
    assert.ok(button); assert.equal(button.disabled, true); assert.match(button.title, /unavailable/i);
    assert.equal(a.host.querySelectorAll('button').some(node => /refresh/i.test(node.textContent)), false);
    b.feature.dispose();
});


test('original-page compaction is wired through visibility before any native arrow or saved action', async () => {
    const b = setup(), a = mount(b, '1'), second = mount(b, '2'); let visible; const observed = new Set();
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'hide' } });
    a.row.appendChild(second.host); second.row.remove();
    b.context.IntersectionObserver = class {
        constructor(callback) { visible = callback; } observe(row) { observed.add(row); }
        unobserve(row) { observed.delete(row); } disconnect() { observed.clear(); }
    };
    const native = queryFixture(['1', '2', '3', '4']); native.attach(a.card); native.attach(second.card);
    native.state.onWrite = data => {
        const old = a.row.querySelectorAll('[data-virtual-slot]'); old.forEach(host => host.remove());
        const incoming = data.node.entities.edges.map(edge => {
            const item = mount(b, edge.node.unifiedEntity.videoId); native.attach(item.card);
            a.row.appendChild(item.host); item.row.remove(); return item.host;
        });
        b.mutate(a.row, { addedNodes: incoming, removedNodes: old });
    };
    b.feature.check(); await b.scheduler.flush(); assert.equal(observed.has(a.row), true);
    visible([{ target: a.row, isIntersecting: true }]); await b.scheduler.advance(200); await b.scheduler.flush();
    assert.deepEqual(native.state.data.node.entities.edges.map(e => e.node.unifiedEntity.videoId), ['2', '3', '4']);
    assert.equal(b.feature.diagnostics().nativeRows.automatic, 1);
    assert.equal(a.row.querySelectorAll('.tm-rec-controls').length, 3);
    b.feature.dispose(); assert.equal(observed.size, 0);
});


test('card replacement preserves the row reservation without removing and reapplying padding', async () => {
    const b = setup(), a = mount(b), writes = [], originalSet = a.row.style.setProperty.bind(a.row.style), originalRemove = a.row.style.removeProperty.bind(a.row.style);
    a.row.style.setProperty = (name, value, priority) => { if (name === 'padding-bottom') writes.push(value); originalSet(name, value, priority); };
    a.row.style.removeProperty = name => { if (name === 'padding-bottom') writes.push('removed'); originalRemove(name); };
    nextControl(b, a.row, () => {});
    b.feature.check(); assert.deepEqual(writes, ['72px']); const arrowWrites = b.feature.diagnostics().layout.arrowWrites;
    a.host.remove(); const incoming = mount(b, '2'); a.row.appendChild(incoming.host); incoming.row.remove();
    b.mutate(a.row, { addedNodes: [incoming.host], removedNodes: [a.host] }); await b.scheduler.flush(); assert.deepEqual(writes, ['72px']);
    assert.equal(b.feature.diagnostics().layout.arrowWrites, arrowWrites);
    b.feature.dispose(); assert.deepEqual(writes, ['72px', 'removed']);
});

test('a local card mutation does not remeasure arrows in an unrelated row', async () => {
    const b = setup(), a = mount(b), other = mount(b, '2'); nextControl(b, a.row, () => {}); nextControl(b, other.row, () => {});
    b.feature.check(); const paints = b.feature.diagnostics().work.paintCalls; let unrelatedReads = 0;
    other.card.getBoundingClientRect = () => { unrelatedReads++; return { left: 0, top: 0, width: 100, height: 100 }; };
    b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush(); assert.equal(unrelatedReads, 0);
    assert.equal(b.feature.diagnostics().work.paintCalls - paints, 1);
    b.feature.dispose();
});


test('arrow span ends at actual buttons without consuming the reserved row gap', () => {
    const b = setup(), a = mount(b), arrow = nextControl(b, a.row, () => {});
    a.card.getBoundingClientRect = () => ({ left: 0, top: 100, width: 250, height: 178 });
    arrow.getBoundingClientRect = () => ({ left: 1200, top: 100, width: 80, height: 212 });
    b.feature.check();
    a.host.querySelector('.tm-rec-controls').getBoundingClientRect = () => ({ top: 278, height: 34 });
    b.feature.check(); assert.equal(arrow.style.getPropertyValue('height'), '212px');
    assert.equal(a.row.style.getPropertyValue('padding-bottom'), '72px');
    const layout = b.feature.diagnostics().rows.rows[0].layout;
    assert.equal(layout.reservedSpace, 72); assert.equal(layout.contentHeight, 212);
    assert.equal(layout.arrows[0].topDelta, 0); assert.equal(layout.arrows[0].heightDelta, 0);
    b.feature.dispose();
});

test('native arrow replacement in an otherwise unchanged row receives its geometry lease', async () => {
    const b = setup(), a = mount(b); const holder = a.row.appendChild(new Element('div'));
    b.feature.check(); const arrow = nextControl(b, holder, () => {});
    b.mutate(holder, { addedNodes: [arrow] }); await b.scheduler.flush();
    assert.notEqual(arrow.style.getPropertyValue('height'), ''); b.feature.dispose();
    assert.equal(arrow.style.getPropertyValue('height'), '');
});
