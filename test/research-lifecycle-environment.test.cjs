'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const create = require('../tools/research-lifecycle-environment.cjs');
const schema = require('../tools/research-job-environment.cjs');
const mode = { admission: false, descendant: false, crash: false, crashDescendant: false };
test('constructs a complete lifecycle helper environment without probe controls', () => {
  const { run, env } = create(root);
  schema.validate(env, mode);
  schema.validateFiles(root, run, 'electron-lifecycle');
  assert.match(path.basename(run), /^electron-lifecycle-[A-Za-z0-9]{6}$/);
  assert.equal(env.HOME, path.join(run, 'home'));
  assert.equal(env.PSModuleAnalysisCachePath, path.join(run, 'module-analysis-cache'));
  assert.equal(env.RESEARCH_JOB_GUARD_SHA256,
    require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'tools/research-job-run.ps1'))).digest('hex'));
  for (const key of ['RESEARCH_NODE_EXECUTABLE', 'RESEARCH_JOB_FIXTURE', 'RESEARCH_CRASH_TOKEN']) {
    assert.equal(Object.hasOwn(env, key), false);
  }
});
test('host injection is not forwarded into the constructed map', () => {
  const key = 'RESEARCH_LIFECYCLE_TEST_SENTINEL';
  const previous = process.env[key];
  try {
    process.env[key] = 'synthetic';
    const { env } = create(root);
    assert.equal(Object.hasOwn(env, key), false);
    assert.throws(() => schema.validate({ ...env, [key]: 'synthetic' }, mode));
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
});
test('disabled parent uses the validated lifecycle environment', () => {
  const source = fs.readFileSync(path.join(root, 'tools/research-electron-lifecycle.cjs'), 'utf8');
  assert.match(source, /const NATIVE_LAUNCH_ENABLED = false/);
  const parent = fs.readFileSync(path.join(root, 'tools/research-lifecycle-parent.cjs'), 'utf8');
  assert.match(source, /research-lifecycle-parent\.cjs/);
  assert.match(parent, /const \{ run, env \} = require\('\.\/research-lifecycle-environment.cjs'\)\(root\)/);
});
