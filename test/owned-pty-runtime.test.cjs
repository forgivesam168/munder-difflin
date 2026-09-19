'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const { createCodexWorkerContract } = loadTs('src/main/codexWorkerContract.ts');
const { prepareBoundedWorker } = loadTs('src/main/boundedWorker.ts');
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
  test(`production PtyManager provider-free lifecycle: ${mode}`, { timeout: 60000 }, async () => {
    assert.equal(process.platform, 'win32', 'native evidence requires Windows; do not report a skipped proof as PASS');
    const { run, permit, prepared } = prepare(mode === 'stop' ? 'timeout' : mode);
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
