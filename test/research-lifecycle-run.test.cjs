'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validate = require('../tools/research-lifecycle-run.cjs');
const { run: workspace } = require('../tools/research-env.cjs')(path.resolve(__dirname, '..'), 'run-boundary-test');

function fixture() {
  const root = fs.mkdtempSync(path.join(workspace, 'repo-'));
  const base = path.join(root, '.tmp');
  fs.mkdirSync(base);
  const run = fs.mkdtempSync(path.join(base, 'electron-lifecycle-'));
  return { root, base, run, argv: ['electron', 'fixture.cjs', '--fixture', run] };
}

test('accepts a real direct lifecycle directory and returns canonical path', () => {
  const { root, run, argv } = fixture();
  assert.equal(validate(root, argv), fs.realpathSync(run));
});

test('rejects missing, duplicate, trailing and relative fixture arguments', () => {
  const { root, run } = fixture();
  for (const argv of [[], ['--fixture'], ['--fixture', run, '--fixture', run],
    ['--fixture', run, 'extra'], ['--fixture', '.tmp/electron-lifecycle-abcdef']]) {
    assert.throws(() => validate(root, argv));
  }
});

test('rejects wrong run name, nested run, other root and file targets', () => {
  const { root, base, run } = fixture();
  for (const value of [base, path.join(base, 'other-abcdef'), path.join(run, 'electron-lifecycle-abcdef'), workspace]) {
    assert.throws(() => validate(root, ['--fixture', value]));
  }
  const file = path.join(base, 'electron-lifecycle-abcdef');
  fs.writeFileSync(file, 'synthetic');
  assert.throws(() => validate(root, ['--fixture', file]), /must not be redirected/);
});

test('rejects redirected .tmp even when run is inside its canonical target', () => {
  const root = fs.mkdtempSync(path.join(workspace, 'redirected-'));
  const target = fs.mkdtempSync(path.join(workspace, 'target-'));
  const run = fs.mkdtempSync(path.join(target, 'electron-lifecycle-'));
  fs.symlinkSync(target, path.join(root, '.tmp'), 'junction');
  assert.throws(() => validate(root, ['--fixture', path.join(root, '.tmp', path.basename(run))]), /must not be redirected/);
});

test('rejects a run junction even when target is inside repository', () => {
  const { root, base } = fixture();
  const target = path.join(root, 'target');
  fs.mkdirSync(target);
  const run = path.join(base, 'electron-lifecycle-abcdef');
  fs.symlinkSync(target, run, 'junction');
  assert.throws(() => validate(root, ['--fixture', run]), /must not be redirected/);
});
