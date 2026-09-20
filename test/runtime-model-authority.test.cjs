'use strict';
// MECHANICS_ONLY: no CLI, filesystem, credentials or network activity.
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const coreApi = loadTs('src/main/codexWorkerContract.ts');
const adapters = loadTs('src/main/runtimeAdapter.ts');
const access = loadTs('src/main/modelAccessAuthority.ts');
function fixture(adapterId = 'codex', patch = {}, routePatch = {}) {
  const core = coreApi.createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: 'a'.repeat(64), sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) },
    syntheticRoot: 'C:\\fixture\\neutral', ...patch });
  const route = access.createInertModelRoute(core, { endpoint: 'https://route.invalid', trustClass: 'REMOTE_TLS', model: 'independent-model',
    expiresAt: Date.now() + 60000, evidenceId: 'fixture-evidence', ...routePatch });
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

for (const [trustClass, endpoint] of [
  ['REMOTE_TLS', 'https://route.invalid'], ['REMOTE_TLS', 'https://route.invalid:65535'],
  ['REMOTE_TLS', 'https://model-route.service.invalid:8443'],
  ['LOCAL_LOOPBACK', 'http://127.0.0.1:8317'], ['LOCAL_LOOPBACK', 'http://localhost:8317'],
  ['LOCAL_LOOPBACK', 'http://localhost:1'], ['LOCAL_LOOPBACK', 'http://localhost:80'],
  ['LOCAL_LOOPBACK', 'http://127.0.0.1:65535']
]) test(`model route accepts ${trustClass} ${endpoint} without granting execution`, () => {
  const f = fixture('codex', {}, { trustClass, endpoint });
  assert.equal(f.route.endpoint, endpoint);
  assert.equal(f.route.trustClass, trustClass);
  assert.equal(f.route.endpointPolicy.origin, endpoint);
  assert.equal(f.route.endpointPolicy.trustClass, trustClass);
  assert.equal(f.route.endpointPolicy.alternateOrigins, 'DENY');
  assert.equal(f.route.endpointPolicy.callerOverride, 'DENY');
  assert.equal(f.route.endpointPolicy.redirects, 'DENY');
  assert.throws(() => { f.route.endpointPolicy.origin = 'https://other.invalid'; }, TypeError);
  assert.throws(() => { f.route.trustClass = 'OTHER'; }, TypeError);
  assert.ok(f.adapter.args.includes(`model_providers.munder.base_url=${JSON.stringify(endpoint + '/v1')}`));
  const result = f.issuer.consume(f.handle, f.core, f.adapter, f.route);
  assert.equal(result.network, 'NOT_AUTHORIZED');
  assert.equal(result.execution, 'NOT_RUN');
  assert.equal(result.approval, 'SYNTHETIC_FIXTURE_ONLY');
});

for (const endpoint of [
  'http://0.0.0.0:8317', 'http://10.1.2.3:8317', 'http://172.16.1.2:8317', 'http://192.168.1.2:8317',
  'http://remote.invalid:8317', 'http://[::1]:8317', 'https://localhost:8317',
  'http://localhost', 'http://localhost:0', 'http://localhost:65536', 'http://localhost:08317',
  'http://user@localhost:8317', 'http://localhost:8317/', 'http://localhost:8317/v1',
  'http://localhost:8317?q=1', 'http://localhost:8317#fragment', 'http://LOCALHOST:8317',
  'http://localhost.:8317', 'http://127.1:8317', 'http://2130706433:8317'
]) test(`LOCAL_LOOPBACK rejects ${endpoint}`, () => {
  assert.throws(() => fixture('codex', {}, { trustClass: 'LOCAL_LOOPBACK', endpoint }));
});

