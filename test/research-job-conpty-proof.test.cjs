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

function fixedNodeExecutable() {
  const executable = path.resolve(process.execPath);
  assert.equal(path.basename(executable).toLowerCase(), 'node.exe');
  return executable;
}

function admissionRootForTest() {
  const suffix = `A${process.pid.toString(36).toUpperCase().padStart(5, '0').slice(-5)}`;
  return path.join(root, '.tmp', `conpty-admission-${suffix}`);
}

function runPowerShell(args, environmentOverrides = {}) {
  const executable = findPowerShell();
  if (!executable) return { skipped: true };
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], {
    cwd: root,
    env: { ...safePowerShellEnvironment(), ...environmentOverrides },
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

test('outer failure stages and execution-state semantics are explicit', () => {
  for (const stage of [
    'native-input-validation', 'embedded-csharp-compile', 'environment-preparation',
    'native-entry-invocation', 'native-receipt-processing', 'durable-receipt-write'
  ]) assert.match(source, new RegExp(stage));
  for (const field of [
    'nativeEntryAttempted', 'nativeReceiptReturned', 'nativeExecutionState',
    'outerFailureStage', 'errorCategory', 'errorHResult', 'win32ErrorCode'
  ]) assert.match(source, new RegExp(field));
  for (const state of ['NOT_ATTEMPTED', 'ATTEMPTED_NO_RECEIPT', 'EXECUTED_WITH_RECEIPT']) {
    assert.match(source, new RegExp(state));
  }
  assert.match(source, /\$nativeReceiptReturned = \$null -ne \$nativeReceipt/);
  assert.match(source, /-NativeReceiptReturned \$nativeReceiptReturned/);
  assert.doesNotMatch(source, /native-admission-or-compile-failed/);
  assert.doesNotMatch(source, /error\.Message/);
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
  assert.match(source, /unrelatedSentinelCreated/);
  assert.match(source, /unrelatedSentinelOutsideProofJob/);
  assert.match(source, /unrelatedSentinelCleanupVerified/);
  assert.match(source, /CreateFixedSentinel/);
  assert.match(source, /IsProcessInJob\(sentinel\.hProcess, job/);
  assert.match(source, /TerminateProcess\(sentinel\.hProcess/);
  assert.doesNotMatch(source, /GetCurrentProcess/);
});

test('all bounded proof cases are represented without enabling retry/recovery/takeover', () => {
  for (const scenario of [
    'normal-descendant', 'root-early-exit', 'bounded-stop', 'timeout',
    'query-failure', 'helper-failure', 'receipt-failure', 'unrelated-sentinel', 'pty-io'
  ]) assert.match(source, new RegExp(scenario.replace('-', '\\-')));
  assert.match(fixture, /'--sentinel'/);
  assert.doesNotMatch(source, /retry|recovery|takeover/i);
  assert.match(source, /forcedStop/);
});

test('default path is non-native and does not write a durable receipt', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell([]);
  if (result.skipped) return;
  const receipt = receiptFrom(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.drainDiagnostics, null);
  assert.equal(receipt.nativeExecuted, false);
  assert.equal(receipt.rootCreationSucceeded, false);
  assert.equal(receipt.pseudoConsoleClosed, false);
  assert.equal(receipt.result, 'UNKNOWN');
  assert.equal(receipt.cleanupState, 'UNKNOWN');
  assert.equal(receipt.nativeEntryAttempted, false);
  assert.equal(receipt.nativeReceiptReturned, false);
  assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
  assert.equal(fs.existsSync(path.join(root, '.tmp', 'conpty-job-proof-receipt.json')), false);
});

test('compile-only path compiles native declarations but never executes proof mode', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell(['-CompileOnly']);
  if (result.skipped) return;
  const receipt = receiptFrom(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.drainDiagnostics, null);
  assert.equal(receipt.nativeExecuted, false);
  assert.equal(receipt.rootCreationSucceeded, false);
  assert.equal(receipt.verification, 'PASS');
  assert.equal(receipt.result, 'UNKNOWN');
  assert.deepEqual(receipt.checks, ['PowerShell parsed', 'embedded C# compiled', 'native entry not invoked']);
  assert.equal(receipt.nativeEntryAttempted, false);
  assert.equal(receipt.nativeReceiptReturned, false);
  assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
});

test('AdmissionOnly passes fixed input, compile, and environment without native entry', { skip: process.platform !== 'win32' }, () => {
  const admissionRoot = admissionRootForTest();
  assert.equal(fs.existsSync(admissionRoot), false);
  try {
    const result = runPowerShell([
      '-AdmissionOnly', '-NodeExecutable', fixedNodeExecutable(), '-AdmissionRoot', admissionRoot
    ]);
    if (result.skipped) return;
    const receipt = receiptFrom(result);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(receipt.drainDiagnostics, null);
    assert.equal(receipt.admissionResult, 'PASS');
    assert.deepEqual(receipt.admissionChecks, [
      'fixed absolute node and fixture', 'embedded C# compiled', 'bounded environment prepared'
    ]);
    assert.equal(receipt.nativeEntryAttempted, false);
    assert.equal(receipt.nativeReceiptReturned, false);
    assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
    assert.equal(receipt.nativeExecuted, false);
    assert.equal(receipt.verification, 'PASS');
    assert.equal(receipt.result, 'UNKNOWN');
    assert.equal(receipt.outerFailureStage, null);
    assert.equal(fs.existsSync(path.join(admissionRoot, 'proof-receipt.json')), false);
  } finally {
    if (fs.existsSync(admissionRoot)) fs.rmSync(admissionRoot, { recursive: true, force: false });
  }
});

test('AdmissionOnly invalid input fails before native entry with a specific stage', { skip: process.platform !== 'win32' }, () => {
  const admissionRoot = admissionRootForTest();
  const invalidNode = path.join(root, '.tmp', 'not-a-node.exe');
  assert.equal(fs.existsSync(admissionRoot), false);
  try {
    const result = runPowerShell([
      '-AdmissionOnly', '-NodeExecutable', invalidNode, '-AdmissionRoot', admissionRoot
    ]);
    if (result.skipped) return;
    const receipt = receiptFrom(result);
    assert.equal(receipt.drainDiagnostics, null);
    assert.equal(result.status, 1);
    assert.equal(receipt.admissionResult, 'FAIL');
    assert.equal(receipt.outerFailureStage, 'native-input-validation');
    assert.equal(receipt.errorCategory, 'ADMISSION');
    assert.equal(receipt.nativeEntryAttempted, false);
    assert.equal(receipt.nativeReceiptReturned, false);
    assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
    assert.equal(receipt.nativeExecuted, false);
  } finally {
    if (fs.existsSync(admissionRoot)) fs.rmSync(admissionRoot, { recursive: true, force: false });
  }
});

test('AdmissionOnly environment failure is distinguished from input failure', { skip: process.platform !== 'win32' }, () => {
  const admissionRoot = admissionRootForTest();
  assert.equal(fs.existsSync(admissionRoot), false);
  try {
    const result = runPowerShell([
      '-AdmissionOnly', '-NodeExecutable', fixedNodeExecutable(), '-AdmissionRoot', admissionRoot
    ], { ComSpec: path.join(root, '.tmp', 'missing-comspec.exe') });
    if (result.skipped) return;
    const receipt = receiptFrom(result);
    assert.equal(receipt.drainDiagnostics, null);
    assert.equal(result.status, 1);
    assert.equal(receipt.admissionResult, 'FAIL');
    assert.equal(receipt.outerFailureStage, 'environment-preparation');
    assert.equal(receipt.errorCategory, 'ENVIRONMENT');
    assert.equal(receipt.nativeEntryAttempted, false);
    assert.equal(receipt.nativeReceiptReturned, false);
    assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
  } finally {
    if (fs.existsSync(admissionRoot)) fs.rmSync(admissionRoot, { recursive: true, force: false });
  }
});

test('shared C# capture and receipt serialization preserve synthetic diagnostic observations', { skip: process.platform !== 'win32' }, () => {
  const executable = findPowerShell();
  assert.ok(executable, 'PowerShell required for behavioral diagnostics');
  // Parse definitions, not the executable script body. No native entry or reader thread.
  const payload = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Harness parse failed' }
$assignment = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$nativeSource' })
if ($assignment.Count -ne 1) { throw 'Expected one embedded source' }
. ([scriptblock]::Create($assignment[0].Extent.Text))
Add-Type -TypeDefinition $nativeSource -Language CSharp
foreach ($name in @('Get-NativeExecutionState','New-Receipt','Write-Receipt')) {
  $definition = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq $name })
  if ($definition.Count -ne 1) { throw 'Expected exact receipt function' }
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
$Scenario = 'root-early-exit'; $sourceIdentity = $null; $fixtureIdentity = $null
$type = [Munder.Research.ConptyJobProofNative].GetNestedType('OutputDrain', [Reflection.BindingFlags]::NonPublic)
$private = [Reflection.BindingFlags]'Instance,NonPublic'
$marker = "DESCENDANT_READY\n".Replace('\n', [string][char]10)
$inputBytes = [Text.Encoding]::UTF8.GetBytes("ROOT_EXIT\nDESCENDANT_READY\n".Replace('\n', [string][char]10))
foreach ($case in @('lf','crlf','truncated','error')) {
  $drain = [Activator]::CreateInstance($type, [object[]]@([IntPtr]::Zero))
  $bytes = $inputBytes
  if ($case -eq 'crlf') { $bytes = [Text.Encoding]::UTF8.GetBytes("ROOT_EXIT\r\nDESCENDANT_READY\r\n".Replace('\r', [string][char]13).Replace('\n', [string][char]10)) }
  if ($case -eq 'truncated') { $bytes = [Text.Encoding]::UTF8.GetBytes(('x' * 65537)) }
  $null = $type.GetMethod('Capture',$private).Invoke($drain,[object[]]@($bytes,$bytes.Length))
  $null = $type.GetMethod('ObserveMarker',$private).Invoke($drain,[object[]]@("ROOT_EXIT\n".Replace('\n', [string][char]10)))
  $null = $type.GetMethod('ObserveMarker',$private).Invoke($drain,[object[]]@($marker))
  $terminal = $null
  if ($case -eq 'error') { $terminal = 6 }
  $null = $type.GetMethod('RecordTerminal',$private).Invoke($drain,[object[]]@($terminal))
  if ($case -ne 'error') { $type.GetField('task').SetValue($drain,[Threading.Tasks.Task]::CompletedTask) }
  $diagnostics = [Munder.Research.DrainDiagnostics]::new()
  $diagnostics.completedBeforePseudoConsoleClose = $false
  $diagnostics.completedAfterPseudoConsoleClose = $true
  $diagnostics.completedBeforeOutputReadClose = $true
  $diagnostics.completedAfterOutputReadClose = $true
  $diagnostics.waitResult = $case -ne 'error'
  $drain.Snapshot($diagnostics)
  $native = [Munder.Research.ConptyJobProofReceipt]::new()
  $native.drainDiagnostics = $diagnostics
  $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -Native $native
  Write-Receipt -Receipt $receipt
}
`;
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(payload, 'utf16le').toString('base64')], {
    cwd: root, env: safePowerShellEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 30000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const receipts = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(receipts.length, 4);
  const inputs = [
    Buffer.from('ROOT_EXIT\nDESCENDANT_READY\n'),
    Buffer.from('ROOT_EXIT\r\nDESCENDANT_READY\r\n'),
    Buffer.alloc(65537, 'x'),
    Buffer.from('ROOT_EXIT\nDESCENDANT_READY\n')
  ];
  for (const [index, receipt] of receipts.entries()) {
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.result, 'UNKNOWN');
    assert.equal(receipt.cleanupState, 'UNKNOWN');
    assert.equal(receipt.nativeExecuted, false);
    assert.equal(receipt.nativeExecutionState, 'NOT_ATTEMPTED');
    assert.equal(receipt.descendantObserved, false);
    const d = receipt.drainDiagnostics;
    const input = inputs[index];
    const truncated = index === 2;
    const error = index === 3;
    assert.equal(d.bytesRead, input.length);
    assert.deepEqual(Buffer.from(d.capturedBytesBase64, 'base64'), truncated ? input.subarray(0, 65536) : input);
    assert.equal(d.captureTruncated, truncated);
    assert.equal(d.rootMarkerObserved, !truncated);
    assert.equal(d.descendantMarkerObserved, !truncated);
    assert.equal(d.markerBufferPrefix, truncated ? 'x'.repeat(65536) : input.toString('utf8'));
    assert.equal(d.markerBufferLength, input.length);
    assert.equal(d.markerBufferTruncated, truncated);
    assert.equal(d.terminalReadOutcome, error ? 'ERROR' : 'ZERO_BYTES');
    assert.equal(d.terminalReadError, error ? 6 : null);
    assert.equal(d.drainErrorCode, error ? 6 : null);
    assert.equal(d.cancellationAttempts, 0);
    assert.equal(d.cancelErrorCode, null);
    assert.equal(d.outputReadCloseDeferred, false);
    assert.equal(d.completedBeforePseudoConsoleClose, false);
    assert.equal(d.completedAfterPseudoConsoleClose, true);
    assert.equal(d.completedBeforeOutputReadClose, true);
    assert.equal(d.completedAfterOutputReadClose, true);
    assert.equal(d.waitResult, !error);
    assert.equal(d.completedAtSnapshot, !error);
  }
});

test('native mode is never selected by the test harness', () => {
  assert.doesNotMatch(testSource, /['"]-Native\b/);
  assert.doesNotMatch(testSource, /\bNative\s*:\s*true/);
});
