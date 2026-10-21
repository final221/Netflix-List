// Exact suppression leases; reset restores only the registered owner.
export function createMotion({ borrowBinding, assertBinding, fastMoveClass }) {
    const motionOwners = new Map();
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

    return Object.freeze({ suppress, restoreMotion,
        pending: () => [...motionOwners.values()].reduce((count, owner) => count + owner.leases.size, 0) });
}
