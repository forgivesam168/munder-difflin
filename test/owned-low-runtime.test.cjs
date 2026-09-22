'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { launchOwnedPty } = require('./load-ts.cjs')('src/main/windowsOwnedPty.ts');
const repository = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const callbacks = { onData() {}, onStarted() {}, onExit() {} };
const keys = ['helperPath', 'helperSha256', 'scriptPath', 'scriptSha256', 'nativeSourcePath', 'nativeSourceSha256', 'executablePath', 'executableSha256', 'args', 'cwd', 'env', 'helperEnv', 'cols', 'rows', 'timeoutMs', 'cleanupMs'];

test('launch schema rejects missing, alias, unknown, extra and incompatible security contexts before helper creation', t => {
  const spawn = t.mock.method(require('node:child_process'), 'spawn', () => { throw new Error('unexpected spawn'); });
  const base = Object.fromEntries(keys.map(key => [key, null]));
  for (const value of [undefined, null, '', 'restricted_low', 'Restricted_Low', 'CURRENT', 1, {}]) {
    const input = { ...base, ioMode: 'RAW_PIPE' };
    if (value !== undefined) input.securityContext = value;
    assert.throws(() => launchOwnedPty(input, callbacks), /schema|security context/);
  }
  assert.throws(() => launchOwnedPty({ ...base, SecurityContext: 'CURRENT_PROCESS' }, callbacks), /schema/);
  assert.throws(() => launchOwnedPty({ ...base, securityContext: 'CURRENT_PROCESS', extra: true }, callbacks), /schema/);
  assert.throws(() => launchOwnedPty({ ...base, securityContext: 'RESTRICTED_LOW', ioMode: 'CONPTY' }, callbacks), /requires RAW_PIPE/);
  assert.equal(spawn.mock.callCount(), 0);
});

