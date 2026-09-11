'use strict';
// Manual finite native failure probe; no user-provided child executable.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const identity = require('./research-source-identity.cjs');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(path.isAbsolute(executable) && path.basename(executable).toLowerCase() === 'pwsh.exe');
const { run, env } = require('./research-env.cjs')(root, 'job-preflight');
const sources = identity.snapshot(root, ['tools/research-job-preflight.ps1',
  'tools/research-job-run.ps1', 'tools/research-native-failure-test.cjs',
  'tools/research-env.cjs', 'tools/research-source-identity.cjs']);
const missing = path.join(run, 'missing-node.exe');
assert.equal(fs.existsSync(missing), false);
Object.assign(env, { POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
  PSModuleAnalysisCachePath: path.join(run, 'module-analysis-cache'),
  RESEARCH_NODE_EXECUTABLE: missing,
  RESEARCH_JOB_GUARD_SHA256: sources['tools/research-job-run.ps1'] });
const child = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File',
  path.join(root, 'tools/research-job-preflight.ps1'), '-Admission'],
{ cwd: run, env, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
fs.writeFileSync(path.join(run, 'failure.log'), (child.stdout || '') + (child.stderr || ''));
assert.equal(child.status, 1);
assert.equal(child.stderr, '');
const failure = JSON.parse(child.stdout);
assert.deepEqual(failure, { result: 'FAIL', failureStage: 'native-execution',
  cleanupResult: 'UNVERIFIED', nativeErrorCode: 2 });
identity.verify(root, sources);
fs.writeFileSync(path.join(run, 'failure-evidence.json'), JSON.stringify({ result: 'PASS',
  failure, sources, sourcesUnchanged: true }, null, 2));
console.log(JSON.stringify({ run, result: 'PASS' }));
