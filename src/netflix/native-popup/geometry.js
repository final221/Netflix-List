import { pairDomTrees } from './dom-pairs.js';

// Opaque leases keep method registries private and make old restoration exact.
export function createGeometry({ Element, warn, tLog, onAlignmentRestore, diagnosticFailure }) {
    const geometryMethods = new WeakMap(), leases = new WeakMap();
    let activeGeometryProxy = null, alignmentRestores = 0, alignmentRestoreFailures = 0;
    function restoreGeometryProxy(lease) {
        const proxy = leases.get(lease);
        if (activeGeometryProxy === proxy) activeGeometryProxy = null;
        if (!proxy) return;
        leases.delete(lease);
        let failures = 0;

        for (const entry of proxy.entries) {
            for (const method of ['getBoundingClientRect', 'getClientRects']) {
                const descriptor = entry.descriptors[method];
                const methods = geometryMethods.get(entry.source);
                if (entry.installed && methods?.[method]?.lease !== entry) continue;
                if (entry.installed && Object.getOwnPropertyDescriptor(entry.source, method)?.value !== entry.installed[method]) { delete methods[method]; continue; }
                try {
                    if (descriptor) {
                        Object.defineProperty(entry.source, method, descriptor);
                    } else {
                        if (!delete entry.source[method]) failures++;
                    }
                } catch (_) { failures++; }
                if (entry.installed) delete methods[method];
            }
        }

        if (activeGeometryProxy?.sourceSlot !== proxy.sourceSlot) proxy.sourceSlot.removeAttribute('data-tm-source-proxied');
        alignmentRestores++; alignmentRestoreFailures += failures;
        try { onAlignmentRestore(failures); } catch (_) { diagnosticFailure(); }
        if (failures) {
            warn(tLog('sourceAlignmentRestoreFailed'), { methods: failures, nodes: proxy.entries.length });
        }
    }

    function makeClientRectList(rect) {
        const list = [rect];
        list.item = index => list[index] || null;
        return list;
    }

    function install(sourceSlot, clone) {
        const { pairs } = pairDomTrees(sourceSlot, clone, Element);
        const entries = [];
        for (const [source, target] of pairs) {
            if (!(source instanceof Element) || !(target instanceof Element)) continue;

            const methods = geometryMethods.get(source) || {}; geometryMethods.set(source, methods);
            const descriptors = Object.fromEntries(['getBoundingClientRect', 'getClientRects'].map(method => [method, methods[method] ? methods[method].baseline : (Object.getOwnPropertyDescriptor(source, method) || null)]));
            const installed = { getBoundingClientRect: () => target.getBoundingClientRect(), getClientRects: () => makeClientRectList(target.getBoundingClientRect()) };
            const entry = { source, descriptors, installed };

            try {
                Object.defineProperty(source, 'getBoundingClientRect', {
                    configurable: true,
                    value: installed.getBoundingClientRect
                });
                Object.defineProperty(source, 'getClientRects', {
                    configurable: true,
                    value: installed.getClientRects
                });
                entries.push(entry);
                for (const method of ['getBoundingClientRect', 'getClientRects']) methods[method] = { lease: entry, baseline: descriptors[method] };
            } catch (_) {
                for (const method of ['getBoundingClientRect', 'getClientRects']) {
                    try {
                        if (descriptors[method]) Object.defineProperty(source, method, descriptors[method]);
                        else delete source[method];
                    } catch (_) {}
                }
            }
        }

        if (!entries.length) return false;

        sourceSlot.setAttribute('data-tm-source-proxied', 'true');
        activeGeometryProxy = { sourceSlot, clone, entries };
        const lease = Object.freeze({});
        leases.set(lease, activeGeometryProxy); activeGeometryProxy.lease = lease;
        return true;
    }
    return Object.freeze({ install, release: restoreGeometryProxy,
        detach() { const lease = activeGeometryProxy?.lease; activeGeometryProxy = null; return lease; },
        ownsClone: clone => activeGeometryProxy?.clone === clone,
        detached: () => Boolean(activeGeometryProxy && (!activeGeometryProxy.sourceSlot.isConnected || !activeGeometryProxy.clone.isConnected)),
        diagnostics: () => ({ geometryOwned: Boolean(activeGeometryProxy), alignmentRestores, alignmentRestoreFailures }) });
}
