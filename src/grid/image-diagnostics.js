// Bounded route resource summaries and explicit Copy Logs thumbnail samples.
export function createImageDiagnostics(options) {
    const { window, location, performance, PerformanceObserver, getComputedStyle, readState, readSessionToken,
        isRouteSessionActive, gridOwnsClone, readScanFinishedAt } = options;
    const THUMBNAIL_DIAGNOSTIC_LIMITS = Object.freeze({ cards: 600, geometry: 24, resourceEntries: 2000 });
    const IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES = 4000;
    let imageResourceObserver = null;
    function createCounters() { return { scope: 'page-images-during-list-route', supported: false, active: false, stopReason: '',
                limit: IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES, batches: 0, entriesExamined: 0, beforeRouteOrInvalid: 0,
                skippedAtLimit: 0, imageEntries: 0, startedAfterViewingScan: 0, durationSamples: 0,
                totalFetchMs: 0, maxFetchMs: 0, lastImageStartOffsetMs: null, cacheDelivery: 0,
                transferBytesReported: 0, zeroTransferSizeEntries: 0, disconnectFailures: 0 }; }
    let resourceCounters = createCounters();
    function stopImageResourceDiagnostics(reason = 'route-leave', expected = imageResourceObserver) {
        const owner = imageResourceObserver;
        if (!owner || owner !== expected) return;
        imageResourceObserver = null;
        owner.counters.active = false;
        owner.counters.stopReason = reason;
        try { owner.observer?.disconnect(); } catch (_) { owner.counters.disconnectFailures++; }
    }


    function recordImageResourceEntries(owner, entries) {
        if (imageResourceObserver !== owner || !isRouteSessionActive(owner.sessionToken) ||
            resourceCounters !== owner.counters) return;
        const counters = owner.counters;
        counters.batches++;
        const count = Math.min(entries.length, IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES - counters.entriesExamined);
        const scanFinishedAt = readScanFinishedAt();
        for (let index = 0; index < count; index++) {
            const entry = entries[index];
            counters.entriesExamined++;
            if (!Number.isFinite(entry.startTime) || entry.startTime < owner.startedAt) {
                counters.beforeRouteOrInvalid++; continue;
            }
            if (entry.initiatorType !== 'img') continue;
            counters.imageEntries++;
            if (Number.isFinite(scanFinishedAt) && entry.startTime >= scanFinishedAt) counters.startedAfterViewingScan++;
            counters.lastImageStartOffsetMs = Math.max(counters.lastImageStartOffsetMs ?? 0, Math.round(entry.startTime - owner.startedAt));
            if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                counters.durationSamples++;
                counters.totalFetchMs += Math.round(entry.duration);
                counters.maxFetchMs = Math.max(counters.maxFetchMs, Math.round(entry.duration));
            }
            if (entry.deliveryType === 'cache') counters.cacheDelivery++;
            if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) counters.transferBytesReported += entry.transferSize;
            else if (entry.transferSize === 0) counters.zeroTransferSizeEntries++;
        }
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) {
            counters.skippedAtLimit += entries.length - count;
            stopImageResourceDiagnostics('entry-limit', owner);
        }
        // No URL is read or retained. These include native Netflix images as well as grid thumbnails.
    }


    function startImageResourceDiagnostics(sessionToken) {
        if (!isRouteSessionActive(sessionToken)) return;
        const counters = resourceCounters;
        if (imageResourceObserver?.sessionToken === sessionToken && imageResourceObserver.counters === counters) return;
        if (counters.entriesExamined >= IMAGE_RESOURCE_DIAGNOSTIC_MAX_ENTRIES) return;
        stopImageResourceDiagnostics('replaced');
        if (typeof PerformanceObserver !== 'function') {
            counters.stopReason = 'unsupported'; return;
        }
        const owner = { sessionToken, counters, startedAt: performance.now(), observer: null };
        try {
            const supportedTypes = PerformanceObserver.supportedEntryTypes;
            if (Array.isArray(supportedTypes) && !supportedTypes.includes('resource')) {
                counters.stopReason = 'unsupported'; return;
            }
            owner.observer = new PerformanceObserver(list => {
                if (imageResourceObserver !== owner || !isRouteSessionActive(sessionToken) ||
                    resourceCounters !== counters) return;
                try { recordImageResourceEntries(owner, list.getEntries()); }
                catch (_) { stopImageResourceDiagnostics('read-failed', owner); }
            });
            imageResourceObserver = owner;
            // Subscribe only to future entries. Do not enlarge or clear Netflix's saved timing buffer.
            owner.observer.observe({ entryTypes: ['resource'] });
            counters.supported = true;
            counters.active = true;
            counters.stopReason = '';
        } catch (_) {
            if (imageResourceObserver === owner) stopImageResourceDiagnostics('observe-failed');
            else counters.stopReason = 'observe-failed';
        }
    }


    function collectThumbnailDiagnostics(state = readState()) {
        const grid = state?.grid;
        const current = readState();
        if (!state || grid !== current?.grid || state.cloneMap !== current?.cloneMap || !grid?.isConnected || typeof state.cloneMap?.values !== 'function' ||
            !isRouteSessionActive(readSessionToken())) return { available: false, reason: 'no-current-grid' };
        const started = performance.now();
        const report = {
            available: true, scope: 'first-image-per-owned-card', limits: { ...THUMBNAIL_DIAGNOSTIC_LIMITS },
            mappedCards: state.cloneMap.size, cardsExamined: 0, truncated: state.cloneMap.size > THUMBNAIL_DIAGNOSTIC_LIMITS.cards,
            detachedCards: 0, cardsWithoutImage: 0, duplicateImagesSkipped: 0, images: 0,
            loading: { lazy: 0, eager: 0, other: 0 }, decoding: { async: 0, sync: 0, other: 0 },
            pixels: { ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 },
            sourceSelection: { current: 0, srcFallback: 0, unresolved: 0, invalidUrl: 0,
                graphqlAssigned: 0, graphqlSelectionMatches: 0, graphqlSelectionDiffers: 0, graphqlSelectionUnresolved: 0 },
            dimensionAttributes: { paired: 0, missingOrPartial: 0 },
            visibility: { renderEligible: 0, filterHidden: 0, collapsedWatched: 0, otherHidden: 0 }
        };
        const seen = new Set();
        const urls = new Set();
        const eligible = [];
        try {
            for (const clone of state.cloneMap.values()) {
                if (report.cardsExamined >= THUMBNAIL_DIAGNOSTIC_LIMITS.cards) break;
                report.cardsExamined++;
                if (!clone?.isConnected || !grid.contains(clone)) { report.detachedCards++; continue; }
                const image = clone.querySelector('img');
                if (!image) { report.cardsWithoutImage++; continue; }
                if (seen.has(image)) { report.duplicateImagesSkipped++; continue; }
                seen.add(image);
                report.images++;
                report.loading[['lazy', 'eager'].includes(image.loading) ? image.loading : 'other']++;
                report.decoding[['async', 'sync'].includes(image.decoding) ? image.decoding : 'other']++;
                const current = image.currentSrc || '';
                const src = image.src || image.getAttribute('src') || '';
                if (image.getAttribute('data-tm-graphql-image') === 'true') {
                    report.sourceSelection.graphqlAssigned++;
                    report.sourceSelection[!current ? 'graphqlSelectionUnresolved' : current === src ?
                        'graphqlSelectionMatches' : 'graphqlSelectionDiffers']++;
                }
                const hasSource = Boolean(current || src || image.getAttribute('srcset'));
                // Complete with intrinsic dimensions does not establish decode/paint completion.
                const status = !hasSource ? 'noSource' : image.complete !== true ? 'pending' :
                    image.naturalWidth > 0 && image.naturalHeight > 0 ? 'ready' : 'completeWithoutPixels';
                report.pixels[status]++;
                report.sourceSelection[current ? 'current' : src ? 'srcFallback' : 'unresolved']++;
                if (current || src) {
                    try {
                        const url = new URL(current || src, location.href);
                        if (url.protocol === 'https:' || url.protocol === 'http:') urls.add(url.href);
                    } catch (_) { report.sourceSelection.invalidUrl++; }
                }
                const width = Number(image.getAttribute('width'));
                const height = Number(image.getAttribute('height'));
                report.dimensionAttributes[Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ?
                    'paired' : 'missingOrPartial']++;
                if (gridOwnsClone(clone, grid)) {
                    report.visibility.renderEligible++;
                    eligible.push({ image, status });
                } else if (clone.getAttribute('data-tm-type-hidden') === 'true') report.visibility.filterHidden++;
                else if (clone.parentElement?.getAttribute('data-tm-watch-grid') === 'true' &&
                    clone.parentElement.parentElement?.open !== true) report.visibility.collapsedWatched++;
                else report.visibility.otherHidden++;
            }
        } catch (_) {
            return { ...report, available: false, reason: 'card-read-failed', elapsedMs: Math.round(performance.now() - started) };
        }
        report.geometry = sampleThumbnailGeometry(eligible);
        report.resourceTiming = collectThumbnailResourceTiming(urls, state.initializationStartedAt);
        report.elapsedMs = Math.round(performance.now() - started);
        // URLs and DOM references stay inside this call; only copied scalar summaries leave it.
        return report;
    }


    function sampleThumbnailGeometry(records) {
        const positions = () => ({ images: 0, ready: 0, pending: 0, completeWithoutPixels: 0, noSource: 0 });
        const viewport = window.visualViewport;
        const bounds = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
            width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
        const report = {
            available: true, positionAt: 'copy-time', bounds, eligibleImages: records.length, sampleCount: 0, rectReads: 0,
            styleAvailable: typeof getComputedStyle === 'function',
            inViewport: positions(), aboveViewport: positions(), belowViewport: positions(), outsideViewport: positions(), zeroArea: positions(),
            pendingWithImageBox: 0, pendingWithParentBox: 0, imageAspectRatioHint: 0, parentAspectRatioHint: 0, parentBlockPadding: 0,
            imageWidth: { min: null, max: null }, imageHeight: { min: null, max: null }
        };
        const count = Math.min(records.length, THUMBNAIL_DIAGNOSTIC_LIMITS.geometry);
        try {
            for (let index = 0; index < count; index++) {
                // Spread the fixed sample across eligible cards, including both ends of the list.
                const record = records[count === 1 ? 0 : Math.floor(index * (records.length - 1) / (count - 1))];
                report.rectReads++;
                const rect = record.image.getBoundingClientRect();
                const parent = record.image.parentElement;
                let parentRect = null;
                if (parent) { report.rectReads++; parentRect = parent.getBoundingClientRect(); }
                const hasBox = rect.width > 0 && rect.height > 0;
                const position = !hasBox ? 'zeroArea' : rect.bottom <= bounds.top ? 'aboveViewport' :
                    rect.top >= bounds.top + bounds.height ? 'belowViewport' :
                    rect.right > bounds.left && rect.left < bounds.left + bounds.width ? 'inViewport' : 'outsideViewport';
                report[position].images++;
                report[position][record.status]++;
                if (record.status === 'pending') {
                    if (hasBox) report.pendingWithImageBox++;
                    if (parentRect?.width > 0 && parentRect.height > 0) report.pendingWithParentBox++;
                }
                for (const [key, size] of [['imageWidth', rect.width], ['imageHeight', rect.height]]) {
                    if (!Number.isFinite(size)) continue;
                    const value = Math.round(size * 10) / 10;
                    report[key].min = report[key].min === null ? value : Math.min(report[key].min, value);
                    report[key].max = report[key].max === null ? value : Math.max(report[key].max, value);
                }
                if (report.styleAvailable) {
                    const imageStyle = getComputedStyle(record.image);
                    const parentStyle = parent ? getComputedStyle(parent) : null;
                    if (imageStyle?.aspectRatio && imageStyle.aspectRatio !== 'auto') report.imageAspectRatioHint++;
                    if (parentStyle?.aspectRatio && parentStyle.aspectRatio !== 'auto') report.parentAspectRatioHint++;
                    if (parseFloat(parentStyle?.paddingTop) > 0 || parseFloat(parentStyle?.paddingBottom) > 0) report.parentBlockPadding++;
                }
                report.sampleCount++;
            }
        } catch (_) { report.available = false; report.reason = 'read-failed'; }
        // A parent box or dimension hint is evidence to inspect, not proof of reserved artwork space or a layout shift.
        return report;
    }


    function collectThumbnailResourceTiming(urls, initializationStartedAt) {
        const report = {
            available: false, bufferedEntries: 0, examinedEntries: 0, truncated: false, imageEntriesExamined: 0,
            sourcesConsidered: urls.size, matchedEntries: 0, uniqueSourceMatches: 0, sourcesWithoutEntry: urls.size,
            entriesBeforeInitializationSkipped: 0,
            initializationStartKnown: Number.isFinite(initializationStartedAt), cacheDelivery: 0,
            positiveTransferSizeEntries: 0, zeroTransferSizeEntries: 0, unreportedTransferSizeEntries: 0, transferBytesReported: 0,
            fetchDurationMs: { samples: 0, total: 0, mean: null, max: null },
            positionAtRequestKnown: false, imageDecodeMeasured: false, layoutShiftsMeasured: false
        };
        if (typeof performance.getEntriesByType !== 'function') return { ...report, reason: 'unsupported' };
        try {
            const entries = performance.getEntriesByType('resource');
            report.bufferedEntries = entries.length;
            report.truncated = entries.length > THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries;
            const matched = new Set();
            const first = Math.max(0, entries.length - THUMBNAIL_DIAGNOSTIC_LIMITS.resourceEntries);
            for (let index = entries.length - 1; index >= first; index--) {
                const entry = entries[index];
                report.examinedEntries++;
                if (entry.initiatorType !== 'img') continue;
                report.imageEntriesExamined++;
                if (!urls.has(entry.name)) continue;
                if (report.initializationStartKnown && entry.startTime < initializationStartedAt) {
                    report.entriesBeforeInitializationSkipped++; continue;
                }
                report.matchedEntries++;
                matched.add(entry.name);
                if (Number.isFinite(entry.duration) && entry.duration >= 0) {
                    report.fetchDurationMs.samples++;
                    report.fetchDurationMs.total += entry.duration;
                    report.fetchDurationMs.max = Math.max(report.fetchDurationMs.max ?? 0, entry.duration);
                }
                if (entry.deliveryType === 'cache') report.cacheDelivery++;
                if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) {
                    report.positiveTransferSizeEntries++;
                    report.transferBytesReported += entry.transferSize;
                } else if (entry.transferSize === 0) report.zeroTransferSizeEntries++;
                else report.unreportedTransferSizeEntries++;
            }
            report.uniqueSourceMatches = matched.size;
            report.sourcesWithoutEntry = urls.size - matched.size;
            const durations = report.fetchDurationMs;
            durations.mean = durations.samples ? Math.round(durations.total / durations.samples * 10) / 10 : null;
            durations.total = Math.round(durations.total * 10) / 10;
            if (durations.max !== null) durations.max = Math.round(durations.max * 10) / 10;
            report.available = true;
        } catch (_) { report.reason = 'read-failed'; }
        // Resource history can be incomplete and cross-origin byte fields can be hidden.
        // Fetch duration is not decode/paint time; zero bytes does not establish a cache hit.
        return report;
    }

    // Public provider returns only copied scalar summaries; URLs/DOM stay inside sampling.
    return Object.freeze({ start: startImageResourceDiagnostics, dispose: stopImageResourceDiagnostics,
        collect: collectThumbnailDiagnostics, diagnostics: () => ({ ...resourceCounters }),
        reset: () => { stopImageResourceDiagnostics('reset'); resourceCounters = createCounters(); } });
}
