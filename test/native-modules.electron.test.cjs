'use strict';

// Native ABI/behavior evidence in Electron's Node runtime, without booting the
// application, reading its user state or contacting any service.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
// Optional Windows directory artifact: exercise its executable and dependencies,
// not the development node_modules tree. No application entrypoint is loaded.
const packagedDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!process.versions.electron) {
  const executable = packagedDir ? path.join(packagedDir, 'Munder Difflin.exe') : require('electron');
  const result = spawnSync(executable, [__filename, ...(packagedDir ? [packagedDir] : [])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit', timeout: 30_000, windowsHide: true
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const test = require('node:test');
const assert = require('node:assert/strict');
const nativeRequire = packagedDir
  ? createRequire(path.join(packagedDir, 'resources', 'app.asar', 'package.json'))
  : require;
if (packagedDir) {
  assert.equal(path.resolve(process.execPath), path.join(packagedDir, 'Munder Difflin.exe'));
  for (const name of ['better-sqlite3', 'node-pty']) {
    const resolved = nativeRequire.resolve(name);
    const relative = path.relative(path.join(packagedDir, 'resources'), resolved);
    assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${name} must resolve inside the artifact, got ${resolved}`);
    console.log(JSON.stringify({ module: name, resolved }));
  }
}
console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node,
  modules: process.versions.modules, napi: process.versions.napi, platform: process.platform, arch: process.arch,
  packagedDir }));

test('SQLite native binding persists and reopens a committed transaction under Electron', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sqlite-'));
  const filename = path.join(dir, 'state.sqlite');
  const Database = nativeRequire('better-sqlite3');
  let db;
  try {
    db = new Database(filename);
    db.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.transaction(() => db.prepare('INSERT INTO evidence VALUES (?, ?)').run(1, 'durable'))();
    db.close();
    db = new Database(filename, { readonly: true });
    assert.deepEqual(db.prepare('SELECT * FROM evidence').all(), [{ id: 1, value: 'durable' }]);
  } finally {
    if (db?.open) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PTY native binding accepts input, resize and clean shell exit under Electron', { timeout: 15_000 }, async () => {
  const pty = nativeRequire('node-pty');
  const windows = process.platform === 'win32';
  const terminal = pty.spawn(windows ? process.env.ComSpec : '/bin/sh', windows ? ['/d', '/q'] : [], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: os.tmpdir(), env: { ...process.env, SMOKE_SUFFIX: 'ok' }
  });
  let output = '';
  let exited = false;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('PTY output/exit timed out')), 10_000);
    terminal.onData(data => { output += data; });
    terminal.onExit(event => { exited = true; clearTimeout(timeout); resolve(event); });
  });
  try {
    terminal.resize(100, 30);
    terminal.write(windows ? 'echo native-runtime-%SMOKE_SUFFIX%\r' : 'echo native-runtime-$SMOKE_SUFFIX\n');
    terminal.write(`exit${windows ? '\r' : '\n'}`);
    const event = await result;
    assert.equal(event.exitCode, 0);
    assert.match(output, /native-runtime-ok/);
  } finally {
    if (!exited) terminal.kill();
  }
});
