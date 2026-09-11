'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = async function verifyNativeResult({ root, run, win, ipcMain, sessions, expectedUrl }) {
  const loadTs = require('../test/load-ts.cjs');
  const { readFileText } = loadTs('src/main/fs.ts');
  const filename = 'ipc-read-fixture.txt';
  const content = 'synthetic IPC read result';
  fs.writeFileSync(path.join(run, filename), content, { flag: 'wx' });
  let readCompletions = 0;
  const { ProjectRootGrants } = loadTs('src/main/projectRoots.ts');
  const { isTrustedRendererIpc } = loadTs('src/main/browserSecurity.ts');
  const source = ts.createSourceFile('index.ts', fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const wrappers = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleProjectIpc');
  assert.equal(wrappers.length, 1);
  const code = ts.transpileModule(wrappers[0].getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const wc = win.webContents;
  let completed = 0;
  const register = new Function('ipcMain', 'allWindows', 'rendererDocumentUrl', 'isTrustedRendererIpc',
    'authorizeProjectRoot', 'projectRootGrants', `${code}; return handleProjectIpc;`)(
    ipcMain, new Set([win]), expectedUrl, isTrustedRendererIpc,
    (event, requested) => {
      assert.equal(event.sender, wc);
      assert.equal(requested, undefined);
      const grant = new ProjectRootGrants();
      sessions.set(wc, grant);
      return grant.authorize(run, async () => true);
    }, sessions);
  register('research:project-result', async (_event, canonical, mode) => {
    assert.equal(canonical, fs.realpathSync(run));
    assert.ok(['control', 'revoked', 'read-control', 'read-revoked'].includes(mode));
    const grant = sessions.get(wc);
    await Promise.resolve();
    if (mode === 'revoked' || mode === 'read-revoked') grant.revoke();
    if (mode.startsWith('read-')) {
      const result = await readFileText(canonical, filename);
      assert.equal(result.ok, true);
      assert.equal(result.content, content);
      readCompletions++;
      return result;
    }
    completed++;
    return 'synthetic-result';
  });
  try {
    assert.equal(await wc.executeJavaScript('window.researchResult.control()'), 'synthetic-result');
    const outcome = await wc.executeJavaScript(`window.researchResult.revoked().then(
      () => ({ rejected: false }), error => ({ rejected: true, message: error.message }))`);
    assert.equal(outcome.rejected, true);
    assert.match(outcome.message, /Project root grants revoked after document change/);
    const normalRead = await wc.executeJavaScript('window.researchResult.readControl()');
    assert.equal(normalRead.ok, true);
    assert.equal(normalRead.content, content);
    const staleRead = await wc.executeJavaScript(`window.researchResult.readRevoked().then(
      () => ({ rejected: false }), error => ({ rejected: true, message: error.message }))`);
    assert.equal(staleRead.rejected, true);
    assert.match(staleRead.message, /Project root grants revoked after document change/);
    assert.equal(readCompletions, 2, 'Both actual reads completed; rejection does not cancel I/O');
    assert.equal(completed, 2, 'Both synthetic listeners completed; no cancellation claim');
  } finally {
    ipcMain.removeHandler('research:project-result');
  }
};
