'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repository = path.resolve(__dirname, '..');
const quote = value => `'${value.replaceAll("'", "''")}'`;

function token(t, user, variant = 'B') {
  assert.equal(t.userSid, user);
  assert.equal(t.integritySid, 'S-1-16-4096');
  assert.equal(t.tokenType, 1);
  assert.equal(t.mandatoryPolicy & 1, 1);
  // DISABLE_MAX_PRIVILEGE retains only SeChangeNotifyPrivilege (well-known LUID 23).
  assert.ok(t.privileges.every(p => p.luid === '23'));
  assert.ok(t.groups.length > 0);
  assert.equal(typeof t.isRestricted, 'boolean');
  if (variant === 'A') assert.equal(t.isRestricted, true);
  // B's IsTokenRestricted is observed, not a substitute for MIC/privilege checks.
  assert.deepEqual(t.restrictedSids.map(entry => entry.sid), variant === 'A' ? ['S-1-1-0'] : []);
}

function security(sddl, user, level, kind = 'directory') {
  // OICI is directory container/object inheritance. An explicit ACE on a file
  // carries an empty inheritance-flags field, so the file form asserts the same
  // principals, FA rights, protected DACL and mandatory label without OICI:
  // directory `(A;OICI;FA;;;<user>)`, file `(A;;FA;;;<user>)`.
  const dacl = kind === 'directory' ? 'A;OICI' : 'A;';
  const label = kind === 'directory' ? 'ML;OICI' : 'ML;';
  assert.ok(sddl.includes(`(${dacl};FA;;;${user})`), sddl);
  assert.ok(sddl.includes(`(${dacl};FA;;;WD)`), sddl);
  assert.match(sddl, /D:P/);
  assert.ok(sddl.includes(`(${label};NW;;;${level})`), sddl);
}

