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
  const save = () => {
    try { persist(); } catch { receipt.persistenceFailed = true; receipt.result = 'FAIL'; }
  };
  return new Promise(resolve => {
    let child, ended = false, buffer = '', bytes = 0, ready = false, complete = null, ownedRoot = false;
    let failed = false, killed = false, fallback, bootstrap, outer;
    const fail = reason => { failed = true; receipt.failure = receipt.failure || reason; receipt.result = 'FAIL'; };
    const finish = (code, signal, abandoned = false) => {
      if (ended) return;
      ended = true;
      clearTimeout(bootstrap); clearTimeout(outer); clearTimeout(fallback);
      receipt.helperExit = code; receipt.helperSignal = signal;
      try {
        assert.ok(!abandoned && ready && !buffer.trim() && complete && code === 0 && signal === null);
        assert.equal(complete.run, run);
        const n = complete.native;
        assert.equal(n.Member, true); assert.equal(n.ActiveProcesses, 0);
        // Cleanup is independent of assertion/workload success, including storage faults.
        receipt.cleanup = 'VERIFIED_EMPTY'; receipt.native = n;
        assert.equal(n.ChildExit, 0);
        for (const key of ['TimedOut', 'RootFailed', 'RootTimedOut', 'TerminationSucceeded', 'ReceiptWriteFailed', 'SuspendedBeforeClose']) assert.equal(n[key], false);
        assert.equal(n.QueryErrorCode, null); assert.equal(n.TerminationErrorCode, null);
        if (test.afterClose) test.afterClose(run);
        const bytes = fs.readFileSync(resultFile);
        const result = JSON.parse(bytes);
        require('./research-lifecycle-result.cjs').validateBound(result, request);
        binding.verify(root, request);
        assert.equal(hash(fs.readFileSync(process.execPath)), binarySha256.node);
        assert.equal(hash(fs.readFileSync(powershell)), binarySha256.powershell);
        assert.equal(hash(fs.readFileSync(invocation.executable)), binarySha256.electron);
        receipt.resultSha256 = hash(bytes); receipt.sourcesUnchanged = true;
        receipt.result = !failed && !receipt.persistenceFailed ? mode.success : 'FAIL';
      } catch { fail('acceptance'); }
      receipt.phase = 'closed'; save();
      resolve({ run, exitCode: receipt.result === mode.success && !receipt.persistenceFailed ? 0 : 1, receipt });
    };
    const stop = reason => {
      fail(reason); save();
      if (killed || ended) return;
      killed = true;
      // Only this retained helper object, never PID discovery or taskkill.
      try { child.kill(); } catch { fail('helper-stop'); }
      fallback = setTimeout(() => {
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, null, true);
      }, 5000);
    };
    try {
      child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        path.join(root, 'tools/research-lifecycle-supervisor.ps1'), ...mode.helperArgs, ...(test.stopProbe ? ['-StopProbe'] : [])],
      { cwd: run, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { fail('spawn'); finish(null, null); return; }
    bootstrap = setTimeout(() => stop('bootstrap-timeout'), 30000);
    outer = setTimeout(() => stop('outer-timeout'), 85000);
    child.on('error', () => { fail('helper-error'); });
    child.stdin.on('error', () => stop('input-error'));
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) stop('output-limit'); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) { stop('output-limit'); return; }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (!ready && message.phase === 'ready') {
            assert.deepEqual(message, { phase: 'ready' });
            ready = true; clearTimeout(bootstrap); receipt.phase = 'supervising'; save();
          } else if (ready && !complete && message.phase === 'owned-root') {
            assert.ok(test.stopProbe && !ownedRoot);
            assert.deepEqual(Object.keys(message).sort(), ['created', 'phase', 'pid']);
            assert.ok(Number.isSafeInteger(message.pid) && message.pid > 0);
            assert.match(message.created, /^\d+$/);
            ownedRoot = true;
            Promise.resolve().then(() => test.onOwnedRoot({ run, ...message }, () => stop('test-helper-stop')))
              .catch(() => stop('test-observer-failure'));
          } else if (ready && !complete && message.phase === 'failed') {
            assert.equal(message.cleanup, 'UNVERIFIED');
            assert.ok(message.nativeErrorCode === null || Number.isInteger(message.nativeErrorCode));
            receipt.nativeErrorCode = message.nativeErrorCode;
            fail('native-helper'); complete = message;
          } else {
            assert.ok(ready && !complete && message.phase === 'complete'); complete = message;
          }
        } catch { stop('protocol'); }
      }
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.end(JSON.stringify(env));
  });
};

module.exports.describeMode = describeMode;
