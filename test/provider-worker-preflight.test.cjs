'use strict';

/**
 * P preflight: the Main-only provider-backed preparation seam.
 *
 * The point of this suite is the FAIL-CLOSED claim, so every blocked case is
 * also exercised under a witness that trips on any process launch, owned-PTY
 * launch, minted `PreparedBoundedWorker`, or filesystem write. The READY control
 * shows the decision shape only — admission READY is NOT invocation permission
 * (`providerAdmissionReady` true, `providerInvocationAllowed` the literal
 * `false`), and it must not claim launch authority. The PTY layer is exercised
 * separately to prove its own defense-in-depth refusal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const preflightApi = loadTs('src/main/providerWorker.ts');
const contractApi = loadTs('src/main/codexWorkerContract.ts');
const launchApi = loadTs('src/main/workerLaunch.ts');
// The PTY layer is loaded ONLY to prove its defense-in-depth refusal. Nothing in
// the happy path of this suite may reach it; the refusal test is the exception.
const { PtyManager } = loadTs('src/main/pty.ts');

const {
  PROVIDER_PREFLIGHT_SCHEMA_VERSION,
  assertProviderWorkerPreflight,
  decideProviderWorkerLaunch,
  inspectProviderWorkerPreflight,
  prepareProviderBackedWorker
} = preflightApi;
const { ADMISSION_GATE_NAMES, CODEX_ENV_ALLOWLIST, createCodexWorkerContract } = contractApi;
const { CODEX_WORKER_ARGV } = launchApi;

const SHA = {
  executable: 'a'.repeat(64),
  task: 'b'.repeat(64)
};

const identity = {
  candidateId: 'p-candidate-001',
  taskId: 'task-p-preflight',
  runId: 'run-p-001',
  workerId: 'worker-p-001',
  taskDigest: SHA.task,
  sourceCheckpoint: {
    repositoryId: 'forgivesam168/munder-difflin',
    commitSha: '7ca2cd21395e1d1e384ed9df44c0600b36f67f93',
    treeSha: 'c'.repeat(40)
  }
};

const executable = {
  executablePath: 'C:\\approved\\codex.exe',
  version: 'codex-cli 0.153.4',
  executableSha256: SHA.executable
};

const syntheticRoot = 'C:\\synthetic\\munder-p\\run-001';

/** The contract is the same object the production seam binds, so nothing is pinned by hand. */
const contract = createCodexWorkerContract({ ...identity, executable, syntheticRoot });

const environment = {
  path: 'C:\\approved\\runtime',
  home: contract.rootPolicy.homeDir,
  userProfile: contract.rootPolicy.userProfileDir,
  temp: contract.rootPolicy.tempDir,
  tmp: contract.rootPolicy.tempDir,
  codexHome: contract.rootPolicy.codexHomeDir,
  systemRoot: 'C:\\Windows'
};

const ownedRuntimeBackend = {
  runtime: 'BOUNDED_OWNED_PTY',
  helperPath: 'C:\\approved\\runtime\\pwsh.exe',
  helperSha256: 'd'.repeat(64),
  nativeScriptPath: 'C:\\approved\\runtime\\windowsOwnedPty.ps1',
  nativeScriptSha256: 'e'.repeat(64),
  nativeSourcePath: 'C:\\approved\\runtime\\windowsOwnedPty.cs',
  nativeSourceSha256: 'f'.repeat(64)
};

const permit = {
  permitId: 'permit-p-001',
  expiresAt: Date.now() + 120_000,
  ownedRuntimeBackend,
  humanApproved: true
};

