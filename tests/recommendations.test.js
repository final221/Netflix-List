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
    const feature = createRecommendations({ environment: b.context, context: { activeProfile: () => profile }, userscript, tUi });
    return { ...b, saved, userscript, feature, select: value => { profile = value; },
        click(host, label) { const button = host.querySelectorAll('button').find(node => node.textContent === label);
            assert.ok(button, label); this.document.dispatchEvent({ type: 'click', target: button, preventDefault() {}, stopImmediatePropagation() {} }); },
        mutate(target, extra = {}) { this.observers.find(o => o.active).callback([{ type: 'childList', target, ...extra }]); } };
}
test('live recommendation controls persist both reasons, hide duplicates and Undo without server requests', () => {
    const b = setup(), a = mount(b), duplicate = mount(b), other = mount(b, '2', { legacy: true });
    other.card.querySelector('a').setAttribute('href', '/watch/2');
    b.feature.check(); assert.equal(a.host.querySelectorAll('button').length, 3);
    b.click(a.host, 'Mark watched');
    assert.equal(a.card.style.visibility, 'hidden'); assert.equal(duplicate.card.style.visibility, 'hidden');
    assert.equal(other.card.style.visibility, undefined); assert.equal(b.requests.length, 0);
    b.click(duplicate.host, 'Undo'); assert.equal(a.card.style.visibility, undefined);
    b.click(other.host, 'Hide suggestion'); assert.equal(other.card.style.visibility, 'hidden');
    assert.deepEqual([...b.saved.values()][0], { version: 1, choices: { 2: 'hide' }, titles: {} });
    b.feature.dispose(); b.feature.check(); assert.equal(other.card.style.visibility, 'hidden');
    b.feature.dispose(); assert.equal(other.card.style.visibility, undefined);
    assert.equal(b.document.head.querySelectorAll('style').length, 0); assert.equal(b.requests.length, 0);
});
test('recommendation profile changes reject old controls and isolate saved choices', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    b.select('B'); b.click(a.host, 'Undo'); assert.equal(a.card.style.visibility, undefined);
    assert.equal(b.saved.size, 1); b.click(a.host, 'Hide suggestion');
    assert.equal(b.saved.size, 2); b.select('A'); b.feature.check();
    assert.equal(a.host.querySelector('span').textContent, 'Already watched');
    b.select(null); b.feature.check(); assert.equal(a.host.querySelectorAll('button').length, 0);
    assert.equal(a.card.style.visibility, undefined);
});
test('recycled native slots retire old visibility and controls; newly mounted titles receive choices', async () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    a.card.setAttribute('href', '/title/2'); b.mutate(a.card, { type: 'attributes' }); await b.scheduler.flush();
    assert.equal(a.card.style.visibility, undefined); assert.equal(a.host.querySelectorAll('button').length, 3);
    const newCard = mount(b); b.mutate(b.document.body, { addedNodes: [newCard.row] }); await b.scheduler.flush();
    assert.equal(newCard.card.style.visibility, 'hidden');
    const old = a.host.querySelectorAll('button')[0]; a.card.remove(); b.mutate(a.host, { removedNodes: [a.card] }); await b.scheduler.flush();
    b.document.dispatchEvent({ type: 'click', target: old, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual([...b.saved.values()][0].choices, { 1: 'hide' });
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
    b.feature.check(); b.click(a.host, 'Hide suggestion'); b.click(a.host, 'Undo');
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
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Already watched / Suggestion hidden (2)');
    assert.equal(root.querySelector('section').hidden, false);
    assert.deepEqual(root.querySelectorAll('a').map(a => a.textContent), ['<Watched film>', 'Hidden series']);
    assert.equal(root.querySelectorAll('a')[0].getAttribute('href'), '/title/11');
    b.click(root, '\u00d7'); // Panel close comes first.
    b.click(root, 'Already watched / Suggestion hidden (2)');
    const remove = root.querySelectorAll('.tm-rec-saved-row')[0].querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual([...b.saved.values()][0], { version: 1, choices: { 22: 'hide' }, titles: { 22: 'Hidden series' } });
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
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Already watched / Suggestion hidden (2)');
    assert.equal(root.querySelector('a').textContent, '#1');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, undefined); assert.equal(duplicate.card.style.visibility, undefined);
    assert.deepEqual([...b.saved.values()][0].choices, { 2: 'hide' });
});

test('profile replacement closes the panel and stale row actions cannot restore another profile', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Mark watched');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Already watched / Suggestion hidden (1)');
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button'); b.select('B');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(root.querySelector('section').hidden, true); assert.equal(root.querySelectorAll('a').length, 0);
    assert.equal(b.saved.size, 1); assert.deepEqual([...b.saved.values()][0].choices, { 1: 'watched' });
    b.select('A'); b.feature.check(); b.click(root, 'Already watched / Suggestion hidden (1)');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual([...b.saved.values()][0].choices, { 1: 'watched' });
});

test('failed panel restoration preserves the saved dismissal and reports unavailable storage', () => {
    const b = setup(), a = mount(b); b.feature.check(); b.click(a.host, 'Hide suggestion');
    const root = b.document.querySelector('.tm-rec-manager'); b.click(root, 'Already watched / Suggestion hidden (1)');
    b.userscript.setValue = () => { throw new Error('denied'); };
    const remove = root.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: remove, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(a.card.style.visibility, 'hidden'); assert.deepEqual([...b.saved.values()][0].choices, { 1: 'hide' });
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

test('browsing actions use the shared persistent rail after the artwork, with separate Undo and placeholder', () => {
    const b = setup(), a = mount(b); b.feature.check();
    const rail = a.host.querySelector('[data-tm-card-actions]');
    assert.ok(rail); assert.equal(rail.parentElement, a.host);
    assert.ok(a.host.children.indexOf(rail) > a.host.children.indexOf(a.card));
    assert.equal(rail.querySelectorAll('button').length, 3);
    assert.ok(b.document.head.querySelector('style').textContent.includes('padding-top: 6px'));
    assert.ok(!b.document.head.querySelector('style').textContent.includes('opacity:0'));
    b.click(a.host, 'Hide suggestion');
    assert.equal(rail.querySelectorAll('button').find(button => button.textContent === 'Undo').hidden, false);
    assert.equal(a.host.querySelector('.tm-rec-placeholder').parentElement, a.host);
    assert.equal(rail.querySelector('.tm-rec-placeholder'), null);
    b.click(a.host, 'Undo'); assert.equal(a.card.style.visibility, undefined);
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
