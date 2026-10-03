// Private carousel navigation resources. The movement algorithms transfer here
// during P09; other features use the carousel facade, never this module.
export function createNavigation({ borrowBinding, assertBinding, createError, fastMoveClass }) {
    let epoch = 0;
    let sequence = 0;
    let tail = Promise.resolve();
    const moves = new Set();
    const motionOwners = new Map();

    function begin(section, scroller) {
        const binding = borrowBinding(section, scroller);
        assertBinding(binding);
        const ownerEpoch = epoch;
        const previous = tail;
        let resolve;
        tail = new Promise(done => { resolve = done; });
        let released = false;
        let startedSequence = null;
        const assertCurrent = () => {
            if (ownerEpoch !== epoch || released) {
                throw createError('NATIVE_SOURCE_REPLACED', 'native-navigation', 'Native navigation owner changed');
            }
            assertBinding(binding);
        };
        const release = () => {
            if (released) return;
            released = true;
            moves.delete(ticket);
            resolve();
        };
        const ticket = Object.freeze({ ready: previous.catch(() => {}).then(assertCurrent), assertCurrent,
            start() { assertCurrent(); return startedSequence ??= ++sequence; }, release });
        moves.add(ticket);
        return ticket;
    }
    function capture(track, property) {
        return Object.freeze({ value: track.style.getPropertyValue(property),
            priority: track.style.getPropertyPriority(property) });
    }
    function restore(track, property, saved) {
        if (!saved.value) track.style.removeProperty(property);
        else track.style.setProperty(property, saved.value, saved.priority || '');
    }
    function restoreOwner(owner) {
        if (motionOwners.get(owner.track) !== owner) return;
        // Retire before restoring: failed writes cannot leave a live owner.
        motionOwners.delete(owner.track);
        owner.leases.clear();
        let failure;
        for (const operation of [
            () => { if (!owner.hadClass) owner.section.classList.remove(fastMoveClass); },
            () => restore(owner.track, 'transition', owner.transition),
            () => restore(owner.track, 'animation', owner.animation),
            () => { void owner.track.offsetWidth; }
        ]) {
            try { operation(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    }
    function suppress(section, track) {
        const binding = borrowBinding(section, null, track);
        assertBinding(binding);
        let owner = motionOwners.get(track);
        if (owner) assertBinding(owner.binding);
        else {
            owner = { section, track, binding, leases: new Set(),
                hadClass: section.classList.contains(fastMoveClass),
                transition: capture(track, 'transition'), animation: capture(track, 'animation') };
            motionOwners.set(track, owner);
            try {
                section.classList.add(fastMoveClass);
                track.style.setProperty('transition', 'none', 'important');
                track.style.setProperty('animation', 'none', 'important');
                void track.offsetWidth;
            } catch (error) {
                try { restoreOwner(owner); } catch (_) {}
                throw error;
            }
        }
        let released = false;
        const lease = Object.freeze({
            release() {
                if (released) return;
                released = true;
                if (motionOwners.get(track) !== owner) return;
                owner.leases.delete(lease);
                if (!owner.leases.size) restoreOwner(owner);
            },
            restored: () => track.style.getPropertyValue('transition') === owner.transition.value &&
                track.style.getPropertyPriority('transition') === owner.transition.priority &&
                section.classList.contains(fastMoveClass) === owner.hadClass
        });
        owner.leases.add(lease);
        return lease;
    }
    function restoreMotion() {
        for (const owner of [...motionOwners.values()]) {
            try { restoreOwner(owner); } catch (_) {}
        }
    }
    function reset() {
        epoch++;
        restoreMotion();
        for (const move of [...moves]) move.release();
        tail = Promise.resolve();
    }
    return Object.freeze({ begin, suppress, restoreMotion, reset, whenIdle: () => tail,
        diagnostics: () => ({ pendingMoves: moves.size,
            motionLeases: [...motionOwners.values()].reduce((count, owner) => count + owner.leases.size, 0) }) });
}
