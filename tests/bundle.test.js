import { viewingVideo, atom, reference } from './helpers/fixtures.js';
import { mountPopulatedMyList } from './helpers/populated-browser.js';
import { createBrowser } from './helpers/browser.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { EventTarget, Element, createDocument } from './helpers/dom.js';
import { createScheduler } from './helpers/scheduler.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const distribution = 'dist/My List for Netflix.user.js';
const shipped = (await readFile(path.join(root, distribution), 'utf8')).replace(/\r\n/g, '\n');
const releaseVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;

function browser(options) { const b=createBrowser(options);vm.createContext(b.context);return {...b,start:()=>vm.runInContext(shipped,b.context,{filename:distribution,timeout:1000})}; }

test('generated browsing series captures real Falcor coverage and expires shared caught-up placement on added episodes', async () => {
    const b = browser(), stored = new Map(), paths = []; let episodes = 2;
    b.context.URLSearchParams = URLSearchParams;
    b.window.netflix.reactContext = { models: {
        userInfo: { data: { userGuid: 'A', authURL: 'fixture-auth' } }, services: { data: { memberapi: '/api/shakti/test' } } } };
    b.context.GM_getValue = (key, fallback) => stored.get(key) ?? fallback;
    b.context.GM_setValue = (key, value) => stored.set(key, value);
    b.context.fetch = async (_url, options) => {
        paths.push(new URLSearchParams(options.body).getAll('path').map(value => JSON.parse(value)));
        return { ok: true, json: async () => ({ jsonGraph: { videos: { 123: {
            ...viewingVideo('show', false, 0, { seasonCount: atom(1), episodeCount: atom(episodes) }),
            seasonList: { 0: reference('seasons', '101') } } }, seasons: { 101: { summary: atom({ length: episodes }) } } } }) };
    };
    const row = b.document.body.appendChild(new Element('section'));
    const slot = row.appendChild(new Element('div')); slot.setAttribute('data-virtual-slot', '0');
    const card = slot.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/123');
    b.start(); await b.scheduler.flush();
    const caughtUp = slot.querySelectorAll('button').find(button => button.textContent === 'Mark caught up');
    assert.ok(caughtUp); assert.equal(caughtUp.disabled, false);
    b.document.dispatchEvent({ type: 'click', target: caughtUp, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(slot.style.getPropertyValue('display'), 'none');
    assert.deepEqual(Array.from(stored.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['123'].coverage[0]), ['101', 2]);
    await b.navigate('/watch/123'); episodes = 3; await b.navigate('/browse'); await b.scheduler.flush();
    assert.equal(slot.style.getPropertyValue('display'), '');
    assert.equal(stored.get('legacyMyListForNetflix.viewingChoices.v1.A').choices['123'], undefined);
    assert.equal(paths.length, 4); await b.navigate('/watch/123'); assert.equal(b.scheduler.timers.size, 0);
});

test('generated release refills an empty browsing row through the native next control', async () => {
    const b = browser(), stored = new Map(); let moves = 0;
    b.window.netflix.reactContext = { models: { userInfo: { data: { userGuid: 'A' } } } };
    b.context.GM_getValue = (key, fallback) => stored.get(key) ?? fallback;
    b.context.GM_setValue = (key, value) => stored.set(key, value);
    const row = b.document.body.appendChild(new Element('section'));
    const slot = row.appendChild(new Element('div')); slot.setAttribute('data-virtual-slot', '0');
    const card = slot.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/123');
    const next = row.appendChild(new Element('button')); next.setAttribute('data-uia', 'carousel-hawkins-right-button');
    next.click = () => { moves++; card.setAttribute('href', '/title/456'); };
    b.start(); const hide = slot.querySelectorAll('button').find(button => button.textContent === 'Hide suggestion');
    b.document.dispatchEvent({ type: 'click', target: hide, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(slot.style.getPropertyValue('display'), 'none'); await b.scheduler.advance(250);
    for (let i = 0; i < 3; i++) await b.scheduler.advance(150);
    assert.equal(moves, 1); assert.equal(card.getAttribute('href'), '/title/456'); assert.equal(slot.style.getPropertyValue('display'), '');
    assert.equal([...stored.values()][0].choices['123'], 'hide'); assert.equal(b.requests.length, 0);
    await b.navigate('/watch/456'); assert.equal(b.scheduler.timers.size, 0); assert.equal(b.window.listenerCount('scroll'), 0);
});

test('generated browsing release saves a dismissal and restores native visibility before playback', async () => {
    const b = browser(), stored = new Map();
    b.window.netflix.reactContext = { models: { userInfo: { data: { userGuid: 'A' } } } };
    b.context.GM_getValue = (key, fallback) => stored.get(key) ?? fallback;
    b.context.GM_setValue = (key, value) => stored.set(key, value);
    const row = b.document.body.appendChild(new Element('section'));
    const slot = row.appendChild(new Element('div')); slot.setAttribute('data-virtual-slot', '0');
    const card = slot.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/123');
    b.start();
    const input = () => slot.querySelectorAll('button').find(button => button.textContent === 'Hide suggestion');
    assert.ok(input());
    b.document.dispatchEvent({ type: 'click', target: input(), preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(card.style.visibility, 'hidden'); assert.equal(stored.size, 1); assert.equal(b.requests.length, 0);
    assert.equal(slot.style.getPropertyValue('display'), 'none');
    await b.navigate('/watch/123'); assert.equal(card.style.visibility, undefined); assert.equal(slot.querySelectorAll('button').length, 0);
    assert.equal(slot.style.getPropertyValue('display'), '');
    await b.navigate('/browse'); assert.equal(card.style.visibility, 'hidden');
    const manager = b.document.querySelector('.tm-rec-manager');
    b.document.dispatchEvent({ type: 'click', target: manager.querySelector('button'), preventDefault() {}, stopImmediatePropagation() {} });
    const undo = manager.querySelector('.tm-rec-saved-row').querySelector('button');
    b.document.dispatchEvent({ type: 'click', target: undo, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(card.style.visibility, undefined); assert.equal(Object.keys([...stored.values()][0].choices).length, 0);
    assert.equal(slot.style.getPropertyValue('display'), '');
});


test('generated userscript starts exactly once and hooks the existing page environment', async () => {
    const b = browser();
    b.start();
    assert.equal(b.menus.size, 1);
    assert.equal(b.window.listenerCount('popstate'), 1);
    assert.equal(b.window.listenerCount('hashchange'), 1);
    assert.equal(b.logs.filter(args => args.includes('Script started')).length, 1);
    assert.equal(b.document.listenerCount('pointermove'), 0);
    assert.equal(b.requests.length, 0);
    assert.equal(b.scheduler.timers.size, 0);
});

test('generated entry preserves lexical userscript grants outside globalThis', () => {
    const b = browser({ grants: false });
    b.context.captureMenu = (label, callback) => { b.menus.set(42, { label, callback }); return 42; };
    vm.runInContext('const GM_registerMenuCommand = (label, callback) => captureMenu(label, callback); const GM_unregisterMenuCommand = () => {};', b.context);
    assert.equal(b.context.GM_registerMenuCommand, undefined);
    b.start(); assert.equal(b.menus.size, 1);
    const previous = b.menus.get(42).label; b.menus.get(42).callback();
    assert.notEqual(b.menus.get(42).label, previous);
});

test('generated route entry, exit and reentry own one listener/observer set', async () => {
    const b = browser();
    b.mountMyList();
    b.start();
    await b.navigate('/browse/my-list');
    assert.equal(b.document.listenerCount('pointermove'), 1);
    assert.equal(b.window.listenerCount('resize'), 1);
    assert.equal(b.observers.filter(observer => observer.active).length, 1);
    assert.equal(b.scheduler.timers.size, 1);
    await b.navigate('/browse/my-list?language=en', 'replaceState');
    assert.equal(b.document.listenerCount('pointermove'), 1);
    await b.navigate('/browse');
    assert.equal(b.document.listenerCount('pointermove'), 0);
    assert.equal(b.window.listenerCount('resize'), 0);
    assert.equal(b.observers.filter(observer => observer.active).length, 0);
    assert.equal(b.scheduler.timers.size, 0);
    await b.navigate('/browse/my-list');
    assert.equal(b.document.listenerCount('pointermove'), 1);
    assert.equal(b.menus.size, 1);
});

test('generated runtime localizes live menu commands and releases stylesheet on route exit', async () => {
    const b = browser({ language: 'de-DE' });
    b.mountMyList();
    b.start();
    assert.equal([...b.menus.values()][0].label, 'Originale Meine Liste ausblenden');
    assert.equal(b.logs.filter(args => args.includes('Script started')).length, 1);
    await b.navigate('/browse/my-list');
    await b.scheduler.advance();
    const first = b.document.head.querySelector('style');
    assert.ok(first);
    assert.equal(b.document.head.querySelectorAll('style').length, 1);
    assert.ok(first.textContent.includes('tm-netflix-mylist-v15-grid'));
    b.document.documentElement.setAttribute('lang', 'en-US');
    [...b.menus.values()][0].callback();
    assert.equal(b.menus.size, 1);
    assert.equal([...b.menus.values()][0].label, 'Show original My List');
    await b.navigate('/browse');
    assert.equal(b.document.head.querySelectorAll('style').length, 0);
    await b.navigate('/browse/my-list');
    await b.scheduler.advance();
    const replacement = b.document.head.querySelector('style');
    assert.ok(replacement);
    assert.notEqual(replacement, first);
    assert.equal(replacement.textContent, first.textContent);
    assert.equal(b.document.head.querySelectorAll('style').length, 1);
    await b.navigate('/browse');
});

test('generated CopyLogs uses report providers without requests and retains logs across route entries', async () => {
    const b = browser();
    b.mountMyList();
    b.start();
    await b.navigate('/browse/my-list');
    await b.scheduler.advance();
    const requests = b.requests.length;
    async function copy(detailed = false) {
        const link = b.document.getElementById('tm-netflix-mylist-v20-log');
        assert.ok(link);
        link.dispatchEvent({ type: 'click', shiftKey: detailed, currentTarget: link, preventDefault() {} });
        await b.scheduler.flush();
    }
    await copy();
    assert.equal(b.clipboard.length, 1);
    assert.equal(b.requests.length, requests);
    assert.match(b.clipboard[0], /^My List for Netflix Diagnostic Log\nversion: /);
    assert.ok(b.clipboard[0].includes(`version: ${releaseVersion}\n`));
    assert.match(b.clipboard[0], /nativePopupDiagnostics: /);
    assert.match(b.clipboard[0], /Script started/);
    await b.navigate('/browse');
    await b.navigate('/browse/my-list');
    await b.scheduler.advance();
    await copy();
    assert.equal(b.clipboard.length, 2);
    assert.ok(b.clipboard[1].includes('CopyLogs completed'));
    assert.equal(b.clipboard[1].split('\n').filter(line => /^\[.*\] INFO\s+Script started(?: |$)/.test(line)).length, 1);
    assert.match(b.clipboard[1], /omitted event groups: 0/);
    const beforeDetailed = b.requests.length;
    await copy(true);
    assert.match(b.clipboard[2], /exportMode: detailed/);
    assert.equal(b.clipboard[2].match(/Script started/g).length, 1);
    assert.equal(b.requests.length, beforeDetailed);
    await b.navigate('/browse');
});

test('generated startup retains optional grants, storage and viewport fallbacks', async () => {
    const b = browser({ pathname: '/browse/my-list', grants: false, storage: false, visualViewport: false });
    b.start();
    assert.equal(b.menus.size, 0);
    assert.equal(b.document.listenerCount('pointermove'), 1);
    await b.scheduler.advance();
    assert.equal(b.requests.length, 0, 'unmounted native source keeps bounded discovery rather than fetching');
    await b.navigate('/browse');
    assert.equal(b.scheduler.timers.size, 0);
});

for (const stage of ['response', 'body']) {
    test(`generated route exit rejects a stale ${stage} without restoring old UI`, async () => {
        const b = browser();
        b.mountMyList();
        b.start();
        await b.navigate('/browse/my-list');
        await b.scheduler.advance();
        assert.equal(b.requests.length, 1, JSON.stringify(b.logs));
        assert.ok(b.document.getElementById('tm-netflix-mylist-v15-grid'));
        const request = b.requests[0];
        let bodyReads = 0;
        let resolveBody;
        const body = new Promise(resolve => { resolveBody = resolve; });
        const response = { ok: true, url: request.url, text() { bodyReads++; return body; } };
        if (stage === 'body') { request.resolve(response); await b.scheduler.flush(); assert.equal(bodyReads, 1); }
        await b.navigate('/browse');
        assert.equal(request.options.signal.aborted, true);
        request.resolve(response);
        resolveBody('<script>obsolete malformed bootstrap</script>');
        await b.scheduler.flush();
        assert.equal(bodyReads, stage === 'body' ? 1 : 0);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-grid'), null);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-status'), null);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-style'), null);
        assert.equal(b.scheduler.timers.size, 0);
        assert.ok(!b.logs.some(args => args.includes('Initialization failed')));
        assert.equal(b.requests.length, 1, 'cancelled request never starts a fallback');
    });
}

async function fixture(operation) {
    const base = path.resolve(root, '.tmp-build-tests-');
    const directory = await mkdtemp(base);
    try {
        for (const name of ['package.json', 'userscript.meta.json', 'src', 'tests']) {
            await cp(path.join(root, name), path.join(directory, name), { recursive: true });
        }
        await mkdir(path.dirname(path.join(directory, distribution)), { recursive: true });
        await writeFile(path.join(directory, distribution), shipped);
        await operation(directory);
    } finally {
        assert.ok(path.resolve(directory).startsWith(base), 'cleanup stays inside the created temporary fixture');
        await rm(directory, { recursive: true, force: true });
    }
}

test('build is deterministic, self-contained and preserves metadata/version', async () => {
    const { generateUserscript } = await import('../scripts/build.mjs');
    const first = await generateUserscript();
    const second = await generateUserscript();
    assert.equal(first.code, second.code);
    assert.equal(first.code, shipped);
    assert.ok(first.code.startsWith('// ==UserScript==\n'));
    const header = first.code.slice(0, first.code.indexOf('// ==/UserScript=='));
    assert.equal(header.match(/@version\s+(\S+)/)?.[1], releaseVersion);
    assert.equal(first.code.match(/SCRIPT_VERSION = ["']([^"']+)["']/)?.[1], releaseVersion);
    assert.equal(header.match(/@updateURL\s+(\S+)/)?.[1], 'https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js');
    assert.equal(header.match(/@downloadURL\s+(\S+)/)?.[1], 'https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js');
    assert.match(header, /@sandbox\s+raw/);
    assert.match(header, /@run-at\s+document-idle/);
    assert.match(header, /@noframes\s*$/m);
    assert.deepEqual([...header.matchAll(/@grant\s+(\S+)/g)].map(match => match[1]),
        ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_getValue', 'GM_setValue']);
    assert.doesNotMatch(header, /@require|@resource/);
    assert.ok(Object.values(first.metafile.outputs).every(output => output.imports.length === 0));
    new vm.Script(first.code);
});

test('final verification rejects residual suites and source-instrumenting test loaders', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    await fixture(async directory => {
        await writeFile(path.join(directory,'tests/performance.test.cjs'), '');
        await assert.rejects(checkUserscript({root:directory}), /Residual test support/);
    });
    await fixture(async directory => {
        await writeFile(path.join(directory,'tests/helpers/private-loader.js'), "import vm from 'node:vm';\n");
        await assert.rejects(checkUserscript({root:directory}), /Source-instrumenting test/);
    });
    await fixture(async directory => {
        const file=path.join(directory,'tests/scenario-transfers.json');
        const ledger=JSON.parse(await readFile(file,'utf8'));
        ledger.transfers[0].coverage[0].title='missing coverage';
        await writeFile(file,JSON.stringify(ledger));
        await assert.rejects(checkUserscript({root:directory}), /Missing scenario transfer target/);
    });
});

test('check rejects stale output/source and version disagreement without writing', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    await fixture(async directory => {
        await checkUserscript({ root: directory });
        const output = path.join(directory, distribution);
        await writeFile(output, shipped + '// stale\n');
        await assert.rejects(checkUserscript({ root: directory }), /stale|differs/i);
        assert.equal(await readFile(output, 'utf8'), shipped + '// stale\n');
        await writeFile(output, shipped);
        const entry = path.join(directory, 'src/main.js');
        await writeFile(entry, await readFile(entry, 'utf8') + "throw new Error('changed entry');\n");
        await assert.rejects(checkUserscript({ root: directory }), /stale|differs|version/i);
        assert.equal(await readFile(output, 'utf8'), shipped);
    });
    await fixture(async directory => {
        await writeFile(path.join(directory, distribution), shipped.replace(/(@version\s+)\S+/, (_match, prefix) => prefix + '0.0.0'));
        await assert.rejects(checkUserscript({ root: directory }), /version/i);
    });
    await fixture(async directory => {
        await writeFile(path.join(directory, distribution), shipped.replace(/(SCRIPT_VERSION = ["'])[^"']+/, (_match, prefix) => prefix + '0.0.0'));
        await assert.rejects(checkUserscript({ root: directory }), /version/i);
    });
});

test('check rejects altered grants and execution settings', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    for (const [key, value] of Object.entries({ grant: ['GM_getValue'], sandbox: 'JavaScript',
        'run-at': 'document-start', noframes: false, match: ['https://example.com/*'],
        name: 'Changed script', namespace: 'changed.script.identity', updateURL: 'https://example.com/wrong.user.js',
        downloadURL: 'https://example.com/wrong.user.js', require: ['https://example.com/runtime.js'] })) {
        await fixture(async directory => {
            const file = path.join(directory, 'userscript.meta.json');
            const metadata = JSON.parse(await readFile(file, 'utf8'));
            metadata[key] = value;
            await writeFile(file, JSON.stringify(metadata));
            await assert.rejects(checkUserscript({ root: directory }), /metadata/i);
        });
    }
});

test('importing authored application/session source does not activate the runtime', async () => {
    const application = await import('../src/app/application.js');
    const session = await import('../src/app/my-list-session.js');
    assert.equal(typeof application.createApplication, 'function');
    assert.equal(typeof session.createMyListSession, 'function');
});

test('production graph rejects a forbidden feature import before output comparison', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    await fixture(async directory => {
        await mkdir(path.join(directory, 'src/viewing'), { recursive: true });
        await mkdir(path.join(directory, 'src/grid'), { recursive: true });
        await writeFile(path.join(directory, 'src/viewing/viewing.js'), "import '../grid/grid.js';\n");
        await writeFile(path.join(directory, 'src/grid/grid.js'), 'export function createGrid() {}\n');
        const main = path.join(directory, 'src/main.js');
        await writeFile(main, "import './viewing/viewing.js';\n" + await readFile(main, 'utf8'));
        await assert.rejects(checkUserscript({ root: directory }), /Forbidden production import.*viewing\/viewing\.js.*grid\/grid\.js/);
    });
});

test('production graph rejects private cross-feature access and real import cycles', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    await fixture(async directory => {
        await mkdir(path.join(directory, 'src/grid'), { recursive: true });
        const main = path.join(directory, 'src/main.js');
        await writeFile(main, "import './grid/cards.js';\n" + await readFile(main, 'utf8'));
        await assert.rejects(checkUserscript({ root: directory }), /Forbidden production import.*main\.js.*grid\/cards\.js/);
    });
    await fixture(async directory => {
        await mkdir(path.join(directory, 'src/grid'), { recursive: true });
        const cards = path.join(directory, 'src/grid/cards.js');
        await writeFile(cards, "import './grid.js';\n" + await readFile(cards, 'utf8'));
        const main = path.join(directory, 'src/main.js');
        await writeFile(main, "import './grid/grid.js';\n" + await readFile(main, 'utf8'));
        await assert.rejects(checkUserscript({ root: directory }), /Production import cycle.*grid/);
    });
});

test('production graph rejects dormant source and unlisted legacy bridges', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    await fixture(async directory => {
        await mkdir(path.join(directory, 'src/grid'), { recursive: true });
        await writeFile(path.join(directory, 'src/grid/dormant.js'), 'export function createGrid() {}\n');
        await assert.rejects(checkUserscript({ root: directory }), /Unreachable production module.*grid\/dormant\.js/);
    });
    await fixture(async directory => {
        await mkdir(path.join(directory, 'src/grid'), { recursive: true });
        await writeFile(path.join(directory, 'src/grid/dormant.js'), 'export function createDormant() {}\n');
        const legacy = path.join(directory, 'src/legacy.js');
        await writeFile(legacy, "import './grid/dormant.js';\n");
        const main = path.join(directory, 'src/main.js');
        await writeFile(main, "import './legacy.js';\n" + await readFile(main, 'utf8'));
        await assert.rejects(checkUserscript({ root: directory }), /Forbidden production import.*(?:legacy\.js|main\.js)/);
    });
});

test('production graph accepts public composition and private capability dependencies', async () => {
    const { checkUserscript } = await import('../scripts/check.mjs');
    const { generateUserscript } = await import('../scripts/build.mjs');
    await fixture(async directory => {
        const files = {
            'app/application.js': "import '../grid/grid.js'; import '../list/list.js'; import '../viewing/viewing.js'; import '../hover/hover.js'; import '../diagnostics/report.js';\n",
            'grid/grid.js': "import './cards.js'; import '../netflix/card-markup.js'; import '../i18n/i18n.js';\n",
            'grid/cards.js': "import '../dom-names.js';\n",
            'dom-names.js': "export const GRID_ID = 'fixture';\n",
            'i18n/i18n.js': "import './ui-messages.js';\n",
            'i18n/ui-messages.js': 'export const messages = {};\n',
            'list/list.js': "import '../netflix/list-data.js'; import '../netflix/carousel/carousel.js';\n",
            'viewing/viewing.js': "import '../netflix/viewing-data.js';\n",
            'hover/hover.js': "import '../netflix/native-popup.js';\n",
            'netflix/native-popup.js': "import './carousel/carousel.js';\n",
            'netflix/carousel/carousel.js': "import './page-model.js';\n",
            'netflix/carousel/page-model.js': 'export const model = {};\n',
            'netflix/card-markup.js': "import '../dom-names.js';\n",
            'netflix/list-data.js': "import './context.js';\n",
            'netflix/viewing-data.js': "import './context.js';\n",
            'netflix/context.js': 'export const context = {};\n',
            'diagnostics/report.js': "import './logger.js';\n",
            'diagnostics/logger.js': 'export function log() {}\n'
        };
        for (const [name, code] of Object.entries(files)) {
            const file = path.join(directory, 'src', name);
            // Keep real capabilities already migrated; scaffold only absent future owners.
            try { await access(file); continue; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, code);
        }
        const main = path.join(directory, 'src/main.js');
        await writeFile(main, "import './app/application.js';\n" + await readFile(main, 'utf8'));
        await writeFile(path.join(directory, distribution), (await generateUserscript({ root: directory })).code);
        await checkUserscript({ root: directory });
    });
});

for (const viewingFailure of ['missing-context', 'http']) {
    test(`generated populated journey preserves the complete list after ${viewingFailure} viewing failure and fresh reentry`, async () => {
        const b = browser({ pathname: '/browse/my-list' });
        const { section } = mountPopulatedMyList(b, { count: 3 });
        const requests = [];
        b.context.URLSearchParams = URLSearchParams;
        const listFetch = b.context.fetch;
        if (viewingFailure === 'http') {
            const models = { userInfo: { userGuid: 'active-profile', authURL: 'test-auth' },
                services: { memberapi: '/api/shakti/test-build' } };
            b.window.netflix.appContext = { getModelData: name => models[name] };
        }
        b.context.fetch = async (url, options) => {
            requests.push({ url, options });
            return options?.method === 'POST' ? { ok: false, status: 503, json: async () => ({}) } : listFetch(url, options);
        };
        async function settle(visit) {
            for (let i = 0; i < 80 && b.logs.filter(row => row.includes('Initialization completed')).length < visit; i++) {
                await b.scheduler.advance(25); await b.scheduler.frame();
            }
            await b.scheduler.flush();
            assert.equal(b.logs.filter(row => row.includes('Initialization completed')).length, visit);
        }
        function cards() {
            return b.document.getElementById('tm-netflix-mylist-v15-grid').querySelectorAll('[data-tm-item-video-id]');
        }
        function filter(group, value) {
            return b.document.querySelector(`[data-tm-type-filter="${group}"]`).querySelector(`[data-tm-filter-value="${value}"]`);
        }
        function assertList() {
            assert.deepEqual(cards().map(node => node.getAttribute('data-tm-item-video-id')), ['1', '2', '3']);
            assert.equal(b.document.querySelectorAll('#tm-netflix-mylist-v15-grid').length, 1);
            assert.equal(filter('main', 'movie').getAttribute('aria-pressed'), 'true');
            assert.equal(filter('watched', 'movie').getAttribute('aria-pressed'), 'true');
            assert.equal(b.document.querySelector('[data-tm-watch-section]').open, false);
            assert.equal(b.document.querySelector('[data-tm-watch-grid]').querySelectorAll('[data-tm-item-video-id]').length, 0);
            assert.equal(b.document.listenerCount('pointermove'), 1);
            assert.equal(b.window.listenerCount('resize'), 1);
            assert.equal(b.window.listenerCount('popstate'), 1);
            assert.equal(b.window.listenerCount('hashchange'), 1);
            assert.equal(b.menus.size, 1);
        }
        b.start(); await settle(1); assertList();
        assert.ok(JSON.stringify(b.logs).includes(viewingFailure === 'http' ? 'VIEWING_STATUS_HTTP_503' : 'VIEWING_STATUS_CONTEXT'));
        const firstRoot = b.document.getElementById('tm-netflix-mylist-v15-grid');
        const firstCards = cards();
        // Unknown metadata stays reachable through All after the optional failure.
        filter('main', 'all').dispatchEvent({ type: 'click' });
        assert.ok(cards().every(node => node.getAttribute('data-tm-type-hidden') !== 'true'));
        assert.equal(filter('watched', 'movie').getAttribute('aria-pressed'), 'true');
        filter('watched', 'series').dispatchEvent({ type: 'click' });
        assert.equal(filter('main', 'all').getAttribute('aria-pressed'), 'true');
        assert.equal(filter('watched', 'series').getAttribute('aria-pressed'), 'true');
        [...b.menus.values()][0].callback();
        assert.equal(section.getAttribute('data-tm-original-mylist-visible'), 'false');
        await b.navigate('/browse');
        assert.equal(firstRoot.isConnected, false);
        assert.ok(firstCards.every(node => !node.isConnected));
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-grid'), null);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-status'), null);
        assert.equal(b.document.getElementById('tm-netflix-mylist-v15-style'), null);
        assert.equal(section.getAttribute('data-tm-original-mylist-visible'), null);
        assert.equal(b.document.listenerCount('pointermove'), 0);
        assert.equal(b.window.listenerCount('resize'), 0);
        // The retained native cards now belong to browsing recommendation controls.
        assert.equal(b.observers.filter(observer => observer.active).length, viewingFailure === 'http' ? 1 : 0);
        assert.equal(b.scheduler.timers.size, 0); assert.equal(b.scheduler.frames.size, 0);
        await b.navigate('/browse/my-list'); await settle(2); assertList();
        assert.notEqual(b.document.getElementById('tm-netflix-mylist-v15-grid'), firstRoot);
        assert.ok(cards().every(node => !firstCards.includes(node)));
        assert.equal(section.getAttribute('data-tm-original-mylist-visible'), 'false', 'semantic preference survives route retirement');
        assert.equal(b.logs.filter(row => row.includes('Script started')).length, 1);
        assert.equal(requests.filter(request => request.options?.method === 'POST').length, viewingFailure === 'http' ? 2 : 0,
            'one optional attempt per visit, no retry loop');
        await b.navigate('/browse');
        assert.equal(b.scheduler.timers.size, 0); assert.equal(b.scheduler.frames.size, 0);
    });
}

test('generated populated viewing results update groups and independent filters through real session callbacks', async () => {
    const b = browser({ pathname: '/browse/my-list' });
    mountPopulatedMyList(b, { count: 3 });
    b.context.URLSearchParams = URLSearchParams;
    const models = { userInfo: { userGuid: 'active-profile', authURL: 'test-auth' },
        services: { memberapi: '/api/shakti/test-build' } };
    b.window.netflix.appContext = { getModelData: name => models[name] };
    const listFetch = b.context.fetch, requests = [];
    b.context.fetch = async (url, options) => {
        if (options?.method !== 'POST') return listFetch(url, options);
        requests.push({ url, options });
        return { ok: true, json: async () => ({ jsonGraph: { videos: {
            1: viewingVideo('movie', true), 2: viewingVideo('movie', false, 25), 3: viewingVideo('show', false)
        } } }) };
    };
    b.start();
    for (let i = 0; i < 80 && !b.logs.some(row => row.includes('Viewing status collection completed')); i++) {
        await b.scheduler.advance(25); await b.scheduler.frame();
    }
    assert.ok(b.logs.some(row => row.includes('Viewing status collection completed')), 'viewing scan completes within the modeled bound');
    const root = b.document.getElementById('tm-netflix-mylist-v15-grid');
    assert.ok(root);
    const watched = root.querySelector('[data-tm-watch-grid]');
    const ids = parent => parent.children.filter(node => node.getAttribute('data-tm-item-video-id') !== null)
        .map(node => node.getAttribute('data-tm-item-video-id'));
    const filter = (group, value) => root.querySelector(`[data-tm-type-filter="${group}"]`).querySelector(`[data-tm-filter-value="${value}"]`);
    const visible = parent => parent.children.filter(node => node.getAttribute('data-tm-item-video-id') !== null && node.getAttribute('data-tm-type-hidden') !== 'true')
        .map(node => node.getAttribute('data-tm-item-video-id'));
    assert.deepEqual(ids(root), ['2', '3']);
    assert.deepEqual(ids(watched), ['1']);
    assert.deepEqual(visible(root), ['2']);
    assert.deepEqual(visible(watched), ['1']);
    assert.equal(filter('main', 'movie').getAttribute('aria-pressed'), 'true');
    assert.equal(filter('watched', 'movie').getAttribute('aria-pressed'), 'true');
    assert.equal(filter('main', 'all').querySelector('[data-tm-type-count]').textContent, '2');
    assert.equal(filter('watched', 'all').querySelector('[data-tm-type-count]').textContent, '1');
    assert.equal(root.querySelector('[data-tm-watch-section]').open, false);
    const requestsAtCompletion = requests.length;
    assert.ok(requestsAtCompletion > 0);
    filter('main', 'series').dispatchEvent({ type: 'click' });
    assert.deepEqual(visible(root), ['3']);
    assert.equal(filter('watched', 'movie').getAttribute('aria-pressed'), 'true');
    filter('watched', 'series').dispatchEvent({ type: 'click' });
    assert.deepEqual(visible(watched), []);
    assert.deepEqual(visible(root), ['3']);
    filter('main', 'all').dispatchEvent({ type: 'click' });
    assert.deepEqual(visible(root), ['2', '3']);
    assert.equal(requests.length, requestsAtCompletion, 'filter changes reuse the completed result without requests');
    await b.navigate('/browse');
    assert.equal(root.isConnected, false);
    assert.equal(b.scheduler.timers.size, 0); assert.equal(b.scheduler.frames.size, 0);
});
