'use strict';

/**
 * Pins the Electron renderer boundary on every application-created window.
 *
 * The desktop can run inside a hardened container while its web renderer is
 * still unsandboxed: Electron turns `webPreferences.sandbox: false` into an
 * effective renderer `--no-sandbox` switch. Parse the TypeScript AST so comments,
 * unrelated objects, or string markers cannot satisfy this security contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');
const { isRendererDocument, isTrustedRendererIpc, rendererPermissionAllowed } = loadTs('src/main/browserSecurity.ts');

const sourcePath = path.join(__dirname, '..', 'src', 'main', 'index.ts');

test('GitTab refresh settles refusals and resolved errors without stale repository data', async () => {
  const filename = path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'GitTab.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'refresh') callback = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const code = ts.transpileModule(`const refresh = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const values = {
    gitIsRepo: true, gitBranch: { current: 'main', detached: false },
    gitStatus: { staged: [], unstaged: [], untracked: ['new'] }, gitLog: [{ sha: 'commit' }],
    gitBranches: { local: ['main'], remote: [] }, gitAheadBehind: { ahead: 1, behind: 2, upstream: 'origin/main' }
  };
  for (const failure of ['none', 'nonrepo', 'empty-error', ...Object.keys(values), ...Object.keys(values).filter(k => k !== 'gitIsRepo').map(k => `resolved:${k}`)]) {
    const state = {};
    const setters = ['IsRepo', 'Branch', 'Detached', 'Status', 'Log', 'Branches', 'Ahead', 'Behind', 'Upstream', 'Loading', 'Error'];
    for (const key of setters) state[key] = 'stale';
    const api = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, async () => {
      if (failure === 'empty-error') throw new Error('');
      if (failure === name) throw new Error('access declined');
      if (failure === `resolved:${name}`) return { error: 'access denied' };
      return failure === 'nonrepo' && name === 'gitIsRepo' ? false : value;
    }]));
    const refresh = new Function('cwd', 'window', ...setters.map(k => `set${k}`), `${code}; return refresh;`)(
      'repo', { cth: api }, ...setters.map(key => value => { state[key] = value; }));
    await refresh();
    assert.equal(state.Loading, false);
    if (failure === 'none') {
      assert.equal(state.IsRepo, true); assert.equal(state.Branch, 'main');
      assert.equal(state.Status, values.gitStatus); assert.equal(state.Ahead, 1);
      assert.equal(state.Error, undefined);
    } else {
      assert.equal(state.IsRepo, failure === 'nonrepo' ? false : null);
      assert.equal(state.Branch, null); assert.equal(state.Status, null);
      assert.deepEqual(state.Log, []); assert.equal(state.Branches, null);
      assert.equal(state.Ahead, 0); assert.equal(state.Behind, 0); assert.equal(state.Upstream, null);
      if (failure !== 'nonrepo') assert.match(state.Error, /declined|denied|Git access failed/);
    }
  }
});

test('absolute project IPC expands tilde before parent consent but never before sender validation', async () => {
  const { expandTilde } = loadTs('src/main/fs.ts');
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleProjectIpc');
  const code = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const expected = 'file:///app/index.html';
  const frame = { url: expected };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  for (const channel of ['fs:statAbs', 'fs:revealPath']) {
    let handler, allowed = true;
    const events = [];
    const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
      'authorizeProjectRoot', 'projectRootGrants', 'expandTilde', 'isAbsolute', 'dirname', 'basename', 'confinedPath', 'isFullyQualifiedPath',
      `${code}; return handleProjectIpc;`)(
      { handle: (_, fn) => { handler = fn; } }, new Set([{ webContents: sender, isDestroyed: () => false }]),
      expected, isTrustedRendererIpc, async (_event, parent, scope) => {
        assert.equal(scope, 'inspect');
        events.push(['consent', parent]);
        if (!allowed) throw new Error('access declined');
        return parent;
      }, new WeakMap(), value => { events.push(['expand']); return expandTilde(value); },
      path.isAbsolute, path.dirname, path.basename,
      async (parent, leaf) => { events.push(['lookup']); return path.join(parent, leaf); }, loadTs('src/main/projectRoots.ts').isFullyQualifiedPath);
    register(channel, (_event, target) => { events.push(['dispatch']); return target; });
    const event = { sender, senderFrame: frame };
    for (const raw of ['~/file.txt', '~\\file.txt', '~', ' ~/file.txt ', path.resolve('absolute.txt')]) {
      events.length = 0;
      const expanded = expandTilde(raw);
      assert.equal(await handler(event, raw), expanded);
      assert.deepEqual(events, [['expand'], ['consent', path.dirname(expanded)], ['lookup'], ['dispatch']]);
    }
    allowed = false; events.length = 0;
    await assert.rejects(() => handler(event, '~/denied.txt'), /declined/);
    assert.deepEqual(events.map(entry => entry[0]), ['expand', 'consent']);
    for (const invalid of ['relative.txt', '~someone/file', 'x\0y', '\t~/file', 'x'.repeat(4097), null,
      ...(process.platform === 'win32' ? ['\\Work', '\\\\server', '\\\\?\\C:\\Work'] : [])]) {
      events.length = 0;
      await assert.rejects(() => handler(event, invalid));
      assert.ok(!events.some(entry => entry[0] === 'consent' || entry[0] === 'lookup'));
    }
    events.length = 0; frame.url = 'https://example.com';
    await assert.rejects(() => handler(event, '~/file.txt'), /Untrusted/);
    assert.deepEqual(events, []);
    frame.url = expected;
  }
});

test('terminal path activation rechecks metadata and stops on fresh denial or disappearance', async () => {
  const filename = path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'terminalPool.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'activatePath');
  assert.ok(fn);
  const code = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const action of ['edit', 'reveal']) {
    let checks = 0, opened = 0, revealed = 0;
    let mode = 'success';
    const activate = new Function('window', 'storeApi', 'mdStatCache', `${code}; return activatePath;`)(
      { cth: {
        statAbs: async () => {
          checks++;
          if (mode === 'denied') throw new Error('Project root denied');
          return { exists: mode !== 'missing', isFile: true, path: '/synthetic/file.txt' };
        },
        revealPath: async () => { revealed++; return { ok: true }; }
      } }, { getState: () => ({ openFileInIde: () => { opened++; } }) }, new Map());
    await activate('/synthetic/file.txt', action);
    assert.equal(opened + revealed, 1);
    for (const next of ['denied', 'missing']) {
      mode = next;
      await activate('/synthetic/file.txt', action);
      assert.equal(opened + revealed, 1, `${next} must stop activation`);
    }
    assert.equal(checks, 3, 'each explicit activation checks main again');
    mode = 'success';
    await activate('/synthetic/file.txt', action);
    assert.equal(opened + revealed, 2, 'fresh success remains usable');
  }
});

test('history load distinguishes Git errors from a valid empty history', async () => {
  const filename = path.join(__dirname, '..', 'src', 'renderer', 'src', 'ide', 'GitPanes.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'load') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const code = ts.transpileModule(`const load = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fail of ['log', 'branch', 'none']) {
    const state = { commits: ['stale'], branch: 'stale', selected: 'stale', files: ['stale'] };
    const setters = ['Loading', 'HistoryError', 'Commits', 'Branch', 'Selected', 'Files'];
    const load = new Function('gitRoot', 'window', ...setters.map(key => `set${key}`), `${code}; return load;`)(
      'repo', { cth: {
        gitLogGraph: async () => fail === 'log' ? { error: 'log denied' } : [],
        gitBranch: async () => fail === 'branch' ? { error: 'branch denied' } : { current: 'main' }
      } }, ...setters.map(key => value => { state[key[0].toLowerCase() + key.slice(1)] = value; }));
    await load(1);
    assert.equal(state.loading, false);
    assert.deepEqual(state.commits, []);
    if (fail === 'none') {
      assert.equal(state.historyError, null);
      assert.equal(state.branch, 'main');
    } else {
      assert.match(state.historyError, /denied/);
      assert.equal(state.branch, null);
      assert.equal(state.selected, null);
      assert.equal(state.files, null);
    }
  }
});

test('Git history and compare IPC refusal retains explicit error contracts without retry', async () => {
  const filename = path.join(__dirname, '..', 'src', 'preload', 'index.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const specs = {
    gitBranch: ['git:branch', ['root'], ['root']],
    gitBranches: ['git:branches', ['root'], ['root']],
    gitLogGraph: ['git:logGraph', ['root', 200], ['root', 200, 0]],
    gitCommitFiles: ['git:commitFiles', ['root', 'sha'], ['root', 'sha']],
    gitCompareRefs: ['git:compareRefs', ['root', 'base', 'head'], ['root', 'base', 'head', 'three']],
    gitCheckout: ['git:checkout', ['root', 'ref'], ['root', 'ref', false]]
  };
  const methods = new Map();
  function visit(node) {
    if (ts.isPropertyAssignment(node) && Object.hasOwn(specs, node.name.getText(source))) methods.set(node.name.getText(source), node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(methods.size, 6);
  const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'gitOperationError');
  for (const [name, method] of methods) {
    const code = ts.transpileModule(`${helper?.getText(source) ?? ''}\nconst invoke = ${method.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    let failure = new Error('Project root access declined');
    let result;
    let count = 0;
    const [channel, args, forwarded] = specs[name];
    const invoke = new Function('ipcRenderer', `${code}; return invoke;`)({ invoke: async (actualChannel, ...actualArgs) => {
      count++;
      assert.equal(actualChannel, channel); assert.deepEqual(actualArgs, forwarded);
      if (failure) throw failure;
      return result;
    } });
    for (const rejected of [failure, 'unknown failure']) {
      failure = rejected;
      const error = rejected instanceof Error ? rejected.message : 'Git operation failed';
      assert.deepEqual(await invoke(...args), name === 'gitCheckout' ? { ok: false, error } : { error });
    }
    failure = null;
    for (const resolved of [[], { error: 'existing failure' }, { ok: true, detached: false }]) {
      result = resolved;
      assert.equal(await invoke(...args), resolved);
    }
    assert.equal(count, 5);
  }
});

test('IDE Git discovery distinguishes refusal from non-repository and clears stale state', async () => {
  const filename = path.join(__dirname, '..', 'src', 'renderer', 'src', 'ide', 'IdePanel.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'refreshStatus') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const code = ts.transpileModule(`const refresh = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const valid = { staged: [], unstaged: [], untracked: ['new.txt'] };
  for (const failAt of ['gitIsRepo', 'gitMainRepo', 'gitStatus', 'status-error', 'not-repo', 'none']) {
    const state = { repo: true, status: { stale: true }, root: 'old', error: null };
    const pending = { current: false };
    const calls = [];
    const api = Object.fromEntries(['gitIsRepo', 'gitMainRepo', 'gitStatus'].map(name => [name, async () => {
      calls.push(name);
      if (name === failAt) throw new Error('Project root access declined');
      if (name === 'gitIsRepo') return failAt !== 'not-repo';
      if (name === 'gitMainRepo') return 'main-root';
      return failAt === 'status-error' ? { error: 'Git status failed' } : valid;
    }]));
    const refresh = new Function('root', 'window', 'gitRefreshPending', 'setIsRepo', 'setStatus', 'setGitRoot', 'setGitError',
      `${code}; return refresh;`)('workspace', { cth: api }, pending,
      value => { state.repo = value; }, value => { state.status = value; },
      value => { state.root = value; }, value => { state.error = value; });
    const first = refresh();
    await refresh();
    await first;
    assert.equal(pending.current, false);
    assert.equal(calls.filter(name => name === 'gitIsRepo').length, 1, 'overlapping refresh does not duplicate requests');
    if (failAt === 'none') assert.deepEqual(state, { repo: true, root: 'main-root', status: valid, error: null });
    else if (failAt === 'not-repo') {
      assert.deepEqual(state, { repo: false, root: null, status: null, error: null });
      assert.deepEqual(calls, ['gitIsRepo']);
    } else {
      assert.equal(state.repo, null, 'denial is not a non-repository result');
      assert.equal(state.root, null);
      assert.equal(state.status, null);
      assert.match(state.error, /declined|failed/);
    }
  }
});

test('preload file and Git diff reads return IPC denial through their existing error contract', async () => {
  const preload = path.join(__dirname, '..', 'src', 'preload', 'index.ts');
  const source = ts.createSourceFile(preload, fs.readFileSync(preload, 'utf8'), ts.ScriptTarget.Latest, true);
  const methods = new Map();
  const names = ['listDir', 'readFile', 'readBinary', 'writeFile', 'gitDiff', 'gitShowFile'];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && names.includes(node.name.getText(source))
      && ts.isArrowFunction(node.initializer)) methods.set(node.name.getText(source), node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(methods.size, names.length);
  const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fileOperationError');
  for (const [name, method] of methods) {
    const code = ts.transpileModule(`${helper?.getText(source) ?? ''}\nconst operation = ${method.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const args = name === 'writeFile' ? ['project', 'file', 'unsaved text']
      : name === 'gitShowFile' ? ['project', 'HEAD~1', 'file'] : ['project', 'file'];
    const channelName = name === 'gitDiff' ? 'git:diff' : name === 'gitShowFile' ? 'git:showFile' : `fs:${name}`;
    let response;
    let rejection;
    let calls = 0;
    const operation = new Function('ipcRenderer', `${code}; return operation;`)({ invoke: async (channel, ...actual) => {
      calls++;
      assert.equal(channel, channelName);
      assert.deepEqual(actual, args);
      if (rejection !== undefined) throw rejection;
      return response;
    } });
    for (const message of ['Project root access declined', 'Project root grants revoked after document change']) {
      rejection = new Error(message);
      assert.deepEqual(await operation(...args), { ok: false, error: message });
    }
    rejection = { unexpected: 'non-error rejection' };
    assert.deepEqual(await operation(...args), { ok: false, error: 'File operation failed' });
    rejection = undefined;
    const success = name === 'gitDiff'
      ? { ok: true, path: 'project/file', relPath: 'file', head: 'old', working: 'new', isBinary: false }
      : { ok: true, path: 'project/file', content: 'text', isBinary: false };
    for (const value of [success, { ok: true, isBinary: true }, { ok: false, error: 'existing error' }]) {
      response = value;
      assert.equal(await operation(...args), value, 'resolved result remains unchanged');
    }
    assert.equal(calls, 6, 'no automatic retry after denial');
  }
});

function property(object, name) {
  return object.properties.find((entry) => (
    ts.isPropertyAssignment(entry)
    && ((ts.isIdentifier(entry.name) && entry.name.text === name)
      || (ts.isStringLiteral(entry.name) && entry.name.text === name))
  ));
}

function browserWindowOptions() {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true);
  const windows = [];

  function visit(node) {
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'BrowserWindow'
    ) {
      windows.push(node.arguments?.[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return windows;
}

test('every BrowserWindow explicitly enables the Chromium renderer sandbox', () => {
  const windows = browserWindowOptions();
  assert.ok(windows.length > 0, 'no BrowserWindow construction found');

  for (const options of windows) {
    assert.ok(options && ts.isObjectLiteralExpression(options), 'BrowserWindow options must be literal');
    const webPreferences = property(options, 'webPreferences');
    assert.ok(
      webPreferences && ts.isObjectLiteralExpression(webPreferences.initializer),
      'BrowserWindow webPreferences must be literal'
    );
    const sandbox = property(webPreferences.initializer, 'sandbox');
    assert.ok(sandbox, 'BrowserWindow must declare sandbox explicitly');
    assert.equal(sandbox.initializer.kind, ts.SyntaxKind.TrueKeyword);
  }
});

test('web permissions belong only to the exact top-level application document', () => {
  for (const app of ['file:///D:/app/renderer/index.html', 'http://localhost:5173/']) {
    assert.equal(isRendererDocument(app, app, true), true);
    assert.equal(isRendererDocument(`${app}#settings`, app, true), true);
    for (const url of [undefined, 'about:blank', 'https://example.com/', `${app}?other`, `${app}/other`]) {
      assert.equal(isRendererDocument(url, app, true), false);
    }
    assert.equal(isRendererDocument(app, app, false), false);
  }
});

test('microphone permission never grants camera or unrequested device privileges', () => {
  assert.equal(rendererPermissionAllowed('media', true, true, ['audio']), true);
  for (const media of [[], ['video'], ['audio', 'video'], ['unknown']]) {
    assert.equal(rendererPermissionAllowed('media', true, true, media), false);
  }
  assert.equal(rendererPermissionAllowed('media', true, false, ['audio']), false);
  assert.equal(rendererPermissionAllowed('media', false, true, ['audio']), false);
  for (const permission of ['clipboard-read', 'geolocation', 'notifications', 'usb', 'serial', 'display-capture', 'unknown']) {
    assert.equal(rendererPermissionAllowed(permission, true, true), false);
  }
  assert.equal(rendererPermissionAllowed('clipboard-sanitized-write', true, false), true);
  assert.equal(rendererPermissionAllowed('clipboard-sanitized-write', false, false), false);
});

test('filesystem and Git handlers all register through the sender gate', () => {
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const channels = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0]) && /^(fs|git):/.test(node.arguments[0].text)) {
      assert.equal(node.expression.getText(source), 'handleProjectIpc', node.arguments[0].text);
      channels.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(channels.length, 20);
  assert.equal(new Set(channels).size, channels.length);
});

test('actual native consent orchestration isolates windows and rejects stale requests', async () => {
  const { ProjectRootGrants } = loadTs('src/main/projectRoots.ts');
  const base = path.resolve(__dirname, '..', '.tmp');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'ipc-consent-'));
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = ['authorizeProjectRoot', 'handleProjectIpc'].map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name);
    return node.getText(source);
  }).join('\n');
  const code = ts.transpileModule(functions, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const expected = 'file:///D:/app/renderer/index.html';
  const windows = new Set();
  const dialogs = [];
  const grantSessions = new WeakMap();
  let handler, effects = 0;
  const [register, authorize] = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
    'projectRootGrants', 'ProjectRootGrants', 'BrowserWindow', 'dialog',
    `${code}; return [handleProjectIpc, authorizeProjectRoot];`)(
    { handle: (_channel, fn) => { handler = fn; } }, windows, expected, isTrustedRendererIpc,
    grantSessions, ProjectRootGrants,
    { fromWebContents: sender => [...windows].find(win => win.webContents === sender) },
    { showMessageBox: (win, options) => new Promise(resolve => dialogs.push({ win, options, resolve })) });
  register('git:isRepo', (_event, grantedRoot) => { effects++; return grantedRoot; });
  function createWindow() {
    const frame = { url: expected };
    const sender = { mainFrame: frame, isDestroyed: () => false };
    const win = { webContents: sender, isDestroyed: () => false };
    windows.add(win);
    return { frame, sender, win, event: { sender, senderFrame: frame } };
  }
  const first = createWindow();
  const pending = handler(first.event, root);
  const duplicate = handler(first.event, root);
  assert.equal(dialogs.length, 1, 'same-window same-root consent is coalesced');
  assert.equal(effects, 0);
  const prompt = dialogs[0];
  assert.equal(prompt.win, first.win);
  assert.equal(prompt.options.defaultId, 0);
  assert.equal(prompt.options.cancelId, 0);
  assert.equal(prompt.options.buttons[0], 'Deny');
  assert.ok(prompt.options.detail.includes(root));
  prompt.resolve({ response: 1 });
  assert.deepEqual(await Promise.all([pending, duplicate]), [fs.realpathSync(root), fs.realpathSync(root)]);
  assert.equal(await handler(first.event, root), fs.realpathSync(root));
  assert.equal(dialogs.length, 1, 'approved window reuses its grant');
  const second = createWindow();
  const denied = handler(second.event, root);
  assert.equal(dialogs.length, 2, 'other window has no inherited grant');
  dialogs[1].resolve({ response: 0 });
  await assert.rejects(denied, /declined/);
  await assert.rejects(() => handler(second.event, root), /denied/);
  assert.equal(dialogs.length, 2, 'denial is retained for this window');
  assert.equal(effects, 3);
  for (const invalidate of ['navigate', 'replace-frame', 'remove', 'destroy-window', 'destroy-sender']) {
    const current = createWindow();
    const request = handler(current.event, root);
    const decision = dialogs.at(-1);
    if (invalidate === 'navigate') current.frame.url = 'https://example.com/';
    if (invalidate === 'replace-frame') current.sender.mainFrame = { url: expected };
    if (invalidate === 'remove') windows.delete(current.win);
    if (invalidate === 'destroy-window') current.win.isDestroyed = () => true;
    if (invalidate === 'destroy-sender') current.sender.isDestroyed = () => true;
    decision.resolve({ response: 1 });
    await assert.rejects(request, /declined|Untrusted/, invalidate);
    assert.equal(effects, 3, `${invalidate} cannot dispatch`);
  }
  const reopened = createWindow();
  const fresh = handler(reopened.event, root);
  assert.equal(effects, 3);
  dialogs.at(-1).resolve({ response: 1 });
  assert.equal(await fresh, fs.realpathSync(root));
  assert.equal(effects, 4, 'new window can request fresh consent');
  const scopeWindow = createWindow();
  const inspected = authorize(scopeWindow.event, root, 'inspect');
  assert.equal(dialogs.at(-1).options.buttons[1], 'Allow metadata and display');
  assert.match(dialogs.at(-1).options.detail, /require separate project consent/);
  dialogs.at(-1).resolve({ response: 1 });
  await inspected;
  const promptCount = dialogs.length;
  const projectRequest = handler(scopeWindow.event, root);
  assert.equal(dialogs.length, promptCount + 1, 'inspect consent cannot authorize Git');
  assert.equal(dialogs.at(-1).options.buttons[1], 'Allow project access');
  dialogs.at(-1).resolve({ response: 0 });
  await assert.rejects(projectRequest, /declined/);
  assert.equal(effects, 4);

  let navigation;
  const terminalCallbacks = new Map();
  function findNavigation(node) {
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'did-start-navigation') navigation = node.arguments[1];
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && ['render-process-gone', 'destroyed'].includes(node.arguments[0].text)) {
      assert.equal(node.expression.getText(source), 'wc.on', 'termination listener belongs to captured WebContents');
      terminalCallbacks.set(node.arguments[0].text, node.arguments[1]);
    }
    ts.forEachChild(node, findNavigation);
  }
  const windowFactory = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createWindow');
  assert.ok(windowFactory);
  findNavigation(windowFactory);
  assert.ok(navigation);
  const navigationCode = ts.transpileModule(`const onNavigation = ${navigation.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const navigate = new Function('projectRootGrants', 'wc',
    `let rendererReadyForHires = true; ${navigationCode}; return onNavigation;`)(grantSessions, reopened.sender);
  for (const details of [{ isMainFrame: false, isSameDocument: false }, { isMainFrame: true, isSameDocument: true }]) {
    const count = dialogs.length;
    navigate(details);
    await handler(reopened.event, root);
    assert.equal(dialogs.length, count, 'subframe/hash navigation preserves consent');
  }
  const oldSession = grantSessions.get(reopened.sender);
  navigate({ isMainFrame: true, isSameDocument: false });
  await assert.rejects(() => oldSession.authorize(root, async () => true), /revoked/);
  const count = dialogs.length;
  const duringReload = handler(reopened.event, root);
  assert.equal(dialogs.length, count + 1, 'reload requires new consent');
  const beforeEffects = effects;
  navigate({ isMainFrame: true, isSameDocument: false });
  dialogs.at(-1).resolve({ response: 1 });
  await assert.rejects(duringReload, /revoked/);
  assert.equal(effects, beforeEffects, 'old approval cannot survive navigation back to the same URL');
  const afterReload = handler(reopened.event, root);
  dialogs.at(-1).resolve({ response: 1 });
  assert.equal(await afterReload, fs.realpathSync(root));
  for (const eventName of ['render-process-gone', 'destroyed']) {
    const callback = terminalCallbacks.get(eventName);
    assert.ok(callback, `${eventName} must revoke document grants`);
    const eventCode = ts.transpileModule(`const onTermination = ${callback.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const terminate = new Function('projectRootGrants', 'wc',
      `${eventCode}; return onTermination;`)(grantSessions, reopened.sender);
    const granted = grantSessions.get(reopened.sender);
    terminate();
    terminate(); // Repeated lifecycle notifications are harmless.
    assert.equal(grantSessions.has(reopened.sender), false);
    await assert.rejects(() => granted.authorize(root, async () => true), /revoked/);
    const pendingApproval = handler(reopened.event, root);
    const previousEffects = effects;
    terminate();
    dialogs.at(-1).resolve({ response: 1 });
    await assert.rejects(pendingApproval, /revoked/);
    assert.equal(effects, previousEffects, `${eventName} blocks stale consent`);
    // Keep synthetic identities live to prove revocation independently of sender checks.
    const replacement = handler(reopened.event, root);
    dialogs.at(-1).resolve({ response: 1 });
    assert.equal(await replacement, fs.realpathSync(root));
  }
});

test('project IPC preserves alias paths while executing against the granted canonical root', async () => {
  const { ProjectRootGrants } = loadTs('src/main/projectRoots.ts');
  const fileOps = loadTs('src/main/fs.ts');
  const base = path.resolve(__dirname, '..', '.tmp');
  fs.mkdirSync(base, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(base, 'ipc-alias-'));
  const root = path.join(fixture, 'project');
  const alias = path.join(fixture, 'project alias');
  const outside = path.join(fixture, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'file.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'private.txt'), 'outside');
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  // Fixtures are deliberately retained under .tmp as evidence; no recursive cleanup.
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const wrapper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleProjectIpc');
  const code = ts.transpileModule(wrapper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const expected = 'file:///D:/app/renderer/index.html';
  const frame = { url: expected };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const grants = new ProjectRootGrants();
  let prompts = 0;
  const handlers = new Map();
  const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
    'authorizeProjectRoot', 'isAbsolute', 'dirname', 'basename', 'confinedPath', 'safeJoin', 'relative', 'resolve',
    `const projectRootGrants = new WeakMap(); ${code}; return handleProjectIpc;`)(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    new Set([{ webContents: sender, isDestroyed: () => false }]), expected, isTrustedRendererIpc,
    (_event, requested) => grants.authorize(requested, async () => { prompts++; return true; }),
    path.isAbsolute, path.dirname, path.basename, fileOps.confinedPath, fileOps.safeJoin, path.relative, path.resolve);
  for (const [channel, operation] of Object.entries({
    'fs:listDir': fileOps.listDir, 'fs:readFile': fileOps.readFileText,
    'fs:readBinary': fileOps.readFileBinary, 'fs:writeFile': fileOps.writeFileText
  })) register(channel, (_event, executionRoot, ...args) => {
    assert.equal(executionRoot, fs.realpathSync(root), 'canonical execution root stays pinned');
    return operation(executionRoot, ...args);
  });
  const invoke = (channel, rel, ...args) => handlers.get(channel)({ sender, senderFrame: frame }, alias, rel, ...args);
  for (const rel of ['file.txt', path.join(alias, 'file.txt')]) {
    for (const channel of ['fs:readFile', 'fs:readBinary']) {
      const result = await invoke(channel, rel);
      assert.equal(result.ok, true);
      assert.equal(result.path, path.join(alias, 'file.txt'));
      assert.equal(channel === 'fs:readFile' ? result.content : Buffer.from(result.bytes).toString(), 'inside');
    }
  }
  assert.equal((await invoke('fs:listDir', alias)).path, alias);
  const written = await invoke('fs:writeFile', path.join(alias, 'new.txt'), 'new');
  assert.equal(written.ok, true);
  assert.equal(written.path, path.join(alias, 'new.txt'));
  assert.equal(fs.readFileSync(path.join(root, 'new.txt'), 'utf8'), 'new');
  for (const rel of [path.join(outside, 'private.txt'), path.join(alias, 'escape', 'private.txt'), '../outside/private.txt']) {
    const result = await invoke('fs:writeFile', rel, 'forbidden');
    assert.equal(result.ok, false);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), 'outside');
  assert.equal(prompts, 1);
  fs.unlinkSync(alias); // Exact fixture junction, not its target.
  fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => invoke('fs:readFile', 'private.txt'), /target changed/);
});

test('project IPC rechecks sender after asynchronous absolute-path containment', async () => {
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const wrapper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleProjectIpc');
  const code = ts.transpileModule(wrapper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  for (const channel of ['fs:statAbs', 'fs:revealPath']) {
    for (const invalidate of ['navigate', 'remove', 'destroy', 'grant-replaced', 'grant-removed', 'none']) {
      const expected = 'file:///D:/app/renderer/index.html';
      const frame = { url: expected };
      let destroyed = false;
      const sender = { mainFrame: frame, isDestroyed: () => destroyed };
      const window = { webContents: sender, isDestroyed: () => false };
      const windows = new Set([window]);
      const sessions = new WeakMap([[sender, {}]]);
      let handler, release, entered;
      const waiting = new Promise(resolve => { entered = resolve; });
      const barrier = new Promise(resolve => { release = resolve; });
      const target = path.resolve('synthetic-project', 'file.txt');
      let effects = 0;
      const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
        'authorizeProjectRoot', 'isAbsolute', 'dirname', 'basename', 'confinedPath', 'projectRootGrants', 'expandTilde', 'isFullyQualifiedPath',
        `${code}; return handleProjectIpc;`)(
        { handle: (_, fn) => { handler = fn; } }, windows, expected, isTrustedRendererIpc,
        async (_event, root) => root, path.isAbsolute, path.dirname, path.basename,
        async () => { entered(); await barrier; return target; }, sessions, loadTs('src/main/fs.ts').expandTilde, loadTs('src/main/projectRoots.ts').isFullyQualifiedPath);
      register(channel, (_event, value) => { effects++; return value; });
      const result = handler({ sender, senderFrame: frame }, target);
      await waiting;
      if (invalidate === 'navigate') frame.url = 'https://example.com/';
      if (invalidate === 'remove') windows.delete(window);
      if (invalidate === 'destroy') destroyed = true;
      if (invalidate === 'grant-replaced') sessions.set(sender, {});
      if (invalidate === 'grant-removed') sessions.delete(sender);
      release();
      if (invalidate === 'none') {
        assert.equal(await result, target);
        assert.equal(effects, 1);
      } else {
        await assert.rejects(result, /Untrusted project IPC sender|grants revoked/, `${channel}: ${invalidate}`);
        assert.equal(effects, 0);
      }
    }
  }
});

test('actual project IPC wrapper refuses foreign, subframe, navigated and destroyed senders before effects', async () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true);
  const wrapper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleProjectIpc');
  assert.ok(wrapper);
  const code = ts.transpileModule(wrapper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const expected = 'file:///D:/app/renderer/index.html';
  const frame = { url: expected };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  const windows = new Set([window]);
  let handler;
  const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
    'authorizeProjectRoot', `const projectRootGrants = new WeakMap(); ${code}; return handleProjectIpc;`)(
    { handle: (_, fn) => { handler = fn; } }, windows, expected, isTrustedRendererIpc,
    async (_event, root) => root);
  let effects = 0;
  register('fs:writeFile', (_event, value) => { effects++; return value; });
  const valid = { sender, senderFrame: frame };
  for (const event of [
    { sender: { ...sender }, senderFrame: frame },
    { sender, senderFrame: { url: expected } },
    { sender, senderFrame: null }
  ]) await assert.rejects(() => handler(event, 'denied'), /Untrusted/);
  frame.url = 'https://example.com/';
  await assert.rejects(() => handler(valid, 'denied'), /Untrusted/);
  frame.url = `${expected}?other`;
  await assert.rejects(() => handler(valid, 'denied'), /Untrusted/);
  frame.url = expected;
  sender.isDestroyed = () => true;
  await assert.rejects(() => handler(valid, 'denied'), /Untrusted/);
  sender.isDestroyed = () => false;
  window.isDestroyed = () => true;
  await assert.rejects(() => handler(valid, 'denied'), /Untrusted/);
  window.isDestroyed = () => false;
  assert.equal(effects, 0);
  frame.url = `${expected}#settings`;
  assert.equal(await handler(valid, 'allowed'), 'allowed');
  assert.equal(effects, 1);
  windows.delete(window);
  await assert.rejects(() => handler(valid, 'removed'), /Untrusted/);
  const floorFrame = { url: expected };
  const floorSender = { mainFrame: floorFrame, isDestroyed: () => false };
  windows.add({ webContents: floorSender, isDestroyed: () => false });
  assert.equal(await handler({ sender: floorSender, senderFrame: floorFrame }, 'floor'), 'floor');
  assert.equal(effects, 2);
});
