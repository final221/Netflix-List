import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { distributionName, generateUserscript, repositoryRoot } from './build.mjs';

const publicFeatures = new Set(['src/list/list.js', 'src/viewing/viewing.js', 'src/grid/grid.js', 'src/hover/hover.js', 'src/recommendations/recommendations.js']);
const netflixEntries = new Set(['context', 'page-dom', 'list-data', 'viewing-data', 'card-markup', 'native-popup', 'popup-inspection', 'recommendation-dom']
    .map(name => `src/netflix/${name}.js`).concat('src/netflix/carousel/carousel.js'));
const supportEntries = new Set(['src/dom-names.js', 'src/card-actions.js', 'src/i18n/i18n.js', 'src/diagnostics/logger.js', 'src/diagnostics/report.js']);
const listAdapters = new Set(['src/netflix/list-data.js', 'src/netflix/page-dom.js', 'src/netflix/carousel/carousel.js']);
const viewingAdapters = new Set(['src/netflix/context.js', 'src/netflix/viewing-data.js']);
const gridAdapters = new Set(['src/netflix/card-markup.js', 'src/dom-names.js', 'src/card-actions.js', 'src/i18n/i18n.js']);
const hoverAdapters = new Set(['src/netflix/native-popup.js', 'src/netflix/carousel/carousel.js']);

function area(file) {
    if (file.startsWith('src/netflix/carousel/')) return 'carousel';
    return file.split('/')[1];
}

function allowedImport(from, to) {
    if (from === 'src/legacy.js' || to === 'src/legacy.js') return false;
    const owner = area(from);
    if (owner === 'app' || from === 'src/main.js') {
        return area(to) === 'app' || publicFeatures.has(to) || netflixEntries.has(to) || supportEntries.has(to);
    }
    // A capability may depend on its private neighbors, but never import the application entry.
    if (owner === area(to) && owner !== 'main.js' && owner !== 'dom-names.js') return true;
    if (owner === 'netflix' || owner === 'carousel') return netflixEntries.has(to) || to === 'src/dom-names.js';
    if (owner === 'list') return listAdapters.has(to);
    if (owner === 'viewing') return from !== 'src/viewing/completion.js' && viewingAdapters.has(to);
    if (owner === 'grid') return gridAdapters.has(to);
    if (owner === 'hover') return hoverAdapters.has(to);
    if (owner === 'recommendations') return ['src/netflix/recommendation-dom.js', 'src/netflix/context.js', 'src/card-actions.js', 'src/viewing/viewing.js'].includes(to);
    return false;
}

async function productionFiles(root, directory = 'src') {
    const files = [];
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) files.push(...await productionFiles(root, relative));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative);
        else throw new Error('Unexpected production source entry: ' + relative);
    }
    return files;
}

async function checkDependencies(metafile, root) {
    const graph = new Map();
    for (const [name, input] of Object.entries(metafile.inputs)) {
        const from = name.replaceAll('\\', '/');
        assert.ok(from.startsWith('src/'), 'Production input must be authored source: ' + from);
        const dependencies = [];
        for (const dependency of input.imports) {
            const to = dependency.path.replaceAll('\\', '/');
            const edge = `${from} -> ${to}`;
            assert.ok(!dependency.external && to.startsWith('src/'), 'External production import: ' + edge);
            assert.ok(allowedImport(from, to), 'Forbidden production import: ' + edge);
            dependencies.push(to);
        }
        graph.set(from, dependencies);
    }
    for (const file of await productionFiles(root)) {
        assert.ok(graph.has(file), 'Unreachable production module: ' + file);
    }
    const visited = new Set(), visiting = new Set(), chain = [];
    function visit(file) {
        if (visiting.has(file)) throw new Error('Production import cycle: ' + [...chain, file].join(' -> '));
        if (visited.has(file)) return;
        assert.ok(graph.has(file), 'Missing production dependency: ' + file);
        visiting.add(file);
        chain.push(file);
        for (const dependency of graph.get(file)) visit(dependency);
        chain.pop();
        visiting.delete(file);
        visited.add(file);
    }
    for (const file of graph.keys()) visit(file);
}

// Final suites exercise real capabilities. Only bundle.test.js executes code in
// a VM, and its input is the complete generated userscript, never declarations.
async function checkTestBoundaries(root, directory = 'tests') {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) { await checkTestBoundaries(root, relative); continue; }
        assert.ok(entry.name.endsWith('.js') || entry.name === 'scenario-transfers.json', 'Residual test support: ' + relative);
        if (relative === 'tests/bundle.test.js' || entry.name.endsWith('.json')) continue;
        const source = await readFile(path.join(root, relative), 'utf8');
        assert.ok(!/node:vm|\b(?:eval|Function)\s*\(/.test(source), 'Source-instrumenting test: ' + relative);
    }
}

