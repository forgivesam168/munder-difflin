'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const { createCodexWorkerContract } = loadTs('src/main/codexWorkerContract.ts');
const { prepareBoundedWorker, classifyBoundedWorkerRecovery } = loadTs('src/main/boundedWorker.ts');
const { PtyManager } = loadTs('src/main/pty.ts');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const repository = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'bounded-worker.cjs');
const powershell = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';

function prepare(mode) {
  const run = fs.mkdtempSync(path.join(repository, '.tmp', 'b-runtime-'));
  const root = path.join(run, 'worker');
  const host = path.join(run, 'host');
  fs.mkdirSync(root);
  fs.mkdirSync(host);
  const executable = { executablePath: process.execPath, executableSha256: hash(process.execPath), version: process.version };
  const identity = { candidateId: 'b-runtime-01', taskId: `runtime-${mode}`, runId: path.basename(run), workerId: `worker-${path.basename(run)}`, taskDigest: crypto.createHash('sha256').update(mode).digest('hex'), sourceCheckpoint: { repositoryId: 'forgivesam168/munder-difflin', commitSha: 'a3a3e7b4819abadefd16bede77aad5cf51adf568', treeSha: 'e4ad946d915f75dcb7b24f70a7b82719c7a8f981' } };
  const contract = createCodexWorkerContract({ ...identity, executable, syntheticRoot: root });
  for (const directory of contract.rootPolicy.allowedDirectories) fs.mkdirSync(directory);
  const requestPath = path.join(host, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify({ contract }), { flag: 'wx' });
  const helperData = path.join(run, 'helper');
  fs.mkdirSync(helperData);
  for (const name of ['home', 'temp', 'appdata', 'localappdata']) fs.mkdirSync(path.join(helperData, name));
  const scriptPath = path.join(repository, 'src', 'main', 'windowsOwnedPty.ps1');
  const nativeSourcePath = path.join(repository, 'src', 'main', 'windowsOwnedPty.cs');
  const helperEnv = { SystemRoot: process.env.SystemRoot, ComSpec: path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), PATH: path.join(process.env.SystemRoot, 'System32'), HOME: path.join(helperData, 'home'), USERPROFILE: path.join(helperData, 'home'), TEMP: path.join(helperData, 'temp'), TMP: path.join(helperData, 'temp'), APPDATA: path.join(helperData, 'appdata'), LOCALAPPDATA: path.join(helperData, 'localappdata'), POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off', PSModuleAnalysisCachePath: path.join(helperData, 'module-cache') };
  const permit = { permitId: `permit-${identity.runId}`, expiresAt: Date.now() + 120000, identity, fixture: { ...executable, scriptPath: fixture, scriptSha256: hash(fixture) }, requestPath, requestSha256: hash(requestPath), mode, argv: [fixture, requestPath, mode], syntheticRoot: root, hostReceiptDir: host, workerPath: contract.rootPolicy.workDir, humanApproved: true, limits: { maxResultBytes: 65536, maxArtifactBytes: 65536, maxArtifactTotalBytes: 262144, maxArtifactCount: 8 }, ownedBackend: { helperPath: powershell, helperSha256: hash(powershell), scriptPath, scriptSha256: hash(scriptPath), nativeSourcePath, nativeSourceSha256: hash(nativeSourcePath), helperEnv, cols: 100, rows: 30, timeoutMs: mode === 'timeout' ? 3000 : 12000, cleanupMs: 5000 } };
  return { run, permit, prepared: prepareBoundedWorker(permit) };
}

