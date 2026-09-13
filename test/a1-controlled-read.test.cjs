'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const binding = require('../tools/a1-candidate.cjs');
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
      wc.reloadCalls = 0;
      // Model the main-owned API contract, not a native Electron execution.
      wc.reload = () => {
        wc.reloadCalls++;
        wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      };
      wc.finishReload = () => {
        wc.mainFrame = { url: wc.mainFrame.url };
        wc.emit('did-finish-load');
      };
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
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const source = fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
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
      if (['node:fs', 'node:path', 'node:os', 'node:url', 'node:crypto'].includes(id)) return require(id);
      if (!id.startsWith('.')) throw new Error(`Forbidden module import: ${id}`);
      const target = path.resolve(path.dirname(file), id.endsWith('.json') ? id : `${id}.ts`);
      if (id.endsWith('/a1-contract.json')) return load(target);
      const allowed = ['a1EventTrace', 'bootstrap', 'controlledAcceptance', 'controlledStartup', 'controlledApplication', 'applicationWindow', 'projectIpc', 'projectRoots', 'browserSecurity', 'fs', 'imageTypes'];
      if (!allowed.includes(path.basename(target, '.ts'))) throw new Error(`Forbidden service import: ${id}`);
      return load(target);
    }
    vm.runInNewContext('(function(require,module,exports,__dirname){' + code + '\n})', {
      process: { argv: ['node', 'app', '--munder-controlled-read'], env: mode.env, platform: process.platform },
      window: rendererWindow, console: { error: () => undefined }, Error, URL, Buffer,
      performance: options.clock ? {now: options.clock.now} : performance,
      setTimeout: options.clock?.setTimeout || setTimeout, clearTimeout: options.clock?.clearTimeout || clearTimeout, __APP_VERSION__: 'test'
    }, { filename: file })(requireProduct, module, module.exports, path.dirname(file));
    return module.exports;
  }
  return { load, handlers, loaded, windows, paths, exits, app, electron,
    get api() { return api; }, get consentCalls() { return consentCalls; }, get reads() { return reads; } };
}
async function start(t, options) {
  const mode = fixture(t);
  if (options?.bound) {
    const candidate={runId:binding.runId,contract:binding.contract,configurationSha256:'b'.repeat(64)};
    fs.writeFileSync(path.join(path.dirname(mode.appData),'candidate.json'),JSON.stringify(candidate));
    const request=binding.request({candidateSha256:binding.digest(candidate),candidate},'c'.repeat(64));
    fs.writeFileSync(path.join(path.dirname(mode.appData),'request.json'),JSON.stringify(request));
  }
  const r = runtime(mode, options);
  t.after(() => r.app.emit('will-quit'));
  await r.load(path.join(repo, 'src/main/controlledApplication.ts')).startControlledApplication(mode);
  r.load(path.join(repo, 'src/preload/index.ts'));
  return { mode, r };
}
test('formal registration -> production preload -> consent -> readFileText -> result; effects refused', async t => {
  const { mode, r } = await start(t);
  assert.deepEqual([...r.handlers.keys()].sort(), ['app:controlledRead', 'app:controlledReadDisplayed', 'app:controlledReadReady', 'app:controlledReload', 'fs:readFile']);
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
  const state = [], effects = [], dependencies = [];
  let cursor = 0, effectCursor = 0;
  const react = {
    useState: initial => { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
    useRef: initial => { const slot = cursor++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect: (effect, deps) => { const slot=effectCursor++; if (!dependencies[slot] || deps.some((v,i)=>v!==dependencies[slot][i])) { dependencies[slot]=deps; effects.push(effect); } }
  };
  const { r } = await start(t, { react, consent: () => decision });
  // The component reads the same exposed bridge that Electron would put on window.
  const { ControlledRead } = r.load(path.join(repo, 'src/renderer/src/ControlledRead.tsx'));
  const render = () => { cursor = 0; effectCursor = 0; return ControlledRead(); };
  for (let pass=0;pass<3;pass++) {
    render();
    for (const effect of effects.splice(0)) { const cleanup=effect(); if(cleanup)t.after(cleanup); }
    await new Promise(resolve=>setImmediate(resolve));
  }
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


test('bound product Ready uses trusted preload IPC and wrong sequence persists diagnostics', async t => {
  let now=0,id=0;const timers=new Map();
  const clock={now:()=>now,setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clearTimeout(key){timers.delete(key);}};
  const {mode,r}=await start(t,{bound:true,clock});
  const handler=r.handlers.get('app:controlledReadReady');
  const wc=r.windows[0].webContents;
  assert.throws(()=>handler({sender:wc,senderFrame:{url:'https://untrusted.invalid'}}),/Untrusted/);
  assert.equal([...timers.values()][0].at,binding.contract.phaseMs.startup);
  now=1000;await r.api.controlledReadReady();
  const due=[...timers.values()][0].at;assert.equal(due,1000+binding.contract.phaseMs.human);
  now=2000;await r.api.controlledReload();
  // A reload before the required deny is a sequence failure, not renewed timing.
  const result=JSON.parse(fs.readFileSync(path.join(mode.appData,'a1-result.json')));
  assert.equal(result.reason,'SEQUENCE_MISMATCH');assert.equal(result.phase,'human');assert.deepEqual(result.events,['reload']);assert.deepEqual(r.exits,[1]);
});

test('trusted main-owned reload revokes grants, counts once and requires fresh consent', async t => {
  let decision=0;
  const {mode,r}=await start(t,{bound:true,consent:()=>decision});
  const wc=r.windows[0].webContents, handler=r.handlers.get('app:controlledReload');
  const frame=wc.mainFrame;
  assert.throws(()=>handler({sender:wc,senderFrame:{url:frame.url}}),/Untrusted/);
  assert.throws(()=>handler({sender:{isDestroyed:()=>false},senderFrame:frame}),/Untrusted/);
  const url=frame.url;frame.url='https://untrusted.invalid';
  assert.throws(()=>handler({sender:wc,senderFrame:frame}),/Untrusted/);frame.url=url;
  assert.equal(wc.reloadCalls,0);
  await r.api.controlledReadReady();
  assert.equal((await r.api.readFile(mode.projectRoot,'readme.txt')).ok,false);
  for(let pass=0;pass<2;pass++) {
    const previous=wc.mainFrame;
    await r.api.controlledReload();await r.api.controlledReload();
    assert.equal(wc.reloadCalls,pass+1);
    // Navigation events can repeat but never produce acceptance reload events.
    wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
    wc.finishReload();assert.notEqual(wc.mainFrame,previous);
    assert.throws(()=>handler({sender:wc,senderFrame:previous}),/Untrusted/);
    await r.api.controlledReadReady();decision=1;
    const content=await r.api.readFile(mode.projectRoot,'readme.txt');
    assert.equal(content.ok,true);assert.equal(r.consentCalls,pass+2);
    await r.api.controlledReadDisplayed(content.content);
  }
  let prevented=false;wc.emit('will-navigate',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  r.windows[0].emit('close');
  const result=JSON.parse(fs.readFileSync(path.join(mode.appData,'a1-result.json')));
  assert.equal(result.reason,'PASS');
  assert.deepEqual(result.events,['deny','reload','allow','read','display','reload','allow','read','display']);
});

test('bound controlled lifecycle emits generation and reload provenance in order', async t => {
  let decision = 0;
  const { mode, r } = await start(t, { bound: true, consent: () => decision });
  const wc = r.windows[0].webContents;
  wc.emit('did-finish-load');
  await r.api.controlledReadReady();
  assert.equal((await r.api.readFile(mode.projectRoot, 'readme.txt')).ok, false);
  await r.api.controlledReload(); wc.finishReload(); await r.api.controlledReadReady();
  decision = 1;
  const first = await r.api.readFile(mode.projectRoot, 'readme.txt');
  assert.equal(first.ok, true); await r.api.controlledReadDisplayed(first.content);
  await r.api.controlledReload(); wc.finishReload(); await r.api.controlledReadReady();
  const second = await r.api.readFile(mode.projectRoot, 'readme.txt');
  assert.equal(second.ok, true); await r.api.controlledReadDisplayed(second.content);
  r.windows[0].emit('close');
  const req = JSON.parse(fs.readFileSync(path.join(path.dirname(mode.appData), 'request.json')));
  const result = JSON.parse(fs.readFileSync(path.join(mode.appData, 'a1-result.json')));
  const tracePath = path.join(path.dirname(mode.appData), 'a1-event-trace.jsonl');
  const records = fs.readFileSync(tracePath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(result.result, 'PASS');
  assert.deepEqual(records.filter(record => record.kind === 'acceptance-event')
    .map(record => [record.acceptanceEvent, record.documentGeneration]),
    [['deny',1],['reload',1],['allow',2],['read',2],['display',2],['reload',2],['allow',3],['read',3],['display',3]]);
  const actions = records.filter(record => record.kind === 'reload-handler-entry');
  assert.deepEqual(actions.map(record => record.reloadActionId), ['reload-1', 'reload-2']);
  for (const action of actions) {
    const related = records.filter(record => record.reloadActionId === action.reloadActionId);
    assert.deepEqual(related.map(record => record.kind), ['reload-handler-entry','acceptance-event','reload-invocation','navigation-start','navigation-finished']);
  }
  const close = records.findIndex(record => record.kind === 'window-close');
  const published = records.findIndex(record => record.kind === 'result-publication');
  assert.ok(close >= 0 && published > close);
  for (const record of records) assert.equal(record.documentIdentity, 'controlled-read');
  assert.equal(binding.validateTrace(tracePath, req, result).status, 'VERIFIED');
});

test('untrusted controlled reload produces no legal provenance action', async t => {
  const { mode, r } = await start(t, { bound: true });
  const wc = r.windows[0].webContents;
  wc.emit('did-finish-load');
  const handler = r.handlers.get('app:controlledReload');
  assert.throws(() => handler({ sender: wc, senderFrame: { url: 'https://untrusted.invalid' } }), /Untrusted/);
  const tracePath = path.join(path.dirname(mode.appData), 'a1-event-trace.jsonl');
  const records = fs.readFileSync(tracePath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(records.some(record => record.kind === 'reload-handler-entry'), false);
});

test('bound product renderer-gone and startup timeout write different terminal reasons', async t => {
  for (const reason of ['RENDERER_GONE','STARTUP_TIMEOUT','HUMAN_INTERACTION_TIMEOUT']) {
    let now=0,id=0;const timers=new Map();
    const clock={now:()=>now,setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clearTimeout(key){timers.delete(key);}};
    const {mode,r}=await start(t,{bound:true,clock});
    if(reason==='RENDERER_GONE')r.windows[0].webContents.emit('render-process-gone');
    else {
      if(reason==='HUMAN_INTERACTION_TIMEOUT')await r.api.controlledReadReady();
      const timer=[...timers.values()][0];now=timer.at;timer.fn();
    }
    const result=JSON.parse(fs.readFileSync(path.join(mode.appData,'a1-result.json')));
    const request=JSON.parse(fs.readFileSync(path.join(path.dirname(mode.appData),'request.json')));
    binding.validateResult(result,request,{allowFailure:true});assert.equal(result.reason,reason);assert.deepEqual(r.exits,[1]);
  }
});

test('renderer loss after completed close still forces failed root without rewriting terminal result', async t => {
  let decision=0;
  const {mode,r}=await start(t,{bound:true,consent:()=>decision});
  const wc=r.windows[0].webContents;
  await r.api.controlledReadReady();
  assert.equal((await r.api.readFile(mode.projectRoot,'readme.txt')).ok,false);
  for(let pass=0;pass<2;pass++) {
    await r.api.controlledReload();wc.finishReload();
    await r.api.controlledReadReady();decision=1;
    const result=await r.api.readFile(mode.projectRoot,'readme.txt');assert.equal(result.ok,true);
    await r.api.controlledReadDisplayed(result.content);
  }
  r.windows[0].emit('close');
  const before=fs.readFileSync(path.join(mode.appData,'a1-result.json'));
  assert.equal(JSON.parse(before).reason,'PASS');
  wc.emit('render-process-gone');wc.emit('render-process-gone');
  assert.deepEqual(r.exits,[1]);assert.deepEqual(fs.readFileSync(path.join(mode.appData,'a1-result.json')),before);
});
