import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, expandLog } from '../scripts/read-log.mjs';
import { encodeDiagnostic } from '../src/diagnostics/encoding.js';

test('log reader bounds default output, reads old/new sections and expands without changing or overwriting sources', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'netflix-read-log-'));
    try {
        const input = path.join(directory, 'capture.txt'), output = path.join(directory, 'expanded.txt');
        const value = { recommendations: { rowLifecycle: { sequence: 163, recent: Array.from({ length: 100 },
            (_, sequence) => ({ sequence, kind: 'cache', stage: 'returned', reason: 'native-replacement' })) } } };
        const literal = JSON.stringify(value), encoded = encodeDiagnostic(value);
        assert.equal(encoded.packed, true);
        const text = 'version: test\nsnapshot: ' + encoded.text + '\npreviousPages: []\n---\nunchanged events\n';
        await writeFile(input, text);
        const summary = await main([input]);
        assert.equal(summary.bytes, Buffer.byteLength(text));
        assert.deepEqual(summary.sections, [{ section: 'snapshot', bytes: encoded.bytes }, { section: 'previousPages', bytes: 2 }]);
        assert.ok(JSON.stringify(summary).length < 500);
        assert.equal(await main([input, '--section', 'snapshot', '--path', 'recommendations.rowLifecycle.sequence']), 163);
        const preview = await main([input, '--section', 'snapshot']);
        assert.equal(preview.truncated, true); assert.ok(preview.preview.length <= 4000);
        await main([input, '--expand', output]);
        const expanded = await readFile(output, 'utf8');
        assert.ok(expanded.includes('snapshot: ' + literal));
        assert.ok(expanded.endsWith('---\nunchanged events\n'));
        assert.equal(expandLog('snapshot: ' + literal), 'snapshot: ' + literal);
        await assert.rejects(main([input, '--expand', input]), /EEXIST/);
        await assert.rejects(main([input, '--expand', output]), /EEXIST/);
        await assert.rejects(main([input, '--section', 'snapshot', '--path', '__proto__']), /absent/);
        assert.equal(await readFile(input, 'utf8'), text);
    } finally { await rm(directory, { recursive: true }); }
});
