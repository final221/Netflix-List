import test from 'node:test';
import assert from 'node:assert/strict';
import { createMyListSource } from '../src/app/my-list-source.js';

function sourceOwner() {
    return createMyListSource({ environment: {}, i18n: {}, logger: {},
        session: { createRouteSessionCancelledError: () => Object.assign(new Error('retired'), { code: 'CANCELLED' }) },
        presentation: { retireViewing() {}, watchFor() {} } });
}

test('accepted source facts are read-only and stale parents cannot accept later layout or grid status', () => {
    const source = sourceOwner();
    const input = { layout: { columns: 6 }, status: 'initial' };
    const first = source.publishSourceState(input);
    input.status = 'caller changed';
    assert.equal(first.status, 'initial');
    assert.throws(() => { first.layout = { columns: 3 }; }, TypeError);
    source.acceptLayout(first, { columns: 3 });
    assert.equal(first.layout.columns, 3);
    const second = source.publishSourceState({ layout: { columns: 2 }, status: 'replacement' });
    assert.throws(() => source.acceptLayout(first, { columns: 9 }), { code: 'CANCELLED' });
    assert.throws(() => source.acceptStatus(first, 'obsolete'), { code: 'CANCELLED' });
    assert.equal(second.layout.columns, 2);
    assert.equal(second.status, 'replacement');
});

test('source retirement observes the accepted replacement and cannot overwrite a reentrant newer parent', () => {
    const source = sourceOwner();
    let retirements = 0;
    source.publishSourceState({ status: 'old', listMembership: { dispose() {
        retirements++;
        assert.equal(source.current.status, 'replacement');
        source.publishSourceState({ status: 'newer' });
    } } });
    const retiredDuringPublication = source.publishSourceState({ status: 'replacement' });
    assert.equal(retirements, 1);
    assert.equal(retiredDuringPublication.status, 'replacement');
    assert.equal(source.current.status, 'newer');
    assert.throws(() => source.acceptStatus(retiredDuringPublication, 'stale'), { code: 'CANCELLED' });
});
