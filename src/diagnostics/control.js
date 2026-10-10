// One application-lifetime export control, independent of native page/profile UI.
export function createLogControl({ document, tLog, copyLogs }) {
    let root = null, button = null, feedback = null, listener = null, style = null, revision = 0;
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
            const control = button, message = feedback; control.disabled = true; message.hidden = true;
            try {
                const file = await copyLogs({ detailed: Boolean(event.shiftKey) });
                if (owner !== revision || !control.isConnected) return;
                message.textContent = tLog('copied') + ' ' + file; message.hidden = false;
            } catch (error) {
                if (owner !== revision || !control.isConnected) return;
                message.textContent = tLog('copyFailed', { message: error?.message || String(error) }); message.hidden = false;
            } finally { if (owner === revision && control.isConnected) control.disabled = false; }
        };
        button.addEventListener('click', listener);
        style = document.createElement('style'); style.textContent = '#tm-netflix-log-control{position:fixed;right:16px;bottom:16px;z-index:2147483646;font:13px system-ui;color:#fff;max-width:min(360px,calc(100vw - 32px))}#tm-netflix-log-control button{background:#242424;color:#fff;border:1px solid #777;border-radius:5px;padding:8px;cursor:pointer}#tm-netflix-log-control button:focus-visible{outline:2px solid #fff;outline-offset:2px}#tm-netflix-log-control p{background:#181818;border:1px solid #555;padding:8px;overflow-wrap:anywhere;margin:6px 0 0}#tm-netflix-log-control [hidden]{display:none!important}';
        document.head.appendChild(style); document.body.appendChild(root);
    }
    function dispose() {
        revision++; button?.removeEventListener('click', listener); root?.remove(); style?.remove();
        root = button = feedback = listener = style = null;
    }
    return Object.freeze({ start, dispose });
}
