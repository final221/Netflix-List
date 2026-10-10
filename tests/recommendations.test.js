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
    const userscript = { getValue: (key, fallback) => saved.get(key) ?? fallback,
        setValue: (key, value) => saved.set(key, value), ...options };
    const tUi = createI18n({ readLanguage: () => 'en' }).tUi;
    const feature = createRecommendations({ environment: b.context, context: { activeProfile: () => profile }, userscript, tUi, viewingData: options.viewingData });
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
async function settleRefill(b, ticks = 3) { for (let i = 0; i < ticks; i++) await b.scheduler.advance(150); }

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

test('metadata delivered after a profile switch cannot classify, expire or write into the new profile', async () => {
    let resolve;
    const b = setup({ viewingData: { ...seriesMetadata(), readTitles: () => new Promise(done => { resolve = done; }) } }), a = mount(b);
    a.card.removeAttribute('data-video-type'); b.feature.check(); await b.scheduler.flush();
    b.select('B'); b.feature.check(); resolve(new Map([['1', { videoId: '1', type: 'show' }]])); await b.scheduler.flush();
    assert.equal(b.saved.size, 0); assert.equal(a.host.style.getPropertyValue('display'), '');
    b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
});

test('empty-row refill clicks Netflix next and decorates arriving recommendations without cloning or direct requests', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    nextControl(b, a.row, () => { clicks++; a.card.setAttribute('href', '/title/2'); });
    b.feature.check(); await b.scheduler.advance(300); assert.equal(clicks, 0);
    b.click(a.host, 'Hide suggestion'); await b.scheduler.advance(250); assert.equal(clicks, 1);
    await settleRefill(b); assert.equal(a.host.style.getPropertyValue('display'), '');
    assert.equal(a.host.querySelectorAll('button').length, 2); assert.equal(b.feature.diagnostics().refill.filled, 1);
    assert.equal(b.scheduler.timers.size, 0); assert.equal(a.host.querySelector('a'), a.card);
    assert.equal(b.requests.length, 0);
});

test('refill skips pages of previously dismissed titles and stops when Netflix wraps', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1, choices: { 1: 'hide', 2: 'watched' } });
    nextControl(b, a.row, () => { clicks++; a.card.setAttribute('href', `/title/${clicks % 2 ? 2 : 1}`); }, false);
    b.feature.check(); await b.scheduler.advance(250); await settleRefill(b);
    await b.scheduler.advance(250); await settleRefill(b); await b.scheduler.advance(250);
    assert.equal(clicks, 2); assert.equal(b.feature.diagnostics().refill.stopped, 1);
    b.feature.check(); await b.scheduler.advance(500); assert.equal(clicks, 2);
    assert.equal(b.scheduler.timers.size, 0);
});

test('refill waits for slow native loading and never clicks again while a page is pending', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    nextControl(b, a.row, () => { clicks++; }); b.feature.check(); b.click(a.host, 'Mark watched');
    await b.scheduler.advance(250); await settleRefill(b, 6); b.feature.check();
    assert.equal(clicks, 1); a.card.setAttribute('href', '/title/2'); await settleRefill(b);
    assert.equal(a.host.style.getPropertyValue('display'), ''); assert.equal(clicks, 1);
    assert.equal(b.scheduler.timers.size, 0);
});

test('unchanged native pages time out without a retry loop', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    nextControl(b, a.row, () => { clicks++; }); b.feature.check(); b.click(a.host, 'Mark watched');
    await b.scheduler.advance(250); await settleRefill(b, 20); b.feature.check(); await b.scheduler.advance(500);
    assert.equal(clicks, 1); assert.equal(b.feature.diagnostics().refill.timeouts, 1); assert.equal(b.scheduler.timers.size, 0);
});

test('refill cancels before clicking on Undo, profile change, route exit and disposal', async () => {
    for (const change of [b => b.restore('1'), b => b.select('B'), b => { b.location.pathname = '/watch/1'; }, b => b.feature.dispose()]) {
        const b = setup(), a = mount(b); let clicks = 0;
        nextControl(b, a.row, () => { clicks++; }); b.feature.check(); b.click(a.host, 'Mark watched'); change(b);
        await b.scheduler.advance(250); assert.equal(clicks, 0); b.feature.dispose(); assert.equal(b.scheduler.timers.size, 0);
    }
});

