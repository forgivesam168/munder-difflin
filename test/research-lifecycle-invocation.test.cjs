'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const invocation = require('../tools/research-lifecycle-invocation.cjs');
const root = path.resolve(__dirname, '..');
const { run: workspace } = require('../tools/research-env.cjs')(root, 'invocation-test');
function fixture() {
  const repo = fs.mkdtempSync(path.join(workspace, 'repo-'));
  const dist = path.join(repo, 'node_modules', 'electron', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(path.join(repo, 'tools'));
  fs.mkdirSync(path.join(repo, '.tmp'));
  const run = fs.mkdtempSync(path.join(repo, '.tmp', 'electron-lifecycle-'));
  const executable = path.join(dist, 'electron.exe');
  const script = path.join(repo, 'tools', 'research-electron-lifecycle.cjs');
  fs.writeFileSync(executable, 'inert fixture'); fs.writeFileSync(script, 'inert fixture');
  return { repo, run, executable, script };
}
test('builds only fixed executable and argv without executing synthetic files', () => {
  const { repo, run, executable, script } = fixture();
  assert.deepEqual(invocation(repo, run), { executable, args: [script, '--fixture', run], cwd: run });
  assert.throws(() => invocation(repo, workspace));
  assert.throws(() => invocation('.', run));
});
test('missing fixed file fails even if another executable exists in repository', () => {
  const { repo, run, executable } = fixture();
  fs.renameSync(executable, path.join(repo, 'other.exe'));
  assert.throws(() => invocation(repo, run));
});
test('rejects redirected executable and script directories', () => {
  for (const relative of ['tools', 'node_modules', 'node_modules/electron', 'node_modules/electron/dist']) {
    const { repo, run } = fixture();
    const directory = path.join(repo, relative), target = directory + '-saved';
    fs.renameSync(directory, target); fs.symlinkSync(target, directory, 'junction');
    assert.throws(() => invocation(repo, run), /Redirected/);
  }
});
test('rejects directory in place of either fixed file', () => {
  for (const key of ['script', 'executable']) {
    const data = fixture();
    fs.renameSync(data[key], data[key] + '-saved'); fs.mkdirSync(data[key]);
    assert.throws(() => invocation(data.repo, data.run), /Invalid lifecycle file/);
  }
});
test('disabled entry delegates to fixed helper invocation', () => {
  const source = fs.readFileSync(path.join(root, 'tools/research-electron-lifecycle.cjs'), 'utf8');
  assert.match(source, /const NATIVE_LAUNCH_ENABLED = false/);
  assert.match(source, /research-lifecycle-parent\.cjs/);
  const parent = fs.readFileSync(path.join(root, 'tools/research-lifecycle-parent.cjs'), 'utf8');
  assert.match(parent, /research-lifecycle-invocation\.cjs/);
  assert.match(parent, /tools\/research-lifecycle-supervisor\.ps1/);
  assert.doesNotMatch(parent, /taskkill\.exe/);
});
