import { createHash } from 'node:crypto';
import { isCredentialLikeEnvironmentKey, type CodexWorkerContract } from './codexWorkerContract';
import type { OwnedPtyLaunch } from './windowsOwnedPty';

/** Main-only preparation metadata. No secret backend or network permission exists here. */
export const MAX_PROVIDER_TASK_BYTES = 65_536;
export const PROVIDER_EXECUTION_DEFAULTS = Object.freeze({
  credentialHandoff: 'NOT_AUTHORIZED', networkAuthority: 'NOT_AUTHORIZED',
  endpointApproval: 'OPEN_DECISION', backend: 'IMPLEMENTED_INERT_ONLY', providerInvocation: 'NOT_RUN',
  containment: 'APPLICATION_LEVEL_ENDPOINT_BINDING', OS_LEVEL_NETWORK_CONTAINMENT: 'UNKNOWN',
  limitation: 'Application policy only; DNS, redirects by external clients and OS egress are not contained'
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
  readonly configurationBackend: 'DESCRIPTOR_ONLY'; readonly execution: 'INERT_ONLY';
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
    configurationBackend: 'DESCRIPTOR_ONLY', execution: 'INERT_ONLY' });
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
  readonly grantedBy: 'SYNTHETIC_ONLY';
  readonly purpose: 'PROVIDER_EXECUTION';
  readonly scopeDigest: string;
  readonly endpointOrigin: string;
  readonly expiresAt: number;
}
/** Synthetic provisioning metadata is not Human authorization. */
export function providerCredentialScopeDigest(contract: CodexWorkerContract): string {
  return digest(Buffer.from(JSON.stringify(contract), 'utf8'));
}
function opaqueCapability(): object {
  return Object.freeze(Object.defineProperty({}, 'toJSON', {
    value: () => { throw new Error('Preparation authority is not serializable'); }
  }));
}
interface CredentialState { binding: string; authorization: Readonly<ProviderCredentialAuthorization>; material: Buffer; expiresAt: number; revoked: boolean; spent: boolean; disposed: boolean }
interface TaskState { binding: string; expiresAt: number; requestDigest: string; taskBytes: number; spent: boolean }
const credentials = new WeakMap<object, CredentialState>();
const tasks = new WeakMap<object, TaskState>();
const preparations = new WeakMap<object, { contract: CodexWorkerContract; credential: object; task: object; endpoint: ProviderEndpointPolicy; descriptor?: ProviderBackendDescriptor }>();
interface NetworkState { preparation: object; scope: string; expiresAt: number; spent: boolean; revoked: boolean }
const networks = new WeakMap<object, NetworkState>();
function stateOf<T>(map: WeakMap<object, T>, value: unknown): T {
  const state = value && typeof value === 'object' ? map.get(value) : undefined;
  if (!state) throw new Error('Missing or forged Main preparation authority');
  return state;
}
/** Issuer-local capabilities support inert mechanics only, never real provider authority. */
export function createProviderExecutionIssuer() {
  const owned = new WeakSet<object>();
  const provenance = new WeakMap<object, { scope: string; expiresAt: number; spent: boolean }>();
  return Object.freeze({
    createSyntheticProvenance(contract: CodexWorkerContract, expiresAt: number): object {
      expiry(expiresAt);
      const capability = opaqueCapability();
      provenance.set(capability, { scope: providerCredentialScopeDigest(contract), expiresAt, spent: false });
      return capability;
    },
    mintCredential(contract: CodexWorkerContract, authorization: ProviderCredentialAuthorization, capability: object): object {
      const source = stateOf(provenance, capability);
      expiry(source.expiresAt);
      if (source.spent || source.scope !== providerCredentialScopeDigest(contract)) throw new Error('Invalid synthetic provenance scope');
      keys(record(authorization), ['recordId', 'grantedBy', 'purpose', 'scopeDigest', 'endpointOrigin', 'expiresAt']);
      expiry(authorization.expiresAt);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authorization.recordId)
        || authorization.grantedBy !== 'SYNTHETIC_ONLY' || authorization.purpose !== 'PROVIDER_EXECUTION'
        || authorization.expiresAt > source.expiresAt
        || authorization.scopeDigest !== providerCredentialScopeDigest(contract)) throw new Error('Invalid synthetic authorization scope');
      prepareProviderEndpoint(authorization.endpointOrigin);
      const handle = opaqueCapability();
      credentials.set(handle, { binding: binding(contract), authorization: Object.freeze({ ...authorization }),
        material: Buffer.from('INERT_NON_SECRET_CREDENTIAL', 'ascii'), expiresAt: authorization.expiresAt, revoked: false, spent: false, disposed: false });
      source.spent = true;
      owned.add(handle);
      return handle;
    },
    revoke(handle: object): void {
      if (!owned.has(handle)) throw new Error('Foreign credential authority');
      const credential = stateOf(credentials, handle);
      disposeCredential(credential);
      credential.revoked = true;
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
      owned.add(preparation);
      return preparation;
    },
    mintInertNetworkAuthority(preparation: object, contract: CodexWorkerContract, expiresAt: number): object {
      if (!owned.has(preparation)) throw new Error('Foreign preparation authority');
      assertProviderExecutionPreparation(preparation, contract);
      expiry(expiresAt);
      const capability = opaqueCapability();
      networks.set(capability, { preparation, scope: providerCredentialScopeDigest(contract), expiresAt, spent: false, revoked: false });
      owned.add(capability);
      return capability;
    },
    revokeNetworkAuthority(capability: object): void {
      if (!owned.has(capability)) throw new Error('Foreign network authority');
      stateOf(networks, capability).revoked = true;
    }
  });
}
export function assertProviderExecutionPreparation(value: unknown, contract: CodexWorkerContract): void {
  const preparation = stateOf(preparations, value);
  const credential = stateOf(credentials, preparation.credential);
  const task = stateOf(tasks, preparation.task);
  if (Date.now() >= credential.expiresAt) disposeCredential(credential);
  expiry(credential.expiresAt); expiry(task.expiresAt);
  if (credential.authorization.scopeDigest !== providerCredentialScopeDigest(contract)
    || credential.authorization.endpointOrigin !== preparation.endpoint.origin) throw new Error('Conflicting synthetic authorization scope');
  if (credential.revoked || credential.spent || task.spent || binding(preparation.contract) !== binding(contract)
    || credential.binding !== binding(contract) || task.binding !== binding(contract))
    throw new Error('Revoked, spent or conflicting preparation authority');
}

