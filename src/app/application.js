import { createMyListSession } from './my-list-session.js';
import { createSettings } from './settings.js';
import { createNetflixContext } from '../netflix/context.js';
import { createI18n } from '../i18n/i18n.js';
import { createLogger } from '../diagnostics/logger.js';

export function createApplication({ environment = globalThis, version = '', createSession = createMyListSession,
    userscript = { registerMenu: environment.GM_registerMenuCommand, unregisterMenu: environment.GM_unregisterMenuCommand,
        getValue: environment.GM_getValue, setValue: environment.GM_setValue } } = {}) {
    const { window, document, location, history, navigator, Element, queueMicrotask } = environment;
    const context = createNetflixContext({ window, document, navigator, location });
    const i18n = createI18n({ readLanguage: context.getNetflixLanguage });
    const logger = createLogger({ name: 'My List for Netflix', version, Element, console: environment.console,
        isTraceEnabled: () => false });
    let active = false, session = null, settings = null, lastObservedUrl = '', routeChangeSequence = 0, revision = 0, sessionEpoch = 0;
    const hooks = [];
    function isTargetPage() { return location.origin === 'https://www.netflix.com' && location.pathname === '/browse/my-list'; }
    function retireSession(reason) { const previous = session; session = null; previous?.dispose(reason); }
    function routeChanged(source = 'unknown') {
        if (!active) return;
        const currentUrl = location.href;
        if (currentUrl === lastObservedUrl && source !== 'initial') return;
        const previousUrl = lastObservedUrl; lastObservedUrl = currentUrl;
        const target = isTargetPage();
        logger.log(i18n.tLog('routeChangeDetected'), { seq: ++routeChangeSequence, source, previousUrl, currentUrl, target });
        if (!target) { retireSession(`route:${source}`); return; }
        if (session) { session.check(); return; }
        const owner = revision;
        let next;
        next = createSession({ environment, version, context, i18n, logger, settings, userscript,
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
        active = true; ++revision; lastObservedUrl = location.href;
        let storage; try { storage = environment.localStorage; } catch (_) {}
        settings = createSettings({ storage, registerMenu: userscript.registerMenu,
            unregisterMenu: userscript.unregisterMenu, tUi: i18n.tUi,
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
        try { retireSession('application-dispose'); }
        finally {
            try { settings?.dispose(); } finally { for (const release of hooks.splice(0).reverse()) release(); }
        }
    }
    return Object.freeze({ start, dispose, diagnostics: () => Object.freeze({ active, routeChangeSequence,
        currentSession: session?.diagnostics() || null }) });
}
