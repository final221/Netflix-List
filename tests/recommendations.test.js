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
    assert.deepEqual([...b.saved.values()][0], { version: 1, choices: { 2: 'hide' } });
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
    for (const [locale, messages] of Object.entries(UI_MESSAGES)) for (const key of ['hideRecommendation', 'undoRecommendation', 'recommendationWatched', 'recommendationHidden']) {
        assert.equal(typeof messages[key], 'string', locale + ': ' + key); assert.ok(messages[key].length);
    }
});

test('profile replacement during storage cannot publish a dismissal into the new profile', () => {
    const b = setup(), a = mount(b); b.feature.check();
    const save = b.userscript.setValue;
    b.userscript.setValue = (key, value) => { save(key, value); b.select('B'); };
    b.click(a.host, 'Hide suggestion');
    assert.equal(a.card.style.visibility, undefined); assert.equal(b.feature.diagnostics().hiddenCount, 0);
    assert.equal(b.saved.size, 1); assert.ok([...b.saved.keys()][0].endsWith('A'));
});