/** The unauthorized slice: credential handoff false, provider network NOT_AUTHORIZED, endpoint OPEN_DECISION. */
function unauthorizedInput(overrides = {}) {
  return {
    permit,
    identity,
    executable,
    executableIdentity: {
      canonicalPath: executable.executablePath,
      regularFile: true,
      resolution: 'absolute-direct',
      version: executable.version,
      executableSha256: executable.executableSha256
    },
    syntheticRoot,
    rootPolicy: {
      root: contract.rootPolicy.root,
      projectDir: contract.rootPolicy.projectDir,
      workDir: contract.rootPolicy.workDir,
      artifactDir: contract.rootPolicy.artifactDir,
      resultPath: contract.rootPolicy.resultPath,
      canonical: true,
      directories: true,
      linkFree: true
    },
    environment,
    credentials: {
      mode: 'DEDICATED_PREPROVISIONED',
      dailyAuthJsonAccessed: false,
      dailyConfigTomlAccessed: false,
      credentialLikeEnvironmentPresent: false,
      providerSecretsPresent: false,
      dedicatedPreprovisioned: false,
      handoffAuthorized: false
    },
    network: {
      providerNetworkAuthority: 'NOT_AUTHORIZED',
      endpointEnforcement: 'OPEN_DECISION',
      impliedByFullAccess: false
    },
    processOwnership: {
      platform: 'win32',
      ptyAtCreation: 'VERIFIED',
      windowsJobAtCreation: 'VERIFIED',
      descendants: 'VERIFIED',
      stop: 'VERIFIED',
      timeout: 'VERIFIED',
      cleanup: 'VERIFIED'
    },
    resultConsumer: {
      resultPath: contract.resultPolicy.resultPath,
      artifactDir: contract.resultPolicy.artifactDir,
      resultSlotAvailable: true,
      validatorBound: true,
      artifactContainmentBound: true,
      duplicateRejected: true,
      consumerReady: true
    },
    authority: {
      sourceCheckpointApproved: true,
      identityApproved: true,
      humanApproved: true,
      runtimePermit: 'PRESENT'
    },
    ...overrides
  };
}

/** Every field satisfied: exists to prove the decision SHAPE, not to grant launch authority. */
function allEvidenceInput(overrides = {}) {
  return unauthorizedInput({
    credentials: {
      ...unauthorizedInput().credentials,
      dedicatedPreprovisioned: true,
      handoffAuthorized: true
    },
    network: {
      providerNetworkAuthority: 'AUTHORIZED',
      endpointEnforcement: 'APPROVED',
      impliedByFullAccess: false
    },
    ...overrides
  });
}

/**
 * Zero-invocation witness. Any process launch or filesystem write inside the
 * exercised region trips the case instead of passing silently.
 */
function withInvocationWitness(body) {
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const original = {
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
    execFile: childProcess.execFile,
    exec: childProcess.exec,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync
  };
  const attempts = [];
  const trip = name => () => {
    attempts.push(name);
    throw new Error(`${name} attempted during provider preflight`);
  };
  childProcess.spawn = trip('child_process.spawn');
  // PATH/shape resolution (`where`/`which`) goes through spawnSync; tripping it
  // proves a refusal happened BEFORE any command resolution.
  childProcess.spawnSync = trip('child_process.spawnSync');
  childProcess.execFile = trip('child_process.execFile');
  childProcess.exec = trip('child_process.exec');
  fs.writeFileSync = trip('fs.writeFileSync');
  fs.mkdirSync = trip('fs.mkdirSync');
  try {
    return { attempts, value: body() };
  } finally {
    childProcess.spawn = original.spawn;
    childProcess.spawnSync = original.spawnSync;
    childProcess.execFile = original.execFile;
    childProcess.exec = original.exec;
    fs.writeFileSync = original.writeFileSync;
    fs.mkdirSync = original.mkdirSync;
  }
}

test('provider preflight binds the real contract, fixed launch, and explicit environment', () => {
  const result = prepareProviderBackedWorker(unauthorizedInput());
  assert.equal(result.schemaVersion, PROVIDER_PREFLIGHT_SCHEMA_VERSION);
  assert.equal(result.contract.schemaVersion, contract.schemaVersion);
  assert.equal(result.contract.executable.executableSha256, executable.executableSha256.toLowerCase());
  assert.equal(result.contract.executable.version, executable.version);
  assert.equal(result.contract.rootPolicy.root, contract.rootPolicy.root);
  assert.deepEqual(result.launch, {
    executablePath: executable.executablePath,
    args: [...CODEX_WORKER_ARGV],
    shell: false
  });
  assert.deepEqual(Object.keys(result.env), [...CODEX_ENV_ALLOWLIST]);
  assert.equal(result.env.HOME, contract.rootPolicy.homeDir);
  assert.ok(!('OPENAI_API_KEY' in result.env));
  assert.ok(!('CODEX_API_KEY' in result.env));
  assert.deepEqual(result.runtimeBackend, ownedRuntimeBackend);
  assert.equal(result.admission.gates.credentialPolicy.required, true);
  assert.deepEqual(Object.keys(result.admission.gates), [...ADMISSION_GATE_NAMES]);
  assert.deepEqual(result.gateTable.map(row => row.gate), [...ADMISSION_GATE_NAMES]);
  for (const row of result.gateTable) {
    assert.equal(row.required, true);
    assert.ok(row.reason.length > 0);
    assert.ok(row.disposition.length > 0);
  }
});

