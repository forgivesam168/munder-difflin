'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validate, validateValues } = require('../tools/research-job-environment.cjs');
const { env: base, run } = require('../tools/research-env.cjs')(path.resolve(__dirname, '..'), 'job-schema');
Object.assign(base, {
  POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
  PSModuleAnalysisCachePath: 'synthetic-path', RESEARCH_JOB_GUARD_SHA256: 'synthetic-digest'
});
const plain = { admission: false, descendant: false, crash: false, crashDescendant: false };

test('binds every value to fixed policy and launch context in every mode', () => {
  const context = { run, root: path.resolve(__dirname, '..'), node: process.execPath,
    systemRoot: process.env.SystemRoot, guardHash: 'a'.repeat(64),
    crashToken: 'synthetic-crash-token', leafToken: 'synthetic-leaf-token' };
  for (const mode of [plain, { ...plain, admission: true },
    { ...plain, admission: true, descendant: true }, { ...plain, crash: true },
    { ...plain, crash: true, crashDescendant: true }]) {
    const env = { ...base, PSModuleAnalysisCachePath: path.join(run, 'module-analysis-cache'),
      RESEARCH_JOB_GUARD_SHA256: context.guardHash };
    if (mode.admission || mode.crash) env.RESEARCH_NODE_EXECUTABLE = context.node;
    if (mode.crash) env.RESEARCH_CRASH_TOKEN = context.crashToken;
    if (mode.descendant || mode.crashDescendant) {
      env.RESEARCH_JOB_FIXTURE = path.join(context.root, 'tools', 'research-job-descendant.cjs');
      env.RESEARCH_LEAF_TOKEN = context.leafToken;
    }
    validateValues(env, mode, context);
    for (const key of Object.keys(env)) {
      assert.throws(() => validateValues({ ...env, [key]: env[key] + '-changed' }, mode, context),
        { message: 'Research environment value mismatch' });
    }
  }
});

test('accepts exact key sets for all launcher mode families', () => {
  for (const mode of [plain, { ...plain, admission: true },
    { ...plain, admission: true, descendant: true }, { ...plain, crash: true },
    { ...plain, crash: true, crashDescendant: true }]) {
    const env = { ...base };
    if (mode.admission || mode.crash) env.RESEARCH_NODE_EXECUTABLE = 'synthetic-node';
    if (mode.crash) env.RESEARCH_CRASH_TOKEN = 'synthetic-token';
    if (mode.descendant || mode.crashDescendant) {
      env.RESEARCH_JOB_FIXTURE = 'synthetic-fixture'; env.RESEARCH_LEAF_TOKEN = 'synthetic-token';
    }
    validate(env, mode);
    for (const key of Object.keys(env)) {
      const missing = { ...env }; delete missing[key];
      assert.throws(() => validate(missing, mode), /Incomplete/);
    }
  }
});

test('rejects unknown, duplicate, inapplicable and invalid values without disclosing input', () => {
  for (const patch of [{ PRIVATE_SENTINEL: 'synthetic-secret' }, { path: base.PATH },
    { RESEARCH_NODE_EXECUTABLE: 'synthetic-node' }, { HOME: '' }, { HOME: 'x\0y' },
    { HOME: 1 }, { ['HOME\0']: 'value' }]) {
    assert.throws(() => validate({ ...base, ...patch }, plain), error =>
      error.message === 'Invalid research environment schema');
  }
  const lower = { ...base, home: base.HOME }; delete lower.HOME;
  validate(lower, plain);
});

test('rejects inconsistent or nonboolean mode inputs', () => {
  for (const mode of [{ ...plain, descendant: true }, { ...plain, crashDescendant: true },
    { ...plain, admission: true, crash: true }, { ...plain, admission: 1 }]) {
    assert.throws(() => validate(base, mode), /Invalid research environment mode/);
  }
});
