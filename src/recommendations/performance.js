// Passive scalar timings and activity-triggered callback probes; no geometry or requests.
export function createRecommendationPerformance({ environment, now, admitted, readWork }) {
    const { document } = environment;
    let pendingProbe = null;
    let listening = false, taskGeneration = 0;
    let tasks = 0, slowTasks = 0, droppedTasks = 0, worstTask = null;
    let callbacks = 0, over50 = 0, over100 = 0, droppedFrames = 0, worstFrame = null, hidden = 0, failures = 0;
    const recentTasks = [], recentFrames = [];
    const copy = value => JSON.parse(JSON.stringify(value));
    const round = value => Math.round(Math.max(0, value) * 10) / 10;
    const supported = typeof environment.requestAnimationFrame === 'function' && typeof environment.cancelAnimationFrame === 'function';
    function stopProbe() {
        const previous = pendingProbe;
        pendingProbe = null;
        try {
            if (previous?.frame != null) environment.cancelAnimationFrame(previous.frame);
        } catch (_) {
            failures++;
        }
    }

    function visibilityChanged() {
        if (document.visibilityState !== 'hidden') return;
        hidden++;
        stopProbe();
    }

    function recordCallbackDelay(probe, at, counters) {
        const waitMs = round(at - probe.at);
        callbacks++;
        if (!(waitMs > 50)) return;

        over50++;
        if (waitMs > 100) over100++;
        const work = Object.fromEntries(Object.entries(counters).map(([key, value]) =>
            [key, Math.max(0, value - probe.counters[key])]));
        const record = { at: round(at), waitMs, reason: probe.reason, work };
        recentFrames.push(record);
        if (recentFrames.length > 6) {
            recentFrames.shift();
            droppedFrames++;
        }
        if (!worstFrame || waitMs > worstFrame.waitMs) worstFrame = record;
    }

    function recordTask(start, kind, phases, detail) {
        tasks++;
        const elapsedMs = round(now() - start);
        if (elapsedMs < 16) return;

        slowTasks++;
        const record = { at: round(start), kind, elapsedMs, phases, ...detail };
        recentTasks.push(record);
        if (recentTasks.length > 6) {
            recentTasks.shift();
            droppedTasks++;
        }
        if (!worstTask || elapsedMs > worstTask.elapsedMs) worstTask = record;
    }

    function sample(reason) {
        try {
            sampleActivity(reason);
        } catch (_) {
            failures++;
            stopProbe();
        }
    }

    function sampleActivity(reason) {
        if (!supported || !admitted() || document.visibilityState === 'hidden') return;
        if (pendingProbe) {
            if (pendingProbe.reason !== reason) pendingProbe.reason = 'mixed';
            return; // Preserve the existing baseline, including a callback already delayed.
        }
        if (!listening) {
            document.addEventListener('visibilitychange', visibilityChanged);
            listening = true;
        }

        const probe = { frame: null, at: now(), counters: readWork(), remaining: 2, reason };
        pendingProbe = probe;
        function onFrame() {
            if (pendingProbe !== probe) return;
            try {
                probe.frame = null;
                if (!admitted() || document.visibilityState === 'hidden') {
                    stopProbe();
                    return;
                }
                const at = now(), counters = readWork();
                recordCallbackDelay(probe, at, counters);
                if (--probe.remaining === 0) {
                    pendingProbe = null;
                    return;
                }
                probe.at = at;
                probe.counters = counters;
                probe.frame = environment.requestAnimationFrame(onFrame);
            } catch (_) {
                failures++;
                stopProbe();
            }
        }
        probe.frame = environment.requestAnimationFrame(onFrame);
    }

    function begin(kind) {
        const generation = taskGeneration;
        const start = now(), phases = {};
        let previous = start;
        sample(kind);
        return {
            phase(name) {
                const at = now();
                phases[name] = round(at - previous);
                previous = at;
            },
            finish(detail = {}) {
                if (generation !== taskGeneration) return;
                recordTask(start, kind, phases, detail);
            }
        };
    }

    function reset() {
        taskGeneration++;
        stopProbe();
        if (listening) document.removeEventListener('visibilitychange', visibilityChanged);
        listening = false;

        tasks = 0;
        slowTasks = 0;
        droppedTasks = 0;
        worstTask = null;
        recentTasks.length = 0;

        callbacks = 0;
        over50 = 0;
        over100 = 0;
        droppedFrames = 0;
        hidden = 0;
        failures = 0;
        worstFrame = null;
        recentFrames.length = 0;
    }

    return Object.freeze({ begin, sample, reset, snapshot: () => copy({
        scope: 'work-duration-and-animation-callback-delay; correlation-only', supported, pending: pendingProbe !== null,
        tasks, slowTasks, droppedTasks, recentTasks, worstTask,
        callbacks, over50, over100, hidden, failures, droppedFrames, recentFrames, worstFrame }) });
}
