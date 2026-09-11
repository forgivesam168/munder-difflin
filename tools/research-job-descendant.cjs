'use strict';

// Finite fixture; only writes a completion marker in its synthetic run cwd.
if (process.argv[2] === '--leaf') {
  setTimeout(() => {
    require('node:fs').writeFileSync('leaf-complete.json', JSON.stringify({
      result: 'PASS', token: process.env.RESEARCH_LEAF_TOKEN
    }), { flag: 'wx' });
    process.exit(0);
  }, 5000);
  if (!process.send) process.exit(2);
  if (process.env.RESEARCH_CRASH_TOKEN) {
    require('node:fs').writeFileSync('leaf-ready.txt',
      `${process.env.RESEARCH_CRASH_TOKEN}\n${process.pid}`, { flag: 'wx' });
  }
  process.send('ready');
} else {
  const { spawn } = require('node:child_process');
  setTimeout(() => process.exit(2), 6000);
  const child = spawn(process.execPath, [__filename, '--leaf'], {
    // libuv's non-detached Windows child job kills children on root exit.
    // Detached avoids that inner job, not the supervisor's no-breakaway job.
    env: process.env, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  child.once('error', () => process.exit(2));
  child.once('message', message => {
    if (message !== 'ready') process.exit(2);
    child.disconnect();
    child.unref();
    process.exit(process.argv[2] === '--fail-root' ? 17 : 0);
  });
}
