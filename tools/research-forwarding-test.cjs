'use strict';
// Explicit manual native integration test, not part of default test discovery.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const identity = require('./research-source-identity.cjs');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(path.isAbsolute(executable) && path.basename(executable).toLowerCase() === 'pwsh.exe');
for (const crash of [false, true]) {
  const { run, env } = require('./research-env.cjs')(root, 'job-preflight');
  const sources = identity.snapshot(root, ['tools/research-job-run.ps1',
    'tools/research-job-preflight.ps1', 'test/research-job-forwarding.ps1',
    'tools/research-forwarding-test.cjs', 'tools/research-env.cjs', 'tools/research-source-identity.cjs']);
  Object.assign(env, { POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
    PSModuleAnalysisCachePath: path.join(run, 'module-analysis-cache'),
    RESEARCH_NODE_EXECUTABLE: process.execPath,
    RESEARCH_JOB_GUARD_SHA256: sources['tools/research-job-run.ps1'] });
  if (crash) env.RESEARCH_CRASH_TOKEN = randomUUID();
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File',
    path.join(root, 'test/research-job-forwarding.ps1'), '-Probe',
    path.join(root, 'tools/research-job-preflight.ps1'), ...(crash ? ['-Crash'] : [])],
  { cwd: run, env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 });
  fs.writeFileSync(path.join(run, 'forwarding.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0);
  assert.ok(!result.error);
  const probe = JSON.parse(result.stdout);
  assert.equal(probe.result, 'PASS');
  if (crash) {
    assert.equal(probe.helperExit, -536805375);
    assert.equal(probe.processIdentityVerified, true);
    assert.equal(probe.processExitObserved, true);
  } else {
    assert.equal(probe.admissionEvidence.ChildExit, 0);
    assert.equal(probe.admissionEvidence.ActiveProcesses, 0);
  }
  identity.verify(root, sources);
  fs.writeFileSync(path.join(run, 'forwarding-evidence.json'), JSON.stringify({
    result: 'PASS', crash, sources, probe, sourcesUnchanged: true }, null, 2));
  console.log(JSON.stringify({ run, crash, result: 'PASS' }));
}
