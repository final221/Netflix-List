// Read-only investigation: sample existing responses and component shapes,
// never invoke a private callback or retain its live objects.
const NATIVE_POPUP_DIAGNOSTIC_LIMITS = Object.freeze({ responsePages: 8, cardsPerPage: 4,
    responseNodes: 48, responseDepth: 6, keys: 40, paths: 32,
    fibers: 14, holders: 32, holderDepth: 2, functions: 24, sourceChars: 4096, previewCaptures: 1 });
const POPUP_FIELD_GROUPS = Object.freeze(['identity', 'title', 'synopsis', 'artwork', 'runtime', 'year',
    'maturity', 'genres', 'seasons', 'preview', 'playback', 'rating', 'membership']);
const POPUP_RESPONSE_FIELDS = Object.freeze({
    identity: /^(id|videoid|entityid|titleid)$/,
    title: /^(title|displaystring|titletext)$/,
    synopsis: /^(synopsis|contextualsynopsis|description|plot)$/,
    artwork: /^(contextualartwork|artwork|boxart|boxshot|logo|storyart)$/,
    runtime: /^(runtime|duration)$/,
    year: /^(releaseyear|year)$/,
    maturity: /^(maturity|maturityrating|maturitylevel)$/,
    genres: /^(genres|genre)$/,
    seasons: /^(seasons|seasoncount|numseasons|numseasonslabel|episodecount|episodes)$/,
    preview: /preview|trailer|miniplayer|^bob$/,
    playback: /^(playback|playable|playcontext|playbackcontext|isplayable)$/,
    rating: /^(userrating|thumbsrating|matchscore|rating)$/,
    membership: /^(inmylist|inqueue|isinplaylist|ismylist)$/
});

function createCounters() {
    return { scope: 'read-only-response-and-native-shapes',
        responsePages: 0, responseEdges: 0, sampledCards: 0, responseNodes: 0,
        truncatedCards: 0, skippedPages: 0, fieldPaths: '', failures: 0, responseMs: 0,
        previewCaptures: 0, previewShape: '', previewProbeMs: 0,
        ...Object.fromEntries(POPUP_FIELD_GROUPS.flatMap(field =>
            [[field + 'Present', 0], [field + 'Scalar', 0]])) };
}

