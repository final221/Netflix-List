import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createDocument, Element } from './helpers/dom.js';
import { GRID_ID, STATUS_ID, STYLE_ID, LOG_LINK_ID, STATUS_LABEL_CLASS, STATUS_META_CLASS,
    ORDER_MISMATCH_DIALOG_ID, OLD_IDS, OLD_STYLE_IDS } from '../src/dom-names.js';

function fixture(options = {}) {
    const document = createDocument(), timers = new Map();
    let timerId = 0, active = true;
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        runChunks: async (count, visit, guard) => { for (let i = 0; i < count; i++) { guard(); visit(i); } },
        tLog: key => 'log:' + key,
        setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id), isActive: () => active, ...options });
    const section = document.body.appendChild(new Element('section'));
    const anchor = section.appendChild(new Element('h2'));
    const mount = () => {
        const status = grid.updateStatus({ label: 'My List', meta: '0 titles' });
        grid.mount({ section, anchor, status, geometry: { left: 20, width: 600, columns: 6 },
            layout: { gap: 8, rowGap: 12 }, assertCurrent() {} });
        return status;
    };
    return { grid, document, timers, section, anchor, mount, leave: () => { active = false; } };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function click(node) { node.dispatchEvent({ type: 'click', currentTarget: node, preventDefault() {} }); }

test('grid owns one detached/current status and preserves separated label, meta, geometry and CopyLogs', () => {
    const e = fixture();
    const first = e.grid.updateStatus('Loading');
    assert.equal(e.grid.updateStatus({ label: 'My List', meta: '6 titles' }), first);
    assert.equal(first.querySelector('.' + STATUS_LABEL_CLASS).textContent, 'My List');
    assert.equal(first.querySelector('.' + STATUS_META_CLASS).textContent, '6 titles');
    assert.equal(first.querySelector('#' + LOG_LINK_ID).listenerCount('click'), 1);
    assert.equal(e.mount(), first);
    assert.equal(e.document.getElementById(STATUS_ID), first);
    e.grid.layoutStatus(first, { left: 15, width: 500 }, 9);
    e.grid.applyStatusTypography(first, { 'font-size': '20px', color: 'white' });
    assert.equal(first.style.marginLeft, '15px');
    assert.equal(first.style.width, '500px');
    assert.equal(first.style.getPropertyValue('--tm-row-gap'), '9px');
    assert.equal(first.style.getPropertyValue('font-size'), '20px');
    assert.equal(e.anchor.nextElementSibling, first);
    assert.equal(first.nextElementSibling.id, GRID_ID);
});

test('CopyLogs owns its finite feedback timer and disposal cancels feedback and detached actions', async () => {
    let copies = 0;
    const e = fixture({ copyLogs: async () => { copies++; } });
    const status = e.mount(), link = status.querySelector('#' + LOG_LINK_ID);
    click(link); await flush();
    assert.equal(copies, 1);
    assert.equal(link.textContent, 'log:copied');
    assert.equal(e.timers.size, 1);
    const restore = [...e.timers.values()][0]; e.timers.clear(); restore();
    assert.equal(link.textContent, 'CopyLogs');
    assert.equal(link.title, 'log:copyLogsTooltip');
    click(link); await flush();
    e.grid.dispose();
    assert.equal(e.timers.size, 0);
    assert.equal(link.listenerCount('click'), 0);
    click(link); await flush();
    assert.equal(copies, 2);
    assert.equal(e.document.getElementById(STATUS_ID), null);
});

