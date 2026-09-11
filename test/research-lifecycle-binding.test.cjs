'use strict';
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const binding = require('../tools/research-lifecycle-binding.cjs');
const result = require('../tools/research-lifecycle-result.cjs');
const root = path.resolve(__dirname, '..');
function fixture(kind = 'inert') {
  const { run, env } = require('../tools/research-lifecycle-environment.cjs')(root);
  result.prepare(run);
  return { run, env, request: binding.create(root, run, kind, env) };
}

test('run-bound request preserves fixed fixture, loader and compiler identities', () => {
  const { run, env, request } = fixture();
  assert.deepEqual(binding.read(root, run, 'inert'), request);
  for (const name of ['src/main/projectRoots.ts', 'src/main/index.ts', 'test/load-ts.cjs',
    'tools/research-lifecycle-callbacks.cjs', 'tools/research-lifecycle-content.cjs',
    'node_modules/typescript/lib/typescript.js']) assert.ok(request.sourceSha256[name]);
  const original = fs.readFileSync(path.join(run, 'lifecycle-request.json'));
  assert.throws(() => binding.create(root, run, 'inert', env));
  assert.deepEqual(fs.readFileSync(path.join(run, 'lifecycle-request.json')), original);
  assert.throws(() => binding.read(root, run, 'electron-lifecycle'));
  assert.throws(() => binding.verify(root, { ...request, sourceSha256: {
    ...request.sourceSha256, 'src/main/projectRoots.ts': '0'.repeat(64) } }));
});

test('bound inert result cannot cross run, scope, environment or identity boundaries', () => {
  const { run, env, request } = fixture();
  const written = result.writeBound(run, request, null, env);
  assert.equal(result.validateBound(written, request), written);
  assert.equal(written.result, 'INERT_PASS');
  for (const patch of [{ version: 1 }, { run: run + '-old' }, { result: 'PASS' },
    { kind: 'electron-lifecycle' }, { requestSha256: '0'.repeat(64) },
    { environmentSha256: '0'.repeat(64) }, { checks: ['native reload revokes'] }, { extra: true }]) {
    assert.throws(() => result.validateBound({ ...written, ...patch }, request));
  }
  assert.throws(() => result.writeBound(run, request, null, { ...env, FORCE_COLOR: '1' }));
  assert.throws(() => result.validateBound(written, { ...request, electron: '0.0.0' }));
  assert.throws(() => result.validateBound({ version: 1, run, result: 'PASS' }, request));
});

test('Electron schema requires exact runtime version and all five fixture assertions', () => {
  // Pure contract data only: no Electron execution or lifecycle evidence is claimed.
  const { run, env, request } = fixture('electron-lifecycle');
  assert.throws(() => result.writeBound(run, request, '0.0.0', env));
  const expected = { version: 2, run, kind: 'electron-lifecycle', result: 'PASS',
    electron: request.electron, requestSha256: binding.digest(request),
    environmentSha256: request.environmentSha256,
    checks: ['native reload revokes', 'native renderer gone revokes', 'native destroyed revokes', 'native IPC stale result rejected', 'native IPC stale read rejected'] };
  result.validateBound(expected, request);
  for (const patch of [{ electron: null }, { electron: '0.0.0' }, { checks: [] },
    { checks: ['native reload revokes'] },
    { checks: ['native reload revokes', 'native destroyed revokes'] },
    { checks: ['native reload revokes', 'native renderer gone revokes', 'native destroyed revokes'] },
    { checks: expected.checks.slice(0, -1) },
    { checks: [...expected.checks].reverse() }, { result: 'INERT_PASS' }]) {
    assert.throws(() => result.validateBound({ ...expected, ...patch }, request));
  }
  assert.ok(!fs.existsSync(path.join(run, 'lifecycle-result.json')));
});
