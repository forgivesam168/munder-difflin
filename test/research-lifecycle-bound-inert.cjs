'use strict';
// Fixed finite contract stand-in. Never imports Electron or runs lifecycle callbacks.
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const run = require('../tools/research-lifecycle-run.cjs')(root, process.argv);
assert.equal(process.cwd(), run);
const binding = require('../tools/research-lifecycle-binding.cjs');
const request = binding.read(root, run, 'inert');
binding.verify(root, request);
const fs = require('node:fs');
if (fs.existsSync(path.join(run, 'stop-probe'))) {
  assert.equal(fs.readFileSync(path.join(run, 'stop-probe'), 'utf8'), 'finite-root-stop');
  // Fixed finite test workload. Never reports normal completion after helper stop.
  setTimeout(() => {
    fs.writeFileSync(path.join(run, 'stop-natural-exit'), 'expired', { flag: 'wx' });
    process.exit(3);
  }, 20000);
  fs.writeFileSync(path.join(run, 'stop-root-ready.json'), JSON.stringify({
    pid: process.pid, requestSha256: binding.digest(request)
  }), { flag: 'wx' });
} else {
  require('../tools/research-lifecycle-result.cjs').writeBound(run, request, null);
}
