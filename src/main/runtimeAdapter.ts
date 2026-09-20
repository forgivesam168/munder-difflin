import { createHash } from 'node:crypto';
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
  readonly config: { readonly root: string; readonly hostConfig: 'DENY'; readonly environmentKey: 'CODEX_HOME' | 'UNKNOWN' };
  readonly model: string;
  readonly thinkingLevel: string | null;
  readonly args: readonly string[] | null;
  readonly approval: 'NEVER_WORKSPACE_WRITE' | 'UNKNOWN';
  readonly taskDelivery: 'RAW_PIPE_EXACT_BYTES_THEN_EOF' | 'UNKNOWN';
  readonly session: 'FRESH_EXEC' | 'FRESH_REQUIRED_SYNTAX_UNKNOWN';
  readonly completion: 'STRUCTURED_FIXTURE_ONLY_REAL_UNKNOWN';
  readonly execution: 'NOT_RUN';
  readonly network: 'NOT_AUTHORIZED';
  readonly credentials: 'NONE';
  readonly coreDigest: string;
}
export function coreScopeDigest(core: CoreRuntimeContract): string {
  const canonicalCore = createCoreRuntimeContract({ ...core, syntheticRoot: core.rootPolicy.root });
  return createHash('sha256').update(JSON.stringify(canonicalCore)).digest('hex');
}
export function describeInertRuntime(adapterId: RuntimeAdapterId, core: CoreRuntimeContract,
  executable: RuntimeExecutableDescriptor, endpoint: string, model: string, thinkingLevel?: string): InertRuntimeDescriptor {
  if (adapterId !== 'codex' && adapterId !== 'omp') throw new Error('Unsupported runtime adapter');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid model selector');
  if (thinkingLevel !== undefined && (!/^[a-z][a-z0-9_-]{0,31}$/.test(thinkingLevel) || adapterId !== 'omp')) throw new Error('Unsupported thinking level');
  if (core.network !== 'NOT_AUTHORIZED' || core.credentials !== 'NONE' || core.authority !== 'EXPLICIT_ONLY') throw new Error('Authority upgrade refused');
  // OMP syntax/config discovery is not established by repository evidence. Null argv
  // is intentional: a descriptor must not accidentally become an executable guess.
  return Object.freeze({ adapterId, executable: normalizeRuntimeExecutableDescriptor(executable), cwd: core.rootPolicy.workDir,
    config: Object.freeze({ root: core.rootPolicy.configDir, hostConfig: 'DENY', environmentKey: adapterId === 'codex' ? 'CODEX_HOME' : 'UNKNOWN' }),
    model, thinkingLevel: thinkingLevel ?? null, args: adapterId === 'codex' ? codexBackendArgv(endpoint, model) : null,
    approval: adapterId === 'codex' ? 'NEVER_WORKSPACE_WRITE' : 'UNKNOWN',
    taskDelivery: adapterId === 'codex' ? 'RAW_PIPE_EXACT_BYTES_THEN_EOF' : 'UNKNOWN',
    session: adapterId === 'codex' ? 'FRESH_EXEC' : 'FRESH_REQUIRED_SYNTAX_UNKNOWN',
    completion: 'STRUCTURED_FIXTURE_ONLY_REAL_UNKNOWN', execution: 'NOT_RUN', network: 'NOT_AUTHORIZED', credentials: 'NONE',
    coreDigest: coreScopeDigest(core) });
}
