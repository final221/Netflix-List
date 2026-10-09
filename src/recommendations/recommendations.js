import { createRecommendationDom } from '../netflix/recommendation-dom.js';

export function createRecommendations({ environment, context, userscript, tUi, log = () => {}, warn = () => {} }) {
    const { document, location, MutationObserver, queueMicrotask } = environment;
    const dom = createRecommendationDom(environment), entries = new Map(), buttons = new WeakMap();
    const key = 'legacyMyListForNetflix.recommendationChoices.v1.';
    let active = false, profile = null, choices = {}, failed = false, observer = null, style = null, queued = false, epoch = 0;
    const pending = new Set();
    const allowed = () => location.origin === 'https://www.netflix.com' &&
        (location.pathname === '/browse' || (location.pathname.startsWith('/browse/') && location.pathname !== '/browse/my-list') || location.pathname === '/search');
    const readProfile = () => { const value = context.activeProfile(); return typeof value === 'string' && value ? value : null; };
    function read(p) {
        if (typeof userscript.getValue !== 'function' || typeof userscript.setValue !== 'function') throw new Error('storage-unavailable');
        const value = userscript.getValue(key + encodeURIComponent(p), null);
        if (value === null) return {};
        if (value?.version !== 1 || !value.choices || typeof value.choices !== 'object' || Array.isArray(value.choices) ||
            Object.keys(value.choices).length > 5000) throw new Error('invalid-storage');
        return Object.fromEntries(Object.entries(value.choices).filter(([id, reason]) => /^\d+$/.test(id) && ['watched', 'hide'].includes(reason)));
    }
    function release(entry) { entry.controls.remove(); entry.lease.release(); entries.delete(entry.host); }
    function syncProfile() {
        const next = readProfile();
        if (next === profile) return;
        for (const entry of [...entries.values()]) release(entry);
        profile = next; choices = {}; failed = false; epoch++; pending.clear(); queued = false;
        if (next) try { const loaded = read(next); if (readProfile() === next) choices = loaded; else profile = null; }
        catch (error) { failed = true; warn('Recommendation choices unavailable', { reason: error.message }); }
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
        const controls = document.createElement('div'); controls.className = 'tm-rec-controls';
        const entry = { ...value, controls, lease: dom.lease(value) };
        const label = document.createElement('span'); entry.label = label; controls.appendChild(label);
        for (const [action, field, message] of [['watched', 'watched', 'markWatched'], ['hide', 'hide', 'hideRecommendation'], ['undo', 'undo', 'undoRecommendation']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = tUi(message);
            button.setAttribute('aria-label', tUi(message)); buttons.set(button, { entry, action }); entry[field] = button; controls.appendChild(button);
        }
        entries.set(value.host, entry); value.host.appendChild(controls); paint(entry);
    }
    function scan(root = document) {
        if (!active || !allowed()) return;
        const previous = profile; syncProfile();
        if (!profile) return;
        if (previous !== profile) root = document;
        for (const entry of [...entries.values()]) if (!entry.lease.current()) release(entry);
        for (const value of dom.scan(root)) decorate(value);
        if (entries.size && !style) {
            style = document.createElement('style');
            style.textContent = '.tm-rec-controls{position:absolute;inset-inline:3px;bottom:3px;z-index:10;display:flex;flex-wrap:wrap;gap:3px;justify-content:center;opacity:0;pointer-events:none}.tm-rec-controls span{display:none}.tm-rec-controls button{font:12px system-ui!important;background:#161616!important;color:#fff!important;border:1px solid #aaa!important;border-radius:4px;padding:4px 6px;cursor:pointer}.tm-rec-controls [hidden]{display:none!important}*:hover>.tm-rec-controls,.tm-rec-controls:focus-within{opacity:1;pointer-events:auto}.tm-rec-controls[data-tm-rec-hidden="true"]{inset:0;background:#181818;opacity:1;pointer-events:auto;align-content:center}.tm-rec-controls[data-tm-rec-hidden="true"] span{display:block;width:100%;text-align:center;font:13px system-ui;color:#bbb}.tm-rec-controls button:disabled{opacity:.5;cursor:default}';
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
        if (!input || entries.get(input.entry.host) !== input.entry) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!active || !allowed()) { check(); return; }
        const before = profile; syncProfile();
        if (!profile || failed || profile !== before || !input.entry.lease.current()) { scan(); return; }
        try {
            const p = profile, owner = epoch, latest = read(p);
            if (input.action === 'undo') delete latest[input.entry.id]; else latest[input.entry.id] = input.action;
            if (Object.keys(latest).length > 5000) throw new Error('storage-full');
            if (readProfile() !== p || epoch !== owner) { scan(); return; }
            userscript.setValue(key + encodeURIComponent(p), { version: 1, choices: latest });
            if (readProfile() !== p || epoch !== owner || !active || !allowed()) { check(); return; }
            choices = latest;
            for (const entry of entries.values()) paint(entry);
            log('Recommendation visibility choice saved', { action: input.action, hiddenCount: Object.keys(choices).length });
        } catch (error) { failed = true; for (const entry of entries.values()) paint(entry);
            warn('Recommendation choice could not be saved', { reason: error.message }); }
    }
    function pointer(event) {
        if (!allowed()) { check(); return; }
        if (readProfile() !== profile) { scan(); observe(); return; }
        if (event.target?.closest?.('.tm-rec-controls')) return;
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
                if (record.target?.closest?.('.tm-rec-controls') || record.target === style) continue;
                if (record.type === 'attributes') schedule(record.target.parentElement || document);
                else if (record.type === 'childList') {
                    if ([...(record.addedNodes || []), ...(record.removedNodes || [])].every(node => node === style || node.className === 'tm-rec-controls')) continue;
                    schedule(record.target);
                }
            }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-uia'] });
    }
    function check() {
        if (!allowed()) { dispose(); return; }
        if (!active) { active = true; epoch++;
            document.addEventListener('click', click, true); document.addEventListener('pointerover', pointer, true); }
        scan(); observe();
    }
    function dispose() {
        active = false; epoch++; queued = false; pending.clear(); observer?.disconnect(); observer = null;
        document.removeEventListener('click', click, true); document.removeEventListener('pointerover', pointer, true);
        for (const entry of [...entries.values()]) release(entry);
        style?.remove(); style = null; profile = null; choices = {}; failed = false;
    }
    return Object.freeze({ check, dispose, diagnostics: () => ({ active, decorated: entries.size, hiddenCount: Object.keys(choices).length, storageFailed: failed }) });
}