for (const mode of ['pass', 'missing', 'malformed', 'stale', 'fail', 'descendant', 'io', 'timeout', 'stop']) {
  test(`production PtyManager provider-free lifecycle: ${mode}`, { timeout: 60000 }, async t => {
    assert.equal(process.platform, 'win32', 'native evidence requires Windows; do not report a skipped proof as PASS');
    const { run, permit, prepared } = prepare(mode === 'stop' ? 'timeout' : mode);
    const spawn = t.mock.method(require('node:child_process'), 'spawn');
    const launch = t.mock.method(loadTs('src/main/windowsOwnedPty.ts'), 'launchOwnedPty');
    const manager = new PtyManager();
    const messages = [];
    let output = '';
    let acted = false;
    const owner = { isDestroyed: () => false, send(channel, value) {
      messages.push({ channel, value });
      if (channel.startsWith('pty:data:')) {
        output += value;
        if (!acted && output.includes('WORKER_READY')) {
          acted = true;
          if (mode === 'io') { assert.equal(manager.resize(prepared.contract.workerId, 110, 35).ok, true); assert.equal(manager.write(prepared.contract.workerId, 'bounded-input\r').ok, true); }
          if (mode === 'stop') assert.equal(manager.kill(prepared.contract.workerId).ok, true);
        }
      }
    } };
    const result = manager.spawn({ id: prepared.contract.workerId, cwd: prepared.cwd, command: prepared.executablePath, boundedWorker: prepared }, owner);
    assert.equal(result.ok, true, result.error);
    const completion = manager.boundedCompletion(prepared.contract.workerId);
    assert.ok(completion);
    const receipt = await completion;
    const accepted = messages.find(message => message.channel.startsWith('pty:bounded-result:'))?.value;
    fs.writeFileSync(path.join(run, 'runtime-evidence.json'), JSON.stringify({ mode, receipt, accepted, output }, null, 2), { flag: 'wx' });
    assert.equal(receipt.rootJobMember, true);
    assert.equal(receipt.cleanupState, 'VERIFIED_EMPTY');
    assert.equal(receipt.activeProcessesFinal, 0);
    assert.equal(receipt.pseudoConsoleClosed, true);
    assert.equal(receipt.ioDrained, true);
    assert.equal(manager.list().length, 0);
    assert.ok(accepted);
    const expectedRecovery = {
      pass: ['TERMINAL', 'DURABLE_PASS'], descendant: ['TERMINAL', 'DURABLE_PASS'], io: ['TERMINAL', 'DURABLE_PASS'],
      fail: ['TERMINAL', 'DURABLE_FAIL'], stop: ['TERMINAL', 'STOP_REQUESTED'],
      missing: ['FRESH_ATTEMPT_ELIGIBLE', 'RESULT_MISSING'], malformed: ['FRESH_ATTEMPT_ELIGIBLE', 'RESULT_INVALID'],
      stale: ['FRESH_ATTEMPT_ELIGIBLE', 'RESULT_INVALID'], timeout: ['FRESH_ATTEMPT_ELIGIBLE', 'TIMEOUT']
    }[mode];
    assert.deepEqual([accepted.recovery.disposition, accepted.recovery.reason], expectedRecovery);
    assert.equal(accepted.recovery.automaticAttempts, 0);
    assert.equal(accepted.recovery.freshAttemptEligible, expectedRecovery[0] === 'FRESH_ATTEMPT_ELIGIBLE');
    assert.equal(accepted.recovery.providerNetwork, 'NOT_AUTHORIZED');
    assert.deepEqual(accepted.recovery.freshAttemptRequirements, {
      authority: 'MAIN_ONLY', distinct: ['PreparedBoundedWorker', 'runId', 'workerId', 'permitId', 'syntheticRoot', 'resultSlot', 'hostReceiptBinding'],
      contract: 'SAME_APPROVED_SOURCE_AND_TASK_UNLESS_MAIN_CREATES_NEW_TASK_CONTRACT',
      admission: 'ALL_CHECKS_REQUIRED', evidence: 'PRESERVE_WITHOUT_DELETE_OR_OVERWRITE'
    });
    assert.deepEqual(messages.find(message => message.channel.startsWith('pty:exit:')).value.recovery, accepted.recovery);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(launch.mock.callCount(), 1, 'recovery must not launch a second owned worker');
    assert.equal(spawn.mock.callCount(), 1, 'recovery must not spawn another helper');
    assert.equal(messages.filter(message => message.channel.startsWith('pty:bounded-result:')).length, 1);
    assert.equal(manager.list().length, 0);
    const replay = manager.spawn({ id: prepared.contract.workerId, cwd: prepared.cwd, command: prepared.executablePath, boundedWorker: prepared }, owner);
    assert.equal(replay.ok, false, 'a fresh-attempt classification must not make the consumed preparation reusable');
    assert.equal(launch.mock.callCount(), 1);
    assert.equal(spawn.mock.callCount(), 1);
    if (['pass', 'descendant', 'io', 'fail'].includes(mode)) {
      assert.equal(accepted.acceptance.outcome, 'ACCEPTED');
      assert.equal(accepted.acceptance.terminal.state, mode === 'fail' ? 'FAIL' : 'PASS');
      // Same-object duplicate: the accepted in-memory preparation never re-consumes acceptance.
      assert.equal(prepared.accept(receipt).outcome, 'DUPLICATE');
      // Durable duplicate: acceptance also published a host receipt for this binding, so a FRESH
      // preparation from the same permit must fail closed on that durable artifact. This is a
      // different path from the in-memory DUPLICATE above.
      const durableReceipt = path.join(permit.hostReceiptDir, `bounded-worker-${prepared.bindingDigest}.json`);
      assert.equal(accepted.acceptance.receiptPath, durableReceipt);
      assert.equal(fs.existsSync(durableReceipt), true, 'an accepted scenario must leave its durable host receipt');
      assert.throws(
        () => prepareBoundedWorker(permit),
        { message: 'Bounded worker host receipt directory already holds an acceptance receipt' }
      );
    } else {
      assert.notEqual(accepted.acceptance.outcome, 'ACCEPTED');
    }
    if (mode === 'io') assert.match(output, /ECHO:bounded-input/);
    if (mode === 'descendant') assert.match(output, /LEAF_READY/);
    if (mode === 'timeout') assert.equal(receipt.reason, 'timeout');
    if (mode === 'stop') assert.equal(receipt.reason, 'stop');
  });
}

