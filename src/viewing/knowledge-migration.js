// Legacy sources are read-only. Imports use stable fact keys and never replace v2 decisions.
export const KNOWLEDGE_PREFIX = 'legacyMyListForNetflix.knowledge.v2.';
export function validCoverage(value) {
    return Array.isArray(value) && value.length > 0 && value.length <= 40 &&
        value.every(pair => Array.isArray(pair) && pair.length === 2 && /^\d+$/.test(pair[0]) &&
            Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= 500) &&
        new Set(value.map(pair => pair[0])).size === value.length &&
        value.reduce((n, pair) => n + pair[1], 0) > 0 && value.reduce((n, pair) => n + pair[1], 0) <= 500;
}
export function addedEpisodes(before, after) {
    if (!validCoverage(before) || !validCoverage(after)) return false;
    const previous = new Map(before);
    return after.some(([id, count]) => count > 0 && (!previous.has(id) || count > previous.get(id)));
}
export const titleName = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
export function validChoice(value) {
    return value && ['main', 'complete', 'automatic'].includes(value.status) &&
        ['movie', 'series', 'unknown'].includes(value.type) && (value.coverage === null || validCoverage(value.coverage));
}
export function legacyFacts(profile, getValue, guard, { choicesKey, cacheKey } = {}) {
    const suffix = encodeURIComponent(profile), facts = [];
    const read = (key, optional = false) => {
        guard(); let value;
        try { value = getValue(key + suffix, null); } catch (error) { if (!optional) throw error; }
        guard(); return value;
    };
    const manual = read(choicesKey || 'legacyMyListForNetflix.viewingChoices.v1.');
    const recommendations = read('legacyMyListForNetflix.recommendationChoices.v1.');
    const cache = read(cacheKey || 'legacyMyListForNetflix.viewingCache.v1.', true);
    const details = read('legacyMyListForNetflix.titleDetails.v1.', true);
    function table(value, field) {
        if (!value) return {};
        if (value.version !== 1 || !value[field] || typeof value[field] !== 'object' ||
            Array.isArray(value[field]) || Object.keys(value[field]).length > 5000) throw new Error('invalid-storage');
        return value[field];
    }
    const names = recommendations?.titles && typeof recommendations.titles === 'object' ? recommendations.titles : {};
    for (const [id, value] of Object.entries(table(manual, 'choices'))) if (/^\d+$/.test(id) && validChoice(value))
        facts.push([id, 'manual', { ...value, name: titleName(names[id]) }]);
    for (const [id, value] of Object.entries(table(recommendations, 'choices'))) if (/^\d+$/.test(id)) {
        if (value === 'hide') facts.push([id, 'hidden', { hidden: true, name: titleName(names[id]) }]);
        else if (value === 'watched') facts.push([id, 'legacy', { name: titleName(names[id]), watched: true }]);
    }
    if (cache?.version === 1 && cache.completionRatio === .9 && Number.isFinite(cache.savedAt) &&
        cache.entries && !Array.isArray(cache.entries) && Object.keys(cache.entries).length <= 5000) {
        for (const [id, value] of Object.entries(cache.entries)) if (/^\d+$/.test(id) && Array.isArray(value) &&
            value.length === 2 && ['movie', 'series'].includes(value[0]) && value[1] === 'complete')
            facts.push([id, 'completion', { type: value[0], coverage: null, observedAt: cache.savedAt, source: 'legacy-cache', name: titleName(names[id]) }]);
    }
    for (const [id, value] of Object.entries(names).slice(0, 5000)) if (/^\d+$/.test(id) && titleName(value))
        facts.push([id, 'label', { name: titleName(value) }]);
    // The former detail cache is descriptive only. Keep its original contents intact.
    if (details?.version === 1 && details.entries && !Array.isArray(details.entries)) {
        for (const [id, value] of Object.entries(details.entries).slice(0, 5000)) {
            const name = titleName(Array.isArray(value) ? value[1]?.title : '');
            if (/^\d+$/.test(id) && name && !titleName(names[id])) facts.push([id, 'label', { name }]);
        }
    }
    return facts;
}
