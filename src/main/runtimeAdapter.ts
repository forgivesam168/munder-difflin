import { createHash } from 'node:crypto';
import { win32, posix } from 'node:path';
import { createCoreRuntimeContract, normalizeRuntimeExecutableDescriptor, type RuntimeExecutableDescriptor, type CoreRuntimeContract } from './codexWorkerContract';

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
export interface OmpIsolation {
  readonly environment: Readonly<Record<'HOME' | 'USERPROFILE' | 'PI_CODING_AGENT_DIR' | 'TEMP' | 'TMP', string>>;
  readonly inheritEnvironment: false;
  readonly ambientCredentials: 'DENY';
  readonly credentialDecision: 'NONE_PENDING_HUMAN_DEPLOYMENT_DECISION';
  readonly discovery: 'DENY_REQUIRED_BEFORE_FIRST_REAL_PROOF';
  readonly preparation: 'REQUIRE_LINK_FREE_SYNTHETIC_PATHS_AND_NO_ANCESTOR_DISCOVERY_CONFIG';
  readonly externalHomes: readonly string[];
  readonly modelsFile: string;
  readonly modelsYaml: string;
}
const OMP_THINKING: Readonly<Record<string, true>> = Object.freeze({ off: true, minimal: true, low: true, medium: true, high: true, xhigh: true, max: true, auto: true });
function ompIsolation(core: CoreRuntimeContract, endpoint: string, model: string): OmpIsolation {
  const p = core.rootPolicy;
  const path = /^[A-Za-z]:\\/.test(p.root) ? win32 : posix;
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid OMP route origin');
  // JSON is a YAML 1.2 representation. No auth:none, token or ambient lookup is implied.
  const modelsYaml = JSON.stringify({ providers: { cliproxyapi: { baseUrl: endpoint + '/v1',
    api: 'openai-responses', models: [{ id: model }] } } }, null, 2) + '\n';
  return Object.freeze({ environment: Object.freeze({ HOME: p.homeDir, USERPROFILE: p.homeDir,
    PI_CODING_AGENT_DIR: p.configDir, TEMP: p.tempDir, TMP: p.tempDir }), inheritEnvironment: false,
    ambientCredentials: 'DENY', credentialDecision: 'NONE_PENDING_HUMAN_DEPLOYMENT_DECISION',
    discovery: 'DENY_REQUIRED_BEFORE_FIRST_REAL_PROOF',
    preparation: 'REQUIRE_LINK_FREE_SYNTHETIC_PATHS_AND_NO_ANCESTOR_DISCOVERY_CONFIG',
    externalHomes: Object.freeze(['.omp', '.claude', '.codex', '.gemini'].map(name => path.join(p.homeDir, name))),
    modelsFile: path.join(p.configDir, 'models.yml'), modelsYaml });
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
        '--model', `cliproxyapi/${model}`, '--thinking', thinkingLevel!, '--approval-mode', 'yolo', '--max-time', `${maxTimeSeconds}s`]),
    approval: adapterId === 'codex' ? 'NEVER_WORKSPACE_WRITE' : 'YOLO_TOOL_POLICIES_STILL_APPLY',
    taskDelivery: 'RAW_PIPE_EXACT_BYTES_THEN_EOF',
    session: adapterId === 'codex' ? 'FRESH_EXEC' : 'EPHEMERAL_IN_MEMORY',
    completion: adapterId === 'codex' ? 'STRUCTURED_FIXTURE_ONLY_REAL_UNKNOWN' : 'OMP_JSON_EVENT_STREAM',
    ...(adapterId === 'omp' ? { maxTimeSeconds } : {}), execution: 'NOT_RUN', network: 'NOT_AUTHORIZED', credentials: 'NONE',
    coreDigest: coreScopeDigest(core) });
}
