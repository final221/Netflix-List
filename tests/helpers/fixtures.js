// Wire fixtures describe Netflix responses without implementing interpretation policy.
export function carouselEdge(id, extra = {}) {
    return { node: { id: `Video:${id}`, videoId: String(id), displayString: `Title ${id}`,
        contextualArtwork: `https://images.test/${id}.jpg`, ...extra } };
}
export function carouselPayload(totalCount, ids, hasNextPage = false, endCursor = null) {
    return { data: { node: { __typename: 'PinotCarouselSection', entities: { totalCount,
        edges: ids.map(id => carouselEdge(id)), pageInfo: { hasNextPage, endCursor } } } } };
}
export function pageBootstrapHtml(totalCount, firstId = '1') {
    return `"__typename":"PinotCarouselSection","entities":{"totalCount":${totalCount},"node":"standardBoxshot_Video:${firstId}"},"notificationMessageRegex":"UPDATE_PLAYLIST"`;
}

export const atom = value => ({ $type: 'atom', value });
export const reference = (kind, id) => ({ $type: 'ref', value: [kind, String(id)] });
export function viewingVideo(type, watched, bookmark = 0, extra = {}) {
    return { summary: atom({ type }), watched: atom(watched), bookmarkPosition: atom(bookmark),
        runtime: atom(100), creditsOffset: atom(95), ...extra };
}
