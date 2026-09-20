import { createHash } from 'node:crypto';
import { isCredentialLikeEnvironmentKey, type CodexWorkerContract } from './codexWorkerContract';

/** Main-only preparation metadata. No secret backend or network permission exists here. */
export const MAX_PROVIDER_TASK_BYTES = 65_536;
export const PROVIDER_EXECUTION_DEFAULTS = Object.freeze({
  credentialHandoff: 'NOT_AUTHORIZED', networkAuthority: 'NOT_AUTHORIZED',
  endpointApproval: 'OPEN_DECISION', backend: 'BLOCKED_BACKEND_REQUIREMENT',
  containment: 'APPLICATION_LEVEL_ENDPOINT_BINDING', OS_LEVEL_NETWORK_CONTAINMENT: 'UNKNOWN',
  limitation: 'DNS resolution and OS egress are not contained; provider configuration enforcement is not implemented'
} as const);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preparation record');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error('Unexpected preparation fields');
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function binding(contract: CodexWorkerContract): string {
  return JSON.stringify([contract.candidateId, contract.taskId, contract.runId, contract.workerId,
    contract.taskDigest, contract.sourceCheckpoint, contract.rootPolicy]);
}
function expiry(expiresAt: number): void {
  if (!Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt) throw new Error('Preparation authority expired');
}

export interface ProviderEndpointPolicy {
  readonly origin: string; readonly scheme: 'https:'; readonly host: string; readonly port: number;
  readonly redirects: 'DENY'; readonly alternateOrigins: 'DENY'; readonly callerOverride: 'DENY';
  readonly proxyEnvironment: 'DENY'; readonly containment: 'APPLICATION_LEVEL_ENDPOINT_BINDING';
  readonly OS_LEVEL_NETWORK_CONTAINMENT: 'UNKNOWN';
  readonly configurationBackend: 'NOT_IMPLEMENTED'; readonly execution: 'BLOCKED_BACKEND_REQUIREMENT';
}
export function prepareProviderEndpoint(origin: string): ProviderEndpointPolicy {
  const url = new URL(origin);
  // One spelling only: lowercase DNS A-labels, no trailing slash, default 443 omitted.
  if (!/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[1-9][0-9]{0,4})?$/.test(origin)
    || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || origin !== url.origin || url.hostname.endsWith('.')) throw new Error('Endpoint must be a canonical HTTPS origin');
  return Object.freeze({ origin, scheme: 'https:', host: url.hostname, port: Number(url.port || 443),
    redirects: 'DENY', alternateOrigins: 'DENY', callerOverride: 'DENY', proxyEnvironment: 'DENY',
    containment: 'APPLICATION_LEVEL_ENDPOINT_BINDING', OS_LEVEL_NETWORK_CONTAINMENT: 'UNKNOWN',
    configurationBackend: 'NOT_IMPLEMENTED', execution: 'BLOCKED_BACKEND_REQUIREMENT' });
}
/** An application-level guard, NOT a network client or an OS containment claim. */
export function enforceProviderEndpoint(policy: ProviderEndpointPolicy, target: string,
  env: Readonly<Record<string, string>>, redirected = false, callerOverride = false): void {
  const canonical = prepareProviderEndpoint(policy.origin);
  if (JSON.stringify(policy) !== JSON.stringify(canonical)) throw new Error('Invalid endpoint policy');
  const url = new URL(target);
  if (redirected || callerOverride || url.username || url.password || url.origin !== canonical.origin)
    throw new Error('Endpoint redirect, alternate origin or override refused');
  if (Object.keys(env).some(key => /proxy/i.test(key) || isCredentialLikeEnvironmentKey(key)))
    throw new Error('Proxy or credential environment refused');
}

/** Request document extension: JSON string encodes exactly these UTF-8 bytes, not shell argv. */
export function readProviderTaskDocument(bytes: Buffer, contract: CodexWorkerContract): Buffer {
  if (bytes.length > 1_048_576 || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes))
    throw new Error('Invalid UTF-8 request document');
  const document = record(JSON.parse(bytes.toString('utf8')));
  keys(document, ['contract', 'task']);
  if (JSON.stringify(document.contract) !== JSON.stringify(contract)) throw new Error('Task contract substitution');
  const task = record(document.task);
  keys(task, ['encoding', 'text']);
  if (task.encoding !== 'utf8' || typeof task.text !== 'string') throw new Error('Invalid task encoding');
  const taskBytes = Buffer.from(task.text, 'utf8');
  if (taskBytes.toString('utf8') !== task.text || !taskBytes.length || taskBytes.length > MAX_PROVIDER_TASK_BYTES
    || digest(taskBytes) !== contract.taskDigest) throw new Error('Task bytes, size or digest mismatch');
  return taskBytes;
}

