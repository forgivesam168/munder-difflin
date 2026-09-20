/** Main-only provider preflight and identity-bound bridge to the existing bounded
 * mint/consume lifecycle. Admission evidence never grants invocation authority.
 * Main keeps its bridge issuer private; production supplies no launch ticket.
 * No credential or network authority is inferred or upgraded. Native ownership
 * and durable acceptance remain per-run obligations of the bounded consumer.
 */

import {
  createCodexWorkerContract,
  evaluateCodexAdmission,
  isCanonicalAbsolutePath,
  normalizeCodexExecutableDescriptor,
  normalizeSourceCheckpoint,
  type AdmissionDecision,
  type AdmissionGateName,
  type AdmissionState,
  type AuthorityEvidence,
  type CodexExecutableDescriptor,
  type CodexWorkerContract,
  type CoreWorkerIdentity,
  type CredentialMode,
  type CredentialPolicyEvidence,
  type ExecutableIdentityEvidence,
  type NetworkPolicyEvidence,
  type OwnershipObservation,
  type ProcessOwnershipEvidence,
  type ResultPolicyEvidence,
  type RootPolicyEvidence
} from './codexWorkerContract';
import { buildCodexWorkerEnv, validateCodexWorkerEnv, type CodexWorkerEnvironmentInput } from './ptyEnv';
import { buildCodexWorkerLaunch, type CodexWorkerLaunch } from './workerLaunch';
import { assertPreparedBoundedWorker, prepareBoundedWorker, publishBoundedWorkerTaskResult, publishRecognizedProviderCompletion, type BoundedWorkerPermit, type PreparedBoundedWorker } from './boundedWorker';
import { assertProviderExecutionPreparation, assertProviderNetworkAuthority, providerExecutionEvidence, type ProviderExecutionEvidence } from './providerExecutionPreparation';

export const PROVIDER_PREFLIGHT_SCHEMA_VERSION = 1 as const;

const PERMIT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX_SHA256_RE = /^[0-9A-Fa-f]{64}$/;

export type ProviderPermitState = 'PRESENT' | 'ABSENT' | 'EXPIRED' | 'UNKNOWN';
export type ProviderRuntimeBackendKind = 'BOUNDED_OWNED_PTY';

/**
 * Structural record of the ACCEPTED owned bounded runtime this preparation would
 * eventually run through (`PtyManager.spawnBounded` → `launchOwnedPty`). It names
 * an existing backend; it does not create one, and it carries no ownership
 * proof — creation-time PTY/Job ownership, descendants, stop, timeout, and
 * cleanup must arrive as observed `processOwnership` evidence.
 */
export interface OwnedBoundedRuntimeBackend {
  readonly runtime: ProviderRuntimeBackendKind;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly nativeScriptPath: string;
  readonly nativeScriptSha256: string;
  readonly nativeSourcePath: string;
  readonly nativeSourceSha256: string;
}

/**
 * The trusted runtime permit record, held in memory by Main. It is the only
 * authority to even consider a provider-backed preparation: the type literal
 * grants nothing, a missing record can never be upgraded by a caller's claim,
 * and an expired record is recorded as EXPIRED rather than quietly renewed.
 */
export interface ProviderWorkerPermit {
  readonly permitId: string;
  /** Epoch milliseconds; enforced at preparation time and never extended here. */
  readonly expiresAt: number;
  readonly ownedRuntimeBackend: OwnedBoundedRuntimeBackend;
  readonly humanApproved: true;
}

/**
 * The strict preparation input. Every field is a Main-held record or an explicit
 * Main observation; no field may be populated from a spawn request, worker
 * output, or any file a worker can write.
 */
