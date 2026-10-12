// Private filtered mutation discovery and exact observer/frame lifetime.
// Session callbacks supply route/recovery policy; native binding authority stays in carousel.
export function createDiscovery({ document, scope, MutationObserver, requestAnimationFrame, cancelAnimationFrame,
    findSection: findMyListSection, browseSectionsSelector, uiIds,
    checkRoute, onMutationDelivery, isInitializationBlocked, onBlockedMutation,
    isGridDetached, shouldCoalesce, onRelevantMutation }) {
    const { grid: GRID_ID, status: STATUS_ID, empty: LEGACY_EMPTY_STATE_ID, dialog: ORDER_MISMATCH_DIALOG_ID } = uiIds;
    let discoveryOwner = null, targetDocumentObserver = null, targetMutationFrame = null;
    let targetObservedBrowseHost = null, targetObservedMyListSection = null, targetObservedAncestors = [];
    let targetDocumentDiscoveryActive = false;

    function targetDocumentObserverAncestors(host) {
        const ancestors = [];
        for (let node = host?.parentElement; node; node = node.parentElement) {
            ancestors.push(node);
        }
        return ancestors;
    }

    function bindTargetDocumentObserver(host, section) {
        if (!targetDocumentObserver) return false;

        const ancestors = host ? targetDocumentObserverAncestors(host) : [];
        const sameAncestors = ancestors.length === targetObservedAncestors.length &&
            ancestors.every((ancestor, index) => ancestor === targetObservedAncestors[index]);
        const isAlreadyWatchingDiscovery = !host && targetDocumentDiscoveryActive && !targetObservedBrowseHost;
        if (isAlreadyWatchingDiscovery) return false;

        if (host === targetObservedBrowseHost &&
            section === targetObservedMyListSection &&
            sameAncestors &&
            !targetDocumentDiscoveryActive) {
            return false;
        }

        targetDocumentObserver.disconnect();
        targetObservedBrowseHost = null;
        targetObservedMyListSection = null;
        targetObservedAncestors = [];
        targetDocumentDiscoveryActive = false;

        if (!host) {
            if (document.documentElement) {
                // Watch broadly only until Netflix mounts the browse sections host.
                targetDocumentObserver.observe(document.documentElement, { childList: true, subtree: true });
                targetDocumentDiscoveryActive = true;
            }
            return true;
        }

        // The host's direct children identify/reorder carousel rows. Observe the
        // selected My List row deeply, plus only direct child changes along the
        // host's ancestor path so replacement of the host is still detected.
        targetDocumentObserver.observe(host, { childList: true, subtree: !section });
        if (section?.isConnected) {
            targetDocumentObserver.observe(section, { childList: true, subtree: true });
        }
        for (const ancestor of ancestors) {
            targetDocumentObserver.observe(ancestor, { childList: true });
        }

        targetObservedBrowseHost = host;
        targetObservedMyListSection = section?.isConnected ? section : null;
        targetObservedAncestors = ancestors;
        return true;
    }

    function isScriptOwnedMyListNode(node) {
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        return Boolean(element?.closest?.(`#${GRID_ID}, #${STATUS_ID}, #${LEGACY_EMPTY_STATE_ID}, #${ORDER_MISMATCH_DIALOG_ID}`));
    }

    function mutationOnlyChangesScriptUi(mutation) {
        if (isScriptOwnedMyListNode(mutation.target)) return true;
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length > 0 && changedNodes.every(isScriptOwnedMyListNode);
    }

    function mutationChangesObservedAncestorPath(mutation) {
        const ancestorIndex = targetObservedAncestors.indexOf(mutation.target);
        if (ancestorIndex < 0) return false;

        const branch = ancestorIndex === 0
            ? targetObservedBrowseHost
            : targetObservedAncestors[ancestorIndex - 1];
        if (!branch) return false;

        return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
            node === branch || (node.nodeType === 1 && node.contains(branch))
        );
    }

    function handleTargetDocumentMutation(mutations = []) {
        const owner = discoveryOwner;
        checkRoute();
        if (!owner || owner !== discoveryOwner || !scope.isCurrent(owner.sessionToken) || !targetDocumentObserver) return;
        onMutationDelivery();
        if (isInitializationBlocked()) {
            if (mutations.some(mutation => !mutationOnlyChangesScriptUi(mutation))) {
                onBlockedMutation(owner.sessionToken);
            }
            return;
        }
        // External removal of our whole grid still needs recovery, even though
        // mutations wholly inside the connected script UI are otherwise ignored.
        if (isGridDetached()) {
            handleRelevantTargetDocumentMutation();
        }
        mutations = mutations.filter(mutation => !mutationOnlyChangesScriptUi(mutation));
        if (!mutations.length) return;

        let relevantMutation = false;
        if (targetDocumentDiscoveryActive) {
            // This is the only phase that watches the full document. Switch to
            // the browse host once it appears, then narrow to My List when found.
            const host = document.querySelector?.(browseSectionsSelector);
            if (!host) return;
            const section = findMyListSection();
            relevantMutation = bindTargetDocumentObserver(host, section);
        } else {
            const ancestorChanged = mutations.some(mutationChangesObservedAncestorPath);
            const hostChanged = mutations.some(mutation => mutation.target === targetObservedBrowseHost);
            const hostDiscoveryChanged = Boolean(targetObservedBrowseHost && !targetObservedMyListSection) &&
                mutations.some(mutation => targetObservedBrowseHost.contains(mutation.target));
            const sectionChanged = mutations.some(mutation =>
                targetObservedMyListSection && targetObservedMyListSection.contains(mutation.target)
            );

            if (ancestorChanged || hostChanged) {
                const host = document.querySelector?.(browseSectionsSelector);
                const section = host ? findMyListSection() : null;
                const bindingChanged = bindTargetDocumentObserver(host, section);
                relevantMutation = bindingChanged || hostChanged || sectionChanged;
            } else if (hostDiscoveryChanged) {
                const host = document.querySelector?.(browseSectionsSelector);
                const section = host ? findMyListSection() : null;
                relevantMutation = bindTargetDocumentObserver(host, section) || hostDiscoveryChanged;
            } else {
                relevantMutation = sectionChanged;
            }
        }

        if (relevantMutation) handleRelevantTargetDocumentMutation();
    }
    function handleRelevantTargetDocumentMutation() {
        const owner = discoveryOwner;
        if (!owner || !scope.isCurrent(owner.sessionToken)) return;
        if (!shouldCoalesce()) { onRelevantMutation(owner.sessionToken); return; }
        if (targetMutationFrame !== null) return;
        const frame = { id: null, owner };
        targetMutationFrame = frame;
        frame.id = requestAnimationFrame(() => {
            if (targetMutationFrame !== frame) return;
            targetMutationFrame = null;
            if (discoveryOwner !== owner || !scope.isCurrent(owner.sessionToken)) return;
            onRelevantMutation(owner.sessionToken);
        });
    }
    function stopDiscovery() {
        if (targetMutationFrame !== null) cancelAnimationFrame(targetMutationFrame.id);
        targetMutationFrame = null; discoveryOwner = null;
        targetDocumentObserver?.disconnect(); targetDocumentObserver = null;
        targetObservedBrowseHost = null; targetObservedMyListSection = null;
        targetObservedAncestors = []; targetDocumentDiscoveryActive = false;
    }
    function startDiscovery() {
        if (targetDocumentObserver) return false;
        const owner = { sessionToken: scope.token };
        discoveryOwner = owner;
        targetDocumentObserver = new MutationObserver(mutations => {
            if (discoveryOwner === owner) handleTargetDocumentMutation(mutations);
        });
        refreshDiscovery();
        return true;
    }
    function refreshDiscovery() {
        const host = document.querySelector?.(browseSectionsSelector);
        return bindTargetDocumentObserver(host, host ? findMyListSection() : null);
    }

    return Object.freeze({ start: startDiscovery, stop: stopDiscovery, refresh: refreshDiscovery,
        diagnostics: () => ({ discoveryActive: Boolean(targetDocumentObserver),
            pendingMutationFrame: targetMutationFrame !== null }) });
}
