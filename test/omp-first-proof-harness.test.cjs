'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const h = loadTs('src/main/ompFirstProofHarness.ts');
const coreApi = loadTs('src/main/codexWorkerContract.ts');
const adapters = loadTs('src/main/runtimeAdapter.ts');
const access = loadTs('src/main/modelAccessAuthority.ts');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const repository = path.resolve(__dirname, '..');
const H = 'a'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
function request(server, authorization, body = JSON.stringify({ model: 'exact-model', input: 'synthetic' }), options = {}) {
  const target = new URL(server.origin);
  assert.equal(target.hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: Number(target.port), path: '/v1/responses', method: 'POST',
      agent: false, headers: { 'content-type': 'application/json', authorization }, ...options }, res => {
      const chunks = [];
      const finish = ended => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks), ended });
      res.on('data', chunk => chunks.push(chunk)); res.once('end', () => finish(true));
      res.once('aborted', () => finish(false)); res.on('error', () => finish(false));
    });
    req.setTimeout(3000, () => req.destroy(new Error('test request timed out')));
    req.on('error', reject); req.end(body);
  });
}
function descriptor(origin) {
  const core = coreApi.createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: H, sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) },
    syntheticRoot: path.join(repository, '.tmp', 'proof-model-fixture') });
  const route = access.createInertModelRoute(core, { endpoint: origin, trustClass: 'LOCAL_LOOPBACK', model: 'exact-model', expiresAt: Date.now() + 60000, evidenceId: 'route' });
  const adapter = adapters.describeInertRuntime('omp', core, { executablePath: path.join(repository, 'never-executed.exe'),
    executableSha256: H, version: '18.2.7' }, origin, route.model, 'high');
  return { core, route, adapter };
}
const success = { exitCode: 0, timedOut: false, httpStatus: 200, transportEnded: true,
  responseValid: true, explicitCompleted: true, usefulOutput: true, explicitIncomplete: false };

for (const fixture of h.RESPONSE_FIXTURES) test(`loopback Responses fixture and listener cleanup: ${fixture}`, async () => {
  const auth = h.createLocalAuthSentinel();
  const server = await h.startFakeResponsesServer(auth, fixture);
  try {
    const response = await request(server, auth.authorization());
    assert.equal(response.status, fixture === 'HTTP_ERROR' ? 503 : 200);
    if (fixture === 'PREMATURE_EOF') assert.equal(response.ended, false);
    if (fixture === 'NON_STREAMING_SUCCESS') {
      const parsed = JSON.parse(response.bytes); assert.equal(parsed.status, 'completed');
      assert.equal(parsed.output[0].content[0].text, 'provider-free fixture result');
    }
    if (fixture === 'STREAMING_SUCCESS') assert.match(response.bytes.toString(), /event: response.completed/);
    if (fixture === 'INCOMPLETE_COMPLETION') {
      assert.match(response.bytes.toString(), /event: response.incomplete/);
      assert.doesNotMatch(response.bytes.toString(), /event: response.completed/);
    }
    if (fixture === 'MALFORMED_RESPONSE') assert.throws(() => JSON.parse(response.bytes));
    const capture = server.snapshot();
    assert.equal(capture.requests[0].model, 'exact-model');
    assert.equal(capture.requests[0].auth.matched, true);
    assert.equal(capture.requests[0].auth.sha256, hash(auth.authorization()));
    assert.equal(JSON.stringify(capture).includes(auth.authorization()), false);
    // Exact request shape is captured: content type, raw body digest, bounded keys, absent stream.
    assert.equal(capture.requests[0].contentType, 'application/json');
    assert.equal(capture.requests[0].bodySha256, hash(Buffer.from(JSON.stringify({ model: 'exact-model', input: 'synthetic' }))));
    assert.deepEqual(capture.requests[0].topLevelKeys, ['input', 'model']);
    assert.equal(capture.requests[0].streamPresent, false);
    assert.equal(capture.requests[0].streamValue, null);
    assert.equal(capture.requests[0].accepted, true);
    const f = descriptor(server.origin);
    assert.equal(h.compareActualModelIdentity(f.route, f.adapter, capture.requests).classification, 'ACTUAL_MODEL_IDENTITY_MATCH');
  } finally {
    const first = await server.close(); assert.equal(first.closed, true); assert.equal(first.listening, false);
    assert.deepEqual(await server.close(), first);
    await assert.rejects(request(server, auth.authorization())); auth.destroy();
  }
});

