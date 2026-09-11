'use strict';
// Manual helper probe: default preflight only; --suspended creates an owned
// suspended Electron process and closes its Job without resuming it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const identity = require('./research-source-identity.cjs');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(process.platform, 'win32');
const executable = process.argv[2];
const valueFault = process.argv[3] === '--value-fault';
const schemaFault = process.argv[3] === '--schema-fault';
const runningInert = process.argv[3] === '--running-inert';
const suspended = process.argv[3] === '--suspended';
assert.ok((process.argv.length === 3 || (process.argv.length === 4 && (valueFault || schemaFault || suspended || runningInert))) && path.isAbsolute(executable) && path.basename(executable).toLowerCase() === 'pwsh.exe');
const root = path.resolve(__dirname, '..');
const sourceSha256 = identity.snapshot(root, [
  'tools/research-lifecycle-helper-test.cjs', 'test/research-lifecycle-helper.ps1',
  'tools/research-lifecycle-environment.cjs', 'tools/research-job-run.ps1',
  'tools/research-job-environment.cjs', 'tools/research-env.cjs',
  'tools/research-source-identity.cjs', 'tools/research-write-receipt.cjs',
  'tools/research-lifecycle-invocation.cjs', 'tools/research-lifecycle-run.cjs',
  'tools/research-job-preflight.ps1', 'test/research-lifecycle-inert.cjs'
]);
const { run, env } = require('./research-lifecycle-environment.cjs')(root);
const invocation = require('./research-lifecycle-invocation.cjs')(root, run);
const file = path.join(run, 'helper-evidence.json');
const write = require('./research-write-receipt.cjs');
const scope = runningInert ? 'running-inert' : suspended ? 'suspended-admission' : 'preflight-only';
const evidence = { result: 'INCOMPLETE', scope, sourceSha256,
  runningInert, nodeSha256: hash(fs.readFileSync(process.execPath)),
  suspended, electronSha256: hash(fs.readFileSync(invocation.executable)),
  valueFault, schemaFault, executableSha256: hash(fs.readFileSync(executable)), validationStage: 'helper' };
write(file, evidence);
const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
  path.join(root, 'test/research-lifecycle-helper.ps1'), ...(valueFault ? ['-ValueFault'] : []), ...(suspended ? ['-Suspended'] : []), ...(runningInert ? ['-RunningInert', '-NodeExecutable', process.execPath] : [])], {
  cwd: run, env, input: JSON.stringify(schemaFault ? { ...env, RESEARCH_UNEXPECTED: 'synthetic' } : env), windowsHide: true, encoding: 'utf8', timeout: runningInert ? 85_000 : 30_000, maxBuffer: 64 * 1024
});
try {
  assert.equal(result.status, 0); assert.ok(!result.error);
  const probe = JSON.parse(result.stdout);
  assert.equal(probe.result, 'PASS'); assert.equal(probe.scope, scope);
  assert.equal(probe.sentinelExcluded, true);
  assert.equal(probe.schemaChecks, 2);
  assert.deepEqual(probe.keys.map(k => k.toUpperCase()).sort(), Object.keys(env).map(k => k.toUpperCase()).sort());
  evidence.validationStage = 'projected-values';
  evidence.mismatchedKeys = Object.entries(env).filter(([key, value]) => probe.valueHashes[key.toUpperCase()] !== hash(value)).map(([key]) => key);
  assert.deepEqual(probe.valueHashes, Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), hash(value)])));
  evidence.validationStage = 'invocation';
  assert.deepEqual(probe.invocation, { Executable: invocation.executable, Arguments: invocation.args, WorkingDirectory: invocation.cwd });
  assert.equal(hash(fs.readFileSync(executable)), evidence.executableSha256);
  assert.equal(hash(fs.readFileSync(invocation.executable)), evidence.electronSha256);
  if (runningInert) {
    const child = JSON.parse(fs.readFileSync(path.join(run, 'inert-result.json'), 'utf8'));
    assert.deepEqual(child, { version: 1, run, result: 'INERT_PASS',
      args: ['--fixture', run], valueHashes: probe.valueHashes });
    assert.equal(probe.native.ChildExit, 0);
    assert.equal(probe.native.Member, true);
    assert.equal(probe.native.ActiveProcesses, 0);
    for (const key of ['TimedOut', 'RootFailed', 'RootTimedOut', 'TerminationSucceeded', 'SuspendedBeforeClose', 'ReceiptWriteFailed']) assert.equal(probe.native[key], false);
    assert.equal(probe.native.QueryErrorCode, null);
    assert.equal(probe.native.TerminationErrorCode, null);
    assert.equal(hash(fs.readFileSync(process.execPath)), evidence.nodeSha256);
    evidence.native = probe.native;
    evidence.workloadResult = 'INERT_PASS';
    evidence.cleanupResult = 'VERIFIED_EMPTY';
    evidence.budgets = { workloadMs: 40000, cleanupMs: 10000, outerMs: 85000 };
  }
  if (suspended) {
    for (const key of ['Member', 'SuspendedBeforeClose', 'LastJobHandleClosed', 'ExitObservedAfterClose']) assert.equal(probe.native[key], true);
    assert.equal(probe.native.ActiveProcesses, null);
    assert.equal(probe.native.TotalProcesses, null);
    evidence.native = probe.native;
    evidence.workloadResult = 'NOT_RUN_SUSPENDED';
    evidence.cleanupResult = 'PROCESS_EXIT_OBSERVED';
  }
  identity.verify(root, sourceSha256);
  evidence.result = 'PASS'; evidence.sentinelExcluded = true;
  evidence.projectedKeyCount = probe.keys.length; evidence.sourcesUnchanged = true;
  evidence.valuesVerified = true; evidence.invocationVerified = true;
  evidence.validationStage = 'complete';
} catch { evidence.result = 'FAIL'; }
evidence.exitCode = result.status;
write(file, evidence);
console.log(JSON.stringify({ run, ...evidence }));
process.exitCode = evidence.result === 'PASS' ? 0 : 1;
