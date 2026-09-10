'use strict';

// Windows packages ship Node-API prebuilds: validate them instead of requiring
// a host compiler. Actual target-Electron behavior is checked separately by
// test/native-modules.electron.test.cjs. Retain the existing source rebuild on
// other platforms and when a caller explicitly requests build-from-source.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root, stdio: 'inherit', windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native setup failed: ${script} (exit ${result.status})`);
}
if (process.platform === 'win32' && process.env.npm_config_build_from_source !== 'true') {
  // Loading a binding is an explicit native-code lifecycle effect. No PTY is
  // spawned and the SQLite check is memory-only.
  require('node-pty');
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
  console.log('[setup-native] Windows Node-API bindings loaded; no source rebuild needed');
} else {
  run('node_modules/@electron/rebuild/lib/cli.js', ['-f', '--only', 'node-pty']);
}
run('tools/ensure-pty-perms.cjs');
run('tools/patch-node-pty-conpty.cjs');
run('tools/patch-tunnelmole-metadata.cjs');
