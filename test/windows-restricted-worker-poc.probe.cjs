'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repository = path.resolve(__dirname, '..');
const quote = value => `'${value.replaceAll("'", "''")}'`;

function token(t, user) {
  assert.equal(t.userSid, user);
  assert.equal(t.integritySid, 'S-1-16-4096');
  assert.equal(t.tokenType, 1);
  assert.equal(t.mandatoryPolicy & 1, 1);
  // DISABLE_MAX_PRIVILEGE retains only SeChangeNotifyPrivilege (well-known LUID 23).
  assert.ok(t.privileges.every(p => p.luid === '23'));
  assert.ok(t.groups.length > 0);
  assert.equal(t.isRestricted, true);
  // Universal restricting SID is not identity isolation. Low MIC and privilege
  // stripping reduce authority; equal root DACLs leave MIC as the discriminator.
  assert.deepEqual(t.restrictedSids.map(entry => entry.sid), ['S-1-1-0']);
}

function security(sddl, user, level) {
  assert.ok(sddl.includes(`(A;OICI;FA;;;${user})`), sddl);
  assert.ok(sddl.includes('(A;OICI;FA;;;WD)'), sddl);
  assert.match(sddl, /D:P/);
  assert.ok(sddl.includes(`(ML;OICI;NW;;;${level})`), sddl);
}

