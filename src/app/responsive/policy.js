// Pure policy consumes captured scalar/geometry facts; it cannot observe or schedule.
export function layoutSignature(layout, pages) {
    return [
        Math.max(1, layout.columns),
        pages,
        Math.round(layout.cardWidth),
        Math.round(layout.gridWidth),
        Math.round(layout.gridLeft),
        Math.round(layout.sidePadding || 0),
        Math.round(layout.scrollerWidth)
    ].join('|');

}

export function viewportSignature(window) {
    const viewport = typeof window === 'undefined' ? {} : window;
    const visual = viewport.visualViewport;
    return [viewport.innerWidth, viewport.innerHeight, viewport.devicePixelRatio,
        visual?.width, visual?.height, visual?.scale, visual?.offsetLeft, visual?.offsetTop].join('|');
}

export function responsiveLayoutMatches(previous, next, ignoreScrollerHeight = false) {
    if (!previous) return false;
    return ['columns', 'cardWidth', 'gridWidth', 'gridLeft', 'sidePadding', 'sidePaddingLeft',
        'sidePaddingRight', 'scrollerWidth', 'scrollerHeight', 'gap', 'rowGap']
        .every(key => (ignoreScrollerHeight && key === 'scrollerHeight') ||
            Math.abs((previous[key] || 0) - (next[key] || 0)) <= 0.5);
}

export function classifyResponsiveChange({ previousLayout, measured, sig, previousSignature,
    reason, mappingStale, presentation, previousViewport, viewport, applied, geometry }) {

    const layoutUnchanged = responsiveLayoutMatches(previousLayout, measured);
    // Parking a hidden source changes its own height, not the displayed
    // grid. Preserve the first hover only after all other checks agree.
    const parkedHeightOnlyChange = !layoutUnchanged && reason === 'ResizeObserver' &&
        sig === previousSignature && !mappingStale &&
        presentation.hidden && presentation.parked &&
        previousViewport === viewport &&
        Number.isFinite(previousLayout?.scrollerHeight) && previousLayout.scrollerHeight > 1.5 &&
        Number.isFinite(measured.scrollerHeight) && measured.scrollerHeight >= 1 && measured.scrollerHeight <= 1.5 &&
        responsiveLayoutMatches(previousLayout, measured, true);
    const geometryUnchanged = (layoutUnchanged || parkedHeightOnlyChange) && applied &&
        ['width', 'left', 'columns'].every(key => Math.abs(applied[key] - geometry[key]) <= 0.5);

    if (sig === previousSignature && geometryUnchanged && !mappingStale) {
        return parkedHeightOnlyChange ? 'parked-height-only' : 'unchanged';
    }
    if (reason === 'ResizeObserver') {
        const previousParts = String(previousSignature || '').split('|');
        const currentParts = String(sig || '').split('|');
        const pageCountOnlyChanged = previousParts.length === 7 && currentParts.length === 7 &&
            previousParts[1] !== currentParts[1] &&
            previousParts.every((part, index) => index === 1 || part === currentParts[index]);
        if (pageCountOnlyChanged && geometryUnchanged && !mappingStale) return 'page-count-only';
    }
    return 'refresh';
}
