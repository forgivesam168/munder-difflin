import { createHash } from 'node:crypto';
import { createCoreRuntimeContract, type CoreRuntimeContract } from './codexWorkerContract';
import { prepareProviderEndpoint } from './providerExecutionPreparation';
import { coreScopeDigest, describeInertRuntime, type InertRuntimeDescriptor } from './runtimeAdapter';

/** CLIProxyAPI is an approved endpoint route, never a runtime or upstream provider. */
export interface ModelRoute {
  readonly routeId: 'CLIProxyAPI';
  readonly endpoint: string;
  readonly model: string;
  readonly scopeDigest: string;
  readonly expiresAt: number;
  readonly attemptBound: 1;
  readonly network: 'NOT_AUTHORIZED';
  readonly evidenceId: string;
  readonly approval: 'SYNTHETIC_FIXTURE_ONLY';
}
export function createInertModelRoute(core: CoreRuntimeContract, input: {
  endpoint: string; model: string; expiresAt: number; evidenceId: string;
}): ModelRoute {
  if (Object.keys(input).sort().join(',') !== 'endpoint,evidenceId,expiresAt,model') throw new Error('Unexpected route authority fields');
  prepareProviderEndpoint(input.endpoint);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.model)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.evidenceId)
    || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()) throw new Error('Invalid model route');
  return Object.freeze({ routeId: 'CLIProxyAPI', endpoint: input.endpoint, model: input.model,
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
    expiresAt: route.expiresAt, evidenceId: route.evidenceId });
  if (!matchesCanonical(route, canonicalRoute)) throw new Error('Route authority substitution');
  const canonicalAdapter = describeInertRuntime(adapter.adapterId, core, adapter.executable, route.endpoint,
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
