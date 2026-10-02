import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { distributionName, generateUserscript, repositoryRoot } from './build.mjs';

// Preserve the baseline installation contract while feature ownership migrates.
function checkInstallation(metadata) {
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
