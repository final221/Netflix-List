// Visit-local records survive native slot recycling. No DOM, transport or persistent choices.
export function createRowBuffer(limit = 500) {
    const titles = new Map();
    let anchor = null, truncated = false;
    function observe(items) {
        for (const { id, title } of items) {
            if (typeof id !== 'string' || !/^\d+$/.test(id)) continue;
            const name = typeof title === 'string' ? title.trim().slice(0, 300) : '';
            if (titles.has(id)) { if (name) titles.set(id, name); continue; }
            if (titles.size >= limit) { truncated = true; continue; }
            titles.set(id, name);
        }
    }
    function project(choices = {}, { anchorId, capacity = 8, mountedIds = [] } = {}) {
        capacity = Math.max(1, Math.min(20, Math.floor(capacity) || 8));
        const all = [...titles.keys()], filtered = all.filter(id => !choices[id]);
        if (anchorId && titles.has(anchorId)) anchor = anchorId;
        let index = filtered.indexOf(anchor);
        if (index < 0) {
            const oldIndex = all.indexOf(anchor);
            const next = all.slice(Math.max(0, oldIndex)).find(id => !choices[id]);
            index = next ? filtered.indexOf(next) : Math.max(0, filtered.length - capacity);
        }
        anchor = filtered[index] || null;
        const mounted = new Set(mountedIds), ahead = Math.max(0, filtered.length - index - capacity);
        return { known: titles.size, named: [...titles.values()].filter(Boolean).length, filtered: filtered.length, excluded: titles.size - filtered.length,
            retainedUnmounted: all.filter(id => !mounted.has(id)).length,
            filteredUnmounted: filtered.filter(id => !mounted.has(id)).length,
            capacity, anchor, index, page: filtered.slice(index, index + capacity),
            previous: filtered.slice(Math.max(0, index - capacity), index),
            next: filtered.slice(index + capacity, index + 2 * capacity),
            ahead, targetAhead: capacity * 2, shortfall: Math.max(0, capacity * 2 - ahead),
            exhausted: null, truncated, order: 'first-observed', presentation: 'candidate-only; native paging unchanged' };
    }
    return Object.freeze({ observe, project });
}