test('identity, executable, and root binding are structural: contradicting evidence is refused', () => {
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    executable: { ...executable, executablePath: 'codex' }
  })), /canonical and absolute/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    executable: { ...executable, executablePath: 'C:\\approved\\codex.cmd' }
  })), /shell shim/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    executableIdentity: { ...unauthorizedInput().executableIdentity, executableSha256: '9'.repeat(64) }
  })), /contradicts the approved executable descriptor/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    executableIdentity: { ...unauthorizedInput().executableIdentity, version: 'codex-cli 9.9.9' }
  })), /contradicts the approved executable descriptor/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    rootPolicy: { ...unauthorizedInput().rootPolicy, workDir: 'C:\\elsewhere' }
  })), /contradicts the approved root policy/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    identity: { ...identity, taskDigest: 'not-a-hash' }
  })), /Invalid taskDigest/);
  // The same run/worker/task identity the contract carries is what the result reports.
  const result = prepareProviderBackedWorker(unauthorizedInput());
  assert.equal(result.contract.runId, identity.runId);
  assert.equal(result.contract.workerId, identity.workerId);
  assert.equal(result.contract.taskId, identity.taskId);
  assert.equal(result.contract.candidateId, identity.candidateId);
  assert.deepEqual(result.contract.sourceCheckpoint, contract.sourceCheckpoint);
});

test('credential disposition reuses DEDICATED_PREPROVISIONED and blocks an unauthorized handoff', () => {
  const result = prepareProviderBackedWorker(unauthorizedInput());
  assert.equal(result.contract.credentialPolicy.mode, 'DEDICATED_PREPROVISIONED');
  assert.equal(result.admission.gates.credentialPolicy.state, 'BLOCKED');
  assert.equal(result.admission.gates.credentialPolicy.reason, 'dedicated preprovisioned credential handoff is not authorized');
  assert.match(result.gateTable.find(row => row.gate === 'credentialPolicy').disposition,
    /dedicatedPreprovisioned=false handoffAuthorized=false/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    credentials: { ...unauthorizedInput().credentials, mode: 'NONE' }
  })), /DEDICATED_PREPROVISIONED/);
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    credentials: { ...unauthorizedInput().credentials, dedicatedPreprovisioned: 'yes' }
  })), /Invalid credential dedicatedPreprovisioned/);
  assert.equal(
    prepareProviderBackedWorker(unauthorizedInput({
      credentials: { ...unauthorizedInput().credentials, dailyAuthJsonAccessed: true }
    })).admission.gates.credentialPolicy.state,
    'BLOCKED'
  );
  assert.equal(
    prepareProviderBackedWorker(unauthorizedInput({
      credentials: { ...unauthorizedInput().credentials, providerSecretsPresent: true }
    })).admission.gates.credentialPolicy.state,
    'BLOCKED'
  );
});

test('provider network authority and endpoint enforcement are independent and both required', () => {
  const unauthorized = prepareProviderBackedWorker(unauthorizedInput());
  assert.equal(unauthorized.admission.gates.networkPolicy.state, 'BLOCKED');
  assert.match(unauthorized.gateTable.find(row => row.gate === 'networkPolicy').disposition,
    /providerNetworkAuthority=NOT_AUTHORIZED endpointEnforcement=OPEN_DECISION impliedByFullAccess=false/);

  // Authority granted, endpoint still an open decision: the endpoint block survives on its own.
  const openEndpoint = prepareProviderBackedWorker(unauthorizedInput({
    network: { providerNetworkAuthority: 'AUTHORIZED', endpointEnforcement: 'OPEN_DECISION', impliedByFullAccess: false }
  }));
  assert.equal(openEndpoint.admission.gates.networkPolicy.state, 'BLOCKED');
  // Endpoint approved, authority absent: the authority block survives on its own.
  const noAuthority = prepareProviderBackedWorker(unauthorizedInput({
    network: { providerNetworkAuthority: 'NOT_AUTHORIZED', endpointEnforcement: 'APPROVED', impliedByFullAccess: false }
  }));
  assert.equal(noAuthority.admission.gates.networkPolicy.state, 'BLOCKED');
  assert.equal(prepareProviderBackedWorker(unauthorizedInput({
    network: { providerNetworkAuthority: 'UNKNOWN', endpointEnforcement: 'UNKNOWN', impliedByFullAccess: false }
  })).admission.gates.networkPolicy.state, 'UNKNOWN');
});

