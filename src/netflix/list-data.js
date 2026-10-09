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
    function listCount(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
        const count = Number(value);
        return Number.isSafeInteger(count) && count >= 0 ? count : null;
    }
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

    function graphqlSectionVideoIds(value) {
        const ids = new Set();
        for (const edge of value?.entities?.edges || []) {
            const ref = String(edge?.node?.__ref || '');
            const match = ref.match(/(?:standardBoxshot_Video:|Video:)(\d+)/);
            if (match) ids.add(match[1]);
        }
        return ids;
    }

    function serializedSection(text, markerIndex) {
        const start = text.lastIndexOf('{', markerIndex);
        if (start < 0) return null;
        let depth = 0, quoted = false, escaped = false;
        for (let index = start; index < text.length; index++) {
            const char = text[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                try { return JSON.parse(text.slice(start, index + 1)); } catch (_) { return null; }
            }
        }
        return null;
    }

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
                const value = serializedSection(text, sectionStart);
                if (isMyListGraphqlSection(value) && listCount(value.entities?.totalCount) !== null) {
                    return { totalCount: listCount(value.entities.totalCount),
                        firstVideoId: [...graphqlSectionVideoIds(value)][0] || firstVideoIdFromCarouselNode(value),
                        rowMetadataReason: typeof value._id === 'string' && value._id ? 'usable-section' : 'opaque-id-unavailable',
                        entry: typeof value._id === 'string' && value._id
                            ? { key: null, value, reason: 'fresh-page-bootstrap' } : null };
                }
                const block = text.slice(sectionStart, notificationIndex + notificationMarker.length + 1024);
                const totalMatch = block.match(/"entities":\{"totalCount":(\d+)/);
                if (totalMatch) {
                    const firstVideoMatch = block.match(/standardBoxshot_Video:(\d+)/);
                    return {
                        rowMetadataReason: 'section-json-unavailable',
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
        const standard = { width: 342, height: 192 }, highRes = { width: 665, height: 375 };
        const formats = ['WEBP', 'JPG', 'PNG'], rtl = context.pageDirection() === 'rtl';
        const artwork = (artworkType, dimension, options) => ({ artworkType, dimension, ...options });
        const variables = {};
        const families = {
            StandardBoxart: ['SDP', { fallbackStrategy: 'STILL', enableLockBadgeChecks: true }],
            ContinueWatchingBoxart: ['SDP', { fallbackStrategy: 'STILL' }],
            CloudGameBoxart: ['SDP', { fallbackStrategy: 'STILL' }],
            PodcastEpisodicStill: ['SEGMENT_STILL', { graybox: false }, 'COVER']
        };
        for (const [family, [type, features, scaleStrategy]] of Object.entries(families)) {
            for (const [suffix, size] of [['', standard], ['HighRes', highRes]]) {
                variables['imageParamsFor' + family + suffix] = artwork(type,
                    scaleStrategy ? { ...size, scaleStrategy } : size, { features });
            }
        }
        return { ...variables,
            imageParamsForPodcastEpisodicLogo: artwork('LOGO_HORIZONTAL_CROPPED',
                { width: 800, height: 126, scaleStrategy: 'CONTAIN' }, { features: { tone: 'LIGHT' } }),
            imageParamsForRankedBoxart: artwork('BOXSHOT', { width: 426, height: 607 },
                { features: { fallbackStrategy: 'STILL', suppressTop10Badge: true } }),
            imageParamsForMobileGameBoxart: artwork('APP_ICON', { width: 200, height: 200 }, { formats }),
            imageParamsForCharacterCircle: artwork('SQUAREHEADSHOT_1000x1000', { width: 200, height: 200 }, { formats }),
            imageParamsForChannel: artwork(rtl ? 'CHANNEL_TILE_BACKGROUND_RTL' : 'CHANNEL_TILE_BACKGROUND', standard, { formats }),
            imageParamsForChannelLogo: artwork('CHANNEL_LOGO_COLOR_CROPPED', { height: 44 }, { formats: ['WEBP', 'PNG'] }),
            imageParamsForEntryPointBackground: artwork(rtl ? 'MLP_ENTRY_POINT_BACKGROUND_RTL' : 'MLP_ENTRY_POINT_BACKGROUND',
                { width: 1024 }, { features: { fallbackStrategy: 'STILL' } }),
            imageParamsForEntryPointLogo: artwork('LOGO_STACKED_CROPPED', { height: 260 }, { formats })
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

    function firstGraphqlString(value, keys, accepts, maxDepth, depth = 0, seen = new Set()) {
        if (depth > maxDepth || value == null) return '';
        if (typeof value === 'string') { const text = value.trim(); return accepts(text) ? text : ''; }
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        for (const key of keys) {
            const result = firstGraphqlString(value[key], keys, accepts, maxDepth, depth + 1, seen);
            if (result) return result;
        }
        for (const child of Object.values(value)) {
            const result = firstGraphqlString(child, keys, accepts, maxDepth, depth + 1, seen);
            if (result) return result;
        }
        return '';
    }
    function firstGraphqlText(value) {
        return firstGraphqlString(value, ['text', 'value', 'title', 'name', 'label', 'displayString'],
            text => Boolean(text) && !/^https?:\/\//i.test(text) && text.length <= 240, 5);
    }
    function firstGraphqlImageUrl(value) {
        return firstGraphqlString(value, ['url', 'imageUrl', 'artwork', 'image', 'src', 'uri'],
            text => /^https?:\/\//i.test(text) && (/(?:\.webp|\.jpe?g|\.png)(?:[?#]|$)/i.test(text) || /nflxso\.net|nflximg\.net/i.test(text)), 7);
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

    function reset() { myListGraphqlKey = null; }
    function diagnostics() { return { graphqlKey: myListGraphqlKey }; }
    return Object.freeze({ ...pageFacts, fetchBootstrap, collectRecords, reset, diagnostics });
}
