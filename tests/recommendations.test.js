import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendations } from '../src/recommendations/recommendations.js';
import { createApplication } from '../src/app/application.js';
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
    const b = createBrowser(), saved = new Map(); let profile = 'A';
    if (options.PerformanceObserver) b.context.PerformanceObserver = options.PerformanceObserver;
    const userscript = { getValue: (key, fallback) => saved.get(key) ?? fallback,
        setValue: (key, value) => saved.set(key, value), ...options };
    const tUi = createI18n({ readLanguage: () => 'en' }).tUi;
    const feature = createRecommendations({ environment: b.context, context: { activeProfile: () => profile }, userscript, tUi, viewingData: options.viewingData, log: options.log });
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

test('series Mark caught up and movie Mark watched share My List storage, with separate panel groups', async () => {
    const b = setup({ viewingData: seriesMetadata() }), series = mount(b), movie = mount(b, '2'), hidden = mount(b, '3');
    series.card.removeAttribute('data-video-type'); b.feature.check();
    assert.equal(series.host.querySelector('button').disabled, true); await b.scheduler.flush();
    b.click(series.host, 'Mark caught up'); b.click(movie.host, 'Mark watched'); b.click(hidden.host, 'Hide suggestion');
    const shared = b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices;
    assert.deepEqual(shared['1'], { status: 'complete', type: 'series', coverage: [['101', 2]] });
    assert.deepEqual(shared['2'], { status: 'complete', type: 'movie', coverage: null });
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A').choices, { 3: 'hide' });
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, root.querySelector('button').textContent);
    assert.deepEqual(root.querySelectorAll('h3').map(node => node.textContent), ['Films', 'Series', 'Suggestion hidden']);
    b.restore('1'); assert.equal(series.host.style.getPropertyValue('display'), '');
    assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'].status, 'main');
});

test('caught-up expiry uses shared policy for added episodes and a new season on later page entry', async () => {
    for (const added of [[['101', 3]], [['101', 2], ['102', 1]]]) {
        let coverage = [['101', 2]];
        const b = setup({ viewingData: seriesMetadata(() => coverage) }), a = mount(b); a.card.removeAttribute('data-video-type');
        b.feature.check(); await b.scheduler.flush(); b.click(a.host, 'Mark caught up');
        b.feature.dispose(); coverage = added; b.feature.check(); await b.scheduler.flush();
        assert.equal(a.host.style.getPropertyValue('display'), '');
        assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'], undefined);
        assert.equal(b.feature.diagnostics().hiddenCount, 0);
    }
});

test('saved caught-up series are rechecked even when Netflix has no mounted card for them', async () => {
    const b = setup({ viewingData: seriesMetadata(() => [['101', 3]]) });
    b.saved.set('legacyMyListForNetflix.viewingChoices.v1.A', { version: 1,
        choices: { 1: { status: 'complete', type: 'series', coverage: [['101', 2]] } } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(b.feature.diagnostics().hiddenCount, 0);
    assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'], undefined);
});

test('legacy browsing series without snapshots are restored, while film choices migrate and hides survive', async () => {
    const b = setup({ viewingData: { ...seriesMetadata(),
        async readTitles(ids) { return new Map(ids.map(id => [id, { videoId: id, type: id === '2' ? 'movie' : 'show' }])); } } });
    const a = mount(b), film = mount(b, '2'); a.card.removeAttribute('data-video-type'); film.card.removeAttribute('data-video-type');
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'watched', 2: 'watched', 3: 'hide' }, titles: { 1: 'Series', 2: 'Film' } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(a.host.style.getPropertyValue('display'), ''); assert.equal(film.host.style.getPropertyValue('display'), 'none');
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A').choices, { 3: 'hide' });
    assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'], undefined);
    assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['2'].type, 'movie');
});

test('missing series metadata preserves existing coverage and disables new caught-up choices without affecting Hide', async () => {
    const b = setup({ viewingData: { ...seriesMetadata(), async readSeasons() { return []; } } }), a = mount(b); a.card.removeAttribute('data-video-type');
    b.saved.set('legacyMyListForNetflix.viewingChoices.v1.A', { version: 1,
        choices: { 9: { status: 'complete', type: 'series', coverage: [['101', 2]] } } });
    b.feature.check(); await b.scheduler.flush();
    assert.equal(a.host.querySelector('button').textContent, 'Mark caught up'); assert.equal(a.host.querySelector('button').disabled, true);
    b.click(a.host, 'Mark caught up'); assert.equal(a.host.style.getPropertyValue('display'), '');
    b.click(a.host, 'Hide suggestion'); assert.equal(a.host.style.getPropertyValue('display'), 'none');
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['9'].coverage, [['101', 2]]);
});

