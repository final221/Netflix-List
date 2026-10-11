import { createRecommendationDom, RECOMMENDATION_ARROW_STYLES } from '../netflix/recommendation-dom.js';
import { createCardActions, CARD_ACTION_STYLES } from '../card-actions.js';
import { createRefill } from './refill.js';
import { createSavedChoicesPanel, SAVED_CHOICES_PANEL_STYLES } from './saved-choices-panel.js';
import { createNavigationDiagnostics } from './navigation.js';
import { createBrowsingViewing } from '../viewing/viewing.js';

export function createRecommendations({ environment, context, userscript, tUi, viewingData, log = () => {}, warn = () => {} }) {
    const { document, location, MutationObserver, queueMicrotask } = environment;
    const dom = createRecommendationDom(environment), entries = new Map(), buttons = new WeakMap();
    const key = 'legacyMyListForNetflix.recommendationChoices.v1.';
    let active = false, profile = null, choices = {}, failed = false, observer = null, style = null, queued = false, epoch = 0;
    let titles = {}, scrollTimer = null;
    const pending = new Set();
    const allowed = () => location.origin === 'https://www.netflix.com' &&
        (location.pathname === '/browse' || (location.pathname.startsWith('/browse/') && location.pathname !== '/browse/my-list') || location.pathname === '/search');
    const readProfile = () => { const value = context.activeProfile(); return typeof value === 'string' && value ? value : null; };
    const viewing = createBrowsingViewing({ environment, context, userscript, data: viewingData,
        isCurrent: () => active && allowed() && Boolean(profile) && readProfile() === profile, onChange: viewingChanged, log, warn });
    const savedPanel = createSavedChoicesPanel({ document, tUi,
        readPresentation: () => ({ profile, epoch, failed,
            records: [...viewing.ids().map(id => ({ id, reason: 'viewing', type: viewing.type(id) })),
                ...Object.keys(choices).map(id => ({ id, reason: choices[id], type: 'unknown' }))] }),
        readTitle: id => titles[id] || [...entries.values()].find(entry => entry.id === id && entry.title)?.title });
    function visibleChoices() { return { ...Object.fromEntries(viewing.ids().map(id => [id, 'watched'])), ...choices }; }
    function viewingChanged() {
        if (!active || !profile || readProfile() !== profile || !allowed()) return;
        try {
            const p = profile, owner = epoch, latest = read(p); let migrated = 0;
            for (const [id, reason] of Object.entries(latest.choices)) {
                const type = viewing.type(id);
                if (reason !== 'watched' || !['movie', 'series'].includes(type)) continue;
                if (type === 'movie' && !viewing.choice(id) && !viewing.mark(id).saved) continue;
                delete latest.choices[id]; migrated++;
            }
            if (readProfile() !== p || epoch !== owner) return;
            if (migrated) userscript.setValue(key + encodeURIComponent(p), { version: 1, ...latest });
            if (readProfile() !== p || epoch !== owner) { check(); return; }
            ({ choices, titles } = latest);
            for (const entry of entries.values()) paint(entry);
            // Refill the bounded metadata queue from mounted cards as slots become available.
            viewing.observe([...entries.values()]);
            savedPanel.paint(); updateRefill();
            if (migrated) log('Legacy browsing viewing choices migrated', { count: migrated });
        } catch (error) { warn('Browsing viewing migration unavailable', { reason: error.message }); }
    }
    const refill = createRefill({ environment, dom, readChoices: visibleChoices,
        admitted: () => active && allowed() && Boolean(profile) && !failed && readProfile() === profile,
        onPage: row => scan(row), log, warn });
    const navigation = createNavigationDiagnostics({ environment, dom, readChoices: visibleChoices,
        admitted: () => active && allowed() && Boolean(profile) && readProfile() === profile, log });
    function rowDiagnostics() {
        if (!active || !allowed() || !profile || readProfile() !== profile) return { total: 0, truncated: false, rows: [] };
        const rows = [...new Set([...entries.values()].map(entry => entry.row))].filter(row => row.isConnected);
        const selected = visibleChoices();
        return { total: rows.length, truncated: rows.length > 40,
            rows: rows.slice(0, 40).map(row => dom.rowDiagnostics(row, selected)).filter(Boolean) };
    }
    function updateRefill(dismissal = null) { refill.update(new Set([...entries.values()].map(entry => entry.row)), dismissal); }
    function scroll() {
        if (scrollTimer !== null) return;
        scrollTimer = environment.setTimeout(() => { scrollTimer = null; if (active && allowed()) { navigation.movement('scroll'); updateRefill(); } }, 250);
    }
    function read(p) {
        if (typeof userscript.getValue !== 'function' || typeof userscript.setValue !== 'function') throw new Error('storage-unavailable');
        const value = userscript.getValue(key + encodeURIComponent(p), null);
        if (value === null) return { choices: {}, titles: {} };
        if (value?.version !== 1 || !value.choices || typeof value.choices !== 'object' || Array.isArray(value.choices) ||
            Object.keys(value.choices).length > 5000) throw new Error('invalid-storage');
        const choices = Object.fromEntries(Object.entries(value.choices).filter(([id, reason]) => /^\d+$/.test(id) && ['watched', 'hide'].includes(reason)));
        const titles = Object.fromEntries(Object.entries(value.titles || {}).slice(0, 5000)
            .filter(([id, title]) => /^\d+$/.test(id) && typeof title === 'string').map(([id, title]) => [id, title.slice(0, 300)]));
        return { choices, titles };
    }
    function release(entry) { entry.controls.remove(); entry.lease.release(); entries.delete(entry.host); }
    function syncProfile() {
        const next = readProfile();
        if (next === profile) return;
        refill.dispose(); navigation.dispose(); viewing.dispose();
        for (const entry of [...entries.values()]) release(entry);
        profile = next; choices = {}; titles = {}; failed = false; epoch++; pending.clear(); queued = false;
        savedPanel.reset();
        if (next) try { const loaded = read(next); if (readProfile() === next) ({ choices, titles } = loaded); else profile = null; }
        catch (error) { failed = true; warn('Recommendation choices unavailable', { reason: error.message }); }
        if (profile && !failed) {
            viewing.reset(); viewing.observe(Object.keys(choices).filter(id => choices[id] === 'watched').map(id => ({ id })));
        }
        savedPanel.paint();
    }
    function paint(entry) {
        const reason = choices[entry.id] || (viewing.complete(entry.id) ? 'watched' : null);
        if (!entry.lease.hide(Boolean(reason))) return;
        entry.controls.setAttribute('data-tm-rec-hidden', reason ? 'true' : 'false');
        entry.watched.hidden = Boolean(reason); entry.hide.hidden = Boolean(reason);
        for (const button of [entry.watched, entry.hide]) {
            button.disabled = !profile || failed;
            button.title = failed || !profile ? tUi('viewingChoiceStorageFailed') : button.textContent;
        }
        const type = viewing.type(entry.id), facts = viewing.presentation();
        const unavailable = viewing.unavailable(entry.id);
        entry.watched.textContent = tUi(unavailable ? 'refreshViewingStatus' : type === 'series' ? 'markCaughtUp' : type === 'movie' ? 'markWatched'
            : 'checkingViewingStatus');
        entry.watched.setAttribute('aria-label', entry.watched.textContent);
        entry.watched.disabled ||= !viewing.ready(entry.id) && !unavailable || facts.disabled;
        entry.watched.title = !profile || failed || facts.manualFailure ? tUi('viewingChoiceStorageFailed')
            : !viewing.ready(entry.id) ? tUi(unavailable ? 'refreshViewingStatus' : 'checkingViewingStatus') : entry.watched.textContent;
    }
    function decorate(value) {
        const existing = entries.get(value.host);
        if (existing && existing.id === value.id && existing.card === value.card && existing.controls.parentElement === value.host) return;
        if (existing) release(existing);
        const actions = [['watched', 'watched', 'markWatched'], ['hide', 'hide', 'hideRecommendation']];
        const { root: controls, buttons: actionButtons } = createCardActions(document, actions.map(([, , message]) => tUi(message)));
        controls.className = 'tm-rec-controls';
        const entry = { ...value, controls, lease: dom.lease(value) };
        for (const [index, [action, field, message]] of actions.entries()) {
            const button = actionButtons[index];
            button.setAttribute('aria-label', tUi(message)); buttons.set(button, { entry, action }); entry[field] = button;
        }
        entries.set(value.host, entry); value.host.appendChild(controls); paint(entry);
    }
    function scan(root = document) {
        if (!active || !allowed()) return;
        const previous = profile; syncProfile();
        savedPanel.mount();
        if (!profile) return;
        if (previous !== profile) root = document;
        for (const entry of [...entries.values()]) if (!entry.lease.current()) release(entry);
        for (const value of dom.scan(root)) decorate(value);
        if (viewing.observe([...entries.values()])) viewingChanged();
        for (const entry of entries.values()) paint(entry);
        if (!style) {
            style = document.createElement('style');
            style.textContent = CARD_ACTION_STYLES + RECOMMENDATION_ARROW_STYLES + '\n.tm-rec-controls{opacity:1;pointer-events:auto}';
            style.textContent += SAVED_CHOICES_PANEL_STYLES;
            document.head.appendChild(style);
            environment.window?.addEventListener('resize', resize);
        }
        for (const row of new Set([...entries.values()].map(entry => entry.row))) dom.updateArrows(row);
        updateRefill();
    }
    function schedule(root) {
        pending.add(root); if (pending.size > 24) { pending.clear(); pending.add(document); } if (queued) return;
        queued = true; const owner = epoch;
        queueMicrotask(() => { if (!active || owner !== epoch) return; queued = false;
            const roots = [...pending]; pending.clear(); for (const node of roots) if (node === document || node.isConnected) scan(node);
        });
    }
    function click(event) {
        navigation.click(event.target); navigation.movement('click', event.target, { x: event.clientX, y: event.clientY });
        const button = event.target?.closest?.('button'), input = buttons.get(button) || savedPanel.inputFor(button);
        if (!input || (input.entry && entries.get(input.entry.host) !== input.entry)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!active || !allowed()) { check(); return; }
        if (input.action === 'manager' || input.action === 'close') {
            syncProfile(); if (!profile) return;
            savedPanel.activate(input.action); return;
        }
        const before = profile; syncProfile();
        if (!profile || failed || profile !== before || (input.entry ? !input.entry.lease.current() :
            input.profile !== profile || input.epoch !== epoch || !button.isConnected)) { scan(); return; }
        try {
            const p = profile, owner = epoch, latest = read(p);
            const id = input.entry?.id || input.id;
            const actionBefore = navigation.beforeAction(input.entry?.row);
            const diagnosticAction = input.action === 'watched' && viewing.type(id) === 'series' ? 'caught-up' : input.action;
            navigation.movement('action-attempt', input.entry?.card, { action: diagnosticAction, id });
            if (input.action === 'watched') {
                if (!viewing.ready(id) && viewing.unavailable(id)) { viewing.retry(id); paint(input.entry); return; }
                if (!viewing.mark(id).saved) { paint(input.entry); return; }
                delete latest.choices[id];
            } else if (input.action === 'undo') {
                if (input.reason === 'viewing' && !viewing.restore(id).saved) { savedPanel.paint(); return; }
                if (input.reason !== 'viewing') delete latest.choices[id];
                if (!viewing.ids().includes(id) && !latest.choices[id]) delete latest.titles[id];
            } else latest.choices[id] = input.action;
            if (input.entry?.title) latest.titles[id] = input.entry.title;
            if (Object.keys(latest.choices).length > 5000) throw new Error('storage-full');
            if (readProfile() !== p || epoch !== owner) { scan(); return; }
            userscript.setValue(key + encodeURIComponent(p), { version: 1, ...latest });
            if (readProfile() !== p || epoch !== owner || !active || !allowed()) { check(); return; }
            ({ choices, titles } = latest);
            for (const entry of entries.values()) paint(entry);
            savedPanel.paint();
            updateRefill(input.action !== 'undo' ? input.entry : null);
            navigation.movement('action', input.entry?.card, { action: diagnosticAction, id });
            navigation.savedAction(input.entry?.row, actionBefore, diagnosticAction, id);
            log('Recommendation visibility choice saved', { action: input.action, hiddenCount: Object.keys(choices).length });
        } catch (error) { failed = true; for (const entry of entries.values()) paint(entry); savedPanel.paint();
            warn('Recommendation choice could not be saved', { reason: error.message }); }
    }
    function pointer(event) {
        navigation.movement('hover', event.target, { x: event.clientX, y: event.clientY });
        if (!allowed()) { check(); return; }
        if (readProfile() !== profile) { scan(); observe(); return; }
        if (event.target?.closest?.('.tm-rec-controls, .tm-rec-manager')) return;
        const card = event.target?.closest?.('a[data-uia="standard-card"], .title-card');
        if (!card) return;
        const value = dom.describe(card), entry = value && entries.get(value.host);
        if (entry?.lease.current() && entry.controls.parentElement === value.host) return;
        scan(card.parentElement);
        observe();
    }
    function observe() {
        if (observer || !profile || typeof MutationObserver !== 'function') return;
        observer = new MutationObserver(records => {
            if (!allowed()) { check(); return; }
            for (const record of records) {
                if (record.target?.closest?.('.tm-rec-controls, .tm-rec-manager') || record.target === style) continue;
                if (record.type === 'attributes') schedule(record.target.parentElement || document);
                else if (record.type === 'childList') {
                    if ([...(record.addedNodes || []), ...(record.removedNodes || [])].every(node => node === style || ['tm-rec-controls', 'tm-rec-manager'].includes(node.className))) continue;
                    schedule(record.target);
                }
            }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-uia'] });
    }
    function resize() { schedule(document); }
    function check() {
        if (!allowed()) { dispose(); return; }
        if (!active) { active = true; epoch++;
            environment.window?.addEventListener('scroll', scroll, { passive: true });
            document.addEventListener('click', click, true); document.addEventListener('pointerover', pointer, true); savedPanel.start(); }
        scan(); observe();
    }
    function dispose() {
        refill.dispose(); navigation.dispose(); viewing.dispose();
        environment.window?.removeEventListener('scroll', scroll);
        environment.window?.removeEventListener('resize', resize);
        if (scrollTimer !== null) environment.clearTimeout(scrollTimer); scrollTimer = null;
        active = false; epoch++; queued = false; pending.clear(); observer?.disconnect(); observer = null;
        document.removeEventListener('click', click, true); document.removeEventListener('pointerover', pointer, true);
        savedPanel.dispose();
        for (const entry of [...entries.values()]) release(entry);
        style?.remove(); style = null; profile = null; choices = {}; titles = {}; failed = false;
    }
    return Object.freeze({ check, dispose, diagnostics: () => ({ active, decorated: entries.size, hiddenCount: Object.keys(visibleChoices()).length,
        storageFailed: failed, refill: refill.diagnostics(), viewing: viewing.diagnostics(),
        rows: rowDiagnostics(), navigation: navigation.snapshot() }) });
}
