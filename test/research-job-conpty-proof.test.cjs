'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'tools', 'research-job-conpty-proof.ps1');
const fixturePath = path.join(__dirname, 'fixtures', 'research-job-conpty-child.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');
const fixture = fs.readFileSync(fixturePath, 'utf8');
const testSource = fs.readFileSync(__filename, 'utf8');

function findPowerShell() {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function safePowerShellEnvironment() {
  const allowed = ['SystemRoot', 'ComSpec', 'PATH', 'TEMP', 'TMP'];
  return Object.fromEntries(allowed
    .map(key => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function runPowerShell(args) {
  const executable = findPowerShell();
  if (!executable) return { skipped: true };
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], {
    cwd: root,
    env: safePowerShellEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000
  });
  if (result.error) throw result.error;
  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function receiptFrom(result) {
  assert.equal(result.skipped, false, 'Windows PowerShell is required for execution checks');
  assert.notEqual(result.stdout, '', result.stderr);
  return JSON.parse(result.stdout);
}

test('harness source fixes direct creation-time ConPTY and Job-list requirements', () => {
  for (const token of [
    'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
    'CreatePseudoConsole',
    'STARTUPINFOEX',
    'PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE',
    'PROC_THREAD_ATTRIBUTE_JOB_LIST',
    'CreateProcessW',
    'IsProcessInJob',
    'QueryInformationJobObject',
    'ActiveProcesses',
    'TerminateJobObject',
    'KILL_ON_JOB_CLOSE'
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), token);
  assert.match(source, /InitializeProcThreadAttributeList\([^\n]*, 2,/);
  assert.match(source, /UpdateProcThreadAttribute[\s\S]*PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE/);
  assert.match(source, /UpdateProcThreadAttribute[\s\S]*PROC_THREAD_ATTRIBUTE_JOB_LIST/);
});

test('harness has no post-creation membership fallback, PID discovery, or shell runner', () => {
  assert.doesNotMatch(source, /AssignProcessToJobObject/);
  assert.doesNotMatch(source, /CREATE_SUSPENDED/);
  assert.doesNotMatch(source, /taskkill/i);
  assert.doesNotMatch(source, /GetProcesses\s*\(/);
  assert.doesNotMatch(source, /Get-Process\b/i);
  assert.doesNotMatch(source, /process[- ]name/i);
  assert.doesNotMatch(source, /Start-Process\b/i);
  assert.match(source, /CreateProcessW\(executable, commandLine/);
  assert.match(source, /CreateProcessW\(executable, commandLine[\s\S]*?\n\s*EXTENDED_STARTUPINFO_PRESENT/);
  assert.match(source, /FixedCommand\(executable, fixture, scenario\)/);
});

test('harness does not inherit the host environment or access network/credentials', () => {
  assert.doesNotMatch(source, /GetEnvironmentVariables\s*\(/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /Invoke-WebRequest|Invoke-RestMethod|HttpClient|WebClient|TcpClient/);
  assert.match(source, /New-NativeEnvironmentBlock/);
  assert.match(source, /SystemRoot = \$systemRoot/);
  assert.match(source, /NODE_DISABLE_COMPILE_CACHE = '1'/);
  assert.match(source, /Credential-like environment key is forbidden/);
  assert.doesNotMatch(source, /OPENAI_API_KEY|CODEX_API_KEY|auth\.json|config\.toml/i);
});

test('fixed fixture is inert and has no arbitrary command or shell surface', () => {
  assert.match(fixture, /const FIXED_MODES = new Set/);
  assert.match(fixture, /process\.execPath, \[__filename, '--leaf'/);
  assert.match(fixture, /stdio: 'inherit'/);
  assert.doesNotMatch(fixture, /exec\(/);
  assert.doesNotMatch(fixture, /execFile\(/);
  assert.doesNotMatch(fixture, /cmd\.exe|powershell\.exe|shell:\s*true/i);
});

test('receipt schema and terminal semantics are explicit', () => {
  for (const field of [
    'schemaVersion', 'proofId', 'sourceIdentity', 'fixtureIdentity', 'rootProcessId',
    'rootCreationSucceeded', 'rootJobMember', 'descendantObserved', 'rootExit',
    'terminationRequested', 'terminationCount', 'activeProcessesFinal', 'queryError',
    'pseudoConsoleClosed', 'ioDrained', 'cleanupState', 'result'
  ]) assert.match(source, new RegExp(field));
  for (const state of ['VERIFIED_EMPTY', 'FAILED', 'UNKNOWN']) assert.match(source, new RegExp(state));
  assert.match(source, /receipt\.result = "PASS"/);
  assert.match(source, /receipt\.result = "UNKNOWN"/);
  assert.match(source, /receipt\.result = "FAIL"/);
  assert.match(source, /WaitActiveZero\(job/);
  assert.match(source, /activeProcessesAfterRootExit = active/);
  assert.match(source, /Root exit did not leave the expected owned descendant/);
  assert.match(source, /unrelatedProcessTouched/);
  assert.match(source, /workerTreeClaim = 'synthetic root and its descendants only'/);
  assert.match(source, /pseudoConsoleHostIncluded = \$false/);
  assert.match(source, /unrelatedSentinelSurvived/);
});

test('all bounded proof cases are represented without enabling retry/recovery/takeover', () => {
  for (const scenario of [
    'normal-descendant', 'root-early-exit', 'bounded-stop', 'timeout',
    'query-failure', 'helper-failure', 'receipt-failure', 'unrelated-sentinel', 'pty-io'
  ]) assert.match(source, new RegExp(scenario.replace('-', '\\-')));
  assert.doesNotMatch(source, /retry|recovery|takeover/i);
  assert.match(source, /forcedStop/);
});

test('default path is non-native and does not write a durable receipt', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell([]);
  if (result.skipped) return;
  const receipt = receiptFrom(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.nativeExecuted, false);
  assert.equal(receipt.rootCreationSucceeded, false);
  assert.equal(receipt.pseudoConsoleClosed, false);
  assert.equal(receipt.result, 'UNKNOWN');
  assert.equal(receipt.cleanupState, 'UNKNOWN');
  assert.equal(fs.existsSync(path.join(root, '.tmp', 'conpty-job-proof-receipt.json')), false);
});

test('compile-only path compiles native declarations but never executes proof mode', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell(['-CompileOnly']);
  if (result.skipped) return;
  const receipt = receiptFrom(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.nativeExecuted, false);
  assert.equal(receipt.rootCreationSucceeded, false);
  assert.equal(receipt.verification, 'PASS');
  assert.equal(receipt.result, 'UNKNOWN');
  assert.deepEqual(receipt.checks, ['PowerShell parsed', 'embedded C# compiled', 'native entry not invoked']);
});

test('native mode is never selected by the test harness', () => {
  assert.doesNotMatch(testSource, /['"]-Native\b/);
  assert.doesNotMatch(testSource, /\bNative\s*:\s*true/);
});