function disposeCredential(credential: CredentialState): void {
  if (credential.disposed) return;
  credential.material.fill(0);
  credential.disposed = true;
}

/** Stable inert acquisition lease: never returns bytes or consults host authentication. */
export function acquireInertProviderCredential(value: unknown, contract: CodexWorkerContract) {
  assertProviderExecutionPreparation(value, contract);
  const credential = stateOf(credentials, stateOf(preparations, value).credential);
  credential.spent = true;
  return Object.freeze({
    disposition: 'INERT_NON_SECRET' as const,
    scopeDigest: credential.authorization.scopeDigest,
    recordId: credential.authorization.recordId,
    get disposed(): boolean { return credential.disposed; },
    dispose(): void { disposeCredential(credential); }
  });
}

export interface ProviderBackendDescriptor {
  readonly schema: 'PROVIDER_BACKEND'; readonly version: 1;
  readonly disposition: 'PROVIDER_FREE_INERT'; readonly shell: false;
  readonly args: readonly string[]; readonly endpoint: ProviderEndpointPolicy; readonly codexHome: string;
  readonly framing: 'EXACT_BYTES_THEN_EOF'; readonly ioMode: 'RAW_PIPE';
  readonly credentialDisposition: 'SYNTHETIC_ONLY';
  readonly configurationUse: 'BOUND_DESCRIPTOR_INERT_ONLY'; readonly providerCliProof: 'NOT_RUN';
  readonly launch?: OwnedPtyLaunch;
  readonly scopeDigest: string;
}
export interface ProviderExecutionEvidence {
  readonly schema: 'PROVIDER_EXECUTION'; readonly version: 1;
  readonly recordId: string; readonly authorizationDigest: string; readonly scopeDigest: string;
  readonly endpoint: string; readonly expiresAt: number;
  readonly candidateId: string; readonly taskId: string; readonly runId: string;
  readonly workerId: string; readonly taskDigest: string;
  readonly backendDescriptor: ProviderBackendDescriptor;
  readonly backendDescriptorDigest: string;
}
/** Public evidence is a frozen projection; opaque authority and task bytes never escape. */
export function providerExecutionEvidence(value: unknown, contract: CodexWorkerContract): ProviderExecutionEvidence {
  assertProviderExecutionPreparation(value, contract);
  const preparation = stateOf(preparations, value);
  const { authorization } = stateOf(credentials, preparation.credential);
  const backendDescriptor = describeProviderBackend(value, contract);
  return Object.freeze({ schema: 'PROVIDER_EXECUTION', version: 1,
    recordId: authorization.recordId, authorizationDigest: digest(Buffer.from(JSON.stringify(authorization))),
    scopeDigest: authorization.scopeDigest, endpoint: preparation.endpoint.origin, expiresAt: authorization.expiresAt,
    candidateId: contract.candidateId, taskId: contract.taskId, runId: contract.runId,
    workerId: contract.workerId, taskDigest: contract.taskDigest, backendDescriptor,
    backendDescriptorDigest: digest(Buffer.from(JSON.stringify(backendDescriptor))) });
}
/** Reproof is complete before the three capabilities are atomically spent. No process is launched. */
export function assertProviderNetworkAuthority(value: unknown, preparation: unknown, contract: CodexWorkerContract): void {
  if (value === undefined) throw new Error('BLOCKED_BACKEND_REQUIREMENT: provider network authority is absent');
  const network = stateOf(networks, value);
  expiry(network.expiresAt);
  if (network.revoked || network.spent || network.preparation !== preparation
    || network.scope !== providerCredentialScopeDigest(contract)) throw new Error('Invalid or spent provider network authority');
}
export function describeProviderBackend(value: unknown, contract: CodexWorkerContract): ProviderBackendDescriptor {
  assertProviderExecutionPreparation(value, contract);
  const preparation = stateOf(preparations, value);
  if (preparation.descriptor) return preparation.descriptor;
  const { endpoint } = preparation;
  const args = Object.freeze(['--ignore-user-config', '--ask-for-approval', 'never', '--sandbox', 'workspace-write',
    '-c', 'model_provider="munder"', '-c', 'model_providers.munder.name="Munder"',
    '-c', `model_providers.munder.base_url=${JSON.stringify(endpoint.origin + '/v1')}`,
    '-c', 'model_providers.munder.wire_api="responses"', 'exec', '-']);
  preparation.descriptor = Object.freeze({ schema: 'PROVIDER_BACKEND', version: 1, disposition: 'PROVIDER_FREE_INERT',
    shell: false, args, endpoint, codexHome: contract.rootPolicy.codexHomeDir,
    framing: 'EXACT_BYTES_THEN_EOF', ioMode: 'RAW_PIPE', credentialDisposition: 'SYNTHETIC_ONLY',
    scopeDigest: providerCredentialScopeDigest(contract),
    configurationUse: 'BOUND_DESCRIPTOR_INERT_ONLY', providerCliProof: 'NOT_RUN' } as const);
  return preparation.descriptor;
}

