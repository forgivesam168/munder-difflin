import { createHash } from 'node:crypto';
import { createCoreRuntimeContract, type CoreRuntimeContract } from './codexWorkerContract';
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
    route.model, adapter.thinkingLevel ?? undefined);
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
