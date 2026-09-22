import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { createCoreRuntimeContract, isCanonicalAbsolutePath, isPathWithin, type CoreRuntimeContract } from './codexWorkerContract';
import { coreScopeDigest, describeInertRuntime, type InertRuntimeDescriptor } from './runtimeAdapter';

export type ModelRouteTrustClass = 'REMOTE_TLS' | 'LOCAL_LOOPBACK';
export interface ModelRouteEndpointPolicy {
  readonly trustClass: ModelRouteTrustClass;
  readonly origin: string;
  readonly scheme: 'https:' | 'http:';
  readonly host: string;
  readonly port: number;
  readonly alternateOrigins: 'DENY';
  readonly callerOverride: 'DENY';
  readonly redirects: 'DENY';
}
function prepareModelRouteEndpoint(origin: string, trustClass: ModelRouteTrustClass): ModelRouteEndpointPolicy {
  if (typeof origin !== 'string') throw new Error('Invalid model route endpoint');
  const local = trustClass === 'LOCAL_LOOPBACK';
  if ((!local && trustClass !== 'REMOTE_TLS')
    || !(local ? /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/
      : /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::[1-9][0-9]{0,4})?$/).test(origin)) {
    throw new Error('Invalid model route endpoint');
  }
  const url = new URL(origin);
  // URL canonicalization resolves numeric aliases; no IP literal is a remote DNS route.
  if (!local && (url.hostname.length > 253 || /^(?:[0-9]+\.){3}[0-9]+$/.test(url.hostname))) {
    throw new Error('Invalid model route endpoint');
  }
  const port = local ? Number(origin.slice(origin.lastIndexOf(':') + 1)) : Number(url.port || 443);
  // Local origins retain the required explicit port, including HTTP's default 80.
  const canonical = local ? `http://${url.hostname}:${port}` : url.origin;
  if (port < 1 || port > 65535 || origin !== canonical || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid model route endpoint');
  return Object.freeze({ trustClass, origin: canonical, scheme: local ? 'http:' : 'https:',
    host: url.hostname, port, alternateOrigins: 'DENY', callerOverride: 'DENY', redirects: 'DENY' });
}

/** CLIProxyAPI is an approved endpoint route, never a runtime or upstream provider. */
export interface ModelRoute {
  readonly routeId: 'CLIProxyAPI';
  readonly endpoint: string;
  readonly trustClass: ModelRouteTrustClass;
  readonly endpointPolicy: ModelRouteEndpointPolicy;
  readonly model: string;
  readonly scopeDigest: string;
  readonly expiresAt: number;
  readonly attemptBound: 1;
  readonly network: 'NOT_AUTHORIZED';
  readonly evidenceId: string;
  readonly approval: 'SYNTHETIC_FIXTURE_ONLY';
}
export function createInertModelRoute(core: CoreRuntimeContract, input: {
  endpoint: string; trustClass: ModelRouteTrustClass; model: string; expiresAt: number; evidenceId: string;
}): ModelRoute {
  if (Object.keys(input).sort().join(',') !== 'endpoint,evidenceId,expiresAt,model,trustClass') throw new Error('Unexpected route authority fields');
  const endpointPolicy = prepareModelRouteEndpoint(input.endpoint, input.trustClass);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.model)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.evidenceId)
    || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()) throw new Error('Invalid model route');
  return Object.freeze({ routeId: 'CLIProxyAPI', endpoint: endpointPolicy.origin,
    trustClass: endpointPolicy.trustClass, endpointPolicy, model: input.model,
    scopeDigest: coreScopeDigest(core), expiresAt: input.expiresAt, attemptBound: 1,
    network: 'NOT_AUTHORIZED', evidenceId: input.evidenceId, approval: 'SYNTHETIC_FIXTURE_ONLY' });
}
/** Compare every own data field, including array indices, without relying on key order.
 * Accessors and extra non-enumerable/symbol fields are not canonical fixture data. */
