import { createRecommendationDom } from '../netflix/recommendation-dom.js';
import { createCardActions, CARD_ACTION_STYLES } from '../card-actions.js';

export function createRecommendations({ environment, context, userscript, tUi, log = () => {}, warn = () => {} }) {
    const { document, location, MutationObserver, queueMicrotask } = environment;
    const dom = createRecommendationDom(environment), entries = new Map(), buttons = new WeakMap();
    const key = 'legacyMyListForNetflix.recommendationChoices.v1.';
    let active = false, profile = null, choices = {}, failed = false, observer = null, style = null, queued = false, epoch = 0;
    let titles = {}, manager = null;
    const pending = new Set();
    const allowed = () => location.origin === 'https://www.netflix.com' &&
        (location.pathname === '/browse' || (location.pathname.startsWith('/browse/') && location.pathname !== '/browse/my-list') || location.pathname === '/search');
    const readProfile = () => { const value = context.activeProfile(); return typeof value === 'string' && value ? value : null; };
    function read(p) {
        if (typeof userscript.getValue !== 'function' || typeof userscript.setValue !== 'function') throw new Error('storage-unavailable');
        const value = userscript.getValue(key + encodeURIComponent(p), null);
        if (value === null) return { choices: {}, titles: {} };
        if (value?.version !== 1 || !value.choices || typeof value.choices !== 'object' || Array.isArray(value.choices) ||
            Object.keys(value.choices).length > 5000) throw new Error('invalid-storage');
        const choices = Object.fromEntries(Object.entries(value.choices).filter(([id, reason]) => /^\d+$/.test(id) && ['watched', 'hide'].includes(reason)));
        const titles = Object.fromEntries(Object.keys(choices).filter(id => typeof value.titles?.[id] === 'string')
            .map(id => [id, value.titles[id].slice(0, 300)]));
        return { choices, titles };
    }
    function release(entry) { entry.controls.remove(); entry.label.remove(); entry.lease.release(); entries.delete(entry.host); }
    function syncProfile() {
        const next = readProfile();
        if (next === profile) return;
        for (const entry of [...entries.values()]) release(entry);
        profile = next; choices = {}; titles = {}; failed = false; epoch++; pending.clear(); queued = false;
        if (manager) { manager.panel.hidden = true; manager.toggle.setAttribute('aria-expanded', 'false'); }
        if (next) try { const loaded = read(next); if (readProfile() === next) ({ choices, titles } = loaded); else profile = null; }
        catch (error) { failed = true; warn('Recommendation choices unavailable', { reason: error.message }); }
        paintManager();
    }
    function paintManager() {
        if (!manager) return;
        const focusedIndex = [...manager.list.querySelectorAll('button')].indexOf(document.activeElement);
        manager.root.hidden = !profile;
        manager.toggle.textContent = `${tUi('recommendationWatched')} / ${tUi('recommendationHidden')} (${Object.keys(choices).length})`;
        if (manager.panel.hidden) { manager.list.replaceChildren(); return; }
        const nodes = [];
        if (failed || !Object.keys(choices).length) {
            const message = document.createElement('p');
            message.textContent = tUi(failed ? 'viewingChoiceStorageFailed' : 'noRecommendationChoices'); nodes.push(message);
        } else for (const reason of ['watched', 'hide']) {
            const ids = Object.keys(choices).filter(id => choices[id] === reason);
            if (!ids.length) continue;
            const heading = document.createElement('h3'); heading.textContent = tUi(reason === 'watched' ? 'recommendationWatched' : 'recommendationHidden'); nodes.push(heading);
            for (const id of ids) {
                const row = document.createElement('div'); row.className = 'tm-rec-saved-row';
                const name = document.createElement('a');
                name.textContent = titles[id] || [...entries.values()].find(entry => entry.id === id && entry.title)?.title || `#${id}`;
                name.setAttribute('href', `/title/${id}`);
                const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '\u00d7';
                remove.setAttribute('aria-label', `${tUi('undoRecommendation')}: ${name.textContent}`); remove.title = tUi('undoRecommendation');
                buttons.set(remove, { action: 'undo', id, profile, epoch }); row.appendChild(name); row.appendChild(remove); nodes.push(row);
            }
        }
        manager.list.replaceChildren(...nodes);
        if (focusedIndex >= 0) {
            const remaining = manager.list.querySelectorAll('button');
            (remaining[Math.min(focusedIndex, remaining.length - 1)] || manager.close).focus?.();
        }
    }
    function mountManager() {
        if (manager) return;
        const root = document.createElement('aside'); root.className = 'tm-rec-manager';
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'tm-rec-saved-panel'); buttons.set(toggle, { action: 'manager' });
        const panel = document.createElement('section'); panel.id = 'tm-rec-saved-panel'; panel.hidden = true;
        panel.setAttribute('aria-label', `${tUi('recommendationWatched')} / ${tUi('recommendationHidden')}`);
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '\u00d7';
        close.setAttribute('aria-label', tUi('closeRecommendationPanel')); buttons.set(close, { action: 'close' });
        const list = document.createElement('div'); panel.appendChild(close); panel.appendChild(list); root.appendChild(toggle); root.appendChild(panel);
        manager = { root, toggle, panel, close, list }; document.body.appendChild(root); paintManager();
    }
    function keydown(event) {
        if (event.key === 'Escape' && manager && !manager.panel.hidden) {
            manager.panel.hidden = true; manager.toggle.setAttribute('aria-expanded', 'false'); manager.list.replaceChildren(); manager.toggle.focus?.();
        }
    }
    function paint(entry) {
        const reason = choices[entry.id];
        if (!entry.lease.hide(Boolean(reason))) return;
        entry.controls.setAttribute('data-tm-rec-hidden', reason ? 'true' : 'false');
        entry.watched.hidden = Boolean(reason); entry.hide.hidden = Boolean(reason);
        entry.undo.hidden = !reason; entry.label.hidden = !reason;
        entry.label.textContent = tUi(reason === 'watched' ? 'recommendationWatched' : 'recommendationHidden');
        for (const button of [entry.watched, entry.hide, entry.undo]) {
            button.disabled = !profile || failed;
            button.title = failed || !profile ? tUi('viewingChoiceStorageFailed') : button.textContent;
        }
    }
    function decorate(value) {
        const existing = entries.get(value.host);
        if (existing && existing.id === value.id && existing.card === value.card && existing.controls.parentElement === value.host) return;
        if (existing) release(existing);
        const actions = [['watched', 'watched', 'markWatched'], ['hide', 'hide', 'hideRecommendation'], ['undo', 'undo', 'undoRecommendation']];
        const { root: controls, buttons: actionButtons } = createCardActions(document, actions.map(([, , message]) => tUi(message)));
        controls.className = 'tm-rec-controls';
        const entry = { ...value, controls, lease: dom.lease(value) };
        const label = document.createElement('span'); label.className = 'tm-rec-placeholder'; entry.label = label;
        for (const [index, [action, field, message]] of actions.entries()) {
            const button = actionButtons[index];
            button.setAttribute('aria-label', tUi(message)); buttons.set(button, { entry, action }); entry[field] = button;
        }
        entries.set(value.host, entry); value.host.appendChild(label); value.host.appendChild(controls); paint(entry);
    }
    function scan(root = document) {
        if (!active || !allowed()) return;
        const previous = profile; syncProfile();
        mountManager();
        if (!profile) return;
        if (previous !== profile) root = document;
        for (const entry of [...entries.values()]) if (!entry.lease.current()) release(entry);
        for (const value of dom.scan(root)) decorate(value);
        if (!style) {
            style = document.createElement('style');
            style.textContent = CARD_ACTION_STYLES + '\n.tm-rec-placeholder{position:absolute;inset:0;background:#181818;display:flex;align-items:center;justify-content:center;font:13px system-ui;color:#bbb;pointer-events:none}.tm-rec-placeholder[hidden]{display:none!important}.tm-rec-controls{opacity:1;pointer-events:auto}';
            style.textContent += '\n.tm-rec-manager{position:fixed;right:16px;top:100px;z-index:10000;font:14px system-ui;color:#fff}.tm-rec-manager[hidden],.tm-rec-manager [hidden]{display:none!important}.tm-rec-manager button{background:#242424;color:#fff;border:1px solid #777;border-radius:5px;padding:8px;cursor:pointer}.tm-rec-manager button:focus-visible,.tm-rec-manager a:focus-visible{outline:2px solid #fff;outline-offset:2px}.tm-rec-manager section{margin-top:8px;width:min(360px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#181818;border:1px solid #555;border-radius:8px;padding:12px;box-sizing:border-box;box-shadow:0 8px 24px #0008}.tm-rec-manager section>button{display:block;margin-left:auto}.tm-rec-saved-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #333}.tm-rec-saved-row a{flex:1;color:#eee;text-decoration:none;overflow-wrap:anywhere}.tm-rec-saved-row button{border:0;background:transparent;font-size:22px;padding:0 8px}.tm-rec-manager h3{font-size:14px}';
            document.head.appendChild(style);
        }
    }
    function schedule(root) {
        pending.add(root); if (pending.size > 24) { pending.clear(); pending.add(document); } if (queued) return;
        queued = true; const owner = epoch;
        queueMicrotask(() => { if (!active || owner !== epoch) return; queued = false;
            const roots = [...pending]; pending.clear(); for (const node of roots) if (node === document || node.isConnected) scan(node);
        });
    }
    function click(event) {
        const button = event.target?.closest?.('button'), input = buttons.get(button);
        if (!input || (input.entry && entries.get(input.entry.host) !== input.entry)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!active || !allowed()) { check(); return; }
        if (input.action === 'manager' || input.action === 'close') {
            syncProfile(); if (!profile || !manager) return;
            manager.panel.hidden = input.action === 'close' || !manager.panel.hidden;
            manager.toggle.setAttribute('aria-expanded', String(!manager.panel.hidden)); paintManager();
            (manager.panel.hidden ? manager.toggle : manager.close).focus?.(); return;
        }
        const before = profile; syncProfile();
        if (!profile || failed || profile !== before || (input.entry ? !input.entry.lease.current() :
            input.profile !== profile || input.epoch !== epoch || !button.isConnected)) { scan(); return; }
        try {
            const p = profile, owner = epoch, latest = read(p);
            const id = input.entry?.id || input.id;
            if (input.action === 'undo') { delete latest.choices[id]; delete latest.titles[id]; }
            else { latest.choices[id] = input.action; if (input.entry.title) latest.titles[id] = input.entry.title; }
            if (Object.keys(latest.choices).length > 5000) throw new Error('storage-full');
            if (readProfile() !== p || epoch !== owner) { scan(); return; }
            userscript.setValue(key + encodeURIComponent(p), { version: 1, ...latest });
            if (readProfile() !== p || epoch !== owner || !active || !allowed()) { check(); return; }
            ({ choices, titles } = latest);
            for (const entry of entries.values()) paint(entry);
            paintManager();
            log('Recommendation visibility choice saved', { action: input.action, hiddenCount: Object.keys(choices).length });
        } catch (error) { failed = true; for (const entry of entries.values()) paint(entry); paintManager();
            warn('Recommendation choice could not be saved', { reason: error.message }); }
    }
    function pointer(event) {
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
                if (record.target?.closest?.('.tm-rec-controls, .tm-rec-placeholder, .tm-rec-manager') || record.target === style) continue;
                if (record.type === 'attributes') schedule(record.target.parentElement || document);
                else if (record.type === 'childList') {
                    if ([...(record.addedNodes || []), ...(record.removedNodes || [])].every(node => node === style || ['tm-rec-controls', 'tm-rec-placeholder', 'tm-rec-manager'].includes(node.className))) continue;
                    schedule(record.target);
                }
            }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-uia'] });
    }
    function check() {
        if (!allowed()) { dispose(); return; }
        if (!active) { active = true; epoch++;
            document.addEventListener('click', click, true); document.addEventListener('pointerover', pointer, true); document.addEventListener('keydown', keydown, true); }
        scan(); observe();
    }
    function dispose() {
        active = false; epoch++; queued = false; pending.clear(); observer?.disconnect(); observer = null;
        document.removeEventListener('click', click, true); document.removeEventListener('pointerover', pointer, true);
        document.removeEventListener('keydown', keydown, true); manager?.root.remove(); manager = null;
        for (const entry of [...entries.values()]) release(entry);
        style?.remove(); style = null; profile = null; choices = {}; titles = {}; failed = false;
    }
    return Object.freeze({ check, dispose, diagnostics: () => ({ active, decorated: entries.size, hiddenCount: Object.keys(choices).length, storageFailed: failed }) });
}
