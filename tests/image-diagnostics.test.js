import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/grid/grid.js';
import { createDocument, Element } from './helpers/dom.js';

function fixture() {
    const document = createDocument(), observers = [];
    let active = true;
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(options) { this.options = options; }
        disconnect() { this.disconnected = true; }
    }
    const grid = createGrid({ document, location: { href: 'https://www.netflix.com/browse/my-list' },
        runChunks: async (count, visit) => { for (let index = 0; index < count; index++) visit(index); },
        imageDiagnostics: { window: { innerWidth: 100, innerHeight: 100 }, location: { href: 'https://www.netflix.com/' },
            performance: { now: () => 10, getEntriesByType: () => [] }, PerformanceObserver: Observer,
            readSessionToken: () => 1, isRouteSessionActive: () => active, readScanFinishedAt: () => 20 } });
    return { grid, document, observers, leave: () => { active = false; } };
}

test('grid image provider owns one bounded future-entry observer and returns copied summaries', () => {
    const f = fixture(); f.grid.images.start(1); f.grid.images.start(1);
    assert.equal(f.observers.length, 1);
    assert.deepEqual(f.observers[0].options, { entryTypes: ['resource'] });
    const entry = { startTime: 30, initiatorType: 'img', duration: 4,
        get name() { assert.fail('route summaries must not read URLs'); } };
    f.observers[0].callback({ getEntries: () => Array(4005).fill(entry) });
    const snapshot = f.grid.images.diagnostics();
    assert.equal(snapshot.entriesExamined, 4000); assert.equal(snapshot.skippedAtLimit, 5);
    assert.equal(snapshot.imageEntries, 4000); assert.equal(snapshot.startedAfterViewingScan, 4000);
    assert.equal(f.observers[0].disconnected, true);
    snapshot.imageEntries = -1; assert.equal(f.grid.images.diagnostics().imageEntries, 4000);
    f.grid.images.start(1); assert.equal(f.observers.length, 1);
});

test('retired image delivery and failed reads cannot stop a replacement observer', () => {
    const f = fixture(); f.grid.images.start(1); const old = f.observers[0];
    f.grid.images.reset(); f.grid.images.start(1);
    old.callback({ getEntries: () => { assert.fail('obsolete list must not be read'); } });
    assert.equal(f.grid.images.diagnostics().active, true);
    f.observers[1].callback({ getEntries() {
        f.grid.images.reset(); f.grid.images.start(1); throw new Error('retired read');
    } });
    assert.equal(f.grid.images.diagnostics().active, true);
    f.observers[2].callback({ getEntries: () => { throw new Error('private URL'); } });
    assert.equal(f.grid.images.diagnostics().stopReason, 'read-failed');
    assert.ok(!JSON.stringify(f.grid.images.diagnostics()).includes('private URL'));
    f.grid.images.reset(); f.grid.images.start(1); f.leave();
    f.observers[3].callback({ getEntries: () => { assert.fail('retired route must not read'); } });
    f.grid.images.dispose(); assert.equal(f.observers[3].disconnected, true);
});

test('Copy Logs thumbnail sampling uses the current grid registry and rejects disposed frames', async () => {
    const f = fixture(); const section = f.document.body.appendChild(new Element('section'));
    const anchor = section.appendChild(new Element()), status = section.appendChild(new Element());
    const snapshot = new Element(), card = snapshot.appendChild(new Element('a'));
    card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', 'https://www.netflix.com/browse?jbv=1');
    const item = { videoId: '1', href: card.getAttribute('href'), snapshot };
    await f.grid.publish({ items: [item], section, anchor, status, geometry: { width: 100, left: 0, columns: 1 }, layout: {}, assertCurrent() {} });
    assert.equal(f.grid.images.collect().mappedCards, 1);
    assert.equal(f.grid.images.collect().cardsWithoutImage, 1);
    f.grid.dispose();
    assert.deepEqual(f.grid.images.collect(), { available: false, reason: 'no-current-grid' });
});
