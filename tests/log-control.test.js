import { createScheduler } from './helpers/scheduler.js';
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

test('success feedback is above the stationary button, expires after three seconds and cannot clear a later result', async () => {
    const document = createDocument(), scheduler = createScheduler(), pending = [];
    const control = createLogControl({ document, ...scheduler, tLog: key => key,
        copyLogs: () => new Promise(resolve => pending.push(resolve)) }); control.start();
    const button = document.getElementById('tm-netflix-copylogs'), message = document.querySelector('[role="status"]');
    const style = document.head.querySelector('style').textContent;
    assert.match(style, /p\{position:absolute;right:0;bottom:calc\(100% \+ 8px\)/);
    click(button); pending[0]('first.txt'); await flush(); assert.equal(message.hidden, false);
    await scheduler.advance(2999); assert.equal(message.hidden, false);
    await scheduler.advance(1); assert.equal(message.hidden, true); assert.equal(message.textContent, '');
    click(button); pending[1]('second.txt'); await flush(); await scheduler.advance(1000);
    click(button); assert.equal(scheduler.timers.size, 0); pending[2]('third.txt'); await flush();
    await scheduler.advance(2000); assert.equal(message.hidden, false); assert.match(message.textContent, /third.txt/);
    assert.equal(document.getElementById('tm-netflix-copylogs'), button); assert.equal(button.textContent, 'CopyLogs');
    control.dispose(); assert.equal(scheduler.timers.size, 0);
});

test('missing completion does not lock CopyLogs and stale success or failure cannot paint the newer export', async () => {
    const document = createDocument(), scheduler = createScheduler(), pending = [];
    const control = createLogControl({ document, ...scheduler, tLog: key => key,
        copyLogs: options => new Promise((resolve, reject) => pending.push({ resolve, reject, options })) });
    control.start(); const button = document.getElementById('tm-netflix-copylogs'), message = document.querySelector('[role="status"]');
    click(button); click(button); assert.equal(pending.length, 1); await flush(); assert.equal(button.disabled, false);
    click(button, true); await flush(); assert.equal(pending.length, 2); assert.equal(pending[1].options.detailed, true);
    pending[0].resolve('stale.txt'); await flush(); assert.equal(message.hidden, true); assert.equal(button.disabled, false);
    pending[1].resolve('latest.txt'); await flush(); assert.match(message.textContent, /latest.txt/);
    click(button); await flush(); click(button); await flush();
    pending[3].resolve('newest.txt'); await flush(); pending[2].reject(new Error('stale failure')); await flush();
    assert.match(message.textContent, /newest.txt/); await scheduler.advance(3000); assert.equal(message.hidden, true);
    control.dispose();
});
