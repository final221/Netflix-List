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

test('small or incompressible sections stay plain and earlier plain JSON remains readable', () => {
    const plain = { available: true, reason: 'complete' };
    assert.equal(encodeDiagnostic(plain).packed, false);
    const unique = 'abcdefghij'.repeat(600);
    assert.equal(encodeDiagnostic(unique).packed, false);
    assert.equal(parseDiagnostic(encodeDiagnostic(unique).text), unique); assert.deepEqual(parseDiagnostic(JSON.stringify(plain)), plain);
});

const packet = (schemas, values, root = [0]) => ({ $diagnostic: 'shared-json-v1', schemas, values, root });

test('encoded reports reject malformed tables, references, records and object schemas', () => {
    const invalid = [
        ['schema table missing', packet(null, []), /tables/],
        ['value table missing', packet([], null), /tables/],
        ['object in place of scalar or reference', packet([], [], {}), /value/],
        ['empty reference', packet([], [], []), /reference/],
        ['multiple reference indices', packet([], ['a'], [0, 0]), /reference/],
        ['negative reference', packet([], ['a'], [-1]), /reference/],
        ['fractional reference', packet([], ['a'], [.5]), /reference/],
        ['reference outside table', packet([], [], [0]), /reference/],
        ['cyclic reference', packet([], [[null, [[0]]]]), /reference/],
        ['missing record', packet([], [null]), /record/],
        ['record with wrong arity', packet([], [[null]]), /record/],
        ['non-array members', packet([], [[null, 4]]), /record/],
        ['schema outside table', packet([], [[4, []]]), /schema/],
        ['negative schema', packet([], [[-1, []]]), /schema/],
        ['fractional schema', packet([], [[.5, []]]), /schema/],
        ['non-array schema', packet([{}], [[0, []]]), /schema/],
        ['member count mismatch', packet([['a', 'b']], [[0, [1]]]), /schema/],
        ['non-string key', packet([[5]], [[0, [1]]]), /schema/],
        ['duplicate key', packet([['a', 'a']], [[0, [1, 2]]]), /schema/]
    ];
    for (const [name, value, reason] of invalid) {
        assert.throws(() => decodeDiagnostic(value), reason, name);
    }
});

test('expansion bounds reject excessive work and nesting while permitting the depth boundary and shared references', () => {
    const valid = JSON.parse(encodeDiagnostic(Array.from({ length: 500 }, () => ({ reason: 'repeated' }))).text);
    assert.throws(() => decodeDiagnostic(valid, { maxNodes: 10 }), /limit/);
    const chain = length => packet([], Array.from({ length }, (_, index) =>
        index === length - 1 ? 'leaf' : [null, [[index + 1]]]));
    assert.doesNotThrow(() => decodeDiagnostic(chain(101)));
    assert.throws(() => decodeDiagnostic(chain(102)), /limit/);
    const shared = packet([['value']], [[0, [7]], [null, [[0], [0]]]], [1]);
    const decoded = decodeDiagnostic(shared);
    assert.deepEqual(decoded, [{ value: 7 }, { value: 7 }]);
    decoded[0].value = 8;
    assert.equal(decoded[1].value, 7, 'sharing in the encoding cannot alias reconstructed mutable objects');
});