test('Full Access never implies provider network authority', () => {
  for (const implied of [true, 'true', 1, undefined]) {
    assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
      network: { providerNetworkAuthority: 'AUTHORIZED', endpointEnforcement: 'APPROVED', impliedByFullAccess: implied }
    })), /Full Access does not grant provider network authority/);
  }
  const explicit = prepareProviderBackedWorker(unauthorizedInput({
    network: { providerNetworkAuthority: 'AUTHORIZED', endpointEnforcement: 'APPROVED', impliedByFullAccess: false }
  }));
  assert.equal(explicit.admission.gates.networkPolicy.state, 'READY');
});

test('permit absent, expired, or merely claimed keeps authority closed', () => {
  const absent = prepareProviderBackedWorker(unauthorizedInput({ permit: null }));
  assert.equal(absent.permitState, 'ABSENT');
  assert.equal(absent.permitId, null);
  assert.equal(absent.runtimeBackend, null);
  assert.equal(absent.admission.gates.authority.state, 'BLOCKED');
  assert.match(absent.gateTable.find(row => row.gate === 'authority').disposition, /runtimePermit=ABSENT/);

  const expired = prepareProviderBackedWorker(unauthorizedInput({
    permit: { ...permit, expiresAt: Date.now() - 1 }
  }));
  assert.equal(expired.permitState, 'EXPIRED');
  assert.equal(expired.admission.gates.authority.state, 'BLOCKED');
  assert.match(expired.gateTable.find(row => row.gate === 'authority').disposition, /runtimePermit=EXPIRED/);

  // A caller cannot claim PRESENT when the record is absent: the record wins.
  const claimed = prepareProviderBackedWorker(unauthorizedInput({
    permit: null,
    authority: { sourceCheckpointApproved: true, identityApproved: true, humanApproved: true, runtimePermit: 'PRESENT' }
  }));
  assert.equal(claimed.admission.gates.authority.state, 'BLOCKED');
  assert.match(claimed.gateTable.find(row => row.gate === 'authority').disposition, /runtimePermit=ABSENT/);

  // Without the Human authorization record on the permit, preparation is refused outright.
  assert.throws(() => prepareProviderBackedWorker(unauthorizedInput({
    permit: { ...permit, humanApproved: false }
  })), /Human authorization record/);

  const unapproved = prepareProviderBackedWorker(unauthorizedInput({
    authority: { sourceCheckpointApproved: false, identityApproved: true, humanApproved: true, runtimePermit: 'PRESENT' }
  }));
  assert.equal(unapproved.admission.gates.authority.state, 'BLOCKED');
});

test('durable-result and process-ownership gates remain required', () => {
  for (const patch of [
    { resultSlotAvailable: false },
    { validatorBound: false },
    { artifactContainmentBound: false },
    { duplicateRejected: false },
    { consumerReady: false }
  ]) {
    const result = prepareProviderBackedWorker(unauthorizedInput({
      resultConsumer: { ...unauthorizedInput().resultConsumer, ...patch }
    }));
    assert.equal(result.admission.gates.resultPolicy.state, 'BLOCKED', JSON.stringify(patch));
  }
  assert.equal(prepareProviderBackedWorker(unauthorizedInput({
    resultConsumer: { ...unauthorizedInput().resultConsumer, resultPath: 'C:\\elsewhere\\task-result.json' }
  })).admission.gates.resultPolicy.state, 'BLOCKED');

  for (const patch of [
    { ptyAtCreation: 'UNVERIFIED' },
    { windowsJobAtCreation: 'NOT_APPLICABLE' },
    { descendants: 'UNVERIFIED' },
    { stop: 'UNVERIFIED' },
    { timeout: 'UNVERIFIED' },
    { cleanup: 'UNVERIFIED' }
  ]) {
    const result = prepareProviderBackedWorker(unauthorizedInput({
      processOwnership: { ...unauthorizedInput().processOwnership, ...patch }
    }));
    assert.equal(result.admission.gates.processOwnership.state, 'BLOCKED', JSON.stringify(patch));
  }
  assert.equal(prepareProviderBackedWorker(unauthorizedInput({
    processOwnership: { ...unauthorizedInput().processOwnership, cleanup: 'UNKNOWN' }
  })).admission.gates.processOwnership.state, 'UNKNOWN');
});

