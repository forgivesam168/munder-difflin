'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const coreApi = loadTs('src/main/codexWorkerContract.ts');
const adapters = loadTs('src/main/runtimeAdapter.ts');
const inspector = loadTs('src/main/ompPreparationInspector.ts');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** Records every filesystem read the inspector could route content or directory enumeration
 * through, so a test can assert that a stand-in's contents were never requested and that no
 * directory beneath a rejected ancestor was opened. Restored even when `run` throws. */
function watchInspectionReads(run) {
  const contents = []; const opened = [];
  const read = fs.readFileSync; const open = fs.opendirSync;
  fs.readFileSync = function (target, ...rest) { contents.push(String(target)); return read.call(this, target, ...rest); };
  fs.opendirSync = function (target, ...rest) { opened.push(String(target)); return open.call(this, target, ...rest); };
  try { run(); } finally { fs.readFileSync = read; fs.opendirSync = open; }
  return { contents, opened };
}
/** A Uint8Array-compatible byte source that records the element/`length`/`valueOf` access any
 * Buffer.from-style copy performs. Validation alone never reads those, so a recorded touch is
 * observable proof that a private byte snapshot was taken; a plain Buffer records nothing. */
function watchedBytes(bytes, name) {
  const touches = [];
  const proxy = new Proxy(bytes, {
    get(target, key) {
      if (typeof key === 'string' && (/^(?:0|[1-9][0-9]*)$/.test(key) || key === 'length' || key === 'valueOf')) touches.push(key);
      return Reflect.get(target, key, target);
    }
  });
  return { fixture: { name, bytes: proxy }, touches };
}
// Main may pin an authorized, discovery-clean temporary base. On Windows use the
// repository volume root, not os.tmpdir(), which normally inherits Human home.
// Never bypass production ancestor checks or retry elsewhere after a refusal.
function within(parent, child) {
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const relative = path.relative(fold(parent), fold(child));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function fixture(t) {
  const actualRepository = fs.realpathSync.native(path.resolve(__dirname, '..'));
  const actualHome = fs.realpathSync.native(os.homedir());
  const parent = fs.realpathSync.native(process.env.OMP_PREPARATION_TEST_BASE
    || (process.platform === 'win32' ? path.parse(actualRepository).root : os.tmpdir()));
  for (const ambient of [actualRepository, actualHome]) {
    assert.equal(within(ambient, parent), false, 'PREPARATION_BASE_UNAVAILABLE: test base is inside repository or Human home');
  }
  const created = fs.mkdtempSync(path.join(parent, 'omp-preparation-test-'));
  t.after(() => fs.rmSync(created, { recursive: true, force: true }));
  // Preserve native canonical casing (including the generated suffix) for the
  // inspector's exact realpath checks; cleanup retains only our exclusive path.
  const owned = fs.realpathSync.native(created);
  for (const ambient of [actualRepository, actualHome]) {
    assert.equal(within(ambient, owned) || within(owned, ambient), false,
      'PREPARATION_BASE_UNAVAILABLE: test root overlaps repository or Human home');
  }
  const base = path.join(owned, 'base'); const repository = path.join(owned, 'repository'); const home = path.join(owned, 'human');
  for (const dir of [base, repository, home]) fs.mkdirSync(dir);
  const core = coreApi.createCoreRuntimeContract({ candidateId: 'candidate', taskId: 'task', runId: 'run', workerId: 'worker',
    taskDigest: 'a'.repeat(64), sourceCheckpoint: { repositoryId: 'repo', commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) },
    syntheticRoot: path.join(base, 'synthetic') });
  const executable = { executablePath: path.join(owned, 'omp.exe'), version: '18.2.7', executableSha256: 'd'.repeat(64) };
  const adapter = adapters.describeInertRuntime('omp', core, executable, 'http://localhost:8317', 'exact-model', 'high');
  const input = { core, adapter, preparationBase: base, repositoryRoot: repository, humanHomeRoot: home };
  return { owned, base, repository, home, core, adapter, input,
    prepare: () => inspector.inspectOmpPreparation(input),
    admit: handle => adapters.admitInspectedOmpPreparation(core, adapter, handle) };
}
function deepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) deepFrozen(child);
}
test('fresh exact Core-derived tree, models bytes and bounded no-authority evidence', t => {
  const f = fixture(t); const handle = f.prepare(); const admission = f.admit(handle); const e = admission.evidence;
  const p = f.core.rootPolicy;
  const expectedDirs = [p.root, ...p.allowedDirectories, path.join(p.homeDir, '.pi-config')];
  assert.deepEqual(e.tree.map(item => item.root).sort(), expectedDirs.sort());
  for (const item of e.tree) assert.deepEqual(item.entries, fs.readdirSync(item.root).sort());
  assert.deepEqual(fs.readdirSync(p.root).sort(), p.allowedDirectories.map(dir => path.basename(dir)).sort());
  assert.deepEqual(fs.readdirSync(p.configDir), ['models.yml']);
  assert.deepEqual(fs.readdirSync(p.homeDir), ['.pi-config']);
  assert.deepEqual(e.workspaceEntries, []);
  const bytes = fs.readFileSync(f.adapter.config.isolation.modelsFile);
  assert.deepEqual(bytes, Buffer.from(f.adapter.config.isolation.modelsYaml));
  assert.equal(e.modelsSha256, sha(bytes));
  assert.equal(e.ambientRootSet, 'OMP_18_2_7_FIRST_PROOF_AMBIENT_ROOT_SET');
  assert.deepEqual(e.ambientRoots.map(item => item.root), [f.home, f.repository,
    ...['.omp', '.claude', '.codex', '.gemini'].map(name => path.join(f.home, name))]);
  assert.equal(e.ancestors[0].root, p.workDir);
  assert.equal(e.ancestors.at(-1).root, path.parse(p.root).root);
  assert.equal(e.resolvedPiConfigDir, path.join(p.homeDir, '.pi-config'));
  assert.equal(e.piCodingAgentDir, p.configDir);
  assert.equal(admission.execution, 'NOT_RUN'); assert.equal(admission.network, 'NOT_AUTHORIZED');
  assert.equal(admission.credentials, 'NONE'); assert.equal(admission.authority, 'PREPARATION_EVIDENCE_ONLY');
  assert.equal(e.ATTEMPT_LEDGER_ACL, 'BLOCKED_BY_SAME_WINDOWS_PRINCIPAL');
  assert.equal(e.toctouAndUnobservableReparsePoints, 'UNKNOWN');
  deepFrozen(admission);
  assert.equal(f.admit(handle).evidenceDigest, admission.evidenceDigest);
});
test('pre-existing root is refused without repair or deletion', t => {
  const f = fixture(t); fs.mkdirSync(f.core.rootPolicy.root);
  const marker = path.join(f.core.rootPolicy.root, 'preserve.txt'); fs.writeFileSync(marker, 'human stand-in');
  assert.throws(f.prepare, /EEXIST/); assert.equal(fs.readFileSync(marker, 'utf8'), 'human stand-in');
});
test('approved fixture binds exact binary bytes and later modification is rejected', t => {
  const f = fixture(t); const bytes = Buffer.from([0, 255, 13, 10, 65]);
  f.input.fixtures = [{ name: 'input.bin', bytes }];
  const h = f.prepare(); const e = f.admit(h).evidence;
  assert.deepEqual(e.fixtures, [{ name: 'input.bin', sha256: sha(bytes) }]);
  assert.deepEqual(e.workspaceEntries, ['input.bin']);
  bytes.fill(7); // The issuer owns its byte snapshot, not this mutable caller buffer.
  assert.equal(f.admit(h).evidenceDigest, e.digest);
  fs.writeFileSync(path.join(f.core.rootPolicy.workDir, 'input.bin'), Buffer.alloc(5, 8));
  assert.throws(() => f.admit(h), /bytes\/hash mismatch/);
});
for (const name of ['unapproved.txt', '.git', '.omp', 'MCP.JSON', 'aGeNtS.Md', '.ENV.secret', 'plugins',
  '.agent', '.agents', '.AGENTS']) {
  test(`real workspace enumeration refuses ${name}`, t => {
    const f = fixture(t); const h = f.prepare(); fs.writeFileSync(path.join(f.core.rootPolicy.workDir, name), 'inert');
    assert.throws(() => f.admit(h), /Discovery-sensitive|Unexpected synthetic/);
  });
}
for (const name of ['extra.', 'extra ']) {
  test(`real trailing alias ${JSON.stringify(name)} is fail-closed`, t => {
    const f = fixture(t); const h = f.prepare(); const target = path.join(f.core.rootPolicy.workDir, name);
    try { fs.writeFileSync(target, 'inert'); }
    catch (error) {
      // Some filesystems refuse this spelling themselves. Prove no alias was materialized;
      // fixture admission must still reject the requested noncanonical spelling.
      assert.ok(['EINVAL', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code));
      assert.deepEqual(fs.readdirSync(f.core.rootPolicy.workDir), []);
      f.input.fixtures = [{ name, bytes: Buffer.from('x') }];
      assert.throws(f.prepare, /Invalid approved fixture name/);
      return;
    }
    assert.throws(() => f.admit(h), /Unexpected synthetic/);
  });
}
for (const name of [1, null, {}, ['safe.txt'], { toString() { throw new Error('coercion must not happen'); } },
  'CON', 'nul.txt', 'COM1.dat', 'LPT9', 'input.', 'input ', '../escape', 'a\\b', 'a/b', 'MCP.JSON', '.env', 'AGENTS.md']) {
  test(`invalid fixture input ${typeof name === 'string' ? name : typeof name}`, t => {
    const f = fixture(t); f.input.fixtures = [{ name, bytes: Buffer.from('inert') }];
    assert.throws(f.prepare, /Invalid approved fixture name/);
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  });
}
test('aggregate approved fixture bytes are refused before any synthetic root effect', t => {
  const f = fixture(t);
  // One shared 1 MiB buffer: the aggregate gate must reject the count, not the per-fixture size.
  const shared = Buffer.alloc(1024 * 1024, 7);
  const sources = Array.from({ length: 17 }, (_, index) => watchedBytes(shared, `part-${index}.bin`));
  f.input.fixtures = sources.map(entry => entry.fixture);
  assert.throws(f.prepare, /Approved fixture byte budget exceeded/);
  // Whole-list acceptance precedes copying: no accepted request means no source byte was ever read,
  // so no private snapshot could have been materialized from the rejected list.
  assert.deepEqual(sources.flatMap(entry => entry.touches), []);
  assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  assert.deepEqual(fs.readdirSync(f.base), []);
});
test('duplicate case-folded fixtures are rejected before effects', t => {
  const f = fixture(t); f.input.fixtures = ['input.txt', 'INPUT.TXT'].map(name => ({ name, bytes: Buffer.from('x') }));
  assert.throws(f.prepare, /Duplicate/); assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
});
for (const field of ['repositoryRoot', 'humanHomeRoot']) {
  test(`${field} overlap refuses creation`, t => {
    const f = fixture(t); f.input[field] = f.base;
    assert.throws(f.prepare, /PREPARATION_BASE_UNAVAILABLE/);
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  });
}
test('preparation base beneath Human home is refused before synthetic creation', t => {
  const f = fixture(t);
  // Use an owned stand-in, never create or enumerate fixtures in the real Human home.
  f.input.humanHomeRoot = f.owned;
  assert.throws(f.prepare, /PREPARATION_BASE_UNAVAILABLE/);
  assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  assert.deepEqual(fs.readdirSync(f.base), []);
});
test('discovery-sensitive exact ancestor is rejected without reading sibling contents', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.base, '.claude'));
  fs.writeFileSync(path.join(f.base, '.claude', 'secret-stand-in'), 'never read');
  assert.throws(f.prepare, /Discovery-sensitive ancestor/);
  assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
});
test('ancestor discovery case and trailing aliases are rejected', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.base, 'PLUGINS'));
  assert.throws(f.prepare, /Discovery-sensitive ancestor/);
});
for (const name of ['.agent', '.agents']) {
  test(`real ancestor ${name} is rejected`, t => {
    const f = fixture(t); fs.mkdirSync(path.join(f.base, name));
    assert.throws(f.prepare, /Discovery-sensitive ancestor/);
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  });
}
// The ancestor classifier folds with win32 semantics on every host, so `.AGENT`/`.Agent`/
// `.AGENTS`/`.Agents` are the same discovery-sensitive ancestor as `.agent`/`.agents`.
for (const name of ['.AGENT', '.Agent', '.AGENTS', '.Agents']) {
  test(`real ancestor Windows case variant ${name} is rejected`, t => {
    const f = fixture(t); fs.mkdirSync(path.join(f.base, name));
    assert.throws(f.prepare, /Discovery-sensitive ancestor/);
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  });
}
test('ancestor trailing-dot and trailing-space spellings are fail-closed where the filesystem permits', t => {
  for (const name of ['.agent.', '.agent ']) {
    const f = fixture(t);
    try { fs.mkdirSync(path.join(f.base, name)); }
    catch (error) {
      // The host refuses the spelling itself. Prove no alias was materialized and that the
      // requested spelling still cannot slip an ancestor past classification.
      assert.ok(['EINVAL', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code));
      assert.deepEqual(fs.readdirSync(f.base), []);
      continue;
    }
    assert.throws(f.prepare, /Discovery-sensitive ancestor/);
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  }
});
test('ancestor lookalike files: forbidden names rejected by name, harmless stand-ins tolerated', t => {
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'mcp.json', '.mcp.json', 'plugins']) {
    const f = fixture(t);
    const standin = path.join(f.base, name);
    fs.writeFileSync(standin, 'never read');
    const observed = watchInspectionReads(() => assert.throws(f.prepare, /Discovery-sensitive ancestor/));
    assert.deepEqual(observed.contents, [], `stand-in ${name} content must never be read`);
    assert.equal(fs.readFileSync(standin, 'utf8'), 'never read');
    assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
  }
  for (const name of ['SYSTEM.md', 'SYSTEM_TEMPLATE.md', 'agent.md', 'agents.txt']) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.base, name), 'harmless stand-in');
    const handle = f.prepare(); // a lookalike name is not a discovery-sensitive ancestor
    assert.equal(fs.existsSync(f.core.rootPolicy.root), true);
    assert.equal(f.admit(handle).evidence.ancestors[0].root, f.core.rootPolicy.workDir);
  }
});
test('forbidden ancestor stand-in contents are never read, while a clean ancestor path still succeeds', t => {
  const f = fixture(t);
  const forbiddenDir = path.join(f.base, '.agents');
  fs.mkdirSync(forbiddenDir);
  const standins = [path.join(forbiddenDir, 'AGENTS.md'), path.join(forbiddenDir, 'SYSTEM.md'),
    path.join(forbiddenDir, 'SYSTEM_TEMPLATE.md'), path.join(f.base, 'SYSTEM.md'), path.join(f.base, 'SYSTEM_TEMPLATE.md')];
  for (const standin of standins) fs.writeFileSync(standin, 'never read');
  // Rejection comes from the ancestor's entry NAME: the forbidden directory is never opened and no
  // stand-in content is read, by recursive descent or otherwise.
  const observed = watchInspectionReads(() => assert.throws(f.prepare, /Discovery-sensitive ancestor/));
  assert.deepEqual(observed.contents, []);
  assert.ok(!observed.opened.some(target => target.startsWith(forbiddenDir)), `forbidden ancestor must not be enumerated: ${observed.opened}`);
  for (const standin of standins) assert.equal(fs.readFileSync(standin, 'utf8'), 'never read');
  fs.rmSync(forbiddenDir, { recursive: true, force: true });
  // The identical request now runs to completion: the refusal came from the ancestor entry name,
  // and the harmless sibling stand-ins are neither forbidden nor read.
  const handle = f.prepare();
  assert.equal(fs.existsSync(f.core.rootPolicy.root), true);
  assert.equal(f.admit(handle).evidence.ancestors[0].root, f.core.rootPolicy.workDir);
});
test('accepted fixtures still take private snapshots after whole-list acceptance', t => {
  const f = fixture(t); const bytes = Buffer.from([1, 2, 3, 4]);
  const watched = watchedBytes(bytes, 'input.bin');
  f.input.fixtures = [watched.fixture];
  const handle = f.prepare();
  // Acceptance precedes copying: validation alone never reads an element byte, so an element read
  // here is observable proof that the accepted fixture was privately snapshotted.
  assert.ok(watched.touches.includes('0'), `accepted fixture bytes must be read for the private snapshot: ${watched.touches}`);
  assert.deepEqual(f.admit(handle).evidence.fixtures, [{ name: 'input.bin', sha256: sha(bytes) }]);
  bytes.fill(9);
  assert.equal(f.admit(handle).evidence.fixtures[0].sha256, sha(Buffer.from([1, 2, 3, 4])));
});
test('directory junction or symlink replacement is refused without touching its target', t => {
  const f = fixture(t); const h = f.prepare(); const target = path.join(f.owned, 'link-target'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  fs.rmdirSync(f.core.rootPolicy.workDir);
  fs.symlinkSync(target, f.core.rootPolicy.workDir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.admit(h), /redirected|wrong-type/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});
test('linked preparation base is refused before root creation', t => {
  const f = fixture(t); const target = path.join(f.owned, 'base-target'); fs.mkdirSync(target); fs.rmdirSync(f.base);
  fs.symlinkSync(target, f.base, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(f.prepare, /redirected|wrong-type/); assert.deepEqual(fs.readdirSync(target), []);
});
test('wrong type, extra config and models modifications fail reinspection', t => {
  const f = fixture(t); const h = f.prepare();
  const models = f.adapter.config.isolation.modelsFile; const original = fs.readFileSync(models);
  fs.writeFileSync(models, Buffer.alloc(original.length, 32));
  assert.throws(() => f.admit(h), /bytes\/hash mismatch/);
  fs.writeFileSync(models, original);
  const extra = path.join(f.core.rootPolicy.configDir, 'config.yml'); fs.writeFileSync(extra, 'inert');
  assert.throws(() => f.admit(h), /Unexpected synthetic/); fs.unlinkSync(extra);
  fs.unlinkSync(models); fs.mkdirSync(models);
  assert.throws(() => f.admit(h), /wrong-type/);
});
test('forged, copied, JSON-roundtripped and foreign handles cannot cross Main admission', t => {
  const f = fixture(t); const h = f.prepare(); const admission = f.admit(h);
  for (const fake of [{}, { ...h }, JSON.parse(JSON.stringify(h)), admission.evidence, { ...admission.evidence }, null]) {
    assert.throws(() => f.admit(fake), /Foreign or forged/);
  }
  // A separate module instance has its own issuer WeakMap, even for identical source/evidence.
  const loaderPath = require.resolve('./load-ts.cjs'); const previous = require.cache[loaderPath];
  delete require.cache[loaderPath];
  try {
    const foreignLoader = require('./load-ts.cjs');
    const foreignAdapters = foreignLoader('src/main/runtimeAdapter.ts');
    assert.throws(() => foreignAdapters.admitInspectedOmpPreparation(f.core, f.adapter, h), /Foreign or forged/);
  } finally { require.cache[loaderPath] = previous; }
});
test('Core, adapter, environment, model and discovery substitutions are rejected', t => {
  const f = fixture(t); const h = f.prepare();
  const copy = () => JSON.parse(JSON.stringify(f.adapter));
  const mutations = [a => { a.executable.executableSha256 = 'e'.repeat(64); },
    a => { a.config.isolation.environment.HOME = f.home; }, a => { a.config.isolation.environment.EXTRA = 'x'; },
    a => { a.config.isolation.modelsFile = path.join(f.home, 'models.yml'); },
    a => { a.config.isolation.modelsYaml += ' '; }, a => { a.config.isolation.discoveryDisableFlags.pop(); },
    a => { a.args.pop(); }, a => { a.network = 'AUTHORIZED'; }];
  for (const mutate of mutations) {
    const a = copy(); mutate(a);
    assert.throws(() => adapters.admitInspectedOmpPreparation(f.core, a, h), /substitution|Authority/);
  }
  const other = coreApi.createCoreRuntimeContract({ ...f.core, taskId: 'different', syntheticRoot: f.core.rootPolicy.root });
  assert.throws(() => adapters.admitInspectedOmpPreparation(other, f.adapter, h), /substitution/);
  const changedRoot = { ...f.core, rootPolicy: { ...f.core.rootPolicy, workDir: f.home } };
  assert.throws(() => inspector.inspectOmpPreparation({ ...f.input, core: changedRoot }), /Core substitution/);
});
test('models destination substitution cannot write outside the synthetic tree', t => {
  const f = fixture(t); const adapter = JSON.parse(JSON.stringify(f.adapter));
  const target = path.join(f.home, 'models.yml'); adapter.config.isolation.modelsFile = target;
  assert.throws(() => inspector.inspectOmpPreparation({ ...f.input, adapter }), /substitution/);
  assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
});
test('models hardlink redirection is rejected', t => {
  const f = fixture(t); const h = f.prepare();
  const models = f.adapter.config.isolation.modelsFile;
  fs.linkSync(models, path.join(f.owned, 'models-alias'));
  assert.throws(() => f.admit(h), /redirected|wrong-type/);
});
test('Codex descriptor remains inert and cannot mint OMP evidence', t => {
  const f = fixture(t);
  const codex = adapters.describeInertRuntime('codex', f.core, f.adapter.executable,
    'http://localhost:8317', 'exact-model');
  assert.equal(codex.config.environmentKey, 'CODEX_HOME');
  assert.equal(codex.config.isolation, undefined);
  assert.equal(codex.session, 'FRESH_EXEC');
  assert.equal(codex.network, 'NOT_AUTHORIZED');
  assert.deepEqual(codex.args, adapters.codexBackendArgv('http://localhost:8317', 'exact-model'));
  assert.throws(() => inspector.inspectOmpPreparation({ ...f.input, adapter: codex }), /OMP isolation required/);
  assert.equal(fs.existsSync(f.core.rootPolicy.root), false);
});
