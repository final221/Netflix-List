// Owns native graft, geometry, replay and preview lifetimes. Importing does no work.
export function createNativePopup(options = {}) {
    const { Element, document, PointerEvent, MouseEvent } = options;
    const Node = options.Node || Element;
    const performance = options.performance || { now: () => 0 };
    const { requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout } = options;
    const readIntent = options.readIntent || (() => ({}));
    const readEnvironment = options.readEnvironment || (() => ({}));
    const performanceDiagnostics = new Proxy({}, { get: (_, key) => options.readDiagnostics?.()[key] });
    const HOVER_PREVIEW_DIAGNOSTIC_LIMITS = Object.freeze({ delayMs: 900, routeReplays: 48, roots: 6 });
    const NETFLIX_DOM_SELECTORS = options.selectors;
    const { videoIdFromHref, decodeTrackingContext } = options.pageDom || {};
    const diagnosticFailure = () => { const sink = options.readDiagnostics?.().hoverInteraction; if (sink) sink.diagnosticFailures++; };
    const log = (...args) => options.log?.(...args);
    const warn = (...args) => { try { options.warn?.(...args); } catch (_) { diagnosticFailure(); } };
    const trace = callback => options.trace?.(callback), tLog = key => options.tLog?.(key) || key;
    const gridOwnsClone = (...args) => options.gridOwnsClone?.(...args);
    const gridCloneFromPointerEvent = (...args) => options.gridCloneFromPointerEvent?.(...args);
    const hoverPreparationCancelled = token => options.isCancelled?.(token);
    const isRouteSessionActive = token => options.isSessionCurrent?.(token);
    const recordHoverTiming = (...args) => { try { options.recordTiming?.(...args); } catch (_) { diagnosticFailure(); } };
    const startHoverFrameDiagnostics = phase => { try { options.onReplay?.(phase); } catch (_) { diagnosticFailure(); } };
    const hoverReplayGuardDiagnostic = (...args) => options.rejectionDiagnostic?.(...args);
    const gridHoverTargetActive = (...args) => options.isTargetCurrent?.(...args);
    const releaseFailedGridHover = (...args) => options.onFailed?.(...args);
    const findItemForSourceSlot = slot => options.itemForSource?.(slot);
    const findActiveSourceSlot = item => options.activeSource?.(item);
    const withNativeReadScope = callback => options.carousel ? options.carousel.sample(callback) : callback();
    const invalidateNativeReadScope = () => options.carousel?.invalidateReads?.();
    const slotDescriptor = slot => { try { return options.describeSource?.(slot); } catch (_) { diagnosticFailure(); return null; } };
    const itemSummary = item => options.describeItem?.(item) || item;
    const initializationError = (...args) => options.createError?.(...args) || new Error(args[2]);
    const popupInspection = { capturePreview: (...args) => options.capturePreview?.(...args) };
    let activeSourceSlot = null, activeGeometryProxy = null, activeNativeHover = null;
    const graftedGridClones = new Set();
    const graftValues = new WeakMap();
    const geometryMethods = new WeakMap();
    let replayAdmission = null, replaySourceCurrent = null, replayGridCard = null;
    let interactionRevision = 0;
    let cleanupFailures = 0;
    let alignmentRestores = 0, alignmentRestoreFailures = 0;
    const pendingFrames = new Map();
    const graftHandles = new WeakMap();
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
            const { domMap, pairs } = pairDomTrees(sourceRoot, cloneRoot);
            const fiberMap = new Map();
            let fiberAssignments = 0;
            let propsAssignments = 0;

            function reactKeysForNode(node) {
                const keys = Object.getOwnPropertyNames(node);
                return {
                    fiberKeys: keys.filter(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')),
                    propsKeys: keys.filter(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')),
                    otherKeys: keys.filter(k =>
                        k.startsWith('__react') &&
                        !k.startsWith('__reactFiber$') &&
                        !k.startsWith('__reactInternalInstance$') &&
                        !k.startsWith('__reactProps$') &&
                        !k.startsWith('__reactEventHandlers$')
                    )
                };
            }

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

            for (const [source, clone] of pairs) {
                const { fiberKeys, propsKeys, otherKeys } = reactKeysForNode(source);

                for (const key of fiberKeys) {
                    try {
                        clone[key] = cloneFiberChain(source[key]);
                        fiberAssignments++;
                    } catch (error) {
                        warn(tLog('fiberGraftFailed'), key, error);
                    }
                }

                for (const key of propsKeys) {
                    try {
                        clone[key] = source[key];
                        propsAssignments++;
                    } catch (error) {
                        warn(tLog('propsGraftFailed'), key, error);
                    }
                }

                for (const key of otherKeys) {
                    if (key.startsWith('__reactContainer$')) continue;
                    try { clone[key] = source[key]; } catch (_) {}
                }
            }

            cloneRoot.setAttribute('data-tm-react-grafted', 'true');
            graftedGridClones.add(cloneRoot);
            graftValues.set(cloneRoot, pairs.map(([, node]) => ({ node, keys: Object.getOwnPropertyNames(node).filter(key => key.startsWith('__react') && !key.startsWith('__reactContainer$')).map(key => [key, node[key]]) })));
            return { fiberAssignments, propsAssignments, clonedFibers: fiberMap.size };
        }
    });

    function pairDomTrees(sourceRoot, cloneRoot) {
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

    // Contains the private React-key graft used only to make cloned cards hoverable.

    function releaseGridReact(clone) {
        if (!clone || !graftedGridClones.delete(clone)) return;
        const entries = graftValues.get(clone); graftValues.delete(clone); graftHandles.delete(clone);
        if (entries) { for (const { node, keys } of entries) for (const [key, value] of keys) {
            try { if (!graftValues.has(clone) && node[key] === value) delete node[key]; } catch (_) {}
        } } else netflixReactHover.clearClone(clone);
        for (const attribute of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted']) {
            try { if (!graftValues.has(clone)) clone.removeAttribute(attribute); } catch (_) { cleanupFailures++; }
        }
    }

    function invalidateGridReact(except = null) {
        for (const clone of graftedGridClones) {
            if (clone !== except || !clone.isConnected) releaseGridReact(clone);
        }
    }

    function restoreGeometryProxy(proxy = activeGeometryProxy) {
        if (activeGeometryProxy === proxy) activeGeometryProxy = null;
        if (!proxy) return;
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
        try { options.onAlignmentRestore?.(failures); } catch (_) { diagnosticFailure(); }
        if (failures) {
            warn(tLog('sourceAlignmentRestoreFailed'), { methods: failures, nodes: proxy.entries.length });
        }
    }

    function clearSourceAlignment(slot = activeSourceSlot, reason = 'source-release', relatedTarget = null) {
        const proxy = activeGeometryProxy; activeGeometryProxy = null;
        activeSourceSlot = null;
        try { releaseNativeHover(reason, relatedTarget); } catch (_) { cleanupFailures++; }
        try { invalidateNativeReadScope(); } catch (_) { cleanupFailures++; }
        try { restoreGeometryProxy(proxy); } catch (_) { cleanupFailures++; }
        if (slot?.hasAttribute?.('data-tm-source-aligned')) {
            // Clean up transforms left by legacy 2.1 when updating the script without a full page reload.
            slot.style.removeProperty('transform');
            slot.style.removeProperty('transform-origin');
            slot.style.removeProperty('z-index');
            slot.removeAttribute('data-tm-source-aligned');
        }
        // A reentrant open owns its own source and geometry.
    }

    function makeClientRectList(rect) {
        const list = [rect];
        list.item = index => list[index] || null;
        return list;
    }

    function releaseNativeHover(reason = 'source-release', relatedTarget = null) {
        const owner = activeNativeHover;
        if (!owner) return;
        // Clear ownership first: native exit handlers can synchronously cause another cleanup.
        activeNativeHover = null;
        finishNativePreviewDiagnostic(owner, { result: 'released-before-check', reason });
        clearNativePreviewTransfer(owner, reason);
        const { counters, timing, card, coordinates } = owner;
        const started = performance.now();
        counters.lastExitReason = reason;
        try {
            if (!nativeHoverSourceMatches(owner)) {
                counters.exitSkipped++;
                return;
            }
            // React derives leave events from bubbling out events. Send them while
            // the source still has grid geometry, before removing its coordinate proxy.
            const common = { ...coordinates, relatedTarget };
            let dispatched = false;
            if (typeof PointerEvent === 'function') {
                try {
                    card.dispatchEvent(new PointerEvent('pointerout', { ...common,
                        pointerId: 1, pointerType: 'mouse', isPrimary: true }));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            }
            if (nativeHoverSourceMatches(owner) && activeNativeHover === null) {
                try {
                    card.dispatchEvent(new MouseEvent('mouseout', common));
                    dispatched = true;
                } catch (_) { counters.exitFailed++; }
            } else counters.exitSkipped++;
            if (dispatched) {
                counters.exitsDispatched++;
                if (reason === 'scroll') counters.scrollExits++;
            }
        } catch (_) { counters.exitFailed++; }
        finally { recordHoverTiming(timing, 'exit', started); }
    }

    function nativeHoverSourceMatches(owner) {
        return owner.card.isConnected && owner.sourceSlot.isConnected && Boolean(owner.videoId) &&
            owner.sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) === owner.card &&
            videoIdFromHref(owner.card.href || owner.card.getAttribute('href') || '') === owner.videoId && (!owner.sourceCurrent || owner.sourceCurrent());
    }

    function finishNativePreviewDiagnostic(owner, details) {
        const observation = owner?.previewDiagnostic;
        if (!observation || observation.done) return;
        observation.done = true;
        // Clear retained DOM and timer ownership before logging or native exit.
        const timer = observation.timer;
        observation.timer = null;
        observation.clone = null;
        try {
            if (timer !== null) clearTimeout(timer);
            const counters = observation.counters;
            if (performanceDiagnostics.hoverPreview !== counters) return;
            counters.completed++;
            counters.lastResult = details.result;
            const field = { 'matching-preview-transfer': 'matchedTransfers', 'matching-preview-at-pointer': 'matchedAtPointer',
                'matching-preview-elsewhere': 'matchedElsewhere', 'no-preview-root-found': 'noPreviewRoot',
                'preview-roots-unverified': 'unverifiedRoots', 'released-before-check': 'earlyRelease',
                'owner-invalid': 'invalidOwner', hidden: 'hidden', 'probe-failed': 'failed' }[details.result];
            if (field) counters[field]++;
            log(tLog('hoverPreviewPresence'), { seq: observation.seq, token: owner.token,
                sinceReplayMs: Math.round(performance.now() - owner.replayedAt), ...details });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }

    function inspectNativePreviewDiagnostic(owner) {
        const observation = owner?.previewDiagnostic;
        if (!observation || observation.done) return;
        const clone = observation.clone;
        const counters = observation.counters;
        let checkStarted = null;
        try {
            if (performanceDiagnostics.hoverPreview !== counters || activeNativeHover !== owner ||
                owner.token !== readIntent().token || (owner.admission && !owner.admission()) || !isRouteSessionActive(owner.sessionToken) || readIntent().clone !== clone ||
                readIntent().videoId !== owner.videoId || !gridOwnsClone(clone, readEnvironment()?.grid) || !nativeHoverSourceMatches(owner)) {
                finishNativePreviewDiagnostic(owner, { result: 'owner-invalid' });
                return;
            }
            if (document.visibilityState === 'hidden') {
                finishNativePreviewDiagnostic(owner, { result: 'hidden' });
                return;
            }
            counters.checks++;
            checkStarted = performance.now();
            const physicalKnown = Number.isFinite(readIntent().pointerX) && Number.isFinite(readIntent().pointerY) &&
                readIntent().pointerX !== -1 && readIntent().pointerY !== -1;
            const x = physicalKnown ? readIntent().pointerX : owner.coordinates.clientX;
            const y = physicalKnown ? readIntent().pointerY : owner.coordinates.clientY;
            let hit = null;
            let pointerTarget = 'unavailable';
            if (Number.isFinite(x) && Number.isFinite(y) && typeof document.elementFromPoint === 'function') {
                counters.pointerChecks++;
                hit = document.elementFromPoint(x, y);
                if (gridCloneFromPointerEvent({ target: hit }, readEnvironment().grid) === clone) pointerTarget = 'same-card';
                else if (gridCloneFromPointerEvent({ target: hit }, readEnvironment().grid, true) === clone) pointerTarget = 'viewing-control';
                else if (hit && !readEnvironment().grid.contains(hit) && !readEnvironment().scroller?.contains(hit) &&
                    findNativeHoverPreview(hit, owner.videoId).root) pointerTarget = 'matching-preview';
                else pointerTarget = hit ? 'elsewhere' : 'no-hit';
            }
            const details = { pointerTarget, physicalKnown, targetHovered: clone.matches(':hover'), rootsExamined: 0, truncated: false };
            if (pointerTarget === 'matching-preview') {
                finishNativePreviewDiagnostic(owner, { result: 'matching-preview-at-pointer', ...details });
                return;
            }
            // Only an unconfirmed replay reaches this single bounded search.
            // A connected matching root is presence evidence, not a visibility or
            // paint measurement; it may be hidden or open elsewhere on the page.
            counters.rootSearches++;
            const roots = document.querySelectorAll('.previewModal--wrapper, .bob-container, .previewModal--container, .bob-card');
            const limit = Math.min(roots.length, HOVER_PREVIEW_DIAGNOSTIC_LIMITS.roots);
            details.truncated = roots.length > limit;
            for (let index = 0; index < limit; index++) {
                details.rootsExamined++;
                if (readEnvironment().grid.contains(roots[index]) || readEnvironment().scroller?.contains(roots[index])) continue;
                if (findNativeHoverPreview(roots[index], owner.videoId).root) {
                    finishNativePreviewDiagnostic(owner, { result: 'matching-preview-elsewhere', ...details });
                    return;
                }
            }
            finishNativePreviewDiagnostic(owner, { result: roots.length ? 'preview-roots-unverified' : 'no-preview-root-found', ...details });
        } catch (_) { finishNativePreviewDiagnostic(owner, { result: 'probe-failed' }); }
        finally {
            if (checkStarted !== null && performanceDiagnostics.hoverPreview === counters) {
                const elapsed = Math.max(0, Math.round((performance.now() - checkStarted) * 10) / 10);
                counters.checkTotalMs = Math.round((counters.checkTotalMs + elapsed) * 10) / 10;
                counters.checkMaxMs = Math.max(counters.checkMaxMs, elapsed);
            }
        }
    }

    function scheduleNativePreviewDiagnostic(owner, clone) {
        if (!owner || activeNativeHover !== owner || owner.previewDiagnostic || (owner.admission && !owner.admission())) return;
        const counters = performanceDiagnostics.hoverPreview;
        if (counters.scheduled >= HOVER_PREVIEW_DIAGNOSTIC_LIMITS.routeReplays) {
            counters.skippedAtLimit++;
            return;
        }
        owner.previewDiagnostic = { counters, clone, timer: null, done: false, seq: ++counters.scheduled };
        try {
            if (document.visibilityState === 'hidden') {
                finishNativePreviewDiagnostic(owner, { result: 'hidden' });
            } else if (owner.previewRoot) {
                finishNativePreviewDiagnostic(owner, { result: 'matching-preview-transfer' });
            } else {
                owner.previewDiagnostic.timer = setTimeout(() => inspectNativePreviewDiagnostic(owner), HOVER_PREVIEW_DIAGNOSTIC_LIMITS.delayMs);
            }
        } catch (_) { finishNativePreviewDiagnostic(owner, { result: 'probe-failed' }); }
    }

    function nativePreviewNodeVideoId(node) {
        const raw = node.getAttribute('data-ui-tracking-context') || '';
        if (raw && raw.length <= 4096) {
            const tracking = decodeTrackingContext(node);
            const direct = tracking?.video_id ?? tracking?.videoId;
            if ((typeof direct === 'string' || typeof direct === 'number') && /^\d+$/.test(String(direct))) return String(direct);
            const unified = typeof tracking?.unifiedEntityId === 'string' ? tracking.unifiedEntityId.match(/^Video:(\d+)$/i) : null;
            if (unified) return unified[1];
        }
        const href = node.href || node.getAttribute('href') || '';
        // A movie's Play link can identify its title. For series an episode ID
        // alone is insufficient; a series detail/tracking reference must match.
        return videoIdFromHref(href) || (/\/watch\/(\d+)(?:[/?#]|$)/.exec(href)?.[1] || '');
    }

    function findNativeHoverPreview(target, videoId) {
        if (!(target instanceof Element)) return { root: null, reason: 'not-preview' };
        // Prefer the outer wrapper so movement among image and controls stays inside.
        const root = target.closest('.previewModal--wrapper, .bob-container') ||
            target.closest('.previewModal--container, .bob-card');
        if (!root?.isConnected) return { root: null, reason: 'not-preview' };
        let node = target;
        for (let index = 0; node && index < 8; index++, node = node.parentElement) {
            if (nativePreviewNodeVideoId(node) === videoId) return { root, reason: 'matching-preview-title' };
            if (node === root) break;
        }
        const references = root.querySelectorAll('a[href], [data-ui-tracking-context]');
        const limit = Math.min(references.length, 16);
        for (let index = 0; index < limit; index++) {
            if (nativePreviewNodeVideoId(references[index]) === videoId) {
                return { root, reason: 'matching-preview-title' };
            }
        }
        return { root: null, reason: limit < references.length ? 'preview-identity-limit' : 'preview-identity-unverified' };
    }

    function retainNativeHoverForPreview(clone, relatedTarget, event) {
        const owner = activeNativeHover;
        if (!owner || readIntent().clone !== clone || event?.type !== 'pointerout' || !event.isTrusted ||
            owner.token !== readIntent().token || !isRouteSessionActive(owner.sessionToken) || !gridOwnsClone(clone, readEnvironment()?.grid)) return false;
        try {
            if (!nativeHoverSourceMatches(owner)) return false;
            const candidate = findNativeHoverPreview(relatedTarget, owner.videoId);
            if (!candidate.root) {
                if (candidate.reason !== 'not-preview') {
                    owner.counters.previewRejected++;
                    log(tLog('hoverPreviewTransferRejected'), { reason: candidate.reason });
                }
                return false;
            }
            if (owner.previewRoot === candidate.root) return true;
            owner.previewRoot = candidate.root;
            owner.previewClone = clone;
            owner.previewEnteredAt = performance.now();
            owner.counters.previewTransfers++;
            owner.counters.lastPreviewReason = candidate.reason;
            finishNativePreviewDiagnostic(owner, { result: 'matching-preview-transfer' });
            try { popupInspection.capturePreview(candidate.root, owner.sessionToken); }
            catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
            try {
                log(tLog('hoverPreviewTransfer'), { reason: candidate.reason,
                    sinceReplayMs: Math.round(performance.now() - owner.replayedAt) });
            } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
            return true;
        } catch (_) {
            owner.counters.previewRejected++;
            try { log(tLog('hoverPreviewTransferRejected'), { reason: 'preview-check-failed' }); } catch (_) {}
            return false;
        }
    }

    function clearNativePreviewTransfer(owner, reason) {
        if (!owner?.previewRoot) return;
        owner.previewRoot = null;
        owner.previewClone = null;
        try {
            if (reason === 'preview-return') owner.counters.previewReturns++;
            else owner.counters.previewReleases++;
            owner.counters.lastPreviewReason = reason;
            recordHoverTiming(owner.timing, 'preview', owner.previewEnteredAt);
            log(tLog('hoverPreviewReleased'), { reason, heldMs: Math.round(performance.now() - owner.previewEnteredAt) });
        } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
    }

    function releaseNativePreview(owner, reason, relatedTarget = null) {
        if (activeNativeHover !== owner || !owner?.previewRoot) return;
        const clone = owner.previewClone;
        options.onPreviewRelease?.(clone, reason, relatedTarget, () => clearSourceAlignment(undefined, reason, relatedTarget));
    }

    function nativePreviewOwnerMatches(owner) {
        try {
            return activeNativeHover === owner && readIntent().clone === owner.previewClone && readIntent().videoId === owner.videoId &&
                Boolean(owner.previewClone?.isConnected) && gridOwnsClone(owner.previewClone, readEnvironment()?.grid) &&
                isRouteSessionActive(owner.sessionToken) && owner.token === readIntent().token && nativeHoverSourceMatches(owner) && (!owner.admission || owner.admission());
        } catch (_) { return false; }
    }

    function handleTargetPreviewPointerOut(event) {
        const owner = activeNativeHover;
        const root = owner?.previewRoot;
        if (!root || !event.isTrusted || !root.contains(event.target) ||
            (event.relatedTarget && root.contains(event.relatedTarget))) return;
        const clone = owner.previewClone;
        const valid = root.isConnected && nativePreviewOwnerMatches(owner);
        if (valid && event.relatedTarget &&
            gridCloneFromPointerEvent({ target: event.relatedTarget }, readEnvironment().grid) === clone) {
            clearNativePreviewTransfer(owner, 'preview-return');
            return;
        }
        releaseNativePreview(owner, valid ? 'preview-leave' : 'preview-owner-invalid', event.relatedTarget);
    }

    function alignSourceSlotToClone(sourceSlot, clone, assertCurrent = () => {}) {
        assertCurrent();
        if (!sourceSlot?.isConnected || !clone?.isConnected) return false;

        const sourceItem = findItemForSourceSlot(sourceSlot);
        if (!sourceItem || findActiveSourceSlot(sourceItem) !== sourceSlot) return false;
        assertCurrent();
        clearSourceAlignment();
        assertCurrent();

        const { pairs } = pairDomTrees(sourceSlot, clone);
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
        activeSourceSlot = sourceSlot;
        return true;
    }

    function replayHoverOnNativeSource(sourceSlot, triggerEvent) {
        if (!sourceSlot?.isConnected) return false;
        const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard) || sourceSlot;
        const rect = card.getBoundingClientRect();
        const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        const currentPointer = readIntent().pointerX !== -1 && readIntent().pointerY !== -1 && inside(readIntent().pointerX, readIntent().pointerY);
        const originalPointer = inside(triggerEvent?.clientX, triggerEvent?.clientY);
        const x = currentPointer ? readIntent().pointerX : originalPointer ? triggerEvent.clientX : rect.left + rect.width / 2;
        const y = currentPointer ? readIntent().pointerY : originalPointer ? triggerEvent.clientY : rect.top + rect.height / 2;

        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            screenX: Number.isFinite(triggerEvent?.screenX) && Number.isFinite(triggerEvent?.clientX)
                ? triggerEvent.screenX + x - triggerEvent.clientX : x,
            screenY: Number.isFinite(triggerEvent?.screenY) && Number.isFinite(triggerEvent?.clientY)
                ? triggerEvent.screenY + y - triggerEvent.clientY : y,
            relatedTarget: null
        };

        const owner = { card, sourceSlot, coordinates: common, token: readIntent().token, sessionToken: readIntent().sessionToken,
            videoId: videoIdFromHref(card.href || card.getAttribute('href') || ''),
            counters: performanceDiagnostics.hoverLifecycle, timing: performanceDiagnostics.hoverTiming,
            replayedAt: performance.now(), admission: replayAdmission, sourceCurrent: replaySourceCurrent, gridCard: replayGridCard };
        releaseNativeHover('replaced');
        if (activeNativeHover || (owner.admission && !owner.admission())) return false;
        activeNativeHover = owner;
        const stillActive = () => activeNativeHover === owner && !hoverPreparationCancelled(owner.token) &&
            isRouteSessionActive(owner.sessionToken) && nativeHoverSourceMatches(owner) && (!owner.admission || owner.admission());
        try {
            card.dispatchEvent(new PointerEvent('pointerover', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            if (!stillActive()) return false;
            card.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mouseover', common));
        if (!stillActive()) return false;
        card.dispatchEvent(new MouseEvent('mousemove', common));
        return stillActive();
    }

    function scheduleNativeHoverReplay(sourceSlot, item, clone, triggerEvent, actualPage, reason,
        token = readIntent().token, sessionToken = readIntent().sessionToken, handles = null) {
        if (handles) clone = handles.card?.node;
        const assertHandles = () => { if (handles) { if (!handles.isCurrent()) throw new Error('Native interaction retired'); options.carousel.assertSource(handles.source); options.grid.assertCard(handles.card); } };
        const isAdmitted = () => { try { assertHandles(); return token === readIntent().token && isRouteSessionActive(sessionToken); } catch (_) { return false; } };
        const generation = clone?.__tmHoverActivationGeneration;
        const counters = performanceDiagnostics.hoverLifecycle;
        const timing = performanceDiagnostics.hoverTiming;
        return new Promise(resolve => {
            const pending = { resolve, frame: null, card: handles?.card };
            const frame = requestAnimationFrame(() => {
                if (!pendingFrames.delete(pending)) return;
                const finish = success => {
                    try { if (!success && (!handles || handles.isCurrent())) releaseFailedGridHover(clone, token); } finally { resolve(success); }
                };
                try {
                    assertHandles(); if (handles) sourceSlot = handles.source.slot;
                    if (hoverPreparationCancelled(token) || !isRouteSessionActive(sessionToken) ||
                        !gridHoverTargetActive(clone, generation, triggerEvent) ||
                        readIntent().clone !== clone || readIntent().videoId !== item.videoId) {
                        counters.replayCancelled++;
                        if (performanceDiagnostics.hoverLifecycle === counters) {
                            performanceDiagnostics.hoverInteraction.replayGuardRejected++;
                            log(tLog('hoverReplayGuardRejected'), hoverReplayGuardDiagnostic(clone, generation, token, sessionToken, item));
                        }
                        return finish(false);
                    }
                    counters.replayAttempts++;
                    if (!sourceSlot?.isConnected) { counters.replayFailed++; return finish(false); }

                    const card = sourceSlot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                    const sourceVideoId = videoIdFromHref(card?.href || card?.getAttribute?.('href') || '');
                    // Native visibility/page reads need original source geometry, not
                    // the grid rectangles installed for Netflix's popup placement.
                    clearSourceAlignment();
                    assertHandles();
                    const alignmentStarted = performance.now();
                    let failureReason;
                    try {
                        failureReason = withNativeReadScope(() => {
                            if (!sourceVideoId || sourceVideoId !== item.videoId) return 'source-video-id-mismatch';
                            if (findActiveSourceSlot(item) !== sourceSlot) return 'source-no-longer-active';
                            return alignSourceSlotToClone(sourceSlot, clone, assertHandles) ? '' : 'source-alignment-failed';
                        });
                    } finally { recordHoverTiming(timing, 'alignment', alignmentStarted); }
                    if (failureReason) {
                        counters.replayFailed++;
                        warn(tLog('nativeHoverReplayCancelled'), {
                            reason: failureReason,
                            targetVideoId: item.videoId,
                            sourceVideoId,
                            source: slotDescriptor(sourceSlot)
                        });
                        return finish(false);
                    }

                    const replayStarted = performance.now();
                    let replayed;
                    try { replayAdmission = isAdmitted; replayGridCard = handles?.card || null; replaySourceCurrent = handles ? () => handles.source.isCurrent() : null; assertHandles(); replayed = withNativeReadScope(() => replayHoverOnNativeSource(sourceSlot, triggerEvent)); }
                    finally { replayAdmission = null; replaySourceCurrent = null; replayGridCard = null; recordHoverTiming(timing, 'replay', replayStarted); }
                    if (replayed) {
                        counters.replaysDispatched++;
                        startHoverFrameDiagnostics('replay');
                        scheduleNativePreviewDiagnostic(activeNativeHover, clone);
                    } else counters.replayCancelled++;
                    if (replayed) try { trace(() => [tLog('nativeHoverReplayedFromLiveSource'), {
                        item: itemSummary(item),
                        actualPage,
                        reason,
                        triggerEvent: triggerEvent?.type || '',
                        source: slotDescriptor(sourceSlot)
                    }]); } catch (_) { performanceDiagnostics.hoverInteraction.diagnosticFailures++; }
                    finish(Boolean(replayed && isAdmitted()));
                } catch (error) {
                    counters.replayFailed++;
                    try { warn(tLog('nativeHoverReplayCancelled'), { reason: 'replay-failed', item: itemSummary(item), error }); } finally { finish(false); }
                }
            }); pending.frame = frame; pendingFrames.set(pending, pending);
        });
    }

    function makeLiveClone(sourceSlot, item, oldClone, actualPage, assertCurrent = () => {}, token = readIntent().token, sessionToken = readIntent().sessionToken) {
        // Keep the legacy 1.2.0 order: clone the live source, graft React data, then insert into the DOM.
        const expected = options.grid.getCard(item);
        if (!expected || expected.node !== oldClone) throw initializationError('GRID_CARD_RETIRED', 'grid-cards', 'Preparation card changed');
        const assertExpected = () => { assertCurrent(); options.grid.assertCard(expected); };
        assertExpected();
        const fresh = sourceSlot.cloneNode(true);
        try {
            assertExpected();
            const stats = netflixReactHover.graftTreeToClone(sourceSlot, fresh);
            assertExpected();
            options.grid.normalizeCard(fresh);
            assertExpected();

            fresh.setAttribute('data-tm-hover-ready', String(Boolean(stats?.fiberAssignments || stats?.propsAssignments)));
            fresh.setAttribute('data-tm-backed-page', String(actualPage));
            fresh.__tmHoverActivationGeneration = oldClone?.__tmHoverActivationGeneration;
            if (oldClone?.getAttribute('data-tm-preparing') === 'true' &&
                oldClone.getAttribute('data-tm-hover-token') === String(readIntent().token)) {
                fresh.setAttribute('data-tm-preparing', 'true');
                fresh.setAttribute('data-tm-hover-token', String(readIntent().token));
                fresh.__tmHoverReplacementToken = readIntent().token;
            }
            assertExpected();
            options.ensureGridHoverBehavior?.();
            assertExpected();
            options.associateGridHoverItem?.(item, fresh);
            assertExpected();
            let handle;
            try { handle = options.grid.replaceCard(expected, { node: fresh, assertCurrent, attempt: { token, sessionToken } }); }
            catch (error) { releaseGridReact(fresh); throw error; }
            graftHandles.set(handle.node, handle);
            return { fresh: handle.node, stats: Object.freeze({ ...stats }), handle };
        } catch (error) { releaseGridReact(fresh); throw error; }
    }

    // Public capability: complete operations and passive ownership facts.
    return Object.freeze({
        probeLimits: HOVER_PREVIEW_DIAGNOSTIC_LIMITS,
        prepare({ source, card, item, page, assertCurrent = () => {}, token, sessionToken }) {
            const check = () => { assertCurrent(); if (token != null && hoverPreparationCancelled(token)) throw new Error('Native preparation retired'); options.carousel.assertSource(source); };
            check(); options.grid.assertCard(card);
            return makeLiveClone(source.slot, item, card.node, page, check, token, sessionToken);
        },
        open({ source, card, item, event, page, reason, token = readIntent().token, sessionToken = readIntent().sessionToken }) {
            const revision = ++interactionRevision;
            return scheduleNativeHoverReplay(null, item, null, event, page, reason, token, sessionToken, { source, card, isCurrent: () => revision === interactionRevision });
        },
        release(reason = 'source-release', relatedTarget = null, slot) {
            interactionRevision++;
            const pending = [...pendingFrames.values()]; pendingFrames.clear();
            for (const entry of pending) { try { cancelAnimationFrame(entry.frame); } catch (_) { cleanupFailures++; } entry.resolve(false); }
            clearSourceAlignment(slot, reason, relatedTarget);
        },
        retire(handle) {
            if (graftHandles.has(handle.node) && graftHandles.get(handle.node) !== handle) return;
            for (const [key, entry] of pendingFrames) if (entry.card === handle) {
                pendingFrames.delete(key); try { cancelAnimationFrame(entry.frame); } catch (_) { cleanupFailures++; } entry.resolve(false);
            }
            if (activeNativeHover?.gridCard === handle || (graftHandles.get(handle.node) === handle && activeGeometryProxy?.clone === handle.node)) clearSourceAlignment(undefined, 'card-retired');
            graftHandles.delete(handle.node); releaseGridReact(handle.node);
        },
        invalidate: invalidateGridReact,
        retainPreview: retainNativeHoverForPreview,
        previewPointerOut: handleTargetPreviewPointerOut,
        finishProbe(details) { finishNativePreviewDiagnostic(activeNativeHover, details); },
        checkDetached() {
            if (activeNativeHover?.previewRoot && !activeNativeHover.previewRoot.isConnected) releaseNativePreview(activeNativeHover, 'preview-removed');
            if (activeGeometryProxy && (!activeGeometryProxy.sourceSlot.isConnected || !activeGeometryProxy.clone.isConnected)) clearSourceAlignment();
        },
        pointerMoved(event) {
            const owner = activeNativeHover; if (!owner?.previewRoot) return false;
            const grid = readEnvironment().grid;
            if (!owner.previewRoot.isConnected || !gridOwnsClone(owner.previewClone, grid)) releaseNativePreview(owner, 'preview-removed');
            else if (owner.previewRoot.contains(event.target)) return true;
            else if (gridCloneFromPointerEvent(event, grid) === owner.previewClone && nativePreviewOwnerMatches(owner)) clearNativePreviewTransfer(owner, 'preview-return');
            else releaseNativePreview(owner, 'preview-leave', event.target);
            return false;
        },
        diagnostics: () => Object.freeze({ grafts: graftedGridClones.size, geometryOwned: Boolean(activeGeometryProxy),
            sourceConnected: Boolean(activeSourceSlot?.isConnected), replayOwned: Boolean(activeNativeHover), previewOwned: Boolean(activeNativeHover?.previewRoot), pendingReplays: pendingFrames.size, cleanupFailures, alignmentRestores, alignmentRestoreFailures }),
        describeActiveSource() { try { return slotDescriptor(activeSourceSlot); } catch (_) { return null; } },
        replayFacts(clone) { const owner = activeNativeHover; return owner && readIntent().clone === clone
            ? Object.freeze({ sessionToken: owner.sessionToken, replayedAt: owner.replayedAt, coordinates: Object.freeze({...owner.coordinates}) }) : null; }
    });
}
