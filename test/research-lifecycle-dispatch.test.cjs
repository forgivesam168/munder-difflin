'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const identity = require('../tools/research-source-identity.cjs');
const root = path.resolve(__dirname, '..');
const powershell = 'C:/Program Files/PowerShell/7/pwsh.exe';

test('real PowerShell selects fixed branches without admitting a process; default helper refuses',
  { skip: process.platform !== 'win32' || !fs.existsSync(powershell) }, () => {
    const { run, env } = require('../tools/research-lifecycle-environment.cjs')(root);
    const sources = identity.snapshot(root, ['tools/research-lifecycle-supervisor.ps1',
      'tools/research-job-run.ps1', 'test/research-lifecycle-dispatch.ps1',
      'test/research-lifecycle-dispatch.test.cjs']);
    const invoke = (file, args = []) => spawnSync(powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, file), ...args],
      { cwd: run, env, input: '', encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 65536 });
    const selected = invoke('test/research-lifecycle-dispatch.ps1', ['-NodeExecutable', process.execPath]);
    assert.equal(selected.status, 0, selected.stderr);
    assert.deepEqual(JSON.parse(selected.stdout), { result: 'PASS', checks: 5, scope: 'selection-only' });
    const denied = invoke('tools/research-lifecycle-supervisor.ps1');
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Running Electron supervisor disabled/);
    assert.equal(denied.stdout, '');
    identity.verify(root, sources);
    require('../tools/research-write-receipt.cjs')(path.join(run, 'dispatch-evidence.json'),
      { result: 'PASS', scope: 'selection-only', sources, checks: 5, defaultGateDenied: true });
    console.log(JSON.stringify({ run, scope: 'selection-only' }));
  });
