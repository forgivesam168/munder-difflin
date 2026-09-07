/**
 * The native update check must be hard-capped.
 *
 * The bug it prevents: electron-updater's checkForUpdates has no timeout of its
 * own, and it caches its in-flight check promise. If one check's feed request
 * stalls (opens but never responds), the promise never settles, runCheck never
 * leaves 'checking', and every LATER check returns the same hung promise. The
 * badge then spins on 'checking' forever with nothing logged, which is worse
 * than an error: it looks like the app is working when it is not. A hard cap in
 * runCheck is the only thing that forces a terminal state.
 *
 * Source-string checks, because updater.ts imports electron and cannot be loaded
 * in a plain test; deleting the cap must not pass silently.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');

test('research updater denies every action without timers, network, files or native updater loading', async () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = ts.transpileModule(read('src/main/updater.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  for (const { packaged, preview } of [false, true].flatMap(packaged =>
    [false, true].map(preview => ({ packaged, preview })))) {
    const handlers = new Map();
    const effects = [];
    const forbidden = (name) => (...args) => { effects.push(name); throw new Error(`Forbidden effect: ${name}`); };
    const mod = { exports: {} };
    const sandbox = {
      module: mod, exports: mod.exports,
      process: { platform: 'win32', arch: 'x64', env: preview ? { MD_DROP_PREVIEW: 'untrusted-preview.md' } : {} },
      console, setTimeout: forbidden('timer'), setInterval: forbidden('interval'), clearTimeout() {},
      require(id) {
        if (id === 'electron') return {
          app: { isPackaged: packaged, getPath: forbidden('userData'), getVersion: () => '0.4.6' },
          ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
          shell: { openExternal: forbidden('external URL') }
        };
        if (id === './config') return { readConfig: () => ({ autoUpdate: true }) };
        if (id === 'node:https') return { request: forbidden('network') };
        if (id === 'node:fs') return new Proxy({}, { get: (_, key) => forbidden(`fs:${String(key)}`) });
        if (id === 'node:path') return require('node:path');
        if (id === '../shared/releaseDrop') return { DEFAULT_DROP_HTML: '' };
        if (id === '../shared/updateState') return require('./load-ts.cjs')('src/shared/updateState.ts');
        effects.push(`module:${id}`);
        throw new Error(`Unexpected module: ${id}`);
      }
    };
    vm.runInNewContext(source, sandbox, { filename: 'updater.cjs' });
    mod.exports.initAutoUpdater(forbidden('renderer accessor'));
    const actions = ['update:restartAndInstall', 'update:checkNow', 'update:download',
      'update:openRelease', 'update:simulate'];
    assert.equal(handlers.size, actions.length + 1);
    for (const channel of actions) {
      const result = await handlers.get(channel)({}, 'https://github.com/chaitanyagiri/munder-difflin/releases/latest');
      assert.equal(result.ok, false);
      assert.match(result.error, /no update channel is approved/);
    }
    assert.equal(handlers.get('update:current')().state, 'error');
    mod.exports.abortPendingRestart();
    await Promise.resolve();
    assert.deepEqual(effects, [], `packaged=${packaged}, preview=${preview}`);
  }
});

test('runCheck wraps the native check in a timeout, not a bare await', () => {
  const src = read('src/main/updater.ts');
  const runCheck = src.slice(src.indexOf('async function runCheck'), src.indexOf('async function runCheck') + 900);
  assert.ok(/withTimeout\(/.test(runCheck),
    'runCheck must wrap the native check in withTimeout; a bare '
    + 'await autoUpdater.checkForUpdates() can hang forever and freeze the badge');
  assert.ok(/CHECK_TIMEOUT_MS/.test(runCheck),
    'the wrap must use the timeout constant, not an unbounded await');
  assert.ok(!/const result = await autoUpdater\.checkForUpdates\(\);/.test(runCheck),
    'the un-capped await must be gone, or the timeout is dead code beside it');
});

test('the timeout constant is finite, positive, and sane', () => {
  const src = read('src/main/updater.ts');
  const m = src.match(/const CHECK_TIMEOUT_MS = ([0-9_]+);/);
  assert.ok(m, 'CHECK_TIMEOUT_MS must be defined');
  const ms = Number(m[1].replace(/_/g, ''));
  assert.ok(Number.isFinite(ms) && ms > 0 && ms <= 120000,
    'the cap must be finite and sane (0 < ms <= 120s), or it is not really a cap');
});

test('withTimeout arms a rejecting timer and clears it on settle', () => {
  const src = read('src/main/updater.ts');
  const wt = src.slice(src.indexOf('function withTimeout'), src.indexOf('function withTimeout') + 500);
  assert.ok(/setTimeout\(/.test(wt) && /reject\(/.test(wt),
    'withTimeout must arm a timer that rejects, or a hung check is never cut off');
  assert.ok(/clearTimeout\(/.test(wt),
    'it must clear the timer on settle, or a slow-but-successful check leaks a handle');
});
