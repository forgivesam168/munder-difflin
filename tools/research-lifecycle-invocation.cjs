'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Fixed Windows fixture only. Static checks assume trusted ancestors and no
// concurrent replacement; they do not authenticate binaries or loaded code.
module.exports = function lifecycleInvocation(root, run) {
  assert.ok(path.isAbsolute(root) && path.resolve(root) === root, 'Canonical repository path required');
  const script = path.join(root, 'tools', 'research-electron-lifecycle.cjs');
  const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  for (const directory of [root, path.join(root, 'tools'), path.join(root, 'node_modules'),
    path.join(root, 'node_modules', 'electron'), path.dirname(executable)]) {
    const stat = fs.lstatSync(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink()
      && fs.realpathSync(directory) === directory, 'Redirected lifecycle directory');
  }
  for (const file of [script, executable]) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()
      && fs.realpathSync(file) === file, 'Invalid lifecycle file');
  }
  const canonicalRun = require('./research-lifecycle-run.cjs')(root, ['--fixture', run]);
  return { executable, args: [script, '--fixture', canonicalRun], cwd: canonicalRun };
};
