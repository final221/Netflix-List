// Registered card identities and bounded source searches share one owner.
export function createSourceResolution({ scope, performance, setTimeout, clearTimeout, initializationError,
    netflixDom, NETFLIX_DOM_SELECTORS, borrowBinding, assertBinding, isBindingCurrent, assertRouteSession,
    captureCardAuthority, captureResolutionAuthority, readRuntime, registerLogicalPageSignature,
    navigation, isHoverCancelled, readHoverToken, log, warn, trace, tLog, slotDescriptor,
    withNativeReadScope, currentPageSlots, nativeFilledSlots, nativeIndicatorItems, netflixItemIndexFromSlot,
    selectedPage, pageCount, detectCarouselDomProfile, visibleSignature, viewportPageSlots, currentPageVideoIds }) {
    const sourceTickets = new WeakMap(), mountedWaits = new Set();
    async function anchorPageZero({ section, scroller, track, firstVideoId, columns, sessionToken = null }) {
        const owner = borrowBinding(section, scroller, track);
        const assertSource = () => { assertRouteSession(sessionToken); assertBinding(owner); };
        assertSource();
        const expectedFirstVideoId = String(firstVideoId || '');
        if (!expectedFirstVideoId) return true;

        const runtime = readRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile?.pageMode !== 'indicator') return true;

        if (selectedPage(section) !== 0) {
            const returned = await navigation.navigate(section, scroller, 0, null, sessionToken, false);
            assertSource();
            if (returned !== 0 || selectedPage(section) !== 0) {
                throw initializationError(
                    'NATIVE_PAGE_ZERO_NOT_REACHED',
                    'normalize-native-page-zero',
                    'Could not return the native My List carousel to page 0 before reinitialization',
                    { returnedPage: returned, selectedPage: selectedPage(section), expectedFirstVideoId }
                );
            }
        }

        let visibleIds = currentPageVideoIds(scroller, track);
        if (visibleIds[0] === expectedFirstVideoId) {
            log('Fresh Netflix My List page-0 anchor confirmed', {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pageMode: profile.pageMode
            });
            assertSource();
            return true;
        }

        log('Fresh Netflix My List page-0 anchor mismatch; refreshing native page 0', {
            expectedFirstVideoId,
            visibleIds,
            selectedPage: selectedPage(section),
            pages: pageCount(section),
            pageMode: profile.pageMode
        });
        assertSource();

        // A remove/add at index 0 can leave Netflix's legacy/indicator carousel with
        // page 0 selected while the mounted six-card window is shifted by one item.
        // Do one normal adjacent-page round trip before source-scan mode is enabled so
        // React can repopulate the canonical page-0 window. Do not use FAST_MOVE here.
        if (pageCount(section) > 1) {
            const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
            const adjacent = await navigation.move(section, scroller, 1, null, sessionToken);
            assertSource();
            if (adjacent !== 0) {
                await navigation.stable(scroller, track, {
                    previousSignature: beforeSignature,
                    minimumSlots: Math.max(1, columns || currentPageSlots(scroller, track).length || 1),
                    timeout: 900,
                    sessionToken
                });
                assertSource();
                await navigation.move(section, scroller, -1, null, sessionToken);
                assertSource();
            }
        }

        const requiredKey = `v:${expectedFirstVideoId}`;
        await navigation.stable(scroller, track, {
            minimumSlots: Math.max(1, columns || currentPageSlots(scroller, track).length || 1),
            requiredKeys: new Set([requiredKey]),
            requiredStableFrames: 2,
            timeout: 1200,
            sessionToken
        });
        assertSource();

        visibleIds = currentPageVideoIds(scroller, track);
        if (selectedPage(section) === 0 && visibleIds[0] === expectedFirstVideoId) {
            log('Fresh Netflix My List page-0 anchor restored', {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pageMode: profile.pageMode
            });
            assertSource();
            return true;
        }

        throw initializationError(
            'NATIVE_PAGE_ZERO_ANCHOR_MISMATCH',
            'normalize-native-page-zero',
            'Netflix My List page 0 is selected but its first mounted card does not match the fresh My List first item',
            {
                expectedFirstVideoId,
                visibleIds,
                selectedPage: selectedPage(section),
                pages: pageCount(section),
                pageMode: profile.pageMode
            }
        );
    }

    function isSourceCurrent(source) {
        const ticket = sourceTickets.get(source);
        if (!ticket || !isBindingCurrent(ticket.binding) || ticket.slot.isConnected === false ||
            !ticket.authority.current()) return false;
        return withNativeReadScope(() => {
            if (!ticket.authority.refresh()) return false;
            const card = ticket.slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const href = card?.href || card?.getAttribute('href') || '';
            if (href !== ticket.href || netflixItemIndexFromSlot(ticket.slot) !== ticket.itemIndex ||
                !nativeFilledSlots(ticket.binding.track).includes(ticket.slot)) return false;
            if (ticket.authority.profile().pageMode === 'indicator') {
                const indicators = nativeIndicatorItems(ticket.binding.section);
                const page = Math.max(0, indicators.findIndex(node => node.getAttribute('data-indicator-selected') === 'true'));
                if (page !== ticket.page) return false;
            }
            return isBindingCurrent(ticket.binding) && ticket.authority.current();
        });
    }
    function assertSource(source) {
        if (!isSourceCurrent(source)) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-card',
            'Native source card or its page ownership changed');
    }
    function sourceHandle(binding, slot, page) {
        assertBinding(binding);
        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        const href = card?.href || card?.getAttribute('href') || '';
        const itemIndex = netflixItemIndexFromSlot(slot);
        const authority = captureCardAuthority(binding.section);
        const source = Object.freeze({ href, videoId: netflixDom.videoIdFromHref(href),
            itemIndex: Number.isSafeInteger(itemIndex) && itemIndex >= 0 ? itemIndex : null, page,
            get slot() { assertSource(source); return slot; }, isCurrent: () => isSourceCurrent(source) });
        sourceTickets.set(source, { binding, slot, href, itemIndex, page, authority });
        assertSource(source);
        return source;
    }
    function resolutionOperation({ section, scroller, track, item, mode = null, hoverToken = null, sessionToken = null }) {
        assertRouteSession(sessionToken);
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        const assertMappingOwner = captureResolutionAuthority(section);
        const target = Object.freeze({ href: String(item?.href || ''), videoId: String(item?.videoId || '') });
        const diagnosticItem = mode === 'preferred-refresh' || mode === 'search'
            ? Object.freeze({ ...target, page: item?.page, ariaLabel: String(item?.ariaLabel || '') }) : null;
        const guard = () => {
            assertRouteSession(sessionToken); assertBinding(binding);
            assertMappingOwner();
        };
        return { binding, target, diagnosticItem, hoverToken, sessionToken, guard };
    }
    function mountedOperation(options, assertOperation = () => {}) {
        assertOperation();
        const operation = resolutionOperation(options);
        const { binding, guard: assertOwner } = operation;
        const page = selectedPage(binding.section);
        const guard = () => {
            assertOperation(); assertOwner();
            const section = binding.section;
            const currentPage = selectedPage(section);
            assertOwner(); assertOperation();
            if (currentPage !== page) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-mounted-card',
                    'Native source page or mapping changed during mounted-card resolution');
            }
        };
        return { ...operation, activeOnly: options.activeOnly ?? true, page, guard };
    }
    function lookupMountedCard(operation) {
        operation.guard();
        const { binding, target, activeOnly, page } = operation;
        const candidates = activeOnly ? currentPageSlots(binding.scroller, binding.track) : nativeFilledSlots(binding.track);
        const slot = candidates.find(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            if (!card) return false;
            const href = card.href || card.getAttribute('href') || '';
            return Boolean((target.href && href === target.href) ||
                (target.videoId && netflixDom.videoIdFromHref(href) === target.videoId));
        });
        operation.guard();
        return slot ? sourceHandle(binding, slot, page) : null;
    }
    function mountedCard(options) {
        assertRouteSession(options.sessionToken);
        if (isHoverCancelled(options.hoverToken ?? null) || !options.section?.isConnected ||
            !options.scroller?.isConnected || !options.track?.isConnected) return null;
        return withNativeReadScope(() => lookupMountedCard(mountedOperation(options)));
    }
    function mountedTick() {
        return new Promise(resolve => {
            let closed = false, timer = null;
            const ticket = { close() {
                if (closed) return;
                closed = true;
                clearTimeout(timer);
                mountedWaits.delete(ticket);
                resolve();
            } };
            mountedWaits.add(ticket);
            timer = setTimeout(ticket.close, 10);
        });
    }
    function resetMountedWaits() { for (const ticket of mountedWaits) ticket.close(); }
    async function resolveMountedCard(options, assertOperation = () => {}) {
        assertRouteSession(options.sessionToken);
        if (isHoverCancelled(options.hoverToken ?? null)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        if (!options.section?.isConnected || !options.scroller?.isConnected || !options.track?.isConnected) {
            return Object.freeze({ status: 'unknown', reason: 'native-binding-unavailable' });
        }
        const start = performance.now(), timeout = Number.isFinite(options.timeout) ? Math.max(0, options.timeout) : 500;
        let operation;
        let source = withNativeReadScope(() => {
            operation = mountedOperation(options, assertOperation);
            return lookupMountedCard(operation);
        });
        while (!source && performance.now() - start < timeout) {
            await mountedTick();
            assertRouteSession(operation.sessionToken);
            if (isHoverCancelled(operation.hoverToken)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
            source = withNativeReadScope(() => lookupMountedCard(operation));
        }
        return source ? Object.freeze({ status: 'found', source, page: source.page }) :
            Object.freeze({ status: 'unknown', reason: 'target-not-mounted' });
    }
    function mountedHints(operation) {
        const { binding, target, hoverToken, sessionToken } = operation;
        return { section: binding.section, scroller: binding.scroller, track: binding.track,
            item: target, activeOnly: true, hoverToken, sessionToken };
    }
    async function resolvePreferredCard(options) {
        const operation = withNativeReadScope(() => resolutionOperation(options));
        const { binding, guard, hoverToken: token, sessionToken, diagnosticItem } = operation;
        const { section, scroller, track } = binding;
        const preferredPage = options.preferredPage ?? options.item?.page ?? 0;
        const total = pageCount(section);
        guard();
        if (total <= 0) return Object.freeze({ status: 'unknown', reason: 'native-pages-unavailable' });
        const hints = mountedHints(operation);
        await navigation.navigate(section, scroller, preferredPage, token, sessionToken, true, guard);
        guard();
        if (isHoverCancelled(token)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        const current = withNativeReadScope(() => lookupMountedCard(mountedOperation(hints, guard)));
        if (current) return Object.freeze({ status: 'found', source: current, page: current.page, refreshed: false });

        // Preserve the normal adjacent-page pulse before trying the bounded wait.
        if (total > 1 && selectedPage(section) === preferredPage) {
            const from = selectedPage(section);
            const moved = await navigation.move(section, scroller, 1, token, sessionToken, guard);
            guard();
            if (isHoverCancelled(token)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
            if (moved !== from) {
                await navigation.move(section, scroller, -1, token, sessionToken, guard);
                guard();
                if (isHoverCancelled(token)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
            }
        }
        await navigation.navigate(section, scroller, preferredPage, token, sessionToken, true, guard);
        guard();
        if (isHoverCancelled(token)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        const result = await resolveMountedCard({ ...hints, timeout: 700 }, guard);
        guard();
        if (isHoverCancelled(token)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        if (result.status !== 'found') return result;
        trace(() => ['Hover stale logical page refreshed without full carousel scan', {
            item: diagnosticItem, preferredPage, selectedPage: result.page, source: slotDescriptor(result.source.slot)
        }]);
        guard(); assertSource(result.source);
        return Object.freeze({ ...result, refreshed: true });
    }
    async function searchSourceCard(options) {
        const operation = withNativeReadScope(() => resolutionOperation(options));
        const { binding, guard, hoverToken: token, sessionToken, diagnosticItem } = operation;
        const { section, scroller, track } = binding;
        const preferredPage = options.preferredPage ?? options.item?.page ?? 0;
        const columns = Math.max(1, options.columns || 1), repair = options.repairLogicalMapping ?? true;
        const total = pageCount(section), tried = new Set(), order = [];
        guard();
        const push = page => {
            if (page < 0 || page >= total || tried.has(page)) return;
            tried.add(page); order.push(page);
        };
        push(preferredPage);
        const radius = Number.isFinite(options.maxRadius)
            ? Math.min(Math.max(0, Math.floor(options.maxRadius)), Math.max(0, total - 1)) : Math.max(0, total - 1);
        for (let delta = 1; delta <= radius; delta++) { push(preferredPage + delta); push(preferredPage - delta); }
        Object.freeze(order);
        const hints = mountedHints(operation);
        const cancelled = reason => {
            if (!isHoverCancelled(token)) return null;
            if (reason) log(tLog('hoverSourceSearchCancelled'), { reason, token, hoverToken: readHoverToken() });
            guard();
            return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        };
        log(tLog('hoverSourceSearchStarted'), { item: diagnosticItem, preferredPage, selectedPage: selectedPage(section), pages: total, order });
        guard();
        for (const page of order) {
            guard();
            const beforePage = cancelled(); if (beforePage) return beforePage;
            const beforeSignature = withNativeReadScope(() => visibleSignature(currentPageSlots(scroller, track)));
            log(tLog('hoverSourceSearchPage'), { item: diagnosticItem, page, selectedBefore: selectedPage(section) });
            guard();
            const beforeMove = cancelled(); if (beforeMove) return beforeMove;
            await navigation.navigate(section, scroller, page, token, sessionToken, true, guard);
            guard();
            const afterMove = cancelled('token-changed-after-page-move'); if (afterMove) return afterMove;
            let result = await resolveMountedCard({ ...hints, timeout: page === preferredPage ? 500 : 280 }, guard);
            guard();
            const afterMount = cancelled('token-changed-after-mount-wait'); if (afterMount) return afterMount;
            if (result.status !== 'found') {
                await navigation.stable(scroller, track, { previousSignature: beforeSignature, minElapsed: 120,
                    timeout: 520, sessionToken, hoverToken: token, assertOperation: guard });
                guard();
                const afterHydration = cancelled(); if (afterHydration) return afterHydration;
                const source = withNativeReadScope(() => lookupMountedCard(mountedOperation(hints, guard)));
                if (source) result = { status: 'found', source };
            }
            if (result.status !== 'found') continue;
            const found = withNativeReadScope(() => {
                guard();
                const slot = result.source.slot, actual = selectedPage(section);
                const visible = viewportPageSlots(scroller, track, columns), signature = visibleSignature(visible);
                if (repair && readRuntime(section).profile.pageMode === 'logical' && signature) {
                    registerLogicalPageSignature(section, signature, actual);
                }
                guard();
                const sources = Object.freeze(visible.map(node => sourceHandle(binding, node, actual)));
                const source = sources.find(handle => sourceTickets.get(handle).slot === slot) || sourceHandle(binding, slot, actual);
                const visibleCards = Object.freeze(sources.map(handle => Object.freeze({
                    href: handle.href, videoId: handle.videoId, itemIndex: handle.itemIndex
                })));
                guard(); assertSource(source);
                return Object.freeze({ status: 'found', source, sources, visibleCards, page: actual });
            });
            trace(() => [tLog('hoverSourceFound'), { item: diagnosticItem, actualPage: found.page, source: slotDescriptor(found.source.slot) }]);
            guard(); assertSource(found.source);
            return found;
        }
        warn(tLog('hoverSourceSearchFailed'), { item: diagnosticItem, preferredPage, selectedPage: selectedPage(section), pages: total });
        guard();
        return cancelled() || Object.freeze({ status: 'unknown', reason: 'source-search-exhausted' });
    }
    async function resolveCard(options) {
        if (options.mode === 'mounted') return resolveMountedCard(options);
        const { section, scroller, track, expectedPage, totalCount, columns = 1,
            pageItemCount = 1, hoverToken = null, sessionToken = null } = options;
        assertRouteSession(sessionToken);
        if (isHoverCancelled(hoverToken)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            return Object.freeze({ status: 'unknown', reason: 'native-binding-unavailable' });
        }
        if (options.mode === 'preferred-refresh') return resolvePreferredCard(options);
        if (options.mode === 'search') return searchSourceCard(options);
        const { binding, guard, target } = resolutionOperation(options);
        guard();
        const key = target.videoId ? 'v:' + target.videoId : 'h:' + target.href;
        const keyOf = slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const href = card?.href || card?.getAttribute('href') || '';
            const id = netflixDom.videoIdFromHref(href);
            return id ? 'v:' + id : 'h:' + href;
        };
        const width = Math.max(1, columns || 1);
        const expectedPageCount = Math.max(1, Math.ceil(Math.max(totalCount || 0, 1) / width));
        const nativePageCount = pageCount(section);
        if (nativePageCount !== expectedPageCount || expectedPage < 0 || expectedPage >= nativePageCount) {
            log(tLog('hoverExpectedPageUnknown'), { reason: 'page-count-not-converged', item: target,
                expectedPage, nativePageCount, expectedPageCount, legacyItemCount: totalCount, columns: width });
            guard();
            return Object.freeze({ status: 'unknown', reason: 'page-count-not-converged' });
        }
        const selectedBefore = selectedPage(section);
        const beforeSignature = visibleSignature(currentPageSlots(scroller, track));
        await navigation.navigate(section, scroller, expectedPage, hoverToken, sessionToken, true, guard);
        guard();
        if (hoverToken !== null && hoverToken !== readHoverToken()) {
            return Object.freeze({ status: 'unknown', reason: 'token-changed-after-page-move' });
        }
        if (selectedPage(section) !== expectedPage) {
            log(tLog('hoverExpectedPageUnknown'), { reason: 'expected-page-not-reached', item: target,
                expectedPage, selectedPage: selectedPage(section) });
            guard();
            return Object.freeze({ status: 'unknown', reason: 'expected-page-not-reached' });
        }
        const foundResult = (slot, slots, afterStabilityWait = false) => withNativeReadScope(() => {
            guard();
            const sources = Object.freeze(slots.map(node => sourceHandle(binding, node, expectedPage)));
            const source = sources[slots.indexOf(slot)];
            trace(() => [tLog('hoverExpectedPageMatch'), { item: target, expectedPage, selectedPage: selectedPage(section),
                source: slotDescriptor(slot), ...(afterStabilityWait ? { afterStabilityWait: true } : {}) }]);
            guard(); assertSource(source);
            return Object.freeze({ status: 'found', source, sources, page: expectedPage });
        });
        let pageSlots = viewportPageSlots(scroller, track, width);
        let slot = pageSlots.find(node => keyOf(node) === key) || null;
        if (slot) return foundResult(slot, pageSlots);
        const minimumSlots = Math.min(width, Math.max(1, pageItemCount));
        const stableSlots = await navigation.stable(scroller, track, {
            previousSignature: selectedBefore === expectedPage ? '' : beforeSignature, requiredStableFrames: 2,
            minimumSlots, requiredKeys: new Set([key]), timeout: 650, sessionToken, hoverToken, assertOperation: guard });
        guard();
        if (hoverToken !== null && hoverToken !== readHoverToken()) {
            return Object.freeze({ status: 'unknown', reason: 'token-changed-after-stability-wait' });
        }
        if (selectedPage(section) !== expectedPage) return Object.freeze({ status: 'unknown', reason: 'page-changed-during-stability-wait' });
        pageSlots = viewportPageSlots(scroller, track, width);
        slot = pageSlots.find(node => keyOf(node) === key) || null;
        if (slot) return foundResult(slot, pageSlots, true);
        const visibleSlots = pageSlots.length ? pageSlots : (stableSlots?.length ? stableSlots.slice(0, width) : []);
        const visibleCards = Object.freeze(visibleSlots.map(node => {
            const href = node.querySelector(NETFLIX_DOM_SELECTORS.standardCard)?.href || '';
            const itemIndex = netflixItemIndexFromSlot(node);
            return Object.freeze({ href, videoId: netflixDom.videoIdFromHref(href),
                itemIndex: Number.isSafeInteger(itemIndex) && itemIndex >= 0 ? itemIndex : null });
        }));
        const visibleIds = Object.freeze(visibleCards.map(card => card.videoId).filter(Boolean));
        if (visibleSlots.length < minimumSlots || visibleIds.length < minimumSlots) {
            log(tLog('hoverExpectedPageUnknown'), { reason: 'expected-page-not-fully-mounted', item: target,
                expectedPage, minimumSlots, slots: visibleSlots.length, visibleIds });
            guard();
            return Object.freeze({ status: 'unknown', reason: 'expected-page-not-fully-mounted', visibleIds, visibleCards });
        }
        log(tLog('hoverExpectedPageMismatch'), { item: target, expectedPage, visibleIds });
        guard();
        return Object.freeze({ status: 'mismatch', reason: 'target-not-in-expected-page', visibleIds, visibleCards });
    }


    function assertSourceBinding(source, section, scroller, track) {
        assertSource(source);
        const ticket = sourceTickets.get(source);
        if (ticket.binding.section !== section || ticket.binding.scroller !== scroller || ticket.binding.track !== track) {
            throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Resolved source does not belong to the observed binding');
        }
    }
    return Object.freeze({ anchorPageZero, resolveCard, mountedCard, isSourceCurrent, assertSource,
        sourceHandle, assertSourceBinding, resetMountedWaits, pending: () => mountedWaits.size });
}
