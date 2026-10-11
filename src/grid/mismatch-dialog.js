import { ORDER_MISMATCH_DIALOG_ID } from '../dom-names.js';

// Private dialog presentation and input lifetime; frame coordinates retirement/release.
export function createMismatchDialog({ document, isActive, createError, attemptRelease }) {
    let dialog = null, revision = 0;
    function release(resource) {
        if (!resource) return;
        for (const [node, listener] of resource.listeners) attemptRelease(() => node.removeEventListener('click', listener));
        attemptRelease(() => resource.node.remove());
    }
    function retire() {
        const previous = dialog; dialog = null; revision++;
        return previous;
    }
    function hide() { release(retire()); }
    function show({ message, acceptLabel, cancelLabel, onAccept, onCancel, assertCurrent }) {
        const owner = ++revision;
        const guard = () => {
            assertCurrent();
            if (owner !== revision || !isActive()) {
                throw createError('GRID_FRAME_RETIRED', 'Dialog frame is no longer current');
            }
        };
        guard();
        const previous = dialog; dialog = null; release(previous); guard();
        const node = document.createElement('div'); node.id = ORDER_MISMATCH_DIALOG_ID;
        node.setAttribute('role', 'alertdialog'); node.setAttribute('aria-modal', 'false'); node.setAttribute('aria-label', message);
        const text = document.createElement('div'); text.setAttribute('data-tm-order-message', 'true'); text.textContent = message;
        const actions = document.createElement('div'); actions.setAttribute('data-tm-order-actions', 'true');
        const resource = { node, listeners: [], used: false };
        const button = (label, marker, action) => {
            const control = document.createElement('button'); control.type = 'button'; control.textContent = label;
            control.setAttribute(marker, 'true');
            const listener = () => {
                if (dialog !== resource || resource.used || !node.isConnected) return;
                try { guard(); } catch (_) { return; }
                if (dialog !== resource) return;
                resource.used = true;
                for (const [element, callback] of resource.listeners) attemptRelease(() => element.removeEventListener('click', callback));
                try { guard(); } catch (_) { return; }
                if (dialog !== resource) return;
                action();
            };
            resource.listeners.push([control, listener]); control.addEventListener('click', listener); actions.appendChild(control);
        };
        button(acceptLabel, 'data-tm-order-ok', onAccept); button(cancelLabel, 'data-tm-order-cancel', onCancel);
        node.append(text, actions); guard(); dialog = resource;
        (document.body || document.documentElement).appendChild(node);
        try { guard(); } catch (error) { if (dialog === resource) hide(); throw error; }
        return node;
    }
    return Object.freeze({ show, hide, retire, release });
}
