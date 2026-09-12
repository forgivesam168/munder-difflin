'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const write = require('./research-write-receipt.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(__dirname, '..');
const binding = require('./research-lifecycle-binding.cjs');
const NATIVE_LAUNCH_ENABLED = false;
// Fixed mode policy only; describing a mode never grants launch authority.
function describeMode(inert) {
  assert.equal(typeof inert, 'boolean');
  return inert
    ? { kind: 'inert', scope: 'running-inert', success: 'INERT_PASS', helperArgs: ['-Inert', '-NodeExecutable', process.execPath] }
    : { kind: 'electron-lifecycle', scope: 'electron-lifecycle', success: 'PASS', helperArgs: [] };
}

// Test callbacks are trusted in-process code, available only for inert integration.
// This is fixed research orchestration, not an arbitrary command or security sandbox.
module.exports = async function supervise({ powershell, inert = false, test = {} }) {
  assert.equal(process.platform, 'win32');
  const mode = describeMode(inert);
  assert.ok(inert || NATIVE_LAUNCH_ENABLED, 'Running Electron parent disabled pending acceptance');
  assert.ok(inert || (Object.keys(test).length === 0 && test.persist === undefined && test.afterClose === undefined && test.onOwnedRoot === undefined && test.stopProbe === undefined), 'Electron mode excludes test callbacks');
  assert.ok(path.isAbsolute(powershell) && path.basename(powershell).toLowerCase() === 'pwsh.exe');
  assert.ok(fs.lstatSync(powershell).isFile() && !fs.lstatSync(powershell).isSymbolicLink());
  const binarySha256 = { node: hash(fs.readFileSync(process.execPath)), powershell: hash(fs.readFileSync(powershell)) };
  const { run, env } = require('./research-lifecycle-environment.cjs')(root);
  const invocation = require('./research-lifecycle-invocation.cjs')(root, run);
  binarySha256.electron = hash(fs.readFileSync(invocation.executable));
  require('./research-lifecycle-result.cjs').prepare(run);
  const request = binding.create(root, run, mode.kind, env);
  const sourceSha256 = request.sourceSha256;
  const resultFile = path.join(run, 'lifecycle-result.json');
  if (test.stopProbe !== undefined) {
    assert.equal(test.stopProbe, true); assert.equal(typeof test.onOwnedRoot, 'function');
    fs.writeFileSync(path.join(run, 'stop-probe'), 'finite-root-stop', { flag: 'wx' });
  }
  const receiptFile = path.join(run, 'supervisor-receipt.json');
  const receipt = { version: 1, run, sourceSha256, binarySha256, requestSha256: binding.digest(request), scope: mode.scope,
    phase: 'prepared', result: 'INCOMPLETE', cleanup: 'UNVERIFIED', persistenceFailed: false,
    stopProbe: test.stopProbe === true };
  const persist = () => (test.persist || write)(receiptFile, JSON.parse(JSON.stringify(receipt)));
  persist(); // Failure here prevents all process creation.
  return require('./windows-lifecycle-transport.cjs')({ powershell, run, env, receipt, persist, mode, test, spawn, setTimeout, clearTimeout,
    helperArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'tools/research-lifecycle-supervisor.ps1'), ...mode.helperArgs, ...(test.stopProbe ? ['-StopProbe'] : [])],
    accept: () => {
        if (test.afterClose) test.afterClose(run);
        const bytes = fs.readFileSync(resultFile);
        const result = JSON.parse(bytes);
        require('./research-lifecycle-result.cjs').validateBound(result, request);
        binding.verify(root, request);
        assert.equal(hash(fs.readFileSync(process.execPath)), binarySha256.node);
        assert.equal(hash(fs.readFileSync(powershell)), binarySha256.powershell);
        assert.equal(hash(fs.readFileSync(invocation.executable)), binarySha256.electron);
        receipt.resultSha256 = hash(bytes); receipt.sourcesUnchanged = true;
    }
  });
};

module.exports.describeMode = describeMode;
