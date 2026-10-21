export function pairDomTrees(sourceRoot, cloneRoot, Element) {
    const domMap = new Map();
    const pairs = [];

    function walk(source, clone) {
        if (!(source instanceof Element) || !(clone instanceof Element)) return;
        domMap.set(source, clone);
        pairs.push([source, clone]);

        const sourceChildren = source.children;
        const cloneChildren = clone.children;
        const count = Math.min(sourceChildren.length, cloneChildren.length);
        for (let i = 0; i < count; i++) walk(sourceChildren[i], cloneChildren[i]);
    }

    walk(sourceRoot, cloneRoot);
    return { domMap, pairs };
}

