'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeManifest } = require('../tools/patch-tunnelmole-metadata.cjs');
const { useWindowsPrebuilds } = require('../build/native-dependencies.cjs');

test('only verified native Windows x64 packaging skips the target rebuild', () => {
  const win = { platform: 'win32', arch: 'x64' };
  assert.equal(useWindowsPrebuilds(win, win, false), true);
  assert.equal(useWindowsPrebuilds(win, win, true), false);
  for (const target of [
    { platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' },
    { platform: 'linux', arch: 'x64' }, { platform: 'win32', arch: 'arm64' }
  ]) {
    assert.equal(useWindowsPrebuilds(target, win, false), false);
    assert.equal(useWindowsPrebuilds(win, target, false), false);
  }
});

test('packaging normalization removes only the redundant self edge and is repeatable', () => {
  const manifest = { name: 'tunnelmole', version: '2.4.0', type: 'module',
    dependencies: { tunnelmole: '^2.1.6', ws: '^7.2.5', toml: '^3.0.0' } };
  const expected = structuredClone(manifest);
  delete expected.dependencies.tunnelmole;
  assert.equal(normalizeManifest(manifest), true);
  assert.deepEqual(manifest, expected);
  assert.equal(normalizeManifest(manifest), false);
});

test('metadata drift requires review before any mutation', () => {
  for (const manifest of [
    { name: 'tunnelmole', version: '2.4.1', dependencies: { tunnelmole: '^2.1.6' } },
    { name: 'tunnelmole', version: '2.4.0', dependencies: { tunnelmole: '^2.4.0' } }
  ]) {
    const original = structuredClone(manifest);
    assert.throws(() => normalizeManifest(manifest), /review/i);
    assert.deepEqual(manifest, original);
  }
});
