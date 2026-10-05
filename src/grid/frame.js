import { GRID_ID, STATUS_ID, STATUS_TEXT_CLASS, STATUS_LABEL_CLASS, STATUS_META_CLASS,
    LOG_LINK_ID, ORDER_MISMATCH_DIALOG_ID, OLD_IDS, OLD_STYLE_IDS, LEGACY_EMPTY_STATE_ID,
    SYNTHETIC_SECTION_ID, ORIGINAL_HEADER_CLASS, SECTION_ATTR } from '../dom-names.js';
import { installStyles } from './styles.js';

// Script-owned presentation resources. Native and membership policy are supplied by callers.
export function createFrame({ document, tLog, tUi, copyLogs, setTimeout, clearTimeout, isActive, createError,
    readEmptyContent, readEmptyShell, cloneEmptyContent }) {
    let root = null;
    let status = null, style = null, dialog = null, logLink = null, logListener = null;
    let feedbackTimer = null, generation = 0, frameRevision = 0, copySequence = 0, dialogRevision = 0, releaseFailures = 0;
    let empty = null, emptyTemplate = null, emptyMessage = '', synthetic = null, emptyRevision = 0, syntheticRevision = 0;
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
    function geometry({ bounds, viewportWidth }, layout, assertCurrent = () => {}) {
        assertCurrent();
        const left = Math.max(0, layout.gridLeft), viewportRight = Math.min(viewportWidth, bounds.right);
        const available = Math.max(layout.cardWidth, viewportRight - bounds.left - left);
        const width = Math.max(layout.cardWidth, Math.min(layout.gridWidth, available));
        const result = { width, left, columns: Math.max(1, layout.columns) };
        assertCurrent();
        return result;
    }
    function sanitizeEmpty(clone, source) {
        clone.id = LEGACY_EMPTY_STATE_ID;
        clone.classList.remove(ORIGINAL_HEADER_CLASS); clone.removeAttribute('data-uia');
        clone.setAttribute('data-tm-legacy-empty-state', 'true'); clone.setAttribute('data-tm-empty-source', source);
        for (const node of clone.querySelectorAll('[id], [data-uia]')) {
            node.removeAttribute('id'); node.removeAttribute('data-uia'); node.classList?.remove?.(ORIGINAL_HEADER_CLASS);
        }
        return clone;
    }
    function clearEmpty({ restoreGrid = true, assertCurrent = () => {} } = {}) {
        assertCurrent();
        const owner = generation, target = root, heading = status, previous = empty;
        empty = null; const revision = ++emptyRevision;
        const guard = () => {
            assertCurrent();
            if (generation !== owner || emptyRevision !== revision || root !== target || status !== heading) {
                throw createError('GRID_FRAME_RETIRED', 'Empty cleanup was replaced');
            }
        };
        guard();
        if (previous) attemptRelease(() => previous.remove());
        guard();
        if (restoreGrid && status?.isConnected && root?.isConnected && status.nextElementSibling !== root) {
            status.insertAdjacentElement('afterend', root); guard();
        }
    }
    function resetEmpty() { clearEmpty({ restoreGrid: false }); emptyTemplate = null; emptyMessage = ''; }
    function layoutEmpty(value, assertCurrent = () => {}) {
        const node = empty;
        if (!node?.isConnected) return;
        const guard = () => {
            assertCurrent();
            if (empty !== node) throw createError('GRID_FRAME_RETIRED', 'Empty frame changed');
        };
        guard(); node.style.marginLeft = `${value.left}px`; guard();
        node.style.width = `${value.width}px`; guard(); node.style.maxWidth = `${value.width}px`; guard();
    }
    function presentEmpty({ section, allowProvisional = false, geometry: value, assertCurrent = () => {} }) {
        const owner = generation, target = root, heading = status;
        clearEmpty({ restoreGrid: false, assertCurrent });
        const revision = emptyRevision;
        const guard = () => {
            assertCurrent();
            if (generation !== owner || emptyRevision !== revision || root !== target || status !== heading) {
                throw createError('GRID_FRAME_RETIRED', 'Empty publication was replaced');
            }
        };
        guard();
        if (!heading?.isConnected || !target?.isConnected) return false;
        const native = readEmptyContent(section);
        guard();
        let clone, template = null, message = null;
        if (native) {
            const current = () => {
                guard();
                const next = readEmptyContent(section);
                if (!native.node.isConnected || next?.node !== native.node || next.message !== native.message) {
                    throw createError('NATIVE_SOURCE_REPLACED', 'Native empty content changed');
                }
                guard();
            };
            current(); template = cloneEmptyContent(native.node); current();
            clone = sanitizeEmpty(cloneEmptyContent(native.node), 'native'); current();
            message = native.message;
        } else if (allowProvisional) {
            if (emptyTemplate) clone = sanitizeEmpty(cloneEmptyContent(emptyTemplate), 'provisional-cached');
            else {
                const shell = readEmptyShell(); guard();
                if (shell) {
                    clone = sanitizeEmpty(cloneEmptyContent(shell, emptyMessage || tUi('emptyMessage')), 'provisional-shell');
                    guard();
                    if (!shell.isConnected || readEmptyShell() !== shell) throw createError('NATIVE_SOURCE_REPLACED', 'Provisional empty shell changed');
                } else {
                    clone = document.createElement('div');
                    const text = document.createElement('p'); text.textContent = emptyMessage || tUi('emptyMessage');
                    clone.appendChild(text); sanitizeEmpty(clone, 'provisional-fallback');
                }
            }
        }
        guard();
        if (!clone) {
            if (heading.nextElementSibling !== target) heading.insertAdjacentElement('afterend', target);
            guard(); return false;
        }
        try {
            heading.insertAdjacentElement('afterend', clone); guard();
            clone.insertAdjacentElement('afterend', target); guard();
            empty = clone;
            if (value) layoutEmpty(value, guard);
            guard();
            if (template) { emptyTemplate = template; if (message) emptyMessage = message; }
            return true;
        } catch (error) {
            if (empty === clone) empty = null;
            attemptRelease(() => clone.remove());
            throw error;
        }
    }
    function ensureSynthetic(placement, assertCurrent = () => {}) {
        assertCurrent();
        if (!placement) return null;
        const { host, after } = placement, owner = generation, revision = ++syntheticRevision;
        const guard = () => {
            assertCurrent();
            if (generation !== owner || syntheticRevision !== revision || !host.isConnected || !after?.isConnected || after.parentElement !== host) {
                throw createError('NATIVE_SOURCE_REPLACED', 'Synthetic placement changed');
            }
        };
        guard();
        const node = synthetic || document.getElementById(SYNTHETIC_SECTION_ID) || document.createElement('section');
        node.id = SYNTHETIC_SECTION_ID; node.setAttribute('data-tm-synthetic-mylist', 'true'); node.setAttribute(SECTION_ATTR, 'true');
        guard();
        if (after.nextElementSibling !== node) after.insertAdjacentElement('afterend', node);
        try { guard(); } catch (error) { if (node !== synthetic) attemptRelease(() => node.remove()); throw error; }
        synthetic = node;
        return node;
    }
    function removeSynthetic(except = null, assertCurrent = () => {}) {
        assertCurrent();
        if (!synthetic || synthetic === except) return;
        syntheticRevision++;
        const previous = synthetic; synthetic = null; attemptRelease(() => previous.remove());
    }
    function createRoot() {
        const node = document.createElement('div');
        node.id = GRID_ID;
        node.setAttribute('data-tm-purpose', 'exact-items-and-live-react-hover');
        return node;
    }
    function applyGeometry(node, geometry, layout, assertCurrent = () => {}) {
        assertCurrent();
        const properties = { '--tm-cols': String(geometry.columns), '--tm-grid-width': `${geometry.width}px`,
            '--tm-grid-left': `${geometry.left}px`, '--tm-gap': `${layout.gap}px` };
        for (const [property, value] of Object.entries(properties)) {
            assertCurrent();
            if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
        }
        assertCurrent();
        if (node.style.marginTop !== '0px') node.style.marginTop = '0px';
        assertCurrent();
        node.__tmAppliedGeometry = geometry;
        return geometry;
    }
    function updateGeometry(node, value, layout, assertCurrent = () => {}) {
        const guard = () => {
            assertCurrent();
            if (node !== root || !node?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Grid geometry target was retired');
        };
        return applyGeometry(node, value, layout, guard);
    }
    function publish(node, { section, anchor, status, geometry, layout, visible = true, assertCurrent }) {
        assertCurrent();
        const owner = generation, revision = ++frameRevision;
        adoptStatus(status);
        const guard = () => {
            assertCurrent();
            if (generation !== owner || frameRevision !== revision) throw createError('GRID_FRAME_RETIRED', 'Frame publication was replaced');
            assertStatus(status);
        };
        applyGeometry(node, geometry, layout, guard);
        placeStatus(status, { section, anchor, assertCurrent: guard });
        layoutStatus(status, geometry, visible ? (layout.rowGap || 0) : 0, guard);
        guard();
        const previous = root || document.getElementById(GRID_ID);
        status.insertAdjacentElement('afterend', node);
        try { guard(); }
        catch (error) { if (node !== root) attemptRelease(() => node.remove()); throw error; }
        root = node;
        return previous;
    }
    function releaseReplacedRoot(previous) {
        if (previous && previous !== root) attemptRelease(() => previous.remove());
    }
    function mount(options) {
        const node = root || document.getElementById(GRID_ID) || createRoot();
        if (!node.children.length) node.setAttribute('data-tm-empty', 'true');
        const previous = publish(node, options);
        releaseReplacedRoot(previous);
        options.assertCurrent();
        if (root !== node) throw createError('GRID_FRAME_RETIRED', 'Mounted frame was retired');
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
    function orderChildren(parent, desired, assertCurrent = () => {}) {
        let reference = parent.children[0] || null;
        for (const child of desired) {
            assertCurrent();
            if (child !== reference) parent.insertBefore(child, reference);
            assertCurrent();
            reference = child.nextElementSibling;
        }
    }
    function retire() {
        const previous = { root, status, style, dialog, logLink, logListener, empty, synthetic };
        if (status) retiredStatuses.add(status);
        root = status = style = dialog = logLink = logListener = null;
        empty = emptyTemplate = synthetic = null; emptyMessage = ''; emptyRevision++; syntheticRevision++;
        generation++; frameRevision++; copySequence++; dialogRevision++;
        clearFeedback();
        return previous;
    }
    function release(previous) {
        if (previous.logLink) attemptRelease(() => previous.logLink.removeEventListener('click', previous.logListener));
        releaseDialog(previous.dialog);
        for (const node of [previous.root, previous.status, previous.style, previous.empty, previous.synthetic]) {
            // A reentrant lifecycle can explicitly acquire an existing resource before old cleanup finishes.
            if (node && node !== root && node !== status && node !== style && node !== empty && node !== synthetic) attemptRelease(() => node.remove());
        }
    }
    function assertParent(parent) {
        if (!root?.isConnected || !root.contains(parent)) throw Object.assign(new Error('Grid frame is no longer current'), { code: 'GRID_FRAME_RETIRED' });
    }
    return { get root() { return root; }, get status() { return status; }, createRoot, updateGeometry, publish, mount, releaseReplacedRoot,
        clearCards, setEmpty, moveCard, orderChildren, retire, release, assertParent,
        updateStatus, layoutStatus, applyStatusTypography, placeStatus, showMismatch, hideMismatch, installResources, cleanupArtifacts,
        geometry, clearEmpty, resetEmpty, presentEmpty, layoutEmpty, ensureSynthetic, removeSynthetic,
        emptyPresentation: () => ({ connected: Boolean(empty?.isConnected), source: empty?.getAttribute('data-tm-empty-source') || null }),
        setRefreshing(node, refreshing) {
            if (!node || node !== root) return false;
            if (refreshing) node.setAttribute('data-tm-responsive-refreshing', 'true');
            else node.removeAttribute('data-tm-responsive-refreshing');
            return true;
        },
        diagnostics: () => ({ frameReleaseFailures: releaseFailures }) };
}
