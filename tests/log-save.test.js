import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogSaver } from '../src/diagnostics/save.js';

const text = 'My List for Netflix Diagnostic Log\nversion: 1.9.1\nexample: \u65e5\u672c\n';
function fixture() {
    const requests = [], blobs = new Map(), revoked = []; let aborted = 0;
    const saver = createLogSaver({ version: '1.9.1', Blob,
        URL: { createObjectURL(blob) { const url = 'blob:fixture/' + blobs.size; blobs.set(url, blob); return url; },
            revokeObjectURL(url) { revoked.push(url); } },
        download(options) { requests.push(options); return { abort() { aborted++; } }; } });
    return { saver, requests, blobs, revoked, aborted: () => aborted };
}
test('log saver requests Save As for the exact UTF-8 report without choosing an absolute destination', async () => {
    const f = fixture(); f.saver.start(); assert.equal(f.requests.length, 0);
    const result = f.saver.save(text), request = f.requests[0];
    assert.equal(request.saveAs, true); assert.equal(request.conflictAction, 'uniquify');
    assert.match(request.name, /^1\.9\.1-[\w.-]+\.txt$/); assert.equal(request.name.includes('/'), false);
    assert.equal(await f.blobs.get(request.url).text(), text); assert.equal(f.blobs.get(request.url).type, 'text/plain;charset=utf-8');
    assert.equal(f.revoked.length, 0); request.onload(); assert.equal(await result, request.name);
    assert.deepEqual(f.revoked, [request.url]); request.onerror({ error: 'late' }); assert.equal(f.revoked.length, 1);
});
test('download failure, cancellation and disposal release Blob URLs and reject obsolete completion', async () => {
    for (const outcome of ['onerror', 'ontimeout', 'dispose']) {
        const f = fixture(); f.saver.start(); const result = f.saver.save(text), request = f.requests[0];
        if (outcome === 'dispose') f.saver.dispose(); else request[outcome]({ error: 'not_succeeded' });
        await assert.rejects(result, /failed|cancelled|timed out/); request.onload();
        assert.deepEqual(f.revoked, [request.url]); assert.equal(f.aborted(), outcome === 'dispose' ? 1 : 0);
    }
});
test('missing download grant and synchronous download errors fail without clipboard fallback', async () => {
    const missing = createLogSaver({ version: '1.9.1', Blob, URL }); missing.start();
    await assert.rejects(missing.save(text), /Update the userscript/);
    for (const mode of ['native', 'disabled']) {
        const saver = createLogSaver({ version: '1.9.1', Blob, URL, readMode: () => mode, download() { throw new Error('should not download'); } }); saver.start();
        await assert.rejects(saver.save(text), /Browser API/);
    }
    let revoked = 0;
    const saver = createLogSaver({ version: '1.9.1', Blob,
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() { revoked++; } },
        download() { throw new Error('denied'); } }); saver.start();
    await assert.rejects(saver.save(text), /denied/); assert.equal(revoked, 1);
});
