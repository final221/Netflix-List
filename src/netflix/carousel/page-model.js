// Private implementation of the carousel capability. Other features use carousel.js.
export function createPageModel(profile) {
    const state = { profile, currentPage: 0, knownPageCount: null, pageCountFinalized: false,
        cycleDetected: false, pageMappingStale: false, logicalRemapRetryCount: 0 };
    let signatureToPage = new Map();
    let pageToSignature = new Map();
    let profileLogSignature = '';
    const readMap = read => Object.freeze({
        get size() { return read().size; }, get: key => read().get(key), has: key => read().has(key),
        values: () => read().values(), entries: () => read().entries(), keys: () => read().keys(),
        [Symbol.iterator]: () => read()[Symbol.iterator]()
    });
    const view = {};
    for (const key of Object.keys(state)) Object.defineProperty(view, key, { enumerable: true, get: () => state[key] });
    Object.defineProperties(view, {
        signatureToPage: { enumerable: true, value: readMap(() => signatureToPage) },
        pageToSignature: { enumerable: true, value: readMap(() => pageToSignature) }
    });
    Object.freeze(view);
    function register(signature, page = null) {
        if (!signature) return null;
        if (signatureToPage.has(signature)) {
            state.currentPage = signatureToPage.get(signature);
            return state.currentPage;
        }
        const resolvedPage = Number.isFinite(page) ? Math.max(0, page) : Math.max(0, state.currentPage);
        const previousSignature = pageToSignature.get(resolvedPage);
        if (previousSignature && previousSignature !== signature) signatureToPage.delete(previousSignature);
        signatureToPage.set(signature, resolvedPage);
        pageToSignature.set(resolvedPage, signature);
        state.currentPage = resolvedPage;
        return resolvedPage;
    }
    function force(signature, page) {
        if (!signature || !Number.isFinite(page)) return null;
        const resolvedPage = Math.max(0, Math.floor(page));
        const oldPage = signatureToPage.get(signature);
        if (Number.isFinite(oldPage) && oldPage !== resolvedPage && pageToSignature.get(oldPage) === signature) pageToSignature.delete(oldPage);
        const oldSignature = pageToSignature.get(resolvedPage);
        if (oldSignature && oldSignature !== signature) signatureToPage.delete(oldSignature);
        signatureToPage.set(signature, resolvedPage);
        pageToSignature.set(resolvedPage, signature);
        state.currentPage = resolvedPage;
        return resolvedPage;
    }
    return Object.freeze({ view,
        updateProfile(value) { state.profile = value; }, register, force,
        normalize() {
            const pages = [...signatureToPage.values()].filter(Number.isFinite);
            if (!pages.length) return 0;
            const minimum = Math.min(...pages);
            if (minimum === 0) return 0;
            signatureToPage = new Map([...signatureToPage].map(([signature, page]) => [signature, page - minimum]));
            pageToSignature = new Map([...signatureToPage].map(([signature, page]) => [page, signature]));
            state.currentPage = Math.max(0, state.currentPage - minimum);
            return -minimum;
        },
        notePage(page, cycleDetected = null) {
            state.currentPage = page;
            if (cycleDetected !== null) state.cycleDetected = cycleDetected;
        },
        beginCollection() { state.pageCountFinalized = false; state.cycleDetected = false; },
        markCycle() { state.cycleDetected = true; },
        confirmCount(pages) { state.knownPageCount = pages; state.pageCountFinalized = true; },
        finishCollection(pages) {
            state.knownPageCount = pages; state.pageCountFinalized = true;
            state.pageMappingStale = false; state.cycleDetected = false;
        },
        anchor({ pageCount, currentPage, signature }) {
            signatureToPage.clear(); pageToSignature.clear();
            state.knownPageCount = pageCount; state.pageCountFinalized = true;
            state.cycleDetected = false; state.pageMappingStale = true; state.currentPage = currentPage;
            if (signature) register(signature, currentPage);
        },
        markStale() { state.pageMappingStale = true; },
        deferMapping() { return ++state.logicalRemapRetryCount; },
        commit({ pageCount, currentPage, signature }) {
            state.knownPageCount = pageCount; state.pageCountFinalized = true;
            state.cycleDetected = false; state.pageMappingStale = false; state.logicalRemapRetryCount = 0;
            state.currentPage = currentPage; force(signature, currentPage);
        },
        shouldLog(signature) {
            if (signature === profileLogSignature) return false;
            profileLogSignature = signature; return true;
        }
    });
}

