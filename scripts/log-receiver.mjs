import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createLogReceiver({ directory = fileURLToPath(new URL('../logs/', import.meta.url)) } = {}) {
    const token = randomBytes(32).toString('hex'), limit = 16 * 1024 * 1024;
    const server = http.createServer((req, res) => {
        const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
        if (req.headers.host !== '127.0.0.1:' + server.address().port) { reply(403, { error: 'Invalid host' }); return; }
        // No CORS allowance: ordinary web pages cannot read the session token.
        if (req.method === 'GET' && req.url === '/session') { reply(200, { token }); return; }
        if (req.method !== 'POST' || req.url !== '/logs') { reply(404, { error: 'Unknown endpoint' }); return; }
        if (req.headers.authorization !== 'Bearer ' + token) { reply(403, { error: 'Invalid session' }); return; }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') { reply(415, { error: 'JSON required' }); return; }
        const chunks = []; let size = 0;
        req.on('data', chunk => {
            if (res.writableEnded) return;
            size += chunk.length;
            if (size > limit) { reply(413, { error: 'Capture exceeds 16 MiB' }); chunks.length = 0; }
            else chunks.push(chunk);
        });
        req.on('end', async () => {
            if (res.writableEnded) return;
            let payload;
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch (_) { reply(400, { error: 'Invalid JSON' }); return; }
            if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(payload?.version) || typeof payload?.text !== 'string' ||
                !payload.text.startsWith('My List for Netflix Diagnostic Log\nversion: ' + payload.version + '\n')) {
                reply(400, { error: 'Invalid diagnostic report' }); return;
            }
            // Filename is generated here; clients cannot supply a path or overwrite files.
            const file = payload.version + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.txt';
            try {
                await mkdir(directory, { recursive: true });
                await writeFile(path.join(directory, file), payload.text, { encoding: 'utf8', flag: 'wx' });
                reply(200, { file });
            } catch (_) { reply(500, { error: 'Cannot write logs directory' }); }
        });
        req.on('error', () => { if (!res.writableEnded) reply(400, { error: 'Incomplete request' }); });
    });
    server.requestTimeout = 15000;
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const server = createLogReceiver();
    server.on('error', error => { console.error('Log receiver could not start:', error.message); process.exitCode = 1; });
    server.listen(43127, '127.0.0.1', () => console.log('CopyLogs receiver ready. Files save to', fileURLToPath(new URL('../logs/', import.meta.url))));
}
