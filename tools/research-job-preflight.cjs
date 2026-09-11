'use strict';

// Explicit manual probe; never auto-discovered as a test or called by Electron.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const writeReceipt = require('./research-write-receipt.cjs');
const sourceIdentity = require('./research-source-identity.cjs');
assert.equal(process.platform, 'win32');
const executable = process.argv[2]; // Already-resolved host executable, no PATH search.
const workloadTimeout = process.argv[3] === '--workload-timeout';
const explicitEnvironment = process.argv[3] === '--explicit-environment';
const deadline = process.argv[3] === '--deadline';
const rootFailure = process.argv[3] === '--root-failure';
const rootTimeout = process.argv[3] === '--root-timeout';
const closeJob = process.argv[3] === '--close-job';
const receiptFault = process.argv[3] === '--receipt-fault';
const terminationFault = process.argv[3] === '--termination-fault';
const runningQueryFault = process.argv[3] === '--running-query-fault' || terminationFault;
const queryFault = process.argv[3] === '--query-fault' || runningQueryFault;
const crashDescendant = process.argv[3] === '--crash-descendant';
const crash = process.argv[3] === '--crash' || crashDescendant;
const descendant = process.argv[3] === '--descendant' || deadline || rootFailure || workloadTimeout;
const admission = process.argv[3] === '--admission' || explicitEnvironment || descendant || closeJob || receiptFault || rootTimeout || queryFault;
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && (admission || crash)));
assert.ok(executable && path.isAbsolute(executable) && path.basename(executable).toLowerCase() === 'pwsh.exe');
const root = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'research-job-preflight.ps1');
const { run, env } = require('./research-env.cjs')(root, 'job-preflight');
env.POWERSHELL_TELEMETRY_OPTOUT = '1';
env.POWERSHELL_UPDATECHECK = 'Off';
env.PSModuleAnalysisCachePath = path.join(run, 'module-analysis-cache');
if (admission || crash) env.RESEARCH_NODE_EXECUTABLE = process.execPath;
const crashToken = crash ? randomUUID() : undefined;
const leafToken = (descendant || crashDescendant) ? randomUUID() : undefined;
if (crash) env.RESEARCH_CRASH_TOKEN = crashToken;
const fixture = path.join(__dirname, 'research-job-descendant.cjs');
if (descendant || crashDescendant) {
  env.RESEARCH_JOB_FIXTURE = fixture;
  env.RESEARCH_LEAF_TOKEN = leafToken;
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceSha256 = sourceIdentity.snapshot(root, [
  'tools/research-job-preflight.cjs', 'tools/research-job-preflight.ps1',
  'tools/research-job-run.ps1', 'tools/research-env.cjs',
  'tools/research-write-receipt.cjs', 'tools/research-source-identity.cjs',
  'tools/research-job-environment.cjs',
  ...((descendant || crashDescendant) ? ['tools/research-job-descendant.cjs'] : [])
]);
env.RESEARCH_JOB_GUARD_SHA256 = sourceSha256['tools/research-job-run.ps1'];
require('./research-job-environment.cjs').validateValues(env, { admission, descendant, crash, crashDescendant }, {
  run, root, node: process.execPath, systemRoot: process.env.SystemRoot,
  guardHash: sourceSha256['tools/research-job-run.ps1'], crashToken, leafToken
});
require('./research-job-environment.cjs').validateFiles(root, run);
const receipt = { explicitEnvironment, workloadTimeout, admission, descendant, deadline, rootFailure, rootTimeout, closeJob, receiptFault, queryFault, runningQueryFault, terminationFault, crash, crashDescendant,
  sourceSha256,
  fixtureSha256: (descendant || crashDescendant) ? hash(fixture) : null,
  nodeSha256: hash(process.execPath), executable, executableSha256: hash(executable), scriptSha256: hash(script),
  launcherSha256: hash(__filename), started: new Date().toISOString(), result: 'INCOMPLETE' };
const receiptPath = path.join(run, 'receipt.json');
writeReceipt(receiptPath, receipt);
const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script,
  ...(explicitEnvironment ? ['-ExplicitEnvironment'] : []), ...(admission ? ['-Admission'] : []), ...(descendant ? ['-Descendant'] : []),
  ...(workloadTimeout ? ['-WorkloadTimeout'] : []), ...(deadline ? ['-Deadline'] : []), ...(closeJob ? ['-CloseJob'] : []),
  ...(rootFailure ? ['-RootFailure'] : []),
  ...(rootTimeout ? ['-RootTimeout'] : []),
  ...(queryFault ? ['-QueryFault'] : []),
  ...(runningQueryFault ? ['-RunningQueryFault'] : []),
  ...(terminationFault ? ['-TerminationFault'] : []),
  ...(receiptFault ? ['-ReceiptFault'] : []), ...(crash ? ['-CrashObserver'] : []),
  ...(crashDescendant ? ['-CrashDescendant'] : [])], {
  cwd: run, env, input: explicitEnvironment ? JSON.stringify(env) : undefined, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 128 * 1024
});
fs.writeFileSync(path.join(run, 'stdout.log'), result.stdout || '');
fs.writeFileSync(path.join(run, 'stderr.log'), result.stderr || '');
receipt.exitCode = result.status;
receipt.signal = result.signal;
receipt.processError = Boolean(result.error);
try {
  receipt.probe = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.ok(!result.error);
  assert.equal(receipt.probe.result, 'PASS');
  if (crash) {
    assert.equal(receipt.probe.helperTerminated, true);
    assert.equal(receipt.probe.helperExit, -536805375);
    assert.equal(receipt.probe.processIdentityVerified, true);
    assert.equal(receipt.probe.processExitObserved, true);
    assert.equal(receipt.probe.observedKind, crashDescendant ? 'descendant' : 'root');
    assert.equal(receipt.probe.accounting, null);
    if (crashDescendant) assert.equal(fs.existsSync(path.join(run, 'leaf-complete.json')), false);
    receipt.workloadResult = crashDescendant ? 'HELPER_TERMINATED' : 'HELPER_TERMINATED_NOT_RUN';
    receipt.cleanupResult = 'PROCESS_EXIT_OBSERVED';
  } else {
  assert.equal(receipt.probe.assemblyLocation, '');
  assert.equal(receipt.probe.activeProcesses, 0);
  assert.equal(receipt.probe.admission, admission);
  assert.equal(receipt.probe.descendant, descendant);
  assert.equal(receipt.probe.deadline, deadline);
  assert.equal(receipt.probe.closeJob, closeJob);
  assert.equal(receipt.probe.receiptFault, receiptFault);
  if (closeJob || receiptFault || queryFault) {
    const evidence = receipt.probe.admissionEvidence;
    assert.equal(evidence.Member, true);
    assert.equal(evidence.SuspendedBeforeClose, !runningQueryFault);
    assert.equal(evidence.RunningBeforeQueryFault, runningQueryFault && !terminationFault);
    assert.equal(evidence.RunningBeforeTerminationFault, terminationFault);
    assert.equal(evidence.TerminationErrorCode, terminationFault ? 6 : null);
    assert.equal(evidence.TerminationSucceeded, false);
    assert.equal(evidence.LastJobHandleClosed, true);
    assert.equal(evidence.ExitObservedAfterClose, true);
    assert.equal(evidence.ActiveProcesses, null);
    assert.equal(evidence.TotalProcesses, null);
    assert.ok(Number.isInteger(evidence.ChildExit));
    assert.equal(evidence.ReceiptWriteFailed, receiptFault);
    assert.equal(evidence.QueryErrorCode, queryFault && !terminationFault ? 87 : null);
    receipt.workloadResult = terminationFault ? 'TERMINATION_FAILED' : runningQueryFault ? 'QUERY_FAILED' : queryFault ? 'QUERY_FAILED_NOT_RUN' : receiptFault ? 'RECEIPT_WRITE_FAILED_NOT_RUN' : 'NOT_RUN_SUSPENDED';
    receipt.cleanupResult = 'PROCESS_EXIT_OBSERVED';
  } else if (admission) {
    assert.equal(receipt.probe.admissionEvidence.ChildExit, rootTimeout ? 124 : rootFailure ? 17 : 0);
    assert.equal(receipt.probe.admissionEvidence.RootTimedOut, rootTimeout);
    assert.equal(receipt.probe.admissionEvidence.RootFailed, rootFailure);
    assert.equal(receipt.probe.admissionEvidence.Member, true);
    assert.ok(Number.isInteger(receipt.probe.admissionEvidence.TotalProcesses)
      && receipt.probe.admissionEvidence.TotalProcesses >= 1);
    assert.equal(receipt.probe.admissionEvidence.ActiveProcesses, 0);
    if (descendant) assert.ok(Number.isInteger(receipt.probe.admissionEvidence.ActiveAfterRootExit)
      && receipt.probe.admissionEvidence.ActiveAfterRootExit > 0);
    assert.equal(receipt.probe.admissionEvidence.TimedOut, deadline || workloadTimeout || rootTimeout);
    assert.equal(receipt.probe.admissionEvidence.TerminationSucceeded, deadline || workloadTimeout || rootFailure || rootTimeout);
    if (deadline || workloadTimeout || rootFailure || rootTimeout) {
      assert.ok(Number.isInteger(receipt.probe.admissionEvidence.ActiveBeforeTermination)
        && receipt.probe.admissionEvidence.ActiveBeforeTermination > 0);
      assert.equal(fs.existsSync(path.join(run, 'leaf-complete.json')), false);
      receipt.workloadResult = rootFailure ? 'ROOT_FAILED' : 'TIMED_OUT';
      receipt.cleanupResult = 'VERIFIED_EMPTY';
    } else if (descendant) {
      const completion = JSON.parse(fs.readFileSync(path.join(run, 'leaf-complete.json'), 'utf8'));
      assert.equal(completion.result, 'PASS');
      assert.equal(completion.token, env.RESEARCH_LEAF_TOKEN);
      receipt.leafCompletionVerified = true;
    }
  }
  }
  if (explicitEnvironment) {
    const observed = JSON.parse(fs.readFileSync(path.join(run, 'child-environment.json'), 'utf8'));
    assert.deepEqual(observed, Object.fromEntries(Object.entries(env).map(([key, value]) =>
      [key.toUpperCase(), createHash('sha256').update(value).digest('hex')])));
    receipt.childValuesVerified = true;
  }
  sourceIdentity.verify(root, sourceSha256);
  receipt.sourcesUnchanged = true;
  receipt.result = 'PASS';
} catch { receipt.result = 'FAIL'; }
receipt.finished = new Date().toISOString();
writeReceipt(receiptPath, receipt);
console.log(JSON.stringify({ run, ...receipt }));
process.exitCode = receipt.result === 'PASS' ? 0 : 1;
