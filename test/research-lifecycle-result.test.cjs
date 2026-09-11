'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const result = require('../tools/research-lifecycle-result.cjs');
const { run } = require('../tools/research-env.cjs')(path.resolve(__dirname, '..'), 'lifecycle-result');

test('prelaunch rejects existing evidence without changing it', () => {
  const fresh = fs.mkdtempSync(path.join(run, 'fresh-'));
  result.prepare(fresh);
  const file = path.join(fresh, 'lifecycle-result.json');
  for (const content of ['{', JSON.stringify({ result: 'PASS' })]) {
    fs.writeFileSync(file, content);
    assert.throws(() => result.prepare(fresh), /already exists/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  const directoryRun = fs.mkdtempSync(path.join(run, 'directory-'));
  fs.mkdirSync(path.join(directoryRun, 'lifecycle-result.json'));
  assert.throws(() => result.prepare(directoryRun), /already exists/);
  assert.throws(() => result.prepare(path.join(run, 'absent')));
});

test('supervised parent checks result absence before receipt or helper effects', () => {
  const source = fs.readFileSync(path.join(__dirname, '../tools/research-lifecycle-parent.cjs'), 'utf8');
  const preparation = source.indexOf("require('./research-lifecycle-result.cjs').prepare(run)");
  const gate = source.indexOf("assert.ok(inert || NATIVE_LAUNCH_ENABLED");
  assert.ok(gate >= 0 && preparation > gate);
  assert.ok(preparation < source.indexOf('persist();'));
  assert.ok(preparation < source.indexOf('child = spawn('));
});

test('writes and reads a complete result bound to its run', () => {
  const written = result.write(run, '43.6.0');
  assert.deepEqual(result.read(run), written);
  assert.deepEqual(fs.readdirSync(run).filter(name => name.startsWith('lifecycle-result')), ['lifecycle-result.json']);
  assert.throws(() => result.validate(written, run + '-other'));
});
test('rejects incomplete, altered, unknown and failing results', () => {
  const valid = result.read(run);
  for (const patch of [{ version: 2 }, { result: 'FAIL' }, { platform: 'linux' },
    { electron: '' }, { checks: [] }, { checks: ['native reload revokes'] },
    { checks: [...valid.checks].reverse() }, { extra: true }]) {
    assert.throws(() => result.validate({ ...valid, ...patch }, run));
  }
  for (const key of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[key];
    assert.throws(() => result.validate(missing, run));
  }
  for (const invalid of [null, [], 'PASS']) assert.throws(() => result.validate(invalid, run));
});
test('missing or malformed disk result cannot count as success', () => {
  assert.throws(() => result.read(path.join(run, 'missing')));
  fs.writeFileSync(path.join(run, 'lifecycle-result.json'), '{');
  assert.throws(() => result.read(run), SyntaxError);
});