test('an exhausted metadata lookup offers status refresh and restores the normal watched action after recovery', async () => {
    let available = false;
    const b = setup({ viewingData: { ...seriesMetadata(), async readTitles(ids) {
        return available ? new Map(ids.map(id => [id, { videoId: id, type: 'movie' }])) : new Map();
    } } }), a = mount(b); a.card.removeAttribute('data-video-type');
    b.feature.check(); await b.scheduler.flush(); await b.scheduler.advance(1000); await b.scheduler.advance(2000);
    const button = a.host.querySelector('button'); assert.equal(button.disabled, false);
    const label = button.textContent; assert.notEqual(label, 'Checking viewing status...');
    available = true; b.click(a.host, label); await b.scheduler.flush();
    assert.equal(button.textContent, 'Mark watched'); assert.equal(button.disabled, false);
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
    assert.equal(b.saved.size, 0); assert.equal(a.host.style.getPropertyValue('display'), '');
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
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A'), { version: 1, choices: { 2: 'hide' }, titles: {} });
    b.feature.dispose(); b.feature.check(); assert.equal(other.card.style.visibility, 'hidden');
    b.feature.dispose(); assert.equal(other.card.style.visibility, undefined);
    assert.equal(b.document.head.querySelectorAll('style').length, 0); assert.equal(b.requests.length, 0);
});
test('recommendation profile changes reject old controls and isolate saved choices', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    b.select('B'); b.click(a.host, 'Mark watched'); assert.equal(a.card.style.visibility, undefined);
    assert.equal(b.saved.size, 2); b.click(a.host, 'Hide suggestion');
    assert.equal(b.saved.size, 3); b.select('A'); b.feature.check();
    assert.equal(a.host.style.getPropertyValue('display'), 'none');
    b.select(null); b.feature.check(); assert.equal(a.host.querySelectorAll('button').length, 0);
    assert.equal(a.card.style.visibility, undefined);
});
test('recycled native slots retire old visibility and controls; newly mounted titles receive choices', async () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    a.card.setAttribute('href', '/title/2'); b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush();
    assert.equal(a.card.style.visibility, undefined); assert.equal(a.host.querySelectorAll('button').length, 2);
    const newCard = mount(b); b.mutate(b.document.body, { addedNodes: [newCard.row] }); await b.scheduler.flush();
    assert.equal(newCard.card.style.visibility, 'hidden');
    const old = a.host.querySelectorAll('button')[0]; a.card.remove(); b.mutate(a.host, { removedNodes: [a.card] }); await b.scheduler.flush();
    b.document.dispatchEvent({ type: 'click', target: old, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A').choices, { 1: 'hide' });
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
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A'), { version: 1, choices: { 22: 'hide' }, titles: { 22: 'Hidden series' } });
    const next = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: next, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(root.querySelectorAll('.tm-rec-saved-row').length, 0);
    assert.equal(root.querySelector('p').textContent, 'No saved choices.');
    b.document.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(root.querySelector('section').hidden, true);
    assert.equal(root.querySelector('button').getAttribute('aria-expanded'), 'false');
    assert.equal(b.requests.length, 0);
    b.feature.dispose(); assert.equal(root.isConnected, false); assert.equal(b.document.listenerCount('keydown'), 0);
});

test('old choices can be restored from the panel and visible duplicate cards return immediately', () => {
    const b = setup(); b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'watched', 2: 'hide' } });
    const a = mount(b), duplicate = mount(b); b.feature.check();
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (2)');
    assert.equal(root.querySelector('a').textContent, '#1');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, undefined); assert.equal(duplicate.card.style.visibility, undefined);
    assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A').choices, { 2: 'hide' });
});

test('profile replacement closes the panel and stale row actions cannot restore another profile', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button'); b.select('B');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(root.querySelector('section').hidden, true); assert.equal(root.querySelectorAll('a').length, 0);
    assert.equal(b.saved.size, 2); assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'].status, 'complete');
    b.select('A'); b.feature.check(); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(b.saved.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['1'].status, 'complete');
});

test('failed panel restoration preserves the saved dismissal and reports unavailable storage', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Watched / Caught up / Suggestion hidden (1)');
    b.userscript.setValue = () => { throw new Error('denied'); };
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, 'hidden'); assert.deepEqual(b.saved.get('legacyMyListForNetflix.recommendationChoices.v1.A').choices, { 1: 'hide' });
    assert.ok(root.querySelector('p').textContent.includes('Could not save'));
});

test('profile replacement during storage cannot publish a dismissal into the new profile', () => {
    const b = setup(), a = mount(b); b.feature.check();
    const save = b.userscript.setValue;
    b.userscript.setValue = (key, value) => { save(key, value); b.select('B'); };
    b.click(a.host, 'Hide suggestion');
    assert.equal(a.card.style.visibility, undefined); assert.equal(b.feature.diagnostics().hiddenCount, 0);
    assert.equal(b.saved.size, 1); assert.ok([...b.saved.keys()][0].endsWith('A'));
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
    b.feature.check(); b.document.dispatchEvent({ type: 'click', target: next });
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