export function createPopupInspection({ Element, now, isCurrentSession, readSessionToken, isSourceMounted, readSourceCard }) {
    let counters = createCounters();
    function currentSession(token) {
        try { return isCurrentSession(token ?? readSessionToken()); }
        catch (_) { return false; }
    }

    function popupDiagnosticValue(object, key) {
        // Reading a descriptor avoids executing getters on private application objects.
        if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
        return Object.getOwnPropertyDescriptor(object, key)?.value;
    }

    function popupDiagnosticKey(key) {
        return /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(key) &&
            !/auth|token|secret|cookie|password|profile|guid|tracking|session/i.test(key);
    }

    function popupResponseField(key) {
        const normalized = key.toLowerCase().replace(/_/g, '');
        return POPUP_FIELD_GROUPS.find(field => POPUP_RESPONSE_FIELDS[field].test(normalized)) || '';
    }

    function surveyPopupResponseCard(node) {
        const limits = NATIVE_POPUP_DIAGNOSTIC_LIMITS;
        const result = { present: new Set(), scalar: new Set(), paths: [], nodes: 0, truncated: false };
        const queue = [{ value: node, path: 'node', depth: 0, field: '' }], seen = new Set();
        for (let index = 0; index < queue.length; index++) {
            const entry = queue[index];
            if (!entry.value || typeof entry.value !== 'object' || seen.has(entry.value)) continue;
            seen.add(entry.value);
            result.nodes++;
            const array = Array.isArray(entry.value);
            const keys = array ? Array.from({ length: Math.min(entry.value.length, 4) }, (_, i) => String(i))
                : Object.keys(entry.value);
            if (keys.length > limits.keys || (array && entry.value.length > 4)) result.truncated = true;
            for (const key of keys.slice(0, limits.keys)) {
                if (!array && (!popupDiagnosticKey(key) || key === '__typename' || key === '__ref')) continue;
                const value = popupDiagnosticValue(entry.value, key);
                const field = (!array && popupResponseField(key)) || entry.field;
                const path = array ? entry.path + '[]' : entry.path + '.' + key;
                if (field) {
                    result.present.add(field);
                    if ((typeof value === 'string' && value.trim() !== '') ||
                        (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
                        result.scalar.add(field);
                    }
                    if (result.paths.length < limits.paths && path.length <= 256 && !result.paths.includes(path)) {
                        result.paths.push(path);
                    }
                }
                if (value && typeof value === 'object' && !seen.has(value)) {
                    if (entry.depth >= limits.responseDepth || queue.length >= limits.responseNodes) {
                        result.truncated = true;
                    } else queue.push({ value, path, depth: entry.depth + 1, field });
                }
            }
        }
        return result;
    }

    function recordResponse(edges, sessionToken) {
        if (!currentSession(sessionToken)) return;
        const limits = NATIVE_POPUP_DIAGNOSTIC_LIMITS;
        const started = now();
        try {
            if (counters.responsePages >= limits.responsePages) { counters.skippedPages++; return; }
            counters.responsePages++;
            counters.responseEdges += edges.length;
            const samples = Math.min(edges.length, limits.cardsPerPage);
            const paths = new Set(counters.fieldPaths ? counters.fieldPaths.split('|') : []);
            for (let index = 0; index < samples; index++) {
                // Spread the small schema sample across the page, independent of grid visibility.
                const offset = samples === 1 ? 0 : Math.round(index * (edges.length - 1) / (samples - 1));
                const result = surveyPopupResponseCard(popupDiagnosticValue(edges[offset], 'node'));
                counters.sampledCards++;
                counters.responseNodes += result.nodes;
                if (result.truncated) counters.truncatedCards++;
                for (const field of result.present) counters[field + 'Present']++;
                for (const field of result.scalar) counters[field + 'Scalar']++;
                for (const path of result.paths) if (paths.size < limits.paths) paths.add(path);
            }
            counters.fieldPaths = [...paths].join('|');
        } catch (_) { counters.failures++; }
        finally { counters.responseMs += Math.max(0, now() - started); }
    }

    function describeNativePopupChain(node) {
        const limits = NATIVE_POPUP_DIAGNOSTIC_LIMITS;
        const result = { status: 'no-fiber', components: [], functions: [], fields: [],
            holders: 0, accessorsSkipped: 0, failures: 0, truncated: false };
        const seen = new Set(), pending = [], fiberSeen = new Set();
        const enqueue = (value, path, depth = 0) => {
            if (!value || typeof value !== 'object' || value instanceof Element || seen.has(value)) return;
            if (depth > limits.holderDepth || pending.length >= limits.holders) { result.truncated = true; return; }
            seen.add(value);
            pending.push({ value, path, depth });
        };
        try {
            let fiber = null;
            for (let parent = 0; node && parent < 3 && !fiber; parent++, node = node.parentElement) {
                const key = Object.keys(node).find(name => /^__react(Fiber|InternalInstance)\$/.test(name));
                if (key) fiber = popupDiagnosticValue(node, key);
            }
            if (!fiber) return result;
            result.status = 'read-only-candidates';
            for (let depth = 0; fiber && depth < limits.fibers && !fiberSeen.has(fiber); depth++) {
                fiberSeen.add(fiber);
                const type = popupDiagnosticValue(fiber, 'elementType') || popupDiagnosticValue(fiber, 'type');
                const name = typeof type === 'string' ? type :
                    popupDiagnosticValue(type, 'displayName') || popupDiagnosticValue(type, 'name');
                result.components.push({ depth, type: typeof name === 'string' && popupDiagnosticKey(name) ? name : 'anonymous' });
                enqueue(popupDiagnosticValue(fiber, 'memoizedProps'), 'fiber' + depth + '.props');
                enqueue(popupDiagnosticValue(fiber, 'pendingProps'), 'fiber' + depth + '.pendingProps');
                enqueue(popupDiagnosticValue(fiber, 'stateNode'), 'fiber' + depth + '.instance');
                const dependencies = popupDiagnosticValue(fiber, 'dependencies');
                let context = popupDiagnosticValue(dependencies, 'firstContext');
                for (let index = 0; context && index < 2; index++) {
                    const current = popupDiagnosticValue(context, 'memoizedValue');
                    const contextObject = popupDiagnosticValue(context, 'context');
                    enqueue(current ?? popupDiagnosticValue(contextObject, '_currentValue'), 'fiber' + depth + '.context' + index);
                    context = popupDiagnosticValue(context, 'next');
                }
                fiber = popupDiagnosticValue(fiber, 'return');
            }
            if (fiber && !fiberSeen.has(fiber)) result.truncated = true;
            for (let index = 0; index < pending.length; index++) {
                const entry = pending[index];
                result.holders++;
                const keys = Object.keys(entry.value);
                if (keys.length > limits.keys) result.truncated = true;
                for (const key of keys.slice(0, limits.keys)) {
                    if (!popupDiagnosticKey(key) || key === 'children') continue;
                    const descriptor = Object.getOwnPropertyDescriptor(entry.value, key);
                    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                        result.accessorsSkipped++; continue;
                    }
                    const value = descriptor.value, path = entry.path + '.' + key;
                    if (typeof value === 'function') {
                        if (result.functions.length >= limits.functions) { result.truncated = true; continue; }
                        const source = Function.prototype.toString.call(value);
                        const sample = source.slice(0, limits.sourceChars).toLowerCase();
                        const arity = popupDiagnosticValue(value, 'length');
                        result.functions.push({ path, arity: Number.isSafeInteger(arity) && arity >= 0 && arity <= 64 ? arity : null,
                            sourceTruncated: source.length > limits.sourceChars,
                            hints: ['currentTarget', 'videoId', 'titleId', 'entityId', 'preview', 'popup',
                                'miniPlayer', 'bob', 'dispatch', 'setState', 'hover', 'pointer', 'mouse']
                                .filter(hint => sample.includes(hint.toLowerCase())) });
                    } else {
                        if (result.fields.length < limits.paths) {
                            result.fields.push({ path, kind: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value });
                        }
                        if (!Array.isArray(value)) enqueue(value, path, entry.depth + 1);
                    }
                }
            }
        } catch (_) { result.failures++; result.status = 'partial-probe'; }
        return result;
    }

    function capturePreview(root, sessionToken) {
        if (!currentSession(sessionToken)) return;
        if (counters.previewCaptures >= NATIVE_POPUP_DIAGNOSTIC_LIMITS.previewCaptures) return;
        counters.previewCaptures++;
        const started = now();
        try { counters.previewShape = JSON.stringify(describeNativePopupChain(root)); }
        catch (_) { counters.failures++; }
        finally { counters.previewProbeMs += Math.max(0, now() - started); }
    }

    function collect() {
        // Only Copy Logs probes the current source card; hover keeps one bounded
        // preview summary so it remains available after moving to the log button.
        try {
            if (!currentSession() || !isSourceMounted()) {
                return { status: 'inactive-route' };
            }
            const card = readSourceCard();
            const saved = counters.previewShape;
            return { scope: 'read-only-shapes-no-values-or-code', limits: NATIVE_POPUP_DIAGNOSTIC_LIMITS,
                source: describeNativePopupChain(card), preview: saved ? JSON.parse(saved) : null };
        } catch (_) { return { status: 'probe-failed' }; }
    }

    return Object.freeze({ recordResponse, capturePreview, collect,
        diagnostics: () => ({ ...counters }), reset: () => { counters = createCounters(); } });
}