export interface ProviderWorkerPreparationInput {
  readonly permit: ProviderWorkerPermit | null;
  readonly identity: CoreWorkerIdentity;
  /** The approved executable descriptor: absolute path, version, SHA256. */
  readonly executable: CodexExecutableDescriptor;
  /** Main's observation of that approved executable. This module never observes or runs it. */
  readonly executableIdentity: ExecutableIdentityEvidence;
  readonly syntheticRoot: string;
  /** Main's observation of the synthetic root. This module never touches the filesystem. */
  readonly rootPolicy: RootPolicyEvidence;
  /** Explicit bounded-environment inputs; there is no parent/host environment parameter. */
  readonly environment: CodexWorkerEnvironmentInput;
  readonly credentials: CredentialPolicyEvidence;
  readonly network: NetworkPolicyEvidence;
  readonly processOwnership: ProcessOwnershipEvidence;
  readonly resultConsumer: ResultPolicyEvidence;
  readonly authority: AuthorityEvidence;
}

/** One row of the ten-gate table, carrying the gate-specific disposition Main needs to display. */
export interface ProviderGateDisposition {
  readonly gate: AdmissionGateName;
  readonly required: true;
  readonly state: AdmissionState;
  readonly reason: string;
  /** Normalized disposition for this gate (credential mode/handoff, network authority/endpoint, …). */
  readonly disposition: string;
}

/**
 * The immutable preflight result: the bound contract, the fixed launch
 * descriptor, the explicit environment, the ten-gate admission, and the final
 * disposition.
 *
 * Admission readiness and invocation permission are TWO SEPARATE facts and must
 * never be conflated: `providerAdmissionReady` reports the ten-gate decision
 * (`admission.runtimeReady`), while `providerInvocationAllowed` is the literal
 * `false` — this slice grants NO invocation. A READY admission therefore cannot
 * be read as permission to invoke a provider.
 */
export interface ProviderWorkerPreflight {
  readonly schemaVersion: typeof PROVIDER_PREFLIGHT_SCHEMA_VERSION;
  readonly checkedAt: number;
  readonly permitId: string | null;
  /** Derived from the permit record, never from the caller's `runtimePermit` claim. */
  readonly permitState: ProviderPermitState;
  readonly contract: CodexWorkerContract;
  readonly launch: CodexWorkerLaunch;
  readonly env: Readonly<Record<string, string>>;
  readonly runtimeBackend: OwnedBoundedRuntimeBackend | null;
  readonly admission: AdmissionDecision;
  readonly gateTable: readonly ProviderGateDisposition[];
  readonly blockedGates: readonly AdmissionGateName[];
  /** The ten-gate admission decision only: exactly `admission.runtimeReady`. Not a permission. */
  readonly providerAdmissionReady: boolean;
  /** Literal `false`: provider invocation is NOT authorized in this slice, READY or not. */
  readonly providerInvocationAllowed: false;
  /** Literal: this slice grants no launch authority, even on a READY decision. */
  readonly launchAuthority: 'NOT_GRANTED';
  readonly launchable: false;
}

/**
 * Minted preflights. Membership in this module-private registry IS the object's
 * identity: a structurally identical object assembled from renderer IPC JSON, a
 * spread copy, or a re-parse is not a member, so no caller can forge admission.
 */
interface MintedPreflightState {
  readonly permitId: string | null;
  readonly admissionState: AdmissionState;
  readonly blockedGates: readonly AdmissionGateName[];
  readonly expiresAt: number;
}

const MINTED_PREFLIGHTS = new WeakMap<object, MintedPreflightState>();

/**
 * Assertion/narrowing for the trusted in-memory ingestion seam. This is the ONLY
 * accepted provenance for a provider preflight; a forged or structural copy is
 * refused outright rather than silently downgraded.
 */
export function assertProviderWorkerPreflight(value: unknown): asserts value is ProviderWorkerPreflight {
  if (typeof value !== 'object' || value === null || !MINTED_PREFLIGHTS.has(value)) {
    throw new Error('Provider worker preflight was not minted by prepareProviderBackedWorker');
  }
}

/** Non-throwing membership inspection. `minted: false` is reported as such, never guessed at. */
export interface ProviderWorkerPreflightInspection {
  readonly minted: boolean;
  readonly permitId: string | null;
  readonly admissionState: AdmissionState | null;
  readonly blockedGates: readonly AdmissionGateName[];
  /** Literal: inspection never confers launch authority. */
  readonly launchAuthority: 'NOT_GRANTED';
}

