import { createCardMarkup } from '../netflix/card-markup.js';
import { createCards } from './cards.js';
import { createFrame } from './frame.js';
import { createGroups } from './groups.js';

export function createGrid({ document, location, runChunks,
    createError = (code, message) => Object.assign(new Error(message), { code }),
    prepareCard = () => {}, onRetire = () => {}, onReplace = () => {}, installHover = () => {},
    tLog = key => key, tUi = key => key, copyLogs = async () => {}, isActive = () => true,
    formatUiNumber = String, formatItemCount = String,
    readEmptyContent = () => null, readEmptyShell = () => null,
    setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) {
    const markup = createCardMarkup({ location, document });
    const frame = createFrame({ document, tLog, tUi, copyLogs, isActive, setTimeout, clearTimeout, createError,
        readEmptyContent, readEmptyShell, cloneEmptyContent: markup.cloneEmptyContent });
    let buildGeneration = 0;
    let cards;
    const groups = createGroups({ document, tUi, readRoot: () => frame.root, createError,
        getCard: item => cards.getCard(item), assertCard: handle => cards.assertCard(handle), formatUiNumber, formatItemCount,
        moveCard: (handle, parent, before) => { cards.assertCard(handle); frame.assertParent(parent); frame.moveCard(handle.node, parent, before); },
        orderChildren: (parent, nodes, guard) => { frame.assertParent(parent); frame.orderChildren(parent, nodes, guard); }, updateStatus: frame.updateStatus });
    cards = createCards({ markup, createError, prepareCard: (...args) => { groups.prepareCard(...args); prepareCard(...args); }, onRetire,
        onReplace: (...args) => { groups.replacePresentation(...args); onReplace(...args); },
        readRoot: () => frame.root, keyFor: item => item.videoId ? `v:${item.videoId}` : `h:${item.href}` });

    async function publish({ items, assertCurrent, ...mount }) {
        const owner = ++buildGeneration;
        const revision = cards.revision;
        const guard = () => {
            assertCurrent();
            if (owner !== buildGeneration || revision !== cards.revision) throw createError('GRID_BUILD_REPLACED', 'Grid build was superseded');
        };
        guard();
        const root = frame.createRoot(), staged = new Map();
        installHover(root);
        guard();
        try {
            await runChunks(items.length, index => cards.stage(items, root, index, staged), guard);
            guard();
            cards.retireForPublication(guard);
            const previous = frame.publish(root, { ...mount, assertCurrent: guard });
            cards.publish(staged);
            items.forEach(cards.releaseStartup);
            groups.retireRoot(previous);
            frame.setEmpty(staged.size === 0);
            const acceptedRevision = cards.revision;
            frame.releaseReplacedRoot(previous);
            assertCurrent();
            if (owner !== buildGeneration || acceptedRevision !== cards.revision) throw createError('GRID_BUILD_REPLACED', 'Accepted grid was superseded');
            return root;
        } catch (error) {
            if (frame.root !== root) root.remove();
            throw error;
        }
    }
    function dispose() {
        ++buildGeneration;
        const previous = frame.retire();
        const previousGroups = groups.retirePresentation();
        try { cards.dispose(); }
        finally { groups.releasePresentation(previousGroups); frame.release(previous); }
    }
    function clearCards(assertCurrent = () => {}) {
        ++buildGeneration;
        cards.retireForPublication(assertCurrent);
        assertCurrent();
        frame.clearCards();
        cards.publish(new Map());
    }
    return Object.freeze({ publish, dispose, clearCards, mount: frame.mount, cancelBuild: () => { ++buildGeneration; },
        get cards() { return cards.view; }, get root() { return frame.root; }, get status() { return frame.status; },
        updateStatus: frame.updateStatus, layoutStatus: frame.layoutStatus, applyStatusTypography: frame.applyStatusTypography,
        placeStatus: frame.placeStatus,
        showMismatch: frame.showMismatch, hideMismatch: frame.hideMismatch,
        installResources: frame.installResources, cleanupArtifacts: frame.cleanupArtifacts,
        geometry: frame.geometry, clearEmpty: frame.clearEmpty, resetEmpty: frame.resetEmpty, presentEmpty: frame.presentEmpty,
        layoutEmpty: frame.layoutEmpty, emptyPresentation: frame.emptyPresentation,
        ensureSynthetic: frame.ensureSynthetic, removeSynthetic: frame.removeSynthetic, setRefreshing: frame.setRefreshing,
        getCard: cards.getCard, assertCard: cards.assertCard, isCardCurrent: cards.isCurrent,
        replaceCard: cards.replaceCard,
        removeCard: (...args) => { const result = cards.removeCard(...args); frame.setEmpty(cards.view.size === 0); return result; },
        insertCard: (...args) => { const result = cards.insertCard(...args); frame.setEmpty(false); return result; },
        setEmpty: frame.setEmpty,
        updateCard: cards.updateCard, materialFor: cards.materialFor,
        updateCardPlacement: groups.updateCardPlacement, attachPlacementActions: groups.attachPlacementActions,
        applyViewingChange: groups.applyViewingChange, resetViewing: groups.resetViewing,
        presentation: groups.presentation, groupDiagnostics: groups.groupDiagnostics,
        isCardVisible: groups.isCardVisible,
        hasRetained: cards.hasRetained, releaseRetained: cards.releaseRetained, clearRetained: cards.clearRetained,
        captureCard: markup.capture, captureTemplate: markup.captureTemplate, normalizeCard: markup.normalize,
        moveCard: (handle, parent, before) => { cards.assertCard(handle); frame.assertParent(parent); frame.moveCard(handle.node, parent, before); },
        orderChildren: (parent, desired) => { frame.assertParent(parent); frame.orderChildren(parent, desired); },
        applyGeometry: frame.updateGeometry, diagnostics: () => ({ ...cards.diagnostics(), ...frame.diagnostics(), ...groups.diagnostics() }) });
}
