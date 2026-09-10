'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const identity = require('../tools/research-source-identity.cjs');
const { run } = require('../tools/research-env.cjs')(path.resolve(__dirname, '..'), 'source-test');

test('unchanged source passes, changed source cannot reuse prior evidence', () => {
  const file = path.join(run, 'source.cjs');
  fs.writeFileSync(file, 'version one');
  const expected = identity.snapshot(run, ['source.cjs']);
  assert.match(expected['source.cjs'], /^[0-9a-f]{64}$/);
  identity.verify(run, expected);
  fs.writeFileSync(file, 'version two');
  assert.throws(() => identity.verify(run, expected), /Research source changed/);
});

test('missing source fails rather than accepting incomplete identity', () => {
  assert.throws(() => identity.verify(run, { 'missing.cjs': '0'.repeat(64) }), { code: 'ENOENT' });
});

test('rejects absolute and parent-relative source list entries', () => {
  for (const file of ['../source.cjs', '..\\source.cjs', path.join(run, 'source.cjs')]) {
    assert.throws(() => identity.snapshot(run, [file]), /Repository-relative source required/);
  }
});
