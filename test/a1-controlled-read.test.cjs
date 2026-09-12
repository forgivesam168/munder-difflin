'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const repo = path.resolve(__dirname, '..');
const envKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'];
function fixture(t) {
  const base = fs.mkdtempSync(path.join(repo, '.tmp', 'a1-source-'));
  const projectRoot = path.join(base, 'project'), appData = path.join(base, 'app-data');
  fs.mkdirSync(projectRoot); fs.mkdirSync(appData);
  fs.writeFileSync(path.join(projectRoot, 'readme.txt'), 'A1 synthetic read\n');
  const env = { MUNDER_A1_PROJECT: projectRoot, MUNDER_A1_APP_DATA: appData };
  for (const key of envKeys) { env[key] = path.join(appData, key.toLowerCase()); fs.mkdirSync(env[key]); }
  t.after(() => {
    assert.ok(base.startsWith(path.join(repo, '.tmp', 'a1-source-')));
    fs.rmSync(base, { recursive: true });
  });
  return { projectRoot, appData, env };
}
// Evaluate COMPLETE product modules; only Electron transport/lifecycle is inert.
// A service/native-process import is a test failure, not a permissive mock.
function runtime(mode, options = {}) {
  const handlers = new Map(), loaded = [], windows = [], paths = {}, exits = [];
  let api, consentCalls = 0, reads = 0;
  const rendererWindow = {};
  const app = new EventEmitter();
  app.setPath = (key, value) => { paths[key] = value; };
  app.whenReady = async () => undefined;
  app.exit = code => { exits.push(code); app.emit('will-quit'); };
  app.quit = () => { exits.push(0); app.emit('will-quit'); };
  class Window extends EventEmitter {
    constructor(settings) {
      super(); this.settings = settings;
      this.webContents = new EventEmitter();
      const wc = this.webContents;
      wc.mainFrame = { url: '' }; wc.isDestroyed = () => false;
      wc.setWindowOpenHandler = fn => { wc.open = fn; };
      wc.session = new EventEmitter();
      wc.session.setPermissionRequestHandler = fn => { wc.session.requestPermission = fn; };
      wc.session.setPermissionCheckHandler = fn => { wc.session.checkPermission = fn; };
      wc.session.webRequest = { onBeforeRequest: fn => { wc.session.request = fn; } };
      windows.push(this);
    }
    isDestroyed() { return false; }
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    static fromWebContents(wc) { return windows.find(win => win.webContents === wc); }
  }
  const electron = {
    app, BrowserWindow: Window, Menu: { setApplicationMenu: () => undefined },
    dialog: { showMessageBox: async () => { consentCalls++; return { response: await (options.consent?.() ?? 1) }; } },
    ipcMain: { handle: (channel, handler) => { assert.ok(!handlers.has(channel)); handlers.set(channel, handler); } },
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'cth'); api = value; rendererWindow.cth = value; } },
    ipcRenderer: { invoke: async (channel, ...args) => {
      const wc = windows[0].webContents;
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}`);
      return handler({ sender: wc, senderFrame: wc.mainFrame }, ...args);
    } }
  };
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    loaded.push(path.relative(repo, file).replaceAll('\\', '/'));
    const source = fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(file, module);
    function requireProduct(id) {
      if (id === 'electron') return electron;
      if (id === 'react' && options.react) return options.react;
      if (id === 'react/jsx-runtime' && options.react) return require(id);
      if (id === 'node:fs/promises') return { ...fsp, readFile: async (...args) => {
        reads++;
        if (options.beforeRead) await options.beforeRead();
        return fsp.readFile(...args);
      } };
      if (['node:fs', 'node:path', 'node:os', 'node:url'].includes(id)) return require(id);
      if (!id.startsWith('.')) throw new Error(`Forbidden module import: ${id}`);
      const target = path.resolve(path.dirname(file), `${id}.ts`);
      const allowed = ['bootstrap', 'controlledStartup', 'controlledApplication', 'applicationWindow', 'projectIpc', 'projectRoots', 'browserSecurity', 'fs', 'imageTypes'];
      if (!allowed.includes(path.basename(target, '.ts'))) throw new Error(`Forbidden service import: ${id}`);
      return load(target);
    }
    vm.runInNewContext('(function(require,module,exports,__dirname){' + code + '\n})', {
      process: { argv: ['node', 'app', '--munder-controlled-read'], env: mode.env, platform: process.platform },
      window: rendererWindow, console: { error: () => undefined }, Error, URL, Buffer, setTimeout, clearTimeout, __APP_VERSION__: 'test'
    }, { filename: file })(requireProduct, module, module.exports, path.dirname(file));
    return module.exports;
  }
  return { load, handlers, loaded, windows, paths, exits, app, electron,
    get api() { return api; }, get consentCalls() { return consentCalls; }, get reads() { return reads; } };
}
async function start(t, options) {
  const mode = fixture(t), r = runtime(mode, options);
  t.after(() => r.app.emit('will-quit'));
  await r.load(path.join(repo, 'src/main/controlledApplication.ts')).startControlledApplication(mode);
  r.load(path.join(repo, 'src/preload/index.ts'));
  return { mode, r };
}
test('formal registration -> production preload -> consent -> readFileText -> result; effects refused', async t => {
  const { mode, r } = await start(t);
  assert.deepEqual([...r.handlers.keys()].sort(), ['app:controlledRead', 'fs:readFile']);
  assert.equal(r.api.controlledRead, true);
  assert.equal((await r.api.controlledReadProject()).projectRoot, mode.projectRoot);
  const result = await r.api.readFile(mode.projectRoot, 'readme.txt');
  assert.equal(result.ok, true); assert.equal(result.content, 'A1 synthetic read\n');
  assert.equal(result.path, path.join(mode.projectRoot, 'readme.txt'));
  assert.equal(r.consentCalls, 1); assert.equal(r.reads, 1);
  for (const channel of ['fs:writeFile', 'fs:delete', 'git:checkout', 'pty:spawn', 'skills:install', 'config:get', 'config:update', 'integrations:test', 'analytics:messageSent']) {
    await assert.rejects(r.electron.ipcRenderer.invoke(channel), /No handler registered/);
  }
  const badRoot = await r.api.readFile(path.dirname(mode.projectRoot), 'readme.txt');
  assert.equal(badRoot.ok, false); assert.match(badRoot.error, /effect refused/);
  const escape = await r.api.readFile(mode.projectRoot, '../outside.txt');
  assert.equal(escape.ok, false); assert.equal(r.reads, 1);
  assert.equal(r.consentCalls, 1);
  assert.ok(r.loaded.includes('src/main/projectIpc.ts'));
  assert.ok(r.loaded.includes('src/main/fs.ts'));
});
test('deny performs no content read and remains denied for the document', async t => {
  const { mode, r } = await start(t, { consent: () => 0 });
  assert.equal((await r.api.readFile(mode.projectRoot, 'readme.txt')).ok, false);
  assert.equal((await r.api.readFile(mode.projectRoot, 'readme.txt')).ok, false);
  assert.equal(r.consentCalls, 1); assert.equal(r.reads, 0);
});
test('pending consent revoked by formal lifecycle listener never dispatches read', async t => {
  let release;
  const consent = new Promise(resolve => { release = resolve; });
  const { mode, r } = await start(t, { consent: () => consent });
  const pending = r.api.readFile(mode.projectRoot, 'readme.txt');
  r.windows[0].webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  release(1);
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.error, /revoked/); assert.equal(r.reads, 0);
});
test('read completion after revoke is suppressed; new document requires consent again', async t => {
  let reached, release;
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { mode, r } = await start(t, { beforeRead: async () => { reached(); await gate; } });
  const pending = r.api.readFile(mode.projectRoot, 'readme.txt');
  await entered;
  r.windows[0].webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  release();
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.error, /revoked/);
  assert.equal((await r.api.readFile(mode.projectRoot, 'readme.txt')).ok, true);
  assert.equal(r.consentCalls, 2);
});
test('untrusted frame refused; renderer network, download, popup and permission effects denied', async t => {
  const { mode, r } = await start(t);
  const wc = r.windows[0].webContents;
  await assert.rejects(r.handlers.get('fs:readFile')({ sender: wc, senderFrame: { url: wc.mainFrame.url } }, mode.projectRoot, 'readme.txt'), /Untrusted/);
  assert.equal(r.reads, 0);
  assert.equal(wc.open().action, 'deny'); assert.equal(wc.session.checkPermission(), false);
  wc.session.requestPermission(wc, 'media', allowed => assert.equal(allowed, false));
  for (const url of ['https://example.invalid/', 'file:///C:/private.txt', 'http://localhost:3000/', 'data:text/plain,hi']) {
    wc.session.request({ url }, result => assert.equal(result.cancel, true));
  }
  wc.session.request({ url: wc.mainFrame.url }, result => assert.equal(result.cancel, false));
  let prevented = 0;
  wc.session.emit('will-download', { preventDefault: () => prevented++ });
  wc.emit('will-navigate', { preventDefault: () => prevented++ });
  assert.equal(prevented, 2);
  for (const target of Object.values(r.paths)) assert.ok(target.startsWith(mode.appData + path.sep));
});
test('startup rejects missing/ambient/aliased/unsafe input without normal service fallback', async t => {
  const mode = fixture(t), r = runtime(mode);
  const { controlledStartup } = r.load(path.join(repo, 'src/main/controlledStartup.ts'));
  const args = ['app', '--munder-controlled-read'];
  assert.equal(controlledStartup([], {}), undefined);
  assert.equal(controlledStartup(args, mode.env).projectRoot, mode.projectRoot);
  for (const key of Object.keys(mode.env)) {
    const env = { ...mode.env }; delete env[key];
    assert.throws(() => controlledStartup(args, env));
  }
  assert.throws(() => controlledStartup([], { munder_a1_project: mode.projectRoot }), /Invalid/);
  assert.throws(() => controlledStartup(args, { ...mode.env, MUNDER_A1_EXTRA: 'x' }), /Invalid/);
  assert.throws(() => controlledStartup(args, { ...mode.env, NODE_OPTIONS: '--inspect' }), /overrides/);
  assert.throws(() => controlledStartup([...args, '--no-sandbox'], mode.env), /overrides/);
  assert.throws(() => controlledStartup(args, { ...mode.env, MUNDER_A1_PROJECT: '\\\\server\\share\\a1-test\\project', MUNDER_A1_APP_DATA: '\\\\server\\share\\a1-test\\app-data' }), /requires explicit/);
  fs.writeFileSync(path.join(mode.appData, 'config.json'), '{}');
  assert.throws(() => controlledStartup(args, mode.env), /only empty/);
});
test('official bootstrap loads controlled graph only and catches malformed launch without dialog', async t => {
  const mode = fixture(t), r = runtime(mode);
  t.after(() => r.app.emit('will-quit'));
  r.load(path.join(repo, 'src/main/bootstrap.ts'));
  for (let count = 0; count < 20 && !r.windows.length; count++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.windows.length, 1); assert.deepEqual(r.exits, []);
  assert.ok(!r.loaded.includes('src/main/index.ts'));
  const rejected = runtime({ env: {} });
  rejected.load(path.join(repo, 'src/main/bootstrap.ts'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(rejected.exits, [1]);
  assert.equal(rejected.windows.length, 0);
  assert.ok(!rejected.loaded.includes('src/main/controlledApplication.ts'));
});


for (const decision of [0, 1]) test(`actual controlled renderer action through preload; consent=${decision}`, async t => {
  // Inert hook driver evaluates the complete component and its actual button action.
  // This proves source wiring, not React DOM/native rendering or scheduling.
  const state = [], effects = [];
  let cursor = 0, mounted = false;
  const react = {
    useState: initial => { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
    useRef: initial => { const slot = cursor++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect: effect => { if (!mounted) effects.push(effect); }
  };
  const { r } = await start(t, { react, consent: () => decision });
  // The component reads the same exposed bridge that Electron would put on window.
  const { ControlledRead } = r.load(path.join(repo, 'src/renderer/src/ControlledRead.tsx'));
  const render = () => { cursor = 0; return ControlledRead(); };
  render(); mounted = true;
  for (const effect of effects) t.after(effect());
  await new Promise(resolve => setImmediate(resolve));
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    const children = node.props?.children;
    return [node, ...[children].flat(Infinity).flatMap(elements)];
  }
  const button = elements(render()).find(node => node.type === 'button' && node.props.children === 'Read file');
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  for (let count = 0; count < 100 && state[4]; count++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(state[4], false);
  const nodes = elements(render());
  assert.equal(nodes.find(node => node.type === 'pre').props.children, decision ? 'A1 synthetic read\n' : '');
  assert.equal(r.reads, decision ? 1 : 0);
});
test('controlled startup and read refuse static junctions before following targets', async t => {
  const { mode, r } = await start(t);
  fs.symlinkSync(mode.appData, path.join(mode.projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await r.api.readFile(mode.projectRoot, 'linked/anything');
  assert.equal(result.ok, false); assert.match(result.error, /linked paths/); assert.equal(r.reads, 0);
  const other = fixture(t);
  fs.unlinkSync(path.join(other.projectRoot, 'readme.txt'));
  fs.rmdirSync(other.projectRoot);
  fs.symlinkSync(mode.projectRoot, other.projectRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const { controlledStartup } = r.load(path.join(repo, 'src/main/controlledStartup.ts'));
  assert.throws(() => controlledStartup(['--munder-controlled-read'], other.env), /linked paths/);
});