test('provider-free production security boundary and RAW_PIPE lifecycle', { timeout: 240000 }, async t => {
  assert.equal(process.platform, 'win32', 'Windows proof is required, not skipped');
  // Cleanup owns only this invocation's exclusive directory, never historical roots.
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'munder-owned-low-run-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  const helperPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const executablePath = path.join(run, 'OwnedLowChild.exe');
  const scriptPath = path.join(repository, 'src/main/windowsOwnedPty.ps1');
  const nativeSourcePath = path.join(repository, 'src/main/windowsOwnedPty.cs');
  const systemRoot = process.env.SystemRoot;
  const helperEnv = { SystemRoot: systemRoot, ComSpec: path.join(systemRoot, 'System32/cmd.exe'), PATH: path.join(systemRoot, 'System32'), TEMP: run, TMP: run, HOME: run, USERPROFILE: run, APPDATA: run, LOCALAPPDATA: run, POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off', PSModuleAnalysisCachePath: path.join(run, 'module-cache') };
  const compile = spawnSync(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; Add-Type -Path ${quote(path.join(__dirname, 'fixtures/owned-low-child.cs'))} -ReferencedAssemblies 'System.Web.Extensions.dll' -OutputAssembly ${quote(executablePath)} -OutputType ConsoleApplication`, 'utf16le').toString('base64')], { cwd: run, env: helperEnv, encoding: 'utf8', timeout: 60000 });
  assert.equal(compile.error, undefined);
  assert.equal(compile.status, 0, compile.stderr);
  const setup = spawnSync(executablePath, ['setup', run], { cwd: run, env: helperEnv, encoding: 'utf8', timeout: 15000 });
  assert.equal(setup.error, undefined);
  assert.equal(setup.status, 0, setup.stderr);
  const user = setup.stdout.trim();
  const base = { securityContext: 'CURRENT_PROCESS', ioMode: 'RAW_PIPE', helperPath, helperSha256: hash(helperPath), scriptPath, scriptSha256: hash(scriptPath), nativeSourcePath, nativeSourceSha256: hash(nativeSourcePath), executablePath, executableSha256: hash(executablePath), args: ['entry', run], cwd: path.join(run, 'worker'), env: { SystemRoot: systemRoot, OWNED_LITERAL: 'literal $(not-a-shell) 中文' }, helperEnv, cols: 80, rows: 24, timeoutMs: 15000, cleanupMs: 5000 };
  const bytes = Buffer.from('literal\r\n中文\u0000EOF\n');
  for (const [securityContext, mode] of [['CURRENT_PROCESS', 'entry'], ['RESTRICTED_LOW', 'mutate'], ['RESTRICTED_LOW', 'wait']]) {
    await t.test(`${securityContext} ${mode}`, async () => {
      let output = '', started = null, receipt;
      const launch = { ...base, securityContext, args: [mode, run, 'space " quote', ''], timeoutMs: mode === 'wait' ? 3000 : 15000 };
      const worker = launchOwnedPty(launch, { onData: text => { output += text; }, onStarted: pid => { started = pid; }, onExit() {} });
      try { worker.input(bytes); worker.closeInput(); receipt = await worker.completion; }
      finally { if (!receipt) { worker.stop(); await worker.completion; } }
      fs.writeFileSync(path.join(run, `${securityContext}-${mode}.json`), JSON.stringify({ receipt, output }, null, 2), { flag: 'wx' });
      assert.equal(receipt.error, undefined);
      assert.equal(receipt.reason, mode === 'wait' ? 'timeout' : 'exit');
      if (mode !== 'wait') assert.equal(receipt.rootExit, 0);
      assert.ok(started > 0);
      assert.equal(receipt.securityContext, securityContext);
      assert.equal(receipt.restrictedTokenVerified, securityContext === 'RESTRICTED_LOW');
      assert.equal(receipt.childTokenVerified, securityContext === 'RESTRICTED_LOW');
      assert.equal(receipt.ioMode, 'RAW_PIPE');
      assert.equal(receipt.rootJobMember, true);
      assert.equal(receipt.cleanupState, 'VERIFIED_EMPTY');
      assert.equal(receipt.activeProcessesFinal, 0);
      assert.equal(receipt.inputClosed, true);
      assert.equal(receipt.ioDrained, true);
      assert.equal(receipt.pseudoConsoleClosed, false);
      const child = JSON.parse(output.trim());
      assert.equal(child.user, user);
      assert.equal(child.integrity, securityContext === 'RESTRICTED_LOW' ? 'S-1-16-4096' : 'S-1-16-8192');
      assert.equal(child.tokenType, 1);
      assert.equal(child.policy & 1, 1);
      assert.equal(child.eof, true);
      assert.equal(child.base64, bytes.toString('base64'));
      assert.equal(child.cwd.toLowerCase(), base.cwd.toLowerCase());
      assert.deepEqual(child.args, launch.args);
      assert.equal(child.marker, base.env.OWNED_LITERAL);
      if (securityContext === 'RESTRICTED_LOW') {
        assert.equal(child.restrictingCount, 0);
        assert.ok(child.privileges.every(luid => luid === 23));
      }
      if (mode === 'mutate') {
        assert.equal(child.operations.length, 12);
        for (const operation of child.operations) {
          assert.equal(operation.success, operation.name.startsWith('worker.'), operation.name);
          assert.equal(operation.error, operation.name.startsWith('worker.') ? 0 : 5, operation.name);
        }
        assert.equal(child.raised, false);
        assert.ok(Number.isInteger(child.raiseError) && child.raiseError > 0, 'self-raise MUST be denied with a nonzero Win32 error');
        assert.equal(child.integrityAfter, 'S-1-16-4096');
        for (const name of ['overwrite', 'append', 'truncate', 'rename', 'delete']) assert.equal(fs.readFileSync(path.join(run, 'ledger', name), 'utf8'), 'unchanged');
        assert.equal(fs.existsSync(path.join(run, 'ledger/new')), false);
        assert.equal(fs.existsSync(path.join(run, 'ledger/moved')), false);
      }
    });
  }
  await t.test('PowerShell rejects malformed and exact schema violations with context-bound failures', () => {
    const { helperEnv: omitted, ...frame } = base;
    const missing = { ...frame }; delete missing.securityContext;
    const alias = { ...missing, SecurityContext: 'CURRENT_PROCESS' };
    for (const input of ['{', JSON.stringify(missing), JSON.stringify(alias), JSON.stringify({ ...frame, securityContext: 'restricted_low' }), JSON.stringify({ ...frame, securityContext: 'UNKNOWN' }), JSON.stringify({ ...frame, extra: 1 }), JSON.stringify({ ...frame, securityContext: 'RESTRICTED_LOW', ioMode: 'CONPTY' })]) {
      const result = spawnSync(helperPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath], { cwd: run, env: helperEnv, input: `${input}\n`, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stderr);
      const lines = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.equal(lines.length, 1);
      assert.equal(lines[0].type, 'exit');
      assert.equal(lines[0].receipt.rootPid, null);
      assert.equal(lines[0].receipt.reason, 'launch-failure');
      assert.equal(lines[0].receipt.childTokenVerified, false);
      if (input.includes('"securityContext":"RESTRICTED_LOW"')) assert.equal(lines[0].receipt.securityContext, 'RESTRICTED_LOW');
      if (input.includes('"securityContext":"CURRENT_PROCESS"')) assert.equal(lines[0].receipt.securityContext, 'CURRENT_PROCESS');
    }
  });
  await t.test('native parser independently rejects missing duplicate case alias extra and malformed fields', () => {
    const native = { executablePath, args: ['entry', run], cwd: base.cwd, env: base.env, cols: 80, rows: 24, timeoutMs: 5000, cleanupMs: 1000, ioMode: 'RAW_PIPE', securityContext: 'CURRENT_PROCESS' };
    const missing = { ...native }; delete missing.securityContext;
    const cases = ['{', JSON.stringify(missing), JSON.stringify({ ...missing, SecurityContext: 'CURRENT_PROCESS' }), JSON.stringify({ ...native, extra: true }), JSON.stringify(native).replace('"securityContext":', '"securityContext":"CURRENT_PROCESS","securityContext":'), ...[null, 1, 'UNKNOWN', 'restricted_low'].map(securityContext => JSON.stringify({ ...native, securityContext })), JSON.stringify({ ...native, securityContext: 'RESTRICTED_LOW', ioMode: 'CONPTY' })];
    const script = `$ErrorActionPreference='Stop'; Add-Type -Path ${quote(nativeSourcePath)}; $count=0; foreach($json in @(${cases.map(quote).join(',')})) { $rejected=$false; try { [void][Munder.WindowsOwnedPty.LaunchRequest]::Parse($json) } catch { $rejected=$true }; if(-not $rejected) { throw 'native schema accepted invalid input' }; $count++ }; [Console]::WriteLine($count)`;
    const result = spawnSync(helperPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: run, env: helperEnv, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Number(result.stdout.trim()), cases.length);
  });
});
