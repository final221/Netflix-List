// Preferences and userscript menus are application resources; no feature DOM is accessed.
export function createSettings({ storage, registerMenu, unregisterMenu, tUi = key => key, onChange = () => {}, warn = () => {} }) {
    const storageKey = 'legacyMyListForNetflix.settings.v3';
    let visible = true, active = false, menu = null, menuRevision = 0;
    const preferences = () => Object.freeze({ viewOriginalMyList: visible });
    function save() { try { storage?.setItem(storageKey, JSON.stringify(preferences())); } catch (_) {} }
    function releaseMenu() {
        const previous = menu; menu = null; ++menuRevision;
        if (previous !== null && previous !== undefined) { try { unregisterMenu?.(previous); } catch (_) {} }
    }
    function refresh() {
        releaseMenu();
        if (!active || typeof registerMenu !== 'function') return;
        const revision = menuRevision;
        try {
            menu = registerMenu(tUi(visible ? 'hideOriginalMyList' : 'showOriginalMyList'), () => {
                if (!active || revision !== menuRevision) return;
                visible = !visible; save(); refresh(); onChange(preferences());
            });
        } catch (error) {
            try { warn('Userscript menu registration failed', error); } catch (_) {}
        }
    }
    function start() {
        if (active) return;
        active = true;
        try {
            const parsed = JSON.parse(storage?.getItem(storageKey) || '{}');
            if (typeof parsed.viewOriginalMyList === 'boolean') visible = parsed.viewOriginalMyList;
            save();
        } catch (_) {}
        refresh();
    }
    function dispose() { active = false; releaseMenu(); }
    return Object.freeze({ start, dispose, preferences, refresh });
}
