'use strict';

// Provider-free integration worker. No provider SDK, credentials, or network.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

if (process.argv[2] === '--leaf') {
  process.stdout.write('LEAF_READY\n');
  setTimeout(() => process.exit(0), 15000);
} else {
  const [requestPath, mode] = process.argv.slice(2);
  const modes = new Set(['pass', 'missing', 'malformed', 'stale', 'timeout', 'descendant', 'io', 'fail']);
  if (process.argv.length !== 4 || !modes.has(mode) || !path.isAbsolute(requestPath)) process.exit(64);
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  const { contract } = request;
  if (!contract || process.cwd() !== contract.rootPolicy.workDir) process.exit(65);
  const identity = Object.fromEntries(['candidateId', 'taskId', 'runId', 'workerId', 'taskDigest', 'sourceCheckpoint'].map(key => [key, contract[key]]));
  const unexpected = Object.keys(process.env).filter(key => !['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'CODEX_HOME', 'TERM', 'COLORTERM', 'FORCE_COLOR'].includes(key));
  if (unexpected.length) { process.stderr.write(`UNEXPECTED_ENV:${unexpected.join(',')}\n`); process.exit(66); }
  function publish() {
    if (mode === 'missing') return;
    if (mode === 'malformed') { fs.writeFileSync(contract.rootPolicy.resultPath, '{', { flag: 'wx' }); return; }
    const bytes = Buffer.from('bounded-worker-artifact\n');
    fs.writeFileSync(path.join(contract.rootPolicy.artifactDir, 'output.txt'), bytes, { flag: 'wx' });
    const result = { schemaVersion: 1, ...identity, result: mode === 'fail' ? 'FAIL' : 'PASS', checks: { work: mode === 'fail' ? 'FAIL' : 'PASS' }, artifacts: [{ path: 'output.txt', sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] };
    if (mode === 'stale') result.runId = 'stale-run';
    const pending = `${contract.rootPolicy.resultPath}.pending`;
    const fd = fs.openSync(pending, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(result)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(pending, contract.rootPolicy.resultPath);
  }
  process.stdout.write('WORKER_READY\n');
  if (mode === 'timeout') {
    setInterval(() => {}, 1000);
  } else if (mode === 'descendant') {
    const child = spawn(process.execPath, [__filename, '--leaf'], { env: process.env, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const deadline = setTimeout(() => process.exit(67), 3000);
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 128) process.exit(68);
      if (output !== 'LEAF_READY\n') return;
      clearTimeout(deadline);
      publish();
      process.stdout.write('LEAF_READY\nROOT_EXIT\n', () => process.exit(0));
    });
    child.once('error', () => process.exit(69));
    child.unref();
  } else if (mode === 'io') {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      input += chunk;
      if (input.length > 128) process.exit(70);
      if (!input.includes('\n')) return;
      if (input.replace(/\r/g, '') !== 'bounded-input\n') process.exit(71);
      publish();
      process.stdout.write('ECHO:bounded-input\n', () => process.exit(0));
    });
  } else {
    publish();
    process.stdout.write('WORKER_FINISHED\n', () => process.exit(0));
  }
}
