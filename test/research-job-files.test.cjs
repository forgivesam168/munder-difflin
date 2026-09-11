'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { validateFiles } = require('../tools/research-job-environment.cjs');
const create = () => require('../tools/research-env.cjs')(root, 'job-preflight').run;

test('explicit modes accept only their fixed run prefix', () => {
  const probe = create();
  const lifecycle = require('../tools/research-env.cjs')(root, 'electron-lifecycle').run;
  validateFiles(root, probe, 'job-preflight');
  validateFiles(root, lifecycle, 'electron-lifecycle');
  assert.throws(() => validateFiles(root, lifecycle));
  assert.throws(() => validateFiles(root, lifecycle, 'job-preflight'));
  assert.throws(() => validateFiles(root, probe, 'electron-lifecycle'));
  for (const mode of ['', 'other', 'JOB-PREFLIGHT', null]) {
    assert.throws(() => validateFiles(root, probe, mode));
  }
});

test('accepts synthetic directories, empty configs and absent or regular module cache', () => {
  const run = create(); validateFiles(root, run);
  fs.writeFileSync(path.join(run, 'module-analysis-cache'), 'synthetic cache');
  validateFiles(root, run);
});
test('rejects each nonempty or missing config and directory module cache', () => {
  for (const name of ['empty-config', 'empty-npm-global']) {
    const run = create();
    fs.writeFileSync(path.join(run, name), 'synthetic setting');
    assert.throws(() => validateFiles(root, run));
    fs.renameSync(path.join(run, name), path.join(run, name + '-saved'));
    assert.throws(() => validateFiles(root, run));
  }
  const run = create(); fs.mkdirSync(path.join(run, 'module-analysis-cache'));
  assert.throws(() => validateFiles(root, run));
});
test('rejects each redirected environment directory using real junctions', () => {
  for (const name of ['home', 'temp', 'appdata', 'localappdata', 'config', 'cache',
    'data', 'hooks', 'templates', 'npm-cache', 'electron-cache']) {
    const run = create();
    const original = path.join(run, name), target = path.join(run, name + '-saved');
    fs.renameSync(original, target);
    fs.symlinkSync(target, original, 'junction');
    assert.throws(() => validateFiles(root, run));
  }
});
test('rejects run junction, foreign run and relative run', () => {
  const run = create(); const target = run + '-saved';
  fs.renameSync(run, target); fs.symlinkSync(target, run, 'junction');
  assert.throws(() => validateFiles(root, run));
  assert.throws(() => validateFiles(root, root));
  assert.throws(() => validateFiles(root, '.tmp/job-preflight-ABC123'));
});
