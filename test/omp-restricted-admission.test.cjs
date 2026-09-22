'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const load = require('./load-ts.cjs');
const { createCoreRuntimeContract } = load('src/main/codexWorkerContract.ts');
const { describeInertRuntime } = load('src/main/runtimeAdapter.ts');
const { inspectOmpPreparation } = load('src/main/ompPreparationInspector.ts');
const { createInertModelRoute } = load('src/main/modelAccessAuthority.ts');
const { createOmpRestrictedAdmissionIssuer } = load('src/main/ompRestrictedAdmission.ts');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const repository = fs.realpathSync.native(path.resolve(__dirname, '..'));
const quote = s => `'${s.replaceAll("'", "''")}'`;

for (const scenario of ['normal', 'timeout', 'ledger-substitution', 'models-substitution', 'reserved-receipt-substitution', 'reserved-identity-substitution', 'reserved-replacement', 'reserved-extra-entry', 'forged-preparation', 'cwd-substitution', 'argv-substitution', 'model-substitution', 'executable-substitution', 'env-substitution', 'route-substitution']) test(`genuine prepared reservation restricted production launch ${scenario}`, { timeout: 240000 }, async t => {
  const wait = scenario === 'timeout';
  assert.equal(process.platform, 'win32', 'Windows proof required');
  const parent = fs.realpathSync.native(process.env.OMP_PREPARATION_TEST_BASE || path.parse(repository).root);
  for (const ambient of [repository, fs.realpathSync.native(os.homedir())]) {
    const relative = path.relative(ambient.toLowerCase(), parent.toLowerCase());
    assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'PREPARATION_BASE_UNAVAILABLE: repository/Human-home overlap');
  }
  const created = fs.mkdtempSync(path.join(parent, 'omp-boundary-'));
  t.after(() => fs.rmSync(created, { recursive: true, force: true }));
  const owned = fs.realpathSync.native(created);
  const base = path.join(owned, 'preparation'), evidenceBase = path.join(owned, 'main'), ledger = path.join(evidenceBase, 'ledger');
  for (const p of [base, evidenceBase, ledger]) fs.mkdirSync(p);
  const systemRoot = process.env.SystemRoot;
  const helperPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const helperEnv = { SystemRoot: systemRoot, ComSpec: path.join(systemRoot, 'System32/cmd.exe'), PATH: path.join(systemRoot, 'System32'), TEMP: owned, TMP: owned, HOME: owned, USERPROFILE: owned, APPDATA: owned, LOCALAPPDATA: owned, POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off', PSModuleAnalysisCachePath: path.join(owned, 'module-cache') };
  const executablePath = path.join(owned, 'BoundaryChild.exe');
  const compiled = spawnSync(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; Add-Type -Path ${quote(path.join(__dirname, 'fixtures/omp-boundary-child.cs'))} -OutputAssembly ${quote(executablePath)} -OutputType ConsoleApplication`, 'utf16le').toString('base64')], { cwd: owned, env: helperEnv, encoding: 'utf8', timeout: 60000 });
  assert.equal(compiled.error, undefined); assert.equal(compiled.status, 0, compiled.stderr);
  const core = createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: wait ? 'timeout' : 'normal', workerId: 'worker', taskDigest: 'a'.repeat(64), sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) }, syntheticRoot: path.join(base, 'synthetic') });
  const adapter = describeInertRuntime('omp', core, { executablePath, executableSha256: sha(executablePath), version: '18.2.7' }, 'http://localhost:8317', 'boundary', 'off', wait ? 5 : 30);
  const route = createInertModelRoute(core, { endpoint: 'http://localhost:8317', trustClass: 'LOCAL_LOOPBACK', model: 'boundary', expiresAt: Date.now() + 600000, evidenceId: 'route' });
  const preparation = inspectOmpPreparation({ core, adapter, preparationBase: base, repositoryRoot: repository, humanHomeRoot: fs.realpathSync.native(os.homedir()) });
  const scriptPath = path.join(repository, 'src/main/windowsOwnedPty.ps1'), nativeSourcePath = path.join(repository, 'src/main/windowsOwnedPty.cs'), securitySourcePath = path.join(repository, 'src/main/ompWindowsSecurity.cs');
  const settings = { evidenceBase, evidenceDirectory: ledger, securitySourcePath, securitySourceSha256: sha(securitySourcePath), backend: { helperPath, helperSha256: sha(helperPath), scriptPath, scriptSha256: sha(scriptPath), nativeSourcePath, nativeSourceSha256: sha(nativeSourcePath), helperEnv } };
  const issuer = createOmpRestrictedAdmissionIssuer(settings);
  const reservation = issuer.reserve(core, adapter, route, 'authorization');
  assert.throws(() => JSON.stringify(reservation), /serializable/);
  if (scenario === 'reserved-receipt-substitution' || scenario === 'reserved-identity-substitution') {
    const prefix = scenario === 'reserved-receipt-substitution' ? 'omp-attempt-' : 'attempt-identity-';
    const names = fs.readdirSync(ledger).filter(name => name.startsWith(prefix));
    assert.equal(names.length, 1);
    const target = path.join(ledger, names[0]);
    const original = fs.readFileSync(target);
    fs.appendFileSync(target, 'pre-admission-substitution');
    assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /Reservation bytes changed since reserve/);
    // Restoring the original bytes cannot resurrect the consumed attempt.
    fs.writeFileSync(target, original);
    assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /spent/i);
    assert.throws(() => issuer.reserve(core, adapter, route, 'authorization'), /EEXIST/);
    return;
  }
  if (scenario === 'reserved-replacement' || scenario === 'reserved-extra-entry') {
    const target = path.join(ledger, fs.readdirSync(ledger).find(name => name.startsWith('omp-attempt-')));
    if (scenario === 'reserved-replacement') {
      const replacement = path.join(owned, 'replacement');
      fs.writeFileSync(replacement, fs.readFileSync(target));
      fs.unlinkSync(target); fs.renameSync(replacement, target);
    } else fs.writeFileSync(path.join(ledger, 'unexpected-entry'), 'extra');
    assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /identity|entry-set|authority|mismatch|protected|LABEL/i);
    assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /spent/i);
    return;
  }
  assert.throws(() => issuer.admit(core, adapter, route, preparation, {}), /Forged|foreign/);
  const substitutions = {
    'cwd-substitution': { ...adapter, cwd: owned },
    'argv-substitution': { ...adapter, args: [...adapter.args, '--extra'] },
    'model-substitution': { ...adapter, model: 'other' },
    'executable-substitution': { ...adapter, executable: { ...adapter.executable, executablePath: path.join(owned, 'other.exe') } },
    'env-substitution': { ...adapter, config: { ...adapter.config, isolation: { ...adapter.config.isolation, environment: { ...adapter.config.isolation.environment, TEMP: owned } } } }
  };
  if (substitutions[scenario] || scenario === 'route-substitution' || scenario === 'forged-preparation') {
    assert.throws(() => issuer.admit(core, substitutions[scenario] || adapter,
      scenario === 'route-substitution' ? { ...route, model: 'other' } : route,
      scenario === 'forged-preparation' ? {} : preparation, reservation), /substitution|foreign|forged/i);
    assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /spent/i);
    return;
  }
  const admitted = issuer.admit(core, adapter, route, preparation, reservation);
  assert.equal(Object.isFrozen(admitted.evidence), true);
  assert.throws(() => JSON.stringify(admitted.handle), /serializable/);
  const callbacks = { onData() {}, onStarted() {}, onExit() {} };
  for (const forged of [{}, { ...admitted.handle }, JSON.parse('{}')]) assert.throws(() => issuer.launch(forged, callbacks), /Forged|foreign/);
  const foreign = createOmpRestrictedAdmissionIssuer(settings);
  assert.throws(() => foreign.launch(admitted.handle, callbacks), /foreign/);
  if (scenario === 'ledger-substitution' || scenario === 'models-substitution') {
    const target = scenario === 'ledger-substitution' ? admitted.evidence.reservation.receiptPath : adapter.config.isolation.modelsFile;
    fs.appendFileSync(target, 'substitution');
    assert.throws(() => issuer.launch(admitted.handle, callbacks), /changed|mismatch/);
    assert.throws(() => issuer.launch(admitted.handle, callbacks), /spent/);
    return;
  }
  const writable = admitted.evidence.matrix.filter(x => x.disposition === 'LOW_WRITABLE').map(x => x.path);
  const protectedFiles = [admitted.evidence.reservation.receiptPath, admitted.evidence.reservation.attemptIdentityPath, adapter.config.isolation.modelsFile];
  const bytes = Buffer.from(['OMP_BOUNDARY_1', wait ? '1' : '0', Buffer.from(ledger).toString('base64'), String(writable.length),
    ...writable.map(p => Buffer.from(p).toString('base64')), String(protectedFiles.length),
    ...protectedFiles.map(p => Buffer.from(p).toString('base64'))].join('\n'));
  let output = '';
  const running = issuer.launch(admitted.handle, { onData(data) { output += data; }, onStarted() {}, onExit() {} });
  assert.throws(() => issuer.launch(admitted.handle, callbacks), /spent/);
  running.input(bytes); running.closeInput();
  const receipt = await running.completion;
  assert.equal(receipt.securityContext, 'RESTRICTED_LOW');
  assert.equal(receipt.restrictedTokenVerified, true); assert.equal(receipt.childTokenVerified, true);
  assert.equal(receipt.rootJobMember, true); assert.equal(receipt.ioMode, 'RAW_PIPE');
  assert.equal(receipt.inputClosed, true); assert.equal(receipt.activeProcessesFinal, 0);
  assert.equal(receipt.cleanupState, 'VERIFIED_EMPTY'); assert.equal(receipt.ioDrained, true);
  assert.equal(receipt.reason, wait ? 'timeout' : 'exit', JSON.stringify({ receipt, output }));
  if (!wait) assert.equal(receipt.rootExit, 0, JSON.stringify({ receipt, output }));
  const child = JSON.parse(output.trim());
  assert.equal(child.cwd, core.rootPolicy.workDir); assert.deepEqual(child.args, adapter.args);
  assert.equal(child.base64, bytes.toString('base64')); assert.equal(child.eof, true);
  assert.equal(child.operations.length, writable.length * 7 + protectedFiles.length * 5 + 2);
  for (const operation of child.operations) {
    const allowed = writable.some(p => operation.name.startsWith(p + ':'));
    assert.equal(operation.success, allowed, operation.name);
    if (!allowed) assert.ok(Number.isInteger(operation.error) && operation.error !== 0, operation.name);
  }
  for (const file of admitted.evidence.before.files) {
    assert.equal(fs.readFileSync(file.path).toString('base64'), file.bytes);
    assert.equal(sha(file.path), file.sha256);
  }
  assert.deepEqual(fs.readdirSync(ledger).sort(), admitted.evidence.before.entries);
  assert.throws(() => issuer.admit(core, adapter, route, preparation, reservation), /spent/i);
  assert.throws(() => issuer.reserve(core, adapter, route, 'authorization'), /EEXIST/);
  assert.throws(() => issuer.reserve(core, adapter, route, 'different-authorization'), /EEXIST/);
});
