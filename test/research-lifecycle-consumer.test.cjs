'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadTs = require('./load-ts.cjs');
const { isTrustedRendererIpc } = loadTs('src/main/browserSecurity.ts');
const text = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8');
const source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
assert.equal(source.parseDiagnostics.length, 0);
const wrapper = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleProjectIpc');
assert.equal(wrapper.length, 1);
const code = ts.transpileModule(wrapper[0].getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const channels = source.statements.filter(n => ts.isExpressionStatement(n)
  && ts.isCallExpression(n.expression) && ts.isIdentifier(n.expression.expression)
  && n.expression.expression.text === 'handleProjectIpc').map(n => {
  assert.ok(ts.isStringLiteral(n.expression.arguments[0]));
  return n.expression.arguments[0].text;
});
assert.equal(channels.length, 20, 'Review consumer coverage when registrations change');
assert.equal(new Set(channels).size, channels.length);
const callbacks = require('../tools/research-lifecycle-callbacks.cjs')(text);

// Exercises the real dispatch wrapper and callbacks. Authorization is a deferred
// stand-in and listeners are effect counters, not filesystem/Git implementations.
for (const channel of channels) {
  test(`${channel}: lifecycle revocation prevents pending dispatch`, async () => {
    for (const event of [null, 'render-process-gone', 'destroyed']) {
      const expected = 'file:///D:/fixture/index.html';
      const frame = { url: expected };
      const sender = { mainFrame: frame, isDestroyed: () => false };
      const windows = new Set([{ webContents: sender, isDestroyed: () => false }]);
      const sessions = new WeakMap();
      let revoked = false, release, handler, effects = 0;
      const grant = { revoke: () => { revoked = true; } };
      const root = path.resolve(__dirname, '..', '.tmp');
      const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl',
        'isTrustedRendererIpc', 'authorizeProjectRoot', 'projectRootGrants',
        'isFullyQualifiedPath', 'expandTilde', 'dirname', 'basename', 'confinedPath',
        'safeJoin', 'relative', `${code}; return handleProjectIpc;`)(
        { handle: (_channel, fn) => { handler = fn; } }, windows, expected,
        isTrustedRendererIpc, () => {
          sessions.set(sender, grant);
          return new Promise(resolve => { release = () => resolve(root); });
        }, sessions, path.isAbsolute, p => p, path.dirname, path.basename,
        async (base, name) => path.join(base, name),
        (base, name) => path.join(base, name), path.relative);
      register(channel, () => { effects++; return 'dispatched'; });
      const pending = handler({ sender, senderFrame: frame }, root, 'fixture.txt');
      assert.equal(effects, 0);
      if (event) {
        const callbackCode = ts.transpileModule(`const callback = ${callbacks.get(event)};`,
          { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        new Function('projectRootGrants', 'wc', `${callbackCode}; return callback;`)(sessions, sender)();
        assert.equal(revoked, true);
        assert.equal(sessions.has(sender), false);
      }
      release(); // Deliberately resolves even after revocation: wrapper must recheck.
      if (event) {
        await assert.rejects(pending, /Project root grants revoked after document change/);
        assert.equal(effects, 0);
      } else {
        assert.equal(await pending, 'dispatched');
        assert.equal(effects, 1);
      }
    }
  });
}
