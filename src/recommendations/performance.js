// Passive scalar timings and activity-triggered callback probes; no geometry or requests.
export function createRecommendationPerformance({ environment, now, admitted, readWork }) {
    const { document } = environment;
    let owner = null, listening = false, generation = 0;
    let tasks = 0, slowTasks = 0, droppedTasks = 0, worstTask = null;
    let callbacks = 0, over50 = 0, over100 = 0, droppedFrames = 0, worstFrame = null, hidden = 0, failures = 0;
    const recentTasks = [], recentFrames = [];
    const copy = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round(Math.max(0, value) * 10) / 10;
    const supported = typeof environment.requestAnimationFrame === 'function' && typeof environment.cancelAnimationFrame === 'function';
    function stop() {
        const previous = owner; owner = null;
        try { if (previous?.frame != null) environment.cancelAnimationFrame(previous.frame); } catch (_) { failures++; }
    }
    function visibility() { if (document.visibilityState === 'hidden') { hidden++; stop(); } }
    function sample(reason) {
        try { sampleActivity(reason); } catch (_) { failures++; stop(); }
    }
    function sampleActivity(reason) {
        if (!supported || !admitted() || document.visibilityState === 'hidden') return;
        if (owner) { if (owner.reason !== reason) owner.reason = 'mixed'; return; }
        if (!listening) { document.addEventListener('visibilitychange', visibility); listening = true; }
        const current = { frame: null, at: now(), counters: readWork(), remaining: 2, reason };
        owner = current;
        function frame() {
            if (owner !== current) return;
            try {
                current.frame = null;
                if (!admitted() || document.visibilityState === 'hidden') { stop(); return; }
                const at = now(), waitMs = round(at - current.at), counters = readWork();
                callbacks++;
                if (waitMs > 50) {
                    over50++; if (waitMs > 100) over100++;
                    const record = { at: round(at), waitMs, reason: current.reason,
                        work: Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, Math.max(0, value - current.counters[key])])) };
                    recentFrames.push(record); if (recentFrames.length > 6) { recentFrames.shift(); droppedFrames++; }
                    if (!worstFrame || waitMs > worstFrame.waitMs) worstFrame = record;
                }
                if (--current.remaining === 0) { owner = null; return; }
                current.at = at; current.counters = counters;
                current.frame = environment.requestAnimationFrame(frame);
            } catch (_) { failures++; stop(); }
        }
        current.frame = environment.requestAnimationFrame(frame);
    }
    function begin(kind) {
        const token = generation, start = now(), phases = {}; let previous = start;
        sample(kind);
        return {
            phase(name) { const at = now(); phases[name] = round(at - previous); previous = at; },
            finish(detail = {}) {
                if (token !== generation) return;
                tasks++; const elapsedMs = round(now() - start);
                if (elapsedMs < 16) return;
                slowTasks++;
                const record = { at: round(start), kind, elapsedMs, phases, ...detail };
                recentTasks.push(record); if (recentTasks.length > 6) { recentTasks.shift(); droppedTasks++; }
                if (!worstTask || elapsedMs > worstTask.elapsedMs) worstTask = record;
            }
        };
    }
    function reset() {
        generation++; stop();
        if (listening) document.removeEventListener('visibilitychange', visibility); listening = false;
        tasks = slowTasks = droppedTasks = callbacks = over50 = over100 = droppedFrames = hidden = failures = 0;
        worstTask = worstFrame = null; recentTasks.length = recentFrames.length = 0;
    }
    return Object.freeze({ begin, sample, reset, snapshot: () => copy({
        scope: 'work-duration-and-animation-callback-delay; correlation-only', supported, pending: owner !== null,
        tasks, slowTasks, droppedTasks, recentTasks, worstTask,
        callbacks, over50, over100, hidden, failures, droppedFrames, recentFrames, worstFrame }) });
}
