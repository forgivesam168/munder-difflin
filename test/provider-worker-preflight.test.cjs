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
const executionApi = loadTs('src/main/providerExecutionPreparation.ts');
// Inert handles and .invalid metadata prove mechanics only, never provider/network authority.
const executionNetworks = new WeakMap();
function executionFor(contract, text = 'provider-mechanics-only') {
  const issuer = executionApi.createProviderExecutionIssuer();
  const expiresAt = Date.now() + 120_000;
  const request = Buffer.from(JSON.stringify({ contract, task: { encoding: 'utf8', text } }));
  const provenance = issuer.createSyntheticProvenance(contract, expiresAt);
  const execution = issuer.prepare(contract, issuer.mintCredential(contract, {
    recordId: 'synthetic-record', grantedBy: 'SYNTHETIC_ONLY', purpose: 'PROVIDER_EXECUTION',
    scopeDigest: executionApi.providerCredentialScopeDigest(contract), endpointOrigin: 'https://provider.invalid', expiresAt
  }, provenance), issuer.mintTask(contract, request, expiresAt), 'https://provider.invalid');
  executionNetworks.set(execution, issuer.mintInertNetworkAuthority(execution, contract, expiresAt));
  return execution;
}
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
  task: require('node:crypto').createHash('sha256').update('provider-mechanics-only').digest('hex')
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

test('bridge refuses absent authority and structural preflights without effects', () => {
  const bridge = preflightApi.createProviderWorkerBridge();
  const ready = prepareProviderBackedWorker(allEvidenceInput());
  const witnessed = withInvocationWitness(() => {
    for (const input of [unauthorizedInput(), allEvidenceInput({ credentials: unauthorizedInput().credentials }),
      allEvidenceInput({ network: { ...allEvidenceInput().network, providerNetworkAuthority: 'NOT_AUTHORIZED' } }),
      allEvidenceInput({ network: { ...allEvidenceInput().network, endpointEnforcement: 'OPEN_DECISION' } })]) {
      const preflight = prepareProviderBackedWorker(input);
      assert.throws(() => bridge.authorize(preflight, {}, 'AUTHORIZED'), /BLOCKED/);
      assert.throws(() => bridge.prepare(preflight, {}), /BLOCKED/);
    }
    assert.throws(() => bridge.authorize(ready, {}, undefined, executionFor(ready.contract)), /network authority is absent/);
    for (const fake of [{}, { ...ready }, JSON.parse(JSON.stringify(ready))]) {
      assert.throws(() => bridge.authorize(fake, {}, 'AUTHORIZED'), /not minted/);
      assert.throws(() => bridge.prepare(fake, {}), /not minted/);
    }
    assert.throws(() => bridge.prepare(ready, undefined), /authority is absent/);
    assert.throws(() => bridge.authorize(ready, {}, 'AUTHORIZED'), /Missing or forged/);
    const execution = executionFor(ready.contract);
    const ticket = bridge.authorize(ready, {}, executionNetworks.get(execution), execution);
    for (const fake of [{}, { ...ticket }, JSON.parse(JSON.stringify(ticket))]) {
      assert.throws(() => bridge.prepare(ready, fake), /authority is absent/);
    }
    assert.throws(() => preflightApi.createProviderWorkerBridge().prepare(ready, ticket), /authority is absent/);
    assert.throws(() => bridge.prepare(prepareProviderBackedWorker(allEvidenceInput()), ticket), /does not match/);
    const bounded = loadTs('src/main/boundedWorker.ts');
    assert.throws(() => bounded.prepareBoundedWorker({}, { preflight: ready }), /not minted/);
    assert.throws(() => bounded.consumePreparedBoundedWorker({ contract: ready.contract }), /not minted/);
  });
  assert.deepEqual(witnessed.attempts, []);
});

