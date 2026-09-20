/**
 * B provider-free bounded worker: preparation-time admission plus the durable
 * result consumer. Main wires this into `PtyManager`, which owns the session.
 *
 * Scope: only a fixed local fixture executable and script against a fresh
 * synthetic root. The generic provider path stays closed — `evaluateCodexAdmission`
 * still requires provider network authority, and this module never fakes it.
 *
 * Honesty: the permit being Main-owned in-memory is the authority; the literal
 * `true` field is only a type-level reminder, not a grant. Every filesystem
 * fact is re-derived here (canonical shape, per-component link refusal, realpath
 * equality, single-link regular files, streamed SHA256, bounded bytes/entries),
 * but these are check-time observations, NOT an OS sandbox: concurrent
 * replacement between check and use is undetected.
 */

import { closeSync, existsSync, fsyncSync, fstatSync, linkSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { delimiter, dirname, join, parse, sep } from 'node:path';
import {
  createCodexWorkerContract, classifyTerminal, evaluateCodexAdmission, isCanonicalAbsolutePath,
  isCredentialLikeEnvironmentKey, isPathWithin, validateTaskResult,
  type AdmissionDecision, type AdmissionGateName, type AdmissionState, type AuthorityEvidence,
  type CodexTaskResult, type CodexWorkerContract, type CodexWorkerIdentity, type CredentialPolicyEvidence,
  type ExecutableIdentityEvidence, type NetworkPolicyEvidence,
  type ResultPolicyEvidence, type RootPolicyEvidence, type TerminalClassification, type TerminalState
} from './codexWorkerContract';
import { buildCodexWorkerEnv, validateCodexWorkerEnv, type CodexWorkerEnvironmentInput } from './ptyEnv';
import type { OwnedPtyLaunch, OwnedPtyReceipt } from './windowsOwnedPty';
import { consumeProviderWorkerBridge } from './providerWorker';
import { assertNoProviderSecretContent, consumeProviderExecutionPreparation, readProviderTaskDocument } from './providerExecutionPreparation';

/** Host acceptance receipt schema, written once per accepted identity. */
export const BOUNDED_WORKER_ACCEPTANCE_VERSION = 1 as const;

const HEX_SHA256_RE = /^[0-9a-f]{64}$/;
const PERMIT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Fixture mode token: positional, never flag-shaped, so it cannot inject argv. */
const FIXTURE_MODE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ACCEPTANCE_RECEIPT_RE = /^bounded-worker-[0-9a-f]{64}\.json$/;
const HASH_CHUNK_BYTES = 65_536;
const MAX_APPROVED_FILE_BYTES = 536_870_912;
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_ARTIFACT_DEPTH = 8;
/** The seven synthetic-root children `createSyntheticRootPolicy` derives. */
const EXPECTED_ROOT_ENTRIES = Object.freeze(['artifacts', 'codex-home', 'home', 'project', 'temp', 'user-profile', 'work']);
const FIXTURE_GATES: readonly AdmissionGateName[] = Object.freeze([
  'executableIdentity', 'taskIdentity', 'sourceIdentity', 'rootPolicy',
  'environmentPolicy', 'credentialPolicy', 'resultPolicy', 'authority'
]);
/** Gates preparation deliberately leaves unsettled: provider authority, and process ownership
 * (proven only by the native receipt, whose producer is hash-bound in `permit.ownedBackend`). */
const DEFERRED_GATES: readonly AdmissionGateName[] = Object.freeze(['networkPolicy', 'processOwnership']);

/** Bounded read budgets. Callers state them explicitly; every cap has a ceiling. */
export interface BoundedWorkerLimits {
  readonly maxResultBytes: number;
  readonly maxArtifactBytes: number;
  readonly maxArtifactTotalBytes: number;
  readonly maxArtifactCount: number;
}
const LIMIT_CEILINGS: BoundedWorkerLimits = Object.freeze({
  maxResultBytes: 1_048_576, maxArtifactBytes: 16_777_216, maxArtifactTotalBytes: 67_108_864, maxArtifactCount: 256
});

/** Fixed local fixture: an executable and the script it runs, both approved by hash. */
export interface BoundedWorkerFixture {
  readonly executablePath: string;
  readonly executableSha256: string;
  /** Recorded in the Codex executable descriptor; it is an approval field, not an observation. */
  readonly version: string;
  readonly scriptPath: string;
  readonly scriptSha256: string;
}

/**
 * The trusted permit, constructed by Main in memory from state it already
 * holds. No field is populated from spawn request, worker output, or a file the
 * worker can write; the request side is bound by digest equality only, and a
 * digest is not authority.
 *
 * `requestPath` is the fixture's request document (`{"contract": …}`) and doubles
 * as the identity input: the fixture receives its path and mode as argv, and the
 * bytes read from that path are bound by `requestSha256` — there is no separate
 * in-memory copy to trust. It lives OUTSIDE the worker-writable synthetic root,
 * typically a sibling of the receipt root. `humanApproved: true` records that
 * this permit is the Human-authorized scope; the type literal alone grants nothing.
 */
export interface BoundedWorkerPermit {
  readonly permitId: string;
  /** Epoch milliseconds. Enforced at prepare and at launch consumption, not at acceptance. */
  readonly expiresAt: number;
  readonly identity: CodexWorkerIdentity;
  readonly fixture: BoundedWorkerFixture;
  /** The fixture's request document path; outside the synthetic root, digest-bound below. */
  readonly requestPath: string;
  /** SHA256 of the request document's bytes, read from `requestPath` itself. */
  readonly requestSha256: string;
  /** Fixture mode token; equals `argv[2]`. */
  readonly mode: string;
  /** Exactly `[scriptPath, requestPath, mode]`; nothing else may appear. */
  readonly argv: readonly string[];
  readonly syntheticRoot: string;
  /** Host receipt directory: canonical, existing, and OUTSIDE the synthetic root. */
  readonly hostReceiptDir: string;
  /**
   * Native backend identity and bounds, minus the fields this module derives
   * (`executablePath`, `executableSha256`, `args`, `cwd`, `env`). Binding the
   * helper, native source, and script identities here — in the same immutable
   * permit, folded into the same binding digest — is what stops a minted
   * preparation from being launched against a caller-swapped helper.
   *
   * Its `helperEnv` is its OWN explicit map (never merged with, nor inherited
   * from, the host or the worker map). It must carry PATH plus HOME, USERPROFILE,
   * TEMP and TMP, and those directory values are canonical host directories
   * outside the synthetic root; APPDATA/LOCALAPPDATA are validated the same way
   * when present.
   */
  readonly ownedBackend: Omit<OwnedPtyLaunch, 'executablePath' | 'executableSha256' | 'args' | 'cwd' | 'env'>;
  /** Explicit PATH value; every entry must be a canonical empty directory inside the synthetic root. */
  readonly workerPath: string;
  readonly limits: BoundedWorkerLimits;
  readonly humanApproved: true;
}

/**
 * Provider-free admission disposition. It reuses the contract's identity, root,
 * environment, credential, result, and authority gates. It never claims provider
 * network authority, and it never claims process ownership at preparation time:
 * ownership is proven by the native receipt at acceptance, produced by the
 * backend whose identities and bounds are hash-bound in the permit.
 */
export interface ProviderFreeAdmission {
  /** Full ten-gate decision, computed with honest evidence. `networkPolicy` is BLOCKED by construction. */
  readonly decision: AdmissionDecision;
  /** Gates that decide whether the provider-free fixture may be launched. */
  readonly fixtureGates: readonly AdmissionGateName[];
  /** Aggregate over `fixtureGates` only; `prepareBoundedWorker` refuses to mint unless it is READY. */
  readonly state: AdmissionState;
  /** Literal: preparation never opens the generic provider path. */
  readonly providerRuntimeReady: false;
  /** Gates NOT settled by preparation, and never substituted for: provider authority, and process
   * ownership. Ownership is deferred to the native receipt, which is only trustworthy because the
   * backend producing it is bound by `permit.ownedBackend` and `prepared.launch`. */
  readonly providerBlockedGates: readonly AdmissionGateName[];
}

/** One verified durable artifact: its declared relative path, digest, and bounded size. */
export interface BoundedWorkerVerifiedArtifact { readonly path: string; readonly sha256: string; readonly bytes: number }

export interface BoundedWorkerAccepted {
  readonly outcome: 'ACCEPTED';
  readonly terminal: TerminalClassification;
  readonly result: CodexTaskResult;
  readonly resultSha256: string;
  readonly artifacts: readonly BoundedWorkerVerifiedArtifact[];
  readonly receiptPath: string;
  readonly receiptSha256: string;
  readonly bindingDigest: string;
}
export interface BoundedWorkerRejected {
  readonly outcome: 'MISSING' | 'INVALID' | 'DUPLICATE';
  readonly reason: string;
  readonly bindingDigest: string;
}
export type BoundedWorkerAcceptance = BoundedWorkerAccepted | BoundedWorkerRejected;

export interface BoundedWorkerAcceptanceError { readonly state: 'UNKNOWN'; readonly error: string }
export type BoundedWorkerRecoveryReason = 'STOP_REQUESTED' | 'DURABLE_PASS' | 'DURABLE_FAIL'
  | 'DUPLICATE_OR_CONFLICT' | 'PUBLICATION_OR_ACCEPTANCE_FAILURE' | 'NATIVE_RECEIPT_INVALID'
  | 'CLEANUP_UNVERIFIED' | 'PASS_EXIT_CONFLICT' | 'TIMEOUT' | 'HELPER_FAILURE' | 'LAUNCH_FAILURE'
  | 'RESULT_MISSING' | 'RESULT_INVALID' | 'TERMINAL_UNKNOWN';
export interface BoundedWorkerRecoveryDecision {
  readonly disposition: 'TERMINAL' | 'FRESH_ATTEMPT_ELIGIBLE' | 'RECONCILIATION_REQUIRED';
  readonly reason: BoundedWorkerRecoveryReason;
  readonly automaticAttempts: 0;
  readonly freshAttemptEligible: boolean;
  readonly providerNetwork: 'NOT_AUTHORIZED';
  readonly freshAttemptRequirements: {
    readonly authority: 'MAIN_ONLY';
    readonly distinct: readonly ['PreparedBoundedWorker', 'runId', 'workerId', 'permitId', 'syntheticRoot', 'resultSlot', 'hostReceiptBinding'];
    readonly contract: 'SAME_APPROVED_SOURCE_AND_TASK_UNLESS_MAIN_CREATES_NEW_TASK_CONTRACT';
    readonly admission: 'ALL_CHECKS_REQUIRED';
    readonly evidence: 'PRESERVE_WITHOUT_DELETE_OR_OVERWRITE';
  };
}
const FRESH_ATTEMPT_REQUIREMENTS: BoundedWorkerRecoveryDecision['freshAttemptRequirements'] = Object.freeze({
  authority: 'MAIN_ONLY',
  distinct: Object.freeze(['PreparedBoundedWorker', 'runId', 'workerId', 'permitId', 'syntheticRoot', 'resultSlot', 'hostReceiptBinding'] as const),
  contract: 'SAME_APPROVED_SOURCE_AND_TASK_UNLESS_MAIN_CREATES_NEW_TASK_CONTRACT',
  admission: 'ALL_CHECKS_REQUIRED', evidence: 'PRESERVE_WITHOUT_DELETE_OR_OVERWRITE'
});

/** Classification only: no filesystem effects, permit minting, or process launch. Eligibility
 * is not authority; unverified ownership must be reconciled before any fresh attempt. */
export function classifyBoundedWorkerRecovery(
  receipt: OwnedPtyReceipt, acceptance: BoundedWorkerAcceptance | BoundedWorkerAcceptanceError
): BoundedWorkerRecoveryDecision {
  const decision = (disposition: BoundedWorkerRecoveryDecision['disposition'], reason: BoundedWorkerRecoveryReason): BoundedWorkerRecoveryDecision => Object.freeze({
    disposition, reason, automaticAttempts: 0, freshAttemptEligible: disposition === 'FRESH_ATTEMPT_ELIGIBLE',
    providerNetwork: 'NOT_AUTHORIZED', freshAttemptRequirements: FRESH_ATTEMPT_REQUIREMENTS
  });
  let native: NativeObservation;
  try { native = readNativeObservation(receipt); }
  catch { return decision('RECONCILIATION_REQUIRED', 'NATIVE_RECEIPT_INVALID'); }
  // Stop never grants a rerun, including when acceptance itself failed.
  if (native.reason === 'stop') return decision('TERMINAL', 'STOP_REQUESTED');
  if ('error' in acceptance) return decision('RECONCILIATION_REQUIRED', 'PUBLICATION_OR_ACCEPTANCE_FAILURE');
  if (acceptance.outcome === 'DUPLICATE') return decision('RECONCILIATION_REQUIRED', 'DUPLICATE_OR_CONFLICT');
  if (native.activeProcessesFinal !== 0 || native.cleanupState !== 'VERIFIED_EMPTY'
    || !native.ioDrained || !native.pseudoConsoleClosed) return decision('RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED');
  if (acceptance.outcome === 'ACCEPTED') {
    if (acceptance.result.result === 'PASS' && native.rootExit !== 0) return decision('RECONCILIATION_REQUIRED', 'PASS_EXIT_CONFLICT');
    if (acceptance.result.result === 'FAIL') return decision('TERMINAL', 'DURABLE_FAIL');
    if (acceptance.terminal.state === 'PASS') return decision('TERMINAL', 'DURABLE_PASS');
  }
  if (native.reason === 'timeout') return decision('FRESH_ATTEMPT_ELIGIBLE', 'TIMEOUT');
  if (native.reason === 'helper-failure') return decision('FRESH_ATTEMPT_ELIGIBLE', 'HELPER_FAILURE');
  if (native.reason === 'launch-failure') return decision('FRESH_ATTEMPT_ELIGIBLE', 'LAUNCH_FAILURE');
  if (!native.rootJobMember || native.error) return decision('RECONCILIATION_REQUIRED', 'CLEANUP_UNVERIFIED');
  if (acceptance.outcome === 'MISSING') return decision('FRESH_ATTEMPT_ELIGIBLE', 'RESULT_MISSING');
  if (acceptance.outcome === 'INVALID') return decision('FRESH_ATTEMPT_ELIGIBLE', 'RESULT_INVALID');
  return decision('RECONCILIATION_REQUIRED', 'TERMINAL_UNKNOWN');
}

/**
 * The immutable launch binding. Main hands this object — never a serialized
 * copy — to the trusted in-memory caller that launches the PTY.
 */
export interface PreparedBoundedWorker {
  readonly permitId: string;
  readonly contract: CodexWorkerContract;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /**
   * The complete native launch, bound at minting: helper/native-script/native-source
   * identities and the timeout/cleanup bounds cannot be swapped by a later caller.
   */
  readonly launch: OwnedPtyLaunch;
  /** Binds identity + request digest + argv + executable/script/helper/native digests + root + env + bounds. */
  readonly bindingDigest: string;
  readonly admission: ProviderFreeAdmission | AdmissionDecision;
  /**
   * Durable result consumer, once-only, synchronous. Lifecycle is strict:
   * `prepared → launched` (`consumePreparedBoundedWorker`, before spawning) →
   * `accepted` (here, after the native receipt proves cleanup). Calling it
   * before the launch was consumed throws; a second call returns
   * `{outcome:'DUPLICATE'}` without reading or writing anything.
   */
  accept(receipt: OwnedPtyReceipt): BoundedWorkerAcceptance;
}

interface PreparedFacts {
  readonly requestSha256: string;
  readonly executableSha256: string;
  readonly scriptSha256: string;
  readonly helperSha256: string;
  /** The backend helper's native SCRIPT (distinct from the fixture `scriptSha256`). */
  readonly backendScriptSha256: string;
  readonly nativeSourceSha256: string;
}
interface PreparedState {
  readonly expiresAt: number;
  readonly bindingDigest: string;
  readonly permitId: string;
  readonly contract: CodexWorkerContract;
  readonly limits: BoundedWorkerLimits;
  readonly providerExecution?: unknown;
  readonly env: Readonly<Record<string, string>>;
  published: boolean;
  readonly facts: PreparedFacts;
  readonly requestPath: string;
  readonly syntheticRoot: string;
  readonly resultPath: string;
  readonly artifactDir: string;
  readonly receiptPath: string;
  /** Paths whose bytes `facts` pins; re-proven at launch time so a delayed minted preparation
   * cannot drift onto replaced content. */
  readonly digests: readonly { readonly path: string; readonly sha256: string; readonly maxBytes: number }[];
  /** `prepared → launched`, spent once by `consumePreparedBoundedWorker`. */
  launched: boolean;
  /** `launched → accepted`, spent once by `accept`. */
  accepted: boolean;
}

/** Minted preparations. Structural look-alikes (IPC JSON, spread copies) are not members. */
const MINTED = new WeakMap<object, PreparedState>();

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`Invalid ${label} schema`);
  }
}
function assertText(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value) || (pattern && !pattern.test(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function assertSha256(value: unknown, label: string): string {
  const text = assertText(value, label);
  if (!HEX_SHA256_RE.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}
function assertPositiveInteger(value: unknown, label: string, ceiling: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function assertIntegerOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`);
  return value;
}
/** Windows path comparison folds case; link refusal still comes from per-component lstat. */
function resolvedKey(value: string): string {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) ? value.toLowerCase() : value;
}

/**
 * A path this module is willing to touch: canonical, absolute, local (no UNC or
 * device namespace), link-free at every component, and resolving to itself.
 */
function assertApprovedLocalPath(path: unknown, label: string): string {
  if (!isCanonicalAbsolutePath(path)) throw new Error(`${label} must be a canonical absolute path`);
  if (/^\\\\/.test(path) || /^\/\//.test(path)) throw new Error(`${label} must not be a UNC, device, or network path`);
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    if (process.platform === 'win32' && (/[. ]$/.test(part) || /[:<>"|?*]/.test(part)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
      throw new Error(`${label} contains an ambiguous Windows path component`);
    }
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} must be free of filesystem links`);
  }
  if (resolvedKey(realpathSync(path)) !== resolvedKey(path)) {
    throw new Error(`${label} must not be redirected by a filesystem link`);
  }
  return path;
}

interface BoundedScan { readonly bytes: Buffer | null; readonly sha256: string; readonly size: number }
/** Single bounded pass: streamed digest, optional retained bytes, hard byte cap. */
function scanBoundedRegularFile(path: string, label: string, maxBytes: number, keepBytes: boolean): BoundedScan {
  assertApprovedLocalPath(path, label);
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${label} must be a single-link regular file`);
    if (stat.size > maxBytes) throw new Error(`${label} exceeds its byte limit`);
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let total = 0;
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) throw new Error(`${label} exceeds its byte limit`);
      hash.update(chunk.subarray(0, read));
      if (keepBytes) chunks.push(Buffer.from(chunk.subarray(0, read)));
    }
    return Object.freeze({ bytes: keepBytes ? Buffer.concat(chunks, total) : null, sha256: hash.digest('hex'), size: total });
  } finally {
    closeSync(fd);
  }
}
function assertApprovedFileDigest(path: string, label: string, expectedSha256: string, maxBytes: number): void {
  const scan = scanBoundedRegularFile(path, label, maxBytes, false);
  if (scan.sha256 !== expectedSha256) throw new Error(`${label} does not match its approved SHA256`);
}
function assertCanonicalEmptyDirectory(path: string, label: string): void {
  assertApprovedLocalPath(path, label);
  if (!statSync(path).isDirectory()) throw new Error(`${label} must be an existing directory`);
  if (readdirSync(path).length !== 0) throw new Error(`${label} must be empty`);
}

function readLimits(value: unknown): BoundedWorkerLimits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid bounded worker limits');
  const limits = value as Record<string, unknown>;
  exactKeys(limits, ['maxResultBytes', 'maxArtifactBytes', 'maxArtifactTotalBytes', 'maxArtifactCount'], 'bounded worker limits');
  return Object.freeze({
    maxResultBytes: assertPositiveInteger(limits.maxResultBytes, 'maxResultBytes', LIMIT_CEILINGS.maxResultBytes),
    maxArtifactBytes: assertPositiveInteger(limits.maxArtifactBytes, 'maxArtifactBytes', LIMIT_CEILINGS.maxArtifactBytes),
    maxArtifactTotalBytes: assertPositiveInteger(limits.maxArtifactTotalBytes, 'maxArtifactTotalBytes', LIMIT_CEILINGS.maxArtifactTotalBytes),
    maxArtifactCount: assertPositiveInteger(limits.maxArtifactCount, 'maxArtifactCount', LIMIT_CEILINGS.maxArtifactCount)
  });
}

/** Native backend inputs: identities proven, bounds positive, environment explicit. */
function readOwnedBackend(
  value: unknown, syntheticRoot: string
): Omit<OwnedPtyLaunch, 'executablePath' | 'executableSha256' | 'args' | 'cwd' | 'env'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid bounded worker owned backend');
  exactKeys(
    value as Record<string, unknown>,
    ['helperPath', 'helperSha256', 'scriptPath', 'scriptSha256', 'nativeSourcePath', 'nativeSourceSha256', 'helperEnv', 'cols', 'rows', 'timeoutMs', 'cleanupMs'],
    'bounded worker owned backend'
  );
  const backend = value as Omit<OwnedPtyLaunch, 'executablePath' | 'executableSha256' | 'args' | 'cwd' | 'env'>;
  const helperPath = assertApprovedLocalPath(backend.helperPath, 'Bounded worker helper path');
  const helperSha256 = assertSha256(backend.helperSha256, 'Bounded worker helper SHA256');
  assertApprovedFileDigest(helperPath, 'Bounded worker helper', helperSha256, MAX_APPROVED_FILE_BYTES);
  const scriptPath = assertApprovedLocalPath(backend.scriptPath, 'Bounded worker native script path');
  const scriptSha256 = assertSha256(backend.scriptSha256, 'Bounded worker native script SHA256');
  assertApprovedFileDigest(scriptPath, 'Bounded worker native script', scriptSha256, MAX_APPROVED_FILE_BYTES);
  const nativeSourcePath = assertApprovedLocalPath(backend.nativeSourcePath, 'Bounded worker native source path');
  const nativeSourceSha256 = assertSha256(backend.nativeSourceSha256, 'Bounded worker native source SHA256');
  assertApprovedFileDigest(nativeSourcePath, 'Bounded worker native source', nativeSourceSha256, MAX_APPROVED_FILE_BYTES);
  if (isPathWithin(helperPath, syntheticRoot) || isPathWithin(scriptPath, syntheticRoot) || isPathWithin(nativeSourcePath, syntheticRoot)) {
    throw new Error('Bounded worker backend files must live outside the worker-writable synthetic root');
  }

  // The helper environment is its own explicit map: it is never built from the host environment and
  // it never inherits. Key NAMES may repeat the worker allowlist — separation is that the two maps
  // are independent and that the helper's directory VALUES point outside the worker-writable root
  // (the helper is host-side), not that the key sets are disjoint.
  const helperEnvValue: unknown = backend.helperEnv;
  if (helperEnvValue === undefined || helperEnvValue === null || typeof helperEnvValue !== 'object' || Array.isArray(helperEnvValue)) {
    throw new Error('Bounded worker helper environment must be explicit');
  }
  const helperEnvInput = helperEnvValue as Readonly<Record<string, string>>;
  const helperEnv: Record<string, string> = {};
  const helperKeys = new Set<string>();
  for (const [key, entry] of Object.entries(helperEnvInput)) {
    if (!key || key.length > 256 || /[^\x20-\x7e]/.test(key) || isCredentialLikeEnvironmentKey(key)) {
      throw new Error('Bounded worker helper environment carries an unsafe or credential-like key');
    }
    // Windows environment names are case-insensitive, so canonicalize there; POSIX names are
    // case-sensitive and left verbatim. Duplicate detection runs on the canonical name before the
    // assignment, which would otherwise silently let a later key overwrite an earlier one.
    const canonical = process.platform === 'win32' ? key.toUpperCase() : key;
    if (helperKeys.has(canonical)) throw new Error('Bounded worker helper environment has duplicate keys');
    helperKeys.add(canonical);
    if (typeof entry !== 'string' || !entry || entry.length > 4096 || /[\x00-\x1f]/.test(entry)) {
      throw new Error('Bounded worker helper environment value is invalid');
    }
    helperEnv[canonical] = entry;
  }
  if (typeof helperEnv.PATH !== 'string' || helperEnv.PATH.length === 0) {
    throw new Error('Bounded worker helper PATH must be explicit');
  }
  // The helper's HOME/TEMP family and explicit Windows OS directory must be canonical host directories
  // outside the worker-writable synthetic root; APPDATA/LOCALAPPDATA are checked when supplied.
  const requiredHelperDirs = ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SYSTEMROOT'] as const;
  const optionalHelperDirs = ['APPDATA', 'LOCALAPPDATA'] as const;
  for (const key of requiredHelperDirs) {
    if (helperEnv[key] === undefined) throw new Error(`Bounded worker helper environment requires ${key}`);
  }
  for (const key of [...requiredHelperDirs, ...optionalHelperDirs]) {
    const dir = helperEnv[key];
    if (dir === undefined) continue;
    assertApprovedLocalPath(dir, `Bounded worker helper ${key}`);
    if (!statSync(dir).isDirectory()) throw new Error(`Bounded worker helper ${key} must be an existing directory`);
    if (isPathWithin(dir, syntheticRoot)) {
      throw new Error(`Bounded worker helper ${key} must stay outside the worker-writable synthetic root`);
    }
  }

  return Object.freeze({
    helperPath, helperSha256, scriptPath, scriptSha256, nativeSourcePath, nativeSourceSha256,
    helperEnv: Object.freeze(helperEnv),
    cols: assertPositiveInteger(backend.cols, 'Bounded worker cols', 4096),
    rows: assertPositiveInteger(backend.rows, 'Bounded worker rows', 4096),
    timeoutMs: assertPositiveInteger(backend.timeoutMs, 'Bounded worker timeoutMs', 86_400_000),
    cleanupMs: assertPositiveInteger(backend.cleanupMs, 'Bounded worker cleanupMs', 3_600_000)
  });
}

/** argv is exactly the fixture script, the request document path, and the mode. */
function readApprovedArgv(value: unknown, scriptPath: string, requestPath: string, mode: string): readonly string[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('Invalid bounded worker argv');
  const tokens = value.map((token, index) => assertText(token, `argv[${index}]`));
  if (tokens[0] !== scriptPath || tokens[1] !== requestPath || tokens[2] !== mode) {
    throw new Error('Bounded worker argv must be exactly the approved fixture script, request document, and mode');
  }
  return Object.freeze(tokens);
}

/** The request document must live outside the worker-writable root and match its approved digest. */
function assertApprovedRequestFile(requestPath: string, requestSha256: string, syntheticRoot: string): Buffer {
  if (isPathWithin(requestPath, syntheticRoot)) {
    throw new Error('Bounded worker request document must live outside the worker-writable synthetic root');
  }
  const scan = scanBoundedRegularFile(requestPath, 'Bounded worker request document', MAX_REQUEST_BYTES, true);
  if (scan.sha256 !== requestSha256) throw new Error('Bounded worker request document does not match its approved SHA256');
  return scan.bytes as Buffer;
}

/**
 * The permit's request bytes must describe THIS task: the fixture's
 * `{contract: …}` is compared field-wise against the contract derived from the
 * permit's trusted identity, so a matching digest alone cannot bind a request
 * that belongs to a different candidate/run/source.
 */
function assertRequestContractBinding(value: unknown, contract: CodexWorkerContract): void {
  type RequestShape = {
    contract?: {
      schemaVersion?: unknown; candidateId?: unknown; taskId?: unknown; runId?: unknown; workerId?: unknown; taskDigest?: unknown;
      sourceCheckpoint?: { repositoryId?: unknown; commitSha?: unknown; treeSha?: unknown };
      executable?: { executablePath?: unknown; version?: unknown; executableSha256?: unknown };
      rootPolicy?: { root?: unknown; workDir?: unknown; artifactDir?: unknown; resultPath?: unknown };
    };
  };
  const request = (value as RequestShape).contract;
  const source = request?.sourceCheckpoint;
  // Digests are compared case-insensitively: the contract normalizes them to lowercase and the
  // fixture writes whatever the host handed it, so casing must not decide the binding.
  const lower = (field: unknown): string => (typeof field === 'string' ? field.toLowerCase() : '');
  // Identity and source are mandatory; the executable/rootPolicy blocks must match whenever the
  // request carries them, so either spelling of the fixture's `{contract}` binds the same identity.
  const identityBound = !!request && !!source
    && request.schemaVersion === contract.schemaVersion
    && request.candidateId === contract.candidateId && request.taskId === contract.taskId
    && request.runId === contract.runId && request.workerId === contract.workerId
    && lower(request.taskDigest) === contract.taskDigest
    && source.repositoryId === contract.sourceCheckpoint.repositoryId
    && lower(source.commitSha) === contract.sourceCheckpoint.commitSha
    && lower(source.treeSha) === contract.sourceCheckpoint.treeSha;
  const executable = request?.executable;
  const executableBound = !!executable
    && executable.executablePath === contract.executable.executablePath
    && executable.version === contract.executable.version
    && lower(executable.executableSha256) === contract.executable.executableSha256;
  const rootPolicy = request?.rootPolicy;
  const rootPolicyBound = !!rootPolicy
    && rootPolicy.root === contract.rootPolicy.root && rootPolicy.workDir === contract.rootPolicy.workDir
    && rootPolicy.artifactDir === contract.rootPolicy.artifactDir && rootPolicy.resultPath === contract.rootPolicy.resultPath;
  if (!identityBound || !executableBound || !rootPolicyBound) {
    throw new Error('Bounded worker request contract does not match the prepared identity');
  }
}

/** PATH must be explicit and root-bound: no inherited host entry can reach the fixture. */
function assertRootBoundPath(value: unknown, syntheticRoot: string): string {
  const path = assertText(value, 'Bounded worker PATH');
  const entries = path.split(delimiter);
  if (entries.some(entry => !entry)) throw new Error('Bounded worker PATH must not contain empty entries');
  for (const entry of entries) {
    if (!isPathWithin(entry, syntheticRoot)) throw new Error('Bounded worker PATH entries must be inside the synthetic root');
    assertCanonicalEmptyDirectory(entry, 'Bounded worker PATH entry');
  }
  return path;
}

function assertFreshSyntheticRoot(root: string): void {
  assertApprovedLocalPath(root, 'Bounded worker synthetic root');
  if (!statSync(root).isDirectory()) throw new Error('Bounded worker synthetic root must be an existing directory');
  const entries = readdirSync(root);
  const actual = entries.map(resolvedKey).sort();
  const expected = EXPECTED_ROOT_ENTRIES.map(resolvedKey).sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error('Bounded worker synthetic root must be fresh and hold only its fixed synthetic directories');
  }
  for (const name of entries) {
    assertCanonicalEmptyDirectory(join(root, name), `Bounded worker synthetic directory ${name}`);
  }
}

/** A host receipt directory, with no acceptance already recorded in it. Empty is not required: the
 * request document may be a sibling here, and atomic-exclusive publication — not an empty directory —
 * is what prevents a receipt from being overwritten. */
function assertHostReceiptDirectory(dir: string, syntheticRoot: string): void {
  assertApprovedLocalPath(dir, 'Bounded worker host receipt directory');
  if (!statSync(dir).isDirectory()) throw new Error('Bounded worker host receipt directory must be an existing directory');
  if (resolvedKey(dir) === resolvedKey(syntheticRoot)
    || isPathWithin(dir, syntheticRoot) || isPathWithin(syntheticRoot, dir)) {
    throw new Error('Bounded worker host receipt directory must stay outside the synthetic root');
  }
  for (const name of readdirSync(dir)) {
    if (ACCEPTANCE_RECEIPT_RE.test(name)) throw new Error('Bounded worker host receipt directory already holds an acceptance receipt');
  }
}

/**
 * Provider-free admission. Evidence is derived from the frozen contract and the
 * observations made above; the provider network disposition is hardcoded
 * NOT_AUTHORIZED, so `evaluateCodexAdmission` cannot report a ready provider
 * runtime for a provider-free preparation — and no fake AUTHORIZED is ever
 * manufactured.
 */
function providerFreeAdmission(input: {
  contract: CodexWorkerContract; env: Readonly<Record<string, string>>; resultPath: string; artifactDir: string;
}): ProviderFreeAdmission {
  const { contract, env } = input;
  const executableIdentity: ExecutableIdentityEvidence = {
    canonicalPath: contract.executable.executablePath, regularFile: true, resolution: 'absolute-direct',
    version: contract.executable.version, executableSha256: contract.executable.executableSha256
  };
  const rootPolicy: RootPolicyEvidence = {
    root: contract.rootPolicy.root, projectDir: contract.rootPolicy.projectDir, workDir: contract.rootPolicy.workDir,
    artifactDir: contract.rootPolicy.artifactDir, resultPath: contract.rootPolicy.resultPath,
    canonical: true, directories: true, linkFree: true
  };
  const credentialPolicy: CredentialPolicyEvidence = {
    mode: 'NONE', dailyAuthJsonAccessed: false, dailyConfigTomlAccessed: false, credentialLikeEnvironmentPresent: false,
    providerSecretsPresent: false, dedicatedPreprovisioned: false, handoffAuthorized: false
  };
  const networkPolicy: NetworkPolicyEvidence = {
    providerNetworkAuthority: 'NOT_AUTHORIZED', endpointEnforcement: 'OPEN_DECISION', impliedByFullAccess: false
  };
  const resultPolicy: ResultPolicyEvidence = {
    resultPath: input.resultPath, artifactDir: input.artifactDir, resultSlotAvailable: true, validatorBound: true,
    artifactContainmentBound: true, duplicateRejected: true, consumerReady: true
  };
  // These flags record that Main supplied a trusted in-memory permit; they are not inferred from
  // worker output, request bytes, or any boolean the fixture authored. The permit's existence in the
  // caller's trust boundary is the authority — not the type literal on the permit field.
  const authority: AuthorityEvidence = {
    sourceCheckpointApproved: true, identityApproved: true, humanApproved: true, runtimePermit: 'PRESENT'
  };
  const decision = evaluateCodexAdmission(contract, {
    executableIdentity, taskIdentity: { taskId: contract.taskId, taskDigest: contract.taskDigest },
    sourceIdentity: contract.sourceCheckpoint, rootPolicy, environmentPolicy: { env }, credentialPolicy,
    networkPolicy, resultPolicy, authority
  });
  const gated = FIXTURE_GATES.map(name => decision.gates[name].state);
  const state: AdmissionState = gated.includes('BLOCKED') ? 'BLOCKED' : gated.includes('UNKNOWN') ? 'UNKNOWN' : 'READY';
  return Object.freeze({
    decision, fixtureGates: FIXTURE_GATES, state, providerRuntimeReady: false as const, providerBlockedGates: DEFERRED_GATES
  });
}

/**
 * Validate the permit, prove every filesystem fact before any effect, and mint a
 * one-shot launch binding plus durable result consumer. Throws on any refusal:
 * a refused preparation produces no object and performs no write.
 */
export function prepareBoundedWorker(permit: BoundedWorkerPermit, providerBridge?: unknown): PreparedBoundedWorker {
  // Authenticate before even reading permit paths. Generic structural callers cannot opt in.
  const bridge = providerBridge === undefined ? null : consumeProviderWorkerBridge(providerBridge);
  const provider = bridge?.preflight;
  if (typeof permit !== 'object' || permit === null) throw new Error('Invalid bounded worker permit');
  const permitId = assertText(permit.permitId, 'bounded worker permitId', PERMIT_ID_RE);
  if (typeof permit.expiresAt !== 'number' || !Number.isSafeInteger(permit.expiresAt)) {
    throw new Error('Invalid bounded worker permit expiry');
  }
  if (Date.now() > permit.expiresAt) throw new Error('Bounded worker permit has expired');
  if (permit.humanApproved !== true) throw new Error('Bounded worker permit lacks the Human authorization record');
  const requestSha256 = assertSha256(permit.requestSha256, 'bounded worker request SHA256');
  const mode = assertText(permit.mode, 'bounded worker fixture mode', FIXTURE_MODE_RE);

  const fixture = permit.fixture;
  if (typeof fixture !== 'object' || fixture === null || Array.isArray(fixture)) throw new Error('Invalid bounded worker fixture');
  exactKeys(fixture as unknown as Record<string, unknown>, ['executablePath', 'executableSha256', 'version', 'scriptPath', 'scriptSha256'], 'bounded worker fixture');
  const executablePath = assertApprovedLocalPath(fixture.executablePath, 'Bounded worker fixture executable');
  const executableSha256 = assertSha256(fixture.executableSha256, 'Bounded worker fixture executable SHA256');
  const version = assertText(fixture.version, 'Bounded worker fixture version');
  const scriptPath = assertApprovedLocalPath(fixture.scriptPath, 'Bounded worker fixture script');
  const scriptSha256 = assertSha256(fixture.scriptSha256, 'Bounded worker fixture script SHA256');
  if (/\.(?:cmd|bat|ps1)$/i.test(executablePath) || /\.(?:cmd|bat|ps1)$/i.test(scriptPath)) {
    throw new Error('Bounded worker fixture must not be a shell shim');
  }

  const syntheticRoot = assertApprovedLocalPath(permit.syntheticRoot, 'Bounded worker synthetic root');
  if (isPathWithin(executablePath, syntheticRoot) || isPathWithin(scriptPath, syntheticRoot)) {
    throw new Error('Bounded worker fixture files must live outside the worker-writable synthetic root');
  }
  const requestPath = assertApprovedLocalPath(permit.requestPath, 'Bounded worker request document');
  const args = provider ? provider.launch.args : readApprovedArgv(permit.argv, scriptPath, requestPath, mode);
  assertApprovedFileDigest(executablePath, 'Bounded worker fixture executable', executableSha256, MAX_APPROVED_FILE_BYTES);
  assertApprovedFileDigest(scriptPath, 'Bounded worker fixture script', scriptSha256, MAX_APPROVED_FILE_BYTES);
  const requestDocument = assertApprovedRequestFile(requestPath, requestSha256, syntheticRoot);

  const hostReceiptDir = permit.hostReceiptDir;
  assertHostReceiptDirectory(hostReceiptDir, syntheticRoot);

  const limits = readLimits(permit.limits);
  const workerPath = assertRootBoundPath(permit.workerPath, syntheticRoot);
  assertFreshSyntheticRoot(syntheticRoot);

  const contract = createCodexWorkerContract({
    ...permit.identity, executable: { executablePath, version, executableSha256 },
    syntheticRoot, credentialMode: provider ? 'DEDICATED_PREPROVISIONED' : 'NONE'
  });
  try {
    assertRequestContractBinding(JSON.parse(requestDocument.toString('utf8')) as unknown, contract);
    if (provider) readProviderTaskDocument(requestDocument, contract);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Bounded worker request document must be JSON');
    throw error;
  }
  const rootPolicy = contract.rootPolicy;
  if (existsSync(rootPolicy.resultPath)) throw new Error('Bounded worker durable result slot must be empty before launch');
  for (const directory of rootPolicy.allowedDirectories) {
    if (!isPathWithin(directory, syntheticRoot)) throw new Error('Bounded worker root policy escaped the synthetic root');
  }

  const backend = readOwnedBackend(permit.ownedBackend, syntheticRoot);
  const envInput: CodexWorkerEnvironmentInput = {
    path: workerPath, home: rootPolicy.homeDir, userProfile: rootPolicy.userProfileDir,
    temp: rootPolicy.tempDir, tmp: rootPolicy.tempDir, codexHome: rootPolicy.codexHomeDir,
    // Windows crypto initialization needs the OS directory, not the helper's other environment values.
    systemRoot: backend.helperEnv.SYSTEMROOT
  };
  // Built from explicit inputs only — no host environment is read or merged.
  const env = validateCodexWorkerEnv(buildCodexWorkerEnv(envInput), envInput);
  if (provider) {
    const expectedBackend = provider.runtimeBackend;
    if (permit.permitId !== provider.permitId || permit.expiresAt !== bridge!.expiresAt
      || JSON.stringify(contract) !== JSON.stringify(provider.contract)
      || JSON.stringify(env) !== JSON.stringify(provider.env)
      || JSON.stringify(permit.argv) !== JSON.stringify(provider.launch.args)
      || !expectedBackend || expectedBackend.runtime !== 'BOUNDED_OWNED_PTY'
      || backend.helperPath !== expectedBackend.helperPath || backend.helperSha256 !== expectedBackend.helperSha256
      || backend.scriptPath !== expectedBackend.nativeScriptPath || backend.scriptSha256 !== expectedBackend.nativeScriptSha256
      || backend.nativeSourcePath !== expectedBackend.nativeSourcePath || backend.nativeSourceSha256 !== expectedBackend.nativeSourceSha256) {
      throw new Error('Provider bridge does not match bounded identity, environment, argv, backend or authority');
    }
  }
  const launch: OwnedPtyLaunch = Object.freeze({
    ...backend, executablePath, executableSha256: contract.executable.executableSha256,
    args, cwd: rootPolicy.workDir, env
  });

  const binding = {
    version: BOUNDED_WORKER_ACCEPTANCE_VERSION, permitId, requestPath, requestSha256,
    candidateId: contract.candidateId, taskId: contract.taskId, runId: contract.runId, workerId: contract.workerId,
    taskDigest: contract.taskDigest, sourceCheckpoint: contract.sourceCheckpoint,
    executablePath, executableSha256: contract.executable.executableSha256, executableVersion: version,
    scriptPath, scriptSha256, mode, argv: args,
    cwd: rootPolicy.workDir, env, syntheticRoot, resultPath: rootPolicy.resultPath, artifactDir: rootPolicy.artifactDir,
    hostReceiptDir, limits, backend,
    ...(provider ? { providerAdmission: provider.admission, launchAuthority: 'AUTHORIZED', expiresAt: bridge!.expiresAt } : {})
  };
  const bindingDigest = createHash('sha256').update(JSON.stringify(binding), 'utf8').digest('hex');
  const receiptPath = join(hostReceiptDir, `bounded-worker-${bindingDigest}.json`);
  if (existsSync(receiptPath)) throw new Error('Bounded worker acceptance already exists for this binding');

  const admission = provider ? provider.admission : providerFreeAdmission({
    contract, env, resultPath: rootPolicy.resultPath, artifactDir: rootPolicy.artifactDir
  });
  if (admission.state !== 'READY') throw new Error('Bounded worker admission is not ready');

  const state: PreparedState = {
    expiresAt: permit.expiresAt, bindingDigest, permitId, contract, limits,
    providerExecution: bridge?.execution, env, published: false,
    requestPath, syntheticRoot, resultPath: rootPolicy.resultPath, artifactDir: rootPolicy.artifactDir,
    receiptPath,
    digests: Object.freeze([
      { path: executablePath, sha256: contract.executable.executableSha256, maxBytes: MAX_APPROVED_FILE_BYTES },
      { path: scriptPath, sha256: scriptSha256, maxBytes: MAX_APPROVED_FILE_BYTES },
      { path: backend.helperPath, sha256: backend.helperSha256, maxBytes: MAX_APPROVED_FILE_BYTES },
      { path: backend.scriptPath, sha256: backend.scriptSha256, maxBytes: MAX_APPROVED_FILE_BYTES },
      { path: backend.nativeSourcePath, sha256: backend.nativeSourceSha256, maxBytes: MAX_APPROVED_FILE_BYTES }
    ]),
    facts: Object.freeze({
      requestSha256, executableSha256: contract.executable.executableSha256, scriptSha256,
      helperSha256: backend.helperSha256, backendScriptSha256: backend.scriptSha256, nativeSourceSha256: backend.nativeSourceSha256
    }),
    launched: false, accepted: false
  };
  const prepared: PreparedBoundedWorker = Object.freeze({
    permitId, contract, executablePath, args, cwd: rootPolicy.workDir, env, launch, bindingDigest, admission,
    accept: (receipt: OwnedPtyReceipt): BoundedWorkerAcceptance => acceptBoundedWorkerResult(prepared, receipt)
  });
  MINTED.set(prepared, state);
  return prepared;
}

/**
 * Assertion/narrowing for the trusted in-memory caller. Membership is a minted
 * preparation's identity: a structurally identical object assembled from IPC
 * JSON, a spread copy, or a re-parsed receipt is not a member. A preparation
 * that has already been accepted is refused, so a replayed reference cannot
 * re-launch work.
 *
 * This is a pure assertion and does NOT spend the launch right and does NOT
 * revalidate hashes or slots; both belong to `consumePreparedBoundedWorker`,
 * which must run immediately before any launch effect.
 */
export function assertPreparedBoundedWorker(value: unknown): asserts value is PreparedBoundedWorker {
  if (typeof value !== 'object' || value === null || !MINTED.has(value)) {
    throw new Error('Bounded worker preparation was not minted by prepareBoundedWorker');
  }
  if (MINTED.get(value)!.accepted) throw new Error('Bounded worker preparation has already been accepted');
}

/**
 * Re-prove, immediately before launch, everything the delayed preparation
 * depends on: every hash-bound file, the fresh synthetic root, the empty result
 * slot, and the absent acceptance receipt. A prepared worker that sat in memory
 * while its fixture, request, backend, or root changed underneath it must not
 * launch; expiry alone does not cover that drift.
 */
function assertLaunchPreconditions(state: PreparedState): void {
  for (const entry of state.digests) {
    assertApprovedFileDigest(entry.path, `Bounded worker ${entry.path}`, entry.sha256, entry.maxBytes);
  }
  // The request document is read once with bytes retained: it is both hash-bound and parsed here.
  const requestBytes = scanBoundedRegularFile(state.requestPath, 'Bounded worker request document', MAX_REQUEST_BYTES, true).bytes as Buffer;
  if (createHash('sha256').update(requestBytes).digest('hex') !== state.facts.requestSha256) {
    throw new Error('Bounded worker request document does not match its approved SHA256');
  }
  assertRequestContractBinding(JSON.parse(requestBytes.toString('utf8')) as unknown, state.contract);
  assertFreshSyntheticRoot(state.syntheticRoot);
  if (existsSync(state.resultPath)) throw new Error('Bounded worker durable result slot must be empty before launch');
  if (existsSync(state.receiptPath)) throw new Error('Bounded worker acceptance already exists for this binding');
  if (state.providerExecution !== undefined) {
    consumeProviderExecutionPreparation(state.providerExecution, state.contract, requestBytes, state.env);
  }
}

/** Transition `prepared → launched`; required before native launch and acceptance. */
export function consumePreparedBoundedWorker(value: unknown): PreparedBoundedWorker {
  assertPreparedBoundedWorker(value);
  const state = MINTED.get(value)!;
  if (state.launched) throw new Error('Bounded worker preparation has already been consumed for launch');
  if (Date.now() > state.expiresAt) throw new Error('Bounded worker permit expired before launch');
  assertLaunchPreconditions(state);
  state.launched = true;
  return value;
}

/** Trusted Main adapter only: terminal text and exit callbacks never call this publisher.
 * Existing acceptance remains the sole artifact-verification and receipt authority. */
export function publishBoundedWorkerTaskResult(prepared: unknown, value: unknown): void {
  assertPreparedBoundedWorker(prepared);
  const state = MINTED.get(prepared)!;
  if (!state.launched || state.accepted || state.published) throw new Error('Result publication is not live or was already consumed');
  // Lifecycle/duplicate rejection is a pure state observation and runs before any parsing or
  // content scanning, so a second publication reports the duplicate rather than a content refusal.
  if (existsSync(state.resultPath)) throw new Error('Duplicate task result');
  assertNoProviderSecretContent(value);
  const result = validateTaskResult(value, state.contract, { resultAlreadyExists: false });
  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (bytes.length > state.limits.maxResultBytes) throw new Error('Durable result exceeds its byte limit');
  if (state.resultPath !== state.contract.resultPolicy.resultPath
    || !isPathWithin(state.resultPath, state.syntheticRoot)) throw new Error('Durable result path binding mismatch');
  assertApprovedLocalPath(dirname(state.resultPath), 'Durable result parent');
  // Existing acceptance, not this publisher, verifies declared artifact bytes.
  publishAtomicExclusiveBytes(state.resultPath, bytes);
  state.published = true;
}

interface NativeObservation {
  readonly rootPid: number | null; readonly rootExit: number | null; readonly rootJobMember: boolean;
  readonly activeProcessesFinal: number | null; readonly cleanupState: 'VERIFIED_EMPTY' | 'UNVERIFIED';
  readonly ioDrained: boolean; readonly pseudoConsoleClosed: boolean; readonly reason: OwnedPtyReceipt['reason'];
  readonly error?: string;
}
const NATIVE_REASONS: readonly OwnedPtyReceipt['reason'][] = Object.freeze(['exit', 'stop', 'timeout', 'helper-failure', 'launch-failure']);

/** Read the native observation. Ownership facts are taken verbatim, never inferred. */
function readNativeObservation(receipt: OwnedPtyReceipt): NativeObservation {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) throw new Error('Invalid owned PTY receipt');
  const rootPid = assertIntegerOrNull(receipt.rootPid, 'owned PTY rootPid');
  const rootExit = assertIntegerOrNull(receipt.rootExit, 'owned PTY rootExit');
  if (typeof receipt.rootJobMember !== 'boolean') throw new Error('Invalid owned PTY rootJobMember');
  const activeProcessesFinal = assertIntegerOrNull(receipt.activeProcessesFinal, 'owned PTY activeProcessesFinal');
  if (receipt.cleanupState !== 'VERIFIED_EMPTY' && receipt.cleanupState !== 'UNVERIFIED') throw new Error('Invalid owned PTY cleanupState');
  if (typeof receipt.ioDrained !== 'boolean' || typeof receipt.pseudoConsoleClosed !== 'boolean') throw new Error('Invalid owned PTY drain flags');
  if (typeof receipt.reason !== 'string' || !NATIVE_REASONS.includes(receipt.reason)) throw new Error('Invalid owned PTY reason');
  if (receipt.error !== undefined && typeof receipt.error !== 'string') throw new Error('Invalid owned PTY error');
  return Object.freeze({
    rootPid, rootExit, rootJobMember: receipt.rootJobMember, activeProcessesFinal,
    cleanupState: receipt.cleanupState, ioDrained: receipt.ioDrained, pseudoConsoleClosed: receipt.pseudoConsoleClosed,
    reason: receipt.reason, ...(receipt.error === undefined ? {} : { error: receipt.error })
  });
}

interface ListedArtifact { readonly key: string }
/** Bounded, link-free enumeration of the artifact directory's regular files. */
function listArtifactFiles(artifactDir: string, maxCount: number): ListedArtifact[] {
  const files: ListedArtifact[] = [];
  const stack: { readonly path: string; readonly relative: string; readonly depth: number }[] = [{ path: artifactDir, relative: '', depth: 0 }];
  let entries = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const name of readdirSync(current.path).sort()) {
      entries += 1;
      if (entries > maxCount) throw new Error('Bounded worker artifact directory exceeds its entry limit');
      const full = join(current.path, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Bounded worker refuses linked artifact entries');
      if (stat.isDirectory()) {
        if (current.depth >= MAX_ARTIFACT_DEPTH) throw new Error('Bounded worker artifact directory is nested too deeply');
        stack.push({ path: full, relative: current.relative ? `${current.relative}/${name}` : name, depth: current.depth + 1 });
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Bounded worker artifact entries must be single-link regular files');
      files.push({ key: resolvedKey(current.relative ? `${current.relative}/${name}` : name) });
    }
  }
  return files;
}

function verifyArtifacts(result: CodexTaskResult, artifactDir: string, limits: BoundedWorkerLimits): readonly BoundedWorkerVerifiedArtifact[] {
  if (result.artifacts.length > limits.maxArtifactCount) throw new Error('Durable artifacts exceed the count limit');
  assertApprovedLocalPath(artifactDir, 'Durable artifact directory');
  const listed = listArtifactFiles(artifactDir, limits.maxArtifactCount);
  const declared = new Set(result.artifacts.map(artifact => resolvedKey(artifact.path)));
  if (declared.size !== result.artifacts.length) throw new Error('Duplicate durable task result artifact');
  for (const file of listed) {
    if (!declared.has(file.key)) throw new Error('Durable artifact directory holds an undeclared artifact');
  }
  const present = new Set(listed.map(file => file.key));
  const verified: BoundedWorkerVerifiedArtifact[] = [];
  let totalBytes = 0;
  for (const artifact of result.artifacts) {
    if (!present.has(resolvedKey(artifact.path))) throw new Error(`Durable task result artifact is missing: ${artifact.path}`);
    const path = join(artifactDir, ...artifact.path.split('/'));
    if (!isPathWithin(path, artifactDir)) throw new Error('Durable task result artifact escaped its directory');
    const scan = scanBoundedRegularFile(path, `durable artifact ${artifact.path}`, limits.maxArtifactBytes, false);
    if (scan.sha256 !== artifact.sha256) throw new Error(`Durable artifact digest mismatch: ${artifact.path}`);
    totalBytes += scan.size;
    if (totalBytes > limits.maxArtifactTotalBytes) throw new Error('Durable artifacts exceed the total byte limit');
    verified.push({ path: artifact.path, sha256: artifact.sha256, bytes: scan.size });
  }
  return Object.freeze(verified);
}

/** Acceptance receipts and task results are distinct documents sharing only atomic I/O. */
function publishAcceptanceReceipt(path: string, body: unknown): { readonly sha256: string } {
  return publishAtomicExclusiveBytes(path, Buffer.from(`${JSON.stringify(body, null, 2)}\n`, 'utf8'));
}

/** Atomic-exclusive file publication; result callers supply validated canonical bytes. */
function publishAtomicExclusiveBytes(path: string, bytes: Buffer): { readonly sha256: string } {
  const temporary = `${path}.${process.pid.toString(36)}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = openSync(temporary, 'wx');
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* the uniquely named temp is inert if the unlink fails */ }
  }
  return Object.freeze({ sha256: createHash('sha256').update(bytes).digest('hex') });
}