function matchesCanonical(value: unknown, canonical: unknown): boolean {
  if (canonical === null || typeof canonical !== 'object') return Object.is(value, canonical);
  if (value === null || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(canonical)) return false;
  const keys = Reflect.ownKeys(canonical);
  if (Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every((key) => {
    const actual = Object.getOwnPropertyDescriptor(value, key);
    const expected = Object.getOwnPropertyDescriptor(canonical, key)!;
    return actual !== undefined && 'value' in actual && actual.enumerable === expected.enumerable
      && matchesCanonical(actual.value, expected.value);
  });
}
function accessBinding(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute): string {
  const canonicalCore = createCoreRuntimeContract({ ...core, syntheticRoot: core.rootPolicy.root });
  if (!matchesCanonical(core, canonicalCore)) throw new Error('Core authority substitution');
  const canonicalRoute = createInertModelRoute(core, { endpoint: route.endpoint, model: route.model,
    trustClass: route.trustClass, expiresAt: route.expiresAt, evidenceId: route.evidenceId });
  if (!matchesCanonical(route, canonicalRoute)) throw new Error('Route authority substitution');
  const canonicalAdapter = describeInertRuntime(adapter.adapterId, core, adapter.executable, canonicalRoute.endpointPolicy.origin,
    route.model, adapter.thinkingLevel ?? undefined, adapter.maxTimeSeconds);
  if (!matchesCanonical(adapter, canonicalAdapter)) throw new Error('Adapter or model substitution');
  return createHash('sha256').update(JSON.stringify([canonicalCore, canonicalAdapter, canonicalRoute])).digest('hex');
}
/** Issuer-local and fixture-only. No secret material, credential handoff, network grant,
 * filesystem effect, or process authority can be minted through this API. */
export function createInertModelAccessIssuer() {
  const authorities = new WeakMap<object, { binding: string; spent: boolean; revoked: boolean }>();
  const issuedBindings = new Set<string>();
  function state(value: unknown) {
    const found = value && typeof value === 'object' ? authorities.get(value) : undefined;
    if (!found) throw new Error('Forged or foreign model access authority');
    if (found.spent || found.revoked) throw new Error('Spent or revoked model access authority');
    return found;
  }
  return Object.freeze({
    mint(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute): object {
      const binding = accessBinding(core, adapter, route);
      if (issuedBindings.has(binding)) throw new Error('Model access attempt bound exhausted');
      const handle = Object.freeze(Object.defineProperty({}, 'toJSON', {
        value: () => { throw new Error('Model access authority is not serializable'); }
      }));
      authorities.set(handle, { binding, spent: false, revoked: false });
      issuedBindings.add(binding);
      return handle;
    },
    revoke(handle: unknown): void { state(handle).revoked = true; },
    consume(handle: unknown, core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute) {
      const authority = state(handle);
      const binding = accessBinding(core, adapter, route);
      if (authority.binding !== binding) throw new Error('Model access scope substitution');
      authority.spent = true;
      return Object.freeze({ bindingDigest: binding, evidenceId: route.evidenceId,
        adapterId: adapter.adapterId, routeId: route.routeId, model: route.model,
        scopeDigest: route.scopeDigest, approval: 'SYNTHETIC_FIXTURE_ONLY',
        execution: 'NOT_RUN', network: 'NOT_AUTHORIZED' } as const);
    }
  });
}

/** Reservation is host evidence, never Human authorization or a network capability.
 * Main must pin this directory across restarts and prove worker-denying OS ACLs before
 * real execution. A caller-chosen alternate evidence directory is NOT a new attempt.
 * No release, retry, deletion or receipt-update API exists. */
export function createDurableAttemptReservationStore(evidenceDirectory: string) {
  function canonicalDirectory(path: string): string {
    if (!isCanonicalAbsolutePath(path) || resolve(path) !== path) throw new Error('Reservation directory must be native canonical absolute');
    let cursor = path;
    for (;;) {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Reservation directory must be link-free');
      if (cursor === parse(cursor).root) break;
      cursor = dirname(cursor);
    }
    const physical = realpathSync.native(path);
    if (process.platform === 'win32' ? physical.toLowerCase() !== path.toLowerCase() : physical !== path) throw new Error('Reservation directory redirected');
    return physical;
  }
  // No directory creation: provisioning and its ACL proof belong to Main.
  const directory = canonicalDirectory(evidenceDirectory);
  const handles = new WeakMap<object, Readonly<{ binding: string; evidenceDirectory: string; receiptPath: string; attemptIdentityPath: string;
    expectedFiles: readonly Readonly<{ path: string; bytesBase64: string; sha256: string }>[] }>>();
  return Object.freeze({
    reserve(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute,
      humanAuthorizationEvidenceId: string): object {
      const binding = accessBinding(core, adapter, route);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(humanAuthorizationEvidenceId)) throw new Error('Invalid Human authorization evidence id');
      const root = canonicalDirectory(core.rootPolicy.root);
      if (directory.toLowerCase() === root.toLowerCase() || isPathWithin(directory, root)
        || isPathWithin(root, directory)) throw new Error('Reservation evidence must be disjoint from worker root');
      if (canonicalDirectory(evidenceDirectory) !== directory) throw new Error('Reservation evidence directory changed');
      // Key only by Human authorization: coherent scope substitutions cannot create a
      // second slot using the same authorization. Main owns the stable store location.
      const key = createHash('sha256').update(humanAuthorizationEvidenceId).digest('hex');
      const receiptPath = join(directory, `omp-attempt-${key}.json`);
      const receipt = { schemaVersion: 1, bindingDigest: binding, coreScopeDigest: coreScopeDigest(core),
        adapterId: adapter.adapterId, executable: adapter.executable,
        route: { trustClass: route.trustClass, endpoint: route.endpoint, model: route.model },
        candidateId: core.candidateId, taskId: core.taskId, runId: core.runId, workerId: core.workerId,
        sourceCheckpoint: core.sourceCheckpoint, taskDigest: core.taskDigest,
        humanAuthorizationEvidenceId, expiresAt: route.expiresAt, attemptBound: 1,
        consumption: 'RESERVATION_CONSUMES_ATTEMPT_INCLUDING_FAILURE_TIMEOUT_OR_CRASH',
        retry: 'NEW_HUMAN_AUTHORIZATION_AND_NEW_ATTEMPT_IDENTITY_REQUIRED',
        workerProtection: 'MAIN_OWNED_OS_ACL_PROOF_REQUIRED', authority: 'RESERVATION_ONLY',
        credentials: 'NONE', network: 'NOT_AUTHORIZED', execution: 'NOT_RUN' };
      const bytes = JSON.stringify(receipt) + '\n';
      function reserveFile(path: string): void {
        const fd = openSync(path, 'wx', 0o600);
        // A short write/fsync failure consumes the slot too. Never repair history.
        try { writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); }
        finally { closeSync(fd); }
      }
      reserveFile(receiptPath);
      // Two exclusive tombstones enforce BOTH fresh Human evidence and fresh Core
      // attempt identity. A crash between writes still consumes the Human slot.
      // A partial reservation never returns a handle and is not safe to retry.
      const attemptKey = createHash('sha256').update(JSON.stringify([
        core.candidateId, core.taskId, core.runId, core.workerId
      ])).digest('hex');
      const attemptIdentityPath = join(directory, `attempt-identity-${attemptKey}.json`);
      reserveFile(attemptIdentityPath);
      const handle = Object.freeze(Object.defineProperty({}, 'toJSON', {
        value: () => { throw new Error('Reservation handle is not serializable'); }
      }));
      const bytesBase64 = Buffer.from(bytes, 'utf8').toString('base64');
      const sha256 = createHash('sha256').update(bytes, 'utf8').digest('hex');
      const expectedFiles = Object.freeze([receiptPath, attemptIdentityPath].map(path => Object.freeze({ path, bytesBase64, sha256 })));
      handles.set(handle, Object.freeze({ binding, evidenceDirectory: directory, receiptPath, attemptIdentityPath, expectedFiles }));
      return handle;
    },
    inspect(handle: unknown, core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute) {
      const state = handle && typeof handle === 'object' ? handles.get(handle) : undefined;
      if (!state) throw new Error('Forged, foreign or spent reservation');
      if (accessBinding(core, adapter, route) !== state.binding) throw new Error('Reservation scope substitution');
      return Object.freeze({ evidenceDirectory: state.evidenceDirectory, receiptPath: state.receiptPath,
        attemptIdentityPath: state.attemptIdentityPath, expectedFiles: state.expectedFiles, bindingDigest: state.binding,
        authority: 'RESERVATION_ONLY', network: 'NOT_AUTHORIZED', execution: 'NOT_RUN' } as const);
    },
    consume(handle: unknown, core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute) {
      const state = handle && typeof handle === 'object' ? handles.get(handle) : undefined;
      if (!state) throw new Error('Forged, foreign or spent reservation');
      if (accessBinding(core, adapter, route) !== state.binding) throw new Error('Reservation scope substitution');
      handles.delete(handle as object);
      return Object.freeze({ evidenceDirectory: state.evidenceDirectory, receiptPath: state.receiptPath,
        attemptIdentityPath: state.attemptIdentityPath, expectedFiles: state.expectedFiles, bindingDigest: state.binding,
        authority: 'RESERVATION_ONLY', network: 'NOT_AUTHORIZED', execution: 'NOT_RUN' } as const);
    }
  });
}
