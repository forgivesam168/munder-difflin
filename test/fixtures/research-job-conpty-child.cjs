'use strict';

// Fixed, inert child for the ConPTY/Job proof harness.  It is deliberately
// not a command runner: only the fixed harness-owned modes below are accepted.
const { spawn } = require('node:child_process');

const mode = process.argv[2];
const FIXED_MODES = new Set([
  '--normal-descendant',
  '--root-early-exit',
  '--bounded-stop',
  '--timeout',
  '--pty-io',
  '--sentinel',
  '--leaf'
]);

if (!FIXED_MODES.has(mode)) process.exit(64);

function exitAfter(milliseconds, code = 0) {
  setTimeout(() => process.exit(code), milliseconds);
}

if (mode === '--leaf') {
  const duration = Number(process.argv[3]);
  if (process.argv.length !== 4 || ![800, 15000].includes(duration)) process.exit(64);
  process.stdout.write('DESCENDANT_READY\n');
  exitAfter(duration, 0);
} else if (mode === '--pty-io') {
  if (process.argv.length !== 3) process.exit(64);
  process.stdout.write('PTY_READY\n');
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    pending += chunk;
    const newline = pending.indexOf('\n');
    if (newline < 0) return;
    const line = pending.slice(0, newline).replace(/\r$/, '');
    if (line !== 'proof-input') process.exit(65);
    process.stdout.write('PTY_ECHO:proof-input\n');
    process.exit(0);
  });
  exitAfter(5000, 66);
} else if (mode === '--sentinel') {
  if (process.argv.length !== 3) process.exit(64);
  exitAfter(15000, 0);
} else {
  if (process.argv.length !== 3) process.exit(64);
  const duration = mode === '--normal-descendant' ? 800 : 15000;
  const child = spawn(process.execPath, [__filename, '--leaf', String(duration)], {
    detached: true,
    windowsHide: true,
    stdio: 'inherit'
  });
  child.once('error', () => process.exit(67));
  child.unref();
  process.stdout.write('ROOT_EXIT\n');
  process.exit(0);
}
