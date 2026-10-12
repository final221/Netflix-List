// Shared mechanics only: callers retain their native mapping and hover policies.
export function applyPageAssignments(assignments, { hints, cards, assertCurrent,
    skipUnchanged = false, connectedOnly = false, onChanged = () => {} }) {
    let changed = 0;
    for (const { item, page } of assignments) {
        assertCurrent();
        const previous = hints.read(item);
        if (skipUnchanged && previous === page) continue;
        if (previous !== page) changed++;
        hints.write(item, page);
        const card = cards.get(item);
        if (card && (!connectedOnly || card.node.isConnected)) cards.update(card, item);
        onChanged(item, previous, page);
        assertCurrent();
    }
    return changed;
}
