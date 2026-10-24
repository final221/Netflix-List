import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseDiagnostic, utf8Bytes } from '../src/diagnostics/encoding.js';

const SECTIONS = new Set(['snapshot', 'previousPages', 'seriesViewing', 'thumbnailDiagnostics', 'nativePopupDiagnostics']);
export function expandLog(text) {
    return text.split(/\r?\n/).map(line => {
        const offset = line.indexOf(': '), key = line.slice(0, offset);
        return SECTIONS.has(key) ? key + ': ' + JSON.stringify(parseDiagnostic(line.slice(offset + 2))) : line;
    }).join('\n');
}

export async function main(args) {
    const [file, ...options] = args;
    if (!file) throw Error('Usage: node scripts/read-log.mjs <capture> [--section snapshot --path recommendations.rowLifecycle] [--expand <temporary-output>]');
    const flags = {};
    for (let index = 0; index < options.length; index += 2) {
        if (!['--section', '--path', '--expand'].includes(options[index]) || !options[index + 1]) throw Error('Invalid reader option');
        flags[options[index]] = options[index + 1];
    }
    const text = await readFile(file, 'utf8'), lines = text.split(/\r?\n/);
    if (flags['--expand']) {
        await writeFile(flags['--expand'], 'analysisExpansion: reconstructed JSON; original exportSizes retained\n' + expandLog(text), { flag: 'wx' });
        return { expanded: flags['--expand'] };
    }
    if (flags['--section']) {
        const section = flags['--section'];
        if (!SECTIONS.has(section)) throw Error('Unknown diagnostic section');
        const line = lines.find(line => line.startsWith(section + ': '));
        if (!line) throw Error('Section absent');
        let value = parseDiagnostic(line.slice(section.length + 2));
        for (const key of (flags['--path'] || '').split('.').filter(Boolean)) {
            if (!value || !Object.hasOwn(value, key)) throw Error('Diagnostic path absent');
            value = value[key];
        }
        const rendered = JSON.stringify(value, null, 2);
        return rendered.length <= 4000 ? value : { preview: rendered.slice(0, 4000), truncated: true, advice: 'Use --expand to a temporary file for full local inspection.' };
    }
    return { bytes: utf8Bytes(text), sections: lines.flatMap(line => {
        const offset = line.indexOf(': '), key = line.slice(0, offset);
        return SECTIONS.has(key) ? [{ section: key, bytes: utf8Bytes(line.slice(offset + 2)) }] : [];
    }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
