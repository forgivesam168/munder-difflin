'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const contractApi = loadTs('src/main/codexWorkerContract.ts');
const launchApi = loadTs('src/main/workerLaunch.ts');
const envApi = loadTs('src/main/ptyEnv.ts');

const {
  ADMISSION_GATE_NAMES,
  CODEX_ENV_ALLOWLIST,
  classifyNoProgress,
  classifyTerminal,
  createCodexWorkerContract,
  evaluateCodexAdmission,
  validateTaskResult
} = contractApi;
const { buildCodexWorkerLaunch, CODEX_WORKER_ARGV } = launchApi;
const { buildCodexWorkerEnv, validateCodexWorkerEnv } = envApi;

const descriptor = {
  executablePath: 'C:\\approved\\codex.exe',
  version: 'codex-cli 0.153.4',
  executableSha256: 'A'.repeat(64)
};

const contract = createCodexWorkerContract({
  candidateId: 'codex-candidate-001',
  taskId: 'task-b1-contract',
  runId: 'run-b1-001',
  workerId: 'worker-b1-001',
  taskDigest: 'b'.repeat(64),
  sourceCheckpoint: {
    repositoryId: 'forgivesam168/munder-difflin',
    commitSha: '7ca2cd21395e1d1e384ed9df44c0600b36f67f93',
    treeSha: 'c'.repeat(40)
  },
  executable: descriptor,
  syntheticRoot: 'C:\\synthetic\\munder-b1\\run-001'
});

const envInput = {
  path: 'C:\\approved\\runtime',
  home: contract.rootPolicy.homeDir,
  userProfile: contract.rootPolicy.userProfileDir,
  temp: contract.rootPolicy.tempDir,
  tmp: contract.rootPolicy.tempDir,
  codexHome: contract.rootPolicy.codexHomeDir,
  systemRoot: 'C:\\Windows'
};

