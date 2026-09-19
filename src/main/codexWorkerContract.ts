import { posix, win32 } from 'node:path';

/** B1 contract/admission only. No filesystem, process, Electron, credential,
 * or network API belongs in this module. Runtime supplies observations later. */

export const CODEX_WORKER_CONTRACT_SCHEMA_VERSION = 1 as const;
export const CODEX_WORKER_RESULT_SCHEMA_VERSION = 1 as const;
export const ADMISSION_GATE_NAMES = [
  'executableIdentity', 'taskIdentity', 'sourceIdentity', 'rootPolicy',
  'environmentPolicy', 'credentialPolicy', 'networkPolicy', 'processOwnership',
  'resultPolicy', 'authority'
] as const;
export type AdmissionGateName = (typeof ADMISSION_GATE_NAMES)[number];
export type AdmissionState = 'READY' | 'BLOCKED' | 'UNKNOWN';
export type TerminalState = 'PASS' | 'FAIL' | 'UNKNOWN';
export type CredentialMode = 'NONE' | 'DEDICATED_PREPROVISIONED';

export const CODEX_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'CODEX_HOME',
  'TERM', 'COLORTERM', 'FORCE_COLOR', 'SYSTEMROOT'
] as const;
export type CodexEnvironmentKey = (typeof CODEX_ENV_ALLOWLIST)[number];

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const HEX_SHA256_RE = /^[0-9A-Fa-f]{64}$/;
const GIT_SHA_RE = /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/;
const CHECK_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL_ENV_RE = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE|PRIVATE[_-]?KEY|PROXY)/i;

export interface SourceCheckpointIdentity { repositoryId: string; commitSha: string; treeSha: string }
export interface CodexWorkerIdentity {
  candidateId: string; taskId: string; runId: string; workerId: string;
  taskDigest: string; sourceCheckpoint: SourceCheckpointIdentity;
}
export interface CodexExecutableDescriptor { executablePath: string; version: string; executableSha256: string }
export interface SyntheticRootPolicy {
  root: string; projectDir: string; workDir: string; homeDir: string; userProfileDir: string;
  tempDir: string; codexHomeDir: string; artifactDir: string; resultPath: string;
  allowedDirectories: readonly string[];
}
export interface CodexEnvironmentPolicy {
  inheritHostEnvironment: false; allowedKeys: readonly CodexEnvironmentKey[];
  credentialLikeVariables: 'DENY'; pathSource: 'EXPLICIT_INPUT';
  dedicatedPaths: { HOME: string; USERPROFILE: string; TEMP: string; TMP: string; CODEX_HOME: string };
}
export interface CredentialPolicy {
  mode: CredentialMode; dailyAuthJson: 'DENY'; dailyConfigToml: 'DENY';
  credentialLikeEnvironment: 'DENY'; providerSecrets: 'DENY'; provisioning: 'EXPLICIT_HUMAN_HANDOFF_ONLY';
}
export interface NetworkPolicy {
  modelInvocationRequiresProviderAuthority: true; providerEndpointEnforcement: 'OPEN_DECISION';
  fullAccessDoesNotGrantNetwork: true;
}
export interface ProcessOwnershipPolicy {
  ptyOwnership: 'CREATION_TIME_REQUIRED'; windowsJobOwnership: 'CREATION_TIME_REQUIRED';
  descendants: 'MUST_REMAIN_OWNED'; stop: 'BOUNDED_TREE_STOP_REQUIRED';
  timeout: 'BOUNDED_REQUIRED'; cleanup: 'VERIFIED_EMPTY_REQUIRED';
}
export interface ResultPolicy {
  schemaVersion: typeof CODEX_WORKER_RESULT_SCHEMA_VERSION; resultPath: string; artifactDir: string;
  durableResultRequired: true; processExitIsNotTaskCompletion: true; duplicateResult: 'REJECT';
  staleOrConflictingIdentity: 'REJECT'; artifactPaths: 'RELATIVE_TO_ARTIFACT_DIR_ONLY';
}
export interface CodexWorkerContract extends CodexWorkerIdentity {
  schemaVersion: typeof CODEX_WORKER_CONTRACT_SCHEMA_VERSION; executable: CodexExecutableDescriptor;
  rootPolicy: SyntheticRootPolicy; environmentPolicy: CodexEnvironmentPolicy;
  credentialPolicy: CredentialPolicy; networkPolicy: NetworkPolicy;
  processOwnershipPolicy: ProcessOwnershipPolicy; resultPolicy: ResultPolicy;
  requiredGates: readonly AdmissionGateName[];
}
export interface CodexWorkerContractInput extends CodexWorkerIdentity {
  executable: CodexExecutableDescriptor; syntheticRoot: string; credentialMode?: CredentialMode;
}
export interface DurableArtifact { path: string; sha256: string }
export interface CodexTaskResult extends CodexWorkerIdentity {
  schemaVersion: typeof CODEX_WORKER_RESULT_SCHEMA_VERSION; result: TerminalState;
  checks: Readonly<Record<string, TerminalState>>; artifacts: readonly DurableArtifact[];
}
export interface ResultValidationOptions { resultAlreadyExists?: boolean }