export function inspectProviderWorkerPreflight(value: unknown): ProviderWorkerPreflightInspection {
  const state = typeof value === 'object' && value !== null ? MINTED_PREFLIGHTS.get(value) ?? null : null;
  return Object.freeze({
    minted: state !== null,
    permitId: state === null ? null : state.permitId,
    admissionState: state === null ? null : state.admissionState,
    blockedGates: state === null ? Object.freeze([] as AdmissionGateName[]) : state.blockedGates,
    launchAuthority: 'NOT_GRANTED' as const
  });
}

/** The only two dispositions this slice can produce. Neither one launches. */
export type ProviderLaunchStatus = 'BLOCKED' | 'READY_BUT_LAUNCH_NOT_GRANTED';

export interface ProviderWorkerLaunchDecision {
  readonly status: ProviderLaunchStatus;
  /** Literal: this slice grants no launch authority on either disposition. */
  readonly launchAuthority: 'NOT_GRANTED';
  readonly launchable: false;
  readonly blockedGates: readonly AdmissionGateName[];
  /** Human-facing, explicit, and safe to surface as a spawn failure. */
  readonly reason: string;
}

/**
 * The production launch decision for an already-minted preflight. It performs NO
 * effects: no filesystem access, no process launch, no provider contact, and no
 * `PreparedBoundedWorker` minting. A forged/structural object is refused (throws);
 * a genuine BLOCKED or READY preflight both return `launchable: false` with an
 * explicit reason. Only a separate Main-held bridge ticket can grant launch.
 */
export function decideProviderWorkerLaunch(value: unknown): ProviderWorkerLaunchDecision {
  assertProviderWorkerPreflight(value);
  const state = MINTED_PREFLIGHTS.get(value) as MintedPreflightState;
  if (state.blockedGates.length > 0) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      launchAuthority: 'NOT_GRANTED' as const,
      launchable: false as const,
      blockedGates: state.blockedGates,
      reason: `provider-backed worker preflight is BLOCKED at ${state.blockedGates.length} gate(s): ${state.blockedGates.join(', ')}; provider invocation is NOT authorized and providerInvocationAllowed is false; no provider process is started`
    });
  }
  return Object.freeze({
    status: 'READY_BUT_LAUNCH_NOT_GRANTED' as const,
    launchAuthority: 'NOT_GRANTED' as const,
    launchable: false as const,
    blockedGates: Object.freeze([] as AdmissionGateName[]),
    reason: 'provider-backed worker admission is READY but launch authority is NOT_GRANTED in this slice; provider invocation is NOT authorized and providerInvocationAllowed is false; the launch bridge to the bounded owned runtime is not authorized; no provider process is started'
  });
}

const SPENT_PREFLIGHTS = new WeakSet<object>();

/** Main owns this closure; neither the issuer nor its tickets belong in spawn data. */
export function createProviderWorkerBridge() {
  const tickets = new WeakMap<object, { preflight: ProviderWorkerPreflight; permit: BoundedWorkerPermit; execution: unknown; networkAuthority: unknown }>();
  return Object.freeze({
    authorize(preflight: ProviderWorkerPreflight, permit: BoundedWorkerPermit, networkAuthority: unknown, execution?: unknown): object {
      assertProviderWorkerPreflight(preflight);
      if (!preflight.providerAdmissionReady) throw new Error(decideProviderWorkerLaunch(preflight).reason);
      assertProviderExecutionPreparation(execution, preflight.contract);
      assertProviderNetworkAuthority(networkAuthority, execution, preflight.contract);
      if (SPENT_PREFLIGHTS.has(preflight)) throw new Error('Provider preflight bridge right was already consumed');
      const ticket = Object.freeze({});
      // Snapshot only explicit Main-held permit data; no request data can issue a ticket.
      const snapshot = JSON.parse(JSON.stringify(permit)) as BoundedWorkerPermit;
      tickets.set(ticket, { preflight, permit: snapshot, execution, networkAuthority });
      return ticket;
    },
    prepare(value: unknown, ticket: unknown): PreparedBoundedWorker {
      assertProviderWorkerPreflight(value);
      if (!value.providerAdmissionReady) throw new Error(decideProviderWorkerLaunch(value).reason);
      const entry = typeof ticket === 'object' && ticket !== null ? tickets.get(ticket) : undefined;
      if (!entry || entry.preflight !== value) throw new Error('Provider bridge authority is absent or does not match preflight');
      if (SPENT_PREFLIGHTS.has(value)) throw new Error('Provider preflight bridge right was already consumed');
      const state = MINTED_PREFLIGHTS.get(value)!;
      if (Date.now() > state.expiresAt) throw new Error('Provider preflight permit expired before bridge');
      tickets.delete(ticket as object);
      SPENT_PREFLIGHTS.add(value);
      assertProviderExecutionPreparation(entry.execution, value.contract);
      const binding = Object.freeze({ preflight: value, expiresAt: state.expiresAt, execution: entry.execution,
        networkAuthority: entry.networkAuthority, evidence: providerExecutionEvidence(entry.execution, value.contract) });
      BRIDGE_BINDINGS.set(binding, binding);
      return prepareBoundedWorker(entry.permit, binding);
    }
  });
}

