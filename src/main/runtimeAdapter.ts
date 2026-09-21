import { createHash } from 'node:crypto';
import { win32, posix } from 'node:path';
import { createCoreRuntimeContract, isCanonicalAbsolutePath, isPathWithin, normalizeRuntimeExecutableDescriptor,
  type CoreRuntimeContract, type RuntimeExecutableDescriptor } from './codexWorkerContract';

/** Narrow hardened boundary, deliberately not a second AgentProviderPreset registry.
 * These descriptors cannot launch and grant no filesystem, process or network authority. */
export type RuntimeAdapterId = 'codex' | 'omp';
export function codexBackendArgv(origin: string, model?: string): readonly string[] {
  if (model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid model selector');
  return Object.freeze(['--ignore-user-config', '--ask-for-approval', 'never', '--sandbox', 'workspace-write',
    '-c', 'model_provider="munder"', '-c', 'model_providers.munder.name="Munder"',
    '-c', `model_providers.munder.base_url=${JSON.stringify(origin + '/v1')}`,
    '-c', 'model_providers.munder.wire_api="responses"', ...(model === undefined ? [] : ['--model', model]), 'exec', '-']);
}
export interface InertRuntimeDescriptor {
  readonly adapterId: RuntimeAdapterId;
  readonly executable: RuntimeExecutableDescriptor;
  readonly cwd: string;
  readonly config: { readonly root: string; readonly hostConfig: 'DENY'; readonly environmentKey: 'CODEX_HOME' | 'PI_CODING_AGENT_DIR';
    readonly isolation?: OmpIsolation };
  readonly model: string;
  readonly thinkingLevel: string | null;
  readonly args: readonly string[] | null;
  readonly approval: 'NEVER_WORKSPACE_WRITE' | 'YOLO_TOOL_POLICIES_STILL_APPLY';
  readonly taskDelivery: 'RAW_PIPE_EXACT_BYTES_THEN_EOF';
  readonly session: 'FRESH_EXEC' | 'EPHEMERAL_IN_MEMORY';
  readonly completion: 'STRUCTURED_FIXTURE_ONLY_REAL_UNKNOWN' | 'OMP_JSON_EVENT_STREAM';
  readonly maxTimeSeconds?: number;
  readonly execution: 'NOT_RUN';
  readonly network: 'NOT_AUTHORIZED';
  readonly credentials: 'NONE';
  readonly coreDigest: string;
}
export function coreScopeDigest(core: CoreRuntimeContract): string {
  const canonicalCore = createCoreRuntimeContract({ ...core, syntheticRoot: core.rootPolicy.root });
  return createHash('sha256').update(JSON.stringify(canonicalCore)).digest('hex');
}
export type OmpEnvironmentKey = 'HOME' | 'USERPROFILE' | 'PI_CODING_AGENT_DIR' | 'PI_CONFIG_DIR' | 'TEMP' | 'TMP';
/** The two Pi variables are distinct, never aliases: the agent directory is the exact
 * synthetic absolute native agent directory, the config directory is a synthetic relative
 * config-root name resolved under the synthetic HOME. */
export type OmpEnvironmentVariableSemantics = 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY' | 'SYNTHETIC_RELATIVE_CONFIG_ROOT_NAME';
export const OMP_ENVIRONMENT_VARIABLE_SEMANTICS: Readonly<Record<OmpEnvironmentKey, OmpEnvironmentVariableSemantics>> = Object.freeze({
  HOME: 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY', USERPROFILE: 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY',
  /** The agent directory is an exact synthetic absolute native directory, never a config-root alias. */
  PI_CODING_AGENT_DIR: 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY', PI_CONFIG_DIR: 'SYNTHETIC_RELATIVE_CONFIG_ROOT_NAME',
  TEMP: 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY', TMP: 'SYNTHETIC_ABSOLUTE_NATIVE_DIRECTORY' });
/** The only synthetic relative config-root name the current policy emits. */
export const OMP_CONFIG_ROOT_NAME = '.pi-config';
/** Discovery disabling is *requested* through these exact installed flags. It is not evidence
 * that any unrelated discovery path is disabled: real conformance stays UNKNOWN. */
export const OMP_DISCOVERY_DISABLE_FLAGS = Object.freeze(['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp'] as const);
export const OMP_FORBIDDEN_WORKSPACE_ENTRIES = Object.freeze(['.git', '.omp', '.claude', '.codex', '.gemini',
  'mcp.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'plugins'] as const);
/** `.env*` is open-ended, so it is matched by shape rather than by an enumerated name list. */
const OMP_DOTENV_RE = /^\.env/i;
const OMP_FIXTURE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Lower-cased forbidden names, precomputed once: discovery-sensitive names compare on win32
 * case-insensitively, because the win32 filesystem resolves them regardless of ASCII case. */
const OMP_FORBIDDEN_WORKSPACE_ENTRIES_FOLDED: Readonly<Record<string, true>> = Object.freeze(
  OMP_FORBIDDEN_WORKSPACE_ENTRIES.reduce<Record<string, true>>((folded, name) => {
    folded[name.toLowerCase()] = true;
    return folded;
  }, {}));
/** Canonical classification of one discovery-sensitive OMP workspace entry name. `.env*` stays
 * shape-matched case-insensitively everywhere; a fixed forbidden name matches case-insensitively
 * only on win32 and exactly on case-sensitive platforms. */
export function isForbiddenOmpDiscoveryEntry(name: string, platform: string = process.platform): boolean {
  return OMP_DOTENV_RE.test(name)
    || (platform === 'win32'
      ? OMP_FORBIDDEN_WORKSPACE_ENTRIES_FOLDED[name.toLowerCase()] === true
      : (OMP_FORBIDDEN_WORKSPACE_ENTRIES as readonly string[]).includes(name));
}
const OMP_CONFIG_ROOT_NAME_RE = /^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface OmpIsolation {
  readonly environment: Readonly<Record<OmpEnvironmentKey, string>>;
  readonly environmentSemantics: Readonly<Record<OmpEnvironmentKey, OmpEnvironmentVariableSemantics>>;
  readonly configRootName: typeof OMP_CONFIG_ROOT_NAME;
  readonly inheritEnvironment: false;
  readonly ambientCredentials: 'DENY';
  readonly credentialDecision: 'NONE_PENDING_HUMAN_DEPLOYMENT_DECISION';
  readonly discovery: 'DENY_REQUIRED_BEFORE_FIRST_REAL_PROOF';
  readonly discoveryDisableFlags: readonly string[];
  readonly discoveryDisableCompleteness: 'CLAIMED_UNAUDITED_REAL_CONFORMANCE_UNKNOWN';
  readonly preparation: 'REQUIRE_LINK_FREE_SYNTHETIC_PATHS_AND_NO_ANCESTOR_DISCOVERY_CONFIG';
  readonly externalHomes: readonly string[];
  readonly modelsFile: string;
  readonly modelsYaml: string;
}
/** Endpoint-independent isolation paths, derived only from Core. Both `ompIsolation` and the
 * preparation admission recompute them, so an isolation substitution is caught by comparison. */
function ompIsolationPaths(core: CoreRuntimeContract) {
  const p = core.rootPolicy;
  const api = /^[A-Za-z]:\\/.test(p.root) ? win32 : posix;
  return { api, environment: Object.freeze({ HOME: p.homeDir, USERPROFILE: p.homeDir,
      PI_CODING_AGENT_DIR: p.configDir, PI_CONFIG_DIR: OMP_CONFIG_ROOT_NAME, TEMP: p.tempDir, TMP: p.tempDir }),
    externalHomes: Object.freeze(['.omp', '.claude', '.codex', '.gemini'].map(name => api.join(p.homeDir, name))),
    modelsFile: api.join(p.configDir, 'models.yml') };
}
/** Resolves the synthetic relative config-root name under the synthetic HOME. Throws unless the
 * name is a bare relative name whose resolution stays inside the Core root. */
export function resolveOmpConfigRoot(core: CoreRuntimeContract, name: string): string {
  const api = ompIsolationPaths(core).api;
  if (typeof name !== 'string' || !OMP_CONFIG_ROOT_NAME_RE.test(name)
    || api.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    throw new Error('PI_CONFIG_DIR must be a synthetic relative config-root name');
  }
  const resolved = api.join(core.rootPolicy.homeDir, name);
  if (!isPathWithin(resolved, core.rootPolicy.root)) throw new Error('PI_CONFIG_DIR resolution must stay inside the Core root');
  return resolved;
}
const OMP_ISOLATION_KEYS: readonly string[] = ['ambientCredentials', 'configRootName', 'credentialDecision',
  'discovery', 'discoveryDisableCompleteness', 'discoveryDisableFlags', 'environment', 'environmentSemantics',
  'externalHomes', 'inheritEnvironment', 'modelsFile', 'modelsYaml', 'preparation'];
/** Deep, key-set-exhaustive, order-insensitive-data comparison: an added, missing or substituted
 * field at any depth is a mismatch. Arrays are order-sensitive. */
function canonicalEqual(value: unknown, canonical: unknown): boolean {
  if (canonical === null || typeof canonical !== 'object') return Object.is(value, canonical);
  if (value === null || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(canonical)) return false;
  const keys = Object.keys(canonical);
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key) && canonicalEqual((value as Record<string, unknown>)[key], (canonical as Record<string, unknown>)[key]));
}
/** The isolation must equal the one derived from Core and this descriptor. Its endpoint and model
 * are recovered from its own models representation, so any substituted field is refused. */
function canonicalOmpIsolation(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, isolation: OmpIsolation): OmpIsolation {
  if (!exactKeysOf(isolation, OMP_ISOLATION_KEYS)) throw new Error('Isolation substitution refused');
  let origin = ''; let model = '';
  try {
    const proxy = JSON.parse(isolation.modelsYaml).providers.cliproxyapi;
    if (typeof proxy?.baseUrl !== 'string' || !proxy.baseUrl.endsWith('/v1')) throw new Error('unexpected');
    origin = proxy.baseUrl.slice(0, -'/v1'.length); model = proxy.models[0].id;
  } catch { throw new Error('Isolation substitution refused'); }
  if (model !== adapter.model || adapter.args?.includes(`cliproxyapi/${model}`) !== true) throw new Error('Isolation substitution refused');
  const canonical = ompIsolation(core, origin, model);
  if (!canonicalEqual(isolation, canonical)) throw new Error('Isolation substitution refused');
  return canonical;
}
const OMP_THINKING: Readonly<Record<string, true>> = Object.freeze({ off: true, minimal: true, low: true, medium: true, high: true, xhigh: true, max: true, auto: true });
function ompIsolation(core: CoreRuntimeContract, endpoint: string, model: string): OmpIsolation {
  const expected = ompIsolationPaths(core);
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid OMP route origin');
  // JSON is a YAML 1.2 representation. No auth:none, token or ambient lookup is implied.
  const modelsYaml = JSON.stringify({ providers: { cliproxyapi: { baseUrl: endpoint + '/v1',
    api: 'openai-responses', models: [{ id: model }] } } }, null, 2) + '\n';
  return Object.freeze({ environment: expected.environment, environmentSemantics: OMP_ENVIRONMENT_VARIABLE_SEMANTICS,
    configRootName: OMP_CONFIG_ROOT_NAME, inheritEnvironment: false,
    ambientCredentials: 'DENY', credentialDecision: 'NONE_PENDING_HUMAN_DEPLOYMENT_DECISION',
    discovery: 'DENY_REQUIRED_BEFORE_FIRST_REAL_PROOF', discoveryDisableFlags: OMP_DISCOVERY_DISABLE_FLAGS,
    discoveryDisableCompleteness: 'CLAIMED_UNAUDITED_REAL_CONFORMANCE_UNKNOWN',
    preparation: 'REQUIRE_LINK_FREE_SYNTHETIC_PATHS_AND_NO_ANCESTOR_DISCOVERY_CONFIG',
    externalHomes: expected.externalHomes, modelsFile: expected.modelsFile, modelsYaml });
}
export function describeInertRuntime(adapterId: RuntimeAdapterId, core: CoreRuntimeContract,
  executable: RuntimeExecutableDescriptor, endpoint: string, model: string, thinkingLevel?: string, maxTimeSeconds = 60): InertRuntimeDescriptor {
  if (adapterId !== 'codex' && adapterId !== 'omp') throw new Error('Unsupported runtime adapter');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid model selector');
  if (adapterId === 'omp' ? typeof thinkingLevel !== 'string' || !Object.hasOwn(OMP_THINKING, thinkingLevel) : thinkingLevel !== undefined) throw new Error('Unsupported thinking level');
  if (!Number.isSafeInteger(maxTimeSeconds) || maxTimeSeconds < 1 || maxTimeSeconds > 3600
    || (adapterId === 'codex' && maxTimeSeconds !== 60)) throw new Error('Invalid maximum time');
  if (core.network !== 'NOT_AUTHORIZED' || core.credentials !== 'NONE' || core.authority !== 'EXPLICIT_ONLY') throw new Error('Authority upgrade refused');
  core = createCoreRuntimeContract({ ...core, syntheticRoot: core.rootPolicy.root });
  const isolation = adapterId === 'omp' ? ompIsolation(core, endpoint, model) : undefined;
  return Object.freeze({ adapterId, executable: normalizeRuntimeExecutableDescriptor(executable), cwd: core.rootPolicy.workDir,
    config: Object.freeze({ root: core.rootPolicy.configDir, hostConfig: 'DENY', environmentKey: adapterId === 'codex' ? 'CODEX_HOME' : 'PI_CODING_AGENT_DIR',
      ...(isolation ? { isolation } : {}) }),
    model, thinkingLevel: thinkingLevel ?? null, args: adapterId === 'codex' ? codexBackendArgv(endpoint, model)
      : Object.freeze(['--print', '--mode', 'json', '--no-session', '--cwd', core.rootPolicy.workDir,
        '--model', `cliproxyapi/${model}`, '--thinking', thinkingLevel!, '--approval-mode', 'yolo', '--max-time', `${maxTimeSeconds}s`,
        ...OMP_DISCOVERY_DISABLE_FLAGS]),
    approval: adapterId === 'codex' ? 'NEVER_WORKSPACE_WRITE' : 'YOLO_TOOL_POLICIES_STILL_APPLY',
    taskDelivery: 'RAW_PIPE_EXACT_BYTES_THEN_EOF',
    session: adapterId === 'codex' ? 'FRESH_EXEC' : 'EPHEMERAL_IN_MEMORY',
    completion: adapterId === 'codex' ? 'STRUCTURED_FIXTURE_ONLY_REAL_UNKNOWN' : 'OMP_JSON_EVENT_STREAM',
    ...(adapterId === 'omp' ? { maxTimeSeconds } : {}), execution: 'NOT_RUN', network: 'NOT_AUTHORIZED', credentials: 'NONE',
    coreDigest: coreScopeDigest(core) });
}

/** Host observations for one provider-free OMP preparation. Every field is an observation the
 * caller must hold; the validator never reads the filesystem itself and never launches. */
export interface OmpPreparationEnvironmentObservation {
  readonly inheritEnvironment: boolean;
  readonly environment: Readonly<Record<string, string>>;
}
export interface OmpPreparationWorkspaceObservation {
  readonly root: string;
  readonly created: boolean;
  readonly standalone: boolean;
  readonly linkFree: boolean;
  readonly canonical: boolean;
  readonly regularDirectory: boolean;
  readonly repositoryRoot: string;
  /** Caller-held Human ambient home/config roots. This validator cannot discover roots itself:
   * it only checks the evidence it is handed. */
  readonly humanAmbientRoots: readonly string[];
  /** Caller attestation that `humanAmbientRoots` is the complete set it inspected. */
  readonly ambientRootsComplete: boolean;
  readonly approvedFixtureNames: readonly string[];
  readonly entries: readonly string[];
}
export interface OmpPreparationObservation {
  readonly environment: OmpPreparationEnvironmentObservation;
  readonly workspace: OmpPreparationWorkspaceObservation;
}
export interface OmpPreparationAdmission {
  readonly schema: 'OMP_PREPARATION_ADMISSION';
  readonly version: 1;
  readonly adapterDigest: string;
  readonly environment: Readonly<Record<OmpEnvironmentKey, string>>;
  readonly environmentKeys: readonly OmpEnvironmentKey[];
  readonly workspaceRoot: string;
  readonly approvedFixtureNames: readonly string[];
  readonly discoveryDisableFlags: readonly string[];
  readonly admission: 'PREPARATION_ONLY_NO_LAUNCH';
  readonly execution: 'NOT_RUN';
  readonly network: 'NOT_AUTHORIZED';
  readonly credentials: 'NONE';
}
const OMP_PREPARATION_ENVIRONMENT_KEYS: readonly string[] = ['environment', 'inheritEnvironment'];
const OMP_PREPARATION_WORKSPACE_KEYS: readonly string[] = ['ambientRootsComplete', 'approvedFixtureNames', 'canonical',
  'created', 'entries', 'humanAmbientRoots', 'linkFree', 'regularDirectory', 'repositoryRoot', 'root', 'standalone'];
const OMP_PREPARATION_KEYS: readonly string[] = ['environment', 'workspace'];
const OMP_ADMISSION_KEYS: readonly string[] = ['adapterDigest', 'admission', 'approvedFixtureNames', 'credentials',
  'discoveryDisableFlags', 'environment', 'environmentKeys', 'execution', 'network', 'schema', 'version', 'workspaceRoot'];

function exactKeySet(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const actual = Object.keys(value).sort(); const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, i) => key !== keys[i])) throw new Error(`Invalid ${label} schema`);
}
function exactKeysOf(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function isSymmetricWithin(a: string, b: string): boolean {
  return samePath(a, b) || isPathWithin(a, b) || isPathWithin(b, a);
}
/** Requires evidence binding the adapter, the exact minimal child environment, and a newly
 * created, standalone, link-free fixture-only workspace. Nothing here may infer cleanliness
 * from a work directory merely existing. */
export function admitOmpPreparation(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor,
  observation: OmpPreparationObservation): OmpPreparationAdmission {
  if (adapter.adapterId !== 'omp' || !adapter.config.isolation) throw new Error('OMP isolation required for preparation admission');
  if (adapter.coreDigest !== coreScopeDigest(core)) throw new Error('Preparation Core substitution refused');
  if (core.network !== 'NOT_AUTHORIZED' || core.credentials !== 'NONE' || core.authority !== 'EXPLICIT_ONLY') throw new Error('Authority upgrade refused');
  if (adapter.cwd !== core.rootPolicy.workDir || adapter.config.root !== core.rootPolicy.configDir
    || adapter.config.environmentKey !== 'PI_CODING_AGENT_DIR' || adapter.config.hostConfig !== 'DENY') {
    throw new Error('Isolation substitution refused');
  }
  const isolation = canonicalOmpIsolation(core, adapter, adapter.config.isolation);
  const expected = ompIsolationPaths(core);
  exactKeySet(observation, OMP_PREPARATION_KEYS, 'OMP preparation observation');
  const { environment, workspace } = observation;
  exactKeySet(environment, OMP_PREPARATION_ENVIRONMENT_KEYS, 'OMP preparation environment observation');
  exactKeySet(environment.environment, Object.keys(expected.environment), 'OMP preparation environment');
  if (environment.inheritEnvironment !== false) throw new Error('Preparation must not inherit the host environment');
  const keys = Object.keys(expected.environment) as OmpEnvironmentKey[];
  for (const key of keys) {
    const value = environment.environment[key];
    if (typeof value !== 'string' || !samePath(value, expected.environment[key])) throw new Error('Preparation environment substitution refused');
  }
  const agentDir = environment.environment.PI_CODING_AGENT_DIR;
  if (agentDir !== expected.environment.PI_CODING_AGENT_DIR || !isCanonicalAbsolutePath(agentDir)
    || !isPathWithin(agentDir, core.rootPolicy.root)) throw new Error('PI_CODING_AGENT_DIR must be the exact synthetic absolute agent directory inside the Core root');
  if (environment.environment.PI_CONFIG_DIR !== expected.environment.PI_CONFIG_DIR
    || resolveOmpConfigRoot(core, environment.environment.PI_CONFIG_DIR) !== expected.api.join(core.rootPolicy.homeDir, OMP_CONFIG_ROOT_NAME)) {
    throw new Error('PI_CONFIG_DIR must be the synthetic relative config root resolving inside the Core root');
  }
  exactKeySet(workspace, OMP_PREPARATION_WORKSPACE_KEYS, 'OMP preparation workspace observation');
  if (workspace.created !== true || workspace.standalone !== true || workspace.linkFree !== true
    || workspace.canonical !== true || workspace.regularDirectory !== true) {
    throw new Error('Workspace must be newly created, standalone, canonical, regular and link-free');
  }
  if (!isCanonicalAbsolutePath(workspace.root) || !isCanonicalAbsolutePath(workspace.repositoryRoot)) throw new Error('Workspace root must be canonical and absolute');
  if (workspace.root !== adapter.cwd || !isPathWithin(workspace.root, core.rootPolicy.root)) throw new Error('Workspace root must be the descriptor cwd inside the Core root');
  if (isSymmetricWithin(workspace.root, workspace.repositoryRoot)) throw new Error('Workspace must stand entirely outside the repository');
  if (!Array.isArray(workspace.humanAmbientRoots) || !Array.isArray(workspace.entries) || !Array.isArray(workspace.approvedFixtureNames)) throw new Error('Invalid OMP preparation workspace lists');
  // Fail-closed completeness: the caller must attest it enumerated Human ambient roots, and the
  // synthetic external homes are always independently required. This validator does not discover
  // roots; it only rejects incomplete or overlapping caller-held evidence.
  if (workspace.ambientRootsComplete !== true) throw new Error('Ambient root enumeration must be attested complete');
  if (workspace.humanAmbientRoots.length === 0) throw new Error('Ambient root evidence must supply at least one Human ambient root');
  const ambientRoots = [...expected.externalHomes, ...workspace.humanAmbientRoots];
  for (const ambient of ambientRoots) {
    if (!isCanonicalAbsolutePath(ambient)) throw new Error('Ambient root must be canonical and absolute');
    if (isSymmetricWithin(workspace.root, ambient)) throw new Error('Workspace must stand entirely outside every Human ambient root');
  }
  const approved = [...workspace.approvedFixtureNames];
  for (const name of approved) {
    if (!OMP_FIXTURE_NAME_RE.test(name) || isForbiddenOmpDiscoveryEntry(name)) throw new Error('Approved fixture name is not an approved fixture file');
  }
  for (const name of workspace.entries) {
    if (typeof name !== 'string') throw new Error('Invalid workspace entry observation');
    if (isForbiddenOmpDiscoveryEntry(name)) {
      if (!approved.includes(name)) throw new Error(`Forbidden ambient entry present in workspace: ${name}`);
      continue;
    }
    if (!OMP_FIXTURE_NAME_RE.test(name)) throw new Error('Invalid workspace entry observation');
    if (!approved.includes(name)) throw new Error('Workspace entry is not an approved fixture');
  }
  return Object.freeze({ schema: 'OMP_PREPARATION_ADMISSION', version: 1,
    adapterDigest: createHash('sha256').update(JSON.stringify([adapter.coreDigest, isolation.modelsFile,
      ...keys.map(key => `${key}=${isolation.environment[key]}`)])).digest('hex'),
    environment: Object.freeze({ ...expected.environment }), environmentKeys: Object.freeze([...keys]),
    workspaceRoot: workspace.root, approvedFixtureNames: Object.freeze([...approved].sort()),
    discoveryDisableFlags: OMP_DISCOVERY_DISABLE_FLAGS, admission: 'PREPARATION_ONLY_NO_LAUNCH',
    execution: 'NOT_RUN', network: 'NOT_AUTHORIZED', credentials: 'NONE' });
}
/** Re-admits against the caller's own observation: a substituted or replayed admission, and any
 * isolation or preparation substitution, fails here rather than being trusted. */
export function assertOmpPreparationAdmission(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor,
  admission: OmpPreparationAdmission, observation: OmpPreparationObservation): void {
  exactKeySet(admission, OMP_ADMISSION_KEYS, 'OMP preparation admission');
  const expected = admitOmpPreparation(core, adapter, observation);
  if (admission.schema !== expected.schema || admission.version !== expected.version
    || admission.adapterDigest !== expected.adapterDigest || admission.workspaceRoot !== expected.workspaceRoot
    || admission.admission !== expected.admission || admission.execution !== 'NOT_RUN'
    || admission.network !== 'NOT_AUTHORIZED' || admission.credentials !== 'NONE'
    || !Array.isArray(admission.environmentKeys) || admission.environmentKeys.length !== expected.environmentKeys.length
    || admission.environmentKeys.some((key, i) => key !== expected.environmentKeys[i])
    || !Array.isArray(admission.approvedFixtureNames) || admission.approvedFixtureNames.length !== expected.approvedFixtureNames.length
    || admission.approvedFixtureNames.some((name, i) => name !== expected.approvedFixtureNames[i])
    || !Array.isArray(admission.discoveryDisableFlags) || admission.discoveryDisableFlags.length !== expected.discoveryDisableFlags.length
    || admission.discoveryDisableFlags.some((flag, i) => flag !== expected.discoveryDisableFlags[i])) {
    throw new Error('OMP preparation admission substitution refused');
  }
  for (const key of expected.environmentKeys) {
    if (!samePath(admission.environment[key], expected.environment[key])) throw new Error('OMP preparation admission substitution refused');
  }
}
