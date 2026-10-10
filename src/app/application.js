import { createMyListSession } from './my-list-session.js';
import { createSettings } from './settings.js';
import { createNetflixContext } from '../netflix/context.js';
import { createI18n } from '../i18n/i18n.js';
import { createLogger } from '../diagnostics/logger.js';
import { createReport } from '../diagnostics/report.js';
import { createLogSaver } from '../diagnostics/save.js';
import { createLogControl } from '../diagnostics/control.js';
import { createRecommendations } from '../recommendations/recommendations.js';

export function createApplication({ environment = globalThis, version = '', createSession = createMyListSession,
    userscript = { registerMenu: environment.GM_registerMenuCommand, unregisterMenu: environment.GM_unregisterMenuCommand,
        getValue: environment.GM_getValue, setValue: environment.GM_setValue, download: environment.GM_download, downloadMode: () => environment.GM_info?.downloadMode } } = {}) {
    const { window, document, location, history, navigator, Element, queueMicrotask } = environment;
    const context = createNetflixContext({ window, document, navigator, location });
    const i18n = createI18n({ readLanguage: context.getNetflixLanguage });
    const logger = createLogger({ name: 'My List for Netflix', version, Element, console: environment.console,
        isTraceEnabled: () => false });
    let active = false, session = null, settings = null, lastObservedUrl = '', routeChangeSequence = 0, revision = 0, sessionEpoch = 0;
    const hooks = [], logHistory = [];
    const saver = createLogSaver({ download: userscript.download, readMode: userscript.downloadMode, version, Blob: environment.Blob, URL: environment.URL });
    const browsingReport = createReport({ logger, version, document, navigator, tLog: i18n.tLog, writeText: saver.save,
        readEnvironment: () => ({ url: location.href, userAgent: navigator.userAgent, browserLanguage: navigator.language,
            htmlLanguage: context.getHtmlLanguage(), netflixLanguage: context.getNetflixLanguage(), displayLanguage: i18n.getUiLocale(),
            logLanguage: i18n.getLogLocale(), viewport: `${window.innerWidth}x${window.innerHeight}`, devicePixelRatio: window.devicePixelRatio }),
        readRuntime: diagnostics, readSeriesViewing: () => [], readThumbnails: () => null, readNativePopup: () => null, readHistory: () => logHistory });
    async function copyBrowsingLogs(options) {
        logger.log(i18n.tLog('copyLogsRequested'), { detailed: Boolean(options?.detailed) });
        try { const file = await browsingReport.copy(options); logger.log(i18n.tLog('copyLogsCompleted'), { file }); return file; }
        catch (error) { logger.warn(i18n.tLog('copyLogsFailed'), error); throw error; }
    }
    const recommendations = createRecommendations({ environment, context, userscript, tUi: i18n.tUi, log: logger.log, warn: logger.warn });
    const logControl = createLogControl({ document, tLog: i18n.tLog,
        copyLogs: options => session ? session.copyLogs(options) : copyBrowsingLogs(options) });
    function isTargetPage() { return location.origin === 'https://www.netflix.com' && location.pathname === '/browse/my-list'; }
    function rememberPage(feature, read, compactRead, url) {
        try {
            let facts = read(), mode = 'detailed';
            if (logger.formatValue(facts).length > 128 * 1024) { facts = compactRead(); mode = 'compact'; }
            const serialized = logger.formatValue(facts);
            if (serialized.length > 128 * 1024) { facts = { unavailable: 'snapshot-size-limit' }; mode = 'bounded'; }
            logHistory.push({ feature, url, capturedAt: logger.formatTimestamp(), mode, facts: JSON.parse(logger.formatValue(facts)) });
            if (logHistory.length > 4) logHistory.shift();
        } catch (error) { logger.warn('Final page diagnostic snapshot unavailable', { message: error.message }); }
    }
    function retireSession(reason, url = lastObservedUrl) {
        const previous = session; session = null;
        if (previous) rememberPage('My List', () => previous.diagnosticSnapshot?.() || previous.diagnostics(),
            () => previous.diagnosticSnapshot?.(false) || previous.diagnostics(), url);
        previous?.dispose(reason);
    }
    function routeChanged(source = 'unknown') {
        if (!active) return;
        const currentUrl = location.href;
        if (currentUrl === lastObservedUrl && source !== 'initial') return;
        const previousUrl = lastObservedUrl; lastObservedUrl = currentUrl;
        logControl.setVisible(!/^\/watch(?:\/|$)/.test(location.pathname));
        const target = isTargetPage();
        logger.log(i18n.tLog('routeChangeDetected'), { seq: ++routeChangeSequence, source, previousUrl, currentUrl, target });
        if (!target) {
            retireSession(`route:${source}`, previousUrl);
            const facts = recommendations.diagnostics();
            if (source !== 'initial' && facts.active) rememberPage('Browsing', () => facts, () => facts, previousUrl);
            try { recommendations.check(); } catch (error) { logger.warn('Recommendation controls unavailable', { message: error.message }); }
            return;
        }
        const browsingFacts = recommendations.diagnostics();
        if (browsingFacts.active) rememberPage('Browsing', () => browsingFacts, () => browsingFacts, previousUrl);
        recommendations.dispose();
        if (session) { session.check(); return; }
        const owner = revision;
        let next;
        next = createSession({ environment, version, context, i18n, logger, settings, userscript, saveLogs: saver.save, readLogHistory: () => logHistory,
            nextSessionToken: () => ++sessionEpoch,
            onNavigation: reason => { if (active && revision === owner && session === next) routeChanged(reason); } });
        session = next;
        session.start(`route:${source}`);
    }
    function installHooks() {
        const owner = revision;
        const deliver = reason => { if (active && revision === owner) routeChanged(reason); };
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method]; if (typeof original !== 'function') continue;
            const wrapper = function(...args) {
                const result = original.apply(this, args);
                queueMicrotask(() => deliver(`history.${method}`)); return result;
            };
            history[method] = wrapper; hooks.push(() => { if (history[method] === wrapper) history[method] = original; });
        }
        for (const type of ['popstate', 'hashchange']) {
            const listener = () => deliver(type);
            window.addEventListener(type, listener, true);
            hooks.push(() => window.removeEventListener(type, listener, true));
        }
    }
    function start() {
        if (active) return;
        active = true; ++revision; lastObservedUrl = location.href; saver.start(); logControl.start();
        let storage; try { storage = environment.localStorage; } catch (_) {}
        settings = createSettings({ storage, registerMenu: userscript.registerMenu,
            unregisterMenu: userscript.unregisterMenu, tUi: i18n.tUi, warn: logger.warn,
            onChange: preferences => {
                session?.preferencesChanged(preferences);
                logger.log(i18n.tLog('originalMyListVisibilityChanged'), { enabled: preferences.viewOriginalMyList });
            } });
        settings.start(); installHooks();
        logger.log(i18n.tLog('scriptStarted'), { version, url: location.href, userAgent: navigator.userAgent,
            browserLanguage: navigator.language || '', htmlLanguage: context.getHtmlLanguage(), netflixLanguage: context.getNetflixLanguage(),
            displayLanguage: i18n.getUiLocale(), logLanguage: i18n.getLogLocale(),
            viewport: { width: window.innerWidth, height: window.innerHeight }, devicePixelRatio: window.devicePixelRatio });
        routeChanged('initial');
    }
    function dispose() {
        if (!active) return;
        active = false; ++revision;
        try { try { recommendations.dispose(); } finally { retireSession('application-dispose'); } }
        finally {
            try { settings?.dispose(); } finally {
                try { logControl.dispose(); } finally {
                    saver.dispose(); for (const release of hooks.splice(0).reverse()) release();
                }
            }
        }
    }
    function diagnostics() { return Object.freeze({ active, routeChangeSequence,
        currentSession: session?.diagnostics() || null, recommendations: recommendations.diagnostics(), retainedPages: logHistory.length }); }
    return Object.freeze({ start, dispose, diagnostics });
}
