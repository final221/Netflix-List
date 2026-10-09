// Shared presentation only; callers own identity, events, labels and persistence.
export function createCardActions(document, labels) {
    const root = document.createElement('div');
    root.setAttribute('data-tm-card-actions', 'true');
    const buttons = labels.map(label => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = label; root.appendChild(button); return button;
    });
    return { root, buttons };
}

export const CARD_ACTION_STYLES = `
    [data-tm-card-actions] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding-top: 6px;
        position: relative;
        z-index: 1;
    }
    [data-tm-card-actions] > button {
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
    [data-tm-card-actions] > button:hover,
    [data-tm-card-actions] > button:focus-visible {
        border-color: #fff;
        color: #fff;
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    [data-tm-card-actions] > button:disabled { opacity: .45; cursor: default; }
    [data-tm-card-actions] > [hidden] { display: none !important; }
`;