test('recovery classification preserves terminal and reconciliation boundaries without launching', t => {
  const spawn = t.mock.method(require('node:child_process'), 'spawn', () => { throw new Error('classification attempted a process launch'); });
  const native = { rootPid: 123, rootExit: 0, rootJobMember: true, activeProcessesFinal: 0, cleanupState: 'VERIFIED_EMPTY', ioDrained: true, pseudoConsoleClosed: true, reason: 'exit' };
  const missing = { outcome: 'MISSING', reason: 'durable task result is absent', bindingDigest: 'binding' };
  // Pure decision inputs: no fabricated receipt is submitted to the durable consumer.
  const accepted = (result, state) => ({ outcome: 'ACCEPTED', result: { result }, terminal: { state, reason: 'boundary' } });
  const cases = [
    [native, { outcome: 'DUPLICATE' }, 'RECONCILIATION_REQUIRED', 'DUPLICATE_OR_CONFLICT'],
    [native, { state: 'UNKNOWN', error: 'publication failed' }, 'RECONCILIATION_REQUIRED', 'PUBLICATION_OR_ACCEPTANCE_FAILURE'],
    [{ ...native, rootExit: 1 }, accepted('PASS', 'UNKNOWN'), 'RECONCILIATION_REQUIRED', 'PASS_EXIT_CONFLICT'],
    [{ ...native, rootExit: null }, accepted('PASS', 'UNKNOWN'), 'RECONCILIATION_REQUIRED', 'PASS_EXIT_CONFLICT'],
    [{ ...native, reason: 'timeout' }, accepted('FAIL', 'UNKNOWN'), 'TERMINAL', 'DURABLE_FAIL'],
    [{ ...native, reason: 'stop' }, { state: 'UNKNOWN', error: 'publication failed' }, 'TERMINAL', 'STOP_REQUESTED'],
    [{ ...native, reason: 'helper-failure' }, missing, 'FRESH_ATTEMPT_ELIGIBLE', 'HELPER_FAILURE'],
    [{ ...native, reason: 'launch-failure', rootPid: null, rootJobMember: false }, missing, 'FRESH_ATTEMPT_ELIGIBLE', 'LAUNCH_FAILURE'],
    [{ ...native, reason: 'helper-failure', cleanupState: 'UNVERIFIED' }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, reason: 'launch-failure', activeProcessesFinal: null }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, reason: 'timeout', ioDrained: false }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, pseudoConsoleClosed: false }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, rootJobMember: false }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, error: 'native error' }, missing, 'RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED'],
    [{ ...native, reason: 'invalid' }, missing, 'RECONCILIATION_REQUIRED', 'NATIVE_RECEIPT_INVALID'],
    [native, accepted('UNKNOWN', 'UNKNOWN'), 'RECONCILIATION_REQUIRED', 'TERMINAL_UNKNOWN']
  ];
  for (const [receipt, acceptance, disposition, reason] of cases) {
    const before = JSON.stringify({ receipt, acceptance });
    const decision = classifyBoundedWorkerRecovery(receipt, acceptance);
    assert.deepEqual([decision.disposition, decision.reason], [disposition, reason]);
    assert.equal(decision.automaticAttempts, 0);
    assert.equal(decision.freshAttemptEligible, disposition === 'FRESH_ATTEMPT_ELIGIBLE');
    assert.equal(decision.providerNetwork, 'NOT_AUTHORIZED');
    assert.equal(JSON.stringify({ receipt, acceptance }), before, 'classification must preserve its evidence');
    assert.equal(Object.isFrozen(decision), true);
    assert.equal(Object.isFrozen(decision.freshAttemptRequirements), true);
    assert.equal(Object.isFrozen(decision.freshAttemptRequirements.distinct), true);
  }
  assert.equal(spawn.mock.callCount(), 0);
});