export function normalizeNetflixLogicalIndex(itemIndex, totalCount) {
    if (!Number.isSafeInteger(itemIndex) || !Number.isFinite(totalCount) || totalCount <= 0) return null;
    if (itemIndex < 0 || itemIndex >= totalCount) return null;
    return itemIndex;
}

export function expectedLogicalIndicesForPage(totalCount, columns, page) {
    const count = Math.max(0, Math.floor(totalCount));
    const width = Math.max(1, Math.floor(columns));
    if (count <= 0) return [];
    const pages = Math.max(1, Math.ceil(count / width));
    const normalizedPage = Math.max(0, Math.min(pages - 1, Math.floor(page)));
    const visibleCount = Math.min(width, count);
    let start = normalizedPage * width;
    if (pages > 1 && normalizedPage === pages - 1 && count % width !== 0) {
        start = Math.max(0, count - width);
    }
    return Array.from({ length: visibleCount }, (_, index) => start + index);
}

export function logicalPageFromSlotPositions(positions, totalCount, columns) {
    if (!positions.length || positions.some(position => !Number.isSafeInteger(position.logicalIndex))) return null;
    const actual = [...new Set(positions.map(position => position.logicalIndex))].sort((a, b) => a - b);
    if (actual.length !== positions.length) return null;
    const width = Math.max(1, Math.floor(columns));
    const pages = Math.max(1, Math.ceil(totalCount / width));
    // A full window starts at a page boundary, except the overlapping last
    // page. Still require exact membership; never accept partial hydration.
    const candidates = [...new Set([Math.floor(actual[0] / width), pages - 1])].sort((a, b) => a - b);
    for (const page of candidates) {
        if (page < 0 || page >= pages) continue;
        const expected = expectedLogicalIndicesForPage(totalCount, columns, page);
        if (expected.length !== actual.length) continue;
        if (expected.every((value, index) => value === actual[index])) return page;
    }
    return null;
}

export function wrappedTailLogicalPageInfo(positions, totalCount, columns) {
    const count = Math.max(0, Math.floor(totalCount));
    const width = Math.max(1, Math.floor(columns));
    if (count <= 1 || count % width === 0 || !positions.length) return null;

    const expectedVisibleCount = Math.min(width, count);
    if (positions.length !== expectedVisibleCount) return null;

    const itemIndices = positions.map(position => position.itemIndex);
    if (!itemIndices.every(index => Number.isSafeInteger(index) && index >= 0 && index < count)) return null;
    if (new Set(itemIndices).size !== itemIndices.length) return null;

    let wrapIndex = -1;
    for (let index = 1; index < itemIndices.length; index++) {
        const previous = itemIndices[index - 1];
        const current = itemIndices[index];
        if (current !== (previous + 1) % count) return null;
        if (previous === count - 1 && current === 0) {
            if (wrapIndex !== -1) return null;
            wrapIndex = index;
        }
    }
    if (wrapIndex <= 0 || !itemIndices.includes(count - 1)) return null;

    const pages = Math.max(1, Math.ceil(count / width));
    const lastPage = pages - 1;
    const expectedTail = new Set(expectedLogicalIndicesForPage(count, width, lastPage));
    if (!itemIndices.slice(0, wrapIndex).every(index => expectedTail.has(index))) return null;

    return { page: lastPage, wrapIndex, itemIndices };
}

export function wrappedTailLogicalPageForRebuild(positions, totalCount, columns, previousRuntime) {
    const info = wrappedTailLogicalPageInfo(positions, totalCount, columns);
    if (!info) return null;

    const pages = Math.max(1, Math.ceil(Math.max(0, Math.floor(totalCount)) / Math.max(1, Math.floor(columns))));
    const previousCurrentPage = Number.isFinite(previousRuntime?.currentPage)
        ? Math.max(0, Math.floor(previousRuntime.currentPage))
        : null;
    const previousKnownPageCount = previousRuntime?.pageCountFinalized && Number.isFinite(previousRuntime?.knownPageCount)
        ? Math.max(1, Math.floor(previousRuntime.knownPageCount))
        : null;

    const wasAtCompatibleTail = previousCurrentPage === info.page || (
        previousKnownPageCount !== null &&
        previousCurrentPage === previousKnownPageCount - 1 &&
        (previousKnownPageCount === pages || previousKnownPageCount === pages + 1)
    );
    return wasAtCompatibleTail ? info : null;
}