test('obsolete and out-of-order clipboard completions cannot paint a replacement or newer feedback', async () => {
    const pending = [];
    const e = fixture({ copyLogs: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
    const old = e.mount().querySelector('#' + LOG_LINK_ID);
    click(old); click(old);
    pending[1].reject(new Error('denied')); await flush();
    assert.ok(old.title.includes('copyFailed'));
    const title = old.title;
    pending[0].resolve(); await flush();
    assert.equal(old.title, title);
    assert.equal(e.timers.size, 0);
    click(old);
    e.grid.dispose();
    const fresh = e.mount().querySelector('#' + LOG_LINK_ID);
    pending[2].resolve(); await flush();
    assert.equal(fresh.textContent, 'CopyLogs');
    assert.equal(old.title, title);
    click(fresh); e.leave(); pending[3].resolve(); await flush();
    assert.equal(fresh.textContent, 'CopyLogs');
    assert.equal(e.timers.size, 0);
});

test('grid mismatch dialog admits exact current caller/actions and retires both listeners', () => {
    const e = fixture(); let current = true, accepted = 0, cancelled = 0;
    const show = () => e.grid.showMismatch({ message: 'Order changed', acceptLabel: 'Reload', cancelLabel: 'Cancel',
        assertCurrent() { assert.ok(current); }, onAccept: () => accepted++, onCancel: () => cancelled++ });
    const old = show(), ok = old.querySelector('[data-tm-order-ok]');
    assert.equal(old.getAttribute('role'), 'alertdialog');
    assert.equal(old.getAttribute('aria-label'), 'Order changed');
    current = false; click(ok);
    assert.equal(accepted, 0);
    current = true; const fresh = show();
    assert.equal(old.isConnected, false);
    assert.equal(ok.listenerCount('click'), 0);
    click(ok); assert.equal(accepted, 0);
    const cancel = fresh.querySelector('[data-tm-order-cancel]');
    click(cancel); click(cancel);
    assert.equal(cancelled, 1);
    assert.equal(fresh.querySelector('[data-tm-order-ok]').listenerCount('click'), 0);
    e.grid.dispose();
    assert.equal(cancel.listenerCount('click'), 0);
    assert.equal(e.document.getElementById(ORDER_MISMATCH_DIALOG_ID), null);
});

test('resource acquisition is explicit and cleanup removes exact owned nodes while preserving replacements', () => {
    const e = fixture();
    assert.equal(e.document.head.children.length, 0);
    const status = e.mount(), root = e.grid.root;
    const style = e.grid.installResources();
    assert.equal(e.grid.installResources(), style);
    const dialog = e.grid.showMismatch({ message: 'Order', acceptLabel: 'OK', cancelLabel: 'Cancel',
        assertCurrent() {}, onAccept() {}, onCancel() {} });
    const replacements = [STATUS_ID, GRID_ID, STYLE_ID, ORDER_MISMATCH_DIALOG_ID].map(id => {
        const node = new Element(); node.id = id;
        (id === STYLE_ID ? e.document.head : e.document.body).appendChild(node); return node;
    });
    e.grid.dispose(); e.grid.dispose();
    for (const node of [status, root, style, dialog]) assert.equal(node.isConnected, false);
    for (const node of replacements) assert.equal(node.isConnected, true);
    assert.equal(e.grid.status, null);
    assert.equal(e.grid.root, null);
});

test('historical cleanup is admitted between removals and never touches current resources', () => {
    const e = fixture(); const status = e.mount(); e.grid.installResources();
    const old = [...OLD_IDS, ...OLD_STYLE_IDS].map(id => {
        const node = new Element(); node.id = id; e.document.body.appendChild(node); return node;
    });
    let checks = 0;
    assert.throws(() => e.grid.cleanupArtifacts(() => { if (++checks === 3) throw new Error('obsolete'); }), /obsolete/);
    assert.equal(old[0].isConnected, false);
    assert.equal(old[1].isConnected, true);
    e.grid.cleanupArtifacts();
    assert.ok(old.every(node => !node.isConnected));
    assert.equal(status.isConnected, true);
    assert.ok(e.document.getElementById(STYLE_ID));
});

test('resource retirement attempts all exact releases after a host removal failure', () => {
    const e = fixture(); const status = e.mount(), root = e.grid.root, style = e.grid.installResources();
    status.remove = () => { throw new Error('host failure'); };
    e.grid.dispose();
    assert.equal(root.isConnected, false);
    assert.equal(style.isConnected, false);
    assert.equal(e.grid.status, null);
    assert.equal(e.grid.diagnostics().frameReleaseFailures, 1);
});

test('status painting rechecks native caller admission between host writes', () => {
    const e = fixture(), status = e.mount();
    let current = true;
    Object.defineProperty(status.style, 'marginLeft', { configurable: true, set() { current = false; } });
    assert.throws(() => e.grid.layoutStatus(status, { left: 30, width: 300 }, 5,
        () => { if (!current) throw new Error('native caller replaced'); }), /native caller replaced/);
    assert.equal(status.style.width, '600px');
    assert.equal(status.style.getPropertyValue('--tm-row-gap'), '12px');
});

test('an obsolete timer cannot relinquish newer feedback, and reentrant disposal preserves new resources', async () => {
    const e = fixture({ copyLogs: async () => {} });
    const status = e.mount(), link = status.querySelector('#' + LOG_LINK_ID);
    const acquiredStyle = e.grid.installResources();
    click(link); await flush(); const oldTimer = [...e.timers.values()][0];
    click(link); await flush(); oldTimer();
    assert.equal(link.textContent, 'log:copied');
    assert.equal(e.timers.size, 1);
    const remove = status.remove.bind(status); let replacement;
    status.remove = () => { remove(); replacement = e.mount(); e.grid.installResources(); };
    e.grid.dispose();
    assert.equal(e.timers.size, 0);
    assert.equal(replacement.isConnected, true);
    assert.equal(e.grid.status, replacement);
    assert.equal(e.grid.root.isConnected, true);
    assert.equal(e.document.getElementById(STYLE_ID), acquiredStyle);
});

test('reentrant dialog publication preserves its newer owner and cannot execute the obsolete action', () => {
    const e = fixture(); let accepted = 0, replacement;
    const options = { message: 'Order', acceptLabel: 'OK', cancelLabel: 'Cancel',
        assertCurrent() {}, onAccept: () => accepted++, onCancel() {} };
    const append = e.document.body.appendChild.bind(e.document.body);
    e.document.body.appendChild = node => {
        append(node);
        if (node.id === ORDER_MISMATCH_DIALOG_ID && !replacement) {
            replacement = true;
            replacement = e.grid.showMismatch(options);
        }
        return node;
    };
    assert.throws(() => e.grid.showMismatch(options), { code: 'GRID_FRAME_RETIRED' });
    assert.equal(e.document.getElementById(ORDER_MISMATCH_DIALOG_ID), replacement);
    assert.equal(replacement.isConnected, true);
    click(replacement.querySelector('[data-tm-order-ok]'));
    assert.equal(accepted, 1);
});
