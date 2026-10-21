import { listCount, graphqlSectionVideoIds, extractFreshMyListBootstrap, carouselArtworkVariables, firstVideoIdFromCarouselNode, videoIdFromGraphqlNode, firstGraphqlText, firstGraphqlImageUrl } from './protocol.js';

// Requests and continuations belong to this owner; public summaries carry no transport state.
export function createFreshCollection({ context, pageDom, location, fetch, performance, now,
    assertCurrent, isCancelled, createError, beginRequest, finishRequest, runChunks, inspection, log, warn,
    requestTimeoutMs, findMyListGraphqlEntry, observeSelectedRow }) {
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = requestTimeoutMs;
    const GRAPHQL_COLLECTION_PAGE_SIZE = 75, GRAPHQL_COLLECTION_MAX_PAGES = 8;
    const continuations = new WeakMap();
    function mountedIdentity() {
        const anchor = pageDom.readMyListAnchor(3);
        return { sectionId: anchor.sectionId || '', firstVideoId: anchor.videoIds[0] || '' };
    }

    function assertMountedIdentity(identity, sessionToken) {
        assertCurrent(sessionToken);
        const current = mountedIdentity();
        assertCurrent(sessionToken);
        if (identity.sectionId && current.sectionId !== identity.sectionId) {
            throw createError('FRESH_MY_LIST_SOURCE_CHANGED', 'fresh-my-list-carousel',
                'The mounted My List section changed during collection',
                { requestedSectionId: identity.sectionId, nativeSectionId: current.sectionId || null });
        }
    }

    async function fetchMyListCarouselPage(request, cursor, signal, sessionToken) {
        assertCurrent(sessionToken);
        const body = { ...request.body, variables: { ...request.body.variables, carouselAfterCursor: cursor } };
        const response = await fetch('https://web.prod.cloud.netflix.com/graphql', {
            method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
            headers: request.headers, body: JSON.stringify(body), signal
        });
        assertCurrent(sessionToken);
        if (!response.ok) {
            throw createError('FRESH_MY_LIST_CAROUSEL_HTTP_ERROR', 'fresh-my-list-carousel',
                'Netflix CarouselPage returned HTTP ' + response.status,
                { status: response.status, statusText: response.statusText, responseUrl: response.url });
        }
        const text = await response.text();
        assertCurrent(sessionToken);
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (error) {
            throw createError('FRESH_MY_LIST_CAROUSEL_PARSE_ERROR', 'fresh-my-list-carousel',
                'Netflix CarouselPage returned invalid JSON',
                { responseUrl: response.url, responseBytes: text.length, errorMessage: error?.message || String(error) });
        }
        const node = payload?.data?.node;
        const totalCount = listCount(node?.entities?.totalCount);
        if (node?.__typename !== 'PinotCarouselSection' || totalCount === null) {
            throw createError('FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE', 'fresh-my-list-carousel',
                'Could not read the current Netflix My List totalCount from CarouselPage', {
                    responseUrl: response.url, responseBytes: text.length, typename: node?.__typename || null,
                    graphqlErrors: Array.isArray(payload?.errors) ? payload.errors.map(item => item?.message || String(item)) : []
                });
        }
        const edges = Array.isArray(node?.entities?.edges) ? node.entities.edges : [];
        // Piggyback on the validated response; this neither fetches metadata nor
        // publishes it into Netflix's rendering store.
        inspection.recordResponse(edges, sessionToken);
        return {
            totalCount,
            edges,
            hasNextPage: Boolean(node?.entities?.pageInfo?.hasNextPage),
            endCursor: node?.entities?.pageInfo?.endCursor || null,
            responseUrl: response.url,
            responseBytes: text.length
        };
    }

    async function withFreshRequest(sessionToken, carousel, operation) {
        const fetchState = beginRequest(sessionToken);
        const started = performance.now();
        try {
            return await operation(fetchState.controller.signal, started);
        } catch (error) {
            // Route aborts must never become a timeout warning or start a fallback.
            assertCurrent(sessionToken);
            if (isCancelled(error) || (error?.code && error?.stage)) throw error;
            const aborted = error?.name === 'AbortError';
            const prefix = carousel ? 'FRESH_MY_LIST_CAROUSEL' : 'FRESH_MY_LIST_FETCH';
            const label = carousel ? 'Netflix CarouselPage' : 'Netflix My List refresh';
            throw createError(prefix + (aborted ? '_TIMEOUT' : '_FAILED'),
                carousel ? 'fresh-my-list-carousel' : 'fresh-my-list-fetch',
                aborted ? label + ' timed out after ' + FRESH_MY_LIST_FETCH_TIMEOUT_MS + ' ms'
                    : label + ' failed: ' + (error?.message || error),
                { timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                    errorName: error?.name || null, errorMessage: error?.message || String(error || '') });
        } finally {
            finishRequest(fetchState);
        }
    }

    async function fetchFreshMyListBootstrapViaCarousel(sessionToken = null, recoveredEntry = null, identity = mountedIdentity()) {
        assertCurrent(sessionToken);
        assertMountedIdentity(identity, sessionToken);
        const entry = recoveredEntry || findMyListGraphqlEntry();
        const rowId = entry?.value?._id;
        if (!rowId) {
            throw createError('FRESH_MY_LIST_CAROUSEL_ID_UNAVAILABLE', 'fresh-my-list-carousel',
                'Could not identify the current Netflix My List carousel id',
                { graphqlKey: entry?.key || null, detectionReason: entry?.reason || null });
        }
        const beforeRequest = observeSelectedRow(entry);
        const rowSelection = { selectionReason: entry.reason, requestedRowId: typeof rowId === 'string' ? rowId : null,
            requestedSectionId: beforeRequest.requestedSectionId ?? null, beforeRequest };
        assertCurrent(sessionToken);
        const request = {
            body: {
                operationName: 'CarouselPage',
                variables: {
                    rowId, ...carouselArtworkVariables(context.pageDirection()), carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                    carouselAfterCursor: null, eddEnabled: false, fetchHighResCards: false
                },
                extensions: { persistedQuery: { id: 'a4ec8877-bccc-49bd-930b-34eaa1d3b7e0', version: 102 } }
            },
            headers: {
                'content-type': 'application/json',
                'x-netflix.context.ui-flavor': 'akira',
                'x-netflix.context.operation-name': 'CarouselPage',
                'X-Netflix.Request.Originating.Url': location.href
            }
        };
        const { appVersion, locale } = context.listRequestContext();
        if (appVersion) request.headers['x-netflix.context.app-version'] = String(appVersion);
        if (locale) request.headers['x-netflix.context.locales'] = String(locale).toLowerCase();

        return withFreshRequest(sessionToken, true, async (signal, started) => {
            // Count and first-title bootstrap needs one page in every mode.
            // Keep its continuation for logical collection after native readiness.
            const page = await fetchMyListCarouselPage(request, null, signal, sessionToken);
            assertMountedIdentity(identity, sessionToken);
            const fresh = {
                mountedIdentity: identity,
                totalCount: page.totalCount,
                firstVideoId: firstVideoIdFromCarouselNode({ entities: { edges: page.edges } }),
                graphqlEdges: page.edges,
                graphqlPageCount: 1,
                graphqlHasNextPage: page.hasNextPage,
                graphqlEndCursor: page.endCursor,
                graphqlRequest: request
            };
            rowSelection.afterResponse = observeSelectedRow(entry);
            assertCurrent(sessionToken);
            const beforeId = rowSelection.beforeRequest.nativeSectionId, afterId = rowSelection.afterResponse.nativeSectionId;
            rowSelection.nativeSectionChanged = beforeId && afterId ? beforeId !== afterId : null;
            rowSelection.responseVideoIds = page.edges.slice(0, 3).map(edge => videoIdFromGraphqlNode(edge?.node)).filter(Boolean);
            const nativeFirst = rowSelection.afterResponse.nativeVideoIds?.[0];
            rowSelection.responseFirstMatchesNative = nativeFirst && fresh.firstVideoId ? nativeFirst === fresh.firstVideoId : null;
            log('Fresh Netflix My List carousel bootstrap fetched', {
                totalCount: fresh.totalCount, firstVideoId: fresh.firstVideoId || null,
                graphqlKey: entry?.key || null, rowSelection, responseUrl: page.responseUrl,
                responseBytes: page.responseBytes, elapsedMs: Math.round(performance.now() - started),
                operationName: 'CarouselPage', carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                graphqlPageCount: 1, graphqlEdgeCount: fresh.graphqlEdges.length,
                hasNextPage: fresh.graphqlHasNextPage
            });
            return fresh;
        });
    }

    async function collectFreshMyListCarouselItems(bootstrap, sessionToken = null) {
        assertMountedIdentity(bootstrap.mountedIdentity, sessionToken);
        if (!bootstrap?.graphqlHasNextPage) return bootstrap;
        return withFreshRequest(sessionToken, true, async (signal, started) => {
            const edges = [...bootstrap.graphqlEdges];
            const seenCursors = new Set();
            let cursor = bootstrap.graphqlEndCursor;
            let hasNextPage = true;
            let graphqlPageCount = bootstrap.graphqlPageCount;
            while (hasNextPage) {
                assertCurrent(sessionToken);
                if (graphqlPageCount >= GRAPHQL_COLLECTION_MAX_PAGES) {
                    throw createError('FRESH_MY_LIST_CAROUSEL_PAGE_LIMIT', 'fresh-my-list-carousel',
                        'Netflix CarouselPage exceeded the configured GraphQL page limit',
                        { totalCount: bootstrap.totalCount, graphqlPageCount, maxPages: GRAPHQL_COLLECTION_MAX_PAGES, edgeCount: edges.length });
                }
                if (!cursor || seenCursors.has(cursor)) {
                    throw createError('FRESH_MY_LIST_CAROUSEL_CURSOR_INVALID', 'fresh-my-list-carousel',
                        'Netflix CarouselPage returned a missing or repeated pagination cursor',
                        { graphqlPageCount, edgeCount: edges.length });
                }
                seenCursors.add(cursor);
                const page = await fetchMyListCarouselPage(bootstrap.graphqlRequest, cursor, signal, sessionToken);
                assertMountedIdentity(bootstrap.mountedIdentity, sessionToken);
                if (page.totalCount !== bootstrap.totalCount) {
                    throw createError('FRESH_MY_LIST_CAROUSEL_TOTAL_COUNT_UNAVAILABLE', 'fresh-my-list-carousel',
                        'Netflix CarouselPage returned inconsistent My List pagination data',
                        { responseUrl: page.responseUrl, totalCount: bootstrap.totalCount, nextTotalCount: page.totalCount });
                }
                edges.push(...page.edges);
                graphqlPageCount++;
                hasNextPage = page.hasNextPage;
                cursor = page.endCursor;
            }
            assertCurrent(sessionToken);
            log('Fresh Netflix My List logical collection fetched', {
                totalCount: bootstrap.totalCount, graphqlPageCount, graphqlEdgeCount: edges.length,
                elapsedMs: Math.round(performance.now() - started)
            });
            return {
                ...bootstrap, graphqlEdges: edges, graphqlPageCount,
                graphqlHasNextPage: false, graphqlEndCursor: cursor, graphqlRequest: null
            };
        });
    }

    async function fetchFreshMyListBootstrapViaPage(sessionToken = null) {
        assertCurrent(sessionToken);
        const requestUrl = new URL('/browse/my-list', location.origin);
        requestUrl.searchParams.set('_tm_legacy_mylist_refresh', `${now()}-${sessionToken ?? 0}`);
        return withFreshRequest(sessionToken, false, async (signal, started) => {
            const response = await fetch(requestUrl.href, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                signal
            });
            assertCurrent(sessionToken);
            if (!response.ok) {
                throw createError(
                    'FRESH_MY_LIST_HTTP_ERROR',
                    'fresh-my-list-fetch',
                    `Netflix My List refresh returned HTTP ${response.status}`,
                    { status: response.status, statusText: response.statusText, responseUrl: response.url }
                );
            }

            const html = await response.text();
            assertCurrent(sessionToken);
            const fresh = extractFreshMyListBootstrap(html);
            if (!fresh || !Number.isFinite(fresh.totalCount) || fresh.totalCount < 0) {
                throw createError(
                    'FRESH_MY_LIST_TOTAL_COUNT_UNAVAILABLE',
                    'fresh-my-list-parse',
                    'Could not read the current Netflix My List totalCount from the fresh page response',
                    { responseUrl: response.url, responseBytes: html.length }
                );
            }

            log('Fresh Netflix My List bootstrap fetched', {
                totalCount: fresh.totalCount,
                firstVideoId: fresh.firstVideoId || null,
                responseUrl: response.url,
                responseBytes: html.length,
                elapsedMs: Math.round(performance.now() - started),
                cacheMode: 'no-store',
                fallback: true
            });
            return fresh;
        });
    }

    async function fetchFreshMyListBootstrap(sessionToken = null) {
        assertCurrent(sessionToken);
        try {
            const fresh = await fetchFreshMyListBootstrapViaCarousel(sessionToken);
            assertCurrent(sessionToken);
            return fresh;
        } catch (error) {
            assertCurrent(sessionToken);
            if (isCancelled(error)) throw error;
            warn('Fresh Netflix My List carousel fetch failed; falling back to page bootstrap', {
                code: error?.code || null,
                stage: error?.stage || null,
                message: error?.message || String(error || '')
            });
            const identity = mountedIdentity();
            const fresh = await fetchFreshMyListBootstrapViaPage(sessionToken);
            assertMountedIdentity(identity, sessionToken);
            if (fresh.entry) {
                const firstVideoId = [...graphqlSectionVideoIds(fresh.entry.value)][0] || fresh.firstVideoId;
                const firstMatches = !identity.firstVideoId || firstVideoId === identity.firstVideoId;
                log('Fresh My List row metadata recovery', { available: true, firstMatches,
                    requestedSectionId: fresh.entry.value.id || null, nativeSectionId: identity.sectionId || null });
                if (firstMatches) {
                    try { return await fetchFreshMyListBootstrapViaCarousel(sessionToken, fresh.entry, identity); }
                    catch (recoveryError) {
                        assertCurrent(sessionToken);
                        if (isCancelled(recoveryError)) throw recoveryError;
                        warn('Fresh My List row metadata recovery failed', { code: recoveryError?.code || null });
                    }
                }
            } else log('Fresh My List row metadata recovery', { available: false, reason: fresh.rowMetadataReason });
            return fresh;
        }
    }

    function summarize(fresh, sessionToken) {
        const graphql = Array.isArray(fresh.graphqlEdges);
        const snapshot = Object.freeze({ totalCount: fresh.totalCount, firstVideoId: fresh.firstVideoId,
            source: graphql ? 'graphql' : 'page', ...(graphql ? { pageCount: fresh.graphqlPageCount,
                edgeCount: fresh.graphqlEdges.length, hasMore: fresh.graphqlHasNextPage } : {}) });
        if (graphql) continuations.set(snapshot, { fresh, sessionToken });
        return snapshot;
    }

    async function normalizeRecords(edges, totalCount, sessionToken) {
        const records = [], seen = new Set();
        const complete = await runChunks(edges.length, index => {
            const node = edges[index]?.node;
            const videoId = videoIdFromGraphqlNode(node);
            if (!videoId || seen.has(videoId)) return;
            records.push({ href: location.origin + '/browse?jbv=' + encodeURIComponent(videoId), videoId,
                ariaLabel: firstGraphqlText(node?.displayString) || firstGraphqlText(node) || 'Netflix ' + videoId,
                imageUrl: firstGraphqlImageUrl(node?.contextualArtwork) || firstGraphqlImageUrl(node) });
            seen.add(videoId);
        }, () => assertCurrent(sessionToken));
        assertCurrent(sessionToken);
        return complete && records.length === totalCount ? records : null;
    }

    async function fetchBootstrap(sessionToken = null) {
        const fresh = await fetchFreshMyListBootstrap(sessionToken);
        assertCurrent(sessionToken);
        return summarize(fresh, sessionToken);
    }

    async function collectRecords({ bootstrap, totalCount, sessionToken = null }) {
        let current = bootstrap;
        try {
            assertCurrent(sessionToken);
            const retained = continuations.get(bootstrap);
            if (retained) assertCurrent(retained.sessionToken);
            let fresh = retained?.fresh;
            if (!fresh) {
                fresh = await fetchFreshMyListBootstrapViaCarousel(sessionToken);
                current = summarize(fresh, sessionToken);
            }
            assertCurrent(sessionToken);
            if (fresh.totalCount !== totalCount) return { bootstrap: current, records: null };
            const collected = await collectFreshMyListCarouselItems(fresh, sessionToken);
            assertCurrent(sessionToken);
            if (collected !== fresh) current = summarize(collected, sessionToken);
            const records = await normalizeRecords(collected.graphqlEdges, totalCount, sessionToken);
            assertMountedIdentity(collected.mountedIdentity, sessionToken);
            return { bootstrap: current, records };
        } catch (error) {
            assertCurrent(sessionToken);
            if (isCancelled(error)) throw error;
            return { bootstrap: current, records: null, error };
        }
    }


    return Object.freeze({ fetchBootstrap, collectRecords });
}
