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

function carouselArtworkVariables(direction) {
    const standard = { width: 342, height: 192 }, highRes = { width: 665, height: 375 };
    const formats = ['WEBP', 'JPG', 'PNG'], rtl = direction === 'rtl';
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


export { listCount, isMyListGraphqlSection, graphqlSectionVideoIds, extractFreshMyListBootstrap, carouselArtworkVariables, firstVideoIdFromCarouselNode, videoIdFromGraphqlNode, firstGraphqlText, firstGraphqlImageUrl };