/** Provider-free durable result consumer. Requires `launched`; runs only after native cleanup is proven. */
function acceptBoundedWorkerResult(prepared: PreparedBoundedWorker, receipt: OwnedPtyReceipt): BoundedWorkerAcceptance {
  const state = MINTED.get(prepared);
  if (!state) throw new Error('Bounded worker preparation was not minted by prepareBoundedWorker');
  const bindingDigest = state.bindingDigest;
  // Pre-launch acceptance is not a duplicate — it is an out-of-order transition, and it stays a throw.
  if (!state.launched) throw new Error('Bounded worker acceptance requires a consumed launch');
  if (state.accepted) return Object.freeze({ outcome: 'DUPLICATE', reason: 'acceptance was already consumed by this preparation', bindingDigest });
  state.accepted = true;

  let native: NativeObservation;
  try {
    native = readNativeObservation(receipt);
  } catch {
    return Object.freeze({ outcome: 'INVALID', reason: 'native receipt is malformed', bindingDigest });
  }
  // Job verified empty + I/O drained + pseudo console closed: nothing is read before this holds.
  if (!native.rootJobMember || native.activeProcessesFinal !== 0 || native.cleanupState !== 'VERIFIED_EMPTY'
    || !native.ioDrained || !native.pseudoConsoleClosed) {
    return Object.freeze({ outcome: 'INVALID', reason: 'native cleanup is not verified empty, drained, and closed', bindingDigest });
  }

  let resultBytes: Buffer;
  let resultSha256: string;
  try {
    if (!existsSync(state.resultPath)) {
      return Object.freeze({ outcome: 'MISSING', reason: 'durable task result is absent', bindingDigest });
    }
    const scan = scanBoundedRegularFile(state.resultPath, 'durable task result', state.limits.maxResultBytes, true);
    resultBytes = scan.bytes as Buffer;
    resultSha256 = scan.sha256;
  } catch (error) {
    return Object.freeze({ outcome: 'INVALID', reason: `durable task result is unreadable: ${String(error)}`, bindingDigest });
  }

  let result: CodexTaskResult;
  try {
    result = validateTaskResult(JSON.parse(resultBytes.toString('utf8')) as unknown, state.contract, { resultAlreadyExists: false });
  } catch (error) {
    const reason = String(error);
    return Object.freeze({
      outcome: reason.includes('Duplicate') ? 'DUPLICATE' : 'INVALID',
      reason: `durable task result was rejected: ${reason}`, bindingDigest
    });
  }

  let artifacts: readonly BoundedWorkerVerifiedArtifact[];
  try {
    artifacts = verifyArtifacts(result, state.artifactDir, state.limits);
  } catch (error) {
    return Object.freeze({ outcome: 'INVALID', reason: `durable artifacts were rejected: ${String(error)}`, bindingDigest });
  }

  // Process exit is supporting evidence only: exit 0 next to a FAIL result stays FAIL, and a PASS
  // result next to a nonzero exit is UNKNOWN — exit 0 is never a PASS.
  const terminal: TerminalClassification = native.reason !== 'exit' || native.error
    ? { state: 'UNKNOWN', reason: 'worker-interrupted-or-native-error' }
    : classifyTerminal({ durableResult: result.result, processExitCode: native.rootExit, cleanup: native.cleanupState });
  const body = {
    version: BOUNDED_WORKER_ACCEPTANCE_VERSION, permitId: state.permitId, bindingDigest,
    candidateId: result.candidateId, taskId: result.taskId, runId: result.runId, workerId: result.workerId,
    taskDigest: result.taskDigest, sourceCheckpoint: result.sourceCheckpoint,
    requestSha256: state.facts.requestSha256, executableSha256: state.facts.executableSha256,
    scriptSha256: state.facts.scriptSha256, helperSha256: state.facts.helperSha256,
    helperScriptSha256: state.facts.backendScriptSha256, nativeSourceSha256: state.facts.nativeSourceSha256,
    resultSha256, resultTerminal: result.result as TerminalState, resultChecks: result.checks,
    artifacts: artifacts.map(artifact => ({ path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes })),
    terminalState: terminal.state, terminalReason: terminal.reason,
    native: {
      rootPid: native.rootPid, rootExit: native.rootExit, rootJobMember: native.rootJobMember,
      activeProcessesFinal: native.activeProcessesFinal, cleanupState: native.cleanupState,
      ioDrained: native.ioDrained, pseudoConsoleClosed: native.pseudoConsoleClosed, reason: native.reason,
      ...(native.error === undefined ? {} : { error: native.error })
    },
    acceptedAt: new Date().toISOString()
  };

  let receiptSha256: string;
  try {
    receiptSha256 = publishAcceptanceReceipt(state.receiptPath, body).sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return Object.freeze({ outcome: 'DUPLICATE', reason: 'acceptance receipt already exists for this binding', bindingDigest });
    }
    // The durable acceptance did not happen; a silent rejection here would hide that.
    throw new Error(`Bounded worker acceptance receipt could not be published: ${String(error)}`);
  }

  return Object.freeze({
    outcome: 'ACCEPTED', terminal, result, resultSha256, artifacts,
    receiptPath: state.receiptPath, receiptSha256, bindingDigest
  });
}