async function checkScenarioTransfers(root) {
    const ledger = JSON.parse(await readFile(path.join(root, 'tests/scenario-transfers.json'), 'utf8'));
    assert.equal(ledger.baseline.cases, 372, 'Scenario transfer baseline changed');
    assert.equal(ledger.transfers.length, ledger.baseline.cases, 'Missing baseline scenario transfers');
    assert.equal(new Set(ledger.transfers.map(row => row.line)).size, ledger.baseline.cases, 'Duplicate baseline scenario transfers');
    const suites = new Map();
    for (const row of ledger.transfers) {
        assert.ok(row.title && row.coverage.length, 'Scenario transfer has no named coverage');
        assert.ok(['retained', 'owner-boundary replacement'].includes(row.disposition), 'Unknown scenario disposition');
        for (const target of row.coverage) {
            assert.match(target.file, /^tests\/[\w-]+\.test\.js$/, 'Scenario target must be a named suite');
            if (!suites.has(target.file)) {
                const source = await readFile(path.join(root, target.file), 'utf8');
                suites.set(target.file, new Set([...source.matchAll(/\btest\(\s*(['"])(.*?)\1\s*,/g)].map(match => match[2])));
            }
            assert.ok(suites.get(target.file).has(target.title), 'Missing scenario transfer target: ' + target.title);
            if (row.disposition === 'retained') assert.equal(target.title, row.title, 'Retained scenario was renamed');
        }
    }
}

// Preserve installation identity and the published release location.
function checkInstallation(metadata) {
    assert.equal(metadata.name, 'My List for Netflix', 'Metadata name must preserve script identity');
    const releaseURL = 'https://raw.githubusercontent.com/final221/Netflix-List/refs/heads/main/dist/My%20List%20for%20Netflix.user.js';
    assert.equal(metadata.updateURL, releaseURL, 'Metadata updateURL must use the published dist artifact');
    assert.equal(metadata.downloadURL, releaseURL, 'Metadata downloadURL must use the published dist artifact');
    assert.deepEqual(metadata.match, ['https://www.netflix.com/*'], 'Metadata match must preserve the Netflix scope');
    assert.deepEqual(metadata.grant,
        ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_getValue', 'GM_setValue'],
        'Metadata grants must preserve the baseline permissions');
    assert.equal(metadata['run-at'], 'document-idle', 'Metadata run-at must remain document-idle');
    assert.equal(metadata.sandbox, 'raw', 'Metadata sandbox must preserve the page environment');
    assert.equal(metadata.noframes, true, 'Metadata noframes must remain enabled');
    assert.equal(metadata.namespace, 'local.netflix.mylist.grid', 'Metadata namespace must preserve script identity');
    assert.ok(!Object.hasOwn(metadata, 'require') && !Object.hasOwn(metadata, 'resource'), 'Metadata cannot add runtime dependencies');
}

// Read-only: never rebuilds over the artifact being verified.
export async function checkUserscript({ root = repositoryRoot } = {}) {
    const generated = await generateUserscript({ root });
    checkInstallation(generated.metadata);
    await checkDependencies(generated.metafile, root);
    await checkTestBoundaries(root);
    await checkScenarioTransfers(root);
    const shipped = (await readFile(path.join(root, distributionName), 'utf8')).replace(/\r\n/g, '\n');
    const header = shipped.match(/^\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==\n/);
    assert.ok(header, 'Userscript header must be the first bytes');
    assert.equal(header[1].match(/@version\s+(\S+)/)?.[1], generated.version, 'Metadata version differs from package.json');
    assert.equal(shipped.match(/\b(?:const|var) SCRIPT_VERSION = ["']([^"']+)["']/)?.[1], generated.version,
        'Internal version differs from package.json');
    for (const output of Object.values(generated.metafile.outputs)) {
        assert.equal(output.imports.length, 0, 'Userscript cannot require external runtime imports');
    }
    new Script(shipped, { filename: distributionName });
    assert.ok(shipped === generated.code, 'Committed userscript is stale or differs from generated output; run npm run build');
    return generated;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const result = await checkUserscript();
    console.log(`Verified ${distributionName} v${result.version}`);
}
