import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, Element } from './helpers/dom.js';

async function fixture(overrides = {}) {
    const { createGrid } = await import('../src/grid/grid.js');
    const document = createDocument();
    const section = document.body.appendChild(new Element('section'));
    const anchor = section.appendChild(new Element());
    const status = section.appendChild(new Element());
    const retired = [], replaced = [];
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        runChunks: async (count, visit, guard) => { for (let i = 0; i < count; i++) { guard(); visit(i); guard(); } },
        onRetire: (handle, detail) => retired.push({ handle, detail }),
        onReplace: (old, next) => replaced.push({ old, next }), ...overrides });
    const item = (id = '1') => {
        const snapshot = new Element();
        const card = snapshot.appendChild(new Element('a'));
        card.setAttribute('data-uia', 'standard-card');
        card.href = `https://www.netflix.com/browse?jbv=${id}`;
        card.setAttribute('href', card.href);
        return { videoId: id, href: card.href, ariaLabel: 'Title ' + id, page: 0, snapshot };
    };
    const publish = items => grid.publish({ items, section, anchor, status,
        geometry: { left: 10, width: 600, columns: 6 }, layout: { gap: 8, rowGap: 10 }, assertCurrent() {} });
    return { grid, document, section, anchor, status, item, publish, retired, replaced };
}

test('grid publishes complete cards, releases startup material and exposes only a read-only registry', async () => {
    const e = await fixture();
    const items = [e.item('1'), e.item('2')];
    const root = await e.publish(items);
    assert.equal(e.grid.cards.size, 2);
    assert.equal(e.grid.cards.set, undefined);
    assert.equal(e.grid.cards.delete, undefined);
    assert.equal(root.isConnected, true);
    for (const item of items) {
        assert.equal(item.snapshot, null);
        const handle = e.grid.getCard(item);
        assert.equal(handle.node.parentElement, root);
        e.grid.assertCard(handle);
        assert.equal(e.grid.getCard({ ...item }), null, 'record identity participates in admission');
    }
});

test('grid rejects retired, copied and replaced handles while same-attempt replacement returns an admitted handoff', async () => {
    const e = await fixture();
    const item = e.item();
    await e.publish([item]);
    const old = e.grid.getCard(item);
    const attempt = { token: 8 };
    const fresh = old.node.cloneNode(true);
    const next = e.grid.replaceCard(old, { node: fresh, attempt, assertCurrent() {} });
    assert.equal(e.grid.isCardCurrent(old), false);
    assert.equal(e.grid.isCardCurrent({ ...next }), false);
    assert.throws(() => e.grid.assertCard(old), { code: 'GRID_CARD_RETIRED' });
    assert.equal(e.grid.getCard(item), next);
    assert.equal(e.retired[0].detail.attempt, attempt);
    assert.equal(e.replaced[0].next, next);
    assert.equal(old.node.isConnected, false);
    assert.equal(fresh.isConnected, true);
    assert.throws(() => e.grid.replaceCard(old, { node: old.node.cloneNode(true) }), { code: 'GRID_CARD_RETIRED' });
    e.grid.removeCard(next);
    assert.equal(e.grid.isCardCurrent(next), false);
});

test('grid retains Undo material by exact correlation and record, separately from active cards', async () => {
    const e = await fixture();
    const item = e.item();
    await e.publish([item]);
    const old = e.grid.getCard(item);
    e.grid.removeCard(old, { correlationId: 'removal-1' });
    assert.equal(e.grid.cards.size, 0);
    assert.equal(item.snapshot, null);
    assert.equal(e.grid.materialFor(item, 'removal-1'), old.node);
    assert.equal(e.grid.materialFor({ ...item }, 'removal-1'), null);
    assert.equal(e.grid.materialFor(item, 'expired-id'), null);
    const current = e.grid.insertCard(item, { index: 0, correlationId: 'removal-1' });
    assert.notEqual(current.node, old.node);
    assert.equal(e.grid.hasRetained('removal-1', item), false);
    assert.equal(e.grid.cards.size, 1);
    e.grid.removeCard(current, { correlationId: 'removal-2' });
    e.grid.releaseRetained('removal-1');
    assert.equal(e.grid.hasRetained('removal-2', item), true);
    e.grid.releaseRetained('removal-2');
    assert.equal(e.grid.materialFor(item, 'removal-2'), null);
});

test('stale chunked publication preserves the current tree and registry and leaves unaccepted material with its collector', async () => {
    let release, pending = false;
    const e = await fixture({ runChunks: async (count, visit, guard) => {
        for (let i = 0; i < count; i++) {
            guard(); visit(i);
            if (pending) await new Promise(resolve => { release = resolve; });
            guard();
        }
    } });
    const oldItem = e.item('1');
    const oldRoot = await e.publish([oldItem]);
    const oldMap = e.grid.cards;
    const item = e.item('2');
    pending = true;
    const build = e.publish([item]);
    const rejection = assert.rejects(build, { code: 'GRID_BUILD_REPLACED' });
    e.grid.cancelBuild();
    release();
    await rejection;
    assert.equal(e.grid.cards, oldMap);
    assert.equal(oldRoot.isConnected, true);
    assert.ok(item.snapshot);
    e.grid.assertCard(e.grid.getCard(oldItem));
});

