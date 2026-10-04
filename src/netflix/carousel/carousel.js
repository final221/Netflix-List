import { createPageModel, normalizeNetflixLogicalIndex, expectedLogicalIndicesForPage,
    logicalPageFromSlotPositions, wrappedTailLogicalPageInfo, wrappedTailLogicalPageForRebuild } from './page-model.js';
import { NETFLIX_DOM_SELECTORS as DEFAULT_SELECTORS } from '../page-dom.js';
import { createNavigation } from './navigation.js';
import { createCollection } from './collection.js';
import { GRID_ID as DEFAULT_GRID_ID, STATUS_ID as DEFAULT_STATUS_ID, LEGACY_EMPTY_STATE_ID as DEFAULT_EMPTY_ID,
    ORDER_MISMATCH_DIALOG_ID as DEFAULT_DIALOG_ID, SYNTHETIC_SECTION_ID, ORIGINAL_HIDDEN_CLASS, ORIGINAL_VISIBILITY_ATTR,
    FAST_MOVE_CLASS, SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS } from '../../dom-names.js';

// Native binding and mapping are owned here. Composition supplies interpreted
// membership shape and lifecycle operations, never a mutable feature state bag.
export function createCarousel({ pageDom: netflixDom, scope, document, window, Element, getComputedStyle,
    performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    readListShape = () => null, readGraphqlCount = () => null, createError: initializationError,
    log = () => {}, warn = () => {}, trace = () => {}, tLog = value => value, logTimeout: logOperationTimeout = () => {},
    ownedUi = {}, MutationObserver,
    checkRoute = () => {}, onMutationDelivery = () => {}, isInitializationBlocked = () => false,
    onBlockedMutation = () => {}, isGridDetached = () => false, shouldCoalesce = () => false,
    onRelevantMutation = () => {}, isHoverCancelled = () => false, readHoverToken = () => null,
    navigationDiagnostics = () => ({ bump() {}, record: null }), cardMarkup }) {
    const NETFLIX_DOM_SELECTORS = netflixDom.selectors || DEFAULT_SELECTORS;
    const GRID_ID = ownedUi.grid || DEFAULT_GRID_ID, STATUS_ID = ownedUi.status || DEFAULT_STATUS_ID;
    const LEGACY_EMPTY_STATE_ID = ownedUi.empty || DEFAULT_EMPTY_ID, ORDER_MISMATCH_DIALOG_ID = ownedUi.dialog || DEFAULT_DIALOG_ID;
    const findMyListSection = (...args) => netflixDom.findMyListSection(...args);
    const nativeCardIdentity = (...args) => netflixDom.nativeCardIdentity(...args);
    const listData = { readMyListTotalCount: readGraphqlCount };
    const assertRouteSession = token => scope.assertCurrent(token);
    const NATIVE_READY_TIMEOUT_MS = 3000, NATIVE_SINGLE_PAGE_STABLE_MS = 700, NATIVE_EMPTY_STABLE_MS = 1200;
    const NATIVE_READY_POLL_MS = 25, NATIVE_LOGICAL_STABLE_MS = 120;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let nativeReadScope = null;
    let models = new WeakMap();
    let acceptedBinding = null;
    let bindingGeneration = 0;
    const bindingTickets = new WeakMap();
    const sourceTickets = new WeakMap();
    const mappingTickets = new WeakMap();
    const preparationTickets = new WeakMap();
    const observationTickets = new WeakMap();
    let preparationOwner = null;
    let mappingSequence = 0;
    const mountedWaits = new Set();
    let discoveryOwner = null, targetDocumentObserver = null, targetMutationFrame = null;
    let targetObservedBrowseHost = null, targetObservedMyListSection = null, targetObservedAncestors = [];
    let targetDocumentDiscoveryActive = false;
    const navigation = createNavigation({ borrowBinding, assertBinding, createError: initializationError,
        bindingForSource: (scroller, track) => borrowBinding(acceptedBinding?.section || null, scroller, track),
        fastMoveClass: ownedUi.fastMove || FAST_MOVE_CLASS, scope, performance, getComputedStyle,
        setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, MutationObserver,
        cardSelector: NETFLIX_DOM_SELECTORS.standardCard,
        videoIdFromHref: href => netflixDom.videoIdFromHref(href), isHoverCancelled, readHoverToken,
        diagnosticsFor: navigationDiagnostics, log, warn, tLog, logTimeout: logOperationTimeout,
        native: { model: getCarouselDomRuntime, profile: detectCarouselDomProfile,
            registerPage: registerLogicalPageSignature, selectedPage, pageCount,
            navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
            currentSlots: currentPageSlots, signatureOf: visibleSignature,
            notePage: (section, page, cycle) => modelForWrite(section)?.notePage(page, cycle),
            track: scroller => acceptedBinding?.scroller === scroller && acceptedBinding.track?.isConnected
                ? acceptedBinding.track : netflixDom.findTrack(scroller) } });
    const collection = createCollection({ scope, performance, requestAnimationFrame, cancelAnimationFrame,
        navigation, captureItem: (...args) => cardMarkup.capture(...args),
        videoIdFromHref: href => netflixDom.videoIdFromHref(href), cardSelector: NETFLIX_DOM_SELECTORS.standardCard,
        createError: initializationError, log, warn, tLog, logTimeout: logOperationTimeout,
        native: { borrowBinding, assertBinding, isBindingCurrent, model: getCarouselDomRuntime,
            sample: withNativeReadScope, readiness: nativeCarouselReadiness,
            readCount: nativeReactCarouselTotalCount, itemIndex: netflixItemIndexFromSlot, cardIdentity: nativeCardIdentity,
            matchesMountedSource: (section, scroller, track) => findMyListSection() === section &&
                section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller) === scroller && netflixDom.findTrack(scroller) === track,
            resetModel: resetCarouselDomRuntime, profile: detectCarouselDomProfile,
            profileSummary: carouselDomProfileSummary, currentSlots: currentPageSlots, signatureOf: visibleSignature,
            selectedPage, pageCount, logicalWindow: nativeLogicalPageState,
            requireLogicalWindow: requireNativeLogicalPageState, forcePage: forceLogicalPageSignature,
            navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
            suppressMotion: navigation.suppress,
            beginCollection: section => modelForWrite(section)?.beginCollection(),
            notePage: (section, page) => modelForWrite(section)?.notePage(page),
            markCycle: section => modelForWrite(section)?.markCycle(),
            completeCollection: (section, pages) => modelForWrite(section)?.finishCollection(pages) } });
    function currentPageVideoIds(scroller, track) {
        return currentPageSlots(scroller, track)
            .map(slot => {
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                return card ? netflixDom.videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
            })
            .filter(Boolean);
    }

    async function anchorPageZero({ section, scroller, track, firstVideoId, columns, sessionToken = null }) {
        const owner = borrowBinding(section, scroller, track);
        const assertSource = () => { assertRouteSession(sessionToken); assertBinding(owner); };
        assertSource();
        const expectedFirstVideoId = String(firstVideoId || '');
        if (!expectedFirstVideoId) return true;

        const runtime = getCarouselDomRuntime(section);
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

    function viewportPageSlots(scroller, track, columns = 1) {
        return withNativeReadScope(() => {
            const all = nativeFilledSlots(track);
            if (!all.length) return [];
            const count = Math.max(1, columns || 1);
            const sr = nativeRect(scroller);
            const visible = all.map(slot => ({ slot, rect: nativeRect(slot) })).filter(entry => {
                const cx = entry.rect.left + entry.rect.width / 2;
                return entry.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            }).sort((a, b) => a.rect.left - b.rect.left).map(entry => entry.slot);
            return visible.length ? visible.slice(0, count) : currentPageSlots(scroller, track).slice()
                .sort((a, b) => nativeRect(a).left - nativeRect(b).left).slice(0, count);
        });
    }
    function isSourceCurrent(source) {
        const ticket = sourceTickets.get(source);
        if (!ticket || !isBindingCurrent(ticket.binding) || ticket.slot.isConnected === false ||
            models.get(ticket.binding.section) !== ticket.model || ticket.model.revision !== ticket.revision) return false;
        return withNativeReadScope(() => {
            if (getModel(ticket.binding.section) !== ticket.model || ticket.model.revision !== ticket.revision) return false;
            const card = ticket.slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const href = card?.href || card?.getAttribute('href') || '';
            if (href !== ticket.href || netflixItemIndexFromSlot(ticket.slot) !== ticket.itemIndex ||
                !nativeFilledSlots(ticket.binding.track).includes(ticket.slot)) return false;
            if (ticket.model.view.profile.pageMode === 'indicator') {
                const indicators = nativeIndicatorItems(ticket.binding.section);
                const page = Math.max(0, indicators.findIndex(node => node.getAttribute('data-indicator-selected') === 'true'));
                if (page !== ticket.page) return false;
            }
            return isBindingCurrent(ticket.binding) && models.get(ticket.binding.section) === ticket.model &&
                ticket.model.revision === ticket.revision;
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
        const model = getModel(binding.section);
        const source = Object.freeze({ href, videoId: netflixDom.videoIdFromHref(href),
            itemIndex: Number.isSafeInteger(itemIndex) && itemIndex >= 0 ? itemIndex : null, page,
            get slot() { assertSource(source); return slot; }, isCurrent: () => isSourceCurrent(source) });
        sourceTickets.set(source, { binding, slot, href, itemIndex, page, model, revision: model.revision });
        assertSource(source);
        return source;
    }
    function resolutionOperation({ section, scroller, track, item, mode = null, hoverToken = null, sessionToken = null }) {
        assertRouteSession(sessionToken);
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        const model = getModel(section), mappingGeneration = model.mappingGeneration;
        const target = Object.freeze({ href: String(item?.href || ''), videoId: String(item?.videoId || '') });
        const diagnosticItem = mode === 'preferred-refresh' || mode === 'search'
            ? Object.freeze({ ...target, page: item?.page, ariaLabel: String(item?.ariaLabel || '') }) : null;
        const guard = () => {
            assertRouteSession(sessionToken); assertBinding(binding);
            if (models.get(section) !== model || model.mappingGeneration !== mappingGeneration) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-resolution', 'Native page mapping changed during source resolution');
            }
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
                if (repair && getModel(section).view.profile.pageMode === 'logical' && signature) {
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

    function mappingOperation({ section, scroller, track, sessionToken = null, totalCount, columns,
        assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        let model = getModel(section), generation = model.mappingGeneration;
        // A newer remap supersedes an older one even when markStale is idempotent.
        const sequence = ++mappingSequence;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (sequence !== mappingSequence || models.get(section) !== model || model.mappingGeneration !== generation) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-remapping', 'Native mapping owner changed during remapping');
            }
        };
        guard();
        return { binding, totalCount, columns: Math.max(1, columns || 1), guard,
            get model() { return model; },
            write(callback) { guard(); callback(model); generation = model.mappingGeneration; guard(); },
            commit(facts) {
                guard();
                const replacement = createPageModel(model.view.profile);
                replacement.commit(facts);
                models.set(section, replacement); model = replacement; generation = model.mappingGeneration;
                invalidateNativeReadScope(); guard();
            } };
    }
    function mappingResult(operation, status, facts = {}) {
        operation.guard();
        const runtime = operation.model.view;
        const result = Object.freeze({ status, reason: null, countConverged: false,
            totalCount: operation.totalCount, columns: operation.columns,
            currentPage: runtime.currentPage, knownPageCount: runtime.knownPageCount,
            pageCountFinalized: runtime.pageCountFinalized, pageMappingStale: runtime.pageMappingStale,
            retryCount: runtime.logicalRemapRetryCount, visibleSignature: '', ...facts,
            visibleIds: Object.freeze([...(facts.visibleIds || [])]),
            itemIndices: Object.freeze([...(facts.itemIndices || [])]),
            logicalIndices: Object.freeze([...(facts.logicalIndices || [])]) });
        mappingTickets.set(result, { operation, revision: operation.model.revision });
        return result;
    }
    function assertMapping(result) {
        const ticket = mappingTickets.get(result);
        if (ticket) {
            ticket.operation.guard();
            getModel(ticket.operation.binding.section);
            ticket.operation.guard();
            if (ticket.operation.model.revision === ticket.revision) return result;
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-remapping', 'Native mapping observation is no longer current');
    }
    function isMappingCurrent(result) {
        try { assertMapping(result); return true; } catch (_) { return false; }
    }
    function anchorMappingAfterDelta(options) {
        return withNativeReadScope(() => {
            const operation = mappingOperation(options);
            const { section, scroller, track } = operation.binding;
            if (operation.model.view.profile.pageMode !== 'logical') return mappingResult(operation, 'not-applicable');
            const pages = Math.max(1, Math.ceil(Math.max(operation.totalCount, 1) / operation.columns));
            const slots = currentPageSlots(scroller, track), signature = visibleSignature(slots);
            const votes = new Map();
            for (const slot of slots) {
                operation.guard();
                const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
                const id = card ? netflixDom.videoIdFromHref(card.getAttribute('href') || card.href || '') : '';
                const page = id ? options.pageHintForVideoId?.(id) : null;
                operation.guard();
                if (Number.isFinite(page)) votes.set(page, (votes.get(page) || 0) + 1);
            }
            const nativePage = nativeLogicalPageState(scroller, track, operation.totalCount, operation.columns);
            operation.guard();
            let page = Number.isFinite(nativePage.page) ? nativePage.page : operation.model.view.currentPage || 0;
            if (!Number.isFinite(nativePage.page) && votes.size) {
                page = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
            }
            page = Math.max(0, Math.min(pages - 1, page));
            operation.write(model => model.anchor({ pageCount: pages, currentPage: page, signature }));
            return mappingResult(operation, 'anchored', { visibleSignature: signature,
                visibleIds: currentPageVideoIds(scroller, track), itemIndices: nativePage.itemIndices, logicalIndices: nativePage.logicalIndices });
        });
    }
    async function rebuildMappingFromNativePosition(options) {
        const operation = withNativeReadScope(() => mappingOperation(options));
        const { section, scroller, track } = operation.binding;
        const { totalCount, columns } = operation;
        const reason = options.reason || 'responsive-remap';
        if (operation.model.view.profile.pageMode !== 'logical') return mappingResult(operation, 'not-applicable');
        operation.write(model => model.markStale());
        let motionLease = null;
        try {
            await navigation.whenIdle();
            operation.guard();
            return withNativeReadScope(() => {
                getModel(section); operation.guard();
                motionLease = navigation.suppress(section, track);
                operation.guard();
                const runtime = operation.model.view;
                const count = nativeReactCarouselTotalCount(scroller, track);
                operation.guard();
                const countConverged = Number.isSafeInteger(count.totalCount) && count.totalCount === totalCount;
                if (!count.uniqueReadings.length || !countConverged) {
                    operation.write(model => model.deferMapping());
                    log('Logical My List page-model rebuild deferred until native delta converges', {
                        reason, legacyTotalCount: totalCount, nativeTotalCount: count.totalCount,
                        readings: count.readings, uniqueReadings: count.uniqueReadings,
                        selectedPage: selectedPage(section), pageMappingStale: runtime.pageMappingStale,
                        retryCount: runtime.logicalRemapRetryCount });
                    operation.guard();
                    return mappingResult(operation, 'deferred', { reason: 'count-not-converged' });
                }
                let page = nativeLogicalPageState(scroller, track, totalCount, columns);
                operation.guard();
                if (!page.positions.length || !page.positions.every(position => Number.isSafeInteger(position.itemIndex)) || !Number.isFinite(page.page)) {
                    const tail = wrappedTailLogicalPageForRebuild(page.positions, totalCount, columns, runtime);
                    if (tail) {
                        page = { ...page, page: tail.page };
                        log('Logical My List wrapped tail accepted for current-page recovery', {
                            reason, page: tail.page, wrapIndex: tail.wrapIndex, totalCount, columns, itemIndices: page.itemIndices });
                        operation.guard();
                    } else {
                        logVirtualRawIndexDiagnostic(page.slots, totalCount, columns, 'logical-page-model-rebuild');
                        operation.guard();
                        operation.write(model => model.deferMapping());
                        log('Logical My List page-model rebuild deferred for non-canonical native window', {
                            reason, totalCount, columns, slots: page.slots.length, itemIndices: page.itemIndices,
                            logicalIndices: page.logicalIndices, resolvedPage: page.page, retryCount: runtime.logicalRemapRetryCount });
                        operation.guard();
                        return mappingResult(operation, 'deferred', { reason: 'non-canonical-window', countConverged,
                            itemIndices: page.itemIndices, logicalIndices: page.logicalIndices });
                    }
                }
                const signature = visibleSignature(page.slots);
                operation.guard();
                if (!signature) {
                    operation.write(model => model.deferMapping());
                    log('Logical My List page-model rebuild deferred because native signature is unavailable', {
                        reason, totalCount, columns, retryCount: runtime.logicalRemapRetryCount });
                    operation.guard();
                    return mappingResult(operation, 'deferred', { reason: 'signature-unavailable', countConverged });
                }
                const visibleIds = currentPageVideoIds(scroller, track);
                operation.guard();
                operation.commit({ pageCount: Math.max(1, Math.ceil(Math.max(totalCount, 1) / columns)), currentPage: page.page, signature });
                return mappingResult(operation, 'committed', { countConverged, visibleSignature: signature,
                    visibleIds, itemIndices: page.itemIndices, logicalIndices: page.logicalIndices });
            });
        } finally { motionLease?.release(); }
    }
    function refreshMapping(options) {
        return options.mode === 'delta' ? anchorMappingAfterDelta(options) : rebuildMappingFromNativePosition(options);
    }

    async function prepareSource({ section, scroller, track, sessionToken = null, fastSinglePageTotalCount = null,
        assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        const binding = borrowBinding(section, scroller, track);
        assertBinding(binding);
        const owner = { binding, sessionToken, model: null, generation: null, accepted: false };
        preparationOwner = owner;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (preparationOwner !== owner || (owner.model && models.get(section) !== owner.model) ||
                (owner.generation !== null && owner.model.mappingGeneration !== owner.generation)) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation', 'Native source preparation was replaced');
            }
        };
        owner.guard = guard;
        resetCarouselDomRuntime(section);
        owner.model = models.get(section);
        guard();
        logCarouselDomProfile(section, 'before-readiness');
        guard();
        const readiness = await waitForNativeCarouselReady(section, scroller, track, sessionToken, {
            fastSinglePageTotalCount, assertAdmission: guard
        });
        guard();
        // Profile detection may legitimately change while Netflix initializes.
        // The confirmed interpretation is retained for subsequent acceptance.
        owner.generation = owner.model.mappingGeneration;
        const state = readiness.state && Object.freeze({ ...readiness.state,
            capabilities: Object.freeze({ ...readiness.state.capabilities }) });
        const result = Object.freeze({ ...readiness, ...(state ? { state } : {}) });
        if (result.ready && !result.empty) preparationTickets.set(result, owner);
        return result;
    }
    function assertPreparation(result) {
        const owner = preparationTickets.get(result);
        if (owner) {
            owner.guard(); getModel(owner.binding.section); owner.guard();
            return result;
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-preparation', 'Native source preparation is no longer current');
    }
    function isPreparationCurrent(result) {
        try { assertPreparation(result); return true; } catch (_) { return false; }
    }
    function acceptCollection({ preparation, totalCount, columns, collectedCount }) {
        assertPreparation(preparation);
        const owner = preparationTickets.get(preparation);
        if (!Number.isSafeInteger(totalCount) || totalCount <= 0 || !Number.isSafeInteger(columns) || columns <= 0 ||
            !Number.isSafeInteger(collectedCount) || collectedCount !== totalCount) {
            throw initializationError('NATIVE_COLLECTION_COUNT_MISMATCH', 'native-collection-acceptance',
                'Complete collection count and positive layout columns are required', { totalCount, columns, collectedCount });
        }
        if (owner.accepted) throw initializationError('NATIVE_COLLECTION_ALREADY_ACCEPTED', 'native-collection-acceptance',
            'This preparation already accepted a complete collection');
        owner.guard();
        owner.model.confirmCount(Math.max(1, Math.ceil(totalCount / columns)));
        owner.generation = owner.model.mappingGeneration;
        owner.accepted = true;
        owner.guard();
        return mappingResult({ binding: owner.binding, model: owner.model, totalCount, columns, guard: owner.guard }, 'accepted');
    }

    function observationOperation({ section, scroller = null, track = null, binding = null, source = null,
        sessionToken = null, assertCurrent = () => {} }) {
        assertRouteSession(sessionToken); assertCurrent();
        binding ||= borrowBinding(section, scroller, track);
        assertBinding(binding);
        if (binding.section !== section || (scroller && binding.scroller !== scroller) || (track && binding.track !== track)) {
            throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Observation binding does not match its source');
        }
        const model = getModel(section), generation = model.mappingGeneration;
        const guard = () => {
            assertRouteSession(sessionToken); assertCurrent(); assertBinding(binding);
            if (models.get(section) !== model || model.mappingGeneration !== generation) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Observed native interpretation changed');
            }
            if (source) {
                assertSource(source);
                const ticket = sourceTickets.get(source);
                if (ticket.binding.section !== section || ticket.binding.scroller !== scroller || ticket.binding.track !== track) {
                    throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Resolved source does not belong to the observed binding');
                }
            }
        };
        guard();
        return { binding, model, guard };
    }
    function observationResult(operation, facts, validate = () => {}) {
        operation.guard(); validate(); operation.guard();
        const result = Object.freeze(facts);
        observationTickets.set(result, { operation, validate });
        return result;
    }
    function assertObservation(result) {
        const ticket = observationTickets.get(result);
        if (ticket) {
            return withNativeReadScope(() => {
                ticket.operation.guard(); getModel(ticket.operation.binding.section); ticket.operation.guard();
                ticket.validate(); ticket.operation.guard();
                return result;
            });
        }
        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native observation is no longer current');
    }
    function isObservationCurrent(result) {
        try { assertObservation(result); return true; } catch (_) { return false; }
    }
    function observeSource(options) {
        return withNativeReadScope(() => {
            const operation = observationOperation(options), runtime = operation.model.view;
            const attempts = runtime.logicalRemapRetryCount;
            const count = options.count === 'required'
                ? requireNativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track,
                    options.provisionalTotalCount ?? null, operation.guard)
                : options.count === 'optional' ? nativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track) : null;
            const countFacts = count ? Object.freeze({ ...count, readings: Object.freeze([...count.readings]),
                uniqueReadings: Object.freeze([...count.uniqueReadings]) }) : null;
            return observationResult(operation, { mode: runtime.profile.pageMode,
                needsRemapping: Boolean(runtime.pageMappingStale), remapAttempts: attempts,
                ...(countFacts ? { count: countFacts } : {}) }, () => {
                if (runtime.logicalRemapRetryCount !== attempts) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Native remapping observation changed');
                if (countFacts) {
                    const current = nativeReactCarouselTotalCount(operation.binding.scroller, operation.binding.track);
                    if (current.totalCount !== countFacts.totalCount || current.slots !== countFacts.slots ||
                        current.readings.length !== countFacts.readings.length ||
                        !current.readings.every((value, index) => Object.is(value, countFacts.readings[index]))) {
                        throw initializationError('NATIVE_SOURCE_REPLACED', 'native-observation', 'Native count observation changed');
                    }
                }
            });
        });
    }

    function slotDescriptor(slot, totalCount = undefined) {
        try {
            if (!slot) return null;
            if (totalCount === undefined) totalCount = acceptedBinding ? readListShape(acceptedBinding.section)?.totalCount : null;
            const card = slot.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard);
            const href = card?.href || card?.getAttribute?.('href') || '';
            const itemIndex = netflixItemIndexFromSlot(slot);
            const rect = slot.getBoundingClientRect ? nativeRect(slot) : null;
            const rectangle = rect ? Object.freeze(Object.fromEntries(['left', 'top', 'width', 'height', 'right', 'bottom']
                .map(key => [key, Math.round(rect[key] * 10) / 10]))) : null;
            return Object.freeze({ slot: slot.getAttribute?.('data-virtual-slot') || '', itemIndex,
                logicalIndex: normalizeNetflixLogicalIndex(itemIndex, totalCount), videoId: netflixDom.videoIdFromHref(href), href,
                ariaLabel: card?.getAttribute?.('aria-label') || '', tabindex: card?.getAttribute?.('tabindex') || '',
                connected: Boolean(slot.isConnected), inlineTransform: slot.style?.getPropertyValue?.('transform') || '', rect: rectangle });
        } catch (_) { return null; }
    }
    function sourceDescription(source) {
        try {
            const { section, scroller = null, track = null } = source || {};
            if (!section) return null;
            const page = selectedPage(section), pages = pageCount(section);
            const profile = carouselDomProfileSummary(section);
            return Object.freeze({ selectedPage: page, pageCount: pages,
                carouselDom: profile && Object.freeze({ ...profile, capabilities: Object.freeze({ ...profile.capabilities }) }),
                sourceSlots: track ? netflixDom.directSlots(track).length : 0,
                sourceCards: track ? nativeFilledSlots(track).length : 0,
                currentPageCards: scroller && track ? currentPageSlots(scroller, track).length : 0,
                sourceScan: Boolean(scroller?.classList?.contains(SOURCE_SCAN_CLASS)),
                sourceParked: Boolean(scroller?.classList?.contains(SOURCE_PARKED_CLASS)) });
        } catch (_) { return null; }
    }
    function diagnostics(options = {}) {
        const snapshot = { bindingGeneration, readScopeActive: Boolean(nativeReadScope), navigation: navigation.diagnostics(),
            collection: collection.diagnostics(), collectionOperations: collection.pending(), mountedSourceWaits: mountedWaits.size,
            discoveryActive: Boolean(targetDocumentObserver), pendingMutationFrame: targetMutationFrame !== null };
        if (Object.hasOwn(options, 'card')) {
            try { snapshot.card = withNativeReadScope(() => slotDescriptor(options.card, options.totalCount)); }
            catch (_) { snapshot.card = null; }
        }
        if (Object.hasOwn(options, 'source')) {
            try { snapshot.source = withNativeReadScope(() => sourceDescription(options.source)); }
            catch (_) { snapshot.source = null; }
        }
        return snapshot;
    }
    function pageCards(options) {
        return withNativeReadScope(() => {
            const operation = observationOperation(options);
            const { section, scroller, track } = operation.binding;
            const page = selectedPage(section);
            operation.guard();
            if (Number.isFinite(options.page) && options.page !== page) throw initializationError('NATIVE_SOURCE_REPLACED',
                'native-observation', 'Mounted native page changed before preparation');
            const columns = Math.max(1, options.columns || 1);
            const slots = options.window === 'viewport' ? viewportPageSlots(scroller, track, columns) : currentPageSlots(scroller, track);
            const mode = operation.model.view.profile.pageMode;
            const tail = mode === 'logical'
                ? wrappedTailLogicalPageInfo(logicalSlotPositions(slots, options.totalCount || 0), options.totalCount || 0, columns) : null;
            const revision = operation.model.revision;
            const cards = Object.freeze(slots.map((slot, index) => Object.freeze({ source: sourceHandle(operation.binding, slot, page),
                inPage: !(tail && tail.page === page && index >= tail.wrapIndex) })));
            return observationResult(operation, { page, mode, cards }, () => {
                if (operation.model.revision !== revision || selectedPage(section) !== page) throw initializationError('NATIVE_SOURCE_REPLACED',
                    'native-observation', 'Observed native page mapping changed');
                for (const entry of cards) assertSource(entry.source);
            });
        });
    }

    function getModel(section) {
        if (!section) return null;
        let model = models.get(section);
        const profile = detectCarouselDomProfile(section);
        if (!model) { model = createPageModel(profile); models.set(section, model); }
        else model.updateProfile(profile);
        return model;
    }
    function getCarouselDomRuntime(section) { return getModel(section)?.view || null; }
    function modelForWrite(section) { return models.get(section) || getModel(section); }
    function resetCarouselDomRuntime(section) {
        if (!section) return null;
        invalidateNativeReadScope(); models.delete(section); return getCarouselDomRuntime(section);
    }
    function registerLogicalPageSignature(section, signature, page = null) { return getModel(section)?.register(signature, page) ?? null; }
    function forceLogicalPageSignature(section, signature, page) { return getModel(section)?.force(signature, page) ?? null; }
    function normalizeLogicalPages(section) { return getModel(section)?.normalize() || 0; }
    function logCarouselDomProfile(section, reason = 'unknown') {
        const model = getModel(section); if (!model) return;
        const summary = carouselDomProfileSummary(section);
        if (model.shouldLog(JSON.stringify(summary))) log(tLog('carouselDomProfileDetected'), { reason, ...summary });
    }
    function borrowBinding(section, scroller = null, track = null) {
        const handle = Object.freeze({ section, scroller, track, generation: bindingGeneration, sessionToken: scope.token });
        bindingTickets.set(handle, { generation: bindingGeneration });
        return handle;
    }
    function isBindingCurrent(handle) {
        const ticket = bindingTickets.get(handle);
        return Boolean(ticket && ticket.generation === bindingGeneration && scope.isCurrent(handle.sessionToken) &&
            (!acceptedBinding || (handle.section === acceptedBinding.section &&
                (!handle.scroller || handle.scroller === acceptedBinding.scroller) &&
                (!handle.track || handle.track === acceptedBinding.track))) &&
            handle.section?.isConnected !== false && handle.scroller?.isConnected !== false && handle.track?.isConnected !== false);
    }
    function assertBinding(handle) {
        if (!isBindingCurrent(handle)) throw initializationError('NATIVE_SOURCE_REPLACED', 'native-binding',
            'Native My List source binding changed', { generation: handle?.generation, currentGeneration: bindingGeneration });
    }
    function bind(section, scroller = null, track = null) {
        if (acceptedBinding && acceptedBinding.section === section && acceptedBinding.scroller === scroller &&
            acceptedBinding.track === track && isBindingCurrent(acceptedBinding)) return acceptedBinding;
        preparationOwner = null;
        resetMountedWaits(); collection.reset(); navigation.reset();
        bindingGeneration++; invalidateNativeReadScope();
        if (section) models.delete(section);
        acceptedBinding = borrowBinding(section, scroller, track);
        return acceptedBinding;
    }
    function clearBinding() { preparationOwner = null; resetMountedWaits(); collection.reset(); navigation.reset(); bindingGeneration++; acceptedBinding = null; invalidateNativeReadScope(); }
    function median(values) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    const netflixReactCarousel = Object.freeze({
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

    function createNativeReadScope() {
        return { profiles: new WeakMap(), indicators: new WeakMap(), filled: new WeakMap(),
            slots: new WeakMap(), rects: new WeakMap(), indices: new WeakMap() };
    }

    function withNativeReadScope(read) {
        if (nativeReadScope) return read();
        // Only synchronous reads belong here. Never retain state across a frame,
        // await, or Netflix render; the next sample must discover fresh native data.
        nativeReadScope = createNativeReadScope();
        try { return read(); } finally { nativeReadScope = null; }
    }

    function invalidateNativeReadScope() {
        if (nativeReadScope) nativeReadScope = createNativeReadScope();
    }

    function nativeRect(node) {
        if (!nativeReadScope) return node.getBoundingClientRect();
        if (!nativeReadScope.rects.has(node)) nativeReadScope.rects.set(node, node.getBoundingClientRect());
        return nativeReadScope.rects.get(node);
    }

    function nativeFilledSlots(track) {
        if (!nativeReadScope) return netflixDom.filledSlots(track);
        if (!nativeReadScope.filled.has(track)) nativeReadScope.filled.set(track, netflixDom.filledSlots(track));
        return nativeReadScope.filled.get(track);
    }

    function nativeIndicatorItems(section) {
        if (!section) return [];
        if (!nativeReadScope) return [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')];
        if (!nativeReadScope.indicators.has(section)) {
            nativeReadScope.indicators.set(section, [...section.querySelectorAll('[data-uia="carousel-page-indicator-item"]')]);
        }
        return nativeReadScope.indicators.get(section);
    }

    function detectCarouselDomProfile(section) {
        if (section && nativeReadScope?.profiles.has(section)) return nativeReadScope.profiles.get(section);
        const legacyLeft = section?.querySelector?.('[data-uia="carousel-left-button"]') || null;
        const legacyRight = section?.querySelector?.('[data-uia="carousel-right-button"]') || null;
        const hawkinsLeft = section?.querySelector?.('[data-uia="carousel-hawkins-left-button"]') || null;
        const hawkinsRight = section?.querySelector?.('[data-uia="carousel-hawkins-right-button"]') || null;
        const indicatorItems = nativeIndicatorItems(section);
        const legacyControls = Boolean(legacyLeft || legacyRight);
        const hawkinsControls = Boolean(hawkinsLeft || hawkinsRight);
        const generation = legacyControls && hawkinsControls
            ? 'hybrid'
            : legacyControls
                ? 'generation1'
                : hawkinsControls
                    ? 'generation2'
                    : 'unknown';
        const navigationMode = legacyControls ? 'legacy' : (hawkinsControls ? 'hawkins' : 'none');
        const pageMode = legacyControls && indicatorItems.length > 0 ? 'indicator' :
            ((legacyControls || hawkinsControls) ? 'logical' : 'unknown');
        const profile = {
            generation,
            navigationMode,
            pageMode,
            capabilities: {
                legacyControls,
                hawkinsControls,
                pageIndicators: indicatorItems.length > 0,
                selectedIndicator: indicatorItems.some(x => x.getAttribute('data-indicator-selected') === 'true'),
                virtualSlots: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.virtualSlot)),
                standardCards: Boolean(section?.querySelector?.(NETFLIX_DOM_SELECTORS.standardCard))
            },
            indicatorCount: indicatorItems.length
        };
        if (section && nativeReadScope) nativeReadScope.profiles.set(section, profile);
        Object.freeze(profile.capabilities);
        return Object.freeze(profile);
    }

    function carouselDomProfileSummary(section) {
        const runtime = getCarouselDomRuntime(section);
        if (!runtime) return null;
        return {
            generation: runtime.profile.generation,
            navigationMode: runtime.profile.navigationMode,
            pageMode: runtime.profile.pageMode,
            indicatorCount: runtime.profile.indicatorCount,
            knownPageCount: runtime.knownPageCount,
            pageCountFinalized: Boolean(runtime.pageCountFinalized),
            cycleDetected: Boolean(runtime.cycleDetected),
            pageMappingStale: Boolean(runtime.pageMappingStale),
            logicalPage: runtime.currentPage,
            capabilities: { ...runtime.profile.capabilities }
        };
    }

    function logicalVisibleSignature(section) {
        const binding = acceptedBinding?.section === section ? acceptedBinding : null;
        const scroller = binding?.scroller?.isConnected ? binding.scroller : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = binding?.track?.isConnected ? binding.track : (scroller && netflixDom.findTrack(scroller));
        if (!scroller || !track) return '';
        return visibleSignature(currentPageSlots(scroller, track));
    }

    function selectedPage(section) {
        if (!nativeReadScope) return withNativeReadScope(() => selectedPage(section));
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            const items = nativeIndicatorItems(section);
            const index = items.findIndex(x => x.getAttribute('data-indicator-selected') === 'true');
            return index >= 0 ? index : 0;
        }
        if (profile.pageMode === 'logical' && runtime) {
            const binding = acceptedBinding?.section === section ? acceptedBinding : null;
            const scroller = binding?.scroller?.isConnected ? binding.scroller : section?.querySelector?.(NETFLIX_DOM_SELECTORS.carouselScroller);
            const track = binding?.track?.isConnected ? binding.track : (scroller && netflixDom.findTrack(scroller));
            const { totalCount = null, columns = 0 } = readListShape(section) || {};
            if (scroller && track && Number.isFinite(totalCount) && totalCount > 0 && columns > 0) {
                const nativeState = nativeLogicalPageState(scroller, track, totalCount, columns);
                if (Number.isFinite(nativeState.page)) {
                    const signature = visibleSignature(nativeState.slots);
                    if (signature) forceLogicalPageSignature(section, signature, nativeState.page);
                    getModel(section).notePage(nativeState.page);
                    return runtime.currentPage;
                }
            }
            const signature = logicalVisibleSignature(section);
            if (signature && runtime.signatureToPage.has(signature)) {
                getModel(section).notePage(runtime.signatureToPage.get(signature));
            }
            return runtime.currentPage;
        }
        return 0;
    }

    function pageCount(section) {
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        if (profile.pageMode === 'indicator') {
            return nativeIndicatorItems(section).length || 1;
        }
        if (profile.pageMode === 'logical' && runtime) {
            if (runtime.pageCountFinalized && Number.isFinite(runtime.knownPageCount)) {
                return Math.max(1, runtime.knownPageCount);
            }
            const knownPages = [...runtime.signatureToPage.values()].filter(Number.isFinite);
            if (knownPages.length) return Math.max(1, Math.max(...knownPages) + 1);
        }
        return 1;
    }

    function carouselMoveButton(section, scroller, direction) {
        const profile = getCarouselDomRuntime(section)?.profile || detectCarouselDomProfile(section);
        const side = direction < 0 ? 'left' : 'right';
        const selectors = profile.navigationMode === 'legacy'
            ? [`[data-uia="carousel-${side}-button"]`, `[data-uia="carousel-hawkins-${side}-button"]`]
            : [`[data-uia="carousel-hawkins-${side}-button"]`, `[data-uia="carousel-${side}-button"]`];
        for (const selector of selectors) {
            const button = scroller?.querySelector?.(selector) || section?.querySelector?.(selector);
            if (button) return { button, selector };
        }
        return { button: null, selector: selectors.join(' | ') };
    }

    function carouselMoveButtonDisabled(button) {
        if (!button) return false;
        return button.disabled === true ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.getAttribute('tabindex') === '-1';
    }

    function currentPageSlots(scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => currentPageSlots(scroller, track));
        let byTrack = nativeReadScope.slots.get(scroller);
        if (!byTrack) nativeReadScope.slots.set(scroller, byTrack = new WeakMap());
        if (byTrack.has(track)) return byTrack.get(track);
        const all = nativeFilledSlots(track);
        if (!all.length) {
            byTrack.set(track, []);
            return byTrack.get(track);
        }

        const sr = nativeRect(scroller);
        const visible = all
            .map(slot => ({ slot, rect: nativeRect(slot) }))
            .filter(x => {
                const cx = x.rect.left + x.rect.width / 2;
                return x.rect.width > 1 && cx >= sr.left && cx <= sr.right;
            })
            .sort((a, b) => a.rect.left - b.rect.left)
            .map(x => x.slot);

        const active = all.filter(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.getAttribute('tabindex') === '0';
        });
        let current = visible;
        if (active.length) {
            // During Hawkins virtual-window hydration Netflix can leave only
            // the first card tabbable while the remaining visible cards exist.
            // Prefer the complete geometric viewport window in that state.
            if (visible.length <= active.length) current = active.sort((a, b) => nativeRect(a).left - nativeRect(b).left);
        }

        byTrack.set(track, current);
        return current;
    }

    function visibleSignature(slots) {
        return slots.map(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.href || card?.getAttribute('href') || '';
        }).filter(Boolean).join('|');
    }

    function nativeCarouselReadiness(section, scroller, track) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeCarouselReadiness(section, scroller, track));
        const slots = netflixDom.directSlots(track);
        const cards = nativeFilledSlots(track);
        const currentSlots = currentPageSlots(scroller, track);
        const pages = pageCount(section);
        const formula = parseSlotLayoutFormula(track);
        const columns = Math.max(1, formula?.columns || currentSlots.length || cards.length || 1);
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const leftControl = carouselMoveButton(section, scroller, -1).button;
        const rightControl = carouselMoveButton(section, scroller, 1).button;
        const controlsPresent = Boolean(leftControl || rightControl);
        const controlsEnabled =
            leftControl?.getAttribute('tabindex') === '0' ||
            rightControl?.getAttribute('tabindex') === '0';
        const inlineTransform = track.style.getPropertyValue('transform') || '';
        const inlineDisplay = track.style.getPropertyValue('display') || '';
        const inlineWillChange = track.style.getPropertyValue('will-change') || '';
        const trackInitialized =
            inlineDisplay === 'flex' ||
            (inlineTransform && inlineTransform !== 'none') ||
            /\btransform\b/i.test(inlineWillChange);
        const signature = [
            pages,
            slots.length,
            cards.length,
            currentSlots.length,
            columns,
            controlsPresent ? 1 : 0,
            controlsEnabled ? 1 : 0,
            trackInitialized ? 1 : 0,
            profile.generation,
            profile.navigationMode,
            profile.pageMode,
            visibleSignature(currentSlots)
        ].join('||');

        return {
            connected: section.isConnected && scroller.isConnected && track.isConnected,
            pages,
            slots: slots.length,
            cards: cards.length,
            currentCards: currentSlots.length,
            columns,
            controlsPresent,
            controlsEnabled,
            trackInitialized,
            domGeneration: profile.generation,
            navigationMode: profile.navigationMode,
            pageMode: profile.pageMode,
            capabilities: { ...profile.capabilities },
            signature
        };
    }

    async function waitForNativeSource(section, timeout = NATIVE_READY_TIMEOUT_MS, sessionToken = null) {
        assertRouteSession(sessionToken);
        const bindingOwner = borrowBinding(section);
        const started = performance.now();
        while (performance.now() - started < timeout) {
            assertRouteSession(sessionToken);
            if (!isBindingCurrent(bindingOwner)) return { found: false, empty: false, reason: 'detached',
                stage: 'native-source', elapsedMs: Math.round(performance.now() - started) };
            if (section.id === SYNTHETIC_SECTION_ID) {
                const nativeSection = findMyListSection();
                if (nativeSection && nativeSection !== section) {
                    return { found: false, nativeSection, elapsedMs: Math.round(performance.now() - started) };
                }
            }

            const scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
            const track = scroller && netflixDom.findTrack(scroller);
            if (scroller && track) return { found: true, scroller, track, elapsedMs: Math.round(performance.now() - started) };
            await sleep(NATIVE_READY_POLL_MS);
        }
        assertRouteSession(sessionToken);
        if (!isBindingCurrent(bindingOwner)) return { found: false, empty: false, reason: 'detached',
            stage: 'native-source', elapsedMs: Math.round(performance.now() - started) };
        return {
            found: false,
            empty: false,
            reason: 'timeout',
            stage: 'native-source',
            timeoutMs: timeout,
            elapsedMs: Math.round(performance.now() - started)
        };
    }

    async function waitForNativeCarouselReady(section, scroller, track, sessionToken = null, options = {}) {
        const assertAdmission = options.assertAdmission || (() => {});
        assertAdmission();
        assertRouteSession(sessionToken);
        const bindingOwner = borrowBinding(section, scroller, track);
        const started = performance.now();
        const fastSinglePageTotalCount = Number.isSafeInteger(options.fastSinglePageTotalCount)
            ? options.fastSinglePageTotalCount
            : null;
        let lastSignature = '';
        let stableSince = started;
        let lastState = nativeCarouselReadiness(section, scroller, track);

        log(tLog('waitingForNativeCarouselInitialization'), {
            pages: lastState.pages,
            slots: lastState.slots,
            cards: lastState.cards,
            currentCards: lastState.currentCards,
            columns: lastState.columns,
            controlsPresent: lastState.controlsPresent,
            controlsEnabled: lastState.controlsEnabled,
            trackInitialized: lastState.trackInitialized,
            domGeneration: lastState.domGeneration,
            navigationMode: lastState.navigationMode,
            pageMode: lastState.pageMode,
            capabilities: lastState.capabilities
        });
        assertAdmission();

        while (performance.now() - started < NATIVE_READY_TIMEOUT_MS) {
            assertAdmission();
            assertRouteSession(sessionToken);
            if (!isBindingCurrent(bindingOwner)) return { ready: false, reason: 'detached',
                elapsedMs: Math.round(performance.now() - started), state: { ...lastState, connected: false } };
            const state = nativeCarouselReadiness(section, scroller, track);
            lastState = state;
            if (!state.connected) {
                return { ready: false, reason: 'detached', elapsedMs: Math.round(performance.now() - started), state };
            }

            const now = performance.now();
            if (state.signature !== lastSignature) {
                lastSignature = state.signature;
                stableSince = now;
            }

            const stableMs = now - stableSince;
            const multiPageReady =
                state.pages > 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                (state.controlsEnabled || state.trackInitialized || state.slots >= state.columns);

            const logicalCarouselReady =
                state.pageMode === 'logical' &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.controlsPresent &&
                state.trackInitialized &&
                stableMs >= NATIVE_LOGICAL_STABLE_MS;

            // A genuine short list can legitimately have one page and fewer cards than
            // the responsive column count. Do not accept that state immediately: the
            // same shape also appears briefly while Netflix is still building a larger
            // virtual carousel. Let it remain unchanged before treating it as complete.
            const fastSinglePageReady =
                Number.isSafeInteger(fastSinglePageTotalCount) &&
                fastSinglePageTotalCount > 0 &&
                fastSinglePageTotalCount <= state.columns &&
                state.pageMode === 'logical' &&
                state.pages === 1 &&
                state.cards === fastSinglePageTotalCount &&
                state.currentCards === fastSinglePageTotalCount &&
                state.slots === fastSinglePageTotalCount;

            const singlePageReady =
                state.pages === 1 &&
                state.cards > 0 &&
                state.currentCards > 0 &&
                state.slots === state.cards &&
                (fastSinglePageReady || stableMs >= NATIVE_SINGLE_PAGE_STABLE_MS);

            const emptyPageReady =
                state.pages === 1 &&
                state.cards === 0 &&
                state.slots === 0 &&
                stableMs >= NATIVE_EMPTY_STABLE_MS;

            if (emptyPageReady) {
                return {
                    ready: true,
                    empty: true,
                    reason: 'stable-empty-page',
                    elapsedMs: Math.round(performance.now() - started),
                    state
                };
            }

            if (logicalCarouselReady || multiPageReady || singlePageReady) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                assertAdmission();
                assertRouteSession(sessionToken);
                await new Promise(resolve => requestAnimationFrame(resolve));
                assertAdmission();
                assertRouteSession(sessionToken);
                if (!isBindingCurrent(bindingOwner)) return { ready: false, reason: 'detached',
                    elapsedMs: Math.round(performance.now() - started), state: { ...lastState, connected: false } };
                const confirmed = nativeCarouselReadiness(section, scroller, track);
                if (confirmed.connected && confirmed.signature === state.signature) {
                    const result = {
                        ready: true,
                        reason: logicalCarouselReady
                            ? 'logical-carousel'
                            : (multiPageReady ? 'multi-page' : (fastSinglePageReady ? 'fast-single-page' : 'stable-single-page')),
                        elapsedMs: Math.round(performance.now() - started),
                        state: confirmed
                    };
                    log(tLog('nativeCarouselInitializationReady'), result);
                    assertAdmission();
                    return result;
                }
                lastSignature = confirmed.signature;
                stableSince = performance.now();
                lastState = confirmed;
            }

            await sleep(NATIVE_READY_POLL_MS);
            assertAdmission();
            assertRouteSession(sessionToken);
        }

        assertRouteSession(sessionToken);
        if (!isBindingCurrent(bindingOwner)) return { ready: false, reason: 'detached',
            elapsedMs: Math.round(performance.now() - started), state: { ...lastState, connected: false } };
        const finalState = nativeCarouselReadiness(section, scroller, track);
        const result = {
            ready: false,
            reason: 'timeout',
            stage: 'native-carousel-readiness',
            timeoutMs: NATIVE_READY_TIMEOUT_MS,
            elapsedMs: Math.round(performance.now() - started),
            state: finalState
        };
        logOperationTimeout(result.stage, result.timeoutMs, {
            elapsedMs: result.elapsedMs,
            state: finalState
        });
        assertAdmission();
        warn(tLog('nativeCarouselInitializationIsStillIncompleteInitializationDeferred'), result);
        assertAdmission();
        return result;
    }

    function parseSlotLayoutFormula(track) {
        const slot = netflixDom.directSlots(track).find(node => node.getAttribute('style')?.includes('calc('));
        if (!slot) return null;

        const style = slot.getAttribute('style') || '';
        const match = style.match(/calc\(\(\s*100%\s*-\s*([0-9.]+)px\s*\)\s*\/\s*([0-9]+)\s*\)/i);
        if (!match) return null;

        const subtractPx = Number(match[1]);
        const columns = Number(match[2]);
        if (!Number.isFinite(subtractPx) || !Number.isFinite(columns) || columns < 1) return null;

        const computedTrack = getComputedStyle(track);
        const gap = Number.parseFloat(computedTrack.columnGap || computedTrack.gap || '8') || 8;
        const paddingLeft = Math.max(0, Number.parseFloat(computedTrack.paddingLeft || '0') || 0);
        const paddingRight = Math.max(0, Number.parseFloat(computedTrack.paddingRight || '0') || 0);
        const formulaSidePadding = Math.max(0, (subtractPx - gap * Math.max(0, columns - 1)) / 2);

        return { columns, subtractPx, gap, paddingLeft, paddingRight, formulaSidePadding };
    }

    function measureVisibleLayout(section, scroller, track) {
        const sectionRect = nativeRect(section);
        const scrollerRect = nativeRect(scroller);
        const formula = parseSlotLayoutFormula(track);

        if (formula) {
            const { columns, gap, paddingLeft, paddingRight, formulaSidePadding } = formula;
            // Netflix has two native slot formulas. Multi-page rows may include the
            // side padding in calc(), while a genuine one-page row uses track padding
            // plus a gap-only calc((100% - 40px) / 6). Prefer the actual computed
            // track padding whenever it is present so the legacy cards share the exact
            // native x coordinates in both cases.
            const explicitPadding = paddingLeft > 0.5 || paddingRight > 0.5;
            const sidePaddingLeft = explicitPadding ? paddingLeft : formulaSidePadding;
            const sidePaddingRight = explicitPadding ? paddingRight : formulaSidePadding;
            const sidePadding = (sidePaddingLeft + sidePaddingRight) / 2;
            const gridWidth = Math.max(1, scrollerRect.width - sidePaddingLeft - sidePaddingRight);
            const cardWidth = Math.max(1, (gridWidth - gap * Math.max(0, columns - 1)) / columns);
            const gridLeft = Math.max(0, scrollerRect.left - sectionRect.left + sidePaddingLeft);

            return {
                columns,
                cardWidth,
                gap,
                gridLeft,
                gridWidth,
                sidePadding,
                sidePaddingLeft,
                sidePaddingRight,
                scrollerWidth: Math.max(1, scrollerRect.width),
                scrollerHeight: Math.max(1, scrollerRect.height),
                widthRatio: cardWidth / gridWidth,
                formulaBased: true
            };
        }

        // Fallback: prefer the current page card count instead of the number visible in the viewport.
        const activeSlots = netflixDom.filledSlots(track).filter(slot => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            return card?.getAttribute('tabindex') === '0';
        });
        const sample = activeSlots.length ? activeSlots : netflixDom.filledSlots(track);
        const rects = sample
            .map(slot => nativeRect(slot))
            .filter(rect => rect.width > 1)
            .sort((a, b) => a.left - b.left);

        const columns = Math.max(1, activeSlots.length || rects.length || 5);
        const cardWidth = Math.max(1, median(rects.map(rect => rect.width)) || scrollerRect.width / columns);
        const gaps = [];
        for (let i = 1; i < rects.length; i++) {
            const g = rects[i].left - rects[i - 1].right;
            if (g >= 0 && g < 100) gaps.push(g);
        }
        const gap = gaps.length ? median(gaps) : 8;
        const sidePadding = Math.max(0, (scrollerRect.width - (cardWidth * columns + gap * Math.max(0, columns - 1))) / 2);
        const gridWidth = Math.max(1, scrollerRect.width - sidePadding * 2);
        const gridLeft = Math.max(0, scrollerRect.left - sectionRect.left + sidePadding);

        return {
            columns,
            cardWidth,
            gap,
            gridLeft,
            gridWidth,
            sidePadding,
            sidePaddingLeft: sidePadding,
            sidePaddingRight: sidePadding,
            scrollerWidth: Math.max(1, scrollerRect.width),
            scrollerHeight: Math.max(1, scrollerRect.height),
            widthRatio: cardWidth / gridWidth,
            formulaBased: false
        };
    }

    function measureEmptyLayout(section) {
        const sectionRect = section.getBoundingClientRect();
        const content = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const heading = section.querySelector(':scope > [data-uia="empty-carousel-section+title"], :scope > h2');
        const reference = content || heading;
        const referenceRect = reference?.getBoundingClientRect?.();

        let gridLeft = 0;
        let gridWidth = 0;
        let sidePaddingLeft = 0;
        let sidePaddingRight = 0;

        const hasNativeReference = Boolean(
            referenceRect &&
            Number.isFinite(referenceRect.left) &&
            Number.isFinite(referenceRect.right) &&
            Number.isFinite(referenceRect.width) &&
            referenceRect.width > 1 &&
            sectionRect.width > 1 &&
            referenceRect.left >= sectionRect.left - 1 &&
            referenceRect.right <= sectionRect.right + 1
        );

        const nativeEmptySection = section.matches?.('[data-uia="empty-carousel-section"]');
        const originalHiddenByScript = nativeEmptySection && (
            section.classList.contains(ORIGINAL_HIDDEN_CLASS) ||
            section.getAttribute(ORIGINAL_VISIBILITY_ATTR) === 'false'
        );

        if (hasNativeReference) {
            // Empty Netflix sections are already horizontally inset. Using the
            // viewport fallback here would subtract the same padding twice.
            gridLeft = Math.max(0, referenceRect.left - sectionRect.left);
            gridWidth = Math.max(1, referenceRect.width);
            sidePaddingLeft = gridLeft;
            sidePaddingRight = Math.max(0, sectionRect.right - referenceRect.right);
        } else if (originalHiddenByScript && sectionRect.width > 1) {
            // When Original My List is hidden, our CSS sets the native empty title
            // and content to display:none. Their rects therefore collapse to zero.
            // The native empty section itself already carries Netflix's responsive
            // horizontal inset, so using the viewport fallback would inset it again
            // (48px -> 96px at the desktop breakpoint) and shrink the legacy frame.
            gridLeft = 0;
            gridWidth = Math.max(1, sectionRect.width);
            sidePaddingLeft = 0;
            sidePaddingRight = 0;
        } else {
            // Synthetic loading/empty sections have no native child geometry.
            // Reproduce the responsive Netflix page padding only in that case.
            let fallbackPadding;
            if (window.innerWidth >= 2560) fallbackPadding = 72;
            else if (window.innerWidth >= 1600) fallbackPadding = 60;
            else if (window.innerWidth >= 1280) fallbackPadding = 48;
            else if (window.innerWidth >= 600) fallbackPadding = 36;
            else fallbackPadding = 24;

            sidePaddingLeft = fallbackPadding;
            sidePaddingRight = fallbackPadding;
            gridLeft = sidePaddingLeft;
            gridWidth = Math.max(1, sectionRect.width - sidePaddingLeft - sidePaddingRight);
        }

        const columns = Math.max(1, Math.round(gridWidth / 290));
        const gap = 8;
        const cardWidth = Math.max(1, (gridWidth - gap * Math.max(0, columns - 1)) / columns);
        return {
            columns,
            cardWidth,
            gap,
            gridLeft,
            gridWidth,
            sidePadding: (sidePaddingLeft + sidePaddingRight) / 2,
            sidePaddingLeft,
            sidePaddingRight,
            scrollerWidth: Math.max(1, sectionRect.width),
            scrollerHeight: 1,
            widthRatio: cardWidth / gridWidth,
            formulaBased: false
        };
    }

    function readNativeMyListDomState() {
        if (!nativeReadScope) return withNativeReadScope(() => readNativeMyListDomState());
        const section = findMyListSection();
        if (!section) {
            const graphqlCount = listData.readMyListTotalCount();
            return {
                section: null,
                scroller: null,
                track: null,
                pages: 0,
                selectedPage: 0,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: null,
                graphqlCount,
                exactCount: Number.isFinite(graphqlCount) ? graphqlCount : null,
                fingerprint: `none|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const scroller = section.querySelector(NETFLIX_DOM_SELECTORS.carouselScroller);
        const track = scroller && netflixDom.findTrack(scroller);
        const runtime = getCarouselDomRuntime(section);
        const profile = runtime?.profile || detectCarouselDomProfile(section);
        const pages = pageCount(section);
        const page = selectedPage(section);
        const pageTopologyKnown = profile.pageMode === 'indicator'
            ? profile.indicatorCount > 0
            : Boolean(runtime?.pageCountFinalized);
        const graphqlCount = listData.readMyListTotalCount();

        if (!scroller || !track) {
            return {
                section,
                scroller: scroller || null,
                track: track || null,
                pages,
                selectedPage: page,
                pageSignature: '',
                currentPageCount: 0,
                sourceSlots: 0,
                sourceCards: 0,
                domExactCount: pageTopologyKnown && pages === 1 ? 0 : null,
                graphqlCount,
                exactCount: pageTopologyKnown && pages === 1 ? 0 : (Number.isFinite(graphqlCount) ? graphqlCount : null),
                fingerprint: `${pages}|${page}|0|0||${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
            };
        }

        const current = currentPageSlots(scroller, track);
        const identities = current.map(nativeCardIdentity).filter(Boolean);
        const uniqueIdentities = [...new Set(identities)];
        const pageSignature = uniqueIdentities.join('|');
        const domExactCount = pageTopologyKnown && pages === 1 ? uniqueIdentities.length : null;
        // For one-page lists the live DOM is authoritative. Netflix's GraphQL cache can
        // remain stale after an in-page add/remove, so only use GraphQL as a fallback.
        const exactCount = Number.isFinite(domExactCount)
            ? domExactCount
            : (Number.isFinite(graphqlCount) ? graphqlCount : null);
        const sourceSlots = netflixDom.directSlots(track).length;
        const sourceCards = nativeFilledSlots(track).length;

        return {
            section,
            scroller,
            track,
            pages,
            selectedPage: page,
            pageSignature,
            pageTopologyKnown,
            currentPageCount: uniqueIdentities.length,
            sourceSlots,
            sourceCards,
            domExactCount,
            graphqlCount,
            exactCount,
            fingerprint: `${pages}|${page}|${uniqueIdentities.length}|${sourceSlots}|${sourceCards}|${pageSignature}|${Number.isFinite(graphqlCount) ? graphqlCount : 'x'}`
        };
    }

    function nativeReactCarouselTotalCount(scroller, track) {
        const slots = currentPageSlots(scroller, track);
        const readings = slots.map(slot => netflixReactCarousel.readCarouselTotalCount(slot));
        const finiteReadings = readings.filter(value => Number.isSafeInteger(value) && value >= 0);
        const unique = [...new Set(finiteReadings)];
        return {
            totalCount: unique.length === 1 ? unique[0] : null,
            readings,
            slots: slots.length,
            uniqueReadings: unique
        };
    }

    function requireNativeReactCarouselTotalCount(scroller, track, provisionalTotalCount = null, assertCurrent = () => {}) {
        const state = nativeReactCarouselTotalCount(scroller, track);
        assertCurrent();
        if (Number.isSafeInteger(state.totalCount) && state.totalCount >= 0) return state;
        throw initializationError(
            'NATIVE_TOTAL_COUNT_UNAVAILABLE',
            'native-react-total-count',
            'Could not read a consistent Netflix My List totalCount from the mounted carousel',
            {
                provisionalTotalCount,
                slots: state.slots,
                readings: state.readings,
                uniqueReadings: state.uniqueReadings
            }
        );
    }

    function netflixItemIndexFromSlot(slot) {
        if (!nativeReadScope || !slot) return netflixReactCarousel.readItemIndex(slot).value;
        if (!nativeReadScope.indices.has(slot)) {
            nativeReadScope.indices.set(slot, netflixReactCarousel.readItemIndex(slot).value);
        }
        return nativeReadScope.indices.get(slot);
    }

    function logicalSlotPositions(slots, totalCount) {
        return slots.map(slot => {
            const itemIndex = netflixItemIndexFromSlot(slot);
            return {
                slot,
                itemIndex,
                logicalIndex: normalizeNetflixLogicalIndex(itemIndex, totalCount)
            };
        });
    }

    function nativeLogicalPageState(scroller, track, totalCount, columns) {
        if (!nativeReadScope) return withNativeReadScope(() => nativeLogicalPageState(scroller, track, totalCount, columns));
        const slots = currentPageSlots(scroller, track);
        const positions = logicalSlotPositions(slots, totalCount);
        const page = logicalPageFromSlotPositions(positions, totalCount, columns);
        return {
            slots,
            positions,
            page,
            itemIndices: positions.map(position => position.itemIndex),
            logicalIndices: positions.map(position => position.logicalIndex)
        };
    }

    function requireNativeLogicalPageState(scroller, track, totalCount, columns, stage = 'logical-item-index-detection') {
        const state = nativeLogicalPageState(scroller, track, totalCount, columns);
        if (state.positions.length && state.positions.every(position => Number.isSafeInteger(position.itemIndex)) && Number.isFinite(state.page)) {
            return state;
        }
        logVirtualRawIndexDiagnostic(state.slots, totalCount, columns, stage);
        throw initializationError(
            'NATIVE_LOGICAL_INDEX_UNAVAILABLE',
            stage,
            'Could not read a complete Netflix itemIndex page from the current My List carousel',
            {
                totalCount,
                columns,
                slots: state.slots.length,
                itemIndices: state.itemIndices,
                logicalIndices: state.logicalIndices,
                resolvedPage: state.page
            }
        );
    }

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
        const fiber = netflixReactCarousel.fiberForNode(node);
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
                typeName: netflixReactCarousel.typeName(current),
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

    function logVirtualRawIndexDiagnostic(slots, totalCount, columns, stage) {
        const entries = slots.slice(0, Math.min(slots.length, 6)).map((slot, index) => {
            const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            const child = slot.firstElementChild;
            const cardParent = card?.parentElement || null;
            return {
                index,
                descriptor: slotDescriptor(slot),
                nodes: [
                    diagnosticReactNode(slot, 'slot'),
                    diagnosticReactNode(child, 'slot-first-child'),
                    diagnosticReactNode(cardParent, 'card-parent'),
                    diagnosticReactNode(card, 'card')
                ]
            };
        });
        warn('Netflix itemIndex diagnostic', {
            stage,
            totalCount,
            columns,
            slotCount: slots.length,
            entries
        });
    }

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
            const host = document.querySelector?.(NETFLIX_DOM_SELECTORS.browseSections);
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
                const host = document.querySelector?.(NETFLIX_DOM_SELECTORS.browseSections);
                const section = host ? findMyListSection() : null;
                const bindingChanged = bindTargetDocumentObserver(host, section);
                relevantMutation = bindingChanged || hostChanged || sectionChanged;
            } else if (hostDiscoveryChanged) {
                const host = document.querySelector?.(NETFLIX_DOM_SELECTORS.browseSections);
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
        const host = document.querySelector?.(NETFLIX_DOM_SELECTORS.browseSections);
        return bindTargetDocumentObserver(host, host ? findMyListSection() : null);
    }

    return Object.freeze({ startDiscovery, stopDiscovery, refreshDiscovery, bind, clearBinding, borrowBinding, isBindingCurrent, assertBinding,
        currentBinding: () => acceptedBinding,
        whenNavigationIdle: navigation.whenIdle,
        suppressMotion: navigation.suppress, restoreMotion: navigation.restoreMotion,
        movePage: navigation.move, navigateTo: navigation.navigate, stablePage: navigation.stable,
        pageKeys: navigation.pageKeys,
        restorePage(section, scroller, track, items, slots, page, options = {}) {
            return options.mode === 'strict'
                ? navigation.restoreStrict(section, scroller, track, items, slots, page, options.sessionToken ?? null)
                : navigation.restoreFast(section, scroller, track, items, slots, page,
                    options.canonicalTransform || '', options.sessionToken ?? null);
        },
        mountedBootstrap: collection.mountedBootstrap, anchorPageZero, visibleVideoIds: currentPageVideoIds,
        resolveCard, mountedCard, isSourceCurrent, assertSource,
        refreshMapping, isMappingCurrent, assertMapping,
        collect: options => options.mode === 'mounted-single-page' ? collection.collectMounted(options) : collection.collect(options),
        resetSource() { clearBinding(); collection.resetDiagnostics(); models = new WeakMap(); nativeReadScope = null; },
        model: getCarouselDomRuntime, resetModel: resetCarouselDomRuntime,
        profile: detectCarouselDomProfile,
        registerPage: registerLogicalPageSignature, forcePage: forceLogicalPageSignature, normalizePages: normalizeLogicalPages,
        notePage: (section, page, cycle = null) => modelForWrite(section)?.notePage(page, cycle),
        beginCollection: section => modelForWrite(section)?.beginCollection(),
        markCycle: section => modelForWrite(section)?.markCycle(),
        completeCollection: (section, pages) => modelForWrite(section)?.finishCollection(pages),
        prepareSource, acceptCollection, isPreparationCurrent, assertPreparation,
        observeSource, pageCards, assertObservation, isObservationCurrent,
        anchorAfterDelta: (section, facts) => modelForWrite(section)?.anchor(facts),
        markMappingStale: section => modelForWrite(section)?.markStale(),
        deferMapping: section => modelForWrite(section)?.deferMapping(),
        commitMapping(section, facts) { resetCarouselDomRuntime(section); getModel(section)?.commit(facts); },
        sample: withNativeReadScope, invalidateReads: invalidateNativeReadScope, rect: nativeRect,
        filledSlots: nativeFilledSlots, indicators: nativeIndicatorItems, currentSlots: currentPageSlots,
        signatureOf: visibleSignature, visiblePageSignature: logicalVisibleSignature,
        selectedPage, pageCount, navigationControl: carouselMoveButton, controlDisabled: carouselMoveButtonDisabled,
        readiness: nativeCarouselReadiness, ready: waitForNativeCarouselReady, waitForSource: waitForNativeSource,
        layout: measureVisibleLayout, emptyLayout: measureEmptyLayout, slotLayoutFormula: parseSlotLayoutFormula,
        observe: readNativeMyListDomState,
        itemIndex: netflixItemIndexFromSlot,
        positions: logicalSlotPositions, logicalWindow: nativeLogicalPageState, requireLogicalWindow: requireNativeLogicalPageState,
        expectedPageIndices: expectedLogicalIndicesForPage,
        pageForPositions: logicalPageFromSlotPositions, wrappedTail: wrappedTailLogicalPageInfo,
        wrappedTailForRebuild: wrappedTailLogicalPageForRebuild,
        diagnoseIndices: logVirtualRawIndexDiagnostic,
        diagnostics
    });
}
