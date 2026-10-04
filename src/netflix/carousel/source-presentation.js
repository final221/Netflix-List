import { SECTION_ATTR, SOURCE_SCAN_CLASS, SOURCE_PARKED_CLASS, ORIGINAL_HIDDEN_CLASS,
    ORIGINAL_VISIBILITY_ATTR, ORIGINAL_HEADER_CLASS } from '../../dom-names.js';

// Private native decoration resources. Grid owns its frame; navigation owns motion.
export function createSourcePresentation({ document, pageDom, scope, generation, invalidateReads, createError, warn }) {
    const owners = new Map(), properties = new WeakMap();
    let restoreFailures = 0;
    const replaced = () => createError('NATIVE_SOURCE_REPLACED', 'native-presentation', 'Native presentation admission changed');
    function propertyMap(node) {
        if (!properties.has(node)) properties.set(node, new Map());
        return properties.get(node);
    }
    function write(owner, node, kind, name, value) {
        owner.guard();
        const map = propertyMap(node), key = kind + ':' + name;
        let entry = map.get(key);
        if (!entry) {
            entry = { node, kind, name, key, baseline: kind === 'class'
                ? node.classList.contains(name) : node.getAttribute(name) };
            map.set(key, entry);
        }
        entry.owner = owner;
        owner.entries.add(entry);
        if (kind === 'class') node.classList[value ? 'add' : 'remove'](name);
        else if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
        owner.guard();
    }
    function release(owner) {
        if (owner.released) return;
        owner.released = true;
        if (owners.get(owner.section) === owner) owners.delete(owner.section);
        let failures = 0;
        for (const entry of owner.entries) {
            if (entry.owner !== owner) continue;
            const map = properties.get(entry.node);
            if (map?.get(entry.key) !== entry) continue;
            map.delete(entry.key);
            try {
                if (entry.kind === 'class') entry.node.classList[entry.baseline ? 'add' : 'remove'](entry.name);
                else if (entry.baseline === null) entry.node.removeAttribute(entry.name);
                else entry.node.setAttribute(entry.name, entry.baseline);
            } catch (_) { failures++; }
        }
        owner.entries.clear();
        invalidateReads();
        if (failures) {
            restoreFailures = Math.min(Number.MAX_SAFE_INTEGER, restoreFailures + failures);
            try { warn('Native source presentation restoration failed', { failedFields: failures }); } catch (_) {}
        }
    }
    function present(options = {}) {
        const token = scope.token, admittedGeneration = generation();
        const assertCaller = options.assertCurrent || (() => {});
        const admit = () => {
            scope.assertCurrent(options.sessionToken ?? token); assertCaller();
            if (scope.token !== token || generation() !== admittedGeneration) throw replaced();
        };
        admit();
        if (options.phase !== undefined && !['mounted', 'scan', 'parked'].includes(options.phase)) {
            throw new TypeError('Invalid native presentation phase');
        }
        const section = options.section === undefined ? pageDom.findMyListSection() : options.section;
        if (!section) { admit(); return null; }
        const scroller = options.scroller === undefined ? section.querySelector(pageDom.selectors.carouselScroller) : options.scroller;
        const track = options.track === undefined ? (scroller && pageDom.findTrack(scroller)) : options.track;
        const references = () => {
            if (section.isConnected === false || scroller?.isConnected === false || track?.isConnected === false ||
                (scroller && section.contains && !section.contains(scroller)) ||
                (track && scroller?.contains && !scroller.contains(track)) ||
                (section.querySelector(pageDom.selectors.carouselScroller) || null) !== (scroller || null) ||
                (scroller && pageDom.findTrack(scroller)) !== track) throw replaced();
        };
        admit(); references();
        const previous = owners.get(section);
        const previousOperation = previous?.activeOperation;
        const title = section.querySelector(':scope > [data-uia="empty-carousel-section+title"]');
        const content = title && section.querySelector(':scope > [data-uia="empty-carousel-section+content"]');
        let anchor = content || title || section.querySelector('h2');
        if (!title && anchor) {
            while (anchor.parentElement && anchor.parentElement !== section) anchor = anchor.parentElement;
            if (anchor.parentElement !== section) anchor = null;
        }
        admit(); references();
        if (owners.get(section) !== previous || previous?.activeOperation !== previousOperation) throw replaced();
        let owner = previous;
        try { owner?.guard(); } catch (_) { owner = null; }
        if (owners.get(section) !== previous || previous?.activeOperation !== previousOperation) throw replaced();
        if (!owner || owner.scroller !== scroller || owner.track !== track || owner.anchor !== anchor) {
            owner = { section, scroller, track, token, generation: admittedGeneration, entries: new Set(),
                released: false, phase: previous?.phase || 'mounted', anchor };
            owners.set(section, owner);
            // Reuse baseline entries for shared nodes; obsolete cleanup must not
            // restore a field now borrowed by the replacement presentation.
            if (previous) {
                for (const entry of previous.entries) {
                    if (entry.owner !== previous) continue;
                    if (![section, scroller, track, title, anchor].includes(entry.node)) continue;
                    entry.owner = owner; owner.entries.add(entry);
                }
                release(previous);
            }
            owner.lease = Object.freeze({
                get anchor() { owner.guard(); return owner.anchor; },
                assertCurrent() { owner.guard(); return owner.lease; },
                release: () => release(owner)
            });
        }
        owner.guard = () => {
            admit(); references();
            if (owner.released || owners.get(section) !== owner || owner.anchor?.isConnected === false ||
                (owner.anchor && owner.anchor.parentElement !== section)) throw replaced();
        };
        const operation = {};
        owner.activeOperation = operation;
        const assertOperation = () => {
            if (owner.activeOperation !== operation) throw replaced();
            owner.guard();
            if (owner.activeOperation !== operation) throw replaced();
        };
        const paint = (node, kind, name, value) => {
            assertOperation(); write(owner, node, kind, name, value); assertOperation();
        };
        try {
            const phase = options.phase ?? owner.phase;
            paint(section, 'attribute', SECTION_ATTR, 'true');
            if (title) paint(title, 'class', ORIGINAL_HEADER_CLASS, true);
            if (anchor) paint(anchor, 'class', ORIGINAL_HEADER_CLASS, true);
            owner.anchor = anchor;
            if (track) paint(track, 'class', 'tm-netflix-mylist-v15-track', true);
            if (scroller && phase !== 'mounted') {
                paint(scroller, 'class', SOURCE_SCAN_CLASS, phase === 'scan');
                paint(scroller, 'class', SOURCE_PARKED_CLASS, phase === 'parked');
            }
            if (Object.hasOwn(options, 'visible')) {
                paint(section, 'class', ORIGINAL_HIDDEN_CLASS, !options.visible);
                paint(section, 'attribute', ORIGINAL_VISIBILITY_ATTR, options.visible ? 'true' : 'false');
            }
            assertOperation(); owner.phase = phase;
            invalidateReads();
            return owner.lease;
        } catch (error) {
            if (owner.activeOperation === operation) release(owner);
            throw error;
        }
    }
    function cleanupArtifacts({ sessionToken = scope.token, assertCurrent = () => {} } = {}) {
        const admittedGeneration = generation();
        const guard = () => {
            scope.assertCurrent(sessionToken); assertCurrent();
            if (generation() !== admittedGeneration) throw replaced();
        };
        guard();
        for (const section of document.querySelectorAll('[data-tm-mylist-v14], [data-tm-mylist-100-demo], [data-tm-mylist-clone-demo]')) {
            guard();
            for (const name of ['data-tm-mylist-v14', 'data-tm-mylist-100-demo', 'data-tm-mylist-clone-demo']) {
                guard(); section.removeAttribute(name);
            }
            guard(); section.style.removeProperty('--tm-source-width');
        }
        for (const scroller of document.querySelectorAll('.tm-netflix-mylist-v14-source, .tm-netflix-mylist-100-demo-source, .tm-netflix-mylist-100-demo-source-parked')) {
            guard(); scroller.classList.remove('tm-netflix-mylist-v14-source', 'tm-netflix-mylist-100-demo-source', 'tm-netflix-mylist-100-demo-source-parked');
            for (const name of ['--tm-source-width', '--slot-width', '--sp-slot-width']) {
                guard(); scroller.style.removeProperty(name);
            }
        }
        for (const slot of document.querySelectorAll('[data-tm-source-aligned], [data-tm-source-proxied]')) {
            for (const name of ['transform', 'transform-origin', 'z-index']) { guard(); slot.style.removeProperty(name); }
            guard(); slot.removeAttribute('data-tm-source-aligned');
            guard(); slot.removeAttribute('data-tm-source-proxied');
        }
        guard(); invalidateReads();
    }
    return Object.freeze({ present, cleanupArtifacts,
        dispose() { for (const owner of [...owners.values()]) release(owner); },
        diagnostics: () => ({ owners: owners.size, restoreFailures }) });
}
