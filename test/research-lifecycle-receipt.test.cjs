'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const createReceipt = require('../tools/research-lifecycle-receipt.cjs');
const fs = require('node:fs');
const path = require('node:path');
const writeReceipt = require('../tools/research-write-receipt.cjs');

function diskFixture() {
  const { run } = require('../tools/research-env.cjs')(path.resolve(__dirname, '..'), 'receipt-test');
  const filename = path.join(run, 'receipt.json');
  writeReceipt(filename, { result: 'INCOMPLETE', revision: 1 });
  return { run, filename, read: () => JSON.parse(fs.readFileSync(filename, 'utf8')) };
}

test('replaces an existing receipt with a complete new snapshot', () => {
  const { run, filename, read } = diskFixture();
  writeReceipt(filename, { result: 'FAIL', revision: 2 });
  assert.deepEqual(read(), { result: 'FAIL', revision: 2 });
  assert.deepEqual(fs.readdirSync(run).filter(name => name.startsWith('receipt.json')), ['receipt.json']);
});

test('partial staged write fails without truncating the previous receipt', () => {
  const { filename, read } = diskFixture();
  assert.throws(() => writeReceipt(filename, { revision: 2 }, {
    writeFileSync(temp, json, options) {
      assert.equal(path.dirname(temp), path.dirname(filename));
      fs.writeFileSync(temp, json.slice(0, 4), options);
      throw new Error('injected disk write failure');
    },
    renameSync() { assert.fail('must not rename after failed write'); }
  }), /injected disk write failure/);
  assert.deepEqual(read(), { result: 'INCOMPLETE', revision: 1 });
});

test('replacement failure preserves prior snapshot and permits a later retry', () => {
  const { run, filename, read } = diskFixture();
  assert.throws(() => writeReceipt(filename, { revision: 2 }, {
    writeFileSync: fs.writeFileSync,
    renameSync() { throw new Error('injected replacement failure'); }
  }), /injected replacement failure/);
  assert.deepEqual(read(), { result: 'INCOMPLETE', revision: 1 });
  assert.equal(fs.readdirSync(run).filter(name => name.endsWith('.tmp')).length, 1);
  writeReceipt(filename, { result: 'FAIL', revision: 3 });
  assert.deepEqual(read(), { result: 'FAIL', revision: 3 });
});

test('serialization failure touches no receipt files', () => {
  const { run, filename, read } = diskFixture();
  const circular = {}; circular.self = circular;
  assert.throws(() => writeReceipt(filename, circular), TypeError);
  assert.throws(() => writeReceipt(filename, undefined), TypeError);
  assert.deepEqual(read(), { result: 'INCOMPLETE', revision: 1 });
  assert.equal(fs.readdirSync(run).filter(name => name.endsWith('.tmp')).length, 0);
});

function fixture() {
  const snapshots = [];
  const receipt = createReceipt({ run: 'synthetic-run', sha256: 'synthetic-hash' },
    snapshot => snapshots.push(snapshot), () => 'synthetic-time');
  return { receipt, snapshots, latest: () => snapshots.at(-1) };
}

test('persists initial and running identity before any close event', () => {
  const { receipt, snapshots, latest } = fixture();
  assert.equal(latest().phase, 'prepared');
  assert.equal(latest().result, 'INCOMPLETE');
  receipt.spawned(123);
  assert.equal(latest().pid, 123);
  assert.equal(latest().phase, 'running');
  assert.equal(snapshots[0].pid, undefined);
  assert.equal(latest().sha256, 'synthetic-hash');
});

test('normal root exit does not establish descendant exit or PASS', () => {
  const { receipt, latest } = fixture();
  receipt.spawned(123);
  assert.equal(receipt.closed(0, null), 1);
  assert.equal(latest().code, 0);
  assert.equal(latest().treeExit, 'unverified');
  assert.equal(latest().result, 'FAIL');
  assert.equal(latest().cleanup.status, 'not-attempted');
});

test('launch error is durable before close without persisting arbitrary diagnostics', () => {
  const { receipt, latest } = fixture();
  receipt.launchError(new Error('do-not-persist-payload'));
  assert.equal(latest().launchError, true);
  assert.equal(latest().result, 'FAIL');
  assert.ok(!JSON.stringify(latest()).includes('do-not-persist-payload'));
  assert.equal(receipt.closed(-1, null), 1);
});

for (const failed of [false, true]) {
  test(`cleanup ${failed ? 'failure' : 'success'} remains distinct from tree exit`, () => {
    const { receipt, snapshots, latest } = fixture();
    receipt.spawned(123);
    receipt.timeout();
    assert.equal(latest().timedOut, true);
    receipt.cleanupStarted();
    assert.equal(latest().cleanup.status, 'attempting');
    receipt.cleanupFinished(failed ? new Error('do-not-persist-payload') : null);
    assert.equal(latest().cleanup.status, failed ? 'command-failed' : 'command-succeeded');
    assert.equal(latest().treeExit, 'unverified');
    assert.equal(receipt.closed(0, null), 1);
    assert.equal(latest().result, 'FAIL');
    assert.equal(snapshots[3].cleanup.status, 'attempting');
    assert.ok(!JSON.stringify(latest()).includes('do-not-persist-payload'));
  });
}

test('late cleanup callback preserves closed result and updates cleanup evidence', () => {
  const { receipt, latest } = fixture();
  receipt.timeout();
  receipt.cleanupStarted();
  receipt.closed(null, 'SIGTERM');
  receipt.cleanupFinished(null);
  assert.equal(latest().phase, 'closed');
  assert.equal(latest().signal, 'SIGTERM');
  assert.equal(latest().cleanup.status, 'command-succeeded');
  assert.equal(latest().result, 'FAIL');
});

test('receipt persistence failure propagates rather than claiming success', () => {
  assert.throws(() => createReceipt({}, () => { throw new Error('disk failure'); }), /disk failure/);
});

test('event write failures cannot interrupt cleanup and remain latched after recovery', () => {
  let fail = false;
  const snapshots = [];
  const receipt = createReceipt({}, snapshot => {
    if (fail) throw new Error('private-disk-diagnostic');
    snapshots.push(snapshot);
  });
  fail = true;
  let cleanupCalled = false;
  assert.doesNotThrow(() => {
    receipt.spawned(123);
    receipt.launchError();
    receipt.timeout();
    receipt.cleanupStarted();
    cleanupCalled = true;
    receipt.cleanupFinished(null);
    assert.equal(receipt.closed(0, null), 1);
  });
  assert.equal(cleanupCalled, true);
  assert.equal(receipt.persistenceFailed, true);
  assert.equal(snapshots.length, 1);
  fail = false;
  receipt.cleanupFinished(null);
  assert.equal(snapshots.at(-1).persistenceFailed, true);
  assert.equal(snapshots.at(-1).result, 'FAIL');
  assert.equal(snapshots.at(-1).treeExit, 'unverified');
  assert.ok(!JSON.stringify(snapshots).includes('private-disk-diagnostic'));
});
