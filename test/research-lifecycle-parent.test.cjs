'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

function harness() {
  const file = path.resolve(__dirname, '../tools/research-lifecycle-parent.cjs');
  const localRequire = createRequire(file);
  const timers = new Map();
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kills: 0, unrefs: 0, kill() { this.kills++; }, unref() { this.unrefs++; } });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, __dirname: path.dirname(file), process,
    Buffer, require: name => name === 'node:child_process' ? { spawn: () => child } : localRequire(name),
    setTimeout(callback, ms) { const key = {}; timers.set(key, { callback, ms }); return key; },
    clearTimeout(key) { timers.delete(key); } }, { filename: file });
  return { child, timers, start: powershell => module.exports({ powershell, inert: true }) };
}

// Parent entry validation requires an actual PowerShell binary; tests perform only
// static reads, never start it. The manual integration driver supplies its identity.
const powershell = 'C:/Program Files/PowerShell/7/pwsh.exe';
const options = { skip: process.platform !== 'win32' || !fs.existsSync(powershell) };

for (const [name, milliseconds, ready] of [['bootstrap', 30000, false], ['outer', 85000, true]]) {
  test(`${name} expiry stops only retained helper and bounds missing close`, options, async () => {
    const h = harness();
    const pending = h.start(powershell);
    if (ready) h.child.stdout.write('{"phase":"ready"}\n');
    const timer = [...h.timers.values()].find(t => t.ms === milliseconds);
    assert.ok(timer); timer.callback();
    assert.equal(h.child.kills, 1);
    const fallback = [...h.timers.values()].find(t => t.ms === 5000);
    assert.ok(fallback); fallback.callback();
    const result = await pending;
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.cleanup, 'UNVERIFIED');
    assert.equal(result.receipt.failure, `${name}-timeout`);
    assert.equal(h.child.unrefs, 1);
    assert.equal(h.timers.size, 0);
  });
}

test('malformed helper protocol cannot become success on clean helper exit', options, async () => {
  const h = harness(); const pending = h.start(powershell);
  h.child.stdout.write('invalid-json\n');
  h.child.emit('close', 0, null);
  const result = await pending;
  assert.equal(h.child.kills, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.failure, 'protocol');
  assert.equal(result.receipt.cleanup, 'UNVERIFIED');
  assert.equal(h.timers.size, 0);
});

test('native failure preserves numeric code and never infers job empty', options, async () => {
  const h = harness(); const pending = h.start(powershell);
  h.child.stdout.write('{"phase":"ready"}\n');
  h.child.stdout.write('{"phase":"failed","cleanup":"UNVERIFIED","nativeErrorCode":87}\n');
  h.child.emit('close', 1, null);
  const result = await pending;
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.nativeErrorCode, 87);
  assert.equal(result.receipt.failure, 'native-helper');
  assert.equal(result.receipt.cleanup, 'UNVERIFIED');
});


test('fixed mode descriptions do not enable Electron or accept truthy mode aliases', async () => {
  const supervise = require('../tools/research-lifecycle-parent.cjs');
  assert.deepEqual(supervise.describeMode(false), {
    kind: 'electron-lifecycle', scope: 'electron-lifecycle', success: 'PASS', helperArgs: []
  });
  assert.deepEqual(supervise.describeMode(true), {
    kind: 'inert', scope: 'running-inert', success: 'INERT_PASS',
    helperArgs: ['-Inert', '-NodeExecutable', process.execPath]
  });
  for (const value of ['true', 'false', 1, 0, null, undefined]) {
    assert.throws(() => supervise.describeMode(value));
  }
  if (process.platform === 'win32') {
    await assert.rejects(() => supervise({ powershell }), /disabled/);
    await assert.rejects(() => supervise({ powershell, inert: false, test: { persist() {} } }), /disabled/);
  }
});