/** Trusted Main structured-result adapter, never an output/exit callback. Creation grants
 * no launch or acceptance authority; publication still requires consumed preparation.
 * Local provider-free preparations exercise this same seam without provider execution. */
export function createProviderTaskResultAdapter(prepared: PreparedBoundedWorker) {
  assertPreparedBoundedWorker(prepared);
  return Object.freeze({
    publish(result: unknown): void { publishBoundedWorkerTaskResult(prepared, result); }
  });
}

/** Separate recognized structured-completion capability; terminal output and exit have no issuer. */
export function createRecognizedProviderCompletionIssuer(prepared: PreparedBoundedWorker) {
  assertPreparedBoundedWorker(prepared);
  return Object.freeze({
    publish(event: unknown): void { publishRecognizedProviderCompletion(prepared, event); }
  });
}

const BRIDGE_BINDINGS = new WeakMap<object, { readonly preflight: ProviderWorkerPreflight; readonly expiresAt: number; readonly execution: unknown; readonly networkAuthority: unknown; readonly evidence: ProviderExecutionEvidence }>();

/** Internal bounded preparation ingestion: structural objects never cross this seam. */
export function consumeProviderWorkerBridge(value: unknown) {
  const binding = typeof value === 'object' && value !== null ? BRIDGE_BINDINGS.get(value) : undefined;
  if (!binding) throw new Error('Provider bridge binding was not minted or was already consumed');
  BRIDGE_BINDINGS.delete(value as object);
  if (Date.now() > binding.expiresAt) throw new Error('Provider bridge binding expired');
  return binding;
}

function refuse(message: string): never {
  throw new Error(message);
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') refuse(`Invalid ${label}`);
  return value;
}

/** Text at a parse boundary: bounded, non-empty, and free of control characters. */
function textOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) refuse(`Invalid ${label}`);
  return value;
}

function sha256Of(value: unknown, label: string): string {
  const text = textOf(value, label);
  if (!HEX_SHA256_RE.test(text)) refuse(`Invalid ${label}`);
  return text.toLowerCase();
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) refuse(`Invalid ${label}`);
  return value as T;
}

function localPathOf(value: unknown, label: string): string {
  if (!isCanonicalAbsolutePath(value)) refuse(`${label} must be a canonical absolute path`);
  return value;
}

function readBackend(value: unknown): OwnedBoundedRuntimeBackend {
  const backend = objectOf(value, 'provider worker owned runtime backend');
  return Object.freeze({
    runtime: enumOf(backend.runtime, ['BOUNDED_OWNED_PTY'] as const, 'owned runtime backend kind'),
    helperPath: localPathOf(backend.helperPath, 'Owned runtime helper path'),
    helperSha256: sha256Of(backend.helperSha256, 'Owned runtime helper SHA256'),
    nativeScriptPath: localPathOf(backend.nativeScriptPath, 'Owned runtime native script path'),
    nativeScriptSha256: sha256Of(backend.nativeScriptSha256, 'Owned runtime native script SHA256'),
    nativeSourcePath: localPathOf(backend.nativeSourcePath, 'Owned runtime native source path'),
    nativeSourceSha256: sha256Of(backend.nativeSourceSha256, 'Owned runtime native source SHA256')
  });
}