test('provider-free A/B restricted-child image initialization diagnosis', {
  skip: process.platform !== 'win32' ? 'Windows token/MIC/Job APIs required' : false,
  timeout: 180000,
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
      classification: null, matrixStatus: 'UNKNOWN',
      error: { code: compile.error?.code, message: compile.error?.message, status: compile.status, stderr: compile.stderr },
    }, null, 2));
  }
  assert.equal(compile.error, undefined, `Compiler error; retained evidence: ${run}`);
  assert.equal(compile.status, 0, `Compilation failed; retained evidence: ${run}\n${compile.stderr}`);
  const result = spawnSync(executable, [root], {
    cwd: run, env: environment, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  // Persist before any assertion, including a blocked host's negative receipt.
  fs.writeFileSync(path.join(run, 'execution.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2));
  let receipt;
  try { receipt = JSON.parse((result.stdout || '').trim()); }
  catch (error) { fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify({ classification: null, matrixStatus: 'UNKNOWN', parseError: error.message }, null, 2)); throw error; }
  fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify(receipt, null, 2));
  assert.equal(result.error, undefined, `Execution failed; retained evidence: ${run}`);
  assert.equal(receipt.authority, 'PROVIDER_FREE_TEST_ONLY');
  assert.equal(receipt.network, 'NOT_AUTHORIZED');
  assert.equal(receipt.credentials, 'NONE');
  assert.equal(receipt.OMP, 'NOT_RUN');
  assert.equal(receipt.CLIProxyAPI, 'NOT_RUN');
  assert.equal(result.status, 0, `Unresolved diagnostic is not PASS: ${JSON.stringify(receipt)}; retained: ${run}`);
  assert.equal(receipt.schema, 'restricted-child-image-diagnosis');
  assert.equal(receipt.version, 1);
  assert.ok(['EVERYONE_RESTRICTING_SID_IMAGE_INIT_CONFLICT', 'IMAGE_INITIALIZATION_BLOCK_REMAINS'].includes(receipt.classification));
  const user = receipt.parentToken.userSid;
  assert.equal(receipt.parentToken.integritySid, 'S-1-16-8192');
  assert.equal(receipt.parentToken.tokenType, 1);
  assert.deepEqual(Object.keys(receipt.variants), ['A', 'B']);
  assert.equal(receipt.helperPath.toLowerCase(), executable.toLowerCase());
  assert.ok(receipt.normallyLoadedModulePaths.length > 0 && receipt.normallyLoadedModulePaths.length <= 256);
  for (const id of ['A', 'B']) {
    const variant = receipt.variants[id];
    assert.equal(variant.schema, 'restricted-child-variant');
    assert.equal(variant.version, 1);
    assert.equal(variant.variantId, id);
    token(variant.restrictedToken, user, id);
    assert.deepEqual(variant.restrictionConstruction, { flags: 1, disabledSids: [], restrictingSids: id === 'A' ? ['S-1-1-0'] : [], writeRestricted: false, identityIsolation: false });
    const expectedPaths = [receipt.helperPath, ...receipt.normallyLoadedModulePaths.filter(p => p.toLowerCase() !== receipt.helperPath.toLowerCase())];
    assert.deepEqual(variant.fileDiagnostics.map(d => d.path), expectedPaths);
    for (const diagnostic of variant.fileDiagnostics) {
      assert.equal(diagnostic.scope, 'FILE_GENERIC_READ_EXECUTE_ACCESSCHECK_NOT_IMAGE_LOADER_PROOF');
      assert.ok(['OBSERVED', 'UNKNOWN'].includes(diagnostic.status));
      if (diagnostic.status === 'OBSERVED') {
        assert.equal(typeof diagnostic.securityDescriptor, 'string');
        assert.equal(typeof diagnostic.accessStatus, 'boolean');
        assert.equal(typeof diagnostic.grantedAccess, 'number');
      } else assert.equal(typeof diagnostic.error, 'string');
    }
    const launch = variant.entry;
    assert.equal(launch.schema, 'restricted-child-launch');
    assert.equal(launch.version, 1);
    assert.equal(launch.variantId, id);
    token(launch.token, user, id);
    assert.deepEqual(launch.createProcessAsUser, { success: true, win32Error: 0 });
    assert.ok(Number.isInteger(launch.pid) && launch.pid > 0);
    assert.equal(launch.jobMember, true);
    assert.equal(launch.creationTimeJob, true);
    assert.equal(launch.ioMode, 'RAW_PIPE');
    assert.equal(launch.eof, true);
    assert.equal(launch.pipeDrained, true);
    assert.equal(launch.inputClosed, true);
    assert.equal(launch.activeProcessesFinal, 0);
    assert.equal(launch.cleanup, 'JOB_EMPTY_HANDLES_CLOSED');
    assert.equal(launch.error, undefined);
    assert.equal(launch.exitCodeHex, `0x${launch.exitCode.toString(16).toUpperCase().padStart(8, '0')}`);
    assert.equal(launch.terminatedJob, false);
  }
  const a = receipt.variants.A.entry;
  const b = receipt.variants.B.entry;
  for (const field of ['executable', 'cwd', 'environment', 'handleList', 'stderr', 'jobLimitFlags', 'creationFlags', 'creationTimeJob', 'ioMode', 'mode']) assert.deepEqual(a[field], b[field], field);
  assert.deepEqual(b.handleList, ['stdin-read', 'stdout-write']);
  assert.equal(b.jobLimitFlags, 0x2000);
  assert.equal(b.creationFlags, 0x8080400);
  assert.equal(b.executable.toLowerCase(), executable.toLowerCase());
  assert.equal(b.cwd.toLowerCase(), path.join(root, 'worker').toLowerCase());
  assert.deepEqual(b.environment, { SystemRoot: process.env.SystemRoot, TEMP: path.join(root, 'worker'), TMP: path.join(root, 'worker') });
  assert.equal(a.managedCodeReached, false);
  assert.equal(a.exitCodeHex, '0xC0000022');
  assert.equal(a.stdoutBytes, 0);
  assert.equal(a.worker, null);
  assert.equal(receipt.variants.A.normal, undefined);
  assert.equal(receipt.variants.A.timeout, undefined);
  security(receipt.ledgerSecurity, user, 'ME');
  security(receipt.workerSecurity, user, 'LW');
  security(receipt.runSecurity, user, 'ME');
  security(receipt.helperSecurity, user, 'ME', 'file');
  assert.equal(receipt.ledgerSecurity.split('S:')[0], receipt.workerSecurity.split('S:')[0]);
  assert.equal(receipt.ledgerSecurity.replace(';;;ME)', ';;;LW)'), receipt.workerSecurity);
  assert.match(receipt.ledgerFileSecurity, /\(ML;[^;]*;NW;;;ME\)/);
  assert.equal(receipt.cleanup, 'REMOVED_TEST_ROOT');
  assert.equal(fs.existsSync(root), false);
  if (receipt.classification === 'IMAGE_INITIALIZATION_BLOCK_REMAINS') {
    assert.equal(receipt.matrixStatus, 'OBSERVED_IMAGE_INIT_BLOCK');
    assert.equal(b.managedCodeReached, false);
    assert.equal(b.exitCodeHex, '0xC0000022');
    assert.equal(b.stdoutBytes, 0);
    assert.equal(b.worker, null);
    assert.equal(receipt.variants.B.normal, undefined);
    assert.equal(receipt.variants.B.timeout, undefined);
    assert.equal(receipt.WINDOWS_RESTRICTED_WORKER_TOKEN_POC, undefined);
    assert.equal(receipt.RESTRICTED_LOW_INTEGRITY_BOUNDARY, undefined);
    return; // Honest negative diagnosis, not a restricted-worker boundary proof.
  }
  assert.equal(receipt.matrixStatus, 'FULL_B_MATRIX_RECORDED');
  assert.equal(receipt.WINDOWS_RESTRICTED_WORKER_TOKEN_POC, 'VERIFIED_FOR_VARIANT_B');
  assert.equal(receipt.RESTRICTED_LOW_INTEGRITY_BOUNDARY, 'PROVEN_PROVIDER_FREE_NOT_INTEGRATED');
  assert.equal(b.managedCodeReached, true);
  assert.equal(b.exitCode, 0);
  token(b.worker.token, user);
  assert.deepEqual(receipt.normal, receipt.variants.B.normal);
  assert.deepEqual(receipt.timeout, receipt.variants.B.timeout);
  for (const [mode, exitCode] of [['normal', 0], ['timeout', 124]]) {
    const lifecycle = receipt[mode];
    assert.equal(lifecycle.variantId, 'B');
    assert.equal(lifecycle.managedCodeReached, true);
    assert.ok(lifecycle.stdoutBytes > 0);
    assert.equal(lifecycle.eof, true);
    assert.equal(lifecycle.cleanup, 'JOB_EMPTY_HANDLES_CLOSED');
    assert.equal(lifecycle.error, undefined);
    assert.deepEqual(lifecycle.createProcessAsUser, { success: true, win32Error: 0 });
    assert.deepEqual(lifecycle.stdinWrite, { success: true, bytes: 7, win32Error: 0 });
    token(lifecycle.token, user);
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
