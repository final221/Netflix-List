// One explicit CopyLogs capture to the local repository receiver; no background traffic.
export function createLogSaver({ request, version }) {
    const base = 'http://127.0.0.1:43127', pending = new Set();
    let active = false, revision = 0;
    const unavailable = () => new Error('Start npm run logs in the Netflix List repository, then click CopyLogs again.');
    function send(method, path, data, token) {
        return new Promise((resolve, reject) => {
            if (!active || typeof request !== 'function') { reject(unavailable()); return; }
            const job = { handle: null, cancel: null };
            function finish(error, value) { if (!pending.delete(job)) return; error ? reject(error) : resolve(value); }
            job.cancel = () => { finish(new Error('Log save cancelled.')); try { job.handle?.abort?.(); } catch (_) {} };
            pending.add(job);
            try {
                job.handle = request({ method, url: base + path, anonymous: true, redirect: 'error', timeout: 5000,
                    headers: data ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } : {}, data,
                    onload(response) {
                        if (response.status !== 200) { finish(new Error('Log receiver returned HTTP ' + response.status + '.')); return; }
                        try { finish(null, JSON.parse(response.responseText)); } catch (_) { finish(new Error('Invalid log receiver response.')); }
                    },
                    onerror: () => finish(unavailable()), ontimeout: () => finish(unavailable()),
                    onabort: () => finish(new Error('Log save cancelled.')) });
            } catch (_) { finish(unavailable()); }
        });
    }
    async function save(text) {
        const owner = revision;
        const session = await send('GET', '/session');
        if (!active || owner !== revision) throw new Error('Log save cancelled.');
        if (!/^[a-f0-9]{64}$/.test(session?.token)) throw new Error('Invalid log receiver session.');
        const result = await send('POST', '/logs', JSON.stringify({ version, text }), session.token);
        if (!active || owner !== revision) throw new Error('Log save cancelled.');
        if (typeof result?.file !== 'string' || !/^[\w.-]+\.txt$/.test(result.file)) throw new Error('Invalid saved log filename.');
        return 'logs/' + result.file;
    }
    return Object.freeze({ start() { active = true; }, save,
        dispose() { active = false; revision++; for (const job of [...pending]) job.cancel(); } });
}
