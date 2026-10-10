import { createApplication } from './app/application.js';

const SCRIPT_VERSION = __SCRIPT_VERSION__;
createApplication({ version: SCRIPT_VERSION, userscript: {
    registerMenu: typeof GM_registerMenuCommand === 'function' ? (...args) => GM_registerMenuCommand(...args) : undefined,
    unregisterMenu: typeof GM_unregisterMenuCommand === 'function' ? (...args) => GM_unregisterMenuCommand(...args) : undefined,
    getValue: typeof GM_getValue === 'function' ? (...args) => GM_getValue(...args) : undefined,
    setValue: typeof GM_setValue === 'function' ? (...args) => GM_setValue(...args) : undefined,
    request: typeof GM_xmlhttpRequest === 'function' ? (...args) => GM_xmlhttpRequest(...args) : undefined
} }).start();