test('replacement revalidates after callbacks and never overwrites a newer registry owner', async () => {
    let replacement;
    const e = await fixture({ prepareCard(node, item, detail) { if (replacement && detail.replacement) replacement(); } });
    const item = e.item();
    await e.publish([item]);
    const old = e.grid.getCard(item);
    replacement = () => { replacement = null; e.grid.removeCard(old); };
    assert.throws(() => e.grid.replaceCard(old, { node: old.node.cloneNode(true), assertCurrent() {} }),
        { code: 'GRID_CARD_RETIRED' });
    assert.equal(e.grid.cards.size, 0);
});

test('failed replacement preparation preserves the old card and failed post-commit presentation leaves a consistent unprepared current card', async () => {
    let fail = false;
    const released = [];
    const e = await fixture({ prepareCard() { if (fail) throw new Error('controls failed'); },
        onRetire: (handle, detail) => released.push({ handle, detail }),
        onReplace() { throw new Error('presentation failed'); } });
    const item = e.item();
    await e.publish([item]);
    const old = e.grid.getCard(item);
    fail = true;
    assert.throws(() => e.grid.replaceCard(old, { node: old.node.cloneNode(true) }), /controls failed/);
    e.grid.assertCard(old);
    assert.equal(released.length, 0);
    fail = false;
    assert.throws(() => e.grid.replaceCard(old, { node: old.node.cloneNode(true) }), /presentation failed/);
    const current = e.grid.getCard(item);
    e.grid.assertCard(current);
    assert.notEqual(current, old);
    assert.equal(e.grid.isCardCurrent(old), false);
    assert.equal(released.at(-1).handle, current);
    assert.equal(released.at(-1).detail.reason, 'replacement-presentation-failed');
});

test('disposal releases registry and retained material and prevents reentrant insertion from borrowing the retiring frame', async () => {
    let retiring = false, grid;
    const e = await fixture({ onRetire() { if (retiring) {
        assert.throws(() => grid.insertCard(e.item('9')), { code: 'GRID_FRAME_RETIRED' });
    } } });
    grid = e.grid;
    const first = e.item('1'), second = e.item('2');
    const root = await e.publish([first, second]);
    grid.removeCard(grid.getCard(first), { correlationId: 'undo-1' });
    const stale = grid.getCard(second);
    retiring = true;
    grid.dispose();
    grid.dispose();
    assert.equal(grid.isCardCurrent(stale), false);
    assert.equal(root.isConnected, false);
    assert.deepEqual(grid.diagnostics(), { activeCards: 0, retainedCards: 0, retirementFailures: 0 });
});

test('a failed retirement callback cannot prevent disposal of other cards or leave a retained registry view', async () => {
    let disposing = false;
    const released = [];
    const e = await fixture({ onRetire(handle) { if (disposing) { released.push(handle.key); throw new Error('native release failed'); } } });
    await e.publish([e.item('1'), e.item('2')]);
    const oldView = e.grid.cards;
    disposing = true;
    e.grid.dispose();
    assert.deepEqual(released, ['v:1', 'v:2']);
    assert.equal(oldView.size, 0);
    assert.deepEqual(e.grid.diagnostics(), { activeCards: 0, retainedCards: 0, retirementFailures: 2 });
});

test('empty frame accepts the first addition and can move between native and synthetic anchors without retaining retired cards', async () => {
    const e = await fixture();
    const facts = { section: e.section, anchor: e.anchor, status: e.status, layout: { gap: 8, rowGap: 10 },
        geometry: { width: 600, left: 10, columns: 6 }, assertCurrent() {} };
    const root = e.grid.mount(facts);
    const first = e.item();
    const handle = e.grid.insertCard(first);
    e.grid.assertCard(handle);
    assert.equal(handle.node.parentElement, root);
    assert.equal(root.getAttribute('data-tm-empty'), null);
    e.grid.clearCards();
    assert.equal(e.grid.isCardCurrent(handle), false);
    assert.equal(e.grid.cards.size, 0);
    assert.equal(root.children.length, 0);
    const synthetic = e.document.body.appendChild(new Element('section'));
    assert.equal(e.grid.mount({ ...facts, section: synthetic, anchor: null }), root);
    assert.equal(root.parentElement, synthetic);
    const second = e.item('2');
    const next = e.grid.insertCard(second);
    e.grid.assertCard(next);
    assert.equal(e.grid.mount(facts), root);
    assert.equal(root.parentElement, e.section);
    e.grid.assertCard(next);
});

test('a host exception after replacement commits cannot leave the registry pointing at the obsolete tree', async () => {
    const e = await fixture();
    const item = e.item();
    await e.publish([item]);
    const old = e.grid.getCard(item), fresh = old.node.cloneNode(true);
    const replace = old.node.replaceWith.bind(old.node);
    old.node.replaceWith = node => { replace(node); throw new Error('host commit failed'); };
    assert.throws(() => e.grid.replaceCard(old, { node: fresh }), /host commit failed/);
    const current = e.grid.getCard(item);
    assert.equal(current.node, fresh);
    e.grid.assertCard(current);
    assert.equal(e.grid.isCardCurrent(old), false);
    assert.equal(e.retired.at(-1).handle, current);
    assert.equal(e.retired.at(-1).detail.reason, 'replacement-commit-failed');
});
