'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const coreApi = loadTs('src/main/codexWorkerContract.ts');
const adapters = loadTs('src/main/runtimeAdapter.ts');
const access = loadTs('src/main/modelAccessAuthority.ts');
const parser = loadTs('src/main/ompCompletion.ts');
function fixture(root = 'C:\\fixture\\omp', patch = {}, routePatch = {}, adapterId = 'omp') {
  const core = coreApi.createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: 'a'.repeat(64), sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) },
    syntheticRoot: root, ...patch });
  const route = access.createInertModelRoute(core, { endpoint: 'http://localhost:8317', trustClass: 'LOCAL_LOOPBACK',
    model: 'exact-model', expiresAt: Date.now() + 60000, evidenceId: 'route-evidence', ...routePatch });
  const executable = { executablePath: `C:\\approved\\${adapterId}.exe`, version: 'fixture', executableSha256: 'd'.repeat(64) };
  const adapter = adapters.describeInertRuntime(adapterId, core, executable, route.endpoint, route.model, adapterId === 'omp' ? 'high' : undefined);
  const { candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint } = core;
  const result = { schemaVersion: 1, candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint,
    result: 'PASS', checks: { fixture: 'PASS' }, artifacts: [] };
  return { core, route, adapter, executable, result };
}
function records(result) {
  return [{ type: 'message_start', message: { role: 'assistant' } },
    { type: 'message_update', delta: 'not authoritative' },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(result) }], stopReason: 'stop' } },
    { type: 'turn_end', stopReason: 'stop' }, { type: 'agent_end', stopReason: 'stop' }];
}
const ndjson = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
test('OMP exact argv, finite bound and exact thinking never include task bytes', () => {
  const f = fixture();
  assert.deepEqual(f.adapter.args, ['--print', '--mode', 'json', '--no-session', '--cwd', f.core.rootPolicy.workDir,
    '--model', 'cliproxyapi/exact-model', '--thinking', 'high', '--approval-mode', 'yolo', '--max-time', '60s']);
  for (const thinking of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto']) {
    const descriptor = adapters.describeInertRuntime('omp', f.core, f.executable, f.route.endpoint, f.route.model, thinking, 1);
    assert.equal(descriptor.args[9], thinking);
    assert.equal(descriptor.args.at(-1), '1s');
  }
  for (const thinking of [undefined, null, 'HIGH', 'unknown', 'high --yolo', 'toString'])
    assert.throws(() => adapters.describeInertRuntime('omp', f.core, f.executable, f.route.endpoint, f.route.model, thinking));
  for (const bound of [0, -1, 1.5, 3601, NaN, Infinity, '60'])
    assert.throws(() => adapters.describeInertRuntime('omp', f.core, f.executable, f.route.endpoint, f.route.model, 'high', bound));
  assert.equal(f.adapter.taskDelivery, 'RAW_PIPE_EXACT_BYTES_THEN_EOF');
  assert.equal(f.adapter.session, 'EPHEMERAL_IN_MEMORY');
  assert.equal(f.adapter.approval, 'YOLO_TOOL_POLICIES_STILL_APPLY');
});
test('synthetic environment and inert models representation have no ambient or credential fallback', () => {
  for (const [trustClass, endpoint] of [['LOCAL_LOOPBACK', 'http://localhost:8317'], ['REMOTE_TLS', 'https://route.invalid']]) {
    const f = fixture(undefined, {}, { trustClass, endpoint });
    const isolation = f.adapter.config.isolation;
    assert.equal(isolation.inheritEnvironment, false);
    assert.equal(isolation.environment.HOME, isolation.environment.USERPROFILE);
    for (const p of [...Object.values(isolation.environment), ...isolation.externalHomes, isolation.modelsFile])
      assert.equal(coreApi.isPathWithin(p, f.core.rootPolicy.root), true);
    assert.equal(isolation.ambientCredentials, 'DENY');
    assert.equal(isolation.discovery, 'DENY_REQUIRED_BEFORE_FIRST_REAL_PROOF');
    assert.deepEqual(JSON.parse(isolation.modelsYaml), { providers: { cliproxyapi: {
      baseUrl: endpoint + '/v1', api: 'openai-responses', models: [{ id: f.route.model }]
    } } });
    const issuer = access.createInertModelAccessIssuer(); const handle = issuer.mint(f.core, f.adapter, f.route);
    assert.throws(() => issuer.consume(handle, f.core, { ...f.adapter, config: { ...f.adapter.config,
      isolation: { ...isolation, environment: { ...isolation.environment, HOME: 'C:\\host' } } } }, f.route));
    assert.equal(issuer.consume(handle, f.core, f.adapter, f.route).network, 'NOT_AUTHORIZED');
    assert.equal(f.route.endpointPolicy.trustClass, trustClass);
  }
});
test('fixture lifecycle mints only parser-local once-only identity-bound completion', () => {
  const f = fixture(); const recognizer = parser.createOmpFixtureCompletionRecognizer(f.core);
  const handle = recognizer.recognize(ndjson(records(f.result)));
  assert.throws(() => JSON.stringify(handle));
  assert.throws(() => recognizer.consume({ ...handle }, f.core));
  assert.throws(() => parser.createOmpFixtureCompletionRecognizer(f.core).consume(handle, f.core));
  assert.throws(() => recognizer.consume(handle, fixture(undefined, { runId: 'other' }).core));
  assert.deepEqual(recognizer.consume(handle, f.core), f.result);
  assert.throws(() => recognizer.consume(handle, f.core));
  assert.throws(() => recognizer.recognize(ndjson(records(f.result))));
});
test('raw output, malformed or partial lifecycle, aborts and trailing records cannot complete', () => {
  const f = fixture(); const good = records(f.result);
  const cases = ['PASS\n', '0\n', '{}\n', '{\n', ndjson(good).trimEnd(), ndjson(good.slice(0, -1)),
    ndjson([good[1]]), ndjson([good[0], good[1], good[3], good[4]]), ndjson([...good, good[4]]),
    ndjson([...good, { type: 'unknown_terminal' }]), ndjson([good[0], good[2], good[4], good[3]])];
  for (const index of [2, 3, 4]) for (const stopReason of ['error', 'aborted', 'toolUse', undefined]) {
    const changed = structuredClone(good);
    if (index === 2) changed[index].message.stopReason = stopReason; else changed[index].stopReason = stopReason;
    cases.push(ndjson(changed));
  }
  for (const text of ['PASS', 'before ' + JSON.stringify(f.result), JSON.stringify(f.result) + ' after']) {
    const changed = structuredClone(good); changed[2].message.content[0].text = text; cases.push(ndjson(changed));
  }
  for (const stream of cases) {
    const recognizer = parser.createOmpFixtureCompletionRecognizer(f.core);
    assert.throws(() => recognizer.recognize(stream));
    assert.throws(() => recognizer.recognize(ndjson(good)), /already attempted/);
  }
});
test('every Core identity field and strict result shape are checked', () => {
  const f = fixture();
  for (const patch of [{ candidateId: 'other' }, { taskId: 'other' }, { runId: 'other' }, { workerId: 'other' },
    { taskDigest: 'e'.repeat(64) }, { sourceCheckpoint: { ...f.result.sourceCheckpoint, commitSha: 'e'.repeat(40) } },
    { extra: true }, { result: 'PASS', checks: { fixture: 'FAIL' } }])
    assert.throws(() => parser.createOmpFixtureCompletionRecognizer(f.core).recognize(ndjson(records({ ...f.result, ...patch }))));
});
// Main executes these repository-local filesystem fixtures only after candidate freeze.
function withStore(body) {
  const base = fs.mkdtempSync(path.join(process.cwd(), '.omp-reservation-test-'));
  try {
    const root = path.join(base, 'worker'); const evidence = path.join(base, 'evidence');
    fs.mkdirSync(root); fs.mkdirSync(evidence);
    body(root, evidence);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
test('exclusive receipt survives store recreation and reload without rewriting historical bytes', () => withStore((root, evidence) => {
  const f = fixture(root); const store = access.createDurableAttemptReservationStore(evidence);
  const handle = store.reserve(f.core, f.adapter, f.route, 'human-attempt-1');
  const [name] = fs.readdirSync(evidence); const receiptPath = path.join(evidence, name);
  const before = fs.readFileSync(receiptPath); const receipt = JSON.parse(before);
  assert.equal(receipt.coreScopeDigest, adapters.coreScopeDigest(f.core));
  assert.deepEqual(receipt.executable, f.executable);
  assert.deepEqual(receipt.route, { trustClass: f.route.trustClass, endpoint: f.route.endpoint, model: f.route.model });
  for (const key of ['candidateId', 'taskId', 'runId', 'workerId', 'taskDigest', 'sourceCheckpoint']) assert.deepEqual(receipt[key], f.core[key]);
  assert.equal(receipt.humanAuthorizationEvidenceId, 'human-attempt-1');
  assert.equal(receipt.expiresAt, f.route.expiresAt);
  assert.equal(receipt.attemptBound, 1);
  assert.equal(receipt.consumption, 'RESERVATION_CONSUMES_ATTEMPT_INCLUDING_FAILURE_TIMEOUT_OR_CRASH');
  delete require.cache[require.resolve('./load-ts.cjs')];
  const freshAccess = require('./load-ts.cjs')('src/main/modelAccessAuthority.ts');
  for (const api of [access, freshAccess]) {
    const recreated = api.createDurableAttemptReservationStore(evidence);
    assert.throws(() => recreated.reserve(f.core, f.adapter, f.route, 'human-attempt-1'), /EEXIST/);
    assert.throws(() => recreated.consume(handle, f.core, f.adapter, f.route), /foreign/);
  }
  assert.equal(store.consume(handle, f.core, f.adapter, f.route).authority, 'RESERVATION_ONLY');
  assert.throws(() => store.consume(handle, f.core, f.adapter, f.route));
  assert.deepEqual(fs.readFileSync(receiptPath), before);
}));
test('same Human reservation cannot be reset with coherent adapter, route, model or run substitutions', () => withStore((root, evidence) => {
  const f = fixture(root); const store = access.createDurableAttemptReservationStore(evidence);
  const handle = store.reserve(f.core, f.adapter, f.route, 'human-once');
  const alternatives = [fixture(root, { runId: 'other' }), fixture(root, {}, { model: 'other' }),
    fixture(root, {}, { endpoint: 'https://other.invalid', trustClass: 'REMOTE_TLS' }), fixture(root, {}, {}, 'codex')];
  for (const other of alternatives) {
    assert.throws(() => store.consume(handle, other.core, other.adapter, other.route), /substitution/);
    assert.throws(() => access.createDurableAttemptReservationStore(evidence).reserve(other.core, other.adapter, other.route, 'human-once'), /EEXIST/);
  }
  assert.throws(() => store.reserve(f.core, f.adapter, f.route, 'new-human-same-attempt'), /EEXIST/);
  const next = fixture(root, { runId: 'new-attempt' });
  const nextHandle = store.reserve(next.core, next.adapter, next.route, 'new-human-new-attempt');
  assert.equal(store.consume(nextHandle, next.core, next.adapter, next.route).authority, 'RESERVATION_ONLY');
  assert.equal(store.consume(handle, f.core, f.adapter, f.route).network, 'NOT_AUTHORIZED');
}));
test('worker-contained, relative and redirected reservation directories are rejected', () => withStore((root, evidence) => {
  const f = fixture(root);
  assert.throws(() => access.createDurableAttemptReservationStore('.'));
  assert.throws(() => access.createDurableAttemptReservationStore(root).reserve(f.core, f.adapter, f.route, 'human'));
  const inside = path.join(root, 'evidence'); fs.mkdirSync(inside);
  assert.throws(() => access.createDurableAttemptReservationStore(inside).reserve(f.core, f.adapter, f.route, 'human'));
  const alias = path.join(path.dirname(root), 'alias');
  fs.symlinkSync(evidence, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => access.createDurableAttemptReservationStore(alias));
}));
test('partial reservation and unconsumed timeout consume the same durable attempt', () => withStore((root, evidence) => {
  const f = fixture(root);
  const store = access.createDurableAttemptReservationStore(evidence);
  store.reserve(f.core, f.adapter, f.route, 'timed-out');
  // Model a crash-damaged historical receipt, not an API-authorized rewrite.
  const receiptPath = path.join(evidence, fs.readdirSync(evidence).find(name => name.startsWith('omp-attempt-')));
  fs.truncateSync(receiptPath, 0);
  assert.throws(() => access.createDurableAttemptReservationStore(evidence).reserve(f.core, f.adapter, f.route, 'timed-out'), /EEXIST/);
  assert.equal(fs.statSync(receiptPath).size, 0);
}));