test('every blocked case is fail-closed: no decision may be READY and nothing is invoked', () => {
  const blocked = [
    unauthorizedInput(),
    unauthorizedInput({ permit: null }),
    unauthorizedInput({ permit: { ...permit, expiresAt: Date.now() - 1 } }),
    unauthorizedInput({ network: { providerNetworkAuthority: 'AUTHORIZED', endpointEnforcement: 'OPEN_DECISION', impliedByFullAccess: false } }),
    unauthorizedInput({ network: { providerNetworkAuthority: 'NOT_AUTHORIZED', endpointEnforcement: 'APPROVED', impliedByFullAccess: false } }),
    unauthorizedInput({ network: { providerNetworkAuthority: 'UNKNOWN', endpointEnforcement: 'UNKNOWN', impliedByFullAccess: false } }),
    unauthorizedInput({ credentials: { ...unauthorizedInput().credentials, handoffAuthorized: false, dedicatedPreprovisioned: true } }),
    unauthorizedInput({ credentials: { ...unauthorizedInput().credentials, dedicatedPreprovisioned: false, handoffAuthorized: true } }),
    unauthorizedInput({ resultConsumer: { ...unauthorizedInput().resultConsumer, consumerReady: false } }),
    unauthorizedInput({ processOwnership: { ...unauthorizedInput().processOwnership, windowsJobAtCreation: 'UNVERIFIED' } }),
    unauthorizedInput({ environment: { ...environment, path: '' } }),
    unauthorizedInput({ executableIdentity: { ...unauthorizedInput().executableIdentity, regularFile: false } }),
    unauthorizedInput({ executableIdentity: { ...unauthorizedInput().executableIdentity, resolution: 'shim' } })
  ];
  const witnessed = withInvocationWitness(() => blocked.map(input => {
    let outcome;
    try {
      outcome = prepareProviderBackedWorker(input);
    } catch (error) {
      return { refused: error.message };
    }
    return outcome;
  }));
  assert.deepEqual(witnessed.attempts, []);
  for (const outcome of witnessed.value) {
    if ('refused' in outcome) continue;
    // Two independent facts: admission readiness and invocation permission.
    assert.equal(outcome.providerAdmissionReady, false);
    assert.equal(outcome.providerInvocationAllowed, false);
    assert.equal(outcome.admission.runtimeReady, false);
    assert.equal(outcome.launchable, false);
    assert.equal(outcome.launchAuthority, 'NOT_GRANTED');
    assert.ok(outcome.blockedGates.length > 0);
    assert.deepEqual(
      outcome.gateTable.filter(row => row.state !== 'READY').map(row => row.gate),
      [...outcome.blockedGates]
    );
  }
});

