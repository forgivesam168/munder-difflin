'use strict';

// Explicit opt-in native fixture. Never imports Munder's main entrypoint.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

// Preflight finding: do not launch until bounded descendant cleanup and its
// receipt have been implemented/reviewed. No environment flag bypass.
const NATIVE_LAUNCH_ENABLED = false;
assert.ok(NATIVE_LAUNCH_ENABLED, 'Native fixture launch disabled: descendant cleanup preflight remains unresolved');

if (!process.versions.electron) {
  require('./research-lifecycle-parent.cjs')({ powershell: process.argv[2] })
    .then(result => { process.exitCode = result.exitCode; console.log(JSON.stringify(result)); })
    .catch(() => { process.exitCode = 1; console.error('Lifecycle supervisor refused or failed'); });
} else {
  const run = require('./research-lifecycle-run.cjs')(root, process.argv);
  const binding = require('./research-lifecycle-binding.cjs');
  const request = binding.read(root, run, 'electron-lifecycle');
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  for (const name of ['home', 'appData', 'userData', 'sessionData', 'temp', 'crashDumps', 'logs']) {
    const dir = path.join(run, `electron-${name}`);
    fs.mkdirSync(dir); app.setPath(name, dir);
  }
  app.on('window-all-closed', () => {});
  const watchdog = setTimeout(() => { console.error('Native fixture watchdog expired'); app.exit(2); }, 25_000);
  app.whenReady().then(async () => {
    const ts = require('typescript');
    const { ProjectRootGrants } = require('../test/load-ts.cjs')('src/main/projectRoots.ts');
    const callbacks = require('./research-lifecycle-callbacks.cjs')(
      fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8'));
    const projectRootGrants = new WeakMap();
    const html = path.join(run, 'fixture.html');
    const allowContent = require('./research-lifecycle-content.cjs')(html);
    const isolated = session.fromPartition('root-lifecycle-fixture');
    isolated.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowContent(details.url) });
    });
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const win = new BrowserWindow({ show: false, webPreferences: {
      session: isolated, preload: path.join(root, 'tools/research-lifecycle-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
    } });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const [event, callback] of callbacks) {
      const code = ts.transpileModule(`const callback = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      wc.on(event, new Function('projectRootGrants', 'wc', `let rendererReadyForHires = false; ${code}; return callback;`)(projectRootGrants, wc));
    }
    fs.writeFileSync(html, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Lifecycle fixture</title>');
    await win.loadFile(html);
    await require('./research-lifecycle-ipc.cjs')({ root, run, win, ipcMain,
      sessions: projectRootGrants, expectedUrl: require('node:url').pathToFileURL(html).href });
    const grant = new ProjectRootGrants();
    projectRootGrants.set(wc, grant);
    await grant.authorize(run, async () => true);
    const reload = new Promise(resolve => wc.once('did-finish-load', resolve));
    wc.reload(); await reload;
    assert.equal(projectRootGrants.has(wc), false);
    await assert.rejects(() => grant.authorize(run, async () => true), /revoked/);
    const crashed = new ProjectRootGrants();
    projectRootGrants.set(wc, crashed);
    await crashed.authorize(run, async () => true);
    const gone = new Promise(resolve => wc.once('render-process-gone', (_event, details) => resolve(details)));
    wc.forcefullyCrashRenderer();
    const details = await gone;
    assert.ok(details.reason === 'killed' || details.reason === 'crashed');
    assert.equal(wc.isDestroyed(), false);
    assert.equal(projectRootGrants.has(wc), false);
    await assert.rejects(() => crashed.authorize(run, async () => true), /revoked/);
    const recovered = new Promise(resolve => wc.once('did-finish-load', resolve));
    wc.reload(); await recovered;
    const replacement = new ProjectRootGrants();
    projectRootGrants.set(wc, replacement);
    await replacement.authorize(run, async () => true);
    const destroyed = new Promise(resolve => wc.once('destroyed', resolve));
    win.destroy(); await destroyed;
    assert.equal(projectRootGrants.has(wc), false);
    await assert.rejects(() => replacement.authorize(run, async () => true), /revoked/);
    binding.verify(root, request);
    const result = require('./research-lifecycle-result.cjs').writeBound(run, request, process.versions.electron);
    console.log(JSON.stringify(result));
    clearTimeout(watchdog); app.exit(0);
  }).catch(error => { console.error(error.stack); clearTimeout(watchdog); app.exit(1); });
}
