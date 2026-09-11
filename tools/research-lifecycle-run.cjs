'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Static directory validation, not protection against concurrent path replacement.
// Reject redirected directories rather than broadening the approved research root.
module.exports = function lifecycleRun(root, argv) {
  const index = argv.indexOf('--fixture');
  assert.ok(index >= 0 && index === argv.lastIndexOf('--fixture') && index + 2 === argv.length,
    'Expected one final --fixture directory argument');
  const run = argv[index + 1];
  assert.ok(typeof run === 'string' && path.isAbsolute(run)
    && path.resolve(run) === path.normalize(run), 'Fully qualified run directory required');
  const base = path.join(path.resolve(root), '.tmp');
  const normalized = path.normalize(run);
  assert.equal(path.dirname(normalized), base, 'Run must be a direct child of repository .tmp');
  assert.match(path.basename(normalized), /^electron-lifecycle-[A-Za-z0-9]{6}$/,
    'Unexpected lifecycle run directory name');
  for (const directory of [base, normalized]) {
    const stat = fs.lstatSync(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Research directories must not be redirected');
  }
  const canonicalRoot = fs.realpathSync(root);
  const canonicalBase = fs.realpathSync(base);
  const canonicalRun = fs.realpathSync(normalized);
  assert.equal(canonicalBase, path.join(canonicalRoot, '.tmp'), 'Research base escaped repository');
  assert.equal(canonicalRun, path.join(canonicalBase, path.basename(normalized)), 'Research run was redirected');
  return canonicalRun;
};
