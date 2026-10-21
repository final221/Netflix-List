import { createFreshCollection } from './list-data/fresh-collection.js';
import { listCount, isMyListGraphqlSection, graphqlSectionVideoIds, videoIdFromGraphqlNode } from './list-data/protocol.js';
// Protocol state stays private; callers receive count/provenance and normalized title records.
export function createListData({ context, pageDom, location, fetch, performance, now = () => Date.now(),
    assertCurrent, isCancelled, createError, beginRequest, finishRequest, runChunks, inspection, log, warn, tLog,
    requestTimeoutMs = 10000 }) {
    const graphqlData = context.readGraphqlBootstrap;
    let myListGraphqlKey = null;
    function graphqlCarouselCandidates(data) {
        return Object.entries(data || {}).filter(([, value]) =>
            value &&
            value.__typename === 'PinotCarouselSection' &&
            value.entities &&
            listCount(value.entities.totalCount) !== null
        );
    }

    function findMyListGraphqlEntry() {
        const data = graphqlData();
        if (!data) return null;

        const anchor = pageDom.readMyListAnchor();
        const candidates = graphqlCarouselCandidates(data);
        if (anchor.sectionId) {
            const matched = candidates.find(([, value]) => String(value.id || '') === anchor.sectionId);
            myListGraphqlKey = matched?.[0] || null;
            return matched ? { key: matched[0], value: matched[1], reason: 'native-section-id' } : null;
        }

        if (myListGraphqlKey) {
            const cached = data[myListGraphqlKey];
            if (cached && cached.__typename === 'PinotCarouselSection' &&
                listCount(cached.entities?.totalCount) !== null) {
                return { key: myListGraphqlKey, value: cached, reason: 'cached-key' };
            }
            myListGraphqlKey = null;
        }

        for (const [key, value] of candidates) {
            if (!isMyListGraphqlSection(value)) continue;
            myListGraphqlKey = key;
            return { key, value, reason: 'playlist-event-listeners' };
        }

        if (anchor.videoIds.length) {
            const domIds = new Set(anchor.videoIds);
            if (domIds.size) {
                let best = null;
                let bestOverlap = 0;
                for (const [key, value] of candidates) {
                    const ids = graphqlSectionVideoIds(value);
                    let overlap = 0;
                    for (const id of ids) if (domIds.has(id)) overlap++;
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        best = { key, value };
                    }
                }
                if (best && bestOverlap >= Math.min(2, domIds.size)) {
                    myListGraphqlKey = best.key;
                    return { ...best, reason: 'native-card-overlap', overlap: bestOverlap };
                }
            }
        }
        return null;
    }

    // Passive bounded facts only; a diagnostic failure cannot select a row or a fallback.
    function observeSelectedRow(entry) {
        try {
            const anchor = pageDom.readMyListAnchor(3);
            const nativeSectionId = anchor.sectionId || null;
            const requestedSectionId = String(entry?.value?.id || '') || null;
            const nativeRow = nativeSectionId ? graphqlCarouselCandidates(graphqlData())
                .find(([, value]) => String(value.id || '') === nativeSectionId)?.[1] : null;
            const selectedVideoIds = [...graphqlSectionVideoIds({ entities: {
                edges: (entry?.value?.entities?.edges || []).slice(0, 3) } })];
            return { available: Boolean(nativeSectionId), nativeSectionId, requestedSectionId,
                sectionIdMatches: nativeSectionId && requestedSectionId ? nativeSectionId === requestedSectionId : null,
                selectedCachedCount: listCount(entry?.value?.entities?.totalCount),
                nativeRowCachedCount: listCount(nativeRow?.entities?.totalCount),
                selectedVideoIds, nativeVideoIds: anchor.videoIds.slice(0, 3) };
        } catch (_) { return { available: false, reason: 'observation-failed' }; }
    }

    const pageFacts = Object.freeze({
        readMembership(videoId) {
            try {
                const entry = findMyListGraphqlEntry(), entities = entry?.value?.entities;
                if (!entities || !Array.isArray(entities.edges)) return null;
                const count = listCount(entities.totalCount), ids = new Set();
                for (const edge of entities.edges) {
                    const reference = String(edge?.node?.__ref || '').match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
                    const id = reference?.[1] || videoIdFromGraphqlNode(edge?.node);
                    if (id) ids.add(id);
                }
                if (ids.has(String(videoId))) return true;
                return count !== null && ids.size === count && entities.edges.length === count &&
                    entities.pageInfo?.hasNextPage !== true ? false : null;
            } catch (_) { return null; }
        },
        isAvailable() {
            return Boolean(graphqlData());
        },

        myListDomIdentity() {
            const entry = findMyListGraphqlEntry();
            return {
                sectionId: String(entry?.value?.id || ''),
                videoIds: [...graphqlSectionVideoIds(entry?.value)]
            };
        },

        readMyListTotalCount() {
            try {
                return listCount(findMyListGraphqlEntry()?.value?.entities?.totalCount);
            } catch (_) {
                return null;
            }
        },

        detectMyListTotalCount() {
            const entry = findMyListGraphqlEntry();
            const count = listCount(entry?.value?.entities?.totalCount);
            if (count === null) return null;
            log(tLog('totalCountDetected'), {
                totalCount: count,
                graphqlKey: entry?.key || null,
                detectionReason: entry?.reason || null
            });
            return count;
        },

        firstMyListVideoId() {
            const entry = findMyListGraphqlEntry();
            for (const edge of entry?.value?.entities?.edges || []) {
                const ref = String(edge?.node?.__ref || '');
                const match = ref.match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
                if (match) return match[1];
            }
            return '';
        },

    });

    const { fetchBootstrap, collectRecords } = createFreshCollection({ context, pageDom, location, fetch,
        performance, now, assertCurrent, isCancelled, createError, beginRequest, finishRequest, runChunks,
        inspection, log, warn, requestTimeoutMs, findMyListGraphqlEntry, observeSelectedRow });
    function reset() { myListGraphqlKey = null; }
    function diagnostics() { return { graphqlKey: myListGraphqlKey }; }
    return Object.freeze({ ...pageFacts, fetchBootstrap, collectRecords, reset, diagnostics });
}
