import { readVideoIdFromHref, NETFLIX_DOM_SELECTORS } from './page-dom.js';

// Capture/build markup only; registry selection and retained material lifetime belong to grid.
export function createCardMarkup({ location, document }) {
    const videoIdFromHref = href => readVideoIdFromHref(href, location.href);

    function capture(slot, page, captureSnapshot = true) {
        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (!card) return null;

        const href = card.href || card.getAttribute('href') || '';
        if (!href) return null;

        return {
            href,
            videoId: videoIdFromHref(href),
            page,
            ariaLabel: card.getAttribute('aria-label') || '',
            snapshot: captureSnapshot ? slot.cloneNode(true) : null
        };
    }

    function createClone(source, item, fromTemplate = false) {
        const clone = source.cloneNode(true);
        if (fromTemplate) {
            const card = clone.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
            card.setAttribute('href', item.href);
            card.href = item.href;
            card.setAttribute('aria-label', item.ariaLabel);
            const image = clone.querySelector('img');
            if (item.imageUrl && image) {
                image.src = item.imageUrl;
                image.removeAttribute('srcset');
                image.setAttribute('data-tm-graphql-image', 'true');
            }
        }
        // cloneNode copies attributes, but not grafted React properties or the
        // activation state. Rebuild/Undo must prepare its own fresh live source.
        for (const name of ['data-tm-hover-ready', 'data-tm-backed-page', 'data-tm-react-grafted',
            'data-tm-preparing', 'data-tm-hover-token']) clone.removeAttribute(name);
        return clone;
    }

    function normalize(slot) {
        for (const property of ['flex', 'width', 'min-width', 'max-width', 'transform', 'translate',
            'opacity', 'visibility', 'pointer-events']) slot.style.removeProperty(property);

        const card = slot.querySelector(NETFLIX_DOM_SELECTORS.standardCard);
        if (card) {
            card.tabIndex = 0;
            card.setAttribute('data-tm-clone-card', 'true');
        }

        for (const image of slot.querySelectorAll('img')) {
            image.loading = 'lazy';
            image.decoding = 'async';
        }
    }

    function captureTemplate(slot) {
        const template = slot.cloneNode(true);
        return template.querySelector(NETFLIX_DOM_SELECTORS.standardCard) ? template : null;
    }
    function cloneEmptyContent(source, provisionalMessage = null) {
        const clone = source.cloneNode(true);
        if (provisionalMessage !== null) {
            clone.querySelector('[data-uia="empty-carousel-section+pictogram"]')?.remove();
            let message = clone.querySelector('[data-uia="empty-carousel-section+message"]');
            if (!message) { message = document.createElement('p'); clone.appendChild(message); }
            message.textContent = provisionalMessage;
        }
        return clone;
    }
    return Object.freeze({ capture, createClone, normalize, captureTemplate, cloneEmptyContent });
}
