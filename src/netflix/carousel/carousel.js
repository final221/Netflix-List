import { createPageModel, normalizeNetflixLogicalIndex, expectedLogicalIndicesForPage,
    logicalPageFromSlotPositions, wrappedTailLogicalPageInfo, wrappedTailLogicalPageForRebuild } from './page-model.js';
import { NETFLIX_DOM_SELECTORS as DEFAULT_SELECTORS } from '../page-dom.js';
import { createNavigation } from './navigation.js';
import { createCollection } from './collection.js';
import { GRID_ID as DEFAULT_GRID_ID, STATUS_ID as DEFAULT_STATUS_ID, LEGACY_EMPTY_STATE_ID as DEFAULT_EMPTY_ID,
    ORDER_MISMATCH_DIALOG_ID as DEFAULT_DIALOG_ID, SYNTHETIC_SECTION_ID, ORIGINAL_HIDDEN_CLASS, ORIGINAL_VISIBILITY_ATTR,
    FAST_MOVE_CLASS } from '../../dom-names.js';

// Native binding and mapping are owned here. Composition supplies interpreted
// membership shape and lifecycle operations, never a mutable feature state bag.
export function createCarousel({ pageDom: netflixDom, scope, document, window, Element, getComputedStyle,
    performance, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame,
    readListShape = () => null, readGraphqlCount = () => null, createError: initializationError,
    log = () => {}, warn = () => {}, trace = () => {}, tLog = value => value, logTimeout: logOperationTimeout = () => {},
    describeSlot: slotDescriptor = () => ({}), ownedUi = {}, MutationObserver,
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
    async function resolveCard({ section, scroller, track, item, expectedPage, totalCount, columns = 1,
        pageItemCount = 1, hoverToken = null, sessionToken = null }) {
        assertRouteSession(sessionToken);
        if (isHoverCancelled(hoverToken)) return Object.freeze({ status: 'unknown', reason: 'hover-cancelled' });
        if (!section?.isConnected || !scroller?.isConnected || !track?.isConnected) {
            return Object.freeze({ status: 'unknown', reason: 'native-binding-unavailable' });
        }
        const binding = borrowBinding(section, scroller, track);
        const model = getModel(section), mappingGeneration = model.mappingGeneration;
        const guard = () => {
            assertRouteSession(sessionToken); assertBinding(binding);
            if (models.get(section) !== model || model.mappingGeneration !== mappingGeneration) {
                throw initializationError('NATIVE_SOURCE_REPLACED', 'native-resolution', 'Native page mapping changed during source resolution');
            }
        };
        guard();
        const target = Object.freeze({ href: String(item?.href || ''), videoId: String(item?.videoId || '') });
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
        collection.reset(); navigation.reset();
        bindingGeneration++; invalidateNativeReadScope();
        if (section) models.delete(section);
        acceptedBinding = borrowBinding(section, scroller, track);
        return acceptedBinding;
    }
    function clearBinding() { collection.reset(); navigation.reset(); bindingGeneration++; acceptedBinding = null; invalidateNativeReadScope(); }
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

        while (performance.now() - started < NATIVE_READY_TIMEOUT_MS) {
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
                assertRouteSession(sessionToken);
                await new Promise(resolve => requestAnimationFrame(resolve));
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
                    return result;
                }
                lastSignature = confirmed.signature;
                stableSince = performance.now();
                lastState = confirmed;
            }

            await sleep(NATIVE_READY_POLL_MS);
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
        warn(tLog('nativeCarouselInitializationIsStillIncompleteInitializationDeferred'), result);
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

    function requireNativeReactCarouselTotalCount(scroller, track, provisionalTotalCount = null) {
        const state = nativeReactCarouselTotalCount(scroller, track);
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
        resolveCard, isSourceCurrent, assertSource, viewportSlots: viewportPageSlots,
        collect: options => options.mode === 'mounted-single-page' ? collection.collectMounted(options) : collection.collect(options),
        resetSource() { clearBinding(); collection.resetDiagnostics(); models = new WeakMap(); nativeReadScope = null; },
        model: getCarouselDomRuntime, resetModel: resetCarouselDomRuntime,
        profile: detectCarouselDomProfile, profileSummary: carouselDomProfileSummary, logProfile: logCarouselDomProfile,
        registerPage: registerLogicalPageSignature, forcePage: forceLogicalPageSignature, normalizePages: normalizeLogicalPages,
        notePage: (section, page, cycle = null) => modelForWrite(section)?.notePage(page, cycle),
        beginCollection: section => modelForWrite(section)?.beginCollection(),
        markCycle: section => modelForWrite(section)?.markCycle(),
        completeCollection: (section, pages) => modelForWrite(section)?.finishCollection(pages),
        confirmPageCount: (section, pages) => modelForWrite(section)?.confirmCount(pages),
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
        observe: readNativeMyListDomState, readCount: nativeReactCarouselTotalCount, requireCount: requireNativeReactCarouselTotalCount,
        itemIndex: netflixItemIndexFromSlot, indexReading: slot => netflixReactCarousel.readItemIndex(slot),
        positions: logicalSlotPositions, logicalWindow: nativeLogicalPageState, requireLogicalWindow: requireNativeLogicalPageState,
        logicalIndex: normalizeNetflixLogicalIndex, expectedPageIndices: expectedLogicalIndicesForPage,
        pageForPositions: logicalPageFromSlotPositions, wrappedTail: wrappedTailLogicalPageInfo,
        wrappedTailForRebuild: wrappedTailLogicalPageForRebuild,
        diagnoseIndices: logVirtualRawIndexDiagnostic,
        diagnostics: () => ({ bindingGeneration, readScopeActive: Boolean(nativeReadScope), navigation: navigation.diagnostics(),
            collection: collection.diagnostics(), collectionOperations: collection.pending(),
            discoveryActive: Boolean(targetDocumentObserver), pendingMutationFrame: targetMutationFrame !== null })
    });
}
