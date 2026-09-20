'use strict';
// MECHANICS_ONLY: no CLI, filesystem, credentials or network activity.
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const coreApi = loadTs('src/main/codexWorkerContract.ts');
const adapters = loadTs('src/main/runtimeAdapter.ts');
const access = loadTs('src/main/modelAccessAuthority.ts');
function fixture(adapterId = 'codex', patch = {}) {
  const core = coreApi.createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: 'a'.repeat(64), sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) },
    syntheticRoot: 'C:\\fixture\\neutral', ...patch });
  const route = access.createInertModelRoute(core, { endpoint: 'https://route.invalid', model: 'independent-model',
    expiresAt: Date.now() + 60000, evidenceId: 'fixture-evidence' });
  const adapter = adapters.describeInertRuntime(adapterId, core, {
    executablePath: `C:\\approved\\${adapterId}.exe`, version: 'fixture-only', executableSha256: 'd'.repeat(64)
  }, route.endpoint, route.model, adapterId === 'omp' ? 'high' : undefined);
  const issuer = access.createInertModelAccessIssuer();
  const handle = issuer.mint(core, adapter, route);
  return { core, route, adapter, issuer, handle };
}
test('same Core result and once-only authority semantics cover distinct inert Codex and OMP descriptors', () => {
  const codex = fixture(); const omp = fixture('omp');
  assert.deepEqual(codex.core, omp.core);
  assert.equal('codexHomeDir' in codex.core.rootPolicy, false);
  assert.equal('executable' in codex.core, false);
  assert.equal(codex.adapter.config.environmentKey, 'CODEX_HOME');
  assert.equal(omp.adapter.config.environmentKey, 'UNKNOWN');
  assert.equal(omp.adapter.args, null);
  assert.equal(omp.adapter.thinkingLevel, 'high');
  assert.equal(omp.adapter.taskDelivery, 'UNKNOWN');
  assert.equal(omp.adapter.approval, 'UNKNOWN');
  assert.equal(omp.adapter.session, 'FRESH_REQUIRED_SYNTAX_UNKNOWN');
  assert.deepEqual(codex.adapter.args.slice(-2), ['exec', '-']);
  assert.ok(codex.adapter.args.includes('independent-model'));
  assert.equal(codex.adapter.taskDelivery, 'RAW_PIPE_EXACT_BYTES_THEN_EOF');
  for (const f of [codex, omp]) {
    const { candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint } = f.core;
    const result = { schemaVersion: 1, candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint,
      result: 'PASS', checks: { fixture: 'PASS' }, artifacts: [] };
    assert.deepEqual(coreApi.validateTaskResult(result, f.core, { resultAlreadyExists: false }), result);
    assert.throws(() => coreApi.validateTaskResult({ ...result, runId: 'stale' }, f.core, { resultAlreadyExists: false }), /identity/);
    assert.throws(() => coreApi.validateTaskResult(result, f.core, { resultAlreadyExists: true }), /Duplicate/);
    const evidence = f.issuer.consume(f.handle, f.core, f.adapter, f.route);
    assert.equal(evidence.network, 'NOT_AUTHORIZED');
    assert.equal(evidence.execution, 'NOT_RUN');
    assert.equal(evidence.approval, 'SYNTHETIC_FIXTURE_ONLY');
    assert.equal(evidence.routeId, 'CLIProxyAPI');
    assert.throws(() => f.issuer.consume(f.handle, f.core, f.adapter, f.route), /Spent/);
  }
});
test('model access rejects copies, foreign issuers, revocation, expiry and authority upgrades', () => {
  const f = fixture();
  const consume = (handle, core = f.core, adapter = f.adapter, route = f.route) => f.issuer.consume(handle, core, adapter, route);
  for (const handle of [{}, { ...f.handle }, fixture().handle, undefined]) assert.throws(() => consume(handle), /Forged/);
  assert.throws(() => JSON.stringify(f.handle), /not serializable/);
  for (const patch of [{ network: 'AUTHORIZED' }, { attemptBound: 2 }, { approval: 'HUMAN' }, { routeId: 'Other' },
    { evidenceId: 'other' }, { endpoint: 'https://other.invalid' }, { model: 'other-model' }, { expiresAt: f.route.expiresAt + 1 }])
    assert.throws(() => consume(f.handle, f.core, f.adapter, { ...f.route, ...patch }));
  for (const field of ['candidateId', 'taskId', 'runId', 'workerId', 'taskDigest']) {
    const other = fixture('codex', { [field]: field === 'taskDigest' ? 'e'.repeat(64) : 'other' });
    assert.throws(() => consume(f.handle, other.core, other.adapter, other.route), /substitution/);
  }
  const otherSource = fixture('codex', { sourceCheckpoint: { ...f.core.sourceCheckpoint, commitSha: 'e'.repeat(40) } });
  assert.throws(() => consume(f.handle, otherSource.core, otherSource.adapter, otherSource.route), /substitution/);
  const omp = fixture('omp');
  assert.throws(() => consume(f.handle, omp.core, omp.adapter, f.route), /substitution/);
  for (const patch of [{ network: 'AUTHORIZED' }, { credentials: 'HOST' }, { args: ['--yolo'] },
    { config: { ...f.adapter.config, root: 'C:\\outside' } }, { cwd: 'C:\\outside' }])
    assert.throws(() => consume(f.handle, f.core, { ...f.adapter, ...patch }), /substitution/);
  const now = Date.now;
  try { Date.now = () => f.route.expiresAt; assert.throws(() => consume(f.handle), /Invalid model route/); }
  finally { Date.now = now; }
  f.issuer.revoke(f.handle);
  assert.throws(() => consume(f.handle), /revoked/);
});
test('attemptBound rejects a second mint of identical scope on the same issuer', () => {
  for (const adapterId of ['codex', 'omp']) {
    const f = fixture(adapterId);
    assert.equal(f.route.attemptBound, 1);
    assert.throws(() => f.issuer.mint(f.core, f.adapter, f.route), /attempt bound exhausted/);
    f.issuer.consume(f.handle, f.core, f.adapter, f.route);
    assert.throws(() => f.issuer.mint(f.core, f.adapter, f.route), /attempt bound exhausted/);
  }
});
test('authority binding ignores object key order at every depth but retains array order', () => {
  function reorder(value) {
    if (Array.isArray(value)) return value.map(reorder);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
  }
  for (const adapterId of ['codex', 'omp']) {
    const f = fixture(adapterId);
    const core = reorder(f.core); const adapter = reorder(f.adapter); const route = reorder(f.route);
    assert.equal(adapters.coreScopeDigest(core), f.route.scopeDigest);
    assert.throws(() => f.issuer.mint(core, adapter, route), /attempt bound exhausted/);
    const evidence = f.issuer.consume(f.handle, core, adapter, route);
    const issuer = access.createInertModelAccessIssuer();
    const handle = issuer.mint(core, adapter, route);
    assert.deepEqual(issuer.consume(handle, f.core, f.adapter, f.route), evidence);
  }
  const f = fixture();
  assert.throws(() => f.issuer.consume(f.handle, f.core, { ...f.adapter, args: [...f.adapter.args].reverse() }, f.route), /substitution/);
});
test('authority rejects added, missing and substituted fields including executable identity', () => {
  const f = fixture();
  for (const index of [0, 1, 2]) {
    const original = [f.core, f.adapter, f.route];
    const missing = { ...original[index] };
    delete missing[{ 0: 'network', 1: 'execution', 2: 'approval' }[index]];
    for (const replacement of [{ ...original[index], extra: undefined }, missing,
      Object.defineProperty({ ...original[index] }, 'hidden', { value: true }),
      { ...original[index], [Symbol('extra')]: true }]) {
      const scope = [...original]; scope[index] = replacement;
      assert.throws(() => f.issuer.consume(f.handle, ...scope), /substitution/);
    }
  }
  for (const patch of [{ executablePath: 'C:\\approved\\other.exe' }, { version: 'other-version' },
    { executableSha256: 'e'.repeat(64) }]) {
    assert.throws(() => f.issuer.consume(f.handle, f.core,
      { ...f.adapter, executable: { ...f.adapter.executable, ...patch } }, f.route), /substitution/);
  }
  assert.throws(() => f.issuer.consume(f.handle,
    { ...f.core, rootPolicy: { ...f.core.rootPolicy, extra: undefined } }, f.adapter, f.route), /substitution/);
  assert.throws(() => f.issuer.consume(f.handle, f.core,
    { ...f.adapter, config: { ...f.adapter.config, extra: undefined } }, f.route), /substitution/);
  assert.equal(f.issuer.consume(f.handle, f.core, f.adapter, f.route).execution, 'NOT_RUN');
});
test('neutral executable normalization preserves historical Codex descriptor serialization', () => {
  const descriptor = fixture('omp').adapter.executable;
  assert.deepEqual(coreApi.normalizeRuntimeExecutableDescriptor(descriptor),
    coreApi.normalizeCodexExecutableDescriptor(descriptor));
  assert.equal(JSON.stringify(coreApi.normalizeRuntimeExecutableDescriptor(descriptor)), JSON.stringify(descriptor));
  assert.throws(() => coreApi.normalizeRuntimeExecutableDescriptor({ ...descriptor, extra: true }));
  assert.throws(() => coreApi.normalizeRuntimeExecutableDescriptor({ ...descriptor, executablePath: 'omp.cmd' }));
});
test('legacy Codex argv remains byte-for-byte compatible without an explicit model', () => {
  assert.deepEqual(adapters.codexBackendArgv('https://route.invalid'), [
    '--ignore-user-config', '--ask-for-approval', 'never', '--sandbox', 'workspace-write',
    '-c', 'model_provider="munder"', '-c', 'model_providers.munder.name="Munder"',
    '-c', 'model_providers.munder.base_url="https://route.invalid/v1"',
    '-c', 'model_providers.munder.wire_api="responses"', 'exec', '-'
  ]);
});