/** Called only after the bounded consumer has verified executable, roots, env and backend bounds. */
export function bindProviderBackendLaunch(value: unknown, contract: CodexWorkerContract,
  evidence: ProviderExecutionEvidence, launch: OwnedPtyLaunch): ProviderExecutionEvidence {
  assertProviderBackendEvidence(value, contract, evidence);
  const state = stateOf(preparations, value);
  const descriptor = evidence.backendDescriptor;
  if (descriptor.launch) throw new Error('Provider descriptor launch already bound');
  enforceProviderEndpoint(descriptor.endpoint, descriptor.endpoint.origin, launch.env);
  if (launch.executablePath !== contract.executable.executablePath
    || launch.executableSha256 !== contract.executable.executableSha256
    || launch.cwd !== contract.rootPolicy.workDir || launch.env.CODEX_HOME !== descriptor.codexHome
    || launch.ioMode !== 'RAW_PIPE' || JSON.stringify(launch.args) !== JSON.stringify(descriptor.args))
    throw new Error('Provider descriptor launch substitution');
  const launchSnapshot = Object.freeze({ ...launch, args: descriptor.args,
    env: Object.freeze({ ...launch.env }), helperEnv: Object.freeze({ ...launch.helperEnv }) });
  state.descriptor = Object.freeze({ ...descriptor, launch: launchSnapshot });
  return providerExecutionEvidence(value, contract);
}

