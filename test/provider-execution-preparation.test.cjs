'use strict';
// MECHANICS_ONLY: inert handles, .invalid metadata, no provider or network invocation.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const api = loadTs('src/main/providerExecutionPreparation.ts');
const contracts = loadTs('src/main/codexWorkerContract.ts');
function fixture(text = 'literal $(not-a-shell)\n中文') {
  const contract = contracts.createCodexWorkerContract({
    candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: crypto.createHash('sha256').update(text).digest('hex'),
    sourceCheckpoint: { repositoryId: 'repo', commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40) },
    executable: { executablePath: 'C:\\approved\\codex.exe', version: 'test', executableSha256: 'c'.repeat(64) },
    syntheticRoot: 'C:\\synthetic\\preparation', credentialMode: 'DEDICATED_PREPROVISIONED'
  });
  const request = Buffer.from(JSON.stringify({ contract, task: { encoding: 'utf8', text } }));
  const issuer = api.createProviderExecutionIssuer();
  const expiresAt = Date.now() + 10000;
  const authorization = { recordId: 'synthetic-record', grantedBy: 'SYNTHETIC_ONLY', purpose: 'PROVIDER_EXECUTION',
    scopeDigest: api.providerCredentialScopeDigest(contract), endpointOrigin: 'https://provider.invalid', expiresAt };
  const provenance = issuer.createSyntheticProvenance(contract, expiresAt);
  const credential = issuer.mintCredential(contract, authorization, provenance);
  const task = issuer.mintTask(contract, request, expiresAt);
  const preparation = issuer.prepare(contract, credential, task, 'https://provider.invalid');
  const network = issuer.mintInertNetworkAuthority(preparation, contract, expiresAt);
  return { text, contract, request, issuer, credential, task, preparation, expiresAt, authorization, provenance, network };
}
test('opaque authority refuses copies, revocation, expiry and spent replay', () => {
  const f = fixture();
  assert.throws(() => JSON.stringify(f.preparation), /not serializable/);
  assert.throws(() => JSON.stringify(f.credential), /not serializable/);
  for (const value of [undefined, {}, { ...f.preparation }])
    assert.throws(() => api.assertProviderExecutionPreparation(value, f.contract), /Missing or forged/);
  assert.throws(() => f.issuer.prepare(f.contract, { ...f.credential }, f.task, 'https://provider.invalid'), /Foreign/);
  assert.throws(() => f.issuer.mintCredential(f.contract, {
    recordId: 'synthetic', grantedBy: 'SYNTHETIC_ONLY', purpose: 'PROVIDER_EXECUTION',
    scopeDigest: '0'.repeat(64), endpointOrigin: 'https://provider.invalid', expiresAt: f.expiresAt
  }, f.issuer.createSyntheticProvenance(f.contract, f.expiresAt)), /authorization scope/);
  assert.throws(() => f.issuer.prepare(f.contract, f.credential, f.task, 'https://other.invalid'), /authorization scope/);
  const now = Date.now;
  try {
    Date.now = () => f.expiresAt;
    assert.throws(() => api.assertProviderExecutionPreparation(f.preparation, f.contract), /expired/);
  } finally { Date.now = now; }
  f.issuer.revoke(f.credential);
  assert.throws(() => api.consumeProviderExecutionPreparation(f.preparation, f.contract, f.request, {}), /Revoked/);
  const live = fixture();
  assert.throws(() => api.consumeProviderExecutionPreparation(live.preparation, live.contract, live.request, {}), /BLOCKED_BACKEND_REQUIREMENT/);
  api.assertProviderExecutionPreparation(live.preparation, live.contract);
  const consumed = api.consumeProviderExecutionPreparation(live.preparation, live.contract, live.request, {}, live.network);
  assert.equal(consumed.taskText, live.text);
  assert.throws(() => api.consumeProviderExecutionPreparation(live.preparation, live.contract, live.request, {}, live.network), /spent/);
  assert.throws(() => api.assertProviderExecutionPreparation(live.preparation, live.contract), /spent/);
  assert.throws(() => api.assertProviderNetworkAuthority(live.network, live.preparation, live.contract), /spent/);
});
test('endpoint guards reject canonicalization ambiguity, redirects, alternate origins and proxy overrides', () => {
  for (const origin of ['http://provider.invalid', 'https://PROVIDER.invalid', 'https://provider.invalid:443',
    'https://provider.invalid/', 'https://user@provider.invalid', 'https://provider.invalid/path'])
    assert.throws(() => api.prepareProviderEndpoint(origin));
  const policy = api.prepareProviderEndpoint('https://provider.invalid:8443');
  assert.equal(api.prepareProviderEndpoint('https://provider.invalid').port, 443);
  assert.equal(policy.configurationBackend, 'DESCRIPTOR_ONLY');
  assert.equal(policy.execution, 'INERT_ONLY');
  assert.equal(policy.port, 8443);
  assert.equal(policy.OS_LEVEL_NETWORK_CONTAINMENT, 'UNKNOWN');
  assert.equal(policy.containment, 'APPLICATION_LEVEL_ENDPOINT_BINDING');
  for (const args of [ ['https://other.invalid', {}], ['https://provider.invalid', {}],
    [policy.origin, { HTTPS_PROXY: 'https://proxy.invalid' }], [policy.origin, {}, true], [policy.origin, {}, false, true] ])
    assert.throws(() => api.enforceProviderEndpoint(policy, ...args));
  api.enforceProviderEndpoint(policy, `${policy.origin}/request`, {});
});
test('exact task bytes refuse schema, substitution, invalid UTF-8 and over-budget input', () => {
  const f = fixture();
  assert.deepEqual(api.readProviderTaskDocument(f.request, f.contract), Buffer.from(f.text));
  for (const document of [ { contract: f.contract, task: { encoding: 'utf8', text: 'replacement' } },
    { contract: f.contract, task: { encoding: 'utf8', text: f.text, argv: [] } },
    { contract: { ...f.contract, runId: 'stale' }, task: { encoding: 'utf8', text: f.text } } ])
    assert.throws(() => api.readProviderTaskDocument(Buffer.from(JSON.stringify(document)), f.contract));
  assert.throws(() => api.readProviderTaskDocument(Buffer.from([0xff]), f.contract), /UTF-8/);
  const boundary = fixture('é'.repeat(api.MAX_PROVIDER_TASK_BYTES / 2));
  assert.deepEqual(api.readProviderTaskDocument(boundary.request, boundary.contract), Buffer.from(boundary.text));
  assert.throws(() => fixture('x'.repeat(api.MAX_PROVIDER_TASK_BYTES + 1)), /size/);
  assert.throws(() => api.consumeProviderExecutionPreparation(f.preparation, f.contract, Buffer.concat([f.request, Buffer.from(' ')]), {}, f.network), /substitution/);
  assert.deepEqual(api.describeProviderTaskTransport(f.preparation, f.contract), {
    encoding: 'utf8', bytes: Buffer.byteLength(f.text), taskDigest: f.contract.taskDigest,
    requestDigest: crypto.createHash('sha256').update(f.request).digest('hex'), shell: false,
    framing: 'EXACT_BYTES_THEN_EOF', backend: 'IMPLEMENTED_INERT_ONLY', execution: 'BLOCKED_WITHOUT_NETWORK_CAPABILITY'
  });
});
test('terminal text or exit never replaces structured durable result; secret-like content is refused', () => {
  api.assertNoProviderSecretContent({ checks: { credentialMode: 'PASS' } });
  for (const content of [{ checks: { api_key: 'PASS' } }, { diagnostic: 'Bearer abc' }, { text: '-----BEGIN PRIVATE KEY-----' }])
    assert.throws(() => api.assertNoProviderSecretContent(content), /refused/);
  const f = fixture();
  for (const value of ['PASS', 0, { ...f.contract, result: 'PASS' }])
    assert.throws(() => contracts.validateTaskResult(value, f.contract, { resultAlreadyExists: false }));
  assert.equal(contracts.classifyTerminal({ durableResult: 'ABSENT', processExitCode: 0, cleanup: 'VERIFIED_EMPTY' }).state, 'UNKNOWN');
});

