'use strict';

// Temporary extraction support for cases not yet moved to public capability interfaces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'my-list-session.js'), 'utf8').replaceAll('settings.preferences().viewOriginalMyList', 'viewOriginalMyList');
function declaration(name) {
    if (name === 'normalizeNetflixUiText') return 'var normalizeNetflixUiText = fixtureNormalizeTitle;';
    if (name === 'gridOwnsClone') return 'function gridOwnsClone(node, root) { return gridView.isCardVisible(node, root); }';
    if (name === 'normalizeClone') return 'function normalizeClone(node) { return gridView.normalizeCard(node); }';
    if (name === 'itemKeyFromCard') return 'function itemKeyFromCard(card) { const identity = nativeCarousel.cardIdentity(card); return identity ? itemKey(identity) : ""; }';
    if (name === 'createPerformanceDiagnostics') return declaration('fixtureAppCounters')+'\nfunction createPerformanceDiagnostics() { return {...fixtureAppCounters(), nativeRecovery: {...fixtureAppCounters().nativeRecovery, alignmentRestores:0, alignmentRestoreFailures:0}, undoRetention: {remembered:0,expired:0,consumed:0,cleared:0,schedules:0,expiryCallbacks:0}, ...createHoverCounters(), resize: createResponsiveCounters(), imageResources: createImageCounters()}; }';
    if (require('./responsive.cjs').names.includes(name)) return 'var '+name+' = fixtureResponsiveOriginal.'+name+';';
    if (require('./responsive.cjs').imageNames.includes(name)) return 'var '+name+' = fixtureImagesOriginal.'+name+';';
    if (name === 'fixtureAppCounters') return source.match(/    function createPerformanceDiagnostics\([\s\S]*?\n    }/)[0].replace('createPerformanceDiagnostics','fixtureAppCounters');
    if (require('./hover.cjs').names.includes(name) || require('./hover.cjs').timingNames.includes(name)) return 'var '+name+' = fixtureHoverOriginal.'+name+';';
    if (name === 'retireGridCard') return declaration('retireHoverCard')+'\nfunction retireGridCard(handle, detail) { nativePopup.retire(handle); retireHoverCard(handle, detail); }';
    if (require('./native-popup.cjs').names.includes(name)) return 'var '+name+' = fixturePopupOriginal.'+name+';';
    if (name === 'onGridCardReplaced') return '';
    const match = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert.ok(match, `Missing legacy source function ${name}`);
    const rest = source.slice(match.index);
    const next = /\n    (?:(?:async )?function\s|(?:const|let)\s)/.exec(rest);
    return (next ? rest.slice(0, next.index) : rest).replaceAll('gridView.images', 'fixtureImages');
}

module.exports = { source, declaration };
