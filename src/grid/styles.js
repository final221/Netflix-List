import {
    STYLE_ID, SECTION_ATTR, SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS,
    ORIGINAL_HIDDEN_CLASS, ORIGINAL_HEADER_CLASS, ORIGINAL_VISIBILITY_ATTR,
    STATUS_ID, FAST_MOVE_CLASS, STATUS_TEXT_CLASS, STATUS_LABEL_CLASS,
    STATUS_META_CLASS, LOG_LINK_ID, ORDER_MISMATCH_DIALOG_ID, GRID_ID,
    LEGACY_EMPTY_STATE_ID
} from '../dom-names.js';

const stylesheet = `
            [${SECTION_ATTR}="true"] {
                position: relative !important;
                overflow: visible !important;
            }

            /* Keep the native carousel visible and fully interactive. */
            [${SECTION_ATTR}="true"] > .${SOURCE_SCAN_CLASS},
            [${SECTION_ATTR}="true"] > .${SOURCE_PARKED_CLASS} {
                opacity: 1 !important;
                pointer-events: auto !important;
                overflow: visible !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} > .${ORIGINAL_HEADER_CLASS},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] > .${ORIGINAL_HEADER_CLASS} {
                display: none !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} > .${SOURCE_PARKED_CLASS},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] > .${SOURCE_PARKED_CLASS} {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 1px !important;
                min-height: 0 !important;
                margin: 0 !important;
                opacity: 0 !important;
                pointer-events: none !important;
                overflow: visible !important;
                z-index: -1 !important;
            }

            [${SECTION_ATTR}="true"].${ORIGINAL_HIDDEN_CLASS} #${STATUS_ID},
            [${SECTION_ATTR}="true"][${ORIGINAL_VISIBILITY_ATTR}="false"] #${STATUS_ID} {
                --tm-row-gap: 0px !important;
            }

            /* Suppress native slide animation only for script-driven moves. */
            [${SECTION_ATTR}="true"].${FAST_MOVE_CLASS} .tm-netflix-mylist-v15-track {
                transition: none !important;
                animation: none !important;
            }

            #${STATUS_ID} {
                box-sizing: border-box;
                position: relative;
                z-index: 5;
                margin: var(--tm-row-gap, 24px) 0 10px;
                padding: 0;
                min-height: 17px;
                color: rgba(255,255,255,.72);
                font-size: inherit;
                line-height: normal;
                pointer-events: auto;
                display: flex;
                align-items: baseline;
                flex-wrap: nowrap;
                white-space: nowrap;
                gap: 8px;
                overflow: visible;
            }

            #${STATUS_ID} .${STATUS_TEXT_CLASS} {
                display: flex;
                align-items: baseline;
                gap: 8px;
                white-space: nowrap;
                flex: 0 0 auto;
            }

            #${STATUS_ID} .${STATUS_LABEL_CLASS} {
                font: inherit;
                color: inherit;
                white-space: nowrap;
            }

            #${STATUS_ID} .${STATUS_META_CLASS},
            #${LOG_LINK_ID} {
                font-size: .80em;
                font-weight: 400;
                line-height: 1.2;
            }

            #${LOG_LINK_ID} {
                margin-left: 0;
                flex: 0 0 auto;
                align-self: baseline;
                color: rgba(255,255,255,.88);
                text-decoration: underline;
                text-underline-offset: 2px;
                cursor: pointer;
                white-space: nowrap;
            }

            #${ORDER_MISMATCH_DIALOG_ID} {
                box-sizing: border-box;
                position: fixed !important;
                left: 50% !important;
                bottom: 14vh !important;
                transform: translateX(-50%) !important;
                z-index: 2147483647 !important;
                width: max-content;
                max-width: min(760px, calc(100vw - 48px));
                padding: 18px 22px;
                border-radius: 4px;
                background: rgba(38,38,38,.98);
                color: #fff;
                box-shadow: 0 4px 18px rgba(0,0,0,.55);
                font-family: "Netflix Sans", "Helvetica Neue", "Segoe UI", sans-serif;
                font-size: 16px;
                line-height: 1.45;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 14px;
                text-align: center;
                pointer-events: auto !important;
            }

            #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-message] {
                min-width: 0;
                max-width: 520px;
            }

            #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-actions] {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                flex: 0 0 auto;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button {
                box-sizing: border-box;
                min-width: 88px;
                min-height: 36px;
                padding: 7px 14px;
                border-radius: 3px;
                border: 1px solid rgba(255,255,255,.72);
                background: transparent;
                color: #fff;
                font: inherit;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.2;
                cursor: pointer;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button[data-tm-order-ok] {
                border-color: #fff;
                background: #fff;
                color: #181818;
            }

            #${ORDER_MISMATCH_DIALOG_ID} button:hover {
                opacity: .86;
            }

            @media (max-width: 700px) {
                #${ORDER_MISMATCH_DIALOG_ID} {
                    width: calc(100vw - 32px);
                    max-width: none;
                    padding: 16px 18px;
                    gap: 14px;
                    align-items: stretch;
                }

                #${ORDER_MISMATCH_DIALOG_ID} [data-tm-order-actions] {
                    justify-content: flex-end;
                }
            }

            #${GRID_ID}[data-tm-responsive-refreshing="true"] {
                pointer-events: none !important;
            }

            #${GRID_ID}[data-tm-empty="true"] {
                display: none !important;
            }

            #${LEGACY_EMPTY_STATE_ID} {
                position: relative;
                z-index: 0;
                box-sizing: border-box;
            }

            #${LEGACY_EMPTY_STATE_ID}[data-tm-empty-source="provisional-fallback"] {
                min-height: 116px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: rgba(255,255,255,.72);
                text-align: center;
            }

            #${LEGACY_EMPTY_STATE_ID}[data-tm-empty-source="provisional-fallback"] > p {
                margin: 0;
                font: inherit;
            }

            #${GRID_ID} {
                --tm-cols: 5;
                --tm-gap: 8px;
                --tm-grid-width: 1000px;
                --tm-grid-left: 0px;
                display: grid;
                grid-template-columns: repeat(var(--tm-cols), minmax(0, 1fr));
                gap: var(--tm-gap);
                box-sizing: border-box;
                width: var(--tm-grid-width);
                max-width: var(--tm-grid-width);
                margin: 0 0 0 var(--tm-grid-left);
                padding: 0;
                overflow: visible;
                position: relative;
                z-index: 0;
            }

            #${GRID_ID} > [data-virtual-slot],
            #${GRID_ID} [data-tm-watch-grid] > [data-virtual-slot] {
                min-width: 0 !important;
                width: auto !important;
                max-width: none !important;
                flex: none !important;
                transform: none !important;
                translate: none !important;
                overflow: visible !important;
                position: relative !important;
            }

            #${GRID_ID} [data-uia="standard-card"] {
                display: block;
                width: 100%;
                pointer-events: auto !important;
            }

            #${GRID_ID} img {
                display: block;
                width: 100%;
                max-width: 100%;
                height: auto;
            }

            #${GRID_ID} [data-tm-viewing-actions] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 4px;
                padding-top: 6px;
                position: relative;
                z-index: 1;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button {
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 5px;
                padding: 5px 8px;
                background: #242424;
                color: rgba(255,255,255,.85);
                font: inherit;
                font-size: 12px;
                line-height: 1.3;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button:hover,
            #${GRID_ID} [data-tm-viewing-actions] > button:focus-visible {
                border-color: #fff;
                color: #fff;
                outline: 2px solid #fff;
                outline-offset: 2px;
            }

            #${GRID_ID} [data-tm-viewing-actions] > button:disabled { opacity: .45; cursor: default; }
            #${GRID_ID} [data-tm-viewing-actions] > button[hidden] { display: none; }
            #${GRID_ID} [data-tm-manual-choice] {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding-inline: 4px;
                color: rgba(255,255,255,.65);
                font: inherit;
                font-size: 11px;
                line-height: 1.3;
            }
            #${GRID_ID} [data-tm-manual-choice]::before {
                content: '';
                width: 5px;
                height: 5px;
                flex: 0 0 5px;
                border-radius: 50%;
                background: currentColor;
            }
            #${GRID_ID} [data-tm-manual-choice][hidden] { display: none; }

            #${GRID_ID} > [data-tm-watch-section],
            #${GRID_ID} > [data-tm-type-filter],
            #${GRID_ID} > [data-tm-watch-controls],
            #${GRID_ID} > [data-tm-watch-empty] {
                grid-column: 1 / -1;
                min-width: 0;
                margin: 12px 0;
                color: rgba(255,255,255,.8);
                font: inherit;
            }

            #${GRID_ID} [data-tm-watch-grid] {
                display: grid;
                grid-template-columns: repeat(var(--tm-cols), minmax(0, 1fr));
                gap: var(--tm-gap);
                margin-top: 16px;
            }

            #${GRID_ID} [data-tm-watch-section]:not([open]) > :not(summary),
            #${GRID_ID} [data-tm-type-hidden="true"] {
                display: none !important;
            }

            #${GRID_ID} [data-tm-type-filter] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
                padding: 5px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 12px;
                background: rgba(255,255,255,.035);
                width: fit-content;
                max-width: 100%;
                box-sizing: border-box;
                margin: 4px 0 18px;
            }

            #${GRID_ID} [data-tm-type-filter] > button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                min-height: 40px;
                padding: 8px 16px;
                border: 1px solid transparent;
                border-radius: 8px;
                background: transparent;
                color: rgba(255,255,255,.7);
                font: inherit;
                font-size: .9em;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-type-filter] > button:hover {
                background: rgba(255,255,255,.08);
                color: #fff;
            }

            #${GRID_ID} [data-tm-type-filter] > button[aria-pressed="true"] {
                background: #e50914;
                color: #fff;
                font-weight: 600;
            }

            #${GRID_ID} [data-tm-type-filter] > button:focus-visible {
                outline: 2px solid #fff;
                outline-offset: 3px;
            }

            #${GRID_ID} [data-tm-type-count] {
                min-width: 1.5em;
                padding: 2px 6px;
                border-radius: 5px;
                background: rgba(255,255,255,.1);
                font-size: .8em;
                font-variant-numeric: tabular-nums;
                text-align: center;
            }

            #${GRID_ID} [data-tm-watch-section] {
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 12px;
                padding: 12px 18px;
                background: rgba(255,255,255,.025);
            }

            #${GRID_ID} [data-tm-watch-section] > summary {
                cursor: pointer;
                padding: 8px 0;
                font-size: 1.15em;
                font-weight: 600;
            }

            #${GRID_ID} [data-tm-watch-section] > [data-tm-type-filter] {
                margin-top: 14px;
            }

            #${GRID_ID} [data-tm-watch-controls] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                font-size: .9em;
            }

            #${GRID_ID} [data-tm-watch-controls] > button {
                border: 1px solid rgba(255,255,255,.4);
                border-radius: 4px;
                background: transparent;
                color: inherit;
                font: inherit;
                padding: 6px 10px;
                cursor: pointer;
            }

            #${GRID_ID} [data-tm-watch-controls] > button:disabled {
                opacity: .6;
                cursor: default;
            }

            #${GRID_ID} [data-tm-watch-empty][hidden] {
                display: none !important;
            }

        `;

export function installStyles(document) {
    const current = document.getElementById(STYLE_ID);
    if (current) return current;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = stylesheet;
    document.head.appendChild(style);
    return style;
}
