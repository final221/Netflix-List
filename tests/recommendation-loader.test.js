import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './helpers/browser.js';
import { Element } from './helpers/dom.js';
import { createRecommendationDom } from '../src/netflix/recommendation-dom.js';
import { createLoaderSurvey } from '../src/netflix/recommendation-loader.js';

function result() {
    const query = { definitions: [{ kind: 'OperationDefinition', operation: 'query', name: { value: 'RowPagination' },
        variableDefinitions: [{ variable: { name: { value: 'after' } }, type: { kind: 'NamedType', name: { value: 'String' } } }] }] };
    return { fetchMore() { throw Error('must never invoke'); }, observable: { options: { query, fetchPolicy: 'cache-first' } },
        variables: { id: 'private-row', first: 14, after: 'private-cursor', authToken: 'private-token' },
        data: { node: { id: 'private-row', entities: { totalCount: 114, pageInfo: { hasNextPage: true, endCursor: 'private-end' },
            edges: [{ node: { unifiedEntity: { videoId: '1' } } }, { node: { videoId: '2' } }] } } } };
}

test('query candidates match the row while retaining only argument shapes and safe pagination facts', () => {
    const survey = createLoaderSurvey(['1', '2']), value = result();
    survey.inspect(value, { depth: 17, source: 'hookState:34', path: '0' });
    const facts = survey.snapshot().candidates[0];
    assert.equal(facts.operations[0].name, 'RowPagination');
    assert.deepEqual(facts.operations[0].variables, [{ name: 'after', type: 'String' }]);
    assert.equal(facts.connection.rowOverlap, 2); assert.equal(facts.connection.identityMatchesVariable, true);
    assert.equal(facts.connection.cursorPresent, true); assert.equal(facts.connection.hasNextPage, true);
    assert.equal(facts.variables.find(v => v.name === 'first').value, 14);
    assert.doesNotMatch(JSON.stringify(facts), /private-|authToken/);
    facts.connection.titleIds.length = 0;
    assert.equal(survey.snapshot().candidates[0].connection.titleIds.length, 2);
});

test('malformed documents, accessors and cycles cannot execute native code or crowd out a matched row', () => {
    let calls = 0; const survey = createLoaderSurvey(['1', '2']), value = result();
    Object.defineProperty(value.variables, 'offset', { enumerable: true, get() { calls++; throw Error('getter'); } });
    Object.defineProperty(value.data.node.entities.edges, '1', { get() { calls++; throw Error('getter'); } });
    value.data.node.entities.edges.push({ node: { videoId: { toString() { calls++; throw Error('coercion'); } } } });
    const definitions = value.observable.options.query.definitions;
    const cyclicType = { kind: 'NonNullType' }; cyclicType.type = cyclicType;
    definitions[0].variableDefinitions[0].type = cyclicType;
    Object.defineProperty(definitions, '1', { get() { calls++; throw Error('getter'); } });
    survey.inspect({ fetchMore() {}, query: { definitions: {} } }, { path: 'unmatched' });
    survey.inspect(value, { path: 'matched' }); survey.inspect(value, { path: 'duplicate' });
    assert.equal(calls, 0); assert.equal(survey.snapshot().candidates.length, 2);
    assert.equal(survey.snapshot().candidates[0].path, 'matched');
});


test('the public native arrow survey associates a hook query with mounted row titles without operating Netflix', () => {
    const b = createBrowser(), row = b.document.body.appendChild(new Element('section'));
    const host = row.appendChild(new Element('div')); host.setAttribute('data-virtual-slot', '0');
    const card = host.appendChild(new Element('a')); card.setAttribute('data-uia', 'standard-card'); card.setAttribute('href', '/title/1');
    const control = row.appendChild(new Element('button'));
    control.__reactFiber$trial = { memoizedState: { memoizedState: [result()], next: null }, return: null };
    const facts = createRecommendationDom(b.context).navigationStart(control);
    assert.equal(facts.loader.candidates[0].connection.rowOverlap, 1);
    assert.equal(facts.loader.candidates[0].operations[0].name, 'RowPagination');
    assert.equal(card.getAttribute('href'), '/title/1'); assert.doesNotMatch(JSON.stringify(facts.loader), /private-/);
});
