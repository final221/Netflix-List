import { createRecommendationDom, RECOMMENDATION_ARROW_STYLES } from '../netflix/recommendation-dom.js';
import { createCardActions, CARD_ACTION_STYLES } from '../card-actions.js';
import { createRefill } from './refill.js';
import { createRowBuffer } from './row-buffer.js';
import { createSavedChoicesPanel, SAVED_CHOICES_PANEL_STYLES } from './saved-choices-panel.js';
import { createNavigationDiagnostics } from './navigation.js';
import { createBrowsingViewing, createKnowledge } from '../viewing/viewing.js';

export function createRecommendations({ environment, context, userscript, tUi, viewingData, knowledge, log = () => {}, warn = () => {} }) {
    const { document, location, MutationObserver, queueMicrotask } = environment;
    const nativeDom = createRecommendationDom(environment), entries = new Map(), buttons = new WeakMap();
    const inventories = new Map(); let inventoryLimit = false;
    function rowIdentity(row) {
        return [row.getAttribute('data-list-id') || row.id || row.getAttribute('data-uia') || '',
            (row.querySelector('h2, .rowTitle')?.textContent || row.getAttribute('aria-label') || '').slice(0, 300)].join('|');
    }
    function retain(row, items) {
        if (!active || !allowed() || !profile || readProfile() !== profile) return null;
        const identity = rowIdentity(row);
        let inventory = inventories.get(row);
        if (inventory?.identity !== identity) { inventories.delete(row); inventory = null; }
        if (!inventory) {
            if (inventories.size >= 40) { inventoryLimit = true; return null; }
            inventory = { identity, buffer: createRowBuffer() }; inventories.set(row, inventory);
        }
        inventory.buffer.observe(items); return inventory.buffer;
    }
    const dom = { ...nativeDom, rowDiagnostics(row, selected) {
        const facts = nativeDom.rowDiagnostics(row, selected);
        if (!facts) return facts;
        const inventory = inventories.get(row);
        const buffer = inventory?.identity === rowIdentity(row) ? inventory.buffer : null;
        return { ...facts, retained: buffer ? { ...buffer.project(selected, { anchorId: facts.visibleIds[0], mountedIds: facts.ids,
            capacity: facts.pageCapacity || 8 }), capacitySource: facts.pageCapacity ? 'geometry-estimate' : 'trial-default' } : null };
    } };
    const ownsKnowledge = !knowledge;
    knowledge ||= createKnowledge({ ...userscript, getValue: (...args) => userscript.getValue(...args), setValue: (...args) => userscript.setValue(...args), activeProfile: context.activeProfile, queueMicrotask });
    let unsubscribe = null;
    let active = false, profile = null, choices = {}, failed = false, observer = null, style = null, queued = false, epoch = 0;
    let scrollTimer = null;
    const pending = new Set();
    const allowed = () => location.origin === 'https://www.netflix.com' &&
        (location.pathname === '/browse' || (location.pathname.startsWith('/browse/') && location.pathname !== '/browse/my-list') || location.pathname === '/search');
    const readProfile = () => { const value = context.activeProfile(); return typeof value === 'string' && value ? value : null; };
    const viewing = createBrowsingViewing({ environment, context, userscript, knowledge, data: viewingData,
        isCurrent: () => active && allowed() && Boolean(profile) && readProfile() === profile, onChange: viewingChanged, log, warn });
    const savedPanel = createSavedChoicesPanel({ document, tUi,
        readPresentation: () => ({ profile, epoch, failed,
            records: [...viewing.savedIds().map(id => ({ id, reason: 'viewing', type: viewing.type(id), unverified: viewing.unverified(id) })),
                ...Object.keys(choices).map(id => ({ id, reason: choices[id], type: 'unknown' }))] }),
        readTitle: id => knowledge.name(id) || [...entries.values()].find(entry => entry.id === id && entry.title)?.title });
    function visibleChoices() { return { ...Object.fromEntries(viewing.ids().map(id => [id, 'watched'])), ...choices }; }
    function viewingChanged() {
        if (!active || !profile || readProfile() !== profile || !allowed()) return;
        try {
            const latest = read(profile);
            choices = latest.choices;
            for (const entry of entries.values()) paint(entry);
            // Refill the bounded metadata queue from mounted cards as slots become available.
            viewing.observe([...entries.values()]);
            savedPanel.paint(); updateRefill();
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
        if (readProfile() !== p) throw new Error('profile-changed');
        return { choices: knowledge.hidden() };
    }
    function release(entry) { entry.controls.remove(); entry.lease.release(); entries.delete(entry.host); }
    function syncProfile() {
        const next = readProfile();
        if (next === profile) return;
        refill.dispose(); navigation.dispose(); viewing.dispose();
        for (const entry of [...entries.values()]) release(entry);
        profile = next; choices = {}; failed = false; epoch++; pending.clear(); queued = false;
        inventories.clear(); inventoryLimit = false;
        savedPanel.reset();
        if (next) try { const loaded = read(next); if (readProfile() === next) choices = loaded.choices; else profile = null; }
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
        for (const row of inventories.keys()) if (!row.isConnected) inventories.delete(row);
        const discovered = dom.scan(root), byRow = new Map();
        for (const value of discovered) {
            if (!byRow.has(value.row)) byRow.set(value.row, []);
            byRow.get(value.row).push(value);
        }
        for (const [row, items] of byRow) retain(row, items);
        for (const value of discovered) {
            decorate(value);
            if (value.title) try { knowledge.remember(value.id, { name: value.title }); } catch (_) {}
            const legacy = knowledge.legacy(value.id);
            if (legacy?.watched && value.typeHint === 'movie' && !viewing.choice(value.id)) viewing.mark(value.id, value.title);
        }
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
            const p = profile, owner = epoch;
            const id = input.entry?.id || input.id;
            const actionBefore = navigation.beforeAction(input.entry?.row);
            const diagnosticAction = input.action === 'watched' && viewing.type(id) === 'series' ? 'caught-up' : input.action;
            navigation.movement('action-attempt', input.entry?.card, { action: diagnosticAction, id });
            if (input.action === 'watched') {
                if (!viewing.ready(id) && viewing.unavailable(id)) { viewing.retry(id); paint(input.entry); return; }
                if (!viewing.mark(id, input.entry?.title || '').saved) { paint(input.entry); return; }
            } else if (input.action === 'undo') {
                if (input.reason === 'viewing' && !viewing.restore(id).saved) { savedPanel.paint(); return; }
                if (input.reason !== 'viewing') knowledge.setHidden(id, false);
            } else knowledge.setHidden(id, true, input.entry?.title || '');
            if (readProfile() !== p || epoch !== owner || !active || !allowed()) { check(); return; }
            choices = read(p).choices;
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
            unsubscribe = knowledge.subscribe(() => { if (active && allowed()) viewingChanged(); });
            environment.window?.addEventListener('scroll', scroll, { passive: true });
            document.addEventListener('click', click, true); document.addEventListener('pointerover', pointer, true); savedPanel.start(); }
        scan(); observe();
    }
    function dispose() {
        unsubscribe?.(); unsubscribe = null;
        refill.dispose(); navigation.dispose(); viewing.dispose();
        if (ownsKnowledge) knowledge.dispose();
        environment.window?.removeEventListener('scroll', scroll);
        environment.window?.removeEventListener('resize', resize);
        if (scrollTimer !== null) environment.clearTimeout(scrollTimer); scrollTimer = null;
        active = false; epoch++; queued = false; pending.clear(); observer?.disconnect(); observer = null;
        document.removeEventListener('click', click, true); document.removeEventListener('pointerover', pointer, true);
        savedPanel.dispose(); inventories.clear(); inventoryLimit = false;
        for (const entry of [...entries.values()]) release(entry);
        style?.remove(); style = null; profile = null; choices = {}; failed = false;
    }
    return Object.freeze({ check, dispose, diagnostics: () => ({ active, decorated: entries.size, hiddenCount: Object.keys(visibleChoices()).length,
        storageFailed: failed, inventory: { rows: inventories.size, limitReached: inventoryLimit }, refill: refill.diagnostics(), viewing: viewing.diagnostics(),
        rows: rowDiagnostics(), navigation: navigation.snapshot() }) });
}
