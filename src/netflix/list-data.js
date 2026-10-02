// Protocol state stays private; callers receive count/provenance and normalized title records.
export function createListData({ context, pageDom, location, fetch, performance, now = () => Date.now(),
    assertCurrent, isCancelled, createError, beginRequest, finishRequest, runChunks, inspection, log, warn, tLog,
    requestTimeoutMs = 10000 }) {
    const FRESH_MY_LIST_FETCH_TIMEOUT_MS = requestTimeoutMs;
    const GRAPHQL_COLLECTION_PAGE_SIZE = 75;
    const GRAPHQL_COLLECTION_MAX_PAGES = 8;
    const graphqlData = context.readGraphqlBootstrap;
    const continuations = new WeakMap();
    let myListGraphqlKey = null;
    function isMyListGraphqlSection(value) {
        if (!value || value.__typename !== 'PinotCarouselSection') return false;
        const listeners = Array.isArray(value.eventListeners) ? value.eventListeners : [];
        const types = new Set(listeners.map(listener => listener?.__typename).filter(Boolean));
        const hasPlaylistMutationListeners = types.has('PinotAddToPlaylistEventListener') &&
            types.has('PinotRemoveFromPlaylistEventListener');
        const hasPlaylistNotification = listeners.some(listener =>
            listener?.notificationMessageRegex === 'UPDATE_PLAYLIST'
        );
        return hasPlaylistMutationListeners || hasPlaylistNotification;
    }

    function graphqlCarouselCandidates(data) {
        return Object.entries(data || {}).filter(([, value]) =>
            value &&
            value.__typename === 'PinotCarouselSection' &&
            value.entities &&
            Number.isFinite(Number(value.entities.totalCount))
        );
    }

    function findMyListGraphqlEntry() {
        const data = graphqlData();
        if (!data) return null;

        if (myListGraphqlKey) {
            const cached = data[myListGraphqlKey];
            if (cached && cached.__typename === 'PinotCarouselSection' &&
                Number.isFinite(Number(cached.entities?.totalCount))) {
                return { key: myListGraphqlKey, value: cached, reason: 'cached-key' };
            }
            myListGraphqlKey = null;
        }

        const candidates = graphqlCarouselCandidates(data);
        for (const [key, value] of candidates) {
            if (!isMyListGraphqlSection(value)) continue;
            myListGraphqlKey = key;
            return { key, value, reason: 'playlist-event-listeners' };
        }

        // Generation 2 fallback: match the live My List row to the GraphQL section.
        // Do not rely on translated heading text or on the removed page indicators.
        const anchor = pageDom.readMyListAnchor();
        const domSectionId = anchor.sectionId;
        if (domSectionId) {
            const matched = candidates.find(([, value]) => String(value?.id || '') === domSectionId);
            if (matched) {
                myListGraphqlKey = matched[0];
                return { key: matched[0], value: matched[1], reason: 'native-section-id' };
            }
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

    function graphqlSectionVideoIds(value) {
        const ids = new Set();
        for (const edge of value?.entities?.edges || []) {
            const ref = String(edge?.node?.__ref || '');
            const match = ref.match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
            if (match) ids.add(match[1]);
        }
        return ids;
    }

    function extractFreshMyListBootstrap(html) {
        const text = String(html || '');
        const notificationMarker = '"notificationMessageRegex":"UPDATE_PLAYLIST"';
        const sectionMarker = '"__typename":"PinotCarouselSection"';
        let from = 0;

        while (from < text.length) {
            const notificationIndex = text.indexOf(notificationMarker, from);
            if (notificationIndex < 0) break;
            const sectionStart = text.lastIndexOf(sectionMarker, notificationIndex);
            if (sectionStart >= 0 && notificationIndex - sectionStart <= 50000) {
                const block = text.slice(sectionStart, notificationIndex + notificationMarker.length + 1024);
                const totalMatch = block.match(/"entities":\{"totalCount":(\d+)/);
                if (totalMatch) {
                    const firstVideoMatch = block.match(/standardBoxshot_Video:(\d+)/);
                    return {
                        totalCount: Number(totalMatch[1]),
                        firstVideoId: firstVideoMatch?.[1] || '',
                        sectionStart,
                        notificationIndex
                    };
                }
            }
            from = notificationIndex + notificationMarker.length;
        }
        return null;
    }

    function carouselArtworkVariables() {
        const standard = { width: 342, height: 192 };
        const standardHighRes = { width: 665, height: 375 };
        const formats = ['WEBP', 'JPG', 'PNG'];
        const dir = context.pageDirection();
        return {
            imageParamsForStandardBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { enableLockBadgeChecks: true, fallbackStrategy: 'STILL' }
            },
            imageParamsForStandardBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL', enableLockBadgeChecks: true }
            },
            imageParamsForPodcastEpisodicStill: {
                artworkType: 'SEGMENT_STILL',
                dimension: { ...standard, scaleStrategy: 'COVER' },
                features: { graybox: false }
            },
            imageParamsForPodcastEpisodicStillHighRes: {
                artworkType: 'SEGMENT_STILL',
                dimension: { ...standardHighRes, scaleStrategy: 'COVER' },
                features: { graybox: false }
            },
            imageParamsForPodcastEpisodicLogo: {
                artworkType: 'LOGO_HORIZONTAL_CROPPED',
                dimension: { width: 800, height: 126, scaleStrategy: 'CONTAIN' },
                features: { tone: 'LIGHT' }
            },
            imageParamsForRankedBoxart: {
                artworkType: 'BOXSHOT',
                dimension: { width: 426, height: 607 },
                features: { fallbackStrategy: 'STILL', suppressTop10Badge: true }
            },
            imageParamsForContinueWatchingBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForContinueWatchingBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForCloudGameBoxart: {
                artworkType: 'SDP',
                dimension: standard,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForCloudGameBoxartHighRes: {
                artworkType: 'SDP',
                dimension: standardHighRes,
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForMobileGameBoxart: {
                artworkType: 'APP_ICON',
                dimension: { width: 200, height: 200 },
                formats
            },
            imageParamsForCharacterCircle: {
                artworkType: 'SQUAREHEADSHOT_1000x1000',
                dimension: { width: 200, height: 200 },
                formats
            },
            imageParamsForChannel: {
                artworkType: dir === 'rtl' ? 'CHANNEL_TILE_BACKGROUND_RTL' : 'CHANNEL_TILE_BACKGROUND',
                dimension: standard,
                formats
            },
            imageParamsForChannelLogo: {
                artworkType: 'CHANNEL_LOGO_COLOR_CROPPED',
                dimension: { height: 44 },
                formats: ['WEBP', 'PNG']
            },
            imageParamsForEntryPointBackground: {
                artworkType: dir === 'rtl' ? 'MLP_ENTRY_POINT_BACKGROUND_RTL' : 'MLP_ENTRY_POINT_BACKGROUND',
                dimension: { width: 1024 },
                features: { fallbackStrategy: 'STILL' }
            },
            imageParamsForEntryPointLogo: {
                artworkType: 'LOGO_STACKED_CROPPED',
                dimension: { height: 260 },
                formats
            }
        };
    }

    function firstVideoIdFromCarouselNode(node) {
        return videoIdFromGraphqlNode(node?.entities?.edges?.[0]?.node);
    }

    function videoIdFromGraphqlNode(node) {
        if (!node || typeof node !== 'object') return '';
        const seen = new Set();
        const stack = [node];
        while (stack.length) {
            const value = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value);
            const direct = value.videoId;
            if (Number.isFinite(Number(direct)) && Number(direct) > 0) return String(direct);
            const id = typeof value.id === 'string' ? value.id : '';
            const match = id.match(/(?:standardBoxshot_)?Video:(\d+)/);
            if (match) return match[1];
            for (const child of Object.values(value)) {
                if (child && typeof child === 'object') stack.push(child);
            }
        }
        return '';
    }

    function firstGraphqlText(value, depth = 0, seen = new Set()) {
        if (depth > 5 || value === null || value === undefined) return '';
        if (typeof value === 'string') {
            const text = value.trim();
            if (!text || /^https?:\/\//i.test(text) || text.length > 240) return '';
            return text;
        }
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        for (const key of ['text', 'value', 'title', 'name', 'label', 'displayString']) {
            const result = firstGraphqlText(value[key], depth + 1, seen);
            if (result) return result;
        }
        for (const child of Object.values(value)) {
            const result = firstGraphqlText(child, depth + 1, seen);
            if (result) return result;
        }
        return '';
    }

    function firstGraphqlImageUrl(value, depth = 0, seen = new Set()) {
        if (depth > 7 || value === null || value === undefined) return '';
        if (typeof value === 'string') {
            const text = value.trim();
            if (/^https?:\/\//i.test(text) && (/(?:\.webp|\.jpe?g|\.png)(?:[?#]|$)/i.test(text) || /nflxso\.net|nflximg\.net/i.test(text))) {
                return text;
            }
            return '';
        }
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        for (const key of ['url', 'imageUrl', 'artwork', 'image', 'src', 'uri']) {
            const result = firstGraphqlImageUrl(value[key], depth + 1, seen);
            if (result) return result;
        }
        for (const child of Object.values(value)) {
            const result = firstGraphqlImageUrl(child, depth + 1, seen);
            if (result) return result;
        }
        return '';
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
        const countValue = node?.entities?.totalCount;
        const totalCount = Number(countValue);
        const countPresent = typeof countValue === 'number' ||
            (typeof countValue === 'string' && countValue.trim() !== '');
        if (node?.__typename !== 'PinotCarouselSection' || !countPresent ||
            !Number.isSafeInteger(totalCount) || totalCount < 0) {
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

    function carouselFetchError(error, sessionToken) {
        // Route aborts must never become a timeout warning or start a fallback.
        assertCurrent(sessionToken);
        if (isCancelled(error) || (error?.code && error?.stage)) return error;
        const aborted = error?.name === 'AbortError';
        return createError(
            aborted ? 'FRESH_MY_LIST_CAROUSEL_TIMEOUT' : 'FRESH_MY_LIST_CAROUSEL_FAILED',
            'fresh-my-list-carousel',
            aborted
                ? 'Netflix CarouselPage timed out after ' + FRESH_MY_LIST_FETCH_TIMEOUT_MS + ' ms'
                : 'Netflix CarouselPage failed: ' + (error?.message || error),
            {
                timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                errorName: error?.name || null,
                errorMessage: error?.message || String(error || '')
            }
        );
    }

    async function fetchFreshMyListBootstrapViaCarousel(sessionToken = null) {
        assertCurrent(sessionToken);
        const entry = findMyListGraphqlEntry();
        const rowId = entry?.value?._id;
        if (!rowId) {
            throw createError('FRESH_MY_LIST_CAROUSEL_ID_UNAVAILABLE', 'fresh-my-list-carousel',
                'Could not identify the current Netflix My List carousel id',
                { graphqlKey: entry?.key || null, detectionReason: entry?.reason || null });
        }
        const request = {
            body: {
                operationName: 'CarouselPage',
                variables: {
                    rowId, ...carouselArtworkVariables(), carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
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

        const fetchState = beginRequest(sessionToken);
        const started = performance.now();
        try {
            // Count and first-title bootstrap needs one page in every mode.
            // Keep its continuation for logical collection after native readiness.
            const page = await fetchMyListCarouselPage(request, null, fetchState.controller.signal, sessionToken);
            assertCurrent(sessionToken);
            const fresh = {
                totalCount: page.totalCount,
                firstVideoId: firstVideoIdFromCarouselNode({ entities: { edges: page.edges } }),
                graphqlEdges: page.edges,
                graphqlPageCount: 1,
                graphqlHasNextPage: page.hasNextPage,
                graphqlEndCursor: page.endCursor,
                graphqlRequest: request
            };
            log('Fresh Netflix My List carousel bootstrap fetched', {
                totalCount: fresh.totalCount, firstVideoId: fresh.firstVideoId || null,
                graphqlKey: entry?.key || null, responseUrl: page.responseUrl,
                responseBytes: page.responseBytes, elapsedMs: Math.round(performance.now() - started),
                operationName: 'CarouselPage', carouselPageSize: GRAPHQL_COLLECTION_PAGE_SIZE,
                graphqlPageCount: 1, graphqlEdgeCount: fresh.graphqlEdges.length,
                hasNextPage: fresh.graphqlHasNextPage
            });
            return fresh;
        } catch (error) {
            throw carouselFetchError(error, sessionToken);
        } finally {
            finishRequest(fetchState);
        }
    }

    async function collectFreshMyListCarouselItems(bootstrap, sessionToken = null) {
        assertCurrent(sessionToken);
        if (!bootstrap?.graphqlHasNextPage) return bootstrap;
        const fetchState = beginRequest(sessionToken);
        const started = performance.now();
        try {
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
                const page = await fetchMyListCarouselPage(bootstrap.graphqlRequest, cursor, fetchState.controller.signal, sessionToken);
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
        } catch (error) {
            throw carouselFetchError(error, sessionToken);
        } finally {
            finishRequest(fetchState);
        }
    }

    async function fetchFreshMyListBootstrapViaPage(sessionToken = null) {
        assertCurrent(sessionToken);
        const requestUrl = new URL('/browse/my-list', location.origin);
        requestUrl.searchParams.set('_tm_legacy_mylist_refresh', `${now()}-${sessionToken ?? 0}`);
        const fetchState = beginRequest(sessionToken);
        const started = performance.now();

        try {
            const response = await fetch(requestUrl.href, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                signal: fetchState.controller.signal
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
        } catch (error) {
            assertCurrent(sessionToken);
            if (isCancelled(error)) throw error;
            if (error?.code && error?.stage) throw error;
            const aborted = error?.name === 'AbortError';
            throw createError(
                aborted ? 'FRESH_MY_LIST_FETCH_TIMEOUT' : 'FRESH_MY_LIST_FETCH_FAILED',
                'fresh-my-list-fetch',
                aborted
                    ? `Netflix My List refresh timed out after ${FRESH_MY_LIST_FETCH_TIMEOUT_MS} ms`
                    : `Netflix My List refresh failed: ${error?.message || error}`,
                {
                    timeoutMs: aborted ? FRESH_MY_LIST_FETCH_TIMEOUT_MS : null,
                    errorName: error?.name || null,
                    errorMessage: error?.message || String(error || '')
                }
            );
        } finally {
            finishRequest(fetchState);
        }
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
            return fetchFreshMyListBootstrapViaPage(sessionToken);
        }
    }

    const pageFacts = Object.freeze({
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
                const count = Number(findMyListGraphqlEntry()?.value?.entities?.totalCount);
                return Number.isFinite(count) && count >= 0 ? count : null;
            } catch (_) {
                return null;
            }
        },

        detectMyListTotalCount() {
            const entry = findMyListGraphqlEntry();
            const count = Number(entry?.value?.entities?.totalCount);
            if (!Number.isFinite(count) || count < 0) return null;
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
            return { bootstrap: current, records };
        } catch (error) {
            assertCurrent(sessionToken);
            if (isCancelled(error)) throw error;
            return { bootstrap: current, records: null, error };
        }
    }

    function reset() { myListGraphqlKey = null; }
    function diagnostics() { return { graphqlKey: myListGraphqlKey }; }
    return Object.freeze({ ...pageFacts, fetchBootstrap, collectRecords, reset, diagnostics });
}