export interface ExecutableIdentityEvidence {
  canonicalPath: string; regularFile: boolean;
  resolution: 'absolute-direct' | 'path' | 'shim' | 'unknown';
  version: string; executableSha256: string;
}
export interface TaskIdentityEvidence { taskId: string; taskDigest: string }
export interface RootPolicyEvidence {
  root: string; projectDir: string; workDir: string; artifactDir: string; resultPath: string;
  canonical: boolean; directories: boolean; linkFree: boolean;
}
export interface EnvironmentPolicyEvidence { env: Readonly<Record<string, string>> }
export interface CredentialPolicyEvidence {
  mode: CredentialMode; dailyAuthJsonAccessed: boolean; dailyConfigTomlAccessed: boolean;
  credentialLikeEnvironmentPresent: boolean; providerSecretsPresent: boolean;
  dedicatedPreprovisioned: boolean; handoffAuthorized: boolean;
}
export interface NetworkPolicyEvidence {
  providerNetworkAuthority: 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'UNKNOWN';
  endpointEnforcement: 'APPROVED' | 'OPEN_DECISION' | 'UNKNOWN'; impliedByFullAccess: boolean;
}
export type OwnershipObservation = 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
export interface ProcessOwnershipEvidence {
  platform: 'win32' | 'posix'; ptyAtCreation: OwnershipObservation;
  windowsJobAtCreation: OwnershipObservation | 'NOT_APPLICABLE'; descendants: OwnershipObservation;
  stop: OwnershipObservation; timeout: OwnershipObservation; cleanup: OwnershipObservation;
}
export interface ResultPolicyEvidence {
  resultPath: string; artifactDir: string; resultSlotAvailable: boolean; validatorBound: boolean;
  artifactContainmentBound: boolean; duplicateRejected: boolean; consumerReady: boolean;
}
export interface AuthorityEvidence {
  sourceCheckpointApproved: boolean; identityApproved: boolean; humanApproved: boolean;
  runtimePermit: 'PRESENT' | 'ABSENT' | 'EXPIRED' | 'UNKNOWN';
}
export interface CodexAdmissionEvidence {
  executableIdentity?: ExecutableIdentityEvidence; taskIdentity?: TaskIdentityEvidence;
  sourceIdentity?: SourceCheckpointIdentity; rootPolicy?: RootPolicyEvidence;
  environmentPolicy?: EnvironmentPolicyEvidence; credentialPolicy?: CredentialPolicyEvidence;
  networkPolicy?: NetworkPolicyEvidence; processOwnership?: ProcessOwnershipEvidence;
  resultPolicy?: ResultPolicyEvidence; authority?: AuthorityEvidence;
}
export interface AdmissionGate { required: true; state: AdmissionState; reason: string }
export type AdmissionGates = Readonly<Record<AdmissionGateName, AdmissionGate>>;
export interface AdmissionDecision { state: AdmissionState; runtimeReady: boolean; gates: AdmissionGates }
export type NoProgressSignal = 'NO_OUTPUT_WITHIN_BOUND' | 'NO_HEARTBEAT_WITHIN_BOUND' | 'NO_DURABLE_RESULT' | 'PROCESS_EXIT_WITHOUT_RESULT';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, i) => key !== keys[i])) throw new Error(`Invalid ${label} schema`);
}
function assertString(value: unknown, label: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value) || (pattern && !pattern.test(value))) throw new Error(`Invalid ${label}`);
}
function assertId(value: unknown, label: string): asserts value is string { assertString(value, label, ID_RE); }
function sha256(value: unknown, label: string): string { assertString(value, label, HEX_SHA256_RE); return value.toLowerCase(); }
function pathKind(value: string): 'win32' | 'posix' { return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) ? 'win32' : 'posix'; }
function pathApi(value: string): typeof win32 | typeof posix { return pathKind(value) === 'win32' ? win32 : posix; }
export function isCredentialLikeEnvironmentKey(key: string): boolean { return CREDENTIAL_ENV_RE.test(key); }

