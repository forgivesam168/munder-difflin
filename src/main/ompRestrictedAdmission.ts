import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import type { CoreRuntimeContract } from './codexWorkerContract';
import type { InertRuntimeDescriptor } from './runtimeAdapter';
import { consumeOmpPreparationEvidence, type OmpPreparationHandle } from './ompPreparationInspector';
import { createDurableAttemptReservationStore, type ModelRoute } from './modelAccessAuthority';
import { launchOwnedPty, type OwnedPtyLaunch } from './windowsOwnedPty';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function physical(path: string, directory: boolean): string {
  if (resolve(path) !== path) throw new Error('Noncanonical boundary path');
  let cursor = path;
  for (;;) {
    const s = lstatSync(cursor);
    if (s.isSymbolicLink() || (cursor === path && !directory ? !s.isFile() || s.nlink !== 1 : !s.isDirectory())) throw new Error('Boundary link/type refused');
    if (realpathSync.native(cursor).toLowerCase() !== cursor.toLowerCase()) throw new Error('Boundary redirection refused');
    if (cursor === parse(cursor).root) break;
    cursor = dirname(cursor);
  }
  return path;
}
function overlap(a: string, b: string): boolean {
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\');
}
function opaque(): object {
  return Object.freeze(Object.defineProperty(Object.create(null), 'toJSON', {
    value: () => { throw new Error('Admission is not serializable'); }
  }));
}
type Backend = Pick<OwnedPtyLaunch, 'helperPath' | 'helperSha256' | 'scriptPath' | 'scriptSha256' | 'nativeSourcePath' | 'nativeSourceSha256' | 'helperEnv'>;
interface NativeObservation { path: string; owner: string; sddl: string; mandatoryLabelAuthority: string; volume: number; fileId: string; integrity: string; }
/** Main creates one issuer for one explicitly owned base. Neither a caller-supplied
 * store nor a serialized receipt can confer authority: the real store stays private.
 * This is provider-free authority only; Human production authorization is separate. */
