'use strict';
// Regression: stale results rejected; completed I/O is not cancelled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const loadTs = require('./load-ts.cjs');
const { ProjectRootGrants } = loadTs('src/main/projectRoots.ts');
const { isTrustedRendererIpc } = loadTs('src/main/browserSecurity.ts');
const { safeJoin, confinedPath } = loadTs('src/main/fs.ts');
const mainText = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
const main = ts.createSourceFile('index.ts', mainText, ts.ScriptTarget.Latest, true);
const fileText = fs.readFileSync(path.join(root, 'src/main/fs.ts'), 'utf8');
const file = ts.createSourceFile('fs.ts', fileText, ts.ScriptTarget.Latest, true);
function declaration(source, name) {
  const nodes = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(nodes.length, 1);
  return nodes[0].getText(source).replace(/^export /, '');
}
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const registration = main.statements.filter(n => ts.isExpressionStatement(n)
  && ts.isCallExpression(n.expression) && n.expression.expression.getText(main) === 'handleProjectIpc'
  && n.expression.arguments[0]?.text === 'fs:readFile');
assert.equal(registration.length, 1);
const limit = file.statements.filter(n => ts.isVariableStatement(n)
  && n.declarationList.declarations.some(d => d.name.getText(file) === 'MAX_READ_BYTES'));
assert.equal(limit.length, 1);
const callbacks = require('../tools/research-lifecycle-callbacks.cjs')(mainText);
const { run } = require('../tools/research-env.cjs')(root, 'read-revocation');
fs.writeFileSync(path.join(run, 'fixture.txt'), 'synthetic read boundary');
(async () => {
  const observations = [];
  for (const eventName of [null, 'render-process-gone', 'destroyed', 'reload', 'navigation', 'window-removal', 'grant-only', 'frame-replaced', 'grant-replaced', 'active-error', 'stale-error']) {
    let release, entered, reads = 0, readsAfterRevocation = 0;
    const atStat = new Promise(resolve => { entered = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    const sessions = new WeakMap();
    const url = 'file:///D:/fixture/index.html';
    const frame = { url };
    const sender = { mainFrame: frame, isDestroyed: () => false };
    const windows = new Set([{ webContents: sender, isDestroyed: () => false }]);
    const grant = new ProjectRootGrants();
    sessions.set(sender, grant);
    const read = new Function('confinedPath', 'stat', 'readFile', 'resolve',
      `${compile(limit[0].getText(file) + '\n' + declaration(file, 'readFileText'))}; return readFileText;`)(
      confinedPath, async target => { const value = await fsp.stat(target); entered(); await barrier; return value; },
      async target => { reads++; if (!sessions.has(sender)) readsAfterRevocation++; if (eventName === 'active-error' || eventName === 'stale-error') throw new Error('synthetic read failure'); return fsp.readFile(target); }, path.resolve);
    let handler;
    new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
      'authorizeProjectRoot', 'projectRootGrants', 'safeJoin', 'relative', 'readFileText',
      compile(declaration(main, 'handleProjectIpc') + '\n' + registration[0].getText(main)))(
      { handle: (_name, fn) => { handler = fn; } }, windows, url, isTrustedRendererIpc,
      (_event, requested) => grant.authorize(requested, async () => true), sessions, safeJoin, path.relative, read);
    const pending = handler({ sender, senderFrame: frame }, run, 'fixture.txt');
    await atStat;
    assert.equal(reads, 0);
    if (['render-process-gone', 'destroyed', 'reload'].includes(eventName)) {
      new Function('projectRootGrants', 'wc',
        `let rendererReadyForHires = false; ${compile('const callback = ' + callbacks.get(eventName === 'reload' ? 'did-start-navigation' : eventName))}; return callback;`)(sessions, sender)({ isMainFrame: true, isSameDocument: false });
      await assert.rejects(() => grant.authorize(run, async () => true), /revoked/);
      assert.equal(sessions.has(sender), false);
    }
    if (eventName === 'navigation') frame.url = 'https://invalid.example/';
    if (eventName === 'window-removal') windows.clear();
    if (eventName === 'grant-only' || eventName === 'stale-error') grant.revoke();
    if (eventName === 'grant-replaced') sessions.set(sender, new ProjectRootGrants());
    if (eventName === 'frame-replaced') sender.mainFrame = { url };
    release();
    if (eventName === 'active-error') {
      const result = await pending;
      assert.deepEqual(result, { ok: false, error: 'synthetic read failure' });
    } else if (eventName) await assert.rejects(pending, /grants revoked|Untrusted project IPC sender/);
    else {
      const result = await pending;
      assert.equal(result.ok, true);
      assert.equal(result.content, 'synthetic read boundary');
    }
    assert.equal(reads, 1);
    assert.equal(readsAfterRevocation, ['render-process-gone', 'destroyed', 'reload'].includes(eventName) ? 1 : 0);
    observations.push({ event: eventName ?? 'control', reads, readsAfterRevocation,
      wrapperReturnedContent: !eventName, nativeDelivery: 'UNVERIFIED' });
  }
  require('../tools/research-write-receipt.cjs')(path.join(run, 'evidence.json'), {
    status: 'STALE_RESULT_REJECTED_IO_COMPLETED', observations,
    sourceSha256: require('../tools/research-source-identity.cjs').snapshot(root, [
      'test/research-read-revocation.cjs', 'src/main/index.ts', 'src/main/fs.ts',
      'src/main/projectRoots.ts', 'src/main/browserSecurity.ts', 'tools/research-lifecycle-callbacks.cjs',
      'test/load-ts.cjs', 'node_modules/typescript/lib/typescript.js']) });
  console.log(JSON.stringify({ run, observations }));
})().catch(error => { console.error(error); process.exitCode = 1; });