test('result schema rejects stale, duplicate, conflicting and escaping declarations', () => {
  const f = fixture();
  const { candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint } = f.contract;
  const result = { schemaVersion: contracts.CODEX_WORKER_RESULT_SCHEMA_VERSION,
    candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint,
    result: 'PASS', checks: { mechanics: 'PASS' }, artifacts: [] };
  assert.equal(contracts.validateTaskResult(result, f.contract, { resultAlreadyExists: false }).result, 'PASS');
  for (const patch of [{ runId: 'stale' }, { checks: { mechanics: 'FAIL' } },
    { artifacts: [{ path: '../escape', sha256: 'a'.repeat(64) }] },
    { diagnostic: 'Bearer synthetic' }])
    assert.throws(() => contracts.validateTaskResult({ ...result, ...patch }, f.contract, { resultAlreadyExists: false }));
  assert.throws(() => contracts.validateTaskResult(result, f.contract, { resultAlreadyExists: true }), /Duplicate/);
});

test('execution evidence is immutable, non-secret and bound to the exact authorized run', () => {
  const f = fixture();
  const evidence = api.providerExecutionEvidence(f.preparation, f.contract);
  assert.equal(Object.isFrozen(evidence), true);
  for (const key of ['candidateId', 'taskId', 'runId', 'workerId', 'taskDigest'])
    assert.equal(evidence[key], f.contract[key]);
  assert.equal(evidence.scopeDigest, api.providerCredentialScopeDigest(f.contract));
  assert.equal(evidence.endpoint, 'https://provider.invalid');
  assert.equal(evidence.recordId, 'synthetic-record');
  assert.match(evidence.authorizationDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidence).includes(f.text), false);
  assert.throws(() => api.providerExecutionEvidence(f.preparation, { ...f.contract, runId: 'substituted-run' }), /scope|conflicting/);
  f.issuer.revoke(f.credential);
  assert.throws(() => api.providerExecutionEvidence(f.preparation, f.contract), /Revoked/);
});