function completeEvidence(overrides = {}) {
  return {
    executableIdentity: {
      canonicalPath: contract.executable.executablePath,
      regularFile: true,
      resolution: 'absolute-direct',
      version: contract.executable.version,
      executableSha256: contract.executable.executableSha256
    },
    taskIdentity: { taskId: contract.taskId, taskDigest: contract.taskDigest },
    sourceIdentity: { ...contract.sourceCheckpoint },
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
    environmentPolicy: { env: buildCodexWorkerEnv(envInput) },
    credentialPolicy: {
      mode: 'NONE',
      dailyAuthJsonAccessed: false,
      dailyConfigTomlAccessed: false,
      credentialLikeEnvironmentPresent: false,
      providerSecretsPresent: false,
      dedicatedPreprovisioned: false,
      handoffAuthorized: false
    },
    networkPolicy: {
      providerNetworkAuthority: 'AUTHORIZED',
      endpointEnforcement: 'APPROVED',
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
    resultPolicy: {
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

function validResult(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateId: contract.candidateId,
    runId: contract.runId,
    workerId: contract.workerId,
    taskId: contract.taskId,
    taskDigest: contract.taskDigest,
    sourceCheckpoint: { ...contract.sourceCheckpoint },
    result: 'PASS',
    checks: { identity: 'PASS', durable: 'PASS' },
    artifacts: [{ path: 'summary.txt', sha256: 'd'.repeat(64) }],
    ...overrides
  };
}

test('contract fixes identity, synthetic root scope, policies, and required gates', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.executable.executableSha256, 'a'.repeat(64));
  assert.equal(contract.rootPolicy.projectDir, 'C:\\synthetic\\munder-b1\\run-001\\project');
  assert.equal(contract.rootPolicy.workDir, 'C:\\synthetic\\munder-b1\\run-001\\work');
  assert.equal(contract.resultPolicy.resultPath, contract.rootPolicy.resultPath);
  assert.equal(contract.environmentPolicy.inheritHostEnvironment, false);
  assert.deepEqual(contract.environmentPolicy.allowedKeys, CODEX_ENV_ALLOWLIST);
  assert.equal(contract.credentialPolicy.dailyAuthJson, 'DENY');
  assert.equal(contract.credentialPolicy.dailyConfigToml, 'DENY');
  assert.equal(contract.networkPolicy.providerEndpointEnforcement, 'OPEN_DECISION');
  assert.equal(contract.networkPolicy.fullAccessDoesNotGrantNetwork, true);
  assert.equal(contract.processOwnershipPolicy.ptyOwnership, 'CREATION_TIME_REQUIRED');
  assert.equal(contract.processOwnershipPolicy.windowsJobOwnership, 'CREATION_TIME_REQUIRED');
  assert.deepEqual(contract.requiredGates, ADMISSION_GATE_NAMES);
  assert.throws(() => createCodexWorkerContract({
    candidateId: contract.candidateId,
    taskId: contract.taskId,
    runId: contract.runId,
    workerId: contract.workerId,
    taskDigest: contract.taskDigest,
    sourceCheckpoint: contract.sourceCheckpoint,
    executable: descriptor,
    syntheticRoot: 'C:\\'
  }), /below the filesystem root/);
});

test('Codex invocation is explicit, fixed, non-shell, and never request-authored', () => {
  const launch = buildCodexWorkerLaunch(contract.executable);
  assert.deepEqual(launch, {
    executablePath: contract.executable.executablePath,
    args: [...CODEX_WORKER_ARGV],
    shell: false
  });
  assert.throws(() => buildCodexWorkerLaunch({ ...descriptor, executablePath: 'codex' }), /canonical and absolute/);
  assert.throws(() => buildCodexWorkerLaunch({ ...descriptor, executablePath: 'C:\\approved\\codex.cmd' }), /shell shim/);
  assert.throws(() => buildCodexWorkerLaunch({ ...descriptor, executableSha256: 'not-a-hash' }), /SHA256/);
});

test('Codex environment uses only explicit dedicated inputs and no host/credential inheritance', () => {
  const env = buildCodexWorkerEnv(envInput);
  assert.deepEqual(Object.keys(env), [...CODEX_ENV_ALLOWLIST]);
  assert.deepEqual(validateCodexWorkerEnv(env, envInput), env);
  assert.equal(env.HOME, contract.rootPolicy.homeDir);
  assert.equal(env.USERPROFILE, contract.rootPolicy.userProfileDir);
  assert.equal(env.CODEX_HOME, contract.rootPolicy.codexHomeDir);
  assert.ok(!('OPENAI_API_KEY' in env));
  assert.ok(!('CODEX_API_KEY' in env));
  assert.throws(() => validateCodexWorkerEnv({ ...env, OPENAI_API_KEY: 'synthetic' }), /allowlist/);
  assert.throws(() => validateCodexWorkerEnv({ ...env, NODE_OPTIONS: '--require=bad' }), /allowlist/);
  assert.throws(() => buildCodexWorkerEnv({ ...envInput, inherited: 'no' }), /inputs/);
  assert.throws(() => validateCodexWorkerEnv({ ...env, SYSTEMROOT: undefined }), /value/);
  assert.throws(() => validateCodexWorkerEnv({ ...env, SystemRoot: env.SYSTEMROOT }), /allowlist/);
  assert.throws(() => validateCodexWorkerEnv({ ...env, SYSTEMROOT: 'relative' }), /canonical absolute/);
  assert.throws(() => validateCodexWorkerEnv({ ...env, SYSTEMROOT: 'C:\\other' }, envInput), /mismatch/);
  assert.equal(evaluateCodexAdmission(contract, completeEvidence({
    environmentPolicy: { env: { ...env, SYSTEMROOT: contract.rootPolicy.workDir } }
  })).gates.environmentPolicy.state, 'BLOCKED');
});

test('durable task result validates exact identity, schema, containment, and duplicate rejection', () => {
  const emptyResultSlot = { resultAlreadyExists: false };
  const result = validateTaskResult(validResult(), contract, emptyResultSlot);
  assert.equal(result.result, 'PASS');
  assert.equal(result.artifacts[0].path, 'summary.txt');
  for (const patch of [
    { candidateId: 'other-candidate' },
    { runId: 'other-run' },
    { workerId: 'other-worker' },
    { taskId: 'other-task' },
    { taskDigest: 'e'.repeat(64) },
    { sourceCheckpoint: { ...contract.sourceCheckpoint, treeSha: 'f'.repeat(40) } },
    { schemaVersion: 2 },
    { extra: true }
  ]) {
    assert.throws(() => validateTaskResult({ ...validResult(), ...patch }, contract, emptyResultSlot));
  }
  for (const path of ['../outside.txt', '/outside.txt', 'C:\\outside.txt']) {
    assert.throws(() => validateTaskResult(validResult({ artifacts: [{ path, sha256: 'd'.repeat(64) }] }), contract, emptyResultSlot), /Artifact path/);
  }
  assert.throws(() => validateTaskResult(validResult({
    artifacts: [
      { path: 'same.txt', sha256: 'd'.repeat(64) },
      { path: 'same.txt', sha256: 'e'.repeat(64) }
    ]
  }), contract, emptyResultSlot), /Duplicate/);
  assert.throws(() => validateTaskResult(validResult(), contract, { resultAlreadyExists: true }), /Duplicate task result/);
  assert.throws(() => validateTaskResult(validResult({ result: 'PASS', checks: { identity: 'FAIL' } }), contract, emptyResultSlot), /conflicts/);
  assert.throws(() => validateTaskResult(validResult({ result: 'UNKNOWN', checks: { identity: 'PASS' } }), contract, emptyResultSlot), /conflicts/);
  assert.throws(() => validateTaskResult(validResult(), contract), /Result slot/);
});

test('terminal classification requires durable result and verified cleanup; exit alone is insufficient', () => {
  assert.deepEqual(classifyTerminal({ durableResult: 'PASS', processExitCode: 0, cleanup: 'VERIFIED_EMPTY' }), {
    state: 'PASS', reason: 'durable-pass-and-verified-cleanup'
  });
  assert.equal(classifyTerminal({ durableResult: 'ABSENT', processExitCode: 0, cleanup: 'VERIFIED_EMPTY' }).state, 'UNKNOWN');
  assert.equal(classifyTerminal({ durableResult: 'PASS', processExitCode: 1, cleanup: 'VERIFIED_EMPTY' }).state, 'UNKNOWN');
  assert.equal(classifyTerminal({ durableResult: 'FAIL', processExitCode: 1, cleanup: 'VERIFIED_EMPTY' }).state, 'FAIL');
  assert.equal(classifyTerminal({ durableResult: 'FAIL', processExitCode: 1, cleanup: 'UNVERIFIED' }).state, 'UNKNOWN');
});

test('no-progress boundary records observable signals only and classifies them conservatively', () => {
  assert.equal(classifyNoProgress([]), 'NONE');
  assert.equal(classifyNoProgress(['NO_OUTPUT_WITHIN_BOUND', 'NO_DURABLE_RESULT']), 'UNKNOWN');
  assert.throws(() => classifyNoProgress(['NO_DURABLE_RESULT', 'NO_DURABLE_RESULT']), /Duplicate/);
  assert.throws(() => classifyNoProgress(['not-a-signal']), /Invalid/);
});

test('default admission is BLOCKED with runtimeReady false and no runtime side effect', () => {
  const decision = evaluateCodexAdmission(contract);
  assert.equal(decision.state, 'BLOCKED');
  assert.equal(decision.runtimeReady, false);
  assert.deepEqual(Object.keys(decision.gates), [...ADMISSION_GATE_NAMES]);
  for (const gate of ['credentialPolicy', 'networkPolicy', 'processOwnership', 'resultPolicy', 'authority']) {
    assert.equal(decision.gates[gate].state, 'BLOCKED', gate);
  }
});

test('network open decision and missing creation-time ownership keep admission closed', () => {
  const decision = evaluateCodexAdmission(contract, completeEvidence({
    networkPolicy: {
      providerNetworkAuthority: 'AUTHORIZED',
      endpointEnforcement: 'OPEN_DECISION',
      impliedByFullAccess: false
    },
    processOwnership: {
      platform: 'win32',
      ptyAtCreation: 'VERIFIED',
      windowsJobAtCreation: 'UNVERIFIED',
      descendants: 'VERIFIED',
      stop: 'VERIFIED',
      timeout: 'VERIFIED',
      cleanup: 'VERIFIED'
    }
  }));
  assert.equal(decision.state, 'BLOCKED');
  assert.equal(decision.runtimeReady, false);
  assert.equal(decision.gates.networkPolicy.state, 'BLOCKED');
  assert.equal(decision.gates.processOwnership.state, 'BLOCKED');
});

test('pure admission can express READY only when every required gate is explicitly satisfied', () => {
  const decision = evaluateCodexAdmission(contract, completeEvidence());
  assert.equal(decision.state, 'READY');
  assert.equal(decision.runtimeReady, true);
  for (const name of ADMISSION_GATE_NAMES) assert.equal(decision.gates[name].state, 'READY', name);
});
