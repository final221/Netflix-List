// Strategy and completeness policy. Native proof and wire interpretation stay in adapters.
export function createCollection({ runChunks, assertSession, isCancelled, collectMounted,
    captureTemplate, assertSource, collectRecords, toRecord, waitInitialCount, readInitialFirstId, fetchBootstrap,
    onReuseRejected = () => {} }) {
    const reuse = { attempts: 0, reused: 0, rejected: 0, itemsCaptured: 0, requestsAvoided: 0 };
    const assertCount = count => {
        if (!Number.isFinite(count) || count < 0) throw Object.assign(new Error('List entry requires an authoritative nonnegative count'),
            { code: 'LIST_COUNT_INVALID' });
    };
    async function waitForInitialCount({ timeout, sessionToken = null, now, pause, read, pollMs = 25,
        assertCurrent = () => {}, onTimeout = () => Object.assign(new Error('Initial list count timed out'), { code: 'LIST_COUNT_TIMEOUT' }) }) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        guard(); const started = now(); let available = false;
        while (now() - started < timeout) {
            guard(); const facts = read();
            available = facts.available; const count = facts.count; guard();
            if (Number.isFinite(count) && count >= 0) return count;
            await pause(pollMs); guard();
        }
        guard(); const error = onTimeout({ available }); guard(); throw error;
    }
    async function prepareEntry({ entryKind, sessionToken = null, hasNativeSource = false,
        readMountedBootstrap, readMountedCards, startReadiness, onCount = () => {}, assertCurrent = () => {} }) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        const handled = promise => Promise.resolve(promise).then(value => ({ value }), error => ({ error }));
        let bootstrap, mountedSinglePage = false, readiness = null;
        guard();
        if (entryKind === 'initial') {
            const totalCount = await waitInitialCount(sessionToken); guard(); assertCount(totalCount);
            bootstrap = { totalCount, firstVideoId: readInitialFirstId() }; guard();
        } else {
            const mounted = hasNativeSource ? await readMountedBootstrap() : null; guard();
            if (mounted) {
                assertCount(mounted.totalCount);
                bootstrap = mounted; mountedSinglePage = true;
                onCount({ totalCount: mounted.totalCount, detectionReason: mounted.source,
                    firstVideoId: mounted.firstVideoId || null, elapsedMs: mounted.elapsedMs }); guard();
            } else {
                if (hasNativeSource) {
                    const count = readMountedCards(); guard();
                    if (count > 0) { readiness = handled(startReadiness()); guard(); }
                }
                bootstrap = await fetchBootstrap(sessionToken); guard(); assertCount(bootstrap.totalCount);
                onCount({ totalCount: bootstrap.totalCount, detectionReason: 'fresh-netflix-my-list-carousel',
                    firstVideoId: bootstrap.firstVideoId || null }); guard();
            }
        }
        const totalCount = bootstrap.totalCount; guard(); assertCount(totalCount);
        return Object.freeze({ bootstrap, totalCount, mountedSinglePage,
            async prepareAnchor({ mode, normalize }) {
                guard(); if (entryKind === 'initial' || mode !== 'indicator') return false;
                const firstVideoId = bootstrap.firstVideoId; guard();
                if (!firstVideoId) return false;
                await normalize(firstVideoId); guard(); return true;
            },
            confirmCount({ mode, readNativeCount, assertNativeCurrent = () => {} }) {
                guard(); if (mode !== 'logical') return null;
                const assertConfirmation = () => { guard(); assertNativeCurrent(); guard(); };
                const facts = readNativeCount(), confirmedCount = facts.totalCount, readings = facts.readings;
                assertConfirmation(); assertCount(confirmedCount);
                return Object.freeze({ totalCount: confirmedCount, readings,
                    changed: confirmedCount !== totalCount,
                    provisionalSource: entryKind === 'initial' ? 'graphql-cache' : 'fresh-netflix-my-list-carousel',
                    assertCurrent: assertConfirmation });
            },
            async prepareReadiness(prepare) {
                guard();
                if (!readiness) readiness = handled(prepare({ fastSinglePageTotalCount: mountedSinglePage ? totalCount : null }));
                const result = await readiness; guard();
                if (Object.hasOwn(result, 'error')) throw result.error;
                return result.value;
            } });
    }
    async function preparePreferred({ mode, bootstrap, sessionToken = null, assertCurrent = () => {}, readInput,
        onPrepared = () => {}, onIncomplete = () => {}, onFailure = () => {} }) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        guard();
        if (mode !== 'logical') return { bootstrap, items: null, collectionSource: 'graphql' };
        let current = bootstrap;
        try {
            const input = readInput(); guard();
            const result = await collectLogical({ ...input, bootstrap, sessionToken,
                assertCurrent() { guard(); input.assertCurrent?.(); guard(); } });
            guard(); current = result.bootstrap;
            if (result.error) throw result.error;
            if (result.items) onPrepared(result);
            else onIncomplete(result);
            guard(); return result;
        } catch (error) {
            guard();
            if (isCancelled(error) || error?.code === 'NATIVE_SOURCE_REPLACED') throw error;
            onFailure(error); guard();
            return { bootstrap: current, items: null, collectionSource: 'graphql' };
        }
    }
    async function collectForPublication({ preferred = null, totalCount, sessionToken = null, assertCurrent = () => {},
        onPreferred = () => {}, beforeNative = () => {}, collectNative, readEmpty,
        createFailure = facts => Object.assign(new Error(facts.code === 'NO_NATIVE_CARDS' ? 'No native cards could be collected' :
            `Collected ${facts.collected} of ${facts.totalCount} My List items`), facts, { stage: 'validate-count' }) }) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        guard(); assertCount(totalCount);
        let items;
        if (preferred?.items?.length === totalCount) {
            items = preferred.items; onPreferred(items); guard();
        } else {
            beforeNative(); guard();
            try { items = await collectNative(); }
            catch (error) { guard(); throw error; }
            guard();
        }
        if (!items.length) {
            const empty = readEmpty(), pages = empty.pages, cards = empty.cards; guard();
            if (totalCount === 0 && pages === 1 && cards === 0) return Object.freeze({ status: 'empty', transfer: prepareRecords(items, { assertCurrent: guard }) });
            const error = createFailure({ code: 'NO_NATIVE_CARDS', collected: 0, totalCount }); guard(); throw error;
        }
        if (items.length !== totalCount) {
            const error = createFailure({ code: 'COLLECTION_COUNT_MISMATCH', collected: items.length, totalCount }); guard(); throw error;
        }
        guard(); return Object.freeze({ status: 'complete', transfer: prepareRecords(items, {
            assertCurrent: guard, template: preferred?.items === items ? preferred.template : null,
            columns: preferred?.columns }) });
    }
    async function buildRecords(records, totalCount, template, sessionToken = null, assertCurrent = () => {}) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        guard();
        if (!Array.isArray(records) || !template || !Number.isFinite(totalCount)) return null;
        const items = [], seen = new Set();
        const complete = await runChunks(records.length, index => {
            guard();
            const record = records[index], videoId = record?.videoId;
            if (!videoId || seen.has(videoId)) return;
            items.push(toRecord({ ...record, graphql: true }));
            seen.add(videoId);
        }, guard);
        guard();
        return complete !== false && items.length === totalCount ? items : null;
    }
    async function collectLogical({ bootstrap, totalCount, columns, templateSource, sessionToken = null, assertCurrent = () => {} }) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        let current = bootstrap;
        try {
            guard();
            if (bootstrap?.source === 'mounted-single-page-fast-path') {
                const result = collectMounted(bootstrap, totalCount, columns, sessionToken); guard();
                reuse.attempts++;
                if (result.items && result.items.length === totalCount) {
                    reuse.reused++; reuse.itemsCaptured += result.items.length; reuse.requestsAvoided++;
                    return { bootstrap, items: result.items, collectionSource: 'mounted-single-page' };
                }
                reuse.rejected++;
                onReuseRejected({ collectionSource: 'mounted-single-page', reason: result.reason || 'incomplete-membership', totalCount }); guard();
            }
            const template = templateSource ? captureTemplate(templateSource.slot) : null;
            if (templateSource) assertSource(templateSource);
            guard();
            const data = await collectRecords({ bootstrap, totalCount, sessionToken });
            guard(); current = data.bootstrap;
            const items = await buildRecords(data.records, totalCount, template, sessionToken, assertCurrent);
            guard(); return { bootstrap: current, items, template, columns, ...(data.error ? { error: data.error } : {}) };
        } catch (error) {
            guard(); if (isCancelled(error)) throw error;
            return { bootstrap: current, items: null, error };
        }
    }
    function prepareRecords(items, { assertCurrent = () => {}, template = null, columns = 1 } = {}) {
        const materials = new Map(), inputs = [], records = [];
        const sharedMaterial = template ? Object.freeze({ source: template, template: true }) : null;
        assertCurrent();
        for (const input of items) {
            const record = toRecord(input), source = input.snapshot || input.cardTemplate || null;
            const material = source ? Object.freeze({ source, template: !input.snapshot && source === input.cardTemplate }) : sharedMaterial;
            assertCurrent(); records.push(record);
            if (source) inputs.push({ input, snapshot: input.snapshot, cardTemplate: input.cardTemplate, imageUrl: input.imageUrl });
            materials.set(record, { material, page: input.page ?? (template ? Math.floor((records.length - 1) / Math.max(1, columns)) : undefined) });
            assertCurrent();
        }
        let released = false;
        return Object.freeze({ records: Object.freeze(records), readMaterial(record) {
            if (released) return null;
            assertCurrent(); const material = materials.get(record)?.material || null; assertCurrent(); return material;
        }, readPage(record) {
            if (released) return undefined;
            assertCurrent(); const page = materials.get(record)?.page; assertCurrent(); return page;
        },
            release() {
                if (released) return;
                released = true; materials.clear();
                const pending = inputs.splice(0);
                let failure = null;
                for (const entry of pending) if (entry.snapshot || entry.cardTemplate) {
                    for (const field of ['snapshot', 'cardTemplate', 'imageUrl']) {
                        try { if (entry[field] && entry.input[field] === entry[field]) entry.input[field] = field === 'imageUrl' ? '' : null; }
                        catch (error) { failure ||= error; }
                    }
                }
                if (failure) throw failure;
            }, discard() { released = true; materials.clear(); inputs.length = 0; } });
    }
    return { preparePreferred, collectForPublication, waitForInitialCount, prepareEntry, collectLogical, prepareRecords,
        resetDiagnostics: () => { for (const key of Object.keys(reuse)) reuse[key] = 0; },
        diagnostics: () => Object.freeze({ membershipReuse: Object.freeze({ ...reuse }) }) };
}
