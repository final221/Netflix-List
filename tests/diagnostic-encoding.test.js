import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDiagnostic, decodeDiagnostic, parseDiagnostic, utf8Bytes } from '../src/diagnostics/encoding.js';

test('shared diagnostic tables round-trip all JSON facts, chronology, Unicode and marker-like data', () => {
    const row = JSON.parse('{"__proto__":{"safe":true},"constructor":"literal","empty":{},"tuple":[0,false,null,"🦊"]}');
    const input = { rows: Array.from({ length: 50 }, (_, sequence) => ({ sequence, row, stage: 'verified', rect: [10, 20, 30, 40] })),
        rowLifecycle: { recent: Array.from({ length: 40 }, (_, at) => ({ at, kind: 'cache', operation: 'restore', stage: 'returned' })) } };
    const unchanged = JSON.stringify(input), encoded = encodeDiagnostic(input);
    assert.equal(encoded.packed, true); assert.ok(encoded.bytes < encoded.plainBytes / 2);
    assert.deepEqual(parseDiagnostic(encoded.text), input); assert.equal(JSON.stringify(input), unchanged);
    const marker = { $diagnostic: 'shared-json-v1', schemas: [], values: [], root: null };
    assert.deepEqual(parseDiagnostic(encodeDiagnostic(marker).text), marker);
    assert.equal(utf8Bytes('aä🦊'), Buffer.byteLength('aä🦊'));
});

test('small or incompressible sections stay plain and invalid references cannot execute or expand indefinitely', () => {
    const plain = { available: true, reason: 'complete' };
    assert.equal(encodeDiagnostic(plain).packed, false);
    const unique = 'abcdefghij'.repeat(600);
    assert.equal(encodeDiagnostic(unique).packed, false);
    assert.equal(parseDiagnostic(encodeDiagnostic(unique).text), unique); assert.deepEqual(parseDiagnostic(JSON.stringify(plain)), plain);
    const packet = { $diagnostic: 'shared-json-v1', schemas: [], values: [[null, [[0]]]], root: [0] };
    assert.throws(() => decodeDiagnostic(packet), /reference/);
    packet.root = [9]; assert.throws(() => decodeDiagnostic(packet), /reference/);
    const valid = JSON.parse(encodeDiagnostic(Array.from({ length: 500 }, () => ({ reason: 'repeated' }))).text);
    assert.throws(() => decodeDiagnostic(valid, { maxNodes: 10 }), /limit/);
});
