'use strict';

// Temporary extraction support for cases not yet moved to public capability interfaces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'legacy.js'), 'utf8');
function declaration(name) {
    if (name === 'retireGridCard') return declaration('retireHoverCard')+'\nfunction retireGridCard(handle, detail) { nativePopup.retire(handle); retireHoverCard(handle, detail); }';
    if (require('./native-popup.cjs').names.includes(name)) return 'var '+name+' = fixturePopupOriginal.'+name+';';
    if (name === 'onGridCardReplaced') return '';
    const match = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert.ok(match, `Missing legacy source function ${name}`);
    const rest = source.slice(match.index);
    const next = /\n    (?:(?:async )?function\s|(?:const|let)\s)/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

module.exports = { source, declaration };