test('provider-free restricted token, MIC, raw pipes and creation-time Job proof', {
  skip: process.platform !== 'win32' ? 'Windows token/MIC/Job APIs required' : false,
  timeout: 120000,
}, () => {
  const temporary = path.join(repository, '.tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const run = fs.mkdtempSync(path.join(temporary, 'windows-restricted-worker-poc-'));
  const executable = path.join(run, 'RestrictedWorkerPoc.exe');
  const root = path.join(run, 'state');
  const source = path.join(repository, 'src/main/windowsRestrictedWorkerPoc.cs');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const environment = {
    SystemRoot: process.env.SystemRoot,
    TEMP: run, TMP: run,
    POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
  };
  // Windows PowerShell's already-installed .NET Framework compiler emits a directly
  // runnable executable, not a pwsh-hosted assembly or an unowned shell worker.
  const script = `$ErrorActionPreference='Stop'; Add-Type -Path ${quote(source)} -ReferencedAssemblies 'System.Web.Extensions.dll' -OutputAssembly ${quote(executable)} -OutputType ConsoleApplication -ErrorAction Stop`;
  const compile = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    cwd: repository, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  fs.writeFileSync(path.join(run, 'compile.json'), JSON.stringify({ status: compile.status, signal: compile.signal, error: compile.error?.message, stdout: compile.stdout, stderr: compile.stderr }, null, 2));
  if (compile.error || compile.status !== 0) {
    fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify({
      authority: 'PROVIDER_FREE_TEST_ONLY', network: 'NOT_AUTHORIZED', credentials: 'NONE', OMP: 'NOT_RUN', CLIProxyAPI: 'NOT_RUN',
      classification: compile.error?.code === 'ENOENT' ? 'NATIVE_POC_TOOLCHAIN_UNAVAILABLE' : 'NATIVE_POC_COMPILATION_FAILED',
      error: { code: compile.error?.code, message: compile.error?.message, status: compile.status, stderr: compile.stderr },
    }, null, 2));
  }
  assert.equal(compile.error, undefined, `Compiler error; retained evidence: ${run}`);
  assert.equal(compile.status, 0, `Compilation failed; retained evidence: ${run}\n${compile.stderr}`);
  const result = spawnSync(executable, [root], {
    cwd: run, env: environment, encoding: 'utf8', timeout: 45000, maxBuffer: 65536, windowsHide: true,
  });
  // Persist before any assertion, including a blocked host's negative receipt.
  fs.writeFileSync(path.join(run, 'execution.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(result.error, undefined, `Execution failed; retained evidence: ${run}`);
  const receipt = JSON.parse(result.stdout.trim());
  fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify(receipt, null, 2));
  assert.equal(receipt.authority, 'PROVIDER_FREE_TEST_ONLY');
  assert.equal(receipt.network, 'NOT_AUTHORIZED');
  assert.equal(receipt.credentials, 'NONE');
  assert.equal(receipt.OMP, 'NOT_RUN');
  assert.equal(receipt.CLIProxyAPI, 'NOT_RUN');
  assert.equal(result.status, 0, `Negative host result is not PASS: ${JSON.stringify(receipt)}; retained: ${run}`);
  assert.equal(receipt.classification, 'PROOF_RECORDED');
  const user = receipt.parentToken.userSid;
  assert.equal(receipt.parentToken.integritySid, 'S-1-16-8192');
  assert.equal(receipt.parentToken.tokenType, 1);
  token(receipt.restrictedToken, user);
  security(receipt.ledgerSecurity, user, 'ME');
  security(receipt.workerSecurity, user, 'LW');
  security(receipt.runSecurity, user, 'ME');
  security(receipt.helperSecurity, user, 'ME');
  assert.equal(receipt.ledgerSecurity.split('S:')[0], receipt.workerSecurity.split('S:')[0]);
  assert.equal(receipt.ledgerSecurity.replace(';;;ME)', ';;;LW)'), receipt.workerSecurity);
  assert.match(receipt.ledgerFileSecurity, /\(ML;[^;]*;NW;;;ME\)/);
  for (const [mode, exitCode] of [['normal', 0], ['timeout', 124]]) {
    const lifecycle = receipt[mode];
    assert.equal(lifecycle.ioMode, 'RAW_PIPE');
    assert.equal(lifecycle.creationTimeJob, true);
    assert.equal(lifecycle.jobMember, true);
    assert.equal(lifecycle.inputClosed, true);
    assert.equal(lifecycle.pipeDrained, true);
    assert.equal(lifecycle.activeProcessesFinal, 0);
    assert.equal(lifecycle.exitCode, exitCode);
    assert.equal(lifecycle.terminatedJob, mode === 'timeout');
    assert.equal(lifecycle.executable.toLowerCase(), executable.toLowerCase());
    assert.equal(lifecycle.cwd.toLowerCase(), path.join(root, 'worker').toLowerCase());
    assert.deepEqual(lifecycle.environment, {
      SystemRoot: process.env.SystemRoot,
      TEMP: path.join(root, 'worker'), TMP: path.join(root, 'worker'),
    });
    token(lifecycle.worker.token, user);
    assert.equal(lifecycle.worker.stdinEof, true);
  }
  const worker = receipt.normal.worker;
  assert.equal(worker.cwd.toLowerCase(), path.join(root, 'worker').toLowerCase());
  assert.equal(worker.executable.toLowerCase(), executable.toLowerCase());
  assert.equal(worker.stdinBytes, 7);
  assert.equal(worker.stdinSha256, crypto.createHash('sha256').update(Buffer.from([0, 255, 13, 10, 65, 0, 66])).digest('hex'));
  assert.deepEqual(worker.operations.map(o => o.operation), ['worker.create', 'worker.append', 'worker.rename', 'worker.delete', 'worker.mkdir', 'worker.rmdir', 'ledger.overwrite', 'ledger.append', 'ledger.truncate', 'ledger.create', 'ledger.rename', 'ledger.delete', 'ledger.mkdir']);
  for (const op of worker.operations) {
    const allowed = op.operation.startsWith('worker.');
    assert.equal(op.success, allowed, JSON.stringify(op));
    assert.equal(op.win32Error, allowed ? 0 : 5, JSON.stringify(op));
  }
  assert.equal(worker.integrityRaise.success, false);
  assert.notEqual(worker.integrityRaise.win32Error, 0);
  token(worker.integrityRaise.finalToken, user);
  assert.equal(receipt.timeout.worker.ready, true);
  assert.equal(receipt.ledgerUnchanged, true);
  assert.equal(receipt.ledgerHashBefore, receipt.ledgerHashAfter);
  assert.deepEqual(receipt.ledgerEntries, ['attempt.receipt']);
  assert.equal(receipt.mainUpdate, true);
  assert.equal(receipt.mainDelete, true);
  assert.equal(receipt.cleanup, 'REMOVED_TEST_ROOT');
  assert.equal(fs.existsSync(root), false);
  // Keep receipts (including failures) under the authorized test-owned run directory.
});
