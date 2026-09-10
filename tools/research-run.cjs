'use strict';

// Run an already-authorized Node entrypoint with a synthetic environment.
// This wrapper supplies no authority and provides no OS sandbox. Callers must
// inspect the entrypoint's filesystem/process/network effects before use.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [entrypoint, ...args] = process.argv.slice(2);
if (!entrypoint || !fs.statSync(path.resolve(entrypoint)).isFile()) throw new Error('Node entrypoint required');
const { run, env } = require('./research-env.cjs')(root, 'command');
const log = path.join(run, 'command.log');
const fd = fs.openSync(log, 'wx');
console.log(JSON.stringify({ run, log, entrypoint, args, node: process.version }));
const result = spawnSync(process.execPath, [path.resolve(entrypoint), ...args], {
  cwd: root, env, stdio: ['ignore', fd, fd], timeout: 10 * 60 * 1000, windowsHide: true
});
fs.closeSync(fd);
console.log(fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-70).join('\n'));
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
