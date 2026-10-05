// Script-owned viewing presentation. Placement/profile/storage decisions stay with viewing.
export function createGroups({ document, tUi, readRoot, getCard, assertCard, createError, moveCard, orderChildren, updateStatus,
    formatUiNumber = String, formatItemCount = String }) {
    let controlsByNode = new WeakMap(), actions = null, revision = 0, releaseFailures = 0;
    let ui = null, index = null, command = null, filters = { main: 'movie', watched: 'movie' }, expanded = false;
    let viewRevision = 0, syncDepth = 0, work = freshWork();
    function freshWork() { return { syncs: 0, fullSyncs: 0, cardsConsidered: 0, controlsUpdated: 0, categoryMoves: 0,
        hoverPreserved: 0, hoverCancelled: 0, lastReason: '' }; }
    function attemptRelease(action) { try { action(); } catch (_) { releaseFailures++; } }
    function releaseUi(resource) {
        if (!resource) return;
        for (const [node, type, listener] of resource.listeners) attemptRelease(() => node.removeEventListener(type, listener));
        for (const node of [resource.mainFilter?.root, resource.empty, resource.controls, resource.details]) if (node) attemptRelease(() => node.remove());
    }
    function writeProperty(node, property, value, guard) { guard(); if (node[property] !== value) node[property] = value; guard(); }
    function writeAttribute(node, property, value, guard) { guard(); if (node.getAttribute(property) !== value) node.setAttribute(property, value); guard(); }
    function presentationFor(value = index) {
        const counts = value?.counts || { main: { movie: 0, series: 0, all: 0 }, watched: { movie: 0, series: 0, all: 0 } };
        return Object.freeze({ initialized: Boolean(value), filters: Object.freeze({ ...filters }), expanded,
            counts: Object.freeze({ main: Object.freeze({ ...counts.main }), watched: Object.freeze({ ...counts.watched }) }),
            completedCount: counts.watched.all, unknownCount: value?.unknown || 0, visibleCount: counts.main[filters.main] });
    }
    function currentUi(resource) {
        if (ui !== resource || !command || command.root !== readRoot() || !command.root?.isConnected) return false;
        try { command.assertCurrent(); return true; } catch (_) { return false; }
    }
    function request(reason) {
        if (command.onRequest) command.onRequest(reason);
        else applyViewingChange({ ...command, changedIds: [], reason });
    }
    function ensureUi(root, guard) {
        if (ui?.grid === root) return ui;
        const previous = ui; ui = null; releaseUi(previous); guard();
        const resource = { grid: root, listeners: [] };
        const listen = (node, type, listener) => { resource.listeners.push([node, type, listener]); node.addEventListener(type, listener); };
        const filter = group => {
            const node = document.createElement('div'); node.setAttribute('data-tm-type-filter', group); node.setAttribute('role', 'group');
            node.setAttribute('aria-label', tUi(group === 'main' ? 'legacyMyList' : 'watchedCaughtUp') + ': ' + tUi('titleTypeFilter'));
            const buttons = new Map();
            for (const [type, key] of [['movie', 'filterFilms'], ['series', 'filterSeries'], ['all', 'filterAll']]) {
                const button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-tm-filter-value', type);
                const label = document.createElement('span'); label.textContent = tUi(key);
                const count = document.createElement('span'); count.setAttribute('data-tm-type-count', 'true');
                button.appendChild(label); button.appendChild(count);
                listen(button, 'click', () => {
                    if (!currentUi(resource) || filters[group] === type) return;
                    filters[group] = type; request('type-filter');
                });
                node.appendChild(button); buttons.set(type, { button, count, key });
            }
            return { root: node, buttons };
        };
        try {
            resource.details = document.createElement('details'); resource.details.setAttribute('data-tm-watch-section', 'true'); resource.details.open = expanded;
            resource.summary = document.createElement('summary'); resource.details.appendChild(resource.summary);
            resource.watchedGrid = document.createElement('div'); resource.watchedGrid.setAttribute('data-tm-watch-grid', 'true');
            resource.mainFilter = filter('main'); resource.watchedFilter = filter('watched');
            resource.watchedEmpty = document.createElement('p'); resource.watchedEmpty.setAttribute('data-tm-watch-empty', 'true');
            resource.watchedEmpty.textContent = tUi('noMatchingTitles');
            resource.details.appendChild(resource.watchedFilter.root); resource.details.appendChild(resource.watchedEmpty); resource.details.appendChild(resource.watchedGrid);
            resource.empty = document.createElement('p'); resource.empty.setAttribute('data-tm-watch-empty', 'true'); resource.empty.textContent = tUi('caughtUpMessage');
            resource.controls = document.createElement('div'); resource.controls.setAttribute('data-tm-watch-controls', 'true');
            resource.note = document.createElement('span'); resource.note.setAttribute('role', 'status');
            resource.refresh = document.createElement('button'); resource.refresh.type = 'button'; resource.refresh.textContent = tUi('refreshViewingStatus');
            listen(resource.refresh, 'click', () => { if (currentUi(resource) && !resource.refresh.disabled) command.onRefresh?.(); });
            resource.controls.appendChild(resource.note); resource.controls.appendChild(resource.refresh);
            listen(resource.details, 'toggle', () => {
                if (!currentUi(resource)) return;
                expanded = resource.details.open; command.onHoverChanged?.();
            });
            guard();
        } catch (error) { releaseUi(resource); throw error; }
        ui = resource; return resource;
    }
    function paintFilter(control, selected, counts, guard) {
        for (const [type, { button, count, key }] of control.buttons) {
            writeAttribute(button, 'aria-pressed', String(type === selected), guard);
            writeProperty(count, 'textContent', formatUiNumber(counts[type]), guard);
            writeAttribute(button, 'aria-label', tUi(key) + ': ' + formatItemCount(counts[type]), guard);
        }
    }
    function release(resource) {
        if (!resource) return;
        try { resource.root.removeEventListener('click', resource.listener, true); }
        catch (_) { releaseFailures++; }
    }
    function prepareCard(node, item) {
        let controls = controlsByNode.get(node);
        if (!controls || controls.root.parentElement !== node) {
            // Detached captured/replacement trees may contain copied controls without identity.
            for (const child of [...node.children]) {
                if (child.getAttribute('data-tm-viewing-actions') === 'true') child.remove();
            }
            const root = document.createElement('div'); root.setAttribute('data-tm-viewing-actions', 'true');
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('data-tm-viewing-action', 'toggle');
            const marker = document.createElement('span'); marker.setAttribute('data-tm-manual-choice', 'true'); marker.setAttribute('role', 'img');
            root.appendChild(toggle); root.appendChild(marker); node.appendChild(root);
            controls = { root, toggle, marker, item }; controlsByNode.set(node, controls);
        }
        return controls;
    }
    function updateCardPlacement(handle, facts, assertCurrent = () => {}) {
        let controls;
        const guard = () => {
            assertCurrent(); assertCard(handle);
            if (controls && (controlsByNode.get(handle.node) !== controls || controls.root.parentElement !== handle.node ||
                controls.toggle.parentElement !== controls.root || controls.marker.parentElement !== controls.root)) {
                throw createError('GRID_CONTROL_RETIRED', 'Placement controls changed');
            }
        };
        guard();
        controls = controlsByNode.get(handle.node);
        if (!controls || controls.root.parentElement !== handle.node) throw createError('GRID_CONTROL_RETIRED', 'Placement controls changed');
        const write = (read, apply, value) => { guard(); if (read() !== value) apply(value); guard(); };
        const label = tUi(facts.status === 'complete' ? 'moveBackToMyList' : facts.type === 'series' ? 'markCaughtUp' : 'markWatched');
        write(() => controls.toggle.textContent, value => { controls.toggle.textContent = value; }, label);
        write(() => controls.toggle.getAttribute('aria-label'), value => controls.toggle.setAttribute('aria-label', value),
            label + ': ' + (controls.item.ariaLabel || String(controls.item.videoId)));
        write(() => controls.toggle.disabled, value => { controls.toggle.disabled = value; }, Boolean(facts.disabled));
        write(() => controls.marker.textContent, value => { controls.marker.textContent = value; }, tUi('manualViewingChoice'));
        const description = tUi('manualViewingChoiceDescription');
        write(() => controls.marker.getAttribute('title'), value => controls.marker.setAttribute('title', value), description);
        write(() => controls.marker.getAttribute('aria-label'), value => controls.marker.setAttribute('aria-label', value), description);
        write(() => controls.marker.hidden, value => { controls.marker.hidden = value; }, !facts.manual);
    }
    function visible(node, root) {
        if (!node?.isConnected || !root?.isConnected || node.getAttribute('data-tm-type-hidden') === 'true') return false;
        if (node.parentElement === root) return true;
        const parent = node.parentElement, details = parent?.parentElement;
        return parent?.getAttribute('data-tm-watch-grid') === 'true' && details?.parentElement === root && details.open === true;
    }
    function attachPlacementActions({ assertCurrent, onAction }) {
        const root = readRoot(), owner = ++revision;
        const guard = () => {
            assertCurrent();
            if (revision !== owner || root !== readRoot() || !root?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Placement action frame changed');
        };
        guard();
        const previous = actions; actions = null; release(previous); guard();
        const resource = { root, listener: null };
        resource.listener = event => {
            if (actions !== resource) return;
            let button = event.target?.getAttribute ? event.target : event.target?.parentElement;
            while (button && button !== root && !button.getAttribute('data-tm-viewing-action')) button = button.parentElement;
            if (!button || button === root || button.getAttribute('data-tm-viewing-action') !== 'toggle') return;
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
            if (button.disabled) return;
            try { guard(); } catch (_) { return; }
            let node = button.parentElement;
            while (node && node !== root && !controlsByNode.has(node)) node = node.parentElement;
            const controls = controlsByNode.get(node);
            if (!controls || controls.toggle !== button || !visible(node, root)) return;
            const handle = getCard(controls.item);
            if (!handle || handle.node !== node) return;
            try { assertCard(handle); guard(); } catch (_) { return; }
            onAction(controls.item);
            try { guard(); } catch (_) { return; }
            const current = getCard(controls.item);
            if (!current || !visible(current.node, root)) {
                root.querySelector('[data-tm-watch-section]')?.querySelector('summary')?.focus?.({ preventScroll: true });
            }
        };
        actions = resource;
        root.addEventListener('click', resource.listener, true);
        try { guard(); } catch (error) { if (actions === resource) { actions = null; release(resource); } throw error; }
    }

    function applyViewingChange(input) {
        const { items, changedIds = null, readPlacement, assertCurrent, reason = 'reconcile' } = input;
        assertCurrent();
        const root = readRoot();
        if (!root?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Grouped publication changed');
        const owner = ++viewRevision, metadata = Object.freeze({ ...input.metadata });
        const guard = () => {
            assertCurrent();
            if (viewRevision !== owner || root !== readRoot() || !root?.isConnected) throw createError('GRID_FRAME_RETIRED', 'Grouped publication changed');
        };
        guard(); syncDepth++;
        try {
            const resource = ensureUi(root, guard), previous = index?.grid === root ? index : null;
            const full = changedIds === null || !previous || syncDepth > 1;
            const ids = full ? null : new Set([...changedIds].map(String));
            const next = full ? { grid: root, entries: new Map(), order: [], unknown: 0,
                counts: { main: { movie: 0, series: 0, all: 0 }, watched: { movie: 0, series: 0, all: 0 } } }
                : { ...previous, counts: { main: { ...previous.counts.main }, watched: { ...previous.counts.watched } } };
            const disabled = Boolean(metadata.disabled), locale = metadata.locale;
            let candidates = items;
            if (!full) {
                const selected = new Map();
                for (const id of ids) { const entry = previous.entries.get(id); if (entry) selected.set(id, entry.item); }
                if (previous.disabled !== disabled || previous.locale !== locale || previous.filters.main !== filters.main || previous.filters.watched !== filters.watched) {
                    for (const entry of previous.entries.values()) {
                        if (previous.disabled !== disabled || previous.locale !== locale || previous.filters[entry.group] !== filters[entry.group]) selected.set(entry.id, entry.item);
                    }
                }
                candidates = [...selected.values()];
            }
            const updates = [], staged = new Map(), counters = work;
            counters.syncs++; counters.lastReason = reason; if (full) counters.fullSyncs++;
            const countEntry = (entry, delta) => {
                next.counts[entry.group].all += delta;
                if (entry.type === 'movie' || entry.type === 'series') next.counts[entry.group][entry.type] += delta;
                if (entry.status === 'unknown') next.unknown += delta;
            };
            for (const item of candidates) {
                guard();
                const id = String(item.videoId), prior = previous?.entries.get(id), classify = full || ids.has(id);
                const facts = readPlacement(item, classify); guard();
                const status = classify ? facts.status : prior.status, type = classify ? facts.type : prior.type;
                const handle = getCard(item), clone = handle?.node;
                if (!clone) continue;
                assertCard(handle); counters.cardsConsidered++;
                const group = status === 'complete' ? 'watched' : 'main', hidden = filters[group] !== 'all' && filters[group] !== type;
                const manual = Boolean(facts.manual);
                if (!full && prior.clone === clone && prior.status === status && prior.type === type && prior.group === group && prior.hidden === hidden &&
                    prior.disabled === disabled && prior.locale === locale && prior.title === item.ariaLabel && prior.manual === manual &&
                    clone.parentElement === (group === 'main' ? root : resource.watchedGrid)) continue;
                const entry = { id, item, clone, handle, status, type, group, hidden, disabled, locale, title: item.ariaLabel, manual,
                    order: full ? next.order.length : prior.order };
                const controlsChanged = !prior || prior.clone !== clone || prior.group !== group || prior.type !== type || prior.disabled !== disabled ||
                    prior.locale !== locale || prior.title !== entry.title || prior.manual !== manual;
                const visibilityChanged = hidden !== (clone.getAttribute('data-tm-type-hidden') === 'true'); guard(); assertCard(handle);
                const moved = Boolean(prior && prior.group !== group) || clone.parentElement !== (group === 'main' ? root : resource.watchedGrid);
                if (!full) countEntry(prior, -1); countEntry(entry, 1); staged.set(id, entry);
                if (full) next.order.push(id);
                updates.push({ entry, controlsChanged, visibilityChanged, moved });
            }
            const counts = next.counts, visibleCount = counts.main[filters.main], visibleCompleted = counts.watched[filters.watched];
            const uiSignature = JSON.stringify([counts, next.unknown, filters, metadata.loading, metadata.manualFailure, locale,
                items.length, metadata.totalCount, metadata.initializationElapsedMs]);
            const uiChanged = uiSignature !== previous?.uiSignature;
            const targets = [...new Set(input.readProtectedCards?.() || [])]; guard();
            const beforeRects = new Map();
            if (uiChanged || full || updates.some(update => update.moved || update.visibilityChanged || update.controlsChanged)) {
                for (const clone of targets) { guard(); beforeRects.set(clone, clone.getBoundingClientRect()); guard(); }
            }
            for (const { entry, controlsChanged, visibilityChanged, moved } of updates) {
                const cardGuard = () => { guard(); assertCard(entry.handle); };
                cardGuard();
                if (controlsChanged) { updateCardPlacement(entry.handle, entry, cardGuard); counters.controlsUpdated++; }
                if (visibilityChanged) {
                    if (entry.hidden) entry.clone.setAttribute('data-tm-type-hidden', 'true');
                    else entry.clone.removeAttribute('data-tm-type-hidden');
                    cardGuard();
                }
                if (moved || visibilityChanged) { input.releaseInteraction?.(entry.handle); cardGuard(); }
                if (moved && !full) {
                    const parent = entry.group === 'main' ? root : resource.watchedGrid;
                    let reference = entry.group === 'main' ? resource.empty : null;
                    for (let offset = entry.order + 1; offset < next.order.length; offset++) {
                        const candidate = staged.get(next.order[offset]) || next.entries.get(next.order[offset]);
                        if (candidate.group === entry.group && candidate.clone.parentElement === parent) { reference = candidate.clone; break; }
                    }
                    moveCard(entry.handle, parent, reference); cardGuard(); counters.categoryMoves++;
                }
            }
            if (full) {
                const remaining = [], completed = [];
                for (const entry of staged.values()) (entry.group === 'watched' ? completed : remaining).push(entry.clone);
                counters.categoryMoves += updates.filter(update => update.moved).length;
                guard(); orderChildren(root, [resource.mainFilter.root, ...remaining, resource.empty, resource.controls, resource.details], guard); guard();
                orderChildren(resource.watchedGrid, completed, guard); guard();
            }
            if (uiChanged) {
                paintFilter(resource.mainFilter, filters.main, counts.main, guard); paintFilter(resource.watchedFilter, filters.watched, counts.watched, guard);
                writeProperty(resource.empty, 'hidden', visibleCount > 0, guard);
                writeProperty(resource.empty, 'textContent', metadata.loading ? tUi('checkingViewingStatus')
                    : !counts.main.all && counts.watched.all ? tUi('caughtUpMessage') : tUi('noMatchingTitles'), guard);
                writeProperty(resource.watchedEmpty, 'hidden', visibleCompleted > 0, guard);
                writeProperty(resource.refresh, 'disabled', Boolean(metadata.loading), guard);
                writeProperty(resource.summary, 'textContent', tUi('watchedCaughtUp') + ' (' + formatUiNumber(counts.watched.all) + ')', guard);
                let note = metadata.loading ? tUi('checkingViewingStatus') : next.unknown ? tUi('unknownViewingStatus', { count: formatUiNumber(next.unknown) }) : '';
                const unknownTypes = counts.main.all - counts.main.movie - counts.main.series;
                if (unknownTypes && filters.main !== 'all') note += (note ? ' ' : '') + tUi('unknownTitleTypes', { count: formatUiNumber(unknownTypes) });
                if (metadata.manualFailure) note += (note ? ' ' : '') + tUi('viewingChoiceStorageFailed');
                writeProperty(resource.note, 'textContent', note, guard);
                if (input.formatHeader) { const header = input.formatHeader(presentationFor(next)); guard(); updateStatus(header, guard); guard(); }
            }
            guard();
            for (const [id, entry] of staged) next.entries.set(id, entry);
            next.filters = { ...filters }; next.disabled = disabled; next.locale = locale; next.uiSignature = uiSignature;
            index = next; command = { ...input, root, metadata };
            if (!actions || actions.root !== root) attachPlacementActions({ assertCurrent: () => {
                if (!currentUi(resource)) throw createError('GRID_FRAME_RETIRED', 'Grouped action owner changed');
            }, onAction: item => command.onAction?.(item) });
            guard();
            const hoverChanged = targets.some(clone => {
                guard();
                if (!visible(clone, root)) return true;
                const before = beforeRects.get(clone); if (!before) return false;
                const after = clone.getBoundingClientRect(); guard();
                return ['left', 'top', 'width', 'height'].some(key => Math.abs(before[key] - after[key]) > 0.5);
            }) || input.isProtectedSourceCurrent?.() === false;
            guard();
            if (hoverChanged) { input.onHoverChanged?.(); guard(); counters.hoverCancelled++; }
            else if (targets.length) counters.hoverPreserved++;
            return presentationFor();
        } finally { syncDepth--; }
    }
    function replacePresentation(previous, next) {
        const entry = index?.entries.get(String(next.node.__tmMyListItem?.videoId));
        if (!entry || entry.clone !== previous.node || index.grid !== readRoot() || !command) return;
        const admission = command, root = readRoot();
        const guard = () => { admission.assertCurrent(); assertCard(next); if (command !== admission || readRoot() !== root) throw createError('GRID_FRAME_RETIRED', 'Replacement presentation changed'); };
        guard(); const facts = admission.readPlacement(entry.item, true); guard();
        updateCardPlacement(next, { ...facts, disabled: admission.metadata.disabled }, guard);
        if (entry.hidden) next.node.setAttribute('data-tm-type-hidden', 'true'); else next.node.removeAttribute('data-tm-type-hidden');
        guard(); entry.clone = next.node; entry.handle = next;
    }
    function retireRoot(root) {
        retireActions(root);
        if (ui?.grid !== root) return;
        viewRevision++;
        const previous = ui; ui = index = command = null; releaseUi(previous);
    }
    function resetViewing() {
        const owner = ++viewRevision;
        const previous = ui, previousIndex = index, root = readRoot();
        ui = index = command = null; filters = { main: 'movie', watched: 'movie' }; expanded = false; work = freshWork();
        retireActions(previous?.grid);
        try { if (root?.isConnected && previous?.grid === root && previousIndex) {
            for (const entry of previousIndex.entries.values()) {
                if (viewRevision !== owner || readRoot() !== root) break;
                const current = getCard(entry.item);
                if (current?.node === entry.clone && entry.clone.parentElement !== root) moveCard(current, root, null);
            }
        } } finally { releaseUi(previous); }
    }

    function retirePresentation() {
        viewRevision++; revision++;
        const previous = { actions, ui };
        actions = ui = index = command = null; controlsByNode = new WeakMap();
        filters = { main: 'movie', watched: 'movie' }; expanded = false; work = freshWork();
        return previous;
    }
    function releasePresentation(previous) { release(previous.actions); releaseUi(previous.ui); }
    function dispose() { releasePresentation(retirePresentation()); }
    function retireActions(root) {
        if (actions?.root !== root) return;
        revision++;
        const previous = actions; actions = null; release(previous);
    }
    return { prepareCard, updateCardPlacement, attachPlacementActions, retireActions, retireRoot, resetViewing, applyViewingChange, replacePresentation, dispose,
        retirePresentation, releasePresentation,
        presentation: presentationFor, groupDiagnostics: () => Object.freeze({ ...work }),
        isCardVisible(node, root = readRoot()) {
            const controls = node && controlsByNode.get(node);
            return Boolean(root === readRoot() && controls && getCard(controls.item)?.node === node && visible(node, root));
        },
        diagnostics: () => ({ placementReleaseFailures: releaseFailures }) };
}