test('synthetic provenance and network capabilities cannot be copied, substituted or upgraded to Human authority', () => {
  const f = fixture();
  const fresh = () => f.issuer.createSyntheticProvenance(f.contract, f.expiresAt);
  for (const provenance of [undefined, {}, { ...f.provenance }, api.createProviderExecutionIssuer().createSyntheticProvenance(f.contract, f.expiresAt)])
    assert.throws(() => f.issuer.mintCredential(f.contract, f.authorization, provenance), /Missing or forged/);
  assert.throws(() => f.issuer.mintCredential(f.contract, f.authorization, f.provenance), /provenance scope/);
  assert.throws(() => f.issuer.mintCredential(f.contract, { ...f.authorization, grantedBy: 'HUMAN' }, fresh()), /authorization scope/);
  const consume = network => api.consumeProviderExecutionPreparation(f.preparation, f.contract, f.request, {}, network);
  for (const network of [{}, { ...f.network }, fixture().network]) assert.throws(() => consume(network), /forged|Invalid/);
  const revoked = f.issuer.mintInertNetworkAuthority(f.preparation, f.contract, f.expiresAt);
  f.issuer.revokeNetworkAuthority(revoked);
  assert.throws(() => consume(revoked), /Invalid/);
  const expiry = Date.now() + 100;
  const expired = f.issuer.mintInertNetworkAuthority(f.preparation, f.contract, expiry);
  const now = Date.now;
  try { Date.now = () => expiry; assert.throws(() => consume(expired), /expired/); }
  finally { Date.now = now; }
  const evidence = api.providerExecutionEvidence(f.preparation, f.contract);
  const descriptor = api.describeProviderBackend(f.preparation, f.contract);
  assert.deepEqual(descriptor.args.slice(-2), ['exec', '-']);
  assert.ok(descriptor.args.indexOf('--ask-for-approval') < descriptor.args.indexOf('exec'));
  assert.ok(descriptor.args.includes('model_providers.munder.base_url="https://provider.invalid/v1"'));
  assert.equal(evidence.backendDescriptorDigest, crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'));
  const consumed = consume(f.network);
  assert.deepEqual(consumed.descriptor, descriptor);
  assert.equal(consumed.taskText, f.text);
  for (const value of [f.credential, f.provenance, f.network]) {
    assert.throws(() => JSON.stringify(value), error => !error.message.includes('INERT_NON_SECRET_CREDENTIAL') && /not serializable/.test(error.message));
  }
  assert.equal(JSON.stringify({ evidence, descriptor, consumed }).includes('INERT_NON_SECRET_CREDENTIAL'), false);
});

test('credential activation acquires once, exposes no material and disposes idempotently', () => {
  const f = fixture();
  const lease = api.acquireInertProviderCredential(f.preparation, f.contract);
  assert.equal(lease.disposition, 'INERT_NON_SECRET');
  assert.equal(lease.scopeDigest, api.providerCredentialScopeDigest(f.contract));
  assert.equal(lease.disposed, false);
  assert.equal(JSON.stringify(lease).includes('INERT_NON_SECRET_CREDENTIAL'), false);
  assert.throws(() => api.acquireInertProviderCredential(f.preparation, f.contract), /spent/);
  lease.dispose();
  assert.equal(lease.disposed, true);
  lease.dispose();
  assert.equal(lease.disposed, true);
  const revoked = fixture();
  const acquired = api.acquireInertProviderCredential(revoked.preparation, revoked.contract);
  revoked.issuer.revoke(revoked.credential);
  assert.equal(acquired.disposed, true);
});

test('expired and revoked preparations cannot acquire inert material', () => {
  const f = fixture();
  const now = Date.now;
  try {
    Date.now = () => f.expiresAt;
    assert.throws(() => api.acquireInertProviderCredential(f.preparation, f.contract), /expired/);
  } finally { Date.now = now; }
  const revoked = fixture();
  revoked.issuer.revoke(revoked.credential);
  assert.throws(() => api.acquireInertProviderCredential(revoked.preparation, revoked.contract), /Revoked/);
});

test('descriptor provenance and digest refuse copies, foreign identities and endpoint substitution', () => {
  const f = fixture();
  const evidence = api.providerExecutionEvidence(f.preparation, f.contract);
  const check = candidate => api.assertProviderBackendEvidence(f.preparation, f.contract, candidate);
  check(evidence);
  for (const candidate of [
    { ...evidence, backendDescriptor: { ...evidence.backendDescriptor } },
    { ...evidence, backendDescriptorDigest: '0'.repeat(64) },
    api.providerExecutionEvidence(fixture().preparation, f.contract),
    { ...evidence, endpoint: 'https://other.invalid' }
  ]) assert.throws(() => check(candidate), /substitution/);
  const issuer = api.createProviderExecutionIssuer();
  const authorization = { ...f.authorization, endpointOrigin: 'https://other.invalid' };
  const credential = issuer.mintCredential(f.contract, authorization,
    issuer.createSyntheticProvenance(f.contract, f.expiresAt));
  const preparation = issuer.prepare(f.contract, credential,
    issuer.mintTask(f.contract, f.request, f.expiresAt), authorization.endpointOrigin);
  assert.notEqual(api.providerExecutionEvidence(preparation, f.contract).backendDescriptorDigest,
    evidence.backendDescriptorDigest);
  for (const env of [{ HTTPS_PROXY: 'https://other.invalid' }, { OPENAI_API_KEY: 'inert' }])
    assert.throws(() => api.consumeProviderExecutionPreparation(f.preparation, f.contract, f.request, env, f.network), /environment refused/);
  api.assertProviderExecutionPreparation(f.preparation, f.contract);
});