test('RAW_PIPE recovery requires stdin closure without inventing a pseudo console', () => {
  const receipt = { ioMode: 'RAW_PIPE', inputClosed: true, rootPid: 123, rootExit: 0,
    rootJobMember: true, activeProcessesFinal: 0, cleanupState: 'VERIFIED_EMPTY',
    ioDrained: true, pseudoConsoleClosed: false, reason: 'exit' };
  const missing = { outcome: 'MISSING', reason: 'absent', bindingDigest: 'binding' };
  assert.equal(classifyBoundedWorkerRecovery(receipt, missing).reason, 'RESULT_MISSING');
  assert.equal(classifyBoundedWorkerRecovery({ ...receipt, inputClosed: false }, missing).reason, 'CLEANUP_UNVERIFIED');
  assert.equal(classifyBoundedWorkerRecovery({ ...receipt, pseudoConsoleClosed: true }, missing).reason, 'NATIVE_RECEIPT_INVALID');
  assert.equal(classifyBoundedWorkerRecovery({ ...receipt, ioDrained: false }, missing).reason, 'CLEANUP_UNVERIFIED');
});

test('native RAW_PIPE preserves exact UTF-8 bytes and EOF without publishing a result', { timeout: 60000 }, async () => {
  assert.equal(process.platform, 'win32', 'native evidence requires Windows; do not report a skipped proof as PASS');
  const { run, permit, prepared } = prepare('missing');
  const bytes = Buffer.from('literal $(not-a-shell)\r\n中文\u0000EOF\n', 'utf8');
  const rawFixture = path.join(__dirname, 'fixtures', 'provider-raw-input.cjs');
  let output = '';
  let started = 0;
  let exitReceipt;
  const native = loadTs('src/main/windowsOwnedPty.ts').launchOwnedPty({
    ...prepared.launch, ioMode: 'RAW_PIPE', args: [rawFixture]
  }, { onData: data => { output += data; }, onStarted: pid => { started = pid; },
    onExit: receipt => { exitReceipt = receipt; } });
  let receipt;
  try {
    native.input(bytes);
    native.closeInput();
    receipt = await native.completion;
  } finally {
    if (!receipt) { native.stop(); await native.completion; }
  }
  assert.ok(started > 0);
  assert.deepEqual(exitReceipt, receipt);
  assert.equal(receipt.reason, 'exit', receipt.error);
  assert.equal(receipt.rootExit, 0);
  assert.equal(receipt.ioMode, 'RAW_PIPE');
  assert.equal(receipt.inputClosed, true);
  assert.equal(receipt.rootJobMember, true);
  assert.equal(receipt.activeProcessesFinal, 0);
  assert.equal(receipt.cleanupState, 'VERIFIED_EMPTY');
  assert.equal(receipt.ioDrained, true);
  assert.equal(receipt.pseudoConsoleClosed, false);
  const observation = JSON.parse(output.trim());
  assert.deepEqual(observation, { eof: true, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') });
  assert.equal(fs.existsSync(path.join(permit.hostReceiptDir, `bounded-worker-${prepared.bindingDigest}.json`)), false);
  assert.equal(fs.existsSync(prepared.contract.resultPolicy.resultPath), false);
  assert.equal(loadTs('src/main/codexWorkerContract.ts').classifyTerminal({
    durableResult: 'ABSENT', processExitCode: receipt.rootExit, cleanup: receipt.cleanupState
  }).state, 'UNKNOWN');
  fs.writeFileSync(path.join(run, 'raw-pipe-evidence.json'), JSON.stringify({
    receipt, observation, durableResult: 'ABSENT', taskOutcome: 'UNKNOWN', providerExecution: 'NOT_RUN'
  }, null, 2), { flag: 'wx' });
});
