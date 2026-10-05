// Script-owned viewing presentation. Placement/profile/storage decisions stay with viewing.
export function createGroups({ document, tUi, readRoot, getCard, assertCard, createError }) {
    let controlsByNode = new WeakMap(), actions = null, revision = 0, releaseFailures = 0;
    function release(resource) {
        if (!resource) return;
        try { resource.root.removeEventListener('click', resource.listener, true); }
        catch (_) { releaseFailures++; }
    }
    function prepareCard(node, item) {
        let controls = controlsByNode.get(node);
        if (!controls || controls.root.parentElement !== node) {
            // Detached captured/replacement trees may contain copied controls without identity.
            for (const child of [...node.children]) {
                if (child.getAttribute('data-tm-viewing-actions') === 'true') child.remove();
            }
            const root = document.createElement('div'); root.setAttribute('data-tm-viewing-actions', 'true');
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('data-tm-viewing-action', 'toggle');
            const marker = document.createElement('span'); marker.setAttribute('data-tm-manual-choice', 'true'); marker.setAttribute('role', 'img');
            root.appendChild(toggle); root.appendChild(marker); node.appendChild(root);
            controls = { root, toggle, marker, item }; controlsByNode.set(node, controls);
        }
        return controls;
    }
    function updateCardPlacement(handle, facts, assertCurrent = () => {}) {
        let controls;
        const guard = () => {
            assertCurrent(); assertCard(handle);
            if (controls && (controlsByNode.get(handle.node) !== controls || controls.root.parentElement !== handle.node ||
                controls.toggle.parentElement !== controls.root || controls.marker.parentElement !== controls.root)) {
                throw createError('GRID_CONTROL_RETIRED', 'Placement controls changed');
            }
        };
        guard();
        controls = controlsByNode.get(handle.node);
        if (!controls || controls.root.parentElement !== handle.node) throw createError('GRID_CONTROL_RETIRED', 'Placement controls changed');
        const write = (read, apply, value) => { guard(); if (read() !== value) apply(value); guard(); };
        const label = tUi(facts.status === 'complete' ? 'moveBackToMyList' : facts.type === 'series' ? 'markCaughtUp' : 'markWatched');
        write(() => controls.toggle.textContent, value => { controls.toggle.textContent = value; }, label);
        write(() => controls.toggle.getAttribute('aria-label'), value => controls.toggle.setAttribute('aria-label', value),
            label + ': ' + (controls.item.ariaLabel || String(controls.item.videoId)));
        write(() => controls.toggle.disabled, value => { controls.toggle.disabled = value; }, Boolean(facts.disabled));
        write(() => controls.marker.textContent, value => { controls.marker.textContent = value; }, tUi('manualViewingChoice'));
        const description = tUi('manualViewingChoiceDescription');
        write(() => controls.marker.getAttribute('title'), value => controls.marker.setAttribute('title', value), description);
        write(() => controls.marker.getAttribute('aria-label'), value => controls.marker.setAttribute('aria-label', value), description);
        write(() => controls.marker.hidden, value => { controls.marker.hidden = value; }, !facts.manual);
    }
    function visible(node, root) {
        if (!node?.isConnected || !root?.isConnected || node.getAttribute('data-tm-type-hidden') === 'true') return false;
        if (node.parentElement === root) return true;
        const parent = node.parentElement, details = parent?.parentElement;
        return parent?.getAttribute('data-tm-watch-grid') === 'true' && details?.parentElement === root && details.open === true;
    }
    function attachPlacementActions({ assertCurrent, onAction }) {
        const root = readRoot(), owner = ++revision;
        const guard = () => {
            assertCurrent();
            if (revision !== owner || root !== readRoot() || !root?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Placement action frame changed');
        };
        guard();
        const previous = actions; actions = null; release(previous); guard();
        const resource = { root, listener: null };
        resource.listener = event => {
            if (actions !== resource) return;
            let button = event.target?.getAttribute ? event.target : event.target?.parentElement;
            while (button && button !== root && !button.getAttribute('data-tm-viewing-action')) button = button.parentElement;
            if (!button || button === root || button.getAttribute('data-tm-viewing-action') !== 'toggle') return;
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
            if (button.disabled) return;
            try { guard(); } catch (_) { return; }
            let node = button.parentElement;
            while (node && node !== root && !controlsByNode.has(node)) node = node.parentElement;
            const controls = controlsByNode.get(node);
            if (!controls || controls.toggle !== button || !visible(node, root)) return;
            const handle = getCard(controls.item);
            if (!handle || handle.node !== node) return;
            try { assertCard(handle); guard(); } catch (_) { return; }
            onAction(controls.item);
            try { guard(); } catch (_) { return; }
            const current = getCard(controls.item);
            if (!current || !visible(current.node, root)) {
                root.querySelector('[data-tm-watch-section]')?.querySelector('summary')?.focus?.({ preventScroll: true });
            }
        };
        actions = resource;
        root.addEventListener('click', resource.listener, true);
        try { guard(); } catch (error) { if (actions === resource) { actions = null; release(resource); } throw error; }
    }
    function dispose() {
        revision++;
        const previous = actions; actions = null; controlsByNode = new WeakMap(); release(previous);
    }
    function retireActions(root) {
        if (actions?.root !== root) return;
        revision++;
        const previous = actions; actions = null; release(previous);
    }
    return { prepareCard, updateCardPlacement, attachPlacementActions, retireActions, dispose,
        diagnostics: () => ({ placementReleaseFailures: releaseFailures }) };
}
