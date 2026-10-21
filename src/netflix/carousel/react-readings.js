// Private synchronous Netflix readings; carousel owns their cache and admission.
export function createReactReadings({ cardSelector, Element }) {
    const NETFLIX_DOM_SELECTORS = { standardCard: cardSelector };
    function diagnosticPrimitiveProps(props) {
        if (!props || typeof props !== 'object') return null;
        const keys = Object.keys(props);
        const interesting = {};
        const pattern = /(index|offset|position|slot|page|item|cursor|count|first|last|key|raw|virtual)/i;
        for (const key of keys) {
            if (!pattern.test(key)) continue;
            const value = props[key];
            if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
                interesting[key] = value;
            }
            if (Object.keys(interesting).length >= 24) break;
        }
        return { keys: keys.slice(0, 40), interesting };
    }

    function diagnosticFiberChain(node, maxDepth = 16) {
        const fiber = reader.fiberForNode(node);
        const chain = [];
        let current = fiber;
        const visited = new Set();
        let depth = 0;
        while (current && typeof current === 'object' && depth < maxDepth && !visited.has(current)) {
            visited.add(current);
            const stateNode = current.stateNode;
            chain.push({
                depth,
                tag: current.tag ?? null,
                key: current.key ?? null,
                alternateKey: current.alternate?.key ?? null,
                typeName: reader.typeName(current),
                stateNodeName: stateNode instanceof Element ? stateNode.tagName.toLowerCase() : '',
                stateVirtualSlot: stateNode instanceof Element ? (stateNode.getAttribute('data-virtual-slot') || '') : '',
                memoizedProps: diagnosticPrimitiveProps(current.memoizedProps),
                pendingProps: diagnosticPrimitiveProps(current.pendingProps)
            });
            current = current.return;
            depth++;
        }
        return chain;
    }

    function diagnosticReactNode(node, label) {
        if (!(node instanceof Element)) return { label, available: false };
        const ownKeys = Object.getOwnPropertyNames(node);
        return {
            label,
            available: true,
            tagName: node.tagName.toLowerCase(),
            virtualSlot: node.getAttribute('data-virtual-slot') || '',
            reactKeys: ownKeys.filter(key => key.startsWith('__react')).slice(0, 20),
            fiberChain: diagnosticFiberChain(node)
        };
    }

    const reader = Object.freeze({
        describeNode: diagnosticReactNode,
        fiberForNode(node) {
            if (!node) return null;
            for (const key of Object.getOwnPropertyNames(node)) {
                if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
                const fiber = node[key];
                if (fiber && typeof fiber === 'object') return fiber;
            }
            return null;
        },

        typeName(fiber) {
            const type = fiber?.elementType || fiber?.type;
            if (typeof type === 'string') return type;
            if (typeof type === 'function') return type.displayName || type.name || '(anonymous)';
            if (type && typeof type === 'object') {
                return String(type.displayName || type.name || type.$$typeof || '(object)');
            }
            return type == null ? '' : String(type);
        },

        readFiberProp(roots, property, isValid) {
            for (const root of roots) {
                let fiber = this.fiberForNode(root);
                const visited = new Set();
                let depth = 0;
                while (fiber && typeof fiber === 'object' && depth < 16 && !visited.has(fiber)) {
                    visited.add(fiber);
                    const sources = [
                        ['memoizedProps', fiber.memoizedProps],
                        ['pendingProps', fiber.pendingProps],
                        ['alternate.memoizedProps', fiber.alternate?.memoizedProps],
                        ['alternate.pendingProps', fiber.alternate?.pendingProps]
                    ];
                    for (const [source, props] of sources) {
                        const value = props?.[property];
                        if (isValid(value)) {
                            return {
                                value,
                                depth,
                                source,
                                fiberKey: fiber.key ?? null,
                                typeName: this.typeName(fiber)
                            };
                        }
                    }
                    fiber = fiber.return;
                    depth++;
                }
            }
            return { value: null, depth: null, source: null, fiberKey: null, typeName: '' };
        },

        readItemIndex(slot) {
            const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard) || null;
            return this.readFiberProp(
                [slot?.firstElementChild || null, card?.parentElement || null, card],
                'itemIndex',
                Number.isSafeInteger
            );
        },

        readCarouselTotalCount(slot) {
            const card = slot?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard) || null;
            const reading = this.readFiberProp(
                [slot, slot?.firstElementChild || null, card?.parentElement || null, card],
                'totalCount',
                value => Number.isSafeInteger(value) && value >= 0
            );
            return reading.value;
        }
    });
    return reader;
}

export function readCardSignature(slots, cardSelector) {
    return slots.map(slot => {
        const card = slot.querySelector(cardSelector);
        return card?.href || card?.getAttribute('href') || '';
    }).filter(Boolean).join('|');
}