test('server rejects wrong method/path/auth/body/count and never retains body or raw auth', async () => {
  const auth = h.createLocalAuthSentinel(), server = await h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS');
  try {
    assert.equal((await request(server, auth.authorization(), '', { method: 'GET' })).status, 404);
    assert.equal((await request(server, auth.authorization(), '', { path: '/other' })).status, 404);
    assert.equal((await request(server, 'Bearer not-the-sentinel')).status, 401);
    assert.equal((await request(server, auth.authorization(), '{')).status, 400);
    assert.equal((await request(server, auth.authorization(), 'x'.repeat(h.PROOF_LIMITS.bodyBytes + 1))).status, 413);
    for (let i = 0; i < 3; i++) assert.equal((await request(server, auth.authorization())).status, 200);
    assert.equal((await request(server, auth.authorization())).status, 429);
    assert.equal(server.snapshot().overflow, true);
    assert.equal(JSON.stringify(server.snapshot()).includes('not-the-sentinel'), false);
  } finally { await server.close(); auth.destroy(); }
  assert.throws(() => auth.authorization(), /destroyed/);
  await assert.rejects(h.startFakeResponsesServer(auth, 'INVALID'));
});

test('request evidence captures exact stream shape, body digest and bounded keys', async () => {
  const auth = h.createLocalAuthSentinel(), server = await h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS');
  try {
    const accept = async body => (await request(server, auth.authorization(), body)).status;
    assert.equal(await accept('{"model":"exact-model","stream":true}'), 200);
    assert.equal(await accept('{"model":"exact-model","stream":false}'), 200);
    assert.equal(await accept('{"model":"exact-model"}'), 200);
    // A present non-boolean `stream` is durably observed and then fails closed with HTTP 400.
    assert.equal(await accept('{"model":"exact-model","stream":"yes"}'), 400);
    assert.equal(await accept('{"model":"exact-model","stream":null}'), 400);
    assert.equal(await accept('{"model":"exact-model","stream":false,"input":"raw-prompt-text"}'), 200);
    const captures = server.snapshot().requests;
    const shape = capture => ({ json: capture.json, accepted: capture.accepted, model: capture.model,
      streamPresent: capture.streamPresent, streamValue: capture.streamValue, keys: capture.topLevelKeys });
    assert.deepEqual(captures.map(shape), [
      { json: 'VALID', accepted: true, model: 'exact-model', streamPresent: true, streamValue: true, keys: ['model', 'stream'] },
      { json: 'VALID', accepted: true, model: 'exact-model', streamPresent: true, streamValue: false, keys: ['model', 'stream'] },
      { json: 'VALID', accepted: true, model: 'exact-model', streamPresent: false, streamValue: null, keys: ['model'] },
      { json: 'VALID', accepted: false, model: 'exact-model', streamPresent: true, streamValue: null, keys: ['model', 'stream'] },
      { json: 'VALID', accepted: false, model: 'exact-model', streamPresent: true, streamValue: null, keys: ['model', 'stream'] },
      { json: 'VALID', accepted: true, model: 'exact-model', streamPresent: true, streamValue: false, keys: ['input', 'model', 'stream'] }
    ]);
    // The body digest binds the exact raw bytes sent, not the parsed value or its serialization.
    const sent = '{"model":"exact-model","stream":true}';
    assert.equal(captures[0].bodyBytes, Buffer.byteLength(sent));
    assert.equal(captures[0].bodySha256, hash(Buffer.from(sent)));
    assert.notEqual(captures[0].bodySha256, captures[2].bodySha256);
    assert.equal(captures.every(capture => capture.contentType === 'application/json'), true);
    // Only key names and digests are retained: never the raw body, prompt text or auth.
    const serialized = JSON.stringify(server.snapshot());
    assert.equal(serialized.includes('input'), true);
    assert.equal(serialized.includes('raw-prompt-text'), false);
    assert.equal(serialized.includes(auth.authorization()), false);
  } finally { await server.close(); auth.destroy(); }
});