test('the seam never loads the owned runtime, the PTY layer, or a process API', () => {
  // Static proof of self-containment: no process, filesystem, credential,
  // network, or owned-runtime import exists in the module, so there is no
  // reachable path from preflight to a launch even by accident.
  const moduleSource = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'providerWorker.ts'), 'utf8'
  );
  for (const forbidden of ['node:child_process', 'node:fs', 'node:os', 'node:net', 'node:http', 'node:https', 'electron', "from './boundedWorker'", "from './pty'", "from './windowsOwnedPty'"]) {
    assert.ok(!moduleSource.includes(forbidden), `providerWorker.ts must not reference ${forbidden}`);
  }
  // The only imports are the accepted pure contract, environment, and launch builders.
  assert.deepEqual(
    [...moduleSource.matchAll(/from '([^']+)'/g)].map(match => match[1]).sort(),
    ['./codexWorkerContract', './ptyEnv', './workerLaunch']
  );
  // And its whole public surface is the preflight API: minting, identity
  // assertion/inspection, and the non-launching decision helper. No launch entry point exists.
  assert.deepEqual(Object.keys(preflightApi).sort(), [
    'PROVIDER_PREFLIGHT_SCHEMA_VERSION',
    'assertProviderWorkerPreflight',
    'decideProviderWorkerLaunch',
    'inspectProviderWorkerPreflight',
    'prepareProviderBackedWorker'
  ]);
  for (const forbidden of ['prepareBoundedWorker', 'launchOwnedPty', 'consumePreparedBoundedWorker']) {
    assert.ok(!(forbidden in preflightApi), `providerWorker.ts must not export ${forbidden}`);
  }
});

test('all-evidence READY shows the decision shape and still grants no launch authority', () => {
  const result = prepareProviderBackedWorker(allEvidenceInput());
  assert.equal(result.admission.state, 'READY');
  assert.equal(result.admission.runtimeReady, true);
  // Admission READY is NOT invocation permission: the two facts are separate, and
  // `providerInvocationAllowed` is the literal `false` even on a READY admission.
  assert.equal(result.providerAdmissionReady, true);
  assert.equal(result.providerInvocationAllowed, false);
  for (const name of ADMISSION_GATE_NAMES) assert.equal(result.admission.gates[name].state, 'READY', name);
  assert.deepEqual(result.blockedGates, []);
  // A READY decision is not a launch right: this slice mints nothing and launches nothing.
  assert.equal(result.launchAuthority, 'NOT_GRANTED');
  assert.equal(result.launchable, false);
  assert.ok(!('accept' in result));
  assert.ok(!('readyToLaunch' in result));
  assert.ok(!('prepared' in result));
});

test('only the ORIGINAL minted preflight authenticates; structural copies are refused', () => {
  const minted = prepareProviderBackedWorker(unauthorizedInput());
  // The identity bound at mint time is the only accepted provenance.
  assert.doesNotThrow(() => assertProviderWorkerPreflight(minted));
  assert.equal(inspectProviderWorkerPreflight(minted).minted, true);
  assert.equal(inspectProviderWorkerPreflight(minted).permitId, minted.permitId);
  assert.deepEqual([...inspectProviderWorkerPreflight(minted).blockedGates], [...minted.blockedGates]);

  // A clone that is field-for-field identical is still NOT the minted object.
  const clone = { ...minted };
  const reparsed = JSON.parse(JSON.stringify(minted));
  for (const [label, candidate] of [['spread copy', clone], ['JSON re-parse', reparsed]]) {
    assert.throws(() => assertProviderWorkerPreflight(candidate), /was not minted by prepareProviderBackedWorker/, label);
    assert.throws(() => decideProviderWorkerLaunch(candidate), /was not minted by prepareProviderBackedWorker/, label);
    const inspection = inspectProviderWorkerPreflight(candidate);
    assert.equal(inspection.minted, false);
    assert.equal(inspection.permitId, null);
    assert.equal(inspection.admissionState, null);
    assert.deepEqual([...inspection.blockedGates], []);
    assert.equal(inspection.launchAuthority, 'NOT_GRANTED');
  }
  for (const candidate of [null, undefined, 'preflight', 7, [], { schemaVersion: 1 }]) {
    assert.throws(() => assertProviderWorkerPreflight(candidate), /was not minted by prepareProviderBackedWorker/);
    assert.equal(inspectProviderWorkerPreflight(candidate).minted, false);
    assert.throws(() => decideProviderWorkerLaunch(candidate), /was not minted by prepareProviderBackedWorker/);
  }
  // Re-mint is a distinct identity: a second genuine preparation is not the first.
  assert.notEqual(prepareProviderBackedWorker(unauthorizedInput()), minted);
  // Two independent preparations each authenticate as themselves.
  const again = prepareProviderBackedWorker(unauthorizedInput());
  assert.doesNotThrow(() => assertProviderWorkerPreflight(again));
});

