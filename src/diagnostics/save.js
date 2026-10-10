// One explicit local-file Save As download; Firefox owns the destination folder.
export function createLogSaver({ download, readMode = () => undefined, version, Blob, URL }) {
    const pending = new Set(); let active = false;
    function save(text) {
        return new Promise((resolve, reject) => {
            if (!active || typeof download !== 'function' || !Blob || !URL?.createObjectURL) {
                reject(new Error('Update the userscript and enable Tampermonkey downloads in Browser API mode.')); return;
            }
            const mode = readMode();
            if (mode && mode !== 'browser') {
                reject(new Error('Set Tampermonkey Download Mode to Browser API so CopyLogs can show Save As.')); return;
            }
            const file = version + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(16).slice(2, 10) + '.txt';
            const job = { url: null, handle: null, cancel: null }; pending.add(job);
            function finish(error) {
                if (!pending.delete(job)) return;
                if (job.url) URL.revokeObjectURL(job.url);
                error ? reject(error) : resolve(file);
            }
            job.cancel = () => { finish(new Error('Log save cancelled.')); try { job.handle?.abort?.(); } catch (_) {} };
            try {
                job.url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
                job.handle = download({ url: job.url, name: file, saveAs: true, conflictAction: 'uniquify',
                    onload: () => finish(),
                    onerror: error => finish(new Error('Log download failed or was cancelled (' + (error?.error || 'unknown') + '). Check Tampermonkey Browser API download mode and .txt permission.')),
                    ontimeout: () => finish(new Error('Log download timed out.')) });
            } catch (error) { finish(new Error('Cannot start log download: ' + (error?.message || String(error)))); }
        });
    }
    return Object.freeze({ start() { active = true; }, save,
        dispose() { active = false; for (const job of [...pending]) job.cancel(); } });
}