test('request validation rejects mutated content type and unbounded or unsafe key sets', async () => {
  const auth = h.createLocalAuthSentinel(), server = await h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS');
  try {
    const headers = { 'content-type': 'text/plain', authorization: auth.authorization() };
    assert.equal((await request(server, auth.authorization(), '{"model":"exact-model"}', { headers })).status, 400);
    assert.equal((await request(server, auth.authorization(), '{"model":"exact-model"}',
      { headers: { 'content-type': 'application/json; charset=utf-8', authorization: auth.authorization() } })).status, 400);
    assert.equal(server.snapshot().requests.length, 0);
    // A secret-named or oversized top-level key is not admissible request-shape evidence.
    assert.equal((await request(server, auth.authorization(),
      '{"model":"exact-model","authorization":"Bearer raw"}')).status, 400);
    const many = { model: 'exact-model' };
    for (let i = 0; i <= h.PROOF_LIMITS.bodyTopLevelKeys; i++) many['k' + i] = 1;
    assert.equal((await request(server, auth.authorization(), JSON.stringify(many))).status, 400);
    assert.equal((await request(server, auth.authorization(),
      JSON.stringify({ model: 'exact-model', ['k'.repeat(h.PROOF_LIMITS.bodyKeyBytes + 1)]: 1 }))).status, 400);
    const refused = server.snapshot().requests;
    assert.equal(refused.every(capture => capture.accepted === false && capture.topLevelKeys.length === 0
      && capture.streamPresent === false && capture.streamValue === null), true);
    assert.equal(JSON.stringify(server.snapshot()).includes('Bearer raw'), false);
    assert.equal((await request(server, auth.authorization())).status, 200);
  } finally { await server.close(); auth.destroy(); }
});