function readPermit(value: unknown): { readonly permitId: string; readonly expiresAt: number; readonly ownedRuntimeBackend: OwnedBoundedRuntimeBackend } {
  const permit = objectOf(value, 'provider worker permit record');
  const permitId = textOf(permit.permitId, 'Provider worker permitId');
  if (!PERMIT_ID_RE.test(permitId)) refuse('Invalid provider worker permitId');
  if (typeof permit.expiresAt !== 'number' || !Number.isSafeInteger(permit.expiresAt)) {
    refuse('Invalid provider worker permit expiry');
  }
  if (permit.humanApproved !== true) refuse('Provider worker permit record lacks the Human authorization record');
  return Object.freeze({ permitId, expiresAt: permit.expiresAt, ownedRuntimeBackend: readBackend(permit.ownedRuntimeBackend) });
}

/** Permit state comes from the record alone; a caller's claim can never upgrade it. */
function permitState(permit: unknown, now: number): ProviderPermitState {
  if (permit === null || permit === undefined) return 'ABSENT';
  return now > readPermit(permit).expiresAt ? 'EXPIRED' : 'PRESENT';
}

/**
 * Only a caller claim AND a live record may both say PRESENT; anything else fails
 * closed, and the stricter of the two wins, so a claim can never manufacture
 * authority the record does not carry.
 */
function effectiveRuntimePermit(claim: ProviderPermitState, derived: ProviderPermitState): ProviderPermitState {
  if (claim === 'PRESENT' && derived === 'PRESENT') return 'PRESENT';
  if (claim === 'UNKNOWN' || derived === 'UNKNOWN') return 'UNKNOWN';
  return claim === 'PRESENT' ? derived : claim;
}

/** The claim is read first and is never trusted; the derived record state is authoritative. */
function readAuthority(value: unknown, derivedPermit: ProviderPermitState): AuthorityEvidence {
  const authority = objectOf(value, 'provider worker authority evidence');
  const claim = enumOf(authority.runtimePermit, ['PRESENT', 'ABSENT', 'EXPIRED', 'UNKNOWN'] as const, 'authority runtimePermit');
  return Object.freeze({
    sourceCheckpointApproved: booleanOf(authority.sourceCheckpointApproved, 'authority sourceCheckpointApproved'),
    identityApproved: booleanOf(authority.identityApproved, 'authority identityApproved'),
    humanApproved: booleanOf(authority.humanApproved, 'authority humanApproved'),
    runtimePermit: effectiveRuntimePermit(claim, derivedPermit)
  });
}

/** Provider-backed preparation reuses the accepted DEDICATED_PREPROVISIONED credential mode. */
function readCredentials(value: unknown): CredentialPolicyEvidence {
  const credentials = objectOf(value, 'provider worker credential disposition');
  const mode: CredentialMode = enumOf(credentials.mode, ['NONE', 'DEDICATED_PREPROVISIONED'] as const, 'credential mode');
  if (mode !== 'DEDICATED_PREPROVISIONED') {
    refuse('Provider-backed preparation requires the DEDICATED_PREPROVISIONED credential mode');
  }
  return Object.freeze({
    mode,
    dailyAuthJsonAccessed: booleanOf(credentials.dailyAuthJsonAccessed, 'credential dailyAuthJsonAccessed'),
    dailyConfigTomlAccessed: booleanOf(credentials.dailyConfigTomlAccessed, 'credential dailyConfigTomlAccessed'),
    credentialLikeEnvironmentPresent: booleanOf(credentials.credentialLikeEnvironmentPresent, 'credential credentialLikeEnvironmentPresent'),
    providerSecretsPresent: booleanOf(credentials.providerSecretsPresent, 'credential providerSecretsPresent'),
    dedicatedPreprovisioned: booleanOf(credentials.dedicatedPreprovisioned, 'credential dedicatedPreprovisioned'),
    handoffAuthorized: booleanOf(credentials.handoffAuthorized, 'credential handoffAuthorized')
  });
}

