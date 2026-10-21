import { pairDomTrees } from './dom-pairs.js';

// Copied values and exact accepted-card association retire together.
export function createGraft({ Element, Node, warn, tLog, onCleanupFailure }) {
    const graftedGridClones = new Set(), graftValues = new WeakMap(), graftHandles = new WeakMap();
    // Contains the private React-key graft used only to make cloned cards hoverable.
    const netflixReactHover = Object.freeze({
        clearClone(root) {
            const nodes = [root, ...root.querySelectorAll('*')];
            for (const node of nodes) {
                for (const key of Object.getOwnPropertyNames(node)) {
                    if (!key.startsWith('__react')) continue;
                    if (key.startsWith('__reactContainer$')) continue;
                    try { delete node[key]; } catch (_) {}
                }
            }
        },

        graftTreeToClone(sourceRoot, cloneRoot) {
            const { domMap, pairs } = pairDomTrees(sourceRoot, cloneRoot, Element);
            const fiberMap = new Map();
            let fiberAssignments = 0;
            let propsAssignments = 0;

            function cloneFiberChain(sourceFiber) {
                if (!sourceFiber || typeof sourceFiber !== 'object') return sourceFiber;
                if (fiberMap.has(sourceFiber)) return fiberMap.get(sourceFiber);

                const clonedFiber = Object.assign(
                    Object.create(Object.getPrototypeOf(sourceFiber) || Object.prototype),
                    sourceFiber
                );
                fiberMap.set(sourceFiber, clonedFiber);

                if (sourceFiber.stateNode instanceof Node && domMap.has(sourceFiber.stateNode)) {
                    clonedFiber.stateNode = domMap.get(sourceFiber.stateNode);
                }

                // Preserve the structure that produced working hover behavior in legacy 1.2.0.
                clonedFiber.return = cloneFiberChain(sourceFiber.return);
                return clonedFiber;
            }

            const groups = [
                { prefixes: ['__reactFiber$', '__reactInternalInstance$'], copy: cloneFiberChain,
                    assigned: () => fiberAssignments++, failure: 'fiberGraftFailed' },
                { prefixes: ['__reactProps$', '__reactEventHandlers$'], copy: value => value,
                    assigned: () => propsAssignments++, failure: 'propsGraftFailed' },
                { prefixes: ['__react'], copy: value => value, assigned: () => {}, failure: null }
            ];
            for (const [source, clone] of pairs) {
                const keys = groups.map(() => []);
                for (const key of Object.getOwnPropertyNames(source)) {
                    if (!key.startsWith('__react') || key.startsWith('__reactContainer$')) continue;
                    keys[groups.findIndex(group => group.prefixes.some(prefix => key.startsWith(prefix)))].push(key);
                }
                // Preserve assignment order: fibers, props, then remaining React keys.
                groups.forEach((group, index) => {
                    for (const key of keys[index]) {
                        try { clone[key] = group.copy(source[key]); group.assigned(); }
                        catch (error) { if (group.failure) warn(tLog(group.failure), key, error); }
                    }
                });
            }

            cloneRoot.setAttribute('data-tm-react-grafted', 'true');
            graftedGridClones.add(cloneRoot);
            graftValues.set(cloneRoot, pairs.map(([, node]) => ({ node, keys: Object.getOwnPropertyNames(node).filter(key => key.startsWith('__react') && !key.startsWith('__reactContainer$')).map(key => [key, node[key]]) })));
            return { fiberAssignments, propsAssignments, clonedFibers: fiberMap.size };
        }
    });

    // Contains the private React-key graft used only to make cloned cards hoverable.

    function releaseGridReact(clone) {
        if (!clone || !graftedGridClones.delete(clone)) return;
        const entries = graftValues.get(clone); graftValues.delete(clone); graftHandles.delete(clone);
        if (entries) { for (const { node, keys } of entries) for (const [key, value] of keys) {
            try { if (!graftValues.has(clone) && node[key] === value) delete node[key]; } catch (_) {}
        } } else netflixReactHover.clearClone(clone);
        for (const attribute of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted']) {
            try { if (!graftValues.has(clone)) clone.removeAttribute(attribute); } catch (_) { onCleanupFailure(); }
        }
    }

    function invalidateGridReact(except = null) {
        for (const clone of graftedGridClones) {
            if (clone !== except || !clone.isConnected) releaseGridReact(clone);
        }
    }


    return Object.freeze({ graft: netflixReactHover.graftTreeToClone, release: releaseGridReact,
        invalidate: invalidateGridReact, associate: handle => graftHandles.set(handle.node, handle),
        replaced: handle => graftHandles.has(handle.node) && graftHandles.get(handle.node) !== handle,
        owns: handle => graftHandles.get(handle.node) === handle,
        forget: handle => graftHandles.delete(handle.node), pending: () => graftedGridClones.size });
}