export function assertProviderBackendEvidence(value: unknown, contract: CodexWorkerContract,
  evidence: ProviderExecutionEvidence): void {
  const descriptor = describeProviderBackend(value, contract);
  if (evidence.backendDescriptor !== descriptor
    || evidence.backendDescriptorDigest !== digest(Buffer.from(JSON.stringify(descriptor)))
    || JSON.stringify(evidence) !== JSON.stringify(providerExecutionEvidence(value, contract)))
    throw new Error('Provider descriptor or evidence substitution');
}
export function consumeProviderExecutionPreparation(value: unknown, contract: CodexWorkerContract,
  request: Buffer, env: Readonly<Record<string, string>>, networkAuthority?: unknown, evidence?: ProviderExecutionEvidence) {
  assertProviderExecutionPreparation(value, contract);
  assertProviderNetworkAuthority(networkAuthority, value, contract);
  if (evidence) assertProviderBackendEvidence(value, contract, evidence);
  const preparation = stateOf(preparations, value);
  const task = stateOf(tasks, preparation.task);
  if (digest(request) !== task.requestDigest) throw new Error('Task request substitution');
  const taskBytes = readProviderTaskDocument(request, contract);
  enforceProviderEndpoint(preparation.endpoint, preparation.endpoint.origin, env);
  const descriptor = describeProviderBackend(value, contract);
  if (descriptor.launch && (!evidence || JSON.stringify(env) !== JSON.stringify(descriptor.launch.env)))
    throw new Error('Provider launch evidence or environment substitution');
  // Strings are immutable; consumers recreate the exact UTF-8 bytes without exposing credential material.
  const consumed = Object.freeze({ descriptor, taskText: taskBytes.toString('utf8'), taskDigest: contract.taskDigest });
  const lease = acquireInertProviderCredential(value, contract);
  lease.dispose();
  task.spent = true;
  stateOf(networks, networkAuthority).spent = true;
  return consumed;
}

/** Bound future transport contract only; no PTY write API or executable delivery backend. */
export function describeProviderTaskTransport(value: unknown, contract: CodexWorkerContract) {
  assertProviderExecutionPreparation(value, contract);
  const task = stateOf(tasks, stateOf(preparations, value).task);
  return Object.freeze({ encoding: 'utf8', bytes: task.taskBytes, taskDigest: contract.taskDigest,
    requestDigest: task.requestDigest, shell: false, framing: 'EXACT_BYTES_THEN_EOF',
    backend: 'IMPLEMENTED_INERT_ONLY', execution: 'BLOCKED_WITHOUT_NETWORK_CAPABILITY' } as const);
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
