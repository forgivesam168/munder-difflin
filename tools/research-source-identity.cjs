'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

// Callers supply a fixed repository-relative source allowlist. Disk snapshots
// establish evidence freshness, not authenticity or loaded-code attestation.
function snapshot(root, files) {
  return Object.fromEntries(files.map(file => {
    assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Repository-relative source required');
    return [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')];
  }));
}
function verify(root, expected) {
  assert.deepEqual(snapshot(root, Object.keys(expected)), expected, 'Research source changed during probe');
}
module.exports = { snapshot, verify };
