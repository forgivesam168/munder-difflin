'use strict';
// Explicit Windows-only finite subprocess test; no Electron or arbitrary command input.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const identity = require('./research-source-identity.cjs');
assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 3);
const executable = process.argv[2];
assert.ok(path.isAbsolute(executable) && path.basename(executable).toLowerCase() === 'pwsh.exe');
const root = path.resolve(__dirname, '..');
const { run, env } = require('./research-env.cjs')(root, 'job-preflight');
Object.assign(env, { POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
  PSModuleAnalysisCachePath: path.join(run, 'module-analysis-cache') });
const sources = identity.snapshot(root, ['tools/research-job-preflight.ps1',
  'test/research-job-argv.ps1', 'tools/research-argv-test.cjs', 'tools/research-env.cjs',
  'tools/research-source-identity.cjs']);
const values = ['', 'plain', 'two words', 'tab\there', '"quoted"', 'tail\\',
  'space tail \\', 'slash\\"quote', '\\\\"', '中文 # & % !', 'line\nbreak'];
const program = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const input = path.join(run, 'cases.json');
fs.writeFileSync(input, JSON.stringify([process.execPath, '-e', program, '--', ...values]));
const encoded = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File',
  path.join(root, 'test/research-job-argv.ps1'), '-Cases', input],
{ cwd: run, env, windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
fs.writeFileSync(path.join(run, 'encoder.log'), (encoded.stdout || '') + (encoded.stderr || ''));
assert.equal(encoded.status, 0);
const argumentsEncoded = JSON.parse(encoded.stdout);
const child = spawnSync(process.execPath, argumentsEncoded.slice(1), {
  argv0: argumentsEncoded[0],
  cwd: run, env, windowsHide: true, windowsVerbatimArguments: true,
  encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024
});
fs.writeFileSync(path.join(run, 'child.log'), (child.stdout || '') + (child.stderr || ''));
assert.equal(child.status, 0);
assert.deepEqual(JSON.parse(child.stdout), values);
identity.verify(root, sources);
fs.writeFileSync(path.join(run, 'argv-evidence.json'), JSON.stringify({
  result: 'PASS', cases: values.length, sources, sourcesUnchanged: true }, null, 2));
console.log(JSON.stringify({ run, result: 'PASS', cases: values.length }));