test('refill skips offscreen rows and disabled controls and resumes when a usable control appears', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    const next = nextControl(b, a.row, () => { clicks++; a.card.setAttribute('href', '/title/2'); }); next.disabled = true;
    a.row.getBoundingClientRect = () => ({ top: 1000, bottom: 1200 }); b.feature.check(); b.click(a.host, 'Hide suggestion');
    await b.scheduler.advance(250); assert.equal(clicks, 0); assert.equal(b.scheduler.timers.size, 0);
    a.row.getBoundingClientRect = () => ({ top: 100, bottom: 200 }); b.feature.check(); await b.scheduler.advance(250);
    assert.equal(clicks, 0); next.disabled = false; b.feature.check(); await b.scheduler.advance(250); await settleRefill(b);
    assert.equal(clicks, 1); assert.equal(a.host.style.getPropertyValue('display'), '');
});

test('refill page budget bounds distinct but entirely dismissed native pages', async () => {
    const b = setup(), a = mount(b); let clicks = 0;
    b.saved.set('legacyMyListForNetflix.recommendationChoices.v1.A', { version: 1,
        choices: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, 'hide'])) });
    nextControl(b, a.row, () => { clicks++; a.card.setAttribute('href', `/title/${clicks + 1}`); }); b.feature.check();
    for (let i = 0; i < 25; i++) { await b.scheduler.advance(250); await settleRefill(b); }
    assert.equal(clicks, 24); assert.equal(b.scheduler.timers.size, 0); assert.equal(b.feature.diagnostics().refill.stopped, 1);
});

test('offscreen prefetch cards cannot prevent refill, and scrolling admits an empty row', async () => {
    const b = setup(), a = mount(b), prefetch = mount(b, '9'); let clicks = 0;
    a.row.appendChild(prefetch.host); prefetch.row.remove();
    prefetch.host.getBoundingClientRect = () => ({ left: 2000, right: 2200, width: 200 });
    a.row.getBoundingClientRect = () => ({ top: 1000, bottom: 1200 });
    nextControl(b, a.row, () => { clicks++; a.card.setAttribute('href', '/title/2'); });
    b.feature.check(); b.click(a.host, 'Mark watched'); assert.equal(b.scheduler.timers.size, 0);
    a.row.getBoundingClientRect = () => ({ top: 100, bottom: 200 });
    b.window.dispatchEvent({ type: 'scroll' }); b.window.dispatchEvent({ type: 'scroll' });
    assert.equal(b.scheduler.timers.size, 1); await b.scheduler.advance(250); await b.scheduler.advance(250); await settleRefill(b);
    assert.equal(clicks, 1); assert.equal(a.host.style.getPropertyValue('display'), '');
    b.window.dispatchEvent({ type: 'scroll' }); b.feature.dispose();
    assert.equal(b.scheduler.timers.size, 0); assert.equal(b.window.listenerCount('scroll'), 0);
});

test('indicator-based carousels can advance cached pages without changing mounted title identities', async () => {
    const b = setup(), a = mount(b), other = mount(b, '2'); let clicks = 0;
    a.row.appendChild(other.host); other.row.remove();
    let page = 0;
    other.host.getBoundingClientRect = () => ({ left: page < 2 ? 2000 : 0, right: page < 2 ? 2200 : 200, width: 200 });
    const indicators = [0, 1, 2].map(() => a.row.appendChild(new Element('span')));
    const select = () => indicators.forEach((node, index) => node.setAttribute('data-indicator-selected', String(index === page)));
    select(); nextControl(b, a.row, () => { clicks++; page++; select(); });
    b.feature.check(); b.click(a.host, 'Mark watched');
    await b.scheduler.advance(250); await settleRefill(b); await b.scheduler.advance(250); await settleRefill(b);
    assert.equal(clicks, 2); assert.equal(b.feature.diagnostics().refill.filled, 1); assert.equal(b.scheduler.timers.size, 0);
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
