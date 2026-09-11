'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const writeReceipt = require('./research-write-receipt.cjs');
const checks = ['native reload revokes', 'native destroyed revokes'];
const boundChecks = ['native reload revokes', 'native renderer gone revokes', 'native destroyed revokes', 'native IPC stale result rejected', 'native IPC stale read rejected'];

function validate(result, run) {
  assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'Invalid lifecycle result');
  assert.deepEqual(Object.keys(result).sort(), ['checks', 'electron', 'platform', 'result', 'run', 'version']);
  assert.equal(result.version, 1);
  assert.equal(result.run, run);
  assert.equal(result.result, 'PASS');
  assert.equal(result.platform, 'win32');
  assert.ok(typeof result.electron === 'string' && /^\d+\.\d+\.\d+$/.test(result.electron));
  assert.deepEqual(result.checks, checks);
  return result;
}

// Trusted callers validate run containment separately. A result does not prove
// process exit, Job accounting, executable identity or authenticity.
function write(run, electron) {
  const result = validate({ version: 1, run, result: 'PASS', platform: process.platform,
    electron, checks: [...checks] }, run);
  writeReceipt(path.join(run, 'lifecycle-result.json'), result);
  return result;
}
function read(run) {
  return validate(JSON.parse(fs.readFileSync(path.join(run, 'lifecycle-result.json'), 'utf8')), run);
}
// Call before launch, after run validation. Never erase previous evidence.
// lstat also rejects dangling links. This is a static precondition, not protection
// against a concurrent writer or proof that a later result came from the child.
function prepare(run) {
  try { fs.lstatSync(path.join(run, 'lifecycle-result.json')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      assert.ok(fs.statSync(run).isDirectory(), 'Lifecycle run directory required');
      return;
    }
    throw error;
  }
  throw new Error('Lifecycle result already exists');
}
// Version 1 above is historical fixture output. Supervised acceptance uses only v2.
function validateBound(result, request) {
  const binding = require('./research-lifecycle-binding.cjs');
  binding.validate(request, request.run, request.kind);
  assert.deepEqual(result, { version: 2, run: request.run, kind: request.kind,
    requestSha256: binding.digest(request), environmentSha256: request.environmentSha256,
    result: request.kind === 'inert' ? 'INERT_PASS' : 'PASS',
    electron: request.kind === 'inert' ? null : request.electron,
    checks: request.kind === 'inert' ? [] : [...boundChecks] });
  return result;
}
function writeBound(run, request, electron, env = process.env) {
  assert.equal(run, request.run);
  const result = validateBound({ version: 2, run, kind: request.kind,
    requestSha256: require('./research-lifecycle-binding.cjs').digest(request),
    environmentSha256: require('./research-lifecycle-binding.cjs').environmentDigest(env),
    result: request.kind === 'inert' ? 'INERT_PASS' : 'PASS', electron,
    checks: request.kind === 'inert' ? [] : [...boundChecks] }, request);
  writeReceipt(path.join(run, 'lifecycle-result.json'), result);
  return result;
}
module.exports = { validate, write, read, prepare, validateBound, writeBound };