test('expired preflight cannot bridge and a failed preparation spends every ticket for that preflight', () => {
  const bridge = preflightApi.createProviderWorkerBridge();
  const ready = prepareProviderBackedWorker(allEvidenceInput());
  const execution = executionFor(ready.contract);
  const ticket = bridge.authorize(ready, {}, executionNetworks.get(execution), execution);
  const originalNow = Date.now;
  try {
    Date.now = () => permit.expiresAt + 1;
    assert.throws(() => bridge.prepare(ready, ticket), /expired/);
  } finally { Date.now = originalNow; }
  const second = bridge.authorize(ready, {}, executionNetworks.get(execution), execution);
  const otherBridge = preflightApi.createProviderWorkerBridge();
  const other = otherBridge.authorize(ready, {}, executionNetworks.get(execution), execution);
  const witnessed = withInvocationWitness(() => {
    assert.throws(() => bridge.prepare(ready, ticket), /permitId/);
    assert.throws(() => bridge.prepare(ready, ticket), /authority is absent/);
    assert.throws(() => bridge.prepare(ready, second), /already consumed/);
    assert.throws(() => otherBridge.prepare(ready, other), /already consumed/);
    assert.throws(() => bridge.authorize(ready, {}, executionNetworks.get(execution), execution), /already consumed/);
  });
  assert.deepEqual(witnessed.attempts, []);
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
  // Ingestion must authenticate the preflight and separate authority BEFORE the
  // bounded branch and every generic spawn effect. Exercise that boundary below
  // without loading Electron; retain source ordering and bypass checks for the
  // effects intentionally excluded from this focused harness.
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

  // Exercise the production boundary without loading Electron or the generic
  // effects below it. Keep the bounded dispatch in the extracted code so a
  // refusal that falls through, or a preparation that retains caller options,
  // fails observably rather than merely matching a helper's name.
  const boundaryAt = body.indexOf('if (opts.providerWorkerPreflight !== undefined)');
  assert.ok(boundaryAt !== -1 && boundaryAt < boundedAt);
  const dispatchEnd = body.indexOf('\n', boundedAt);
  assert.ok(dispatchEnd > boundedAt);
  const ingest = new Function('opts', 'owner', 'providerBridgeAuthority',
    'providerWorkerBridge', 'ptyManager', `${body.slice(boundaryAt, dispatchEnd)}
      throw new Error('unexpected generic spawn effect');`);
  const preflight = prepareProviderBackedWorker(allEvidenceInput());
  const authority = Object.freeze({});
  const owner = Object.freeze({});
  const boundedWorker = Object.freeze({
    contract: { workerId: 'bridge-worker' }, cwd: 'bridge-cwd', executablePath: 'bridge-executable'
  });
  const callerOptions = {
    id: 'untrusted-id', cwd: 'untrusted-cwd', command: 'untrusted-command',
    providerWorkerPreflight: preflight, providerBridgeAuthority: Object.freeze({ forged: true }),
    boundedWorker: { forged: true }, env: { UNTRUSTED: 'yes' }, args: ['untrusted'],
    hive: { cwd: 'untrusted-hive' }
  };
  const events = [];
  const success = { ok: true };
  assert.equal(ingest(callerOptions, owner, authority, {
    prepare(value, ticket) {
      events.push('prepare');
      assert.equal(value, preflight, 'prepare must receive the original preflight');
      assert.equal(ticket, authority, 'authority must come from the separate argument');
      return boundedWorker;
    }
  }, {
    spawn(options, actualOwner) {
      events.push('bounded');
      assert.equal(actualOwner, owner);
      assert.deepEqual(options, {
        id: boundedWorker.contract.workerId, cwd: boundedWorker.cwd,
        command: boundedWorker.executablePath, boundedWorker
      }, 'only rebuilt bounded options may reach dispatch');
      assert.notEqual(options, callerOptions);
      return success;
    }
  }), success);
  assert.deepEqual(events, ['prepare', 'bounded']);

  const noDispatch = { spawn() { assert.fail('refusal must precede bounded dispatch'); } };
  for (const error of [new Error('bridge refused'), 'non-Error refusal']) {
    const result = ingest(callerOptions, owner, authority, {
      prepare() { throw error; }
    }, noDispatch);
    assert.deepEqual(result, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  // Use the real bridge for missing/forged authority: a READY admission and an
  // authority-shaped option must not grant invocation permission.
  const bridge = preflightApi.createProviderWorkerBridge();
  const witnessed = withInvocationWitness(() => {
    for (const ticket of [undefined, authority]) {
      const result = ingest(callerOptions, owner, ticket, bridge, noDispatch);
      assert.equal(result.ok, false);
      assert.match(result.error, /authority is absent or does not match preflight/);
    }
    const result = ingest({ ...callerOptions, providerWorkerPreflight: undefined }, owner, authority, {
      prepare() { assert.fail('authority without preflight must be refused'); }
    }, noDispatch);
    assert.equal(result.ok, false);
  });
  assert.deepEqual(witnessed.attempts, []);

  const branch = body.slice(preflightAt, boundedAt);
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
  const refusal = body.slice(refusalAt, body.indexOf('    if (opts.boundedWorker)'));
  assert.ok(refusal.includes('ok: false'), 'the refusal must fail closed');
  for (const forbidden of ['decideProviderWorkerLaunch', 'assertProviderWorkerPreflight', 'pty.spawn(', 'this.sessions.set(']) {
    assert.ok(!refusal.includes(forbidden), `the refusal must not reach ${forbidden}`);
  }
});

/**
 * The positive path walks the PRODUCTION bridge across local fixture/backend files
 * to a minted preparation, then exercises final consumption refusal twice under
 * process/write/network witnesses. A separate provider-free preparation exercises
 * trusted structured result publication without launching any process.
 *
 * MOCKED/DERIVED READY IS BRIDGE MECHANICS ONLY. The READY admission constructed
 * here is a locally derived, Main-shaped evidence record over local files; it is
 * NOT evidence of credential provisioning, provider network authority, endpoint
 * approval, or any provider/model request. Nothing in this case starts a process,
 * reads a credential, opens a socket, or reaches a provider CLI. The real
 * native/runtime evidence for the owned PTY layer is produced by
 * test/owned-pty-runtime.test.cjs and is NOT claimed or replaced here.
 *
 * The transient root is left in `.tmp` as this run's evidence, matching the
 * existing runtime-suite convention rather than deleting the artifact it proves.
 */
test('the production bridge reaches a minted PreparedBoundedWorker with zero invocation', () => {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const net = require('node:net');
  const bounded = loadTs('src/main/boundedWorker.ts');
  const repository = path.resolve(__dirname, '..');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(process.platform, 'win32', 'the owned-runtime positive path requires Windows; do not report a skipped proof as PASS');

  const run = fs.mkdtempSync(path.join(repository, '.tmp', 'p-bridge-'));
  const syntheticRootDir = path.join(run, 'worker');
  const host = path.join(run, 'host');
  fs.mkdirSync(syntheticRootDir);
  fs.mkdirSync(host);

  // Real approved files: the fixture script, the native helper script/source, the
  // owned-runtime helper, and `process.execPath` as the fixture executable.
  const helperPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  assert.equal(fs.existsSync(helperPath), true,
    'this case requires the same local PowerShell helper as test/owned-pty-runtime.test.cjs');
  const fixturePath = path.join(repository, 'test', 'fixtures', 'bounded-worker.cjs');
  const nativeScriptPath = path.join(repository, 'src', 'main', 'windowsOwnedPty.ps1');
  const nativeSourcePath = path.join(repository, 'src', 'main', 'windowsOwnedPty.cs');

  const localIdentity = {
    candidateId: 'p-bridge-candidate-001',
    taskId: 'p-bridge-task-001',
    runId: path.basename(run),
    workerId: `worker-${path.basename(run)}`,
    taskDigest: crypto.createHash('sha256').update('p-bridge-local-mocked-ready').digest('hex'),
    sourceCheckpoint: {
      repositoryId: 'forgivesam168/munder-difflin',
      commitSha: 'a3a3e7b4819abadefd16bede77aad5cf51adf568',
      treeSha: 'e4ad946d915f75dcb7b24f70a7b82719c7a8f981'
    }
  };
  const localExecutable = {
    executablePath: process.execPath,
    version: process.version,
    executableSha256: hash(process.execPath)
  };
  const localContract = createCodexWorkerContract({
    ...localIdentity, executable: localExecutable, syntheticRoot: syntheticRootDir,
    credentialMode: 'DEDICATED_PREPROVISIONED'
  });
  for (const directory of localContract.rootPolicy.allowedDirectories) fs.mkdirSync(directory);
  const requestPath = path.join(host, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify({ contract: localContract,
    task: { encoding: 'utf8', text: 'p-bridge-local-mocked-ready' } }), { flag: 'wx' });

  const helperData = path.join(run, 'helper');
  for (const name of ['home', 'temp', 'appdata', 'localappdata']) fs.mkdirSync(path.join(helperData, name), { recursive: true });
  const helperEnv = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: path.join(process.env.SystemRoot, 'System32', 'cmd.exe'),
    PATH: path.join(process.env.SystemRoot, 'System32'),
    HOME: path.join(helperData, 'home'),
    USERPROFILE: path.join(helperData, 'home'),
    TEMP: path.join(helperData, 'temp'),
    TMP: path.join(helperData, 'temp'),
    APPDATA: path.join(helperData, 'appdata'),
    LOCALAPPDATA: path.join(helperData, 'localappdata')
  };

  // The accepted owned-runtime backend record, hash-bound to the real local files.
  const localBackend = {
    runtime: 'BOUNDED_OWNED_PTY',
    helperPath,
    helperSha256: hash(helperPath),
    nativeScriptPath,
    nativeScriptSha256: hash(nativeScriptPath),
    nativeSourcePath,
    nativeSourceSha256: hash(nativeSourcePath)
  };
  const permitExpiry = Date.now() + 120_000;
  const localPermit = {
    permitId: 'permit-p-bridge-001',
    expiresAt: permitExpiry,
    humanApproved: true,
    identity: localIdentity,
    fixture: { ...localExecutable, scriptPath: fixturePath, scriptSha256: hash(fixturePath) },
    requestPath,
    requestSha256: hash(requestPath),
    mode: 'pass',
    argv: [...CODEX_WORKER_ARGV],
    syntheticRoot: syntheticRootDir,
    hostReceiptDir: host,
    workerPath: localContract.rootPolicy.workDir,
    limits: { maxResultBytes: 65536, maxArtifactBytes: 65536, maxArtifactTotalBytes: 262144, maxArtifactCount: 8 },
    ownedBackend: {
      helperPath, helperSha256: localBackend.helperSha256,
      scriptPath: localBackend.nativeScriptPath, scriptSha256: localBackend.nativeScriptSha256,
      nativeSourcePath: localBackend.nativeSourcePath, nativeSourceSha256: localBackend.nativeSourceSha256,
      helperEnv, cols: 100, rows: 30, timeoutMs: 12000, cleanupMs: 5000
    }
  };

  // All-evidence input: credential, network, endpoint, ownership, and authority
  // claims are all satisfied so the ten-gate table reaches READY. This is the
  // MOCKED half — it proves the bridge mechanics, not provider authority.
  const bridgeReadyInput = {
    permit: {
      permitId: localPermit.permitId, expiresAt: permitExpiry,
      ownedRuntimeBackend: localBackend, humanApproved: true
    },
    identity: localIdentity,
    executable: localExecutable,
    executableIdentity: {
      canonicalPath: localExecutable.executablePath,
      regularFile: true,
      resolution: 'absolute-direct',
      version: localExecutable.version,
      executableSha256: localExecutable.executableSha256
    },
    syntheticRoot: syntheticRootDir,
    rootPolicy: {
      root: localContract.rootPolicy.root,
      projectDir: localContract.rootPolicy.projectDir,
      workDir: localContract.rootPolicy.workDir,
      artifactDir: localContract.rootPolicy.artifactDir,
      resultPath: localContract.rootPolicy.resultPath,
      canonical: true, directories: true, linkFree: true
    },
    environment: {
      path: localContract.rootPolicy.workDir,
      home: localContract.rootPolicy.homeDir,
      userProfile: localContract.rootPolicy.userProfileDir,
      temp: localContract.rootPolicy.tempDir,
      tmp: localContract.rootPolicy.tempDir,
      codexHome: localContract.rootPolicy.codexHomeDir,
      systemRoot: process.env.SystemRoot
    },
    credentials: {
      mode: 'DEDICATED_PREPROVISIONED',
      dailyAuthJsonAccessed: false, dailyConfigTomlAccessed: false,
      credentialLikeEnvironmentPresent: false, providerSecretsPresent: false,
      dedicatedPreprovisioned: true, handoffAuthorized: true
    },
    network: { providerNetworkAuthority: 'AUTHORIZED', endpointEnforcement: 'APPROVED', impliedByFullAccess: false },
    processOwnership: {
      platform: 'win32', ptyAtCreation: 'VERIFIED', windowsJobAtCreation: 'VERIFIED',
      descendants: 'VERIFIED', stop: 'VERIFIED', timeout: 'VERIFIED', cleanup: 'VERIFIED'
    },
    resultConsumer: {
      resultPath: localContract.resultPolicy.resultPath,
      artifactDir: localContract.resultPolicy.artifactDir,
      resultSlotAvailable: true, validatorBound: true, artifactContainmentBound: true,
      duplicateRejected: true, consumerReady: true
    },
    authority: {
      sourceCheckpointApproved: true, identityApproved: true, humanApproved: true, runtimePermit: 'PRESENT'
    }
  };

  const bridge = preflightApi.createProviderWorkerBridge();
  // In addition to the shared process/filesystem-write witness, trip any socket
  // connect: a provider/model endpoint contact must fail this case, not pass it.
  const originalConnect = net.Socket.prototype.connect;
  const connects = [];
  net.Socket.prototype.connect = function connect() {
    connects.push('connect');
    throw new Error('network connect attempted during bridge preparation');
  };
  let witnessed;
  try {
    witnessed = withInvocationWitness(() => {
      const preflight = prepareProviderBackedWorker(bridgeReadyInput);
      const execution = executionFor(preflight.contract, 'p-bridge-local-mocked-ready');
      const ticket = bridge.authorize(preflight, localPermit, executionNetworks.get(execution), execution);
      const prepared = bridge.prepare(preflight, ticket);
      return { preflight, ticket, prepared };
    });
  } finally {
    net.Socket.prototype.connect = originalConnect;
  }
  assert.deepEqual(connects, [], 'no provider/model endpoint may be contacted');
  assert.deepEqual(witnessed.attempts, [], 'the bridge must reach preparation with no process or filesystem-write effect');

  const { preflight, ticket, prepared } = witnessed.value;
  // The mocked half: READY admission is bridge mechanics only, and invocation
  // permission stays the literal `false` even on this all-evidence record.
  assert.equal(preflight.admission.state, 'READY');
  assert.equal(preflight.providerAdmissionReady, true);
  assert.equal(preflight.providerInvocationAllowed, false);
  assert.equal(preflight.launchAuthority, 'NOT_GRANTED');
  assert.equal(preflight.launchable, false);

  // A real minted PreparedBoundedWorker with the frozen identity and binding.
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(prepared.permitId, localPermit.permitId);
  assert.equal(prepared.contract.candidateId, localIdentity.candidateId);
  assert.equal(prepared.contract.taskId, localIdentity.taskId);
  assert.equal(prepared.contract.runId, localIdentity.runId);
  assert.equal(prepared.contract.workerId, localIdentity.workerId);
  assert.equal(prepared.contract.taskDigest, localIdentity.taskDigest);
  assert.deepEqual(prepared.contract.sourceCheckpoint, localContract.sourceCheckpoint);
  assert.equal(prepared.contract.rootPolicy.root, syntheticRootDir);
  assert.equal(prepared.executablePath, localExecutable.executablePath);
  assert.equal(prepared.contract.executable.version, localExecutable.version);
  assert.equal(prepared.contract.executable.executableSha256, localExecutable.executableSha256);

  // Fixed launch, explicit environment, and the bound owned-runtime backend.
  assert.deepEqual(prepared.args, [...CODEX_WORKER_ARGV]);
  assert.equal(prepared.cwd, localContract.rootPolicy.workDir);
  assert.deepEqual(Object.keys(prepared.env), [...CODEX_ENV_ALLOWLIST]);
  assert.equal(prepared.env.HOME, localContract.rootPolicy.homeDir);
  assert.equal(prepared.env.SYSTEMROOT, process.env.SystemRoot);
  assert.ok(!('OPENAI_API_KEY' in prepared.env));
  assert.ok(!('CODEX_API_KEY' in prepared.env));
  assert.equal(prepared.launch.helperPath, localBackend.helperPath);
  assert.equal(prepared.launch.helperSha256, localBackend.helperSha256);
  assert.equal(prepared.launch.scriptPath, localBackend.nativeScriptPath);
  assert.equal(prepared.launch.scriptSha256, localBackend.nativeScriptSha256);
  assert.equal(prepared.launch.nativeSourcePath, localBackend.nativeSourcePath);
  assert.equal(prepared.launch.nativeSourceSha256, localBackend.nativeSourceSha256);
  assert.equal(prepared.launch.executablePath, localExecutable.executablePath);
  assert.equal(prepared.launch.executableSha256, localExecutable.executableSha256);
  // Runtime backend: the preflight's accepted record is carried into the launch
  // binding verbatim, with the fixed native bounds — not re-derived from caller data.
  assert.deepEqual(preflight.runtimeBackend, localBackend);
  assert.equal(prepared.launch.cols, 100);
  assert.equal(prepared.launch.rows, 30);
  assert.equal(prepared.launch.timeoutMs, 12000);
  assert.equal(prepared.launch.cleanupMs, 5000);
  assert.match(prepared.bindingDigest, /^[0-9a-f]{64}$/);

  // The minted admission IS the preflight's decision, still READY, and the
  // prepared object carries no launch right of its own.
  assert.equal(prepared.admission, preflight.admission);
  assert.equal(prepared.admission.state, 'READY');
  assert.equal(prepared.admission.runtimeReady, true);
  assert.equal(preflight.providerInvocationAllowed, false, 'preparation must not upgrade invocation permission');
  assert.equal(typeof prepared.accept, 'function');

  // Bounded mint authenticity: the object is a member of the preparation registry,
  // while a spread copy and a JSON re-parse of it are not.
  assert.doesNotThrow(() => bounded.assertPreparedBoundedWorker(prepared));
  assert.throws(() => bounded.assertPreparedBoundedWorker({ ...prepared }), /was not minted by prepareBoundedWorker/);
  assert.throws(() => bounded.assertPreparedBoundedWorker(JSON.parse(JSON.stringify(prepared))), /was not minted by prepareBoundedWorker/);
  assert.throws(() => bounded.consumePreparedBoundedWorker({ ...prepared }), /was not minted by prepareBoundedWorker/);

  // The spent ticket and the spent preflight cannot prepare again, and a foreign
  // bridge, a structural preflight, or a forged ticket all fail closed — each
  // refusal under its own witness, so "refused without effects" is observed and
  // not merely asserted.
  const refusals = withInvocationWitness(() => {
    assert.throws(() => bridge.prepare(preflight, ticket), /authority is absent or does not match preflight/);
    assert.throws(() => bridge.prepare(preflight, { ...ticket }), /authority is absent or does not match preflight/);
    const execution = executionFor(preflight.contract, 'p-bridge-local-mocked-ready');
    assert.throws(() => bridge.authorize(preflight, localPermit, executionNetworks.get(execution), execution), /already consumed/);
    assert.throws(() => bridge.prepare({ ...preflight }, ticket), /was not minted by prepareProviderBackedWorker/);
    assert.throws(() => preflightApi.createProviderWorkerBridge().prepare(preflight, ticket), /does not match preflight/);
  });
  assert.deepEqual(refusals.attempts, []);

  // No PTY/provider invocation occurred; successful inert consumption grants no durable result.
  assert.deepEqual(witnessed.attempts, []);
  assert.deepEqual(connects, []);
  const approvedRequest = fs.readFileSync(requestPath);
  try {
    fs.appendFileSync(requestPath, ' ');
    const changed = withInvocationWitness(() =>
      assert.throws(() => bounded.consumePreparedBoundedWorker(prepared), /approved SHA256/));
    assert.deepEqual(changed.attempts, []);
  } finally { fs.writeFileSync(requestPath, approvedRequest); }
  const consumption = withInvocationWitness(() => {
    bounded.consumePreparedBoundedWorker(prepared);
    assert.throws(() => bounded.consumePreparedBoundedWorker(prepared), /already been consumed for launch/);
  });
  assert.deepEqual(consumption.attempts, []);

  // The trusted adapter also accepts the real local provider-free preparation seam.
  // Consumption is a lifecycle transition only: no native launch is performed.
  const freeContract = createCodexWorkerContract({ ...localIdentity, executable: localExecutable,
    syntheticRoot: syntheticRootDir, credentialMode: 'NONE' });
  fs.writeFileSync(requestPath, JSON.stringify({ contract: freeContract }));
  const free = bounded.prepareBoundedWorker({ ...localPermit, requestSha256: hash(requestPath),
    argv: [fixturePath, requestPath, 'pass'] });
  const adapter = preflightApi.createProviderTaskResultAdapter(free);
  const { candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint } = free.contract;
  const result = { schemaVersion: contractApi.CODEX_WORKER_RESULT_SCHEMA_VERSION,
    candidateId, taskId, runId, workerId, taskDigest, sourceCheckpoint,
    result: 'PASS', checks: { credentialMode: 'PASS' }, artifacts: [] };
  assert.throws(() => adapter.publish(result), /not live/);
  bounded.consumePreparedBoundedWorker(free);
  const recognized = preflightApi.createRecognizedProviderCompletionIssuer(free);
  const completion = recognized.recognizeStructuredCompletion();
  for (const fake of [{}, { ...completion }, JSON.parse(JSON.stringify(completion)),
    preflightApi.createRecognizedProviderCompletionIssuer(free).recognizeStructuredCompletion()])
    assert.throws(() => recognized.publish(fake, result), /Missing recognized/);
  for (const output of ['PASS', 0]) assert.throws(() => recognized.publish(completion, output));
  assert.equal(fs.existsSync(free.contract.resultPolicy.resultPath), false);
  for (const invalid of [{ ...result, runId: 'stale' },
    { ...result, checks: { mechanics: 'FAIL' } },
    { ...result, checks: { api_key: 'PASS' } }]) assert.throws(() => adapter.publish(invalid));
  fs.writeFileSync(free.contract.resultPolicy.resultPath, 'existing-conflict', { flag: 'wx' });
  assert.throws(() => adapter.publish(result), /Duplicate/);
  assert.equal(fs.readFileSync(free.contract.resultPolicy.resultPath, 'utf8'), 'existing-conflict');
  fs.unlinkSync(free.contract.resultPolicy.resultPath);
  const originalLink = fs.linkSync;
  try {
    fs.linkSync = () => { throw new Error('synthetic publication failure'); };
    assert.throws(() => adapter.publish(result), /synthetic publication failure/);
  } finally { fs.linkSync = originalLink; }
  assert.equal(fs.existsSync(free.contract.resultPolicy.resultPath), false);
  recognized.publish(completion, result);
  assert.throws(() => recognized.publish(completion, result), /Missing recognized/);
  const canonical = contractApi.validateTaskResult(result, free.contract, { resultAlreadyExists: false });
  assert.equal(fs.readFileSync(free.contract.resultPolicy.resultPath, 'utf8'), `${JSON.stringify(canonical, null, 2)}\n`);
  assert.throws(() => adapter.publish(result), /already consumed/);
  assert.equal(contractApi.classifyTerminal({ durableResult: 'ABSENT', processExitCode: 0,
    cleanup: 'VERIFIED_EMPTY' }).state, 'UNKNOWN');
});