export interface ProviderCredentialAuthorization {
  readonly recordId: string;
  readonly grantedBy: 'HUMAN';
  readonly purpose: 'PROVIDER_EXECUTION';
  readonly scopeDigest: string;
  readonly endpointOrigin: string;
  readonly expiresAt: number;
}
/** Main supplies an explicit Human record; this metadata does not verify Human provenance. */
export function providerCredentialScopeDigest(contract: CodexWorkerContract): string {
  return digest(Buffer.from(JSON.stringify(contract), 'utf8'));
}
function opaqueCapability(): object {
  return Object.freeze(Object.defineProperty({}, 'toJSON', {
    value: () => { throw new Error('Preparation authority is not serializable'); }
  }));
}
interface CredentialState { binding: string; authorization: Readonly<ProviderCredentialAuthorization>; expiresAt: number; revoked: boolean; spent: boolean }
interface TaskState { binding: string; expiresAt: number; requestDigest: string; taskBytes: number; spent: boolean }
const credentials = new WeakMap<object, CredentialState>();
const tasks = new WeakMap<object, TaskState>();
const preparations = new WeakMap<object, { contract: CodexWorkerContract; credential: object; task: object; endpoint: ProviderEndpointPolicy }>();
function stateOf<T>(map: WeakMap<object, T>, value: unknown): T {
  const state = value && typeof value === 'object' ? map.get(value) : undefined;
  if (!state) throw new Error('Missing or forged Main preparation authority');
  return state;
}
/** Keep issuer in Main. No credential bytes or actual handoff are accepted here. */
export function createProviderExecutionIssuer() {
  const owned = new WeakSet<object>();
  return Object.freeze({
    mintCredential(contract: CodexWorkerContract, authorization: ProviderCredentialAuthorization): object {
      keys(record(authorization), ['recordId', 'grantedBy', 'purpose', 'scopeDigest', 'endpointOrigin', 'expiresAt']);
      expiry(authorization.expiresAt);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authorization.recordId)
        || authorization.grantedBy !== 'HUMAN' || authorization.purpose !== 'PROVIDER_EXECUTION'
        || authorization.scopeDigest !== providerCredentialScopeDigest(contract)) throw new Error('Invalid Human authorization scope');
      prepareProviderEndpoint(authorization.endpointOrigin);
      const handle = opaqueCapability();
      credentials.set(handle, { binding: binding(contract), authorization: Object.freeze({ ...authorization }),
        expiresAt: authorization.expiresAt, revoked: false, spent: false });
      owned.add(handle);
      return handle;
    },
    revoke(handle: object): void {
      if (!owned.has(handle)) throw new Error('Foreign credential authority');
      stateOf(credentials, handle).revoked = true;
    },
    mintTask(contract: CodexWorkerContract, request: Buffer, expiresAt: number): object {
      expiry(expiresAt);
      const taskBytes = readProviderTaskDocument(request, contract).length;
      const task = opaqueCapability();
      tasks.set(task, { binding: binding(contract), expiresAt, requestDigest: digest(request), taskBytes, spent: false });
      owned.add(task);
      return task;
    },
    prepare(contract: CodexWorkerContract, credential: object, task: object, origin: string): object {
      if (!owned.has(credential) || !owned.has(task)) throw new Error('Foreign preparation authority');
      const preparation = opaqueCapability();
      const snapshot = JSON.parse(JSON.stringify(contract)) as CodexWorkerContract;
      preparations.set(preparation, { contract: snapshot, credential, task, endpoint: prepareProviderEndpoint(origin) });
      assertProviderExecutionPreparation(preparation, contract);
      return preparation;
    }
  });
}
export function assertProviderExecutionPreparation(value: unknown, contract: CodexWorkerContract): void {
  const preparation = stateOf(preparations, value);
  const credential = stateOf(credentials, preparation.credential);
  const task = stateOf(tasks, preparation.task);
  expiry(credential.expiresAt); expiry(task.expiresAt);
  if (credential.authorization.scopeDigest !== providerCredentialScopeDigest(contract)
    || credential.authorization.endpointOrigin !== preparation.endpoint.origin) throw new Error('Conflicting Human authorization scope');
  if (credential.revoked || credential.spent || task.spent || binding(preparation.contract) !== binding(contract)
    || credential.binding !== binding(contract) || task.binding !== binding(contract))
    throw new Error('Revoked, spent or conflicting preparation authority');
}
/**
 * Called after filesystem reproof and before any launch effect. Deliberately cannot
 * authorize a provider.
 *
 * Once-only launch consumption: request digest/schema and endpoint/environment are
 * re-proved first, then credential and task authority are spent together, and only
 * then is the unavailable backend refused. A refused backend attempt therefore
 * consumes the authority by design — spending happens before the deliberate throw —
 * so this capability is exactly one attempt and a retry requires freshly minted
 * Human/Main authorization. Revoked, expired, forged or substituted inputs fail
 * before this point and consume nothing. A future real backend must therefore treat
 * these two flags as the already-recorded single consumption of this attempt rather
 * than spending a second time.
 */
