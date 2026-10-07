import { createViewing } from '../../src/viewing/viewing.js';

export function fixture() {
    let profile = 'a', readHook = () => {}, writeHook = () => {};
    const storage = new Map();
    const viewing = createViewing({ activeProfile: () => profile, now: () => 1000,
        getValue(key, fallback) { readHook(); return structuredClone(storage.get(key) ?? fallback); },
        setValue(key, value) { writeHook(); storage.set(key, structuredClone(value)); } });
    const watch = { results: new Map(), types: new Map(), seriesCoverage: new Map() };
    viewing.initialize(watch, [{ videoId: '1' }], profile);
    viewing.syncProfile(watch);
    return { viewing, watch, storage, profile(value) { profile = value; },
        onRead(value) { readHook = value; }, onWrite(value) { writeHook = value; } };
}
