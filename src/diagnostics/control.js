// One application-lifetime export control, independent of native page/profile UI.
export function createLogControl({ document, tLog, copyLogs, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout, queueMicrotask = globalThis.queueMicrotask }) {
    let root = null, button = null, feedback = null, listener = null, style = null, revision = 0, feedbackTimer = null, exportSequence = 0;
    function clearFeedbackTimer() { if (feedbackTimer !== null) clearTimeout(feedbackTimer); feedbackTimer = null; }
    function start() {
        if (root) return;
        const owner = ++revision;
        root = document.createElement('aside'); root.id = 'tm-netflix-log-control';
        button = document.createElement('button'); button.id = 'tm-netflix-copylogs'; button.type = 'button';
        button.textContent = 'CopyLogs'; button.title = tLog('copyLogsTooltip');
        feedback = document.createElement('p'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
        root.appendChild(button); root.appendChild(feedback);
        listener = async event => {
            event.preventDefault();
            if (owner !== revision || !button?.isConnected || button.disabled) return;
            clearFeedbackTimer();
            const control = button, message = feedback, sequence = ++exportSequence;
            const current = () => owner === revision && sequence === exportSequence && control.isConnected;
            control.disabled = true; message.hidden = true;
            queueMicrotask(() => { if (current()) control.disabled = false; });
            try {
                const file = await copyLogs({ detailed: Boolean(event.shiftKey) });
                if (!current()) return;
                message.textContent = tLog('copied') + ' ' + file; message.hidden = false;
                feedbackTimer = setTimeout(() => {
                    feedbackTimer = null;
                    if (current()) { message.hidden = true; message.textContent = ''; }
                }, 3000);
            } catch (error) {
                if (!current()) return;
                message.textContent = tLog('copyFailed', { message: error?.message || String(error) }); message.hidden = false;
            } finally { if (current()) control.disabled = false; }
        };
        button.addEventListener('click', listener);
        style = document.createElement('style'); style.textContent = '#tm-netflix-log-control{position:fixed;right:16px;bottom:16px;z-index:2147483646;font:13px system-ui;color:#fff;max-width:min(360px,calc(100vw - 32px))}#tm-netflix-log-control button{background:#242424;color:#fff;border:1px solid #777;border-radius:5px;padding:8px;cursor:pointer}#tm-netflix-log-control button:focus-visible{outline:2px solid #fff;outline-offset:2px}#tm-netflix-log-control p{position:absolute;right:0;bottom:calc(100% + 8px);width:max-content;max-width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:#181818;border:1px solid #555;padding:8px;overflow-wrap:anywhere;margin:0}#tm-netflix-log-control[hidden],#tm-netflix-log-control [hidden]{display:none!important}';
        document.head.appendChild(style); document.body.appendChild(root);
    }
    function dispose() {
        revision++; clearFeedbackTimer(); button?.removeEventListener('click', listener); root?.remove(); style?.remove();
        root = button = feedback = listener = style = null;
    }
    return Object.freeze({ start, dispose, setVisible(visible) { if (root) root.hidden = !visible; } });
}
