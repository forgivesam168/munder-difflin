'use strict';

/*
 * Production compile gate for the Windows owned-PTY native host.
 *
 * 這個檔案補的是既有覆蓋缺口：test/research-job-conpty-proof.test.cjs 的
 * compile-only 路徑只編譯 tools/research-job-conpty-proof.ps1 內嵌的 research
 * C#，而真正的 production 來源 src/main/windowsOwnedPty.cs 從未被任何測試編譯
 * 過。因此像 CS0266（uint error constant 指派給 int）這種純編譯期缺陷，只能等到
 * 真的啟動 worker 時，才以 launch-failure receipt 的形式浮現。
 *
 * 契約：以 fresh PowerShell 7（pwsh）對真實 production 絕對路徑執行
 *   Add-Type -Path <abs>/src/main/windowsOwnedPty.cs -ErrorAction Stop
 * 僅做記憶體內編譯，並以反射確認 production 型別已產生。不執行
 * NativeHost.Run、不 dot-source windowsOwnedPty.ps1、不建立 worker / Job /
 * ConPTY / provider / network 連線。缺少 pwsh、編譯失敗或非零離開碼一律 FAIL，
 * 不回傳假 PASS；非 Windows 平台以明確 skip 表示，而非 PASS。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'main', 'windowsOwnedPty.cs');

// 編譯 700 行 C# 只需要數秒；此上限只用來把「卡住」轉成明確 FAIL。
const COMPILE_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const expectedTypes = [
  'Munder.WindowsOwnedPty.NativeHost',
  'Munder.WindowsOwnedPty.LaunchRequest',
  'Munder.WindowsOwnedPty.ExitReceipt'
];

function assertProductionSourceIsCompilableFile() {
  assert.equal(path.isAbsolute(sourcePath), true, 'production source path must be absolute');
  assert.equal(path.extname(sourcePath), '.cs');
  const stats = fs.statSync(sourcePath);
  assert.equal(stats.isFile(), true, `production source is missing: ${sourcePath}`);
  assert.ok(stats.size > 0, 'production source is empty');
  return sourcePath;
}

function findPowerShell7() {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    process.env.SystemDrive
      && path.join(process.env.SystemDrive, 'Program Files', 'PowerShell', '7', 'pwsh.exe')
  ].filter(Boolean);
  const fromPath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(directory => path.join(directory, 'pwsh.exe'));
  const found = [...candidates, ...fromPath].find(candidate => fs.existsSync(candidate));
  return found ? path.resolve(found) : null;
}

// 只傳入固定小清單，杜絕繼承宿主環境或任何 secret / credential。
function safePowerShellEnvironment() {
  const allowed = ['SystemRoot', 'ComSpec', 'PATH', 'TEMP', 'TMP'];
  return Object.fromEntries(allowed
    .map(key => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell7(payload) {
  const executable = findPowerShell7();
  assert.ok(
    executable,
    'PowerShell 7 (pwsh.exe) is required on Windows to compile the production native host'
  );
  assert.equal(path.basename(executable).toLowerCase(), 'pwsh.exe');
  const result = spawnSync(
    executable,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(payload, 'utf16le').toString('base64')],
    {
      cwd: root,
      env: safePowerShellEnvironment(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: COMPILE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES
    }
  );
  if (result.error) {
    assert.fail(`PowerShell 7 compile gate did not complete: ${result.error.message}`);
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function productionCompilePayload(source) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required for the production compile gate' }",
    'try {',
    `    Add-Type -Path ${psQuote(source)} -ErrorAction Stop`,
    "    $run = [Munder.WindowsOwnedPty.NativeHost].GetMethod('Run', [Reflection.BindingFlags]'Public,Static')",
    "    if ($null -eq $run) { throw 'NativeHost.Run was not produced by the production source' }",
    '    $types = @(',
    '        [Munder.WindowsOwnedPty.NativeHost].FullName,',
    '        [Munder.WindowsOwnedPty.LaunchRequest].FullName,',
    '        [Munder.WindowsOwnedPty.ExitReceipt].FullName',
    '    )',
    '    [ordered]@{',
    "        status = 'COMPILE_OK';",
    '        powershell = $PSVersionTable.PSVersion.ToString();',
    `        source = ${psQuote(source)};`,
    '        types = $types;',
    '        nativeHostRunDefined = $true',
    '    } | ConvertTo-Json -Compress -Depth 4',
    '} catch {',
    "    [Console]::Error.WriteLine('COMPILE_FAIL ' + $_.Exception.Message)",
    '    exit 3',
    '}'
  ].join('\n');
}

// 負向對照：同一條 Add-Type 呼叫路徑必須回報 CS0266（uint → int），
// 證明此 gate 不是「無論如何都成功」的空殼。C# 以 base64 內嵌，避免引號與換行干擾。
function cs0266ControlPayload() {
  // 必須是真正的隱式轉換錯誤：const uint 若值可容納於 int，C# 允許其常數轉換，
  // 不會產生 CS0266；因此改用非 const 的 uint 參數指派給 int。
  const broken = [
    'namespace Munder.CompileGateControl',
    '{',
    '    public static class Broken',
    '    {',
    '        public static bool Query(uint returned, out int error)',
    '        {',
    '            error = returned;',
    '            return false;',
    '        }',
    '    }',
    '}'
  ].join('\n');
  const encoded = Buffer.from(broken, 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `    $control = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${psQuote(encoded)}))`,
    '    Add-Type -TypeDefinition $control -Language CSharp -ErrorAction Stop',
    "    [Console]::Out.WriteLine('CONTROL_COMPILED')",
    '} catch {',
    "    [Console]::Error.WriteLine('CONTROL_FAIL ' + $_.Exception.Message)",
    '    exit 4',
    '}'
  ].join('\n');
}

test('production windowsOwnedPty.cs compiles under fresh PowerShell 7', { skip: process.platform !== 'win32' }, () => {
  const source = assertProductionSourceIsCompilableFile();
  const result = runPowerShell7(productionCompilePayload(source));
  assert.equal(
    result.status,
    0,
    `production compile gate exited ${result.status}: ${result.stderr || result.stdout}`
  );
  assert.doesNotMatch(result.stderr, /error CS\d{4}/, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'COMPILE_OK');
  assert.equal(receipt.source, source);
  assert.ok(Number(receipt.powershell.split('.')[0]) >= 7, `PowerShell 7 required, saw ${receipt.powershell}`);
  assert.equal(receipt.nativeHostRunDefined, true);
  assert.deepEqual(receipt.types, expectedTypes);
});

test('compile gate surfaces the CS0266 error class instead of silently passing', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell7(cs0266ControlPayload());
  assert.notEqual(result.status, 0, 'a compiler error must produce a nonzero exit code');
  assert.doesNotMatch(result.stdout, /CONTROL_COMPILED/);
  assert.match(result.stderr, /CONTROL_FAIL/);
  assert.match(result.stderr, /CS0266/, `expected the CS0266 diagnostic, saw: ${result.stderr}`);
});
