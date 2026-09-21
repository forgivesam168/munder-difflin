import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createCoreRuntimeContract, type CoreRuntimeContract } from './codexWorkerContract';
import { coreScopeDigest, describeInertRuntime, isForbiddenOmpDiscoveryEntry, resolveOmpConfigRoot,
  type InertRuntimeDescriptor } from './runtimeAdapter';

/** Process-local provenance only, not durable authority or a launch capability. */
declare const preparationBrand: unique symbol;
export interface OmpPreparationHandle { readonly [preparationBrand]: true }
export interface OmpPreparationFixture { readonly name: string; readonly bytes: Uint8Array }
export interface OmpPreparationInput {
  readonly core: CoreRuntimeContract;
  readonly adapter: InertRuntimeDescriptor;
  readonly preparationBase: string;
  readonly repositoryRoot: string;
  readonly humanHomeRoot: string;
  readonly fixtures?: readonly OmpPreparationFixture[];
}
const MAX_ENTRIES = 4096;
const MAX_ANCESTORS = 128;
const MAX_FIXTURE_BYTES = 1024 * 1024;
/** Aggregate ceiling on the caller-supplied fixture snapshot, checked before any filesystem
 * effect so an accepted request can never force a multi-gigabyte private copy. */
const MAX_TOTAL_FIXTURE_BYTES = 16 * 1024 * 1024;
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Noncanonical evidence value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function digest(value: unknown): string { return hash(Buffer.from(canonical(value))); }
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function alias(name: string): boolean {
  return !name || name === '.' || name === '..' || /[. ]$|[<>:"/\\|?*\x00-\x1f]/.test(name)
    || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name);
}
function forbidden(name: string): boolean {
  return isForbiddenOmpDiscoveryEntry(name.replace(/[. ]+$/, ''), 'win32');
}
function assertPath(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
    || path.startsWith('\\\\') || path.slice(parse(path).root.length).split(sep).some(alias)) {
    // Filesystem roots themselves have no basename to validate.
    if (typeof path === 'string' && !path.startsWith('\\\\') && path === parse(path).root && isAbsolute(path)) return;
    throw new Error('Noncanonical preparation path');
  }
}
function metadata(path: string, type: 'directory' | 'file'): void {
  assertPath(path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (type === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || realpathSync.native(path) !== path) throw new Error(`Noncanonical, redirected or wrong-type path: ${path}`);
}
function chain(path: string): string[] {
  const result: string[] = [];
  for (;;) {
    if (result.length >= MAX_ANCESTORS) throw new Error('Ancestor observation bound exceeded');
    metadata(path, 'directory'); result.push(path);
    const parent = dirname(path); if (parent === path) return result;
    path = parent;
  }
}
function entries(path: string): string[] {
  metadata(path, 'directory');
  const directory = opendirSync(path); const names: string[] = [];
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (names.length >= MAX_ENTRIES) throw new Error('Directory observation bound exceeded');
      names.push(entry.name);
    }
  } finally { directory.closeSync(); }
  metadata(path, 'directory');
  return names.sort();
}
function overlap(a: string, b: string): boolean {
  const fold = (s: string) => process.platform === 'win32' ? s.toLowerCase() : s;
  const within = (x: string, y: string) => { const r = relative(fold(x), fold(y)); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
  return within(a, b) || within(b, a);
}
function ancestors(path: string) {
  return chain(path).map(root => {
    const relevantEntries = entries(root).filter(name => forbidden(name));
    if (relevantEntries.length) throw new Error(`Discovery-sensitive ancestor: ${root}`);
    return { root, relevantEntries };
  });
}
function ambient(home: string, repository: string) {
  chain(home); chain(repository);
  return [home, repository, ...['.omp', '.claude', '.codex', '.gemini'].map(name => join(home, name))].map(root => {
    try { metadata(root, 'directory'); return { root, disposition: 'PRESENT_CANONICAL_DIRECTORY' as const }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { root, disposition: 'ABSENT_CANONICAL_PARENT' as const };
    }
  });
}
function exclusiveFile(path: string, bytes: Uint8Array): void {
  metadata(dirname(path), 'directory');
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  verifyFile(path, bytes);
}
function verifyFile(path: string, bytes: Uint8Array): string {
  metadata(path, 'file');
  if (lstatSync(path).size !== bytes.byteLength) throw new Error('Synthetic file byte length mismatch');
  const actual = readFileSync(path);
  metadata(path, 'file');
  if (!actual.equals(bytes) || hash(actual) !== hash(bytes)) throw new Error('Synthetic file bytes/hash mismatch');
  return hash(actual);
}
function binding(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor): void {
  const normalized = createCoreRuntimeContract({ ...core, syntheticRoot: core.rootPolicy.root });
  if (canonical(core) !== canonical(normalized)) throw new Error('Core substitution refused');
  if (adapter.adapterId !== 'omp' || !adapter.config.isolation) throw new Error('OMP isolation required');
  let endpoint: string;
  try { endpoint = JSON.parse(adapter.config.isolation.modelsYaml).providers.cliproxyapi.baseUrl.slice(0, -3); }
  catch { throw new Error('Models substitution refused'); }
  const expected = describeInertRuntime('omp', core, adapter.executable, endpoint, adapter.model,
    adapter.thinkingLevel ?? undefined, adapter.maxTimeSeconds);
  if (canonical(adapter) !== canonical(expected)) throw new Error('Adapter substitution refused');
}
interface Plan {
  core: CoreRuntimeContract; adapter: InertRuntimeDescriptor; base: string; repository: string; home: string;
  fixtures: { name: string; bytes: Buffer }[]; directories: string[];
}
function observe(plan: Plan) {
  const { core, adapter, repository, home, fixtures, directories } = plan;
  const isolation = adapter.config.isolation!;
  const roots = ambient(home, repository);
  for (const { root } of roots) if (overlap(core.rootPolicy.root, root)) throw new Error('PREPARATION_BASE_UNAVAILABLE: ambient overlap');
  const ancestorObservations = ancestors(core.rootPolicy.workDir);
  const tree = directories.map(root => {
    const expected = [...directories.filter(p => p !== root && dirname(p) === root).map(p => basename(p)),
      ...(root === core.rootPolicy.workDir ? fixtures.map(f => f.name) : []),
      ...(root === dirname(isolation.modelsFile) ? [basename(isolation.modelsFile)] : [])].sort();
    const actual = entries(root);
    if (actual.some(name => alias(name) || forbidden(name)) || canonical(actual) !== canonical(expected)) {
      throw new Error(`Unexpected synthetic tree entries: ${root}`);
    }
    return { root, entries: actual, type: 'REGULAR_CANONICAL_NON_LINK_DIRECTORY' as const };
  });
  const modelsSha256 = verifyFile(isolation.modelsFile, Buffer.from(isolation.modelsYaml, 'utf8'));
  const fixtureEvidence = fixtures.map(f => ({ name: f.name, sha256: verifyFile(join(core.rootPolicy.workDir, f.name), f.bytes) }));
  return freeze({ schema: 'OMP_PREPARATION_EVIDENCE' as const, version: 1 as const,
    coreDigest: coreScopeDigest(core), adapterId: adapter.adapterId, adapterDigest: digest(adapter),
    syntheticRoot: core.rootPolicy.root, workDir: core.rootPolicy.workDir, environment: { ...isolation.environment },
    inheritEnvironment: false, resolvedPiConfigDir: resolveOmpConfigRoot(core, isolation.configRootName),
    piCodingAgentDir: isolation.environment.PI_CODING_AGENT_DIR, modelsFile: isolation.modelsFile, modelsSha256,
    discoveryDisableFlags: [...isolation.discoveryDisableFlags], repositoryRoot: repository, humanHomeRoot: home,
    ambientRootSet: 'OMP_18_2_7_FIRST_PROOF_AMBIENT_ROOT_SET' as const, ambientRoots: roots,
    ancestors: ancestorObservations, tree, fixtures: fixtureEvidence,
    workspaceEntries: tree.find(item => item.root === core.rootPolicy.workDir)!.entries,
    created: true, canonical: true, regularDirectory: true, linkFree: true, standalone: true,
    disposition: 'PRE_LAUNCH_FILESYSTEM_STATE' as const, futurePluginSources: 'UNKNOWN' as const,
    nativeAliasClassesBeyondNode: 'UNKNOWN' as const, toctouAndUnobservableReparsePoints: 'UNKNOWN' as const,
    ATTEMPT_LEDGER_ACL: 'BLOCKED_BY_SAME_WINDOWS_PRINCIPAL' as const,
    execution: 'NOT_RUN' as const, network: 'NOT_AUTHORIZED' as const, credentials: 'NONE' as const,
    authority: 'PREPARATION_EVIDENCE_ONLY' as const });
}
export interface OmpPreparationEvidence {
  readonly schema: 'OMP_PREPARATION_EVIDENCE'; readonly version: 1; readonly digest: string;
  readonly coreDigest: string; readonly adapterId: 'omp' | 'codex'; readonly adapterDigest: string;
  readonly syntheticRoot: string; readonly workDir: string;
  readonly environment: Readonly<Record<string, string>>; readonly inheritEnvironment: boolean;
  readonly resolvedPiConfigDir: string; readonly piCodingAgentDir: string;
  readonly modelsFile: string; readonly modelsSha256: string; readonly discoveryDisableFlags: readonly string[];
  readonly repositoryRoot: string; readonly humanHomeRoot: string;
  readonly ambientRootSet: 'OMP_18_2_7_FIRST_PROOF_AMBIENT_ROOT_SET';
  readonly ambientRoots: readonly Readonly<{ root: string; disposition: 'PRESENT_CANONICAL_DIRECTORY' | 'ABSENT_CANONICAL_PARENT' }>[];
  readonly ancestors: readonly Readonly<{ root: string; relevantEntries: readonly string[] }>[];
  readonly tree: readonly Readonly<{ root: string; entries: readonly string[]; type: 'REGULAR_CANONICAL_NON_LINK_DIRECTORY' }>[];
  readonly fixtures: readonly Readonly<{ name: string; sha256: string }>[];
  readonly workspaceEntries: readonly string[];
  readonly created: boolean; readonly canonical: boolean; readonly regularDirectory: boolean;
  readonly linkFree: boolean; readonly standalone: boolean;
  readonly disposition: 'PRE_LAUNCH_FILESYSTEM_STATE'; readonly futurePluginSources: 'UNKNOWN';
  readonly nativeAliasClassesBeyondNode: 'UNKNOWN'; readonly toctouAndUnobservableReparsePoints: 'UNKNOWN';
  readonly ATTEMPT_LEDGER_ACL: 'BLOCKED_BY_SAME_WINDOWS_PRINCIPAL';
  readonly execution: 'NOT_RUN'; readonly network: 'NOT_AUTHORIZED'; readonly credentials: 'NONE';
  readonly authority: 'PREPARATION_EVIDENCE_ONLY';
}
const issued = new WeakMap<OmpPreparationHandle, { plan: Plan; evidence: OmpPreparationEvidence }>();

/** Synchronous, bounded provider-free filesystem preparation. Failures leave only the newly
 * created partial tree for Main to inspect; this module never deletes or repairs arbitrary paths.
 * Node observations cannot prove hostile same-principal immunity or atomic TOCTOU protection. */
export function inspectOmpPreparation(input: OmpPreparationInput): OmpPreparationHandle {
  binding(input.core, input.adapter);
  // Snapshot caller-owned objects before effects. No callbacks or caller filesystem attestations.
  const core: CoreRuntimeContract = freeze(JSON.parse(canonical(input.core)));
  const adapter: InertRuntimeDescriptor = freeze(JSON.parse(canonical(input.adapter)));
  const base = input.preparationBase; const repository = input.repositoryRoot; const home = input.humanHomeRoot;
  assertPath(core.rootPolicy.root); assertPath(base);
  if (dirname(core.rootPolicy.root) !== base) throw new Error('PREPARATION_BASE_UNAVAILABLE: exact parent required');
  if (input.fixtures !== undefined && (!Array.isArray(input.fixtures) || input.fixtures.length > MAX_ENTRIES)) {
    throw new Error('Invalid approved fixture list');
  }
  // Integer-safe aggregate gate: the running sum is exact (bounded by MAX_ENTRIES * MAX_FIXTURE_BYTES,
  // far below Number.MAX_SAFE_INTEGER) and it is evaluated after each entry's own bound but before that
  // entry is copied, before any filesystem effect. A rejected request never materializes a private snapshot.
  let approvedFixtureBytes = 0;
  const fixtures = (input.fixtures ?? []).map(f => {
    if (!f || typeof f.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(f.name)
      || alias(f.name) || forbidden(f.name)) throw new Error('Invalid approved fixture name');
    if (!(f.bytes instanceof Uint8Array) || f.bytes.byteLength > MAX_FIXTURE_BYTES) throw new Error('Invalid approved fixture bytes');
    approvedFixtureBytes += f.bytes.byteLength;
    if (approvedFixtureBytes > MAX_TOTAL_FIXTURE_BYTES) throw new Error('Approved fixture byte budget exceeded');
    return { name: f.name, bytes: Buffer.from(f.bytes) };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (fixtures.length > MAX_ENTRIES || new Set(fixtures.map(f => f.name.toLowerCase())).size !== fixtures.length) throw new Error('Duplicate or excessive approved fixtures');
  const roots = ambient(home, repository);
  if (roots.some(({ root }) => overlap(core.rootPolicy.root, root))) throw new Error('PREPARATION_BASE_UNAVAILABLE: ambient overlap');
  ancestors(base);
  const directories = [core.rootPolicy.root, ...core.rootPolicy.allowedDirectories,
    resolveOmpConfigRoot(core, adapter.config.isolation!.configRootName)];
  for (const path of directories) assertPath(path);
  // Non-recursive mkdir creates exactly this root, exclusively: it never walks ancestors and
  // fails EEXIST if anything already occupies the path. Nothing about dangling reparse points
  // at that exact root is claimed here beyond ordinary mkdir behaviour.
  mkdirSync(core.rootPolicy.root);
  metadata(core.rootPolicy.root, 'directory');
  for (const path of directories.slice(1)) { metadata(dirname(path), 'directory'); mkdirSync(path); metadata(path, 'directory'); }
  exclusiveFile(adapter.config.isolation!.modelsFile, Buffer.from(adapter.config.isolation!.modelsYaml, 'utf8'));
  for (const fixture of fixtures) exclusiveFile(join(core.rootPolicy.workDir, fixture.name), fixture.bytes);
  const plan = { core, adapter, base, repository, home, fixtures, directories };
  const observation = observe(plan);
  const evidence = freeze({ ...observation, digest: digest(observation) });
  const handle = Object.freeze(Object.create(null)) as OmpPreparationHandle;
  issued.set(handle, { plan, evidence });
  return handle;
}

/** Only issuer-local identity is accepted. Re-observation catches ordinary changes since minting,
 * but is not an atomic seal and never claims protection from a hostile same-principal process. */
export function consumeOmpPreparationEvidence(handle: OmpPreparationHandle, core: CoreRuntimeContract,
  adapter: InertRuntimeDescriptor): OmpPreparationEvidence {
  const record = issued.get(handle);
  if (!record) throw new Error('Foreign or forged preparation evidence');
  binding(core, adapter);
  if (canonical(core) !== canonical(record.plan.core) || digest(adapter) !== record.evidence.adapterDigest) throw new Error('Preparation binding substitution refused');
  if (digest(observe(record.plan)) !== record.evidence.digest) throw new Error('Preparation filesystem evidence changed');
  return record.evidence;
}
