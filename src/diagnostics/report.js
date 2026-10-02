// Providers return the existing serialized summaries; no feature state is retained here.
export function createReport({ logger, version, document, navigator, tLog, readEnvironment,
    readRuntime, readSeriesViewing, readThumbnails, readNativePopup }) {
    function buildInvestigationLogText() {
        const snapshot = readRuntime();
        const environment = readEnvironment();
        return [
            'My List for Netflix Diagnostic Log',
            `version: ${version}`,
            `copiedAt: ${logger.formatTimestamp()}`,
            `url: ${environment.url}`,
            `userAgent: ${environment.userAgent}`,
            `browserLanguage: ${environment.browserLanguage || ''}`,
            `htmlLanguage: ${environment.htmlLanguage}`,
            `netflixLanguage: ${environment.netflixLanguage}`,
            `displayLanguage: ${environment.displayLanguage}`,
            `logLanguage: ${environment.logLanguage}`,
            `viewport: ${environment.viewport}`,
            `devicePixelRatio: ${environment.devicePixelRatio}`,
            `entries: ${logger.size()}`,
            `snapshot: ${logger.formatValue(snapshot)}`,
            `seriesViewing: ${logger.formatValue(readSeriesViewing())}`,
            `thumbnailDiagnostics: ${logger.formatValue(readThumbnails())}`,
            `nativePopupDiagnostics: ${logger.formatValue(readNativePopup())}`,
            '---',
            ...logger.entries()
        ].join('\n') + '\n';
    }

    async function copyTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return 'navigator.clipboard';
            } catch (error) {
                logger.warn(tLog('clipboardFallback'), error);
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-100000px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        try {
            textarea.select();
            const ok = document.execCommand('copy');
            if (!ok) throw new Error(tLog('execCommandCopyFailed'));
            return 'execCommand';
        } finally { textarea.remove(); }
    }

    return Object.freeze({ copy: () => copyTextToClipboard(buildInvestigationLogText()) });
}