for (const endpoint of [
  'http://route.invalid:8317', 'http://127.0.0.1:8317', 'http://localhost:8317',
  'https://localhost:8317', 'https://127.0.0.1:8317', 'https://0.0.0.0:8317',
  'https://10.1.2.3:8317', 'https://172.16.1.2:8317', 'https://192.168.1.2:8317',
  'https://8.8.8.8', 'https://[::1]:8317', 'https://2130706433', 'https://0x7f000001',
  'https://0177.0.0.1', 'https://0x7f.0.0.1', 'https://intranet:8317',
  'https://*.invalid', 'https://-route.invalid', 'https://route-.invalid', 'https://route..invalid',
  `https://${'a'.repeat(64)}.invalid`, `https://${Array(4).fill('a'.repeat(63)).join('.')}`,
  'https://ROUTE.invalid', 'https://route.invalid:443', 'https://route.invalid:0',
  'https://route.invalid:65536', 'https://route.invalid:08443', 'https://route.invalid.',
  'https://user@route.invalid', 'https://route.invalid/', 'https://route.invalid/v1',
  'https://route.invalid?q=1', 'https://route.invalid#fragment', 'https://127.1'
]) test(`REMOTE_TLS rejects ${endpoint}`, () => {
  assert.throws(() => fixture('codex', {}, { endpoint }));
});

test('model route requires an explicit supported trust class', () => {
  for (const trustClass of [undefined, null, 'OTHER']) assert.throws(() => fixture('codex', {}, { trustClass }));
});

for (const [name, original, replacement] of [
  ['remote hostname', ['REMOTE_TLS', 'https://route.invalid'], ['REMOTE_TLS', 'https://other.invalid']],
  ['remote port', ['REMOTE_TLS', 'https://route.invalid'], ['REMOTE_TLS', 'https://route.invalid:8443']],
  ['local hostname', ['LOCAL_LOOPBACK', 'http://localhost:8317'], ['LOCAL_LOOPBACK', 'http://127.0.0.1:8317']],
  ['local port', ['LOCAL_LOOPBACK', 'http://localhost:8317'], ['LOCAL_LOOPBACK', 'http://localhost:8318']],
  ['remote to local', ['REMOTE_TLS', 'https://route.invalid:8317'], ['LOCAL_LOOPBACK', 'http://localhost:8317']],
  ['local to remote', ['LOCAL_LOOPBACK', 'http://localhost:8317'], ['REMOTE_TLS', 'https://route.invalid:8317']]
]) test(`authority rejects coherent ${name} substitution including OMP's endpoint-free descriptor`, () => {
  for (const adapterId of ['codex', 'omp']) {
    const f = fixture(adapterId, {}, { trustClass: original[0], endpoint: original[1] });
    const route = access.createInertModelRoute(f.core, { trustClass: replacement[0], endpoint: replacement[1],
      model: f.route.model, expiresAt: f.route.expiresAt, evidenceId: f.route.evidenceId });
    const adapter = adapters.describeInertRuntime(adapterId, f.core, f.adapter.executable,
      route.endpoint, route.model, f.adapter.thinkingLevel ?? undefined);
    assert.throws(() => f.issuer.consume(f.handle, f.core, adapter, route), /scope substitution/);
    assert.equal(f.issuer.consume(f.handle, f.core, f.adapter, f.route).execution, 'NOT_RUN');
  }
});

test('authority rejects isolated scheme and trust-class substitutions and endpoint policy overrides', () => {
  for (const trustClass of ['REMOTE_TLS', 'LOCAL_LOOPBACK']) {
    const f = fixture('omp', {}, { trustClass, endpoint: trustClass === 'REMOTE_TLS'
      ? 'https://route.invalid:8317' : 'http://localhost:8317' });
    const otherTrust = trustClass === 'REMOTE_TLS' ? 'LOCAL_LOOPBACK' : 'REMOTE_TLS';
    const otherEndpoint = trustClass === 'REMOTE_TLS' ? 'http://localhost:8317' : 'https://route.invalid:8317';
    for (const patch of [{ trustClass: otherTrust }, { endpoint: otherEndpoint },
      ...[{ trustClass: otherTrust }, { origin: otherEndpoint }, { alternateOrigins: 'ALLOW' },
        { callerOverride: 'ALLOW' }, { redirects: 'ALLOW' }, { port: 8318 }, { host: 'other.invalid' }]
        .map(policyPatch => ({ endpointPolicy: { ...f.route.endpointPolicy, ...policyPatch } }))]) {
      assert.throws(() => f.issuer.consume(f.handle, f.core, f.adapter, { ...f.route, ...patch }));
    }
    assert.equal(f.issuer.consume(f.handle, f.core, f.adapter, f.route).execution, 'NOT_RUN');
  }
});