/** Pure lexical check; runtime must additionally prove regular and link-free. */
export function isCanonicalAbsolutePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) return false;
  const api = pathApi(value); if (!api.isAbsolute(value) || api.normalize(value) !== value) return false;
  const root = api.parse(value).root;
  return !value.slice(root.length).split(/[\\/]/).filter(Boolean).some(part => part === '.' || part === '..');
}
export function isPathWithin(child: string, parent: string): boolean {
  if (!isCanonicalAbsolutePath(child) || !isCanonicalAbsolutePath(parent) || pathKind(child) !== pathKind(parent)) return false;
  const api = pathApi(parent); const base = pathKind(parent) === 'win32' ? parent.toLowerCase() : parent; const target = pathKind(parent) === 'win32' ? child.toLowerCase() : child;
  const relative = api.relative(base, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
}
function joinPath(root: string, child: string): string { return pathApi(root).join(root, child); }

export function createSyntheticRootPolicy(root: string): SyntheticRootPolicy {
  if (!isCanonicalAbsolutePath(root)) throw new Error('Synthetic root must be canonical and absolute');
  if (pathApi(root).parse(root).root === root) throw new Error('Synthetic root must be below the filesystem root');
  const policy = {
    root, projectDir: joinPath(root, 'project'), workDir: joinPath(root, 'work'), homeDir: joinPath(root, 'home'),
    userProfileDir: joinPath(root, 'user-profile'), tempDir: joinPath(root, 'temp'), codexHomeDir: joinPath(root, 'codex-home'),
    artifactDir: joinPath(root, 'artifacts'), resultPath: joinPath(root, 'task-result.json'), allowedDirectories: [] as readonly string[]
  };
  policy.allowedDirectories = Object.freeze([policy.projectDir, policy.workDir, policy.homeDir, policy.userProfileDir, policy.tempDir, policy.codexHomeDir, policy.artifactDir]);
  return Object.freeze(policy);
}

export function normalizeCodexExecutableDescriptor(value: unknown): CodexExecutableDescriptor {
  if (!isRecord(value)) throw new Error('Invalid Codex executable descriptor');
  exactKeys(value, ['executablePath', 'version', 'executableSha256'], 'Codex executable descriptor');
  if (!isCanonicalAbsolutePath(value.executablePath)) throw new Error('Codex executable path must be canonical and absolute');
  if (/\.(?:cmd|bat|ps1)$/i.test(value.executablePath)) throw new Error('Codex executable must not be a shell shim');
  assertString(value.version, 'Codex executable version');
  return Object.freeze({ executablePath: value.executablePath, version: value.version, executableSha256: sha256(value.executableSha256, 'Codex executable SHA256') });
}
export function normalizeSourceCheckpoint(value: unknown): SourceCheckpointIdentity {
  if (!isRecord(value)) throw new Error('Invalid source checkpoint');
  exactKeys(value, ['repositoryId', 'commitSha', 'treeSha'], 'source checkpoint');
  assertString(value.repositoryId, 'source checkpoint repositoryId', REPOSITORY_ID_RE);
  assertString(value.commitSha, 'source checkpoint commitSha', GIT_SHA_RE); assertString(value.treeSha, 'source checkpoint treeSha', GIT_SHA_RE);
  return Object.freeze({ repositoryId: value.repositoryId, commitSha: value.commitSha.toLowerCase(), treeSha: value.treeSha.toLowerCase() });
}
function environmentPolicy(root: SyntheticRootPolicy): CodexEnvironmentPolicy {
  return Object.freeze({ inheritHostEnvironment: false, allowedKeys: Object.freeze([...CODEX_ENV_ALLOWLIST]), credentialLikeVariables: 'DENY', pathSource: 'EXPLICIT_INPUT', dedicatedPaths: Object.freeze({ HOME: root.homeDir, USERPROFILE: root.userProfileDir, TEMP: root.tempDir, TMP: root.tempDir, CODEX_HOME: root.codexHomeDir }) });
}
export function createCodexWorkerContract(input: CodexWorkerContractInput): CodexWorkerContract {
  assertId(input.candidateId, 'candidateId'); assertId(input.taskId, 'taskId'); assertId(input.runId, 'runId'); assertId(input.workerId, 'workerId');
  const mode = input.credentialMode ?? 'NONE'; if (mode !== 'NONE' && mode !== 'DEDICATED_PREPROVISIONED') throw new Error('Invalid credential mode');
  const rootPolicy = createSyntheticRootPolicy(input.syntheticRoot);
  return Object.freeze({
    schemaVersion: CODEX_WORKER_CONTRACT_SCHEMA_VERSION, candidateId: input.candidateId, taskId: input.taskId, runId: input.runId, workerId: input.workerId,
    taskDigest: sha256(input.taskDigest, 'taskDigest'), sourceCheckpoint: normalizeSourceCheckpoint(input.sourceCheckpoint), executable: normalizeCodexExecutableDescriptor(input.executable), rootPolicy,
    environmentPolicy: environmentPolicy(rootPolicy),
    credentialPolicy: Object.freeze({ mode, dailyAuthJson: 'DENY', dailyConfigToml: 'DENY', credentialLikeEnvironment: 'DENY', providerSecrets: 'DENY', provisioning: 'EXPLICIT_HUMAN_HANDOFF_ONLY' }),
    networkPolicy: Object.freeze({ modelInvocationRequiresProviderAuthority: true, providerEndpointEnforcement: 'OPEN_DECISION', fullAccessDoesNotGrantNetwork: true }),
    processOwnershipPolicy: Object.freeze({ ptyOwnership: 'CREATION_TIME_REQUIRED', windowsJobOwnership: 'CREATION_TIME_REQUIRED', descendants: 'MUST_REMAIN_OWNED', stop: 'BOUNDED_TREE_STOP_REQUIRED', timeout: 'BOUNDED_REQUIRED', cleanup: 'VERIFIED_EMPTY_REQUIRED' }),
    resultPolicy: Object.freeze({ schemaVersion: CODEX_WORKER_RESULT_SCHEMA_VERSION, resultPath: rootPolicy.resultPath, artifactDir: rootPolicy.artifactDir, durableResultRequired: true, processExitIsNotTaskCompletion: true, duplicateResult: 'REJECT', staleOrConflictingIdentity: 'REJECT', artifactPaths: 'RELATIVE_TO_ARTIFACT_DIR_ONLY' }),
    requiredGates: Object.freeze([...ADMISSION_GATE_NAMES])
  });
}

function identityOf(value: CodexWorkerContract | CodexWorkerIdentity): CodexWorkerIdentity {
  return { candidateId: value.candidateId, taskId: value.taskId, runId: value.runId, workerId: value.workerId, taskDigest: value.taskDigest, sourceCheckpoint: value.sourceCheckpoint };
}
function sourceEqual(a: SourceCheckpointIdentity, b: SourceCheckpointIdentity): boolean { return a.repositoryId === b.repositoryId && a.commitSha === b.commitSha && a.treeSha === b.treeSha; }
function assertRootPolicy(policy: SyntheticRootPolicy): void {
  const expected = createSyntheticRootPolicy(policy.root); if (JSON.stringify(policy) !== JSON.stringify(expected)) throw new Error('Invalid synthetic root policy');
}
function artifactPath(policy: SyntheticRootPolicy, value: unknown): string {
  assertString(value, 'task result artifact path');
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || /[<>:"|?*]/.test(value)) throw new Error('Artifact path must be a safe relative path');
  const parts = value.split('/'); if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Artifact path must remain contained');
  const resolved = pathApi(policy.artifactDir).join(policy.artifactDir, ...parts); if (!isPathWithin(resolved, policy.artifactDir)) throw new Error('Artifact path must remain contained');
  return value;
}
function resultChecks(value: unknown): Readonly<Record<string, TerminalState>> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error('Invalid task result checks');
  const checks: Record<string, TerminalState> = {};
  for (const [name, state] of Object.entries(value)) {
    if (!CHECK_NAME_RE.test(name) || (state !== 'PASS' && state !== 'FAIL' && state !== 'UNKNOWN')) throw new Error('Invalid task result checks');
    checks[name] = state;
  }
  return Object.freeze(checks);
}

/** Pure durable-result validator; it does not read result or artifact bytes. */
export function validateTaskResult(value: unknown, binding: CodexWorkerContract | CodexWorkerIdentity, rootPolicyOrOptions?: SyntheticRootPolicy | ResultValidationOptions, options: ResultValidationOptions = {}): CodexTaskResult {
  const policy = 'rootPolicy' in binding ? binding.rootPolicy : rootPolicyOrOptions && 'root' in rootPolicyOrOptions ? rootPolicyOrOptions : undefined;
  const validationOptions = rootPolicyOrOptions && !('root' in rootPolicyOrOptions) ? rootPolicyOrOptions : options;
  if (!policy) throw new Error('Task result validation requires synthetic root policy');
  assertRootPolicy(policy);
  if (validationOptions.resultAlreadyExists === true) throw new Error('Duplicate task result');
  if (validationOptions.resultAlreadyExists !== false) throw new Error('Result slot must be observed empty');
  if (!isRecord(value)) throw new Error('Invalid task result');
  exactKeys(value, ['schemaVersion', 'candidateId', 'runId', 'workerId', 'taskId', 'taskDigest', 'sourceCheckpoint', 'result', 'checks', 'artifacts'], 'task result');
  if (value.schemaVersion !== CODEX_WORKER_RESULT_SCHEMA_VERSION) throw new Error('Invalid task result schemaVersion');
  const expected = identityOf(binding); assertId(value.candidateId, 'task result candidateId'); assertId(value.runId, 'task result runId'); assertId(value.workerId, 'task result workerId'); assertId(value.taskId, 'task result taskId');
  const actualSource = normalizeSourceCheckpoint(value.sourceCheckpoint); const actualDigest = sha256(value.taskDigest, 'task result taskDigest');
  if (value.candidateId !== expected.candidateId || value.runId !== expected.runId || value.workerId !== expected.workerId || value.taskId !== expected.taskId || actualDigest !== expected.taskDigest || !sourceEqual(actualSource, expected.sourceCheckpoint)) throw new Error('Stale or conflicting task result identity');
  if (value.result !== 'PASS' && value.result !== 'FAIL' && value.result !== 'UNKNOWN') throw new Error('Invalid task result state');
  const checks = resultChecks(value.checks); const states = Object.values(checks);
  if ((value.result === 'PASS' && states.some(state => state !== 'PASS')) || (value.result === 'FAIL' && !states.includes('FAIL')) || (value.result === 'UNKNOWN' && !states.includes('UNKNOWN'))) throw new Error('Task result state conflicts with checks');
  if (!Array.isArray(value.artifacts)) throw new Error('Invalid task result artifacts');
  const seen = new Set<string>();
  const artifacts = value.artifacts.map(item => {
    if (!isRecord(item)) throw new Error('Invalid task result artifact'); exactKeys(item, ['path', 'sha256'], 'task result artifact');
    const path = artifactPath(policy, item.path);
    const duplicateKey = pathKind(policy.artifactDir) === 'win32' ? path.toLowerCase() : path;
    if (seen.has(duplicateKey)) throw new Error('Duplicate task result artifact'); seen.add(duplicateKey);
    return Object.freeze({ path, sha256: sha256(item.sha256, 'task result artifact SHA256') });
  });
  return Object.freeze({ ...expected, schemaVersion: CODEX_WORKER_RESULT_SCHEMA_VERSION, result: value.result, checks, artifacts: Object.freeze(artifacts) });
}

export interface TerminalObservation { durableResult: TerminalState | 'ABSENT' | 'INVALID' | 'DUPLICATE'; processExitCode: number | null; cleanup: 'VERIFIED_EMPTY' | 'UNVERIFIED' }
export interface TerminalClassification { state: TerminalState; reason: string }
/** Process exit is supporting evidence only; it never substitutes for a result. */
export function classifyTerminal(o: TerminalObservation): TerminalClassification {
  if (o.durableResult === 'ABSENT' || o.durableResult === 'INVALID' || o.durableResult === 'DUPLICATE') return { state: 'UNKNOWN', reason: 'durable-result-missing-or-invalid' };
  if (o.durableResult === 'UNKNOWN') return { state: 'UNKNOWN', reason: 'durable-result-unknown' };
  if (o.cleanup !== 'VERIFIED_EMPTY') return { state: 'UNKNOWN', reason: 'cleanup-unverified' };
  if (o.durableResult === 'PASS' && o.processExitCode !== 0) return { state: 'UNKNOWN', reason: 'pass-result-and-process-exit-conflict' };
  return o.durableResult === 'PASS' ? { state: 'PASS', reason: 'durable-pass-and-verified-cleanup' } : { state: 'FAIL', reason: 'durable-fail-and-verified-cleanup' };
}
/** Observable no-progress signals only; no retry/recovery/takeover decision is made. */
export function classifyNoProgress(signals: readonly NoProgressSignal[]): 'NONE' | 'UNKNOWN' {
  const known = new Set<NoProgressSignal>(['NO_OUTPUT_WITHIN_BOUND', 'NO_HEARTBEAT_WITHIN_BOUND', 'NO_DURABLE_RESULT', 'PROCESS_EXIT_WITHOUT_RESULT']); const seen = new Set<NoProgressSignal>();
  for (const signal of signals) { if (!known.has(signal)) throw new Error('Invalid no-progress signal'); if (seen.has(signal)) throw new Error('Duplicate no-progress signal'); seen.add(signal); }
  return signals.length ? 'UNKNOWN' : 'NONE';
}

interface GateValue { state: AdmissionState; reason: string }
const ready = (reason: string): GateValue => ({ state: 'READY', reason }); const blocked = (reason: string): GateValue => ({ state: 'BLOCKED', reason }); const unknown = (reason: string): GateValue => ({ state: 'UNKNOWN', reason });
const wrapGate = (value: GateValue): AdmissionGate => ({ required: true, ...value });
function ownership(value: OwnershipObservation): GateValue { return value === 'VERIFIED' ? ready('verified') : value === 'UNKNOWN' ? unknown('evidence is unknown') : blocked('requirement is unverified'); }
function evaluateExecutable(c: CodexWorkerContract, e?: ExecutableIdentityEvidence): GateValue {
  if (!e) return unknown('canonical executable evidence not supplied');
  if (!isCanonicalAbsolutePath(e.canonicalPath) || e.canonicalPath !== c.executable.executablePath || e.regularFile !== true || e.resolution !== 'absolute-direct') return blocked('approved absolute regular executable/direct resolution proof failed');
  if (e.version !== c.executable.version) return blocked('Codex CLI version mismatch');
  return HEX_SHA256_RE.test(e.executableSha256) && e.executableSha256.toLowerCase() === c.executable.executableSha256 ? ready('approved absolute regular executable matches version and SHA256') : blocked('Codex executable SHA256 mismatch');
}
function evaluateTask(c: CodexWorkerContract, e?: TaskIdentityEvidence): GateValue { if (!e) return unknown('task identity evidence not supplied'); return e.taskId === c.taskId && SHA256_RE.test(e.taskDigest) && e.taskDigest === c.taskDigest ? ready('taskId and taskDigest match') : blocked('task identity mismatch'); }
function evaluateSource(c: CodexWorkerContract, e?: SourceCheckpointIdentity): GateValue { if (!e) return unknown('source checkpoint evidence not supplied'); try { return sourceEqual(normalizeSourceCheckpoint(e), c.sourceCheckpoint) ? ready('repository, commit, and tree checkpoint match') : blocked('source checkpoint mismatch'); } catch { return blocked('invalid source checkpoint evidence'); } }
function evaluateRoot(c: CodexWorkerContract, e?: RootPolicyEvidence): GateValue {
  if (!e) return unknown('synthetic root evidence not supplied'); const same = e.root === c.rootPolicy.root && e.projectDir === c.rootPolicy.projectDir && e.workDir === c.rootPolicy.workDir && e.artifactDir === c.rootPolicy.artifactDir && e.resultPath === c.rootPolicy.resultPath;
  return same && e.canonical === true && e.directories === true && e.linkFree === true ? ready('synthetic root and fixed scope are canonical and link-free') : blocked('synthetic root proof failed');
}
function evaluateEnvironment(c: CodexWorkerContract, e?: EnvironmentPolicyEvidence): GateValue {
  if (!e) return unknown('bounded environment evidence not supplied'); const env = e.env; const keys = Object.keys(env).sort(); const expected = [...CODEX_ENV_ALLOWLIST].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i]) || keys.some(isCredentialLikeEnvironmentKey)) return blocked('environment is not the fixed credential-free allowlist');
  if (typeof env.PATH !== 'string' || !env.PATH || /\x00/.test(env.PATH)) return blocked('PATH must be explicit and non-empty');
  if (!isCanonicalAbsolutePath(env.SYSTEMROOT) || isPathWithin(env.SYSTEMROOT, c.rootPolicy.root)) return blocked('SYSTEMROOT must be an explicit host directory outside the synthetic root');
  const p = c.environmentPolicy.dedicatedPaths;
  if (env.HOME !== p.HOME || env.USERPROFILE !== p.USERPROFILE || env.TEMP !== p.TEMP || env.TMP !== p.TMP || env.CODEX_HOME !== p.CODEX_HOME || env.TERM !== 'xterm-256color' || env.COLORTERM !== 'truecolor' || env.FORCE_COLOR !== '1') return blocked('dedicated environment values do not match policy');
  return [env.HOME, env.USERPROFILE, env.TEMP, env.TMP, env.CODEX_HOME].every(value => isCanonicalAbsolutePath(value) && isPathWithin(value, c.rootPolicy.root)) ? ready('environment uses only the explicit bounded allowlist') : blocked('dedicated environment paths leave the synthetic root');
}
function evaluateCredentials(c: CodexWorkerContract, e?: CredentialPolicyEvidence): GateValue {
  if (!e) return blocked('credential policy requires explicit runtime disposition');
  const flags = [e.dailyAuthJsonAccessed, e.dailyConfigTomlAccessed, e.credentialLikeEnvironmentPresent, e.providerSecretsPresent, e.dedicatedPreprovisioned, e.handoffAuthorized];
  if (flags.some(flag => typeof flag !== 'boolean')) return unknown('credential policy evidence is incomplete');
  if (e.mode !== c.credentialPolicy.mode || e.dailyAuthJsonAccessed || e.dailyConfigTomlAccessed || e.credentialLikeEnvironmentPresent || e.providerSecretsPresent) return blocked('daily credentials, credential-like environment, or provider secret access is forbidden');
  if (c.credentialPolicy.mode === 'NONE') return !e.dedicatedPreprovisioned && !e.handoffAuthorized ? ready('no credentials and no credential handoff') : blocked('NONE credential mode cannot carry a credential handoff');
  return e.dedicatedPreprovisioned && e.handoffAuthorized ? ready('dedicated credential handoff is explicitly authorized') : blocked('dedicated preprovisioned credential handoff is not authorized');
}
function evaluateNetwork(e?: NetworkPolicyEvidence): GateValue {
  if (!e) return blocked('provider network authority is not admitted'); if (e.impliedByFullAccess) return blocked('Full Access does not grant network authority');
  if (e.impliedByFullAccess !== false) return unknown('network authority evidence is incomplete');
  if (e.providerNetworkAuthority === 'UNKNOWN' || e.endpointEnforcement === 'UNKNOWN') return unknown('provider network or endpoint evidence is unknown');
  return e.providerNetworkAuthority === 'AUTHORIZED' && e.endpointEnforcement === 'APPROVED' ? ready('provider authority and endpoint enforcement are separately approved') : blocked('provider network authority or endpoint enforcement is not approved');
}
function evaluateProcess(e?: ProcessOwnershipEvidence): GateValue {
  if (!e) return blocked('creation-time PTY/Job ownership is not implemented or verified'); const checks = [ownership(e.ptyAtCreation), ownership(e.descendants), ownership(e.stop), ownership(e.timeout), ownership(e.cleanup)];
  if (e.platform === 'win32') { if (e.windowsJobAtCreation === 'NOT_APPLICABLE') return blocked('Windows Job ownership is required'); checks.push(ownership(e.windowsJobAtCreation)); }
  else if (e.platform === 'posix' && e.windowsJobAtCreation !== 'NOT_APPLICABLE') checks.push(ownership(e.windowsJobAtCreation)); else if (e.platform !== 'posix') return blocked('invalid process platform');
  return checks.some(x => x.state === 'BLOCKED') ? blocked('process ownership/stop/timeout/cleanup gate failed') : checks.some(x => x.state === 'UNKNOWN') ? unknown('process ownership evidence is incomplete') : ready('PTY, descendant, stop, timeout, and cleanup ownership are verified');
}
function evaluateResult(c: CodexWorkerContract, e?: ResultPolicyEvidence): GateValue {
  if (!e) return blocked('durable result consumer/admission is not connected'); const locations = e.resultPath === c.resultPolicy.resultPath && e.artifactDir === c.resultPolicy.artifactDir; const all = e.resultSlotAvailable && e.validatorBound && e.artifactContainmentBound && e.duplicateRejected && e.consumerReady;
  return locations && all ? ready('fresh durable result slot and validator acceptance are bound') : blocked('durable result slot or validator acceptance gate failed');
}
function evaluateAuthority(e?: AuthorityEvidence): GateValue {
  if (!e) return blocked('runtime authority/permit is absent'); if (e.runtimePermit === 'UNKNOWN') return unknown('runtime permit status is unknown');
  return e.runtimePermit === 'PRESENT' && e.sourceCheckpointApproved && e.identityApproved && e.humanApproved ? ready('source, identity, Human approval, and runtime permit match') : blocked('source, identity, Human approval, or runtime permit is not admitted');
}
export function evaluateCodexAdmission(c: CodexWorkerContract, e: CodexAdmissionEvidence = {}): AdmissionDecision {
  const gates: Record<AdmissionGateName, AdmissionGate> = {
    executableIdentity: wrapGate(evaluateExecutable(c, e.executableIdentity)), taskIdentity: wrapGate(evaluateTask(c, e.taskIdentity)), sourceIdentity: wrapGate(evaluateSource(c, e.sourceIdentity)), rootPolicy: wrapGate(evaluateRoot(c, e.rootPolicy)), environmentPolicy: wrapGate(evaluateEnvironment(c, e.environmentPolicy)), credentialPolicy: wrapGate(evaluateCredentials(c, e.credentialPolicy)), networkPolicy: wrapGate(evaluateNetwork(e.networkPolicy)), processOwnership: wrapGate(evaluateProcess(e.processOwnership)), resultPolicy: wrapGate(evaluateResult(c, e.resultPolicy)), authority: wrapGate(evaluateAuthority(e.authority))
  };
  const values = Object.values(gates); const state: AdmissionState = values.some(g => g.state === 'BLOCKED') ? 'BLOCKED' : values.some(g => g.state === 'UNKNOWN') ? 'UNKNOWN' : 'READY';
  return Object.freeze({ state, runtimeReady: state === 'READY', gates: Object.freeze(gates) });
}
export const evaluateAdmission = evaluateCodexAdmission;
