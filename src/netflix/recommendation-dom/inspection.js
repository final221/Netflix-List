import { createRecommendationRequests } from '../recommendation-requests.js';
import { createLoaderSurvey } from '../recommendation-loader.js';

// Bounded passive investigation; detailed probing and observation remain explicitly requested.
export function createRecommendationInspection(environment, scan) {
    const { document, location, getComputedStyle, performance, PerformanceObserver } = environment;
    function loadingFacts(row, sampledCard = null) {
        const result = [], seen = new Set();
        try {
            const card = sampledCard || scan(row)[0]?.card;
            for (const root of [card, row]) {
                const key = root && Object.getOwnPropertyNames(root).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
                let fiber = key && root[key];
                for (let depth = 0; fiber && depth < 16 && result.length < 6 && !seen.has(fiber); depth++, fiber = fiber.return) {
                    seen.add(fiber);
                    const props = fiber.memoizedProps;
                    if (!props || typeof props !== 'object') continue;
                    const names = Object.keys(props).filter(name => /load|fetch|pagin|cursor|hasNext|itemCount|totalCount|rowId/i.test(name)).slice(0, 12);
                    if (!names.length) continue;
                    const type = fiber.elementType || fiber.type;
                    result.push({ depth, component: String(typeof type === 'string' ? type : type?.displayName || type?.name || 'unknown').slice(0, 80),
                        properties: names.map(name => ({ name: name.slice(0, 80), type: typeof Object.getOwnPropertyDescriptor(props, name)?.value })) });
                }
            }
        } catch (_) { return [{ unavailable: true }]; }
        return result;
    }
    function navigationStart(control, { detailed = true } = {}) {
        if (!detailed) return { at: diagnosticTime(), detailed: false };
        const components = []; let truncated = false, shapeBudget = 360; const quotas = { props: 0, state: 0 };
        const row = control.closest?.('section, .lolomoRow');
        const loader = createLoaderSurvey(row ? scan(row).slice(0, 120).map(item => item.id) : []);
        const pagination = []; let paginationTruncated = false;
        // Independent of the general shape budget: theme/portal state must not hide loader clues.
        function paginationFacts(root, depth, source) {
            const queue = [[root, '', 0]], seen = new Set(); let inspected = 0;
            while (queue.length && inspected++ < 32) {
                const [value, path, level] = queue.shift();
                if (!value || typeof value !== 'object' || seen.has(value)) continue;
                seen.add(value); loader.inspect(value, { depth, source, path });
                const keys = Object.keys(value).filter(name => /^[A-Za-z_0-9]{1,80}$/.test(name) &&
                    !/auth|token|cookie|credential|profile|account|session|theme|style|portal|toast/i.test(name));
                for (const name of keys.slice(0, 24)) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                    const next = path ? path + '.' + name : name;
                    let fact = null;
                    if (/^(load(More|Next|Previous)?|fetch(More|Next|Query|Page)?|prefetch|paginate|refetch|getRow)$/i.test(name)) {
                        if (descriptor?.get) fact = { kind: 'accessor' };
                        else if (typeof child === 'function') {
                            const arity = Object.getOwnPropertyDescriptor(child, 'length')?.value;
                            fact = { kind: 'callback', ...(Number.isSafeInteger(arity) && arity >= 0 && arity <= 100 ? { arity } : {}) };
                        }
                    } else if (/^(hasNext(Page)?|hasMore|isLoading(Next)?|isFetching(NextPage)?|loading)$/i.test(name) && typeof child === 'boolean')
                        fact = { kind: 'flag', value: child };
                    else if (name === 'name' && ['query', 'mutation', 'subscription'].includes(Object.getOwnPropertyDescriptor(value, 'operationKind')?.value) &&
                        typeof child === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(child)) fact = { kind: 'operation', operationName: child };
                    if (fact) {
                        if (pagination.length < 24) pagination.push({ depth, source, path: next, ...fact });
                        else paginationTruncated = true;
                    }
                    if (level < 5 && child && typeof child === 'object' && (Array.isArray(value) && /^\d+$/.test(name) && Number(name) < 8 ||
                        /^(pagination|fragment|environment|relay|params|variables|data|value|current|ref|state|cache)$/i.test(name)))
                        queue.push([child, next, level + 1]);
                }
                paginationTruncated ||= keys.length > 24;
            }
            paginationTruncated ||= queue.length > 0;
        }
        function shape(value, depth = 0) {
            if (!value || typeof value !== 'object' || depth >= 3 || shapeBudget <= 0) return {};
            const keys = Object.keys(value).filter(key => !/auth|token|cookie|credential|profile|account|session/i.test(key));
            const fields = [];
            for (const name of keys.slice(0, 12)) {
                if (--shapeBudget < 0) { truncated = true; break; }
                const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                fields.push({ name: name.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof child,
                    ...(Array.isArray(child) ? { length: child.length } : {}), ...shape(child, depth + 1),
                    ...(/count|index|offset|limit|pageSize/i.test(name) && Number.isSafeInteger(child) && child >= 0 ? { value: child } : {}),
                    ...(name === 'name' && typeof child === 'string' && ['query', 'mutation', 'subscription'].includes(Object.getOwnPropertyDescriptor(value, 'operationKind')?.value) && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(child || '') ? { operationName: child } : {}) });
            }
            return { fields, fieldsTruncated: fields.length < keys.length };
        }
        try {
            const key = Object.getOwnPropertyNames(control).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
            let fiber = key && Object.getOwnPropertyDescriptor(control, key)?.value;
            const seen = new Set();
            for (let depth = 0; fiber && depth < 24 && !seen.has(fiber); depth++, fiber = fiber.return) {
                seen.add(fiber);
                const sources = [['memoizedProps', Object.getOwnPropertyDescriptor(fiber, 'memoizedProps')?.value]];
                let state = Object.getOwnPropertyDescriptor(fiber, 'memoizedState')?.value;
                const hooks = new Set();
                if (state && Object.hasOwn(state, 'memoizedState') && Object.hasOwn(state, 'next')) {
                    for (let i = 0; state && i < 48 && !hooks.has(state); i++) {
                        hooks.add(state); sources.push([`hookState:${i}`, Object.getOwnPropertyDescriptor(state, 'memoizedState')?.value]);
                        state = Object.getOwnPropertyDescriptor(state, 'next')?.value;
                    }
                    truncated ||= Boolean(state);
                } else sources.push(['memoizedState', state]);
                const dependencies = Object.getOwnPropertyDescriptor(fiber, 'dependencies')?.value;
                let dependency = dependencies && Object.getOwnPropertyDescriptor(dependencies, 'firstContext')?.value;
                const contexts = new Set();
                for (let i = 0; dependency && i < 4 && !contexts.has(dependency); i++) {
                    contexts.add(dependency); sources.push(['context:' + i, Object.getOwnPropertyDescriptor(dependency, 'memoizedValue')?.value]);
                    dependency = Object.getOwnPropertyDescriptor(dependency, 'next')?.value;
                }
                for (const [source, value] of sources) {
                    if (!value || typeof value !== 'object') continue;
                    paginationFacts(value, depth, source);
                    const keys = Object.keys(value), fields = Array.isArray(value) ? [{ name: 'stateArray', type: 'array', length: value.length,
                        elements: Array.from({ length: Math.min(value.length, 4) }, (_, index) => {
                            const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), child = descriptor?.value;
                            return { type: descriptor?.get ? 'accessor' : typeof child, ...(Array.isArray(child) ? { length: child.length } : {}),
                                ...shape(child) };
                        }), elementsTruncated: value.length > 4 }] : [];
                    for (const name of keys.slice(0, 40)) {
                        if (/^data-|^tabIndex$|^next$|^baseState$|^baseQueue$|^queue$/i.test(name)) continue;
                        if (!/click|load|fetch|pagin|cursor|item|video|title|row|list|count|next|prev|index|data|cache|fragment|relay|environment|connection|pageInfo|params/i.test(name)) continue;
                        const descriptor = Object.getOwnPropertyDescriptor(value, name), child = descriptor?.value;
                        const fact = { name: name.slice(0, 80), type: descriptor?.get ? 'accessor' : typeof child };
                        if (Array.isArray(child)) fact.length = child.length;
                        else if (child && typeof child === 'object') {
                            Object.assign(fact, shape(child));
                        } else if (/count|index/i.test(name) && Number.isSafeInteger(child) && child >= 0) fact.value = child;
                        fields.push(fact);
                    }
                    truncated ||= keys.length > 40;
                    if (fields.length) {
                        const bucket = source === 'memoizedProps' ? 'props' : 'state';
                        if (quotas[bucket] >= (bucket === 'props' ? 10 : 20)) { truncated = true; continue; }
                        quotas[bucket]++;
                        const type = fiber.elementType || fiber.type;
                        components.push({ depth, source, component: String(typeof type === 'string' ? type : type?.displayName || type?.name || 'unknown').slice(0, 80), fields });
                    }
                }
                if (depth === 23 && fiber.return) truncated = true;
            }
            return { at: diagnosticTime(), components, truncated, pagination, paginationTruncated, loader: loader.snapshot(), control: controlFacts(control) };
        } catch (_) { return { at: diagnosticTime(), unavailable: true, components }; }
    }
    function controlFacts(control) {
        try {
            function describeNode(node) {
                const rect = node.getBoundingClientRect(), style = getComputedStyle?.(node);
                return { tag: node.tagName, rect: [rect.left, rect.top, rect.width, rect.height].map(value => Number.isFinite(value) ? Math.round(value) : null),
                    background: String(style?.backgroundColor || '').slice(0, 80), opacity: style?.opacity,
                    position: style?.position, height: style?.height, overflow: style?.overflow,
                    borderRadius: style?.borderRadius, clipPath: String(style?.clipPath || '').slice(0, 120) };
            }
            const nodes = [control, control.querySelector?.('button, [role="button"]')].filter(Boolean);
            const parents = []; let parent = control.parentElement;
            for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) parents.push(describeNode(parent));
            const rect = control.getBoundingClientRect(), hits = [];
            const viewport = document.documentElement?.clientWidth || environment.window?.innerWidth || environment.innerWidth;
            const points = [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].map(y => [rect.left + rect.width / 2, y]);
            for (const x of [rect.left + 2, rect.right - 2, 1, viewport - 1]) if (Number.isFinite(x)) points.push([x, rect.top + rect.height / 2]);
            if (document?.elementFromPoint && rect.height > 0) for (const [x, y] of points) {
                const hit = document.elementFromPoint(x, y);
                hits.push({ x: Math.round(x), y: Math.round(y), tag: hit?.tagName || null, inside: Boolean(hit && (hit === control || control.contains(hit))) });
            }
            return { nodes: nodes.map(describeNode), parents, icon: control.querySelector?.('svg, .indicator-icon') ? describeNode(control.querySelector('svg, .indicator-icon')) : null, hits };
        } catch (_) { return { unavailable: true }; }
    }
    function diagnosticTime() {
        try { const value = performance?.now(); return Number.isFinite(value) ? value : null; } catch (_) { return null; }
    }
    function requestRecord(entry) {
        if (!['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) return null;
        const url = new URL(entry.name, location.href);
        if (url.hostname !== 'netflix.com' && !url.hostname.endsWith('.netflix.com')) return null;
        return { startTime: entry.startTime, endpoint: /graphql/i.test(url.pathname) ? 'graphql' : /\/api\//i.test(url.pathname) ? 'api' : /falcor|pathEvaluator/i.test(url.pathname) ? 'falcor' : 'other',
            initiator: entry.initiatorType, durationMs: Math.round(entry.duration), transferBytes: Number(entry.transferSize) || 0,
            ...(/graphql/i.test(url.pathname) ? { sameOrigin: url.origin === new URL(location.href).origin,
                queryKeys: [...new Set(url.searchParams.keys())].filter(key => /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(key) && !/auth|token|cookie|credential|profile|account|session/i.test(key)).slice(0, 12),
                ...(/^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(url.searchParams.get('operationName') || '') ? { operation: url.searchParams.get('operationName') } : {}) } : {}) };
    }
    function observeRequests() {
        let graphql = null;
        let observer = null, active = true, dropped = 0, failures = 0; const records = [];
        function accept(entries) {
            if (!active) return;
            for (const entry of entries) try {
                const record = requestRecord(entry); if (!record) continue;
                if (records.length === 200) { records.shift(); dropped++; }
                records.push(record);
            } catch (_) { failures++; }
        }
        try {
            observer = new PerformanceObserver(list => { if (active) try { accept(list.getEntries()); } catch (_) { failures++; } });
            observer.observe({ type: 'resource', buffered: false });
        } catch (_) { try { observer?.disconnect(); } catch (_) {} observer = null; }
        return { begin({ detailed = false } = {}) {
            if (detailed) { graphql ||= createRecommendationRequests(environment); graphql.begin(); }
        }, read() {
            if (observer && active) try { accept(observer.takeRecords()); } catch (_) { failures++; }
            return { available: Boolean(observer && active), records: records.slice(), dropped, failures, graphql: graphql?.read() || null };
        }, dispose() { active = false; graphql?.dispose(); try { observer?.disconnect(); } catch (_) {} observer = null; records.length = 0; } };
    }
    function navigationRequests(start, stop = diagnosticTime(), capture = null) {
        try {
            if (!Number.isFinite(start) || !Number.isFinite(stop) || (!capture?.available && !performance?.getEntriesByType)) return { unavailable: true };
            const end = Math.min(stop, start + 5000), all = capture?.available ? capture.records : performance.getEntriesByType('resource'), entries = [];
            let matched = 0;
            for (const entry of all.slice(-2000)) {
                if (entry.startTime < start || entry.startTime >= end) continue;
                const record = capture?.available ? entry : requestRecord(entry); if (!record) continue;
                matched++;
                if (entries.length >= 24) continue;
                const { startTime, ...facts } = record;
                entries.push({ ...facts, offsetMs: Math.round(startTime - start) });
            }
            return { windowMs: Math.max(0, end - start), inspected: Math.min(all.length, 2000), bufferTruncated: all.length > 2000,
                matched, entries, truncated: matched > entries.length, attribution: 'time-window-only',
                source: capture?.available ? 'future-observer' : 'buffered-fallback', dropped: capture?.dropped || 0, failures: capture?.failures || 0,
                graphql: capture?.graphql ? { ...capture.graphql, records: capture.graphql.records.filter(record => record.at >= start && record.at < end) } : null,
                limitation: 'Completed entries only; absent entries do not prove cached data, and zero transfer does not prove cache use.' };
        } catch (_) { return { unavailable: true }; }
    }

    return Object.freeze({ loadingFacts, navigationStart, navigationRequests, observeRequests });
}
