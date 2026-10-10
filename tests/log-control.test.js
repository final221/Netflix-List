import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogControl } from '../src/diagnostics/control.js';
import { createDocument } from './helpers/dom.js';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const click = (button, shiftKey = false) => button.dispatchEvent({ type: 'click', shiftKey, preventDefault() {} });
test('universal log control saves compact/detailed captures, prevents double clicks and shows download failure', async () => {
    const document = createDocument(), pending = [], options = [];
    const control = createLogControl({ document, tLog: (key, data) => key + (data?.message || ''),
        copyLogs: value => { options.push(value); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } });
    control.start(); control.start(); const button = document.getElementById('tm-netflix-copylogs');
    assert.equal(button.listenerCount('click'), 1); click(button); click(button, true); assert.equal(options.length, 1);
    pending[0].resolve('logs/capture.txt'); await flush();
    assert.match(document.querySelector('[role="status"]').textContent, /logs\/capture.txt/);
    assert.equal(button.disabled, false); click(button, true); assert.deepEqual(options[1], { detailed: true });
    pending[1].reject(new Error('Download cancelled')); await flush();
    assert.match(document.querySelector('[role="status"]').textContent, /Download cancelled/); control.dispose();
    assert.equal(button.listenerCount('click'), 0); assert.equal(document.head.querySelectorAll('style').length, 0);
});

test('retired export completion cannot paint a replacement control', async () => {
    const document = createDocument(), pending = [];
    const control = createLogControl({ document, tLog: key => key, copyLogs: () => new Promise(resolve => pending.push(resolve)) });
    control.start(); const old = document.getElementById('tm-netflix-copylogs'); click(old); control.dispose(); control.start();
    pending[0]('logs/old.txt'); await flush();
    const button = document.getElementById('tm-netflix-copylogs'); assert.notEqual(button, old);
    assert.equal(document.querySelector('[role="status"]').hidden, true); control.dispose();
});
