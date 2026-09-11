'use strict';
// Manual Windows fault integration; does not start Electron or enumerate host PIDs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const identity = require('../tools/research-source-identity.cjs');
const binding = require('../tools/research-lifecycle-binding.cjs');
const write = require('../tools/research-write-receipt.cjs');
const root = path.resolve(__dirname, '..');
const powershell = process.argv[2];
assert.equal(process.argv.length, 3);
const { run: evidenceRun, env } = require('../tools/research-lifecycle-environment.cjs')(root);
const sourceSha256 = identity.snapshot(root, ['test/research-lifecycle-stop.integration.cjs',
  'test/research-lifecycle-stop-observer.ps1', 'tools/research-job-preflight.ps1',
  'tools/research-lifecycle-parent.cjs', 'tools/research-lifecycle-supervisor.ps1',
  'test/research-lifecycle-bound-inert.cjs']);
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const powershellSha256 = hashFile(powershell);
const evidence = { result: 'INCOMPLETE', sourceSha256, powershellSha256 };
const file = path.join(evidenceRun, 'stop-evidence.json');
write(file, evidence);

function observe(subject, requestSha256, stop) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(root, 'test/research-lifecycle-stop-observer.ps1'), '-RootPid', String(subject.pid),
      '-RootCreated', subject.created, '-SubjectRun', subject.run, '-RequestSha256', requestSha256],
    { cwd: evidenceRun, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', size = 0, captured = false, observed = false, failure = false;
    let fallback;
    const stopObserver = () => {
      failure = true;
      if (fallback) return;
      try { child.kill(); } catch { /* retain failure */ }
      fallback = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        reject(new Error('Observer close unverified'));
      }, 5000);
    };
    const deadline = setTimeout(stopObserver, 10000);
    child.on('error', () => { failure = true; });
    child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) { stopObserver(); } });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 65536) { stopObserver(); return; }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (!captured) {
            assert.deepEqual(message, { phase: 'captured', alive: true });
            captured = true; stop();
          } else {
            assert.ok(!observed);
            assert.deepEqual(message, { phase: 'observed', exitObserved: true, accounting: null });
            observed = true;
          }
        } catch { stopObserver(); }
      }
    });
    child.on('close', code => {
      clearTimeout(deadline); clearTimeout(fallback);
      if (code === 0 && captured && observed && !failure && !buffer.trim()) resolve({ captured, observed, accounting: null });
      else reject(new Error('Observer failed'));
    });
  });
}

(async () => {
  let observation;
  let callback;
  const outcome = await require('../tools/research-lifecycle-parent.cjs')({ powershell, inert: true,
    test: { stopProbe: true, onOwnedRoot(subject, stop) {
      callback = (async () => {
        const clock = performance.now();
        const readyFile = path.join(subject.run, 'stop-root-ready.json');
        while (!fs.existsSync(readyFile)) {
          assert.ok(performance.now() - clock < 5000, 'Ready deadline'); await delay(20);
        }
        const request = binding.read(root, subject.run, 'inert');
        const requestSha256 = binding.digest(request);
        assert.deepEqual(JSON.parse(fs.readFileSync(readyFile, 'utf8')), { pid: subject.pid, requestSha256 });
        observation = await observe(subject, requestSha256, stop);
        evidence.elapsedMs = Math.round(performance.now() - clock);
        evidence.naturalLifetimeMs = 20000;
        assert.ok(evidence.elapsedMs < 10000, 'Must precede20s natural expiry');
        assert.ok(!fs.existsSync(path.join(subject.run, 'stop-natural-exit')));
        evidence.subject = subject;
        evidence.observation = observation;
      })();
      return callback;
    } } });
  assert.ok(callback); await callback;
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.receipt.result, 'FAIL');
  assert.equal(outcome.receipt.failure, 'test-helper-stop');
  assert.equal(outcome.receipt.helperSignal, 'SIGTERM');
  assert.equal(binding.digest(binding.read(root, outcome.run, 'inert')), outcome.receipt.requestSha256);
  assert.equal(outcome.receipt.cleanup, 'UNVERIFIED');
  assert.ok(observation.captured && observation.observed);
  assert.ok(!fs.existsSync(path.join(outcome.run, 'lifecycle-result.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outcome.run, 'supervisor-receipt.json'), 'utf8')), outcome.receipt);
  identity.verify(root, sourceSha256);
  assert.equal(hashFile(powershell), powershellSha256);
  evidence.parentReceipt = outcome.receipt;
  evidence.result = 'PASS'; write(file, evidence);
  console.log(JSON.stringify({ evidenceRun, result: evidence.result, subjectRun: outcome.run,
    parent: outcome.receipt.result, cleanup: outcome.receipt.cleanup, observation }));
})().catch(() => { evidence.result = 'FAIL'; write(file, evidence); console.error(JSON.stringify({ evidenceRun, result: 'FAIL' })); process.exitCode = 1; });
