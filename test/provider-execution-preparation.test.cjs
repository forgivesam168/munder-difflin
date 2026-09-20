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
  const authorization = { recordId: 'synthetic-human-record', grantedBy: 'HUMAN', purpose: 'PROVIDER_EXECUTION',
    scopeDigest: api.providerCredentialScopeDigest(contract), endpointOrigin: 'https://provider.invalid', expiresAt };
  const credential = issuer.mintCredential(contract, authorization);
  const task = issuer.mintTask(contract, request, expiresAt);
  const preparation = issuer.prepare(contract, credential, task, 'https://provider.invalid');
  return { text, contract, request, issuer, credential, task, preparation, expiresAt };
}
test('opaque authority refuses copies, revocation, expiry and once-only spent replay before unavailable backend', () => {
  const f = fixture();
  assert.throws(() => JSON.stringify(f.preparation), /not serializable/);
  assert.throws(() => JSON.stringify(f.credential), /not serializable/);
  for (const value of [undefined, {}, { ...f.preparation }])
    assert.throws(() => api.assertProviderExecutionPreparation(value, f.contract), /Missing or forged/);
  assert.throws(() => f.issuer.prepare(f.contract, { ...f.credential }, f.task, 'https://provider.invalid'), /Foreign/);
  assert.throws(() => f.issuer.mintCredential(f.contract, {
    recordId: 'synthetic', grantedBy: 'HUMAN', purpose: 'PROVIDER_EXECUTION',
    scopeDigest: '0'.repeat(64), endpointOrigin: 'https://provider.invalid', expiresAt: f.expiresAt
  }), /authorization scope/);
  assert.throws(() => f.issuer.prepare(f.contract, f.credential, f.task, 'https://other.invalid'), /authorization scope/);
  const now = Date.now;
  try {
    Date.now = () => f.expiresAt;
    assert.throws(() => api.assertProviderExecutionPreparation(f.preparation, f.contract), /expired/);
  } finally { Date.now = now; }
  f.issuer.revoke(f.credential);
  assert.throws(() => api.consumeProviderExecutionPreparation(f.preparation, f.contract, f.request, {}), /Revoked/);
  const live = fixture();
  // First trusted launch-consumption attempt reproves request/endpoint/environment, then
  // spends credential and task authority immediately before the deliberate backend refusal.
  assert.throws(() => api.consumeProviderExecutionPreparation(live.preparation, live.contract, live.request, {}), /BLOCKED_BACKEND_REQUIREMENT/);
  // The consumed attempt is now spent: replay fails on spent authority, before backend enforcement.
  assert.throws(() => api.consumeProviderExecutionPreparation(live.preparation, live.contract, live.request, {}), /Revoked, spent or conflicting preparation authority/);
  assert.throws(() => api.assertProviderExecutionPreparation(live.preparation, live.contract), /Revoked, spent or conflicting preparation authority/);
});
test('endpoint guards reject canonicalization ambiguity, redirects, alternate origins and proxy overrides', () => {
  for (const origin of ['http://provider.invalid', 'https://PROVIDER.invalid', 'https://provider.invalid:443',
    'https://provider.invalid/', 'https://user@provider.invalid', 'https://provider.invalid/path'])
    assert.throws(() => api.prepareProviderEndpoint(origin));
  const policy = api.prepareProviderEndpoint('https://provider.invalid:8443');
  assert.equal(api.prepareProviderEndpoint('https://provider.invalid').port, 443);
  assert.equal(policy.configurationBackend, 'NOT_IMPLEMENTED');
  assert.equal(policy.execution, 'BLOCKED_BACKEND_REQUIREMENT');
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
  assert.throws(() => fixture('x'.repeat(api.MAX_PROVIDER_TASK_BYTES + 1)), /size/);
  assert.throws(() => api.consumeProviderExecutionPreparation(f.preparation, f.contract, Buffer.concat([f.request, Buffer.from(' ')]), {}), /substitution/);
  assert.deepEqual(api.describeProviderTaskTransport(f.preparation, f.contract), {
    encoding: 'utf8', bytes: Buffer.byteLength(f.text), taskDigest: f.contract.taskDigest,
    requestDigest: crypto.createHash('sha256').update(f.request).digest('hex'), shell: false,
    framing: 'EXACT_BYTES_THEN_EOF', backend: 'NOT_IMPLEMENTED', execution: 'BLOCKED_BACKEND_REQUIREMENT'
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
