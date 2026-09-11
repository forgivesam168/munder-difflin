'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const verify = require('../tools/research-lifecycle-ipc.cjs');
for (const failure of ['none', 'control', 'read']) {
  test(`fixed preload and wrapper protocol; failure=${failure}`, async () => {
    const { run } = require('../tools/research-env.cjs')(root, 'ipc-contract');
    const expectedUrl = 'file:///synthetic/index.html';
    const frame = { url: expectedUrl };
    const handlers = new Map();
    const context = { window: {} };
    const wc = { mainFrame: frame, isDestroyed: () => false,
      executeJavaScript: text => (failure === 'control' || (failure === 'read' && text.includes('readControl'))) ? Promise.resolve('wrong') : vm.runInNewContext(text, context) };
    const win = { webContents: wc, isDestroyed: () => false };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'tools/research-lifecycle-preload.cjs'), 'utf8'), {
      require: name => {
        assert.equal(name, 'electron');
        return { contextBridge: { exposeInMainWorld: (name, value) => { context.window[name] = value; } },
          ipcRenderer: { invoke: (channel, ...args) => handlers.get(channel)({ sender: wc, senderFrame: frame }, ...args) } };
      }
    });
    assert.deepEqual(Object.keys(context.window.researchResult), ['control', 'revoked', 'readControl', 'readRevoked']);
    const operation = verify({ root, run, win, expectedUrl, sessions: new WeakMap(),
      ipcMain: { handle: (name, fn) => { assert.equal(handlers.size, 0); handlers.set(name, fn); },
        removeHandler: name => handlers.delete(name) } });
    if (failure !== 'none') await assert.rejects(operation);
    else await operation;
    assert.equal(handlers.size, 0);
  });
}
