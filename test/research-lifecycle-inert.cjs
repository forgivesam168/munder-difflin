'use strict';
// Fixed finite Node stand-in for the lifecycle argv/environment/monitor path.
// No Electron, descendants, network, or ambient file reads. This is not lifecycle PASS.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const run = require('../tools/research-lifecycle-run.cjs')(root, process.argv);
assert.equal(process.cwd(), run);
fs.writeFileSync(path.join(run, 'inert-result.json'), JSON.stringify({
  version: 1, run, result: 'INERT_PASS', args: process.argv.slice(2),
  valueHashes: Object.fromEntries(Object.entries(process.env).map(([key, value]) =>
    [key.toUpperCase(), createHash('sha256').update(value).digest('hex')]))
}), { flag: 'wx' });
