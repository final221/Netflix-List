// Private card ownership. Membership and Undo expiry are supplied by the list owner.
export function createCards({ markup, keyFor, createError, prepareCard, onRetire, onReplace, readRoot, readPage, onMaterialReleaseFailure }) {
    let entries = new Map(), view = readOnlyView(entries), generation = 0, revision = 0, retirementFailures = 0;
    const handles = new WeakMap(), retained = new Map();

    function readOnlyView(map) {
        return Object.freeze({ get size() { return map.size; },
            get: key => map.get(key)?.node || null, has: key => map.has(key),
            *values() { for (const entry of map.values()) yield entry.node; },
            *entries() { for (const [key, entry] of map) yield [key, entry.node]; },
            [Symbol.iterator]() { return this.entries(); } });
    }
    function register(map, item, node) {
        const key = keyFor(item);
        if (map.has(key)) throw createError('GRID_DUPLICATE_CARD', 'Duplicate grid card: ' + key);
        const handle = Object.freeze({ key, generation: ++generation, node });
        const entry = { item, node, handle };
        handles.set(handle, entry);
        map.set(key, entry);
        return handle;
    }
    function isCurrent(handle) {
        const entry = handle && handles.get(handle);
        return Boolean(entry && entries.get(handle.key) === entry && entry.node.isConnected && readRoot()?.contains(entry.node));
    }
    function assertCard(handle) {
        if (!isCurrent(handle)) throw createError('GRID_CARD_RETIRED', 'Grid card is no longer current');
        return handle;
    }
    function getCard(item) {
        if (!item) return null;
        const entry = entries.get(typeof item === 'string' ? item : keyFor(item));
        return entry && (typeof item === 'string' || entry.item === item) ? entry.handle : null;
    }
    function materialFor(item, correlationId = null) {
        if (!item) return null;
        if (item.snapshot) return item.snapshot;
        const entry = entries.get(keyFor(item));
        if (entry?.item === item) return entry.node;
        const removed = retained.get(correlationId);
        if (removed?.item === item) return removed.node;
        return item.cardTemplate || null;
    }
    function createClone(item, correlationId, material = null) {
        const source = material ? material.source : materialFor(item, correlationId);
        if (!source) throw createError('GRID_CARD_MATERIAL_MISSING', 'No card markup available for ' + keyFor(item));
        return markup.createClone(source, item, material ? material.template : source === item.cardTemplate);
    }
    function prepare(node, item, index, detail = {}, page = readPage(item, index)) {
        markup.normalize(node);
        if (index !== null && index !== undefined) node.setAttribute('data-tm-item-order', String(index));
        node.setAttribute('data-tm-item-page', String(page));
        node.setAttribute('data-tm-item-video-id', item.videoId || '');
        node.__tmMyListItem = item;
        prepareCard(node, item, detail);
    }
    function releaseStartup(item) {
        const hadMaterial = Boolean(item.snapshot || item.cardTemplate);
        if (item.snapshot) item.snapshot = null;
        if (item.cardTemplate) item.cardTemplate = null;
        if (hadMaterial && item.imageUrl) item.imageUrl = '';
    }
    function stage(items, root, index, map, material = null, page = undefined) {
        const item = items[index], node = createClone(item, null, material);
        prepare(node, item, index, {}, page);
        root.appendChild(node);
        register(map, item, node);
    }
    function retireForPublication(guard) {
        const previous = entries;
        for (const entry of previous.values()) {
            guard();
            onRetire(entry.handle, { reason: 'publication' });
            guard();
        }
    }
    function publish(map) {
        entries.clear();
        entries = map;
        view = readOnlyView(map);
        revision++;
    }
    function replaceCard(expected, { node, create, assertCurrent = () => {}, attempt = null } = {}) {
        const guard = () => { assertCurrent(); assertCard(expected); };
        guard();
        const entry = handles.get(expected);
        const fresh = node || create(expected);
        guard();
        if (!fresh || fresh === expected.node || fresh.isConnected) throw createError('GRID_REPLACEMENT_INVALID', 'Replacement must be detached fresh markup');
        const order = expected.node.getAttribute('data-tm-item-order');
        prepare(fresh, entry.item, order === null ? null : Number(order), { replacement: true, attempt });
        guard();
        onRetire(expected, { reason: 'replacement', attempt });
        guard();
        // One synchronous structural/registry commit; the old handle is invalid thereafter.
        try { expected.node.replaceWith(fresh); }
        catch (error) {
            // If a host hook throws after the DOM commit, retain an admitted fresh tree.
            // Never overwrite registry changes made by a reentrant replacement owner.
            if (entries.get(expected.key) === entry) {
                entries.delete(expected.key);
                revision++;
                if (fresh.isConnected && readRoot()?.contains(fresh)) {
                    const current = register(entries, entry.item, fresh);
                    try { onReplace(expected, current, { attempt: null }); }
                    catch (_) { /* The consistent tree remains explicitly unprepared below. */ }
                    try { onRetire(current, { reason: 'replacement-commit-failed', attempt: null }); }
                    catch (_) { retirementFailures++; }
                } else if (expected.node.isConnected && readRoot()?.contains(expected.node)) {
                    entries.set(expected.key, entry);
                }
            }
            throw error;
        }
        entries.delete(expected.key);
        const next = register(entries, entry.item, fresh);
        revision++;
        try {
            onReplace(expected, next, { attempt });
            assertCurrent();
            assertCard(next);
        }
        catch (error) {
            // Keep a consistent current tree and explicitly release failed native preparation.
            try { onRetire(next, { reason: 'replacement-presentation-failed', attempt: null }); }
            catch (_) { retirementFailures++; }
            throw error;
        }
        return next;
    }
    function removeCard(expected, { correlationId = null, onAccepted = () => {}, assertCurrent = () => {} } = {}) {
        assertCurrent(); assertCard(expected);
        const entry = handles.get(expected);
        onRetire(expected, { reason: 'removal', attempt: null });
        assertCurrent(); assertCard(expected);
        entries.delete(expected.key);
        revision++;
        if (correlationId !== null) retained.set(correlationId, { item: entry.item, node: entry.node });
        onAccepted();
        try { entry.node.remove(); } catch (_) { retirementFailures++; }
        return true;
    }
    function insertCard(item, { index = 0, correlationId = null, before = null, material = null, page = undefined,
        onAccepted = () => {}, releaseMaterial = null, assertCurrent = () => {} } = {}) {
        assertCurrent();
        if (entries.has(keyFor(item))) throw createError('GRID_DUPLICATE_CARD', 'Card is already displayed');
        const root = readRoot();
        if (!root?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Grid is not mounted');
        const node = createClone(item, correlationId, material);
        prepare(node, item, index, {}, page);
        assertCurrent();
        if (readRoot() !== root || entries.has(keyFor(item))) throw createError('GRID_FRAME_RETIRED', 'Grid changed during insertion');
        root.insertBefore(node, before);
        try {
            assertCurrent();
            if (readRoot() !== root || entries.has(keyFor(item))) throw createError('GRID_FRAME_RETIRED', 'Grid changed during insertion');
        } catch (error) { node.remove(); throw error; }
        const handle = register(entries, item, node);
        revision++;
        retained.delete(correlationId);
        try { onAccepted(handle); }
        finally {
            if (releaseMaterial) {
                try { releaseMaterial(); } catch (_) { onMaterialReleaseFailure(); }
            } else releaseStartup(item);
        }
        assertCard(handle);
        return handle;
    }
    function updateCard(expected, item, index = null) {
        assertCard(expected);
        if (handles.get(expected).item !== item) throw createError('GRID_CARD_RETIRED', 'Grid card record changed');
        const page = readPage(item, index);
        assertCard(expected);
        const node = expected.node;
        if (index !== null) node.setAttribute('data-tm-item-order', String(index));
        node.setAttribute('data-tm-item-page', String(page));
        node.setAttribute('data-tm-item-video-id', item.videoId || '');
    }
    function dispose() {
        const old = entries;
        entries = new Map(); view = readOnlyView(entries); retained.clear(); revision++;
        for (const entry of old.values()) {
            try { onRetire(entry.handle, { reason: 'dispose', attempt: null }); }
            catch (_) { retirementFailures++; }
        }
        old.clear();
    }
    return { get view() { return view; }, get revision() { return revision; }, getCard, isCurrent, assertCard, materialFor, createClone,
        stage, retireForPublication, publish, releaseStartup, replaceCard, removeCard, insertCard, updateCard, dispose,
        hasRetained: (id, item) => retained.get(id)?.item === item,
        releaseRetained: id => retained.delete(id), clearRetained: () => retained.clear(),
        diagnostics: () => ({ activeCards: entries.size, retainedCards: retained.size, retirementFailures }) };
}
