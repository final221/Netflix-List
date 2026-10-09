import { ORIGINAL_HIDDEN_CLASS, ORIGINAL_VISIBILITY_ATTR } from '../../dom-names.js';

// Private geometry policies use the carousel owner's synchronous DOM readers.
// Binding admission, observation receipts and read caches remain with that owner.
export function createLayout({ pageDom: netflixDom, window, getComputedStyle,
    readRect: nativeRect, readFilledSlots: nativeFilledSlots, cardSelector }) {
    function median(values) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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

    function layoutResult({ columns, cardWidth, gap, gridLeft, gridWidth,
        sidePaddingLeft, sidePaddingRight = sidePaddingLeft, scrollerWidth, scrollerHeight, formulaBased = false }) {
        return { columns, cardWidth, gap, gridLeft, gridWidth, sidePaddingLeft, sidePaddingRight,
            sidePadding: (sidePaddingLeft + sidePaddingRight) / 2,
            scrollerWidth: Math.max(1, scrollerWidth), scrollerHeight: Math.max(1, scrollerHeight),
            widthRatio: cardWidth / gridWidth, formulaBased };
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
            const gridWidth = Math.max(1, scrollerRect.width - sidePaddingLeft - sidePaddingRight);
            const cardWidth = Math.max(1, (gridWidth - gap * Math.max(0, columns - 1)) / columns);
            const gridLeft = Math.max(0, scrollerRect.left - sectionRect.left + sidePaddingLeft);

            return layoutResult({ columns, cardWidth, gap, gridLeft, gridWidth, sidePaddingLeft, sidePaddingRight,
                scrollerWidth: scrollerRect.width, scrollerHeight: scrollerRect.height, formulaBased: true });
        }

        // Fallback: prefer the current page card count instead of the number visible in the viewport.
        const activeSlots = nativeFilledSlots(track).filter(slot => {
            const card = slot.querySelector(cardSelector);
            return card?.getAttribute('tabindex') === '0';
        });
        const sample = activeSlots.length ? activeSlots : nativeFilledSlots(track);
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

        return layoutResult({ columns, cardWidth, gap, gridLeft, gridWidth, sidePaddingLeft: sidePadding,
            scrollerWidth: scrollerRect.width, scrollerHeight: scrollerRect.height });
    }

    function measureEmptyLayout(section) {
        const sectionRect = nativeRect(section);
        const content = section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        const heading = section.querySelector(':scope > [data-uia="empty-carousel-section+title"], :scope > h2');
        const reference = content || heading;
        const referenceRect = reference?.getBoundingClientRect ? nativeRect(reference) : null;

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
        return layoutResult({ columns, cardWidth, gap, gridLeft, gridWidth, sidePaddingLeft, sidePaddingRight,
            scrollerWidth: sectionRect.width, scrollerHeight: 1 });
    }

    return Object.freeze({ formula: parseSlotLayoutFormula, visible: measureVisibleLayout, empty: measureEmptyLayout });
}
