'use strict';
// Manual Windows integration only; not included in the ordinary *.test.cjs suite.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const supervise = require('../tools/research-lifecycle-parent.cjs');
const write = require('../tools/research-write-receipt.cjs');
const identity = require('../tools/research-source-identity.cjs');
const root = path.resolve(__dirname, '..');
const powershell = process.argv[2];
const finalOnly = process.argv[3] === '--final-storage';
assert.ok(process.argv.length === 3 || (process.argv.length === 4 && finalOnly));
const sourceSha256 = identity.snapshot(root, ['test/research-lifecycle-parent.integration.cjs',
  'tools/research-lifecycle-parent.cjs', 'tools/research-lifecycle-supervisor.ps1']);
const { run: evidenceRun } = require('../tools/research-env.cjs')(root, 'parent-integration');
const evidence = { result: 'INCOMPLETE', sourceSha256, cases: [] };
const evidenceFile = path.join(evidenceRun, 'evidence.json');
write(evidenceFile, evidence);

(async () => {
  await assert.rejects(() => supervise({ powershell }), /disabled/);
  for (const name of (finalOnly ? ['final-storage'] : ['normal', 'missing', 'malformed', 'wrong-run', 'wrong-identity', 'wrong-scope', 'storage'])) {
    let storageFailed = false;
    const test = {};
    if (name === 'storage' || name === 'final-storage') test.persist = (file, snapshot) => {
      if (snapshot.phase === (name === 'storage' ? 'supervising' : 'closed') && !storageFailed) {
        storageFailed = true;
        const directory = path.join(snapshot.run, 'storage-fault');
        fs.mkdirSync(directory);
        // Real atomic writer rename-to-directory failure, not a thrown mock error.
        write(directory, snapshot);
      } else write(file, snapshot);
    };
    if (['missing', 'malformed', 'wrong-run', 'wrong-identity', 'wrong-scope'].includes(name)) test.afterClose = run => {
      const file = path.join(run, 'lifecycle-result.json');
      const original = fs.readFileSync(file, 'utf8');
      fs.renameSync(file, path.join(run, 'lifecycle-result-preserved.json'));
      if (name === 'malformed') fs.writeFileSync(file, '{', { flag: 'wx' });
      if (name === 'wrong-identity') fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), requestSha256: '0'.repeat(64) }), { flag: 'wx' });
      if (name === 'wrong-scope') fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), kind: 'electron-lifecycle', result: 'PASS' }), { flag: 'wx' });
      if (name === 'wrong-run') fs.writeFileSync(file,
        JSON.stringify({ ...JSON.parse(original), run: `${run}-wrong` }), { flag: 'wx' });
    };
    const result = await supervise({ powershell, inert: true, test });
    const saved = JSON.parse(fs.readFileSync(path.join(result.run, 'supervisor-receipt.json'), 'utf8'));
    if (name === 'final-storage') {
      assert.ok(storageFailed); assert.equal(result.exitCode, 1);
      assert.equal(result.receipt.persistenceFailed, true);
      assert.equal(result.receipt.result, 'FAIL');
      assert.equal(result.receipt.cleanup, 'VERIFIED_EMPTY');
      assert.equal(saved.result, 'INCOMPLETE');
      evidence.cases.push({ name, run: result.run, result: 'FAIL', durableResult: saved.result,
        cleanup: result.receipt.cleanup, observedReceipt: result.receipt });
      continue;
    }
    assert.deepEqual(saved, result.receipt);
    assert.equal(result.exitCode, name === 'normal' ? 0 : 1);
    assert.equal(saved.result, name === 'normal' ? 'INERT_PASS' : 'FAIL');
    assert.equal(saved.cleanup, 'VERIFIED_EMPTY');
    assert.equal(saved.native.Member, true); assert.equal(saved.native.ChildExit, 0);
    assert.equal(saved.native.ActiveProcesses, 0);
    if (name === 'storage') { assert.ok(storageFailed); assert.equal(saved.persistenceFailed, true); }
    evidence.cases.push({ name, run: result.run, result: saved.result, cleanup: saved.cleanup });
    write(evidenceFile, evidence);
  }
  let initialRun;
  await assert.rejects(() => supervise({ powershell, inert: true, test: {
    persist(_file, snapshot) {
      initialRun = snapshot.run;
      const directory = path.join(initialRun, 'initial-storage-fault');
      fs.mkdirSync(directory); write(directory, snapshot);
    }
  } }));
  assert.ok(initialRun && !fs.existsSync(path.join(initialRun, 'lifecycle-result.json')));
  evidence.cases.push({ name: 'initial-storage', run: initialRun, result: 'REJECTED_BEFORE_SPAWN' });
  identity.verify(root, sourceSha256);
  evidence.result = 'PASS'; write(evidenceFile, evidence);
  console.log(JSON.stringify({ evidenceRun, ...evidence }));
})().catch(() => {
  evidence.result = 'FAIL'; write(evidenceFile, evidence);
  console.error(JSON.stringify({ evidenceRun, ...evidence })); process.exitCode = 1;
});
