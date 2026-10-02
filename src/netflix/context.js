// Page/platform reads are lazy. Credentials remain transient request context.
export function createNetflixContext({ window, document, navigator, location }) {
    function getHtmlLanguage() {
        return (document.documentElement?.getAttribute('lang') || '').trim();
    }

    function getNetflixLanguage() {
        return getHtmlLanguage() || navigator.language || '';
    }

    function netflixModelData(name) {
        const roots = [
            window,
            window?.wrappedJSObject,
            document.defaultView,
            document.defaultView?.wrappedJSObject
        ];
        for (const root of roots) {
            try {
                const appContext = root?.netflix?.appContext;
                if (appContext && typeof appContext.getModelData === 'function') {
                    const value = appContext.getModelData(name);
                    if (value != null) return value;
                }
            } catch (_) {}
            try {
                const value = root?.netflix?.reactContext?.models?.[name]?.data;
                if (value != null) return value;
            } catch (_) {}
        }
        return null;
    }

    // Bootstrap access is page context; protocol interpretation moves to list-data in P06.
    function graphqlData() {
        const candidates = [
            window,
            window?.wrappedJSObject,
            document.defaultView,
            document.defaultView?.wrappedJSObject
        ];
        for (const root of candidates) {
            try {
                const data = root?.netflix?.reactContext?.models?.graphql?.data;
                if (data && typeof data === 'object') return data;
            } catch (_) {}
        }
        return null;
    }

    function viewingRequestContext() {
        const user = netflixModelData('userInfo');
        // guid is the account owner's profile; userGuid is the active profile.
        const profileGuid = user?.userGuid;
        const authURL = user?.authURL;
        const services = netflixModelData('services');
        const build = netflixModelData('serverDefs')?.BUILD_IDENTIFIER;
        let base = services?.memberapi;
        let endpointType = 'string';
        if (base == null || base === '') {
            base = typeof build === 'string' && build ? '/api/shakti/' + encodeURIComponent(build) : '';
            endpointType = 'build';
        } else if (typeof base === 'object') {
            // Netflix also exposes memberapi as a URL descriptor. Stringifying
            // that object sends requests to /[object Object]/pathEvaluator.
            const { protocol, hostname, path } = base;
            if (typeof protocol !== 'string' || !/^https:?$/i.test(protocol) ||
                typeof hostname !== 'string' || !hostname ||
                !Array.isArray(path) || !path.length ||
                !path.every(part => typeof part === 'string' && part.length > 0)) return null;
            base = protocol.replace(/:$/, '') + '://' + hostname + '/' + path.join('/').replace(/^\/+/, '');
            endpointType = 'descriptor';
        }
        if (typeof profileGuid !== 'string' || !profileGuid || typeof authURL !== 'string' || !authURL ||
            typeof base !== 'string' || !base) return null;
        try {
            const url = new URL(base, location.origin);
            if (url.origin !== location.origin || url.protocol !== 'https:' ||
                url.username || url.password || url.search || url.hash || url.pathname === '/') return null;
            url.pathname = url.pathname.replace(/\/+$/, '') + '/pathEvaluator';
            url.searchParams.set('falcor_server', '0.1.0');
            url.searchParams.set('withSize', 'false');
            url.searchParams.set('materialize', 'false');
            url.searchParams.set('original_path', '/shakti/mre/pathEvaluator');
            return { profileGuid, authURL, url: url.href, endpointType, endpointPath: url.pathname };
        } catch (_) {
            return null;
        }
    }

    function activeProfile() { return netflixModelData('userInfo')?.userGuid; }
    function pageDirection() {
        return document.querySelector('[data-uia="loc"]')?.getAttribute('dir') || document.documentElement.dir || 'ltr';
    }
    function listRequestContext() {
        return { appVersion: netflixModelData('serverDefs')?.BUILD_IDENTIFIER,
            locale: netflixModelData('geo')?.locale?.id || document.documentElement.lang };
    }
    return Object.freeze({ getHtmlLanguage, getNetflixLanguage, activeProfile, pageDirection, viewingRequestContext,
        readGraphqlBootstrap: graphqlData, listRequestContext });
}