test('the production decision helper is explicit, effect-free, and never launchable', () => {
  const witnessed = withInvocationWitness(() => ({
    blocked: decideProviderWorkerLaunch(prepareProviderBackedWorker(unauthorizedInput())),
    ready: decideProviderWorkerLaunch(prepareProviderBackedWorker(allEvidenceInput()))
  }));
  assert.deepEqual(witnessed.attempts, []);

  // A blocked slice reports the blocked gates explicitly.
  assert.equal(witnessed.value.blocked.status, 'BLOCKED');
  assert.equal(witnessed.value.blocked.launchable, false);
  assert.equal(witnessed.value.blocked.launchAuthority, 'NOT_GRANTED');
  assert.ok(witnessed.value.blocked.blockedGates.length > 0);
  for (const gate of witnessed.value.blocked.blockedGates) {
    assert.ok(witnessed.value.blocked.reason.includes(gate), `reason must name the blocked gate ${gate}`);
  }
  assert.match(witnessed.value.blocked.reason, /BLOCKED at \d+ gate\(s\)/);
  assert.match(witnessed.value.blocked.reason, /providerInvocationAllowed is false/);
  assert.match(witnessed.value.blocked.reason, /no provider process is started/);

  // Even a fully satisfied admission is NOT a launch right in this slice.
  assert.equal(witnessed.value.ready.status, 'READY_BUT_LAUNCH_NOT_GRANTED');
  assert.equal(witnessed.value.ready.launchable, false);
  assert.equal(witnessed.value.ready.launchAuthority, 'NOT_GRANTED');
  assert.deepEqual([...witnessed.value.ready.blockedGates], []);
  assert.match(witnessed.value.ready.reason, /READY but launch authority is NOT_GRANTED/);
  assert.match(witnessed.value.ready.reason, /launch bridge .* is not authorized/);
  assert.match(witnessed.value.ready.reason, /no provider process is started/);
  for (const decision of [witnessed.value.blocked, witnessed.value.ready]) {
    assert.ok(!('launch' in decision));
    assert.ok(!('accept' in decision));
  }
  // The decision is a frozen value: a caller cannot rewrite a failure into a launch.
  assert.ok(Object.isFrozen(witnessed.value.blocked));
  assert.ok(Object.isFrozen(witnessed.value.ready));
});