test('oversized headers and occupied loopback port fail closed with listener cleanup', async () => {
  const auth = h.createLocalAuthSentinel(), server = await h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS');
  const occupiedPort = Number(new URL(server.origin).port);
  try {
    const port = Number(new URL(server.origin).port);
    await assert.rejects(h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS', port));
    await assert.rejects(request(server, auth.authorization(), '{}', { headers: {
      authorization: auth.authorization(), 'content-type': 'application/json', 'x-padding': 'x'.repeat(h.PROOF_LIMITS.headerBytes + 1) } }));
    assert.equal(server.snapshot().requests.length, 0);
  } finally { await server.close(); auth.destroy(); }
  const replacementAuth = h.createLocalAuthSentinel();
  const replacement = await h.startFakeResponsesServer(replacementAuth, 'NON_STREAMING_SUCCESS', occupiedPort);
  try { assert.equal((await request(replacement, replacementAuth.authorization())).status, 200); }
  finally { await replacement.close(); replacementAuth.destroy(); }
});

test('model identity compares exact route, models.yml, provider-qualified argv and actual HTTP model', () => {
  const f = descriptor('http://127.0.0.1:8317');
  const observation = model => [{ order: 1, method: 'POST', path: '/v1/responses', bodyBytes: 3,
    json: 'VALID', model, auth: { present: true, matched: true, sha256: H }, accepted: true }];
  assert.equal(h.compareActualModelIdentity(f.route, f.adapter, []).classification, 'ACTUAL_MODEL_IDENTITY_NOT_OBSERVED');
  assert.equal(h.compareActualModelIdentity(f.route, f.adapter, observation('other')).classification, 'ACTUAL_MODEL_IDENTITY_MISMATCH');
  const changed = clone(f.adapter); changed.config.isolation.modelsYaml = changed.config.isolation.modelsYaml.replace('exact-model', 'other');
  assert.equal(h.compareActualModelIdentity(f.route, changed, observation('exact-model')).classification, 'ACTUAL_MODEL_IDENTITY_MISMATCH');
  const duplicate = clone(f.adapter); duplicate.args.push('--model', 'cliproxyapi/exact-model');
  assert.throws(() => h.compareActualModelIdentity(f.route, duplicate, []), /Ambiguous/);
  const argvChanged = clone(f.adapter); argvChanged.args[argvChanged.args.indexOf('--model') + 1] = 'cliproxyapi/other';
  assert.equal(h.compareActualModelIdentity(f.route, argvChanged, observation('exact-model')).classification, 'ACTUAL_MODEL_IDENTITY_MISMATCH');
  assert.equal(h.compareActualModelIdentity(f.route, f.adapter, observation('cliproxyapi/exact-model')).classification, 'ACTUAL_MODEL_IDENTITY_MISMATCH');
});

test('generic NDJSON hashes every raw line before semantics and bounds invalid bytes', () => {
  const raw = Buffer.concat([Buffer.from('{"type":"unknown","event":"candidate"}\n\n'), Buffer.from([255, 10]), Buffer.from('{"type":"last"}')]);
  const evidence = h.observeNdjson(raw);
  assert.equal(evidence.sha256, hash(raw)); assert.equal(evidence.lines.length, 4);
  assert.deepEqual(evidence.lines.map(line => line.json), ['VALID', 'INVALID', 'INVALID', 'VALID']);
  assert.equal(evidence.lines[2].sha256, hash(Buffer.from([255, 10])));
  assert.equal(evidence.lines[3].terminated, false); assert.equal(evidence.historical, 'NOT_APPLICABLE');
  assert.equal(h.observeNdjson(Buffer.from('{"type":"a"}\n'), ['a']).historical, 'MATCH');
  assert.equal(h.observeNdjson(Buffer.from('{"type":"a"}'), ['a']).historical, 'MISMATCH');
  assert.equal(h.observeNdjson(Buffer.from('{"type":"b"}\n'), ['a']).historical, 'MISMATCH');
  assert.throws(() => h.observeNdjson(Buffer.alloc(h.PROOF_LIMITS.streamBytes + 1)));
  assert.throws(() => h.observeNdjson(Buffer.alloc(h.PROOF_LIMITS.lineBytes + 1)));
  assert.throws(() => h.observeNdjson(Buffer.from('\n'.repeat(h.PROOF_LIMITS.lines + 1))));
  assert.ok(Object.isFrozen(evidence.lines[0]));
  const unsafe = h.observeNdjson(Buffer.from('{"Bearer secret":"value","type":"event"}\n'));
  assert.deepEqual(unsafe.lines[0].topLevelKeys, []);
  assert.equal(unsafe.lines[0].json, 'INVALID');
  assert.equal(JSON.stringify(unsafe).includes('Bearer secret'), false);
});

test('completion exit alone never proves completion and required outcomes remain distinct', () => {
  assert.equal(h.classifyCompletion(success), 'COMPLETION_PROVEN');
  const cases = [
    [{ httpStatus: null, explicitCompleted: false }, 'PROCESS_EXIT_WITHOUT_TERMINAL_EVENT'],
    [{ explicitCompleted: false }, 'HTTP_COMPLETED_BUT_AGENT_COMPLETION_UNKNOWN'],
    [{ responseValid: false }, 'EVENT_SCHEMA_MISMATCH'],
    [{ timedOut: true }, 'SILENT_ABORT_OBSERVED'],
    [{ exitCode: 7 }, 'SILENT_ABORT_OBSERVED'],
    [{ transportEnded: false }, 'COMPLETION_NOT_PROVEN'],
    [{ explicitIncomplete: true }, 'COMPLETION_NOT_PROVEN'],
    [{ httpStatus: 503 }, 'COMPLETION_NOT_PROVEN'],
    [{ usefulOutput: false }, 'COMPLETION_NOT_PROVEN'],
    [{ explicitCompleted: true, explicitIncomplete: true }, 'COMPLETION_NOT_PROVEN'],
    [{ responseValid: false, timedOut: true }, 'SILENT_ABORT_OBSERVED'],
    [{ exitCode: null, httpStatus: null }, 'COMPLETION_NOT_PROVEN']
  ];
  for (const [patch, expected] of cases) assert.equal(h.classifyCompletion({ ...success, ...patch }), expected);
  assert.throws(() => h.classifyCompletion({ ...success, authorization: 'x' }));
});

test('one-shot chain rejects skipped states, replay, ticket substitution and foreign machine', () => {
  const machine = new h.OneShotProofStateMachine(H, H), other = new h.OneShotProofStateMachine(H, H);
  assert.throws(() => machine.prepare('OMP_STARTED'));
  for (const state of h.PROOF_STATES.slice(1)) {
    const ticket = machine.prepare(state);
    assert.throws(() => machine.advance({ ...ticket }, H, H));
    assert.throws(() => other.advance(ticket, H, H));
    assert.throws(() => machine.advance(ticket, 'b'.repeat(64), H));
    machine.advance(ticket, H, H);
    assert.throws(() => machine.advance(ticket, H, H));
  }
  assert.equal(machine.snapshot().state, 'CLEANUP_VERIFIED');
  assert.equal(machine.snapshot().transitions.filter(t => t.state === 'OMP_STARTED').length, 1);
  assert.throws(() => machine.prepare('OMP_STARTED'));
  assert.throws(() => machine.prepare(undefined));
});

test('binary inspection hashes repository file without executing and keeps version historical', async () => {
  const file = path.join(__dirname, 'fixtures', 'omp-proof-raw-child.cjs');
  const expected = fs.statSync(file).size;
  const identity = await h.inspectOmpBinaryIdentity(file, { expectedBytes: expected, expectedSha256: fileHash(file), semanticVersion: '18.2.7', versionSource: 'HISTORICAL' });
  assert.equal(identity.expected, 'MATCH'); assert.equal(identity.versionSource, 'HISTORICAL');
  assert.equal((await h.inspectOmpBinaryIdentity(file, { expectedBytes: expected + 1, expectedSha256: H })).expected, 'MISMATCH');
  assert.equal((await h.inspectOmpBinaryIdentity(file)).versionSource, 'UNKNOWN');
  await assert.rejects(h.inspectOmpBinaryIdentity(file, { semanticVersion: '18.2.7' }));
});

function nativeBackend(t) {
  assert.equal(process.platform, 'win32', 'native Job evidence is required; not a skipped PASS');
  fs.mkdirSync(path.join(repository, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(repository, '.tmp', 'omp-proof-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helperPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const scriptPath = path.join(repository, 'src/main/windowsOwnedPty.ps1');
  const nativeSourcePath = path.join(repository, 'src/main/windowsOwnedPty.cs');
  const helperEnv = { SystemRoot: process.env.SystemRoot,
    ComSpec: path.join(process.env.SystemRoot, 'System32/cmd.exe'), PATH: path.join(process.env.SystemRoot, 'System32'),
    HOME: root, USERPROFILE: root, TEMP: root, TMP: root, APPDATA: root, LOCALAPPDATA: root,
    POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off', PSModuleAnalysisCachePath: path.join(root, 'module-cache') };
  return { helperPath, helperSha256: fileHash(helperPath), scriptPath, scriptSha256: fileHash(scriptPath),
    nativeSourcePath, nativeSourceSha256: fileHash(nativeSourcePath), helperEnv, executableSha256: fileHash(process.execPath) };
}
function manifest(processEvidence, server, auth, f) {
  const preparation = {
    core: { taskId: 'task', runId: 'run', workerId: 'worker', repositoryId: 'repo', treeSha: 'c'.repeat(40) },
    adapter: { id: 'omp', version: '18.2.7', thinking: 'high' },
    semanticVersionDisposition: { value: '18.2.7', provenance: 'HISTORICAL_NOT_EXECUTED' },
    endpoint: server.origin, trust: 'LOCAL_LOOPBACK', cwd: f.adapter.cwd, environment: f.adapter.config.isolation.environment,
    modelsFile: { path: f.adapter.config.isolation.modelsFile, content: f.adapter.config.isolation.modelsYaml,
      bytes: Buffer.byteLength(f.adapter.config.isolation.modelsYaml), sha256: hash(f.adapter.config.isolation.modelsYaml), model: 'exact-model' },
    auth: { present: true, sha256: hash(auth.authorization()) },
    listener: { host: '127.0.0.1', port: Number(new URL(server.origin).port), fixture: server.fixture, bounds: h.PROOF_LIMITS },
    wfp: { status: 'PENDING_NOT_EXECUTED', ref: 'future-wfp-evidence', sha256: H },
    durableReservation: { status: 'FUTURE_NOT_CREATED', path: 'future-reservation', sha256: H, id: 'reservation' },
    admissionRef: { status: 'FUTURE_NOT_CREATED', ref: 'future-admission', sha256: H, id: 'admission' },
    historicalSequence: null
  };
  const m = { schema: 'OMP_FIRST_PROOF_PROVIDER_FREE_V1', mode: 'PROVIDER_FREE_SIMULATION_ONLY', candidateId: 'candidate',
    checkpoint: 'b'.repeat(40), taskSha256: H, configSha256: preparation.modelsFile.sha256,
    environmentSha256: hash(JSON.stringify(preparation.environment)), preparation,
    route: { model: f.route.model, scopeDigest: f.route.scopeDigest, evidenceId: f.route.evidenceId }, argv: f.adapter.args,
    binary: { path: f.adapter.executable.executablePath, bytes: 1, sha256: H, expected: 'NOT_SUPPLIED', semanticVersion: '18.2.7', versionSource: 'HISTORICAL' },
    boundary: { kind: 'TEST_LOOPBACK_ONLY', origin: server.origin, evidenceSha256: H },
    server, modelIdentity: h.compareActualModelIdentity(f.route, f.adapter, server.requests), process: processEvidence,
    ndjson: h.observeNdjson(Buffer.from(processEvidence.stdout.base64, 'base64')),
    completionInput: success, completion: 'COMPLETION_PROVEN', cleanup: { listenerClosed: true, childClosed: true, job: 'VERIFIED_EMPTY' } };
  m.bindingSha256 = h.proofBindingSha256(m);
  m.reservation = { kind: 'IN_MEMORY_SIMULATION', id: 'reservation', bindingSha256: m.bindingSha256 };
  m.admission = { kind: 'IN_MEMORY_SIMULATION', id: 'admission', bindingSha256: m.bindingSha256 };
  const state = new h.OneShotProofStateMachine(m.bindingSha256, H);
  for (const next of h.PROOF_STATES.slice(1)) state.advance(state.prepare(next), m.bindingSha256, H);
  m.states = state.snapshot(); return m;
}

for (const mode of ['SUCCESS', 'FAILURE', 'TIMEOUT', 'OVERFLOW']) test(`real owned Job raw-byte evidence: ${mode}`, { timeout: 45000 }, async t => {
  // Synthetic ambient values must not reach either the fixture or its Node initialization.
  const ambient = { MUNDER_PROOF_AMBIENT: 'must-not-inherit', OPENAI_API_KEY: 'synthetic-not-a-credential',
    NODE_OPTIONS: '--require=must-not-load-proof-ambient-module' };
  for (const [key, value] of Object.entries(ambient)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const result = await h.runRepositoryFakeChild(mode, nativeBackend(t), 5000);
  assert.equal(result.jobBinding, 'SAME_OWNED_LAUNCH');
  assert.equal(result.jobReceipt.rootPid, result.pid); assert.equal(result.jobReceipt.rootJobMember, true);
  assert.equal(result.jobReceipt.cleanupState, 'VERIFIED_EMPTY'); assert.equal(result.jobReceipt.activeProcessesFinal, 0);
  assert.equal(result.jobReceipt.ioDrained, true); assert.equal(result.jobReceipt.pseudoConsoleClosed, false);
  assert.equal(result.stdinClosed, true); assert.equal(result.closed, true);
  const kinds = result.events.map(event => event.kind);
  assert.equal(kinds[0], 'STARTED');
  assert.equal(kinds.filter(kind => kind === 'STDIN_WRITTEN').length, 1);
  assert.equal(kinds.filter(kind => kind === 'STDIN_CLOSED').length, 1);
  assert.ok(kinds.indexOf('STDIN_WRITTEN') < kinds.indexOf('STDIN_CLOSED'));
  assert.ok(kinds.indexOf('STDIN_CLOSED') < kinds.indexOf('EXIT'));
  assert.equal(kinds.at(-1), 'CLOSE');
  assert.deepEqual(Buffer.from(result.stderr.base64, 'base64'), Buffer.from([255, 0, 69, 82, 82, 10]));
  assert.equal(result.stderr.sha256, hash(Buffer.from([255, 0, 69, 82, 82, 10])));
  assert.equal(result.stdin.sha256, hash(Buffer.from([0, 255, 13, 10, 65])));
  if (mode === 'FAILURE') assert.equal(result.exitCode, 7);
  if (mode === 'TIMEOUT') assert.equal(result.timedOut, true);
  if (mode === 'OVERFLOW') { assert.equal(result.overflow, true); assert.equal(result.stdout.bytes, h.PROOF_LIMITS.streamBytes); }
  if (mode !== 'SUCCESS') return;
  assert.equal(result.exitCode, 0);
  const output = Buffer.from(result.stdout.base64, 'base64');
  assert.equal(result.stdout.sha256, hash(output));
  const records = output.toString().trim().split('\n').map(JSON.parse);
  assert.equal(records[0].sha256, result.stdin.sha256); assert.equal(records[1].type, 'fixture_completed');
  const auth = h.createLocalAuthSentinel(), server = await h.startFakeResponsesServer(auth, 'NON_STREAMING_SUCCESS');
  try {
    await request(server, auth.authorization()); const stopped = await server.close();
    const m = manifest(result, stopped, auth, descriptor(server.origin));
    const frozen = h.freezeProofManifest(m); assert.ok(Object.isFrozen(frozen.preparation.modelsFile));
    const mutate = change => { const copy = clone(m); copy.process = result; change(copy); return copy; };
    for (const change of [
      x => { x.authorization = 'forbidden'; }, x => { delete x.taskSha256; }, x => { x.argv.push('--model', 'other'); },
      x => { x.modelIdentity.requestModels[0] = 'substitution'; }, x => { x.preparation.environment.HOME = 'other'; },
      x => { x.server.requests[0].auth.sha256 = 'b'.repeat(64); }, x => { x.states.transitions[5].state = 'PREPARED'; },
      x => { x.ndjson.lines[0].sha256 = 'b'.repeat(64); }, x => { x.cleanup.listenerClosed = false; },
      x => { x.preparation.modelsFile.content += ' '; }, x => { x.preparation.durableReservation.status = 'CREATED'; },
      x => { x.preparation.semanticVersionDisposition.provenance = 'PE_METADATA'; },
      x => { x.server.rejected = 1; }, x => { x.preparation.historicalSequence = false; },
      x => { x.route.model = 'x'.repeat(129); }, x => { x.preparation.auth.raw = auth.authorization(); },
      x => { x.server.requests[0].contentType = 'text/plain'; }, x => { delete x.server.requests[0].contentType; },
      x => { x.server.requests[0].bodySha256 = 'b'.repeat(64); }, x => { x.server.requests[0].bodySha256 = null; },
      x => { x.server.requests[0].topLevelKeys = ['model', 'input']; },
      x => { x.server.requests[0].topLevelKeys = ['input', 'model', 'stream']; },
      x => { x.server.requests[0].topLevelKeys = ['model', 'model']; },
      x => { x.server.requests[0].streamPresent = true; },
      x => { x.server.requests[0].streamValue = true; },
      x => { x.server.requests[0].model = 'other-model'; },
      x => { x.server.requests[0].accepted = false; },
      x => { x.server.requests[0].json = 'INVALID'; },
      x => { x.server.requests[0].authorization = auth.authorization(); }
    ]) assert.throws(() => h.freezeProofManifest(mutate(change)));
    assert.throws(() => h.freezeProofManifest(clone(m)), /Receipt binding/);
  } finally { await server.close(); auth.destroy(); }
});

test('RAW_PIPE preserves merged decoded onData alongside exact separated bytes', { timeout: 45000 }, async t => {
  const { launchOwnedPty } = loadTs('src/main/windowsOwnedPty.ts');
  const backend = nativeBackend(t), raw = { stdout: [], stderr: [] }, decoded = [], acknowledgments = [];
  let owner;
  owner = launchOwnedPty({ ...backend, executablePath: process.execPath,
    args: [path.join(repository, 'test/fixtures/omp-proof-raw-child.cjs'), 'SUCCESS'],
    cwd: repository, env: { SystemRoot: backend.helperEnv.SystemRoot }, securityContext: 'CURRENT_PROCESS', ioMode: 'RAW_PIPE',
    cols: 80, rows: 24, timeoutMs: 5000, cleanupMs: 2000 }, {
    onStarted() { owner.input(Buffer.from([0, 255, 13, 10, 65])); owner.closeInput(); },
    onInput(kind, bytes) { acknowledgments.push([kind, bytes]); },
    onRawData(stream, bytes) { assert.ok(stream in raw); raw[stream].push(Buffer.from(bytes)); bytes.fill(0); },
    onData(text) { decoded.push(text); }, onExit() {}
  });
  const receipt = await owner.completion;
  assert.equal(receipt.reason, 'exit'); assert.equal(receipt.rootExit, 0);
  assert.equal(receipt.cleanupState, 'VERIFIED_EMPTY'); assert.equal(receipt.ioDrained, true);
  assert.deepEqual(acknowledgments, [['written', 5], ['closed', 0]]);
  assert.deepEqual(Buffer.concat(raw.stderr), Buffer.from([255, 0, 69, 82, 82, 10]));
  assert.match(Buffer.concat(raw.stdout).toString('utf8'), /"type":"fixture_completed"/);
  assert.ok(decoded.join('').includes('\ufffd\0ERR\n'));
  assert.match(decoded.join(''), /"type":"fixture_completed"/);
});
