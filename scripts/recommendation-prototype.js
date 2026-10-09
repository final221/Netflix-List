// Offline experiment only. The adapter supplies finite pages; this controller
// does not invent Netflix endpoints, mutate ratings, or render Netflix cards.
export function createRecommendationPrototype({ getPage, loadChoices = () => ({}), saveChoices = () => {},
    pageBudget = 3, totalBudget = 12, capacity = 6 }) {
    let epoch = 0, state = null;
    function selectProfile(profile) {
        if (typeof profile !== 'string' || !profile) throw new Error('Profile required');
        const loaded = loadChoices(profile);
        const choices = new Map(Object.entries(loaded || {}).filter(([id, reason]) =>
            /^\d+$/.test(id) && ['watched', 'hide'].includes(reason)));
        state?.controller.abort();
        state = { epoch: ++epoch, profile, choices, cards: [], buffer: [], seen: new Set(), cursors: new Set(),
            cursor: null, ended: false, requests: 0, busy: false, status: 'ready', undo: null, controller: new AbortController() };
    }
    function current(owner) { return state === owner && owner.epoch === epoch; }
    function snapshot() {
        if (!state) return null;
        return { profile: state.profile, cards: state.cards.map(card => ({ ...card })),
            choices: Object.fromEntries(state.choices), requests: state.requests, busy: state.busy,
            status: state.status, canUndo: Boolean(state.undo) };
    }
    async function refill() {
        const owner = state;
        if (!owner || owner.busy) return snapshot();
        owner.busy = true;
        let dispatched = 0;
        try {
            while (current(owner) && owner.cards.length < capacity) {
                while (owner.buffer.length && owner.cards.length < capacity) {
                    const card = owner.buffer.shift();
                    if (!owner.choices.has(card.id)) owner.cards.push(card);
                }
                if (owner.cards.length >= capacity) { owner.status = 'full'; break; }
                if (owner.ended) { owner.status = 'exhausted'; break; }
                if (dispatched >= pageBudget || owner.requests >= totalBudget) { owner.status = 'budget'; break; }
                owner.requests++; dispatched++;
                const page = await getPage({ profile: owner.profile, cursor: owner.cursor, signal: owner.controller.signal });
                if (!current(owner)) break;
                if (!page || !Array.isArray(page.cards) || typeof page.hasNextPage !== 'boolean' ||
                    page.cards.some(card => !card || !/^\d+$/.test(card.id) || typeof card.title !== 'string')) {
                    throw new Error('Invalid page');
                }
                const next = page.endCursor;
                if (page.hasNextPage && (typeof next !== 'string' || !next || next === owner.cursor || owner.cursors.has(next))) {
                    throw new Error('Missing or repeated cursor');
                }
                if (page.hasNextPage) owner.cursors.add(next);
                owner.cursor = next;
                owner.ended = !page.hasNextPage;
                for (const card of page.cards) if (!owner.seen.has(card.id)) {
                    owner.seen.add(card.id); owner.buffer.push({ id: card.id, title: card.title });
                }
            }
        } catch (error) {
            if (current(owner)) owner.status = 'failed';
        } finally { if (current(owner)) owner.busy = false; }
        return snapshot();
    }
    function persist(owner, choices) {
        saveChoices(owner.profile, Object.fromEntries(choices));
        if (!current(owner)) throw new Error('Profile changed during save');
        owner.choices = choices;
    }
    function dismiss(id, reason) {
        const owner = state;
        if (!owner || !['watched', 'hide'].includes(reason)) throw new Error('Invalid dismissal');
        const index = owner.cards.findIndex(card => card.id === id);
        if (index < 0) throw new Error('Title is no longer displayed');
        const choices = new Map(owner.choices); choices.set(id, reason);
        const card = owner.cards[index], previous = owner.choices.get(id);
        persist(owner, choices);
        owner.undo = { card, index, previous };
        owner.cards.splice(index, 1);
        return refill();
    }
    function undo() {
        const owner = state, previous = owner?.undo;
        if (!previous) return snapshot();
        const choices = new Map(owner.choices);
        if (previous.previous) choices.set(previous.card.id, previous.previous); else choices.delete(previous.card.id);
        persist(owner, choices);
        owner.undo = null;
        owner.cards.splice(previous.index, 0, previous.card);
        if (owner.cards.length > capacity) owner.buffer.unshift(owner.cards.pop());
        return snapshot();
    }
    function dispose() { state?.controller.abort(); state = null; epoch++; }
    return Object.freeze({ selectProfile, refill, dismiss, undo, snapshot, dispose });
}
