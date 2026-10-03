// Controlled browser timers; callbacks and promise continuations run explicitly.
export function createScheduler() {
    let now = 1;
    let sequence = 0;
    const timers = new Map();
    const frames = new Map();
    const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
    return {
        timers, frames, flush,
        performance: { now: () => now },
        setTimeout(callback, delay = 0) {
            const id = ++sequence;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        async advance(ms = 0) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.due <= now && timers.delete(id)) timer.callback();
            }
            await flush();
        },
        async frame(ms = 16) {
            now += ms;
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(now);
            await flush();
        }
    };
}
