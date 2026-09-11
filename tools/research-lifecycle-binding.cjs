'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const identity = require('./research-source-identity.cjs');
// Fixed reviewed fixture inputs, not an automatically discovered dependency closure.
// projectRoots imports only Node builtins; TypeScript's used API is in its bundled JS.
const files = Object.freeze([
  'tools/research-lifecycle-binding.cjs', 'tools/research-lifecycle-result.cjs',
  'tools/research-lifecycle-parent.cjs', 'tools/research-lifecycle-supervisor.ps1',
  'tools/research-job-preflight.ps1', 'tools/research-job-run.ps1',
  'tools/research-lifecycle-environment.cjs', 'tools/research-job-environment.cjs',
  'tools/research-env.cjs', 'tools/research-source-identity.cjs',
  'tools/research-write-receipt.cjs', 'tools/research-lifecycle-invocation.cjs',
  'tools/research-lifecycle-run.cjs', 'tools/research-electron-lifecycle.cjs',
  'tools/research-lifecycle-callbacks.cjs', 'tools/research-lifecycle-content.cjs',
  'tools/research-lifecycle-ipc.cjs', 'tools/research-lifecycle-preload.cjs',
  'src/main/fs.ts', 'src/shared/imageTypes.ts', 'src/main/browserSecurity.ts', 'src/main/index.ts', 'src/main/projectRoots.ts', 'test/load-ts.cjs',
  'test/research-lifecycle-bound-inert.cjs', 'package-lock.json',
  'node_modules/typescript/package.json', 'node_modules/typescript/lib/typescript.js',
  'node_modules/electron/package.json'
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = request => hash(JSON.stringify(request));
const environmentDigest = env => hash(JSON.stringify(Object.entries(env).map(([k, v]) => [k.toUpperCase(), v]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))); 
function validate(request, run, kind) {
  assert.ok(['inert', 'electron-lifecycle'].includes(kind));
  assert.deepEqual(Object.keys(request).sort(), ['electron', 'electronSha256', 'environmentSha256', 'kind', 'run', 'sourceSha256', 'version']);
  assert.equal(request.version, 1); assert.equal(request.kind, kind); assert.equal(request.run, run);
  assert.match(request.electron, /^\d+\.\d+\.\d+$/);
  assert.match(request.electronSha256, /^[a-f0-9]{64}$/);
  assert.match(request.environmentSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(request.sourceSha256).sort(), [...files].sort());
  for (const value of Object.values(request.sourceSha256)) assert.match(value, /^[a-f0-9]{64}$/);
  return request;
}
function verify(root, request) {
  validate(request, request.run, request.kind);
  // Verify actual Node resolver target without importing or executing TypeScript.
  const typescript = path.join(root, 'node_modules/typescript/lib/typescript.js');
  assert.equal(require.resolve('typescript'), typescript);
  assert.equal(fs.realpathSync(typescript), typescript);
  identity.verify(root, request.sourceSha256);
  assert.equal(hash(fs.readFileSync(path.join(root, 'node_modules/electron/dist/electron.exe'))), request.electronSha256);
}
// Caller validates run containment and result absence first. wx preserves old input.
function create(root, run, kind, env) {
  const request = validate({ version: 1, run, kind, environmentSha256: environmentDigest(env),
    electron: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version,
    electronSha256: hash(fs.readFileSync(path.join(root, 'node_modules/electron/dist/electron.exe'))),
    sourceSha256: identity.snapshot(root, files) }, run, kind);
  verify(root, request);
  fs.writeFileSync(path.join(run, 'lifecycle-request.json'), JSON.stringify(request), { flag: 'wx' });
  return request;
}
function read(root, run, kind) {
  const file = path.join(run, 'lifecycle-request.json');
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
  const request = validate(JSON.parse(fs.readFileSync(file, 'utf8')), run, kind);
  verify(root, request);
  return request;
}
module.exports = { create, read, validate, verify, digest, environmentDigest };
