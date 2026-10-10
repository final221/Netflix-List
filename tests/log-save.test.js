import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createLogReceiver } from '../scripts/log-receiver.mjs';
import { createLogSaver } from '../src/diagnostics/save.js';

const text = 'My List for Netflix Diagnostic Log\nversion: 1.9.0\nexample: \u65e5\u672c\n';
test('local receiver saves exact UTF-8 captures with unique filenames and rejects unsafe requests', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'netflix-log-save-'));
    const server = createLogReceiver({ directory }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(base + '/session');
    assert.equal(session.headers.get('Access-Control-Allow-Origin'), null);
    const { token } = await session.json();
    const post = (payload, authorization = 'Bearer ' + token, extra = {}) => fetch(base + '/logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, ...extra }, body: JSON.stringify(payload) });
    const first = await post({ version: '1.9.0', text, file: '../../outside.txt' }); assert.equal(first.status, 200);
    const { file } = await first.json(); assert.match(file, /^1\.9\.0-[\w.-]+\.txt$/);
    assert.equal(await readFile(path.join(directory, file), 'utf8'), text);
    const second = await post({ version: '1.9.0', text }); assert.notEqual((await second.json()).file, file);
    assert.equal((await post({ version: '1.9.0', text }, 'wrong')).status, 403);
    assert.equal((await post({ version: '../../escape', text })).status, 400);
    assert.equal((await post({ version: '1.9.0', text: 'not a report' })).status, 400);
    const invalidHost = await new Promise((resolve, reject) => {
        const req = http.request(base + '/session', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
        req.on('error', reject); req.end();
    });
    assert.equal(invalidHost, 403);
    assert.equal((await fetch(base + '/logs', { method: 'OPTIONS' })).status, 404);
    assert.equal((await post({ version: '1.9.0', text: text + 'x'.repeat(16 * 1024 * 1024) })).status, 413);
    assert.equal((await readdir(directory)).length, 2);
});

test('log saver sends only an explicit capture and disposal rejects a delayed handshake', async () => {
    const requests = []; let aborted = 0;
    const saver = createLogSaver({ version: '1.9.0', request: options => { requests.push(options); return { abort() { aborted++; } }; } });
    saver.start(); assert.equal(requests.length, 0);
    const result = saver.save(text); assert.equal(requests.length, 1);
    requests[0].onload({ status: 200, responseText: JSON.stringify({ token: 'b'.repeat(64) }) });
    await Promise.resolve(); assert.equal(requests.length, 2);
    assert.equal(requests[1].anonymous, true); assert.equal(requests[1].redirect, 'error');
    assert.equal(requests[1].headers.Authorization, 'Bearer ' + 'b'.repeat(64));
    assert.deepEqual(JSON.parse(requests[1].data), { version: '1.9.0', text });
    requests[1].onload({ status: 200, responseText: JSON.stringify({ file: '1.9.0-test.txt' }) });
    assert.equal(await result, 'logs/1.9.0-test.txt');
    const delayed = saver.save(text); saver.dispose();
    requests[2].onload({ status: 200, responseText: JSON.stringify({ token: 'b'.repeat(64) }) });
    await assert.rejects(delayed, /cancelled/); assert.equal(requests.length, 3); assert.equal(aborted, 1);
});

test('unavailable receiver and missing grants fail explicitly instead of using the clipboard', async () => {
    const missing = createLogSaver({ version: '1.9.0' }); missing.start(); await assert.rejects(missing.save(text), /npm run logs/);
    for (const outcome of ['onerror', 'ontimeout']) {
        const saver = createLogSaver({ version: '1.9.0', request: options => { queueMicrotask(() => options[outcome]()); } });
        saver.start(); await assert.rejects(saver.save(text), /npm run logs/); saver.dispose();
    }
});
