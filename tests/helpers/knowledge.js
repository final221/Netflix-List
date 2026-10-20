import { createKnowledge } from '../../src/viewing/knowledge.js';

// Public storage inputs and semantic readback; no access to private owner state.
const buses = new WeakMap();
export function storageClient(storage, { read = () => {}, write = () => {} } = {}) {
    if (!buses.has(storage)) buses.set(storage, { next: 0, listeners: new Map() });
    const bus = buses.get(storage), client = {};
    Object.assign(client, {
        getValue(key, fallback) { read(key); return structuredClone(storage.get(key) ?? fallback); },
        setValue(key, value) {
            write(key, value); const prior = storage.get(key); storage.set(key, structuredClone(value));
            for (const { owner, key: watched, callback } of bus.listeners.values()) if (key === watched)
                queueMicrotask(() => callback(key, structuredClone(prior), structuredClone(value), owner !== client));
        },
        listValues: () => [...storage.keys()],
        addValueChangeListener(key, callback) { const id = ++bus.next; bus.listeners.set(id, { owner: client, key, callback }); return id; },
        removeValueChangeListener: id => bus.listeners.delete(id)
    });
    return client;
}
export function knowledgeSnapshot(storage, profile) {
    const copy = structuredClone(storage), knowledge = createKnowledge({ ...storageClient(copy), activeProfile: () => profile });
    const view = knowledge.view(); view.sync();
    const choices = Object.fromEntries(view.ids().filter(id => view.has(id)).map(id => {
        const value = view.choice(id); return [id, { status: value.status, type: value.type, coverage: value.coverage }];
    }));
    const hidden = knowledge.hidden(), titles = Object.fromEntries(Object.keys(hidden).filter(id => knowledge.name(id)).map(id => [id, knowledge.name(id)]));
    knowledge.dispose();
    return { choices, recommendations: { version: 1, choices: hidden, titles } };
}
export function fact(storage, profile, id, kind) {
    return storage.get('legacyMyListForNetflix.knowledge.v2.' + encodeURIComponent(profile) + '.' + id + '.' + kind);
}