test('the production spawn ingestion authenticates the preflight before any generic effect', () => {
  // The identity check above is behavioural; this asserts the ORDER that cannot be
  // reached without loading Electron: ingestion must authenticate the preflight
  // BEFORE the bounded branch and BEFORE every generic spawn side effect, and its
  // branch must not call the PTY layer or recurse. The security boundary asserted
  // here is the branch's POSITION and its absence of spawn calls — not its wording.
  const source = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8'
  );
  const start = source.indexOf('async function spawnAgentCore(');
  assert.ok(start !== -1, 'spawnAgentCore must exist');
  const body = source.slice(start, source.indexOf('\nfunction ', start + 1));

  const preflightAt = body.indexOf('opts.providerWorkerPreflight');
  assert.ok(preflightAt !== -1, 'spawnAgentCore must authenticate the provider preflight');
  const boundedAt = body.indexOf('if (opts.boundedWorker)');
  const tildeAt = body.indexOf('expandTilde(opts.cwd)');
  const inferAt = body.indexOf('inferAgentProvider(');
  const installAt = body.indexOf('buildMissingCliScript(');
  const ptyAt = body.lastIndexOf('ptyManager.spawn(opts, owner)');
  for (const [label, at] of [['bounded branch', boundedAt], ['cwd expansion', tildeAt],
    ['provider inference', inferAt], ['missing-CLI installer', installAt], ['final PTY spawn', ptyAt]]) {
    assert.ok(at !== -1, `${label} must exist in spawnAgentCore`);
    assert.ok(preflightAt < at, `preflight must be authenticated before ${label}`);
  }

  // The preflight branch is self-contained: it returns a decision and reaches no
  // PTY, no recursion, and no provider CLI.
  const branch = body.slice(preflightAt, boundedAt);
  assert.ok(branch.includes('decideProviderWorkerLaunch('), 'the branch must use the production decision helper');
  assert.ok(branch.includes('ok: false'), 'the branch must fail closed');
  for (const forbidden of ['ptyManager', 'spawnAgentCore(', 'isCommandAvailable(', 'resolveCommand(']) {
    assert.ok(!branch.includes(forbidden), `the preflight branch must not reach ${forbidden}`);
  }

  // Both renderer-facing intake guards reject the field outright.
  const spawnGuard = source.slice(source.indexOf("ipcMain.handle('pty:spawn'"), start);
  assert.match(spawnGuard, /providerWorkerPreflight' in opts/, 'pty:spawn must reject the preflight field');
  const requestGuard = source.slice(source.indexOf("if ('boundedWorker' in raw"), source.indexOf("if ('boundedWorker' in raw") + 400);
  assert.match(requestGuard, /providerWorkerPreflight' in raw/, 'worker spawn-request intake must reject the preflight field');
});

test('the PTY layer refuses a provider preflight before any generic resolution or effect', () => {
  const manager = new PtyManager();
  const preflight = prepareProviderBackedWorker(allEvidenceInput());
  // A cwd that does NOT exist: if the refusal ever ran after cwd expansion, the
  // caller would see `cwd does not exist` instead of the refusal.
  const opts = {
    id: 'pty-preflight-refusal',
    cwd: 'C:\\definitely\\not\\a\\real\\directory\\munder',
    command: 'codex',
    providerWorkerPreflight: preflight
  };

  const witnessed = withInvocationWitness(() => manager.spawn(opts));
  assert.deepEqual(witnessed.attempts, [], 'the refusal must precede every process/filesystem effect');
  assert.equal(witnessed.value.ok, false);
  assert.match(witnessed.value.error, /main-process only/);
  // Refused means refused: the cwd error never surfaced, and no session was registered.
  assert.ok(!/cwd does not exist/.test(witnessed.value.error));
  assert.equal(manager.countByOwner(null), 0);

  // An unrecognized (forged/structural) value is refused identically — the PTY
  // layer never authenticates, so it treats any non-undefined field the same.
  for (const forged of [{ ...preflight }, JSON.parse(JSON.stringify(preflight)), 'preflight', 7]) {
    const rejected = manager.spawn({ ...opts, providerWorkerPreflight: forged });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /main-process only/);
  }

  // Absent field: no refusal, and the normal fail-closed cwd error is preserved.
  const withoutField = { ...opts };
  delete withoutField.providerWorkerPreflight;
  const normal = manager.spawn(withoutField);
  assert.equal(normal.ok, false);
  assert.match(normal.error, /cwd does not exist/);
});

test('the PTY refusal is ordered before the bounded dispatch and the generic path', () => {
  const source = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'pty.ts'), 'utf8'
  );
  const body = source.slice(source.indexOf('  spawn(opts: SpawnOptions'), source.indexOf('  private spawnBounded('));
  const refusalAt = body.indexOf('opts.providerWorkerPreflight !== undefined');
  assert.ok(refusalAt !== -1, 'PtyManager.spawn must refuse the provider preflight');
  for (const [label, needle] of [
    ['bounded dispatch', 'if (opts.boundedWorker) return this.spawnBounded'],
    ['cwd expansion', 'expandTilde(opts.cwd)'],
    ['cwd existence check', 'cwd does not exist'],
    ['command resolution', 'this.resolveCommand(opts.command)'],
    ['shim resolution', 'this.resolveWindowsShimSpawn('],
    ['env construction', 'buildPtyEnv('],
    ['session registration', 'this.sessions.set('],
    ['final PTY spawn', 'pty.spawn(']
  ]) {
    const at = body.indexOf(needle);
    assert.ok(at !== -1, `${label} must exist in PtyManager.spawn`);
    assert.ok(refusalAt < at, `the refusal must precede ${label}`);
  }
  // And the refusal is a REFUSAL only: it authenticates nothing and reaches no spawn.
  const refusal = body.slice(refusalAt, body.indexOf('\n    if (opts.boundedWorker)'));
  assert.ok(refusal.includes('ok: false'), 'the refusal must fail closed');
  for (const forbidden of ['decideProviderWorkerLaunch', 'assertProviderWorkerPreflight', 'pty.spawn(', 'this.sessions.set(']) {
    assert.ok(!refusal.includes(forbidden), `the refusal must not reach ${forbidden}`);
  }
});