/** Full Access never grants network: an `impliedByFullAccess: true` disposition is refused outright. */
function readNetwork(value: unknown): NetworkPolicyEvidence {
  const network = objectOf(value, 'provider worker network disposition');
  if (network.impliedByFullAccess !== false) refuse('Full Access does not grant provider network authority');
  return Object.freeze({
    providerNetworkAuthority: enumOf(network.providerNetworkAuthority, ['AUTHORIZED', 'NOT_AUTHORIZED', 'UNKNOWN'] as const, 'network providerNetworkAuthority'),
    endpointEnforcement: enumOf(network.endpointEnforcement, ['APPROVED', 'OPEN_DECISION', 'UNKNOWN'] as const, 'network endpointEnforcement'),
    impliedByFullAccess: false as const
  });
}

function readOwnership(value: unknown): ProcessOwnershipEvidence {
  const ownership = objectOf(value, 'provider worker process-ownership disposition');
  const job = ownership.windowsJobAtCreation === 'NOT_APPLICABLE'
    ? 'NOT_APPLICABLE' as const
    : enumOf<OwnershipObservation>(ownership.windowsJobAtCreation, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process windowsJobAtCreation');
  return Object.freeze({
    platform: enumOf(ownership.platform, ['win32', 'posix'] as const, 'process platform'),
    ptyAtCreation: enumOf<OwnershipObservation>(ownership.ptyAtCreation, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process ptyAtCreation'),
    windowsJobAtCreation: job,
    descendants: enumOf<OwnershipObservation>(ownership.descendants, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process descendants'),
    stop: enumOf<OwnershipObservation>(ownership.stop, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process stop'),
    timeout: enumOf<OwnershipObservation>(ownership.timeout, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process timeout'),
    cleanup: enumOf<OwnershipObservation>(ownership.cleanup, ['VERIFIED', 'UNVERIFIED', 'UNKNOWN'] as const, 'process cleanup')
  });
}

function readResultConsumer(value: unknown): ResultPolicyEvidence {
  const result = objectOf(value, 'provider worker result-consumer disposition');
  return Object.freeze({
    resultPath: textOf(result.resultPath, 'result-consumer resultPath'),
    artifactDir: textOf(result.artifactDir, 'result-consumer artifactDir'),
    resultSlotAvailable: booleanOf(result.resultSlotAvailable, 'result-consumer resultSlotAvailable'),
    validatorBound: booleanOf(result.validatorBound, 'result-consumer validatorBound'),
    artifactContainmentBound: booleanOf(result.artifactContainmentBound, 'result-consumer artifactContainmentBound'),
    duplicateRejected: booleanOf(result.duplicateRejected, 'result-consumer duplicateRejected'),
    consumerReady: booleanOf(result.consumerReady, 'result-consumer consumerReady')
  });
}

/** Evidence contradicting an approved descriptor is a contract violation, not a decision. */
function readExecutableIdentity(value: unknown, contract: CodexWorkerContract): ExecutableIdentityEvidence {
  const evidence = objectOf(value, 'provider worker executable evidence');
  if (evidence.canonicalPath !== contract.executable.executablePath
    || evidence.version !== contract.executable.version
    || typeof evidence.executableSha256 !== 'string'
    || evidence.executableSha256.toLowerCase() !== contract.executable.executableSha256) {
    refuse('Provider executable evidence contradicts the approved executable descriptor');
  }
  return Object.freeze({
    canonicalPath: contract.executable.executablePath,
    regularFile: booleanOf(evidence.regularFile, 'executable evidence regularFile'),
    resolution: enumOf(evidence.resolution, ['absolute-direct', 'path', 'shim', 'unknown'] as const, 'executable evidence resolution'),
    version: contract.executable.version,
    executableSha256: contract.executable.executableSha256
  });
}

function readRootPolicy(value: unknown, contract: CodexWorkerContract): RootPolicyEvidence {
  const evidence = objectOf(value, 'provider worker synthetic root evidence');
  const policy = contract.rootPolicy;
  if (evidence.root !== policy.root || evidence.projectDir !== policy.projectDir || evidence.workDir !== policy.workDir
    || evidence.artifactDir !== policy.artifactDir || evidence.resultPath !== policy.resultPath) {
    refuse('Provider synthetic root evidence contradicts the approved root policy');
  }
  return Object.freeze({
    root: policy.root,
    projectDir: policy.projectDir,
    workDir: policy.workDir,
    artifactDir: policy.artifactDir,
    resultPath: policy.resultPath,
    canonical: booleanOf(evidence.canonical, 'root evidence canonical'),
    directories: booleanOf(evidence.directories, 'root evidence directories'),
    linkFree: booleanOf(evidence.linkFree, 'root evidence linkFree')
  });
}

/** True/false, lower-case: the gate dispositions are read by Humans. */
function flag(value: boolean): string {
  return value ? 'true' : 'false';
}

/**
 * Gate-specific disposition sufficient for Main to show exactly why credential,
 * network, endpoint, ownership, or durable-result admission is closed.
 */
function gateDispositions(input: {
  contract: CodexWorkerContract;
  evidence: ExecutableIdentityEvidence;
  rootPolicy: RootPolicyEvidence;
  env: Readonly<Record<string, string>>;
  credentials: CredentialPolicyEvidence;
  network: NetworkPolicyEvidence;
  ownership: ProcessOwnershipEvidence;
  resultConsumer: ResultPolicyEvidence;
  authority: AuthorityEvidence;
}): Readonly<Record<AdmissionGateName, string>> {
  const { contract, evidence, rootPolicy, env, credentials, network, ownership, resultConsumer, authority } = input;
  return Object.freeze({
    executableIdentity: `path=${contract.executable.executablePath} version=${contract.executable.version} sha256=${contract.executable.executableSha256} resolution=${evidence.resolution} regularFile=${flag(evidence.regularFile)} processStarted=NO`,
    taskIdentity: `taskId=${contract.taskId} taskDigest=${contract.taskDigest}`,
    sourceIdentity: `repositoryId=${contract.sourceCheckpoint.repositoryId} commit=${contract.sourceCheckpoint.commitSha} tree=${contract.sourceCheckpoint.treeSha}`,
    rootPolicy: `root=${rootPolicy.root} projectDir=${rootPolicy.projectDir} workDir=${rootPolicy.workDir} artifactDir=${rootPolicy.artifactDir} canonical=${flag(rootPolicy.canonical)} directories=${flag(rootPolicy.directories)} linkFree=${flag(rootPolicy.linkFree)}`,
    environmentPolicy: `keys=${Object.keys(env).length} hostInheritance=NONE credentialLikeVariables=${flag(credentials.credentialLikeEnvironmentPresent)}`,
    credentialPolicy: `mode=${credentials.mode} dailyAuthJsonAccessed=${flag(credentials.dailyAuthJsonAccessed)} dailyConfigTomlAccessed=${flag(credentials.dailyConfigTomlAccessed)} credentialLikeEnvironmentPresent=${flag(credentials.credentialLikeEnvironmentPresent)} providerSecretsPresent=${flag(credentials.providerSecretsPresent)} dedicatedPreprovisioned=${flag(credentials.dedicatedPreprovisioned)} handoffAuthorized=${flag(credentials.handoffAuthorized)}`,
    networkPolicy: `providerNetworkAuthority=${network.providerNetworkAuthority} endpointEnforcement=${network.endpointEnforcement} impliedByFullAccess=${flag(network.impliedByFullAccess)}`,
    processOwnership: `platform=${ownership.platform} ptyAtCreation=${ownership.ptyAtCreation} windowsJobAtCreation=${ownership.windowsJobAtCreation} descendants=${ownership.descendants} stop=${ownership.stop} timeout=${ownership.timeout} cleanup=${ownership.cleanup}`,
    resultPolicy: `resultPath=${resultConsumer.resultPath} artifactDir=${resultConsumer.artifactDir} resultSlotAvailable=${flag(resultConsumer.resultSlotAvailable)} validatorBound=${flag(resultConsumer.validatorBound)} artifactContainmentBound=${flag(resultConsumer.artifactContainmentBound)} duplicateRejected=${flag(resultConsumer.duplicateRejected)} consumerReady=${flag(resultConsumer.consumerReady)}`,
    authority: `runtimePermit=${authority.runtimePermit} sourceCheckpointApproved=${flag(authority.sourceCheckpointApproved)} identityApproved=${flag(authority.identityApproved)} humanApproved=${flag(authority.humanApproved)}`
  });
}

/**
 * Evaluate the ten-gate admission over explicit evidence only and return an
 * immutable preflight. Structurally invalid or contradictory input is REFUSED
 * (throws, producing no result); a legitimate but unauthorized input returns a
 * result whose gate table says exactly why, with `providerInvocationAllowed`
 * the literal `false` and `providerAdmissionReady` false on every blocked case.
 * Nothing is launched, minted, or contacted on either path.
 */
export function prepareProviderBackedWorker(input: ProviderWorkerPreparationInput): ProviderWorkerPreflight {
  const checkedAt = Date.now();

  const state = permitState(input.permit, checkedAt);
  const permit = state === 'ABSENT' ? null : readPermit(input.permit);
  const credentials = readCredentials(input.credentials);
  const network = readNetwork(input.network);
  const ownership = readOwnership(input.processOwnership);
  const resultConsumer = readResultConsumer(input.resultConsumer);
  const authority = readAuthority(input.authority, state);

  const contract = createCodexWorkerContract({
    ...input.identity,
    sourceCheckpoint: normalizeSourceCheckpoint(input.identity.sourceCheckpoint),
    executable: normalizeCodexExecutableDescriptor(input.executable),
    syntheticRoot: textOf(input.syntheticRoot, 'synthetic root'),
    credentialMode: credentials.mode
  });
  // Fixed absolute/non-shell invocation derived from the approved descriptor — never request-authored.
  const launch = buildCodexWorkerLaunch(contract.executable);
  const evidence = readExecutableIdentity(input.executableIdentity, contract);
  const rootPolicy = readRootPolicy(input.rootPolicy, contract);
  // Built from explicit inputs only; no host environment is read or merged.
  const env = validateCodexWorkerEnv(buildCodexWorkerEnv(input.environment), input.environment);

  const admission = evaluateCodexAdmission(contract, {
    executableIdentity: evidence,
    // The trusted Main input IS the identity binding; these are not worker-authored claims.
    taskIdentity: { taskId: contract.taskId, taskDigest: contract.taskDigest },
    sourceIdentity: contract.sourceCheckpoint,
    rootPolicy,
    environmentPolicy: { env },
    credentialPolicy: credentials,
    networkPolicy: network,
    processOwnership: ownership,
    resultPolicy: resultConsumer,
    authority
  });

  const dispositions = gateDispositions({
    contract, evidence, rootPolicy, env, credentials, network, ownership, resultConsumer, authority
  });
  const gateTable = Object.freeze((Object.keys(admission.gates) as AdmissionGateName[]).map(gate => Object.freeze({
    gate, required: true as const, state: admission.gates[gate].state, reason: admission.gates[gate].reason,
    disposition: dispositions[gate]
  })));
  const blockedGates = Object.freeze(gateTable.filter(row => row.state !== 'READY').map(row => row.gate));

  const result: ProviderWorkerPreflight = Object.freeze({
    schemaVersion: PROVIDER_PREFLIGHT_SCHEMA_VERSION,
    checkedAt,
    permitId: permit === null ? null : permit.permitId,
    permitState: state,
    contract,
    launch,
    env,
    runtimeBackend: permit === null ? null : permit.ownedRuntimeBackend,
    admission,
    gateTable,
    blockedGates,
    providerAdmissionReady: admission.runtimeReady,
    providerInvocationAllowed: false as const,
    launchAuthority: 'NOT_GRANTED' as const,
    launchable: false as const
  });
  MINTED_PREFLIGHTS.set(result, Object.freeze({
    expiresAt: permit === null ? 0 : permit.expiresAt,
    permitId: result.permitId,
    admissionState: admission.state,
    blockedGates
  }));
  return result;
}
