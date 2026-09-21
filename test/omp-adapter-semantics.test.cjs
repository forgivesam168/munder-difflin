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
    '--model', 'cliproxyapi/exact-model', '--thinking', 'high', '--approval-mode', 'yolo', '--max-time', '60s',
    '--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp']);
  for (const thinking of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto']) {
    const descriptor = adapters.describeInertRuntime('omp', f.core, f.executable, f.route.endpoint, f.route.model, thinking, 1);
    assert.equal(descriptor.args[9], thinking);
    assert.equal(descriptor.args[13], '1s');
    assert.deepEqual(descriptor.args.slice(14), adapters.OMP_DISCOVERY_DISABLE_FLAGS);
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
    for (const p of [...Object.values(isolation.environment), ...isolation.externalHomes, isolation.modelsFile]
      .map(value => coreApi.isPathWithin(value, f.core.rootPolicy.root) ? value : path.join(isolation.environment.HOME, value)))
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
// Provider-free preparation/admission representation: no launch, no filesystem read, no provider.
function preparation(f, patch = {}, workspacePatch = {}) {
  const isolation = f.adapter.config.isolation;
  const workspace = { root: f.adapter.cwd, created: true, standalone: true, linkFree: true, canonical: true,
    regularDirectory: true, repositoryRoot: f.core.rootPolicy.projectDir,
    humanAmbientRoots: [path.join(path.dirname(f.core.rootPolicy.root), 'human-home')], ambientRootsComplete: true,
    approvedFixtureNames: ['input.txt'], entries: ['input.txt'] };
  return { environment: { inheritEnvironment: false, environment: { ...isolation.environment } },
    ...patch, workspace: { ...workspace, ...(patch.workspace ?? {}), ...workspacePatch } };
}
test('OMP preparation requires the exact minimal synthetic environment and both distinct config variables', () => {
  const f = fixture(); const isolation = f.adapter.config.isolation;
  assert.equal(isolation.environment.PI_CODING_AGENT_DIR, f.core.rootPolicy.configDir);
  assert.equal(isolation.environment.PI_CONFIG_DIR, '.pi-config');
  assert.notEqual(isolation.environment.PI_CONFIG_DIR, isolation.environment.PI_CODING_AGENT_DIR);
  assert.equal(coreApi.isCanonicalAbsolutePath(isolation.environment.PI_CODING_AGENT_DIR), true);
  assert.equal(coreApi.isCanonicalAbsolutePath(isolation.environment.PI_CONFIG_DIR), false);
  assert.equal(coreApi.isPathWithin(isolation.environment.PI_CODING_AGENT_DIR, f.core.rootPolicy.root), true);
  assert.equal(adapters.resolveOmpConfigRoot(f.core, isolation.environment.PI_CONFIG_DIR),
    path.join(f.core.rootPolicy.homeDir, '.pi-config'));
  assert.equal(coreApi.isPathWithin(adapters.resolveOmpConfigRoot(f.core, isolation.environment.PI_CONFIG_DIR), f.core.rootPolicy.root), true);
  assert.deepEqual(isolation.environmentSemantics, adapters.OMP_ENVIRONMENT_VARIABLE_SEMANTICS);
  assert.equal(isolation.environmentSemantics.PI_CONFIG_DIR, 'SYNTHETIC_RELATIVE_CONFIG_ROOT_NAME');
  assert.equal(isolation.environmentSemantics.PI_CODING_AGENT_DIR, 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY');
  assert.equal(isolation.configRootName, adapters.OMP_CONFIG_ROOT_NAME);
  const admitted = adapters.admitOmpPreparation(f.core, f.adapter, preparation(f));
  assert.equal(admitted.schema, 'OMP_PREPARATION_ADMISSION');
  assert.equal(admitted.admission, 'PREPARATION_ONLY_NO_LAUNCH');
  assert.equal(admitted.execution, 'NOT_RUN');
  assert.equal(admitted.network, 'NOT_AUTHORIZED');
  assert.equal(admitted.credentials, 'NONE');
  assert.equal(admitted.workspaceRoot, f.adapter.cwd);
  assert.deepEqual(admitted.approvedFixtureNames, ['input.txt']);
  assert.deepEqual(admitted.environment, isolation.environment);
  adapters.assertOmpPreparationAdmission(f.core, f.adapter, admitted, preparation(f));
});
test('OMP preparation rejects escaped, absolute, aliased or substituted config roots and environments', () => {
  const f = fixture(); const isolation = f.adapter.config.isolation;
  for (const name of ['..', '../home', '.', 'a/b', 'a\\b', 'C:\\absolute', '/abs', '', '.pi-config/..', 'a'.repeat(200)])
    assert.throws(() => adapters.resolveOmpConfigRoot(f.core, name));
  for (const envPatch of [{ PI_CONFIG_DIR: '..' }, { PI_CONFIG_DIR: 'C:\\host' }, { PI_CONFIG_DIR: isolation.environment.PI_CODING_AGENT_DIR },
    { PI_CODING_AGENT_DIR: isolation.environment.PI_CONFIG_DIR }, { PI_CODING_AGENT_DIR: 'C:\\host\\config' },
    { HOME: 'C:\\host' }, { PI_CONFIG_DIR: 'other-dir' }]) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, { environment: {
      inheritEnvironment: false, environment: { ...isolation.environment, ...envPatch } } })));
  }
  for (const patch of [{ environment: { ...preparation(f).environment, inheritEnvironment: true } },
    { environment: { ...preparation(f).environment, extra: true } },
    { environment: { inheritEnvironment: false, environment: { ...isolation.environment, EXTRA: 'x' } } },
    { workspace: { extra: true } }]) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, patch)));
  }
  assert.equal(adapters.admitOmpPreparation(f.core, f.adapter, preparation(f)).execution, 'NOT_RUN');
});
test('OMP preparation rejects dirty, ambient-rooted and non-standalone workspaces but accepts an approved fixture', () => {
  const f = fixture(); const admitted = adapters.admitOmpPreparation(f.core, f.adapter, preparation(f));
  for (const workspacePatch of [{ created: false }, { standalone: false }, { linkFree: false }, { canonical: false },
    { regularDirectory: false }, { root: f.core.rootPolicy.root }, { root: path.dirname(f.core.rootPolicy.root) },
    { root: f.core.rootPolicy.homeDir }, { root: 'C:\\host' }]) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, workspacePatch)));
  }
  // A workspace merely existing is not cleanliness: an ancestor repository and a workspace that
  // contains its repository all fail. Ambient-root overlap is covered by its own test below.
  for (const workspacePatch of [{ repositoryRoot: f.adapter.cwd }, { repositoryRoot: f.core.rootPolicy.root }]) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, workspacePatch)));
  }
  // Every Human-listed ambient entry is refused, and unknown non-fixture entries are refused.
  for (const entry of ['.git', '.omp', '.claude', '.codex', '.gemini', '.env', '.env.local', '.env.anything',
    'mcp.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'plugins', 'unlisted.txt']) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { entries: [entry] })),
      /fixture|Forbidden/);
  }
  for (const name of ['.git', '.omp', '.codex', '.gemini', '.env', 'mcp.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'plugins'])
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { approvedFixtureNames: [name] })));
  // An approved fixture is accepted, and re-admission of the minted representation holds.
  assert.deepEqual(adapters.admitOmpPreparation(f.core, f.adapter, preparation(f)).approvedFixtureNames, ['input.txt']);
  adapters.assertOmpPreparationAdmission(f.core, f.adapter, admitted, preparation(f));
});
test('OMP preparation admission rejects isolation, adapter, workspace and replay substitution', () => {
  const f = fixture(); const observation = preparation(f);
  const admitted = adapters.admitOmpPreparation(f.core, f.adapter, observation);
  const isolation = f.adapter.config.isolation;
  const substitutes = [{ ...f.adapter, cwd: 'C:\\host' }, { ...f.adapter, coreDigest: 'e'.repeat(64) },
    { ...f.adapter, config: { ...f.adapter.config, root: 'C:\\host' } },
    { ...f.adapter, config: { ...f.adapter.config, environmentKey: 'CODEX_HOME' } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation, configRootName: '.other' } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation, modelsFile: 'C:\\host\\models.yml' } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation,
      environment: { ...isolation.environment, PI_CONFIG_DIR: 'other-root' } } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation,
      environment: { ...isolation.environment, PI_CODING_AGENT_DIR: isolation.environment.PI_CONFIG_DIR } } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation, inheritEnvironment: true } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation,
      discoveryDisableFlags: isolation.discoveryDisableFlags.slice(1) } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation,
      externalHomes: isolation.externalHomes.slice(1) } } },
    { ...f.adapter, config: { ...f.adapter.config, isolation: { ...isolation, hostConfig: 'ALLOW' } } }];
  for (const adapter of substitutes)
    assert.throws(() => adapters.admitOmpPreparation(f.core, adapter, observation), /substitution|refused/);
  const otherCore = coreApi.createCoreRuntimeContract({ ...f.core, runId: 'other', syntheticRoot: f.core.rootPolicy.root });
  assert.throws(() => adapters.admitOmpPreparation(otherCore, f.adapter, observation), /substitution|refused/);
  for (const patch of [{ workspaceRoot: 'C:\\host' }, { adapterDigest: 'e'.repeat(64) }, { execution: 'RUN' },
    { network: 'AUTHORIZED' }, { credentials: 'HOST' }, { admission: 'LAUNCHED' }, { version: 2 },
    { approvedFixtureNames: ['input.txt', 'other.txt'] },
    { discoveryDisableFlags: admitted.discoveryDisableFlags.slice(0, 4) },
    { environment: { ...admitted.environment, PI_CONFIG_DIR: 'other' } },
    { environmentKeys: admitted.environmentKeys.slice(0, 5) }, { extra: true }]) {
    assert.throws(() => adapters.assertOmpPreparationAdmission(f.core, f.adapter, { ...admitted, ...patch }, observation),
      /substitution|schema/);
  }
  const missing = { ...admitted }; delete missing.workspaceRoot;
  assert.throws(() => adapters.assertOmpPreparationAdmission(f.core, f.adapter, missing, observation), /schema/);
  // A clean admission is not a launch capability: it still carries no authority.
  adapters.assertOmpPreparationAdmission(f.core, f.adapter, admitted, observation);
  assert.equal(admitted.execution, 'NOT_RUN');
  assert.equal(admitted.network, 'NOT_AUTHORIZED');
});
test('OMP discovery flags appear exactly once in deterministic order and never carry task text', () => {
  const f = fixture();
  const flags = ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp'];
  assert.deepEqual(adapters.OMP_DISCOVERY_DISABLE_FLAGS, flags);
  for (const flag of flags) assert.equal(f.adapter.args.filter(arg => arg === flag).length, 1);
  assert.deepEqual(f.adapter.args.slice(-flags.length), flags);
  assert.equal(f.adapter.config.isolation.discoveryDisableFlags.some(flag => f.adapter.args.indexOf(flag) < 0), false);
  assert.equal(f.adapter.config.isolation.discoveryDisableCompleteness, 'CLAIMED_UNAUDITED_REAL_CONFORMANCE_UNKNOWN');
  assert.equal(f.adapter.taskDelivery, 'RAW_PIPE_EXACT_BYTES_THEN_EOF');
  // Task bytes travel outside argv; the descriptor exposes no task field at all.
  assert.equal('task' in f.adapter, false);
  assert.equal(f.adapter.args.some(arg => /task|prompt/i.test(arg)), false);
  assert.deepEqual(adapters.codexBackendArgv(f.route.endpoint, f.route.model).slice(-2), ['exec', '-']);
});
test('OMP preparation ambient-root completeness is fail-closed and only genuine workspace overlap is rejected', () => {
  const f = fixture(); const isolation = f.adapter.config.isolation;
  // Every synthetic external home must stand outside the workspace even when it is not re-listed.
  for (const external of isolation.externalHomes) {
    assert.equal(coreApi.isPathWithin(f.adapter.cwd, external), false);
    assert.equal(coreApi.isPathWithin(external, f.adapter.cwd), false);
  }
  assert.equal(coreApi.isPathWithin(f.adapter.cwd, f.core.rootPolicy.homeDir), false);
  // Missing or false completeness attestation is refused.
  assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { ambientRootsComplete: false })), /complete/);
  const incomplete = preparation(f); delete incomplete.workspace.ambientRootsComplete;
  assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, incomplete), /schema/);
  // The caller must supply at least one canonical Human ambient root: an empty list is refused.
  assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { humanAmbientRoots: [] })), /at least one/);
  for (const roots of [['relative/ambient'], ['C:\\host\\..\\other'], ['']])
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { humanAmbientRoots: roots })),
      /canonical and absolute/);
  // An explicitly supplied Human ambient root overlapping the workspace is rejected exactly when it
  // is equal to, an ancestor of, or a descendant of the workspace, mirroring isSymmetricWithin.
  for (const roots of [[f.adapter.cwd], [f.core.rootPolicy.root], [path.dirname(f.core.rootPolicy.root)],
    [path.join(f.adapter.cwd, 'nested')]]) {
    assert.throws(() => adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { humanAmbientRoots: roots })),
      /outside every Human ambient root/);
  }
  // The synthetic HOME and its `.claude` sibling are disjoint from the workspace (checked above for
  // every external home as well), so supplying them merely re-declares already-enforced roots and is
  // accepted rather than rejected; only genuine equality/ancestor/descendant overlap is refused.
  for (const roots of [[f.core.rootPolicy.homeDir], [path.join(f.core.rootPolicy.homeDir, '.claude')],
    [f.core.rootPolicy.homeDir, path.join(f.core.rootPolicy.homeDir, '.claude')]]) {
    assert.equal(coreApi.isPathWithin(f.adapter.cwd, roots[0]), false);
    assert.equal(coreApi.isPathWithin(roots[0], f.adapter.cwd), false);
    assert.notEqual(f.adapter.cwd, roots[0]);
    adapters.admitOmpPreparation(f.core, f.adapter, preparation(f, {}, { humanAmbientRoots: roots }));
  }
  // A disjoint, canonical Human ambient root list is accepted; cleanliness is only ever the
  // caller-attested evidence, never discovered here.
  const admitted = adapters.admitOmpPreparation(f.core, f.adapter, preparation(f));
  adapters.assertOmpPreparationAdmission(f.core, f.adapter, admitted, preparation(f));
  assert.equal(admitted.execution, 'NOT_RUN');
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