export function createOmpRestrictedAdmissionIssuer(input: {
  evidenceBase: string; evidenceDirectory: string; backend: Backend;
  securitySourcePath: string; securitySourceSha256: string;
}) {
  if (process.platform !== 'win32') throw new Error('Windows security boundary required');
  const settings = freeze(JSON.parse(JSON.stringify(input))) as typeof input;
  physical(settings.evidenceBase, true); physical(settings.evidenceDirectory, true);
  if (dirname(settings.evidenceDirectory) !== settings.evidenceBase) throw new Error('Exact Main-owned evidence base required');
  if (settings.securitySourcePath !== join(dirname(settings.backend.nativeSourcePath), 'ompWindowsSecurity.cs')) throw new Error('Repository security source required');
  const { backend } = settings;
  function verifyBackend() {
    for (const [path, sha] of [[backend.helperPath, backend.helperSha256], [backend.scriptPath, backend.scriptSha256],
      [backend.nativeSourcePath, backend.nativeSourceSha256], [settings.securitySourcePath, settings.securitySourceSha256]]) {
      physical(path, false);
      if (hash(readFileSync(path)) !== sha) throw new Error('Backend identity changed');
    }
  }
  verifyBackend();
  function native(paths: readonly { path: string; directory: boolean; low: boolean }[], apply: boolean): NativeObservation[] {
    verifyBackend();
    for (const item of paths) physical(item.path, item.directory);
    const payload = Buffer.from(JSON.stringify(paths)).toString('base64');
    const source = settings.securitySourcePath.replaceAll("'", "''");
    const command = `$ErrorActionPreference='Stop'; Add-Type -Path '${source}'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json; $r=@(foreach($i in $p){[OmpWindowsSecurity]::Observe($i.path,$i.directory,$i.low,$${apply ? 'true' : 'false'})}); ConvertTo-Json -InputObject $r -Depth 8 -Compress`;
    const result = spawnSync(backend.helperPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      cwd: settings.evidenceBase, env: { ...backend.helperEnv }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    if (result.error || result.status !== 0) throw new Error(`Native boundary failed: ${result.error?.message ?? result.stderr}`);
    const observations = JSON.parse(result.stdout.replace(/^\uFEFF/, '')) as NativeObservation[];
    if (!Array.isArray(observations) || observations.length !== paths.length || observations.some((x, i) => x.path !== paths[i].path)) throw new Error('Native observation mismatch');
    return observations;
  }
  const store = createDurableAttemptReservationStore(settings.evidenceDirectory);
  const admissions = new WeakMap<object, { launch: OwnedPtyLaunch; reobserve: () => void; verifyLedger: () => void; evidence: unknown }>();
  const preparations = new WeakSet<object>();
  const reservations = new WeakMap<object, { core: CoreRuntimeContract; adapter: InertRuntimeDescriptor; route: ModelRoute; snapshot: string }>();
  let evidenceProvisioned = false;
  return Object.freeze({
    reserve(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute, authorizationId: string) {
      if (overlap(settings.evidenceBase, core.rootPolicy.root)) throw new Error('Evidence and synthetic roots overlap');
      if (!evidenceProvisioned) {
        native([
          { path: settings.evidenceBase, directory: true, low: false },
          { path: settings.evidenceDirectory, directory: true, low: false }
        ], true);
        evidenceProvisioned = true;
      }
      const handle = store.reserve(core, adapter, route, authorizationId);
      const evidence = store.inspect(handle, core, adapter, route);
      const snapshot = JSON.stringify({ entries: readdirSync(evidence.evidenceDirectory).sort(), native: native([
        { path: evidence.evidenceDirectory, directory: true, low: false },
        { path: evidence.receiptPath, directory: false, low: false },
        { path: evidence.attemptIdentityPath, directory: false, low: false }
      ], true) });
      const scope = freeze(JSON.parse(JSON.stringify({ core, adapter, route }))) as { core: CoreRuntimeContract; adapter: InertRuntimeDescriptor; route: ModelRoute };
      reservations.set(handle, { ...scope, snapshot });
      return handle;
    },
    admit(core: CoreRuntimeContract, adapter: InertRuntimeDescriptor, route: ModelRoute, preparation: OmpPreparationHandle, reservation: unknown) {
      const reserved = reservation && typeof reservation === 'object' ? reservations.get(reservation) : undefined;
      if (!reserved) throw new Error('Forged, foreign or spent reservation');
      reservations.delete(reservation as object);
      const consumed = store.consume(reservation, reserved.core, reserved.adapter, reserved.route);
      if (preparations.has(preparation)) throw new Error('Spent preparation');
      preparations.add(preparation);
      const prepared = consumeOmpPreparationEvidence(preparation, core, adapter);
      if (JSON.stringify({ core, adapter, route }) !== JSON.stringify({ core: reserved.core, adapter: reserved.adapter, route: reserved.route })) throw new Error('Reservation scope substitution');
      if (overlap(settings.evidenceBase, core.rootPolicy.root)) throw new Error('Evidence and synthetic roots overlap');
      if (!adapter.args || !adapter.config.isolation || adapter.adapterId !== 'omp') throw new Error('Exact OMP adapter required');
      // The baseline must originate in the store's successful exclusive writes,
      // not in whatever bytes happen to exist when admission is requested.
      // consume already spent the reservation, including every failure below.
      for (const expected of consumed.expectedFiles) {
        physical(expected.path, false);
        const bytes = readFileSync(expected.path);
        if (bytes.toString('base64') !== expected.bytesBase64 || hash(bytes) !== expected.sha256) throw new Error('Reservation bytes changed since reserve');
      }
      const currentReservation = JSON.stringify({ entries: readdirSync(consumed.evidenceDirectory).sort(), native: native([
        { path: consumed.evidenceDirectory, directory: true, low: false },
        { path: consumed.receiptPath, directory: false, low: false },
        { path: consumed.attemptIdentityPath, directory: false, low: false }
      ], false) });
      if (currentReservation !== reserved.snapshot) throw new Error('Reservation identity or entry-set changed since reserve');
      const readonlyPaths = [core.rootPolicy.root, core.rootPolicy.configDir];
      const writablePaths = [...core.rootPolicy.allowedDirectories.filter(p => !readonlyPaths.includes(p)), prepared.resolvedPiConfigDir];
      const paths = [
        { path: consumed.evidenceDirectory, directory: true, low: false },
        { path: consumed.receiptPath, directory: false, low: false },
        { path: consumed.attemptIdentityPath, directory: false, low: false },
        ...readonlyPaths.map(path => ({ path, directory: true, low: false })),
        ...writablePaths.map(path => ({ path, directory: true, low: true })),
        { path: prepared.modelsFile, directory: false, low: false },
        { path: settings.evidenceBase, directory: true, low: false }
      ];
      // Parent application precedes children; explicit child ACLs replace inherited ACEs.
      native(paths.slice(0, -1), true);
      const observations = native(paths, false);
      const ledger = () => {
        physical(consumed.evidenceDirectory, true);
        return { entries: readdirSync(consumed.evidenceDirectory).sort(), files: consumed.expectedFiles.map(expected => {
          const path = expected.path;
          physical(path, false); const bytes = readFileSync(path);
          const bytesBase64 = bytes.toString('base64'); const sha256 = hash(bytes);
          if (bytesBase64 !== expected.bytesBase64 || sha256 !== expected.sha256) throw new Error('Reservation bytes changed since reserve');
          return { path, bytes: bytesBase64, sha256 };
        }), native: native(paths.slice(0, 3), false) };
      };
      const before = ledger();
      if (JSON.stringify({ entries: before.entries, native: before.native }) !== reserved.snapshot) throw new Error('Reservation identity or entry-set changed since reserve');
      const evidenceBody = { preparationDigest: prepared.digest, reservation: consumed, before,
        matrix: paths.map((p, i) => ({ ...p, disposition: p.low ? 'LOW_WRITABLE' : 'MAIN_OWNED_READ_ONLY', observation: observations[i] })) };
      const evidence = freeze({ ...evidenceBody, digest: hash(JSON.stringify(evidenceBody)) });
      const launch: OwnedPtyLaunch = freeze({ ...backend, securityContext: 'RESTRICTED_LOW', ioMode: 'RAW_PIPE',
        executablePath: adapter.executable.executablePath, executableSha256: adapter.executable.executableSha256,
        args: [...adapter.args], cwd: adapter.cwd, env: { ...prepared.environment }, cols: 80, rows: 24,
        timeoutMs: adapter.maxTimeSeconds! * 1000, cleanupMs: 5000 });
      const checkExecutable = () => {
        physical(launch.executablePath, false);
        if (hash(readFileSync(launch.executablePath)) !== launch.executableSha256) throw new Error('Executable substitution');
      };
      const expiresAt = route.expiresAt;
      const scopeSnapshot = JSON.stringify({ core, adapter, route });
      checkExecutable();
      const verifyLedger = () => {
        if (JSON.stringify(ledger()) !== JSON.stringify(before)) throw new Error('Reservation evidence changed');
        physical(prepared.modelsFile, false);
        if (hash(readFileSync(prepared.modelsFile)) !== prepared.modelsSha256) throw new Error('Models bytes changed');
        const modelsIndex = paths.findIndex(p => p.path === prepared.modelsFile);
        if (JSON.stringify(native([paths[modelsIndex]], false)[0]) !== JSON.stringify(observations[modelsIndex])) throw new Error('Models identity changed');
      };
      const handle = opaque();
      admissions.set(handle, { launch, evidence, verifyLedger, reobserve: () => {
        if (Date.now() >= expiresAt) throw new Error('Expired launch authority');
        if (JSON.stringify({ core, adapter, route }) !== scopeSnapshot) throw new Error('Launch scope substitution');
        verifyBackend(); checkExecutable(); verifyLedger();
        consumeOmpPreparationEvidence(preparation, core, adapter);
        if (JSON.stringify(native(paths, false)) !== JSON.stringify(observations)) throw new Error('Security boundary changed');
      } });
      return Object.freeze({ handle, evidence, bindingDigest: hash(JSON.stringify({ core, adapter, route, launch, evidence })) });
    },
    launch(handle: unknown, callbacks: Parameters<typeof launchOwnedPty>[1]) {
      const state = handle && typeof handle === 'object' ? admissions.get(handle) : undefined;
      if (!state) throw new Error('Forged, foreign or spent restricted admission');
      admissions.delete(handle as object);
      state.reobserve();
      const running = launchOwnedPty(state.launch, { ...callbacks, onExit() {} });
      const completion = running.completion.then(receipt => {
        state.verifyLedger();
        callbacks.onExit(receipt);
        return receipt;
      });
      return { ...running, completion };
    }
  });
}