export function consumeProviderExecutionPreparation(value: unknown, contract: CodexWorkerContract,
  request: Buffer, env: Readonly<Record<string, string>>): never {
  assertProviderExecutionPreparation(value, contract);
  const preparation = stateOf(preparations, value);
  const credential = stateOf(credentials, preparation.credential);
  const task = stateOf(tasks, preparation.task);
  if (digest(request) !== task.requestDigest) throw new Error('Task request substitution');
  readProviderTaskDocument(request, contract);
  enforceProviderEndpoint(preparation.endpoint, preparation.endpoint.origin, env);
  // Atomically spend both authorities immediately before the deliberate backend refusal.
  credential.spent = true;
  task.spent = true;
  throw new Error('BLOCKED_BACKEND_REQUIREMENT: dedicated credential handoff, endpoint configuration enforcement and provider network authority are unavailable');
}

/** Bound future transport contract only; no PTY write API or executable delivery backend. */
export function describeProviderTaskTransport(value: unknown, contract: CodexWorkerContract) {
  assertProviderExecutionPreparation(value, contract);
  const task = stateOf(tasks, stateOf(preparations, value).task);
  return Object.freeze({ encoding: 'utf8', bytes: task.taskBytes, taskDigest: contract.taskDigest,
    requestDigest: task.requestDigest, shell: false, framing: 'EXACT_BYTES_THEN_EOF',
    backend: 'NOT_IMPLEMENTED', execution: 'BLOCKED_BACKEND_REQUIREMENT' } as const);
}

/** Refuse, never redact into a potentially misleading PASS. This is not universal secret detection. */
export function assertNoProviderSecretContent(value: unknown): void {
  // Key-aware inspection: a field name such as `api_key` is dangerous wherever it appears, while
  // generic credential prose (`secret`, `token`, `password`) is only meaningful in a field that
  // carries human-readable text. Identity/policy values legitimately spell `credential…` and may
  // embed `sk-` inside an identifier, so context-free substring matching false-positives there.
  const dangerousKey = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|private[_-]?key|credential)/i;
  // Structural names and closed enum values from the frozen worker contract carry policy, not
  // secrets. They are exempt only as exact names/values; any other `credential…` name still trips.
  const safeKey: Record<string, true> = { credentialPolicy: true, credentialMode: true };
  const safeText: Record<string, true> = { DEDICATED_PREPROVISIONED: true, EXPLICIT_HUMAN_HANDOFF_ONLY: true };
  // High-signal secret shapes are rejected regardless of the key that carries them.
  // `sk-` must start a token: a real key is standalone, while an identifier may merely embed it.
  const secretText = /(?:bearer\s|-----BEGIN|(?:^|[\s"',:=([{])sk-[A-Za-z0-9]|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]|refresh[_-]?token\s*[:=]|authorization\s*[:=]|password\s*[:=]|private[_-]?key\s*[:=])/i;
  // Generic credential prose is only dangerous inside a free-text-bearing field.
  const freeTextKey = /(?:diagnostic|message|error|text|output)/i;
  const credentialProse = /(?:credential|password|secret|private[_-]?key)/i;
  function inspect(item: unknown, freeText: boolean): void {
    if (typeof item === 'string' && safeText[item] !== true && (secretText.test(item) || (freeText && credentialProse.test(item))))
      throw new Error('Credential-like result content refused');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (dangerousKey.test(key) && safeKey[key] !== true) throw new Error('Credential-like result content refused');
        inspect(child, freeTextKey.test(key));
      }
    }
  }
  inspect(value, false);
}
