// Strategy and completeness policy. Native proof and wire interpretation stay in adapters.
export function createCollection({ runChunks, assertSession, isCancelled, collectMounted,
    captureTemplate, assertSource, collectRecords, toRecord, onReuseRejected = () => {} }) {
    const reuse = { attempts: 0, reused: 0, rejected: 0, itemsCaptured: 0, requestsAvoided: 0 };
    async function buildItems(records, totalCount, columns, template, sessionToken = null, assertCurrent = () => {}) {
        const guard = () => { assertSession(sessionToken); assertCurrent(); };
        guard();
        if (!Array.isArray(records) || !template || !Number.isFinite(totalCount)) return null;
        const items = [], seen = new Set();
        const complete = await runChunks(records.length, index => {
            guard();
            const record = records[index], videoId = record?.videoId;
            if (!videoId || seen.has(videoId)) return;
            const itemIndex = items.length;
            items.push({ ...record, page: Math.floor(itemIndex / Math.max(1, columns)), logicalIndex: itemIndex,
                cardTemplate: template, graphql: true });
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
            const items = await buildItems(data.records, totalCount, columns, template, sessionToken, assertCurrent);
            guard(); return { bootstrap: current, items, ...(data.error ? { error: data.error } : {}) };
        } catch (error) {
            guard(); if (isCancelled(error)) throw error;
            return { bootstrap: current, items: null, error };
        }
    }
    function prepareRecords(items, { assertCurrent = () => {} } = {}) {
        const materials = new Map(), inputs = [], records = [];
        assertCurrent();
        for (const input of items) {
            const record = toRecord(input), source = input.snapshot || input.cardTemplate || null;
            const material = source ? Object.freeze({ source, template: !input.snapshot && source === input.cardTemplate }) : null;
            assertCurrent(); records.push(record);
            inputs.push({ input, snapshot: input.snapshot, cardTemplate: input.cardTemplate, imageUrl: input.imageUrl });
            materials.set(record, material);
            assertCurrent();
        }
        let released = false;
        return Object.freeze({ records: Object.freeze(records), readMaterial(record) {
            if (released) return null;
            assertCurrent(); const material = materials.get(record) || null; assertCurrent(); return material;
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
    return { buildItems, collectLogical, prepareRecords, resetDiagnostics: () => { for (const key of Object.keys(reuse)) reuse[key] = 0; },
        diagnostics: () => Object.freeze({ membershipReuse: Object.freeze({ ...reuse }) }) };
}
