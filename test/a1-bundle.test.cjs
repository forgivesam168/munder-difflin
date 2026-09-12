'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('official bundle retains lazy service boundary, same-directory main chunks and product renderer/preload', async () => {
  const { resolveConfig } = await import('electron-vite');
  const { build } = await import('vite');
  const resolved = await resolveConfig({ build: { write: false }, envFile: false, logLevel: 'error' }, 'build', 'production');
  const outputs = {};
  for (const target of ['main', 'preload', 'renderer']) {
    const result = await build(resolved.config[target]);
    assert.ok(!Array.isArray(result));
    outputs[target] = result.output.filter(item => item.type === 'chunk');
  }
  function reachable(chunks, entry) {
    const seen = new Set(), modules = new Set();
    function visit(name) {
      if (seen.has(name)) return;
      seen.add(name);
      const chunk = chunks.find(item => item.fileName === name);
      if (!chunk) return;
      for (const id of Object.keys(chunk.modules)) modules.add(id.replaceAll('\\', '/'));
      for (const id of chunk.imports) visit(id);
    }
    visit(entry.fileName);
    return [...modules];
  }
  const main = outputs.main;
  const bootstrap = main.find(chunk => chunk.isEntry);
  assert.ok(bootstrap.facadeModuleId.endsWith('/src/main/bootstrap.ts'));
  for (const chunk of main) assert.equal(path.basename(chunk.fileName), chunk.fileName);
  assert.ok(!reachable(main, bootstrap).some(id => /src\/main\/(index|config|pty|analytics|integrations)\.ts$/.test(id)));
  const controlled = main.find(chunk => chunk.facadeModuleId?.endsWith('/controlledApplication.ts'));
  assert.ok(controlled);
  const controlledModules = reachable(main, controlled);
  assert.ok(controlledModules.some(id => id.endsWith('/src/main/projectIpc.ts')));
  assert.ok(controlledModules.some(id => id.endsWith('/src/main/fs.ts')));
  assert.ok(!controlledModules.some(id => /src\/main\/(index|config|pty|analytics|integrations)\.ts$/.test(id)));
  const ordinary = main.find(chunk => chunk.facadeModuleId?.endsWith('/src/main/index.ts'));
  assert.ok(ordinary);
  assert.ok(reachable(main, ordinary).some(id => id.endsWith('/src/main/projectIpc.ts')));
  assert.ok(outputs.preload.some(chunk => chunk.code.includes('fs:readFile') && chunk.code.includes('controlledRead')));
  const renderer = outputs.renderer, rendererEntry = renderer.find(chunk => chunk.isEntry);
  assert.ok(!reachable(renderer, rendererEntry).some(id => id.endsWith('/src/renderer/src/App.tsx')));
  const read = renderer.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith('/ControlledRead.tsx')));
  assert.ok(read.code.includes('cth.readFile'));
  console.log(JSON.stringify({ mainChunks: main.map(chunk => chunk.fileName), controlledModules, rendererAction: true, write: false }));
});
