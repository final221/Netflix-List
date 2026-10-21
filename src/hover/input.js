// Exact document/grid listener admission and retirement; intent policy stays with hover.
export function createHoverInput({ document, Element, gridOwnsClone, sessionScope, isRouteSessionActive,
    handleGridClonePointerOver, handleGridClonePointerLeave, cancelPendingGridHover,
    handleTargetPointerMove, previewPointerOut, handleHoverDiagnosticVisibilityChange, handleTargetScroll }) {
    let listenersActive = false;
    let listenerRevision = 0;
    let documentListeners = [];
    const gridListeners = new Map();

    function gridCloneFromPointerEvent(event, grid, includeViewingControls = false) {
        let node = event.target instanceof Element ? event.target : event.target?.parentElement;
        while (node && node !== grid) {
            if (!includeViewingControls && node.getAttribute('data-tm-viewing-actions') === 'true') return null;
            if (node.__tmMyListItem && gridOwnsClone(node, grid)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function ensureGridHoverBehavior(grid) {
        if (!grid || grid.__tmHoverBehaviorInstalled) return;
        for (const [previous, listeners] of gridListeners) if (!previous.isConnected) {
            previous.removeEventListener('pointerover', listeners.over, true);
            previous.removeEventListener('pointerout', listeners.out, true);
            delete previous.__tmHoverBehaviorInstalled;
            gridListeners.delete(previous);
        }
        grid.__tmHoverBehaviorInstalled = true;
        const installedSession = sessionScope.token;
        const over = event => {
            if (!listenersActive || gridListeners.get(grid)?.over !== over || !isRouteSessionActive(installedSession)) return;
            const clone = gridCloneFromPointerEvent(event, grid);
            if (clone) {
                clone.__tmViewingControlHovered = false;
                handleGridClonePointerOver(event, clone, clone.__tmMyListItem);
            } else {
                const controlClone = gridCloneFromPointerEvent(event, grid, true);
                if (controlClone) {
                    controlClone.__tmViewingControlHovered = true;
                    handleGridClonePointerLeave(controlClone, controlClone.__tmMyListItem, event.target, event);
                } else cancelPendingGridHover('controls');
            }
        };
        const out = event => {
            if (!listenersActive || gridListeners.get(grid)?.out !== out || !isRouteSessionActive(installedSession)) return;
            const clone = gridCloneFromPointerEvent(event, grid);
            if (!clone || (event.relatedTarget && clone.contains(event.relatedTarget))) return;
            handleGridClonePointerLeave(clone, clone.__tmMyListItem, event.relatedTarget, event);
        };
        gridListeners.set(grid, { over, out });
        grid.addEventListener('pointerover', over, { capture: true, passive: true });
        grid.addEventListener('pointerout', out, { capture: true, passive: true });
    }

    function start() {
        if (listenersActive) return;
        listenersActive = true;
        const revision = ++listenerRevision, sessionToken = sessionScope.token;
        documentListeners = [ ['pointermove', handleTargetPointerMove, true], ['pointerout', previewPointerOut, true],
            ['visibilitychange', handleHoverDiagnosticVisibilityChange, false], ['wheel', handleTargetScroll, true], ['scroll', handleTargetScroll, true] ]
            .map(([type, callback, capture]) => ({ type, capture, listener: event => {
                if (listenersActive && listenerRevision === revision && isRouteSessionActive(sessionToken)) callback(event);
            } }));
        for (const entry of documentListeners) document.addEventListener(entry.type, entry.listener, { passive: true, capture: entry.capture });
    }

    function dispose() {
        listenersActive = false;
        listenerRevision++;
        const retiredListeners = documentListeners; documentListeners = [];
        for (const entry of retiredListeners) document.removeEventListener(entry.type, entry.listener, entry.capture);
        const retiredGrids = [...gridListeners]; gridListeners.clear();
        for (const [grid, listeners] of retiredGrids) {
            grid.removeEventListener('pointerover', listeners.over, true); grid.removeEventListener('pointerout', listeners.out, true);
            delete grid.__tmHoverBehaviorInstalled;
        }
    }
    return Object.freeze({ start, dispose, install: ensureGridHoverBehavior, target: gridCloneFromPointerEvent });
}
