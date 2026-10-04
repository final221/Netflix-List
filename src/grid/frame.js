import { GRID_ID } from '../dom-names.js';

// The card frame owns structural publication and geometry. Status/empty UI transfers next.
export function createFrame({ document }) {
    let root = null;
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
        applyGeometry(node, geometry, layout);
        if (anchor?.isConnected) anchor.insertAdjacentElement('afterend', status);
        else section.prepend(status);
        status.style.marginLeft = `${geometry.left}px`;
        status.style.width = `${geometry.width}px`;
        status.style.setProperty('--tm-row-gap', `${visible ? (layout.rowGap || 0) : 0}px`);
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
    function retire() { const previous = root; root = null; return previous; }
    function assertParent(parent) {
        if (!root?.isConnected || !root.contains(parent)) throw Object.assign(new Error('Grid frame is no longer current'), { code: 'GRID_FRAME_RETIRED' });
    }
    return { get root() { return root; }, createRoot, applyGeometry, publish, mount, clearCards, setEmpty, moveCard, orderChildren, retire, assertParent };
}
