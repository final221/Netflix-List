// Temporary copied evidence for the native GraphQL pagination/render contract.
export function createRecommendationRequests(environment) {
    const { location, performance } = environment;
    const original = environment.fetch, records = [], readers = new Set();
    let active = true, until = -1, dropped = 0, failures = 0;
    const now = () => performance?.now() ?? Date.now();
    function responseFacts(root) {
        const collections = [], pagination = [], queue = [[root, 'data', 0]]; let visited = 0;
        while (queue.length && visited++ < 3000) {
            const [value, path, depth] = queue.shift();
            if (!value || typeof value !== 'object' || depth > 8) continue;
            if (Array.isArray(value)) {
                const ids = value.slice(0, 16).map(item => item?.videoId || item?.id || item?.node?.videoId || item?.node?.id || item?.video?.id)
                    .map(String).filter(id => /^\d+$/.test(id));
                if (collections.length < 12) collections.push({ path, length: value.length, ids, idsTruncated: value.length > 16,
                    itemKeys: value[0] && typeof value[0] === 'object' ? Object.keys(value[0]).slice(0, 12) : [] });
                value.slice(0, 32).forEach((item, i) => queue.push([item, `${path}.${i}`, depth + 1]));
            } else for (const key of Object.keys(value).slice(0, 32)) {
                if (/auth|token|cookie|credential|profile|account|session/i.test(key)) continue;
                if (!/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(key)) continue;
                const child = value[key], next = `${path}.${key}`;
                if (/^(totalCount|count|hasNextPage|hasPreviousPage|offset|pageSize)$/i.test(key) && pagination.length < 16 &&
                    (typeof child === 'boolean' || Number.isSafeInteger(child) && child >= 0)) pagination.push({ path: next, value: child });
                if (child && typeof child === 'object') queue.push([child, next, depth + 1]);
            }
        }
        return { collections, pagination, traversalTruncated: queue.length > 0 };
    }
    async function inspect(response, record) {
        let reader;
        try {
            if (!active || readers.size >= 4) { record.responseUnavailable = true; return; }
            reader = response.clone().body?.getReader();
            if (!reader) { record.responseUnavailable = true; return; }
            readers.add(reader); const chunks = []; let bytes = 0;
            while (active) {
                const { value, done } = await reader.read(); if (done) break;
                bytes += value.byteLength;
                if (bytes > 256 * 1024) { record.responseTruncated = true; await reader.cancel(); return; }
                chunks.push(value);
            }
            if (!active) return;
            const joined = new Uint8Array(bytes); let offset = 0;
            for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
            record.response = responseFacts(JSON.parse(new TextDecoder().decode(joined)));
        } catch (_) { if (active) { failures++; record.responseUnavailable = true; } }
        finally { if (reader) { readers.delete(reader); try { reader.releaseLock(); } catch (_) {} } }
    }
    function wrapped(...args) {
        const result = original.apply(this, args);
        try {
            if (!active || now() > until) return result;
            const url = new URL(typeof args[0] === 'string' ? args[0] : args[0]?.url || '', location.href);
            if (url.origin !== location.origin || !/graphql/i.test(url.pathname)) return result;
            const record = { at: now(), operation: 'unknown', variables: [], persistedQuery: false };
            const body = args[1] && Object.getOwnPropertyDescriptor(args[1], 'body')?.value, variables = url.searchParams.get('variables');
            if (typeof body === 'string' && body.length <= 65536 || typeof body !== 'string' && (!variables || variables.length <= 65536)) {
                const parsed = typeof body === 'string' ? JSON.parse(body) : {
                    operationName: url.searchParams.get('operationName'), variables: variables ? JSON.parse(variables) : {} };
                if (/^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(parsed.operationName || '')) record.operation = parsed.operationName;
                record.variables = Object.keys(parsed.variables || {}).slice(0, 24).map(name => ({ name: name.slice(0, 80), type: typeof parsed.variables[name],
                    ...(/^(first|last|limit|offset|count|pageSize)$/i.test(name) && Number.isSafeInteger(parsed.variables[name]) ? { value: parsed.variables[name] } : {}) }));
                const hash = parsed.extensions?.persistedQuery?.sha256Hash;
                record.persistedQuery = Boolean(parsed.extensions?.persistedQuery);
                if (/^[a-f0-9]{64}$/i.test(hash || '')) record.queryHash = hash;
            }
            records.push(record); if (records.length > 20) { records.shift(); dropped++; }
            Promise.resolve(result).then(response => { if (active) void inspect(response, record); }, () => { if (active) record.failed = true; });
        } catch (_) { failures++; }
        return result;
    }
    let installed = false;
    try { if (typeof original === 'function') { environment.fetch = wrapped; installed = environment.fetch === wrapped; } } catch (_) {}
    return { begin() { try { until = now() + 5000; } catch (_) { until = -1; failures++; } }, read() {
        return { installed, failures, dropped, pendingResponses: readers.size, records: JSON.parse(JSON.stringify(records)) };
    }, dispose() {
        active = false;
        try { if (environment.fetch === wrapped) environment.fetch = original; } catch (_) {}
        for (const reader of readers) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {}
        readers.clear(); records.length = 0;
    } };
}
