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

test('actual project IPC wrapper refuses foreign, subframe, navigated and destroyed senders before effects', () => {
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
    `${code}; return handleProjectIpc;`)({ handle: (_, fn) => { handler = fn; } }, windows, expected, isTrustedRendererIpc);
  let effects = 0;
  register('fs:writeFile', (_event, value) => { effects++; return value; });
  const valid = { sender, senderFrame: frame };
  for (const event of [
    { sender: { ...sender }, senderFrame: frame },
    { sender, senderFrame: { url: expected } },
    { sender, senderFrame: null }
  ]) assert.throws(() => handler(event, 'denied'), /Untrusted/);
  frame.url = 'https://example.com/';
  assert.throws(() => handler(valid, 'denied'), /Untrusted/);
  frame.url = `${expected}?other`;
  assert.throws(() => handler(valid, 'denied'), /Untrusted/);
  frame.url = expected;
  sender.isDestroyed = () => true;
  assert.throws(() => handler(valid, 'denied'), /Untrusted/);
  sender.isDestroyed = () => false;
  window.isDestroyed = () => true;
  assert.throws(() => handler(valid, 'denied'), /Untrusted/);
  window.isDestroyed = () => false;
  assert.equal(effects, 0);
  frame.url = `${expected}#settings`;
  assert.equal(handler(valid, 'allowed'), 'allowed');
  assert.equal(effects, 1);
  windows.delete(window);
  assert.throws(() => handler(valid, 'removed'), /Untrusted/);
  const floorFrame = { url: expected };
  const floorSender = { mainFrame: floorFrame, isDestroyed: () => false };
  windows.add({ webContents: floorSender, isDestroyed: () => false });
  assert.equal(handler({ sender: floorSender, senderFrame: floorFrame }, 'floor'), 'floor');
  assert.equal(effects, 2);
});
