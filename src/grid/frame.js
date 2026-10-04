import { GRID_ID, STATUS_ID, STATUS_TEXT_CLASS, STATUS_LABEL_CLASS, STATUS_META_CLASS,
    LOG_LINK_ID, ORDER_MISMATCH_DIALOG_ID, OLD_IDS, OLD_STYLE_IDS } from '../dom-names.js';
import { installStyles } from './styles.js';

// Script-owned presentation resources. Native and membership policy are supplied by callers.
export function createFrame({ document, tLog, copyLogs, setTimeout, clearTimeout, isActive, createError }) {
    let root = null;
    let status = null, style = null, dialog = null, logLink = null, logListener = null;
    let feedbackTimer = null, generation = 0, copySequence = 0, dialogRevision = 0, releaseFailures = 0;
    const retiredStatuses = new WeakSet();
    function attemptRelease(action) { try { action(); } catch (_) { releaseFailures++; } }
    function clearFeedback() {
        const timer = feedbackTimer; feedbackTimer = null;
        if (timer !== null) attemptRelease(() => clearTimeout(timer));
    }
    function assertStatus(node) {
        if (!node || node !== status) throw createError('GRID_FRAME_RETIRED', 'Status frame is no longer current');
    }
    function adoptStatus(node) {
        if (retiredStatuses.has(node) || (status && status !== node)) {
            throw createError('GRID_FRAME_RETIRED', 'Status frame is no longer current');
        }
        status = node;
    }
    function updateStatus(content) {
        const node = status || document.createElement('div');
        node.id = STATUS_ID;
        status = node;
        let text = node.querySelector(`.${STATUS_TEXT_CLASS}`);
        if (!text) {
            text = document.createElement('span'); text.className = STATUS_TEXT_CLASS; node.appendChild(text);
        }
        const writePart = (className, value) => {
            let part = text.querySelector(`.${className}`);
            if (!part) { part = document.createElement('span'); part.className = className; text.appendChild(part); }
            if (part.textContent !== value) part.textContent = value;
        };
        writePart(STATUS_LABEL_CLASS, content && typeof content === 'object' ? content.label || '' : String(content ?? ''));
        writePart(STATUS_META_CLASS, content && typeof content === 'object' ? content.meta || '' : '');
        if (!logLink) {
            const link = document.createElement('a');
            link.id = LOG_LINK_ID; link.href = '#'; link.textContent = 'CopyLogs'; link.title = tLog('copyLogsTooltip');
            const owner = generation;
            const current = sequence => owner === generation && status === node && logLink === link &&
                link.isConnected && isActive() && sequence === copySequence;
            const listener = async event => {
                event.preventDefault();
                if (owner !== generation || logLink !== link || !link.isConnected || !isActive()) return;
                const sequence = ++copySequence;
                clearFeedback();
                link.textContent = 'CopyLogs';
                try {
                    await copyLogs();
                    if (!current(sequence)) return;
                    link.textContent = tLog('copied'); link.title = tLog('copied');
                    const timer = setTimeout(() => {
                        if (feedbackTimer !== timer) return;
                        feedbackTimer = null;
                        if (!current(sequence)) return;
                        link.textContent = 'CopyLogs'; link.title = tLog('copyLogsTooltip');
                    }, 2500);
                    feedbackTimer = timer;
                } catch (error) {
                    if (current(sequence)) link.title = tLog('copyFailed', { message: error?.message || error });
                }
            };
            logLink = link; logListener = listener;
            link.addEventListener('click', listener); node.appendChild(link);
        }
        return node;
    }
    function layoutStatus(node, geometry, rowGap, assertCurrent = () => {}) {
        const guard = () => { assertCurrent(); assertStatus(node); };
        guard();
        if (geometry) {
            node.style.marginLeft = `${geometry.left}px`; guard();
            node.style.width = `${geometry.width}px`; guard();
        }
        if (rowGap !== undefined) node.style.setProperty('--tm-row-gap', `${rowGap}px`);
        guard();
    }
    function applyStatusTypography(node, typography, assertCurrent = () => {}) {
        const guard = () => { assertCurrent(); assertStatus(node); };
        guard();
        for (const [property, value] of Object.entries(typography)) {
            guard();
            if (value) node.style.setProperty(property, value);
        }
        guard();
    }
    function placeStatus(node, { section, anchor, assertCurrent = () => {} }) {
        const guard = () => { assertCurrent(); assertStatus(node); };
        guard();
        if (anchor?.isConnected) anchor.insertAdjacentElement('afterend', node);
        else section.prepend(node);
        guard();
    }
    function releaseDialog(resource) {
        if (!resource) return;
        for (const [node, listener] of resource.listeners) attemptRelease(() => node.removeEventListener('click', listener));
        attemptRelease(() => resource.node.remove());
    }
    function hideMismatch() {
        const previous = dialog; dialog = null; dialogRevision++;
        releaseDialog(previous);
    }
    function showMismatch({ message, acceptLabel, cancelLabel, onAccept, onCancel, assertCurrent }) {
        const owner = generation, revision = ++dialogRevision;
        const guard = () => {
            assertCurrent();
            if (generation !== owner || revision !== dialogRevision || !isActive()) {
                throw createError('GRID_FRAME_RETIRED', 'Dialog frame is no longer current');
            }
        };
        guard();
        const previous = dialog; dialog = null; releaseDialog(previous); guard();
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
        try { guard(); } catch (error) { if (dialog === resource) hideMismatch(); throw error; }
        return node;
    }
    function installResources(assertCurrent = () => {}) {
        const owner = generation;
        assertCurrent();
        const acquired = style || installStyles(document);
        try {
            assertCurrent();
            if (generation !== owner) throw createError('GRID_FRAME_RETIRED', 'Resource frame is no longer current');
        } catch (error) { if (style !== acquired) attemptRelease(() => acquired.remove()); throw error; }
        style = acquired;
        return style;
    }
    function cleanupArtifacts(assertCurrent = () => {}) {
        const owner = generation;
        const guard = () => {
            assertCurrent();
            if (generation !== owner) throw createError('GRID_FRAME_RETIRED', 'Artifact cleanup frame is no longer current');
        };
        guard();
        for (const id of [...OLD_IDS, ...OLD_STYLE_IDS]) {
            guard(); document.getElementById(id)?.remove(); guard();
        }
    }
    function createRoot() {
        const node = document.createElement('div');
        node.id = GRID_ID;
        node.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        return node;
    }
    function applyGeometry(node, geometry, layout) {
        const properties = { '--tm-cols': String(geometry.columns), '--tm-grid-width': `${geometry.width}px`,
            '--tm-grid-left': `${geometry.left}px`, '--tm-gap': `${layout.gap}px` };
        for (const [property, value] of Object.entries(properties)) {
            if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
        }
        node.__tmAppliedGeometry = geometry;
        return geometry;
    }
    function publish(node, { section, anchor, status, geometry, layout, visible = true, assertCurrent }) {
        assertCurrent();
        adoptStatus(status);
        applyGeometry(node, geometry, layout);
        placeStatus(status, { section, anchor, assertCurrent });
        layoutStatus(status, geometry, visible ? (layout.rowGap || 0) : 0, assertCurrent);
        assertCurrent();
        const previous = root || document.getElementById(GRID_ID);
        status.insertAdjacentElement('afterend', node);
        node.style.marginTop = '0px';
        try { assertCurrent(); }
        catch (error) { node.remove(); throw error; }
        root = node;
        if (previous !== node) previous?.remove();
    }
    function mount(options) {
        const node = root || document.getElementById(GRID_ID) || createRoot();
        if (!node.children.length) node.setAttribute('data-tm-empty', 'true');
        publish(node, options);
        return node;
    }
    function clearCards() {
        root?.replaceChildren();
        root?.setAttribute('data-tm-empty', 'true');
    }
    function setEmpty(empty) {
        if (empty) root?.setAttribute('data-tm-empty', 'true');
        else root?.removeAttribute('data-tm-empty');
    }
    function moveCard(node, parent, before = null) { if (before !== node) parent.insertBefore(node, before); }
    function orderChildren(parent, desired) {
        let reference = parent.children[0] || null;
        for (const child of desired) {
            if (child !== reference) parent.insertBefore(child, reference);
            reference = child.nextElementSibling;
        }
    }
    function retire() {
        const previous = { root, status, style, dialog, logLink, logListener };
        if (status) retiredStatuses.add(status);
        root = status = style = dialog = logLink = logListener = null;
        generation++; copySequence++; dialogRevision++;
        clearFeedback();
        return previous;
    }
    function release(previous) {
        if (previous.logLink) attemptRelease(() => previous.logLink.removeEventListener('click', previous.logListener));
        releaseDialog(previous.dialog);
        for (const node of [previous.root, previous.status, previous.style]) {
            // A reentrant lifecycle can explicitly acquire an existing resource before old cleanup finishes.
            if (node && node !== root && node !== status && node !== style) attemptRelease(() => node.remove());
        }
    }
    function assertParent(parent) {
        if (!root?.isConnected || !root.contains(parent)) throw Object.assign(new Error('Grid frame is no longer current'), { code: 'GRID_FRAME_RETIRED' });
    }
    return { get root() { return root; }, get status() { return status; }, createRoot, applyGeometry, publish, mount,
        clearCards, setEmpty, moveCard, orderChildren, retire, release, assertParent,
        updateStatus, layoutStatus, applyStatusTypography, placeStatus, showMismatch, hideMismatch, installResources, cleanupArtifacts,
        diagnostics: () => ({ frameReleaseFailures: releaseFailures }) };
}
