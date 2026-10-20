// Private presentation owner. Persistence and profile admission stay with recommendations.
export function createSavedChoicesPanel({ document, tUi, readPresentation, readTitle }) {
    let manager = null;
    const buttons = new WeakMap();
    function setOpen(open) {
        if (!manager) return;
        manager.panel.hidden = !open;
        manager.toggle.setAttribute('aria-expanded', String(open));
    }
    function paint() {
        if (!manager) return;
        const { profile, epoch, failed, records } = readPresentation();
        const focusedIndex = [...manager.list.querySelectorAll('button')].indexOf(document.activeElement);
        manager.root.hidden = !profile;
        manager.toggle.textContent = `${tUi('watchedCaughtUp')} / ${tUi('recommendationHidden')} (${records.length})`;
        if (manager.panel.hidden) { manager.list.replaceChildren(); return; }
        const nodes = [];
        if (failed || !records.length) {
            const message = document.createElement('p');
            message.textContent = tUi(failed ? 'viewingChoiceStorageFailed' : 'noRecommendationChoices'); nodes.push(message);
        } else for (const [type, key] of [['movie', 'filterFilms'], ['series', 'filterSeries'], ['watched', 'watchedCaughtUp'], ['hide', 'recommendationHidden']]) {
            const selected = records.filter(record => type === 'movie' || type === 'series'
                ? record.reason === 'viewing' && record.type === type : record.reason === type || type === 'watched' && record.reason === 'viewing' && !['movie', 'series'].includes(record.type));
            if (!selected.length) continue;
            const heading = document.createElement('h3');
            heading.textContent = tUi(key); nodes.push(heading);
            for (const { id, reason, unverified } of selected) {
                const row = document.createElement('div'); row.className = 'tm-rec-saved-row';
                const name = document.createElement('a');
                name.textContent = readTitle(id) || `#${id}`;
                name.setAttribute('href', `/title/${id}`);
                if (unverified) { name.textContent += ' (' + tUi('unknownViewingStatus', { count: 1 }) + ')'; }
                const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '\u00d7';
                remove.setAttribute('aria-label', `${tUi('undoRecommendation')}: ${name.textContent}`); remove.title = tUi('undoRecommendation');
                buttons.set(remove, { action: 'undo', id, reason, profile, epoch }); row.appendChild(name); row.appendChild(remove); nodes.push(row);
            }
        }
        manager.list.replaceChildren(...nodes);
        if (focusedIndex >= 0) {
            const remaining = manager.list.querySelectorAll('button');
            (remaining[Math.min(focusedIndex, remaining.length - 1)] || manager.close).focus?.();
        }
    }
    function mount() {
        if (manager) return;
        const root = document.createElement('aside'); root.className = 'tm-rec-manager';
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'tm-rec-saved-panel'); buttons.set(toggle, { action: 'manager' });
        const panel = document.createElement('section'); panel.id = 'tm-rec-saved-panel'; panel.hidden = true;
        panel.setAttribute('aria-label', `${tUi('watchedCaughtUp')} / ${tUi('recommendationHidden')}`);
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '\u00d7';
        close.setAttribute('aria-label', tUi('closeRecommendationPanel')); buttons.set(close, { action: 'close' });
        const list = document.createElement('div'); panel.appendChild(close); panel.appendChild(list); root.appendChild(toggle); root.appendChild(panel);
        manager = { root, toggle, panel, close, list }; document.body.appendChild(root); paint();
    }
    function activate(action) {
        if (!manager) return;
        setOpen(action !== 'close' && manager.panel.hidden);
        paint();
        (manager.panel.hidden ? manager.toggle : manager.close).focus?.();
    }
    function keydown(event) {
        if (event.key === 'Escape' && manager && !manager.panel.hidden) {
            setOpen(false); manager.list.replaceChildren(); manager.toggle.focus?.();
        }
    }
    function start() { document.addEventListener('keydown', keydown, true); }
    function dispose() {
        document.removeEventListener('keydown', keydown, true); manager?.root.remove(); manager = null;
    }
    return Object.freeze({ start, mount, paint, activate, reset: () => setOpen(false), dispose,
        inputFor: button => buttons.get(button) });
}

export const SAVED_CHOICES_PANEL_STYLES = '\n.tm-rec-manager{position:fixed;right:16px;top:100px;z-index:10000;font:14px system-ui;color:#fff}.tm-rec-manager[hidden],.tm-rec-manager [hidden]{display:none!important}.tm-rec-manager button{background:#242424;color:#fff;border:1px solid #777;border-radius:5px;padding:8px;cursor:pointer}.tm-rec-manager button:focus-visible,.tm-rec-manager a:focus-visible{outline:2px solid #fff;outline-offset:2px}.tm-rec-manager section{margin-top:8px;width:min(360px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#181818;border:1px solid #555;border-radius:8px;padding:12px;box-sizing:border-box;box-shadow:0 8px 24px #0008}.tm-rec-manager section>button{display:block;margin-left:auto}.tm-rec-saved-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #333}.tm-rec-saved-row a{flex:1;color:#eee;text-decoration:none;overflow-wrap:anywhere}.tm-rec-saved-row button{border:0;background:transparent;font-size:22px;padding:0 8px}.tm-rec-manager h3{font-size:14px}';
