'use strict';
const path = require('node:path');
const identity = require('./research-source-identity.cjs');
const schema = require('./research-job-environment.cjs');

// Parent construction only; native helper must independently validate/project.
// No post-startup host environment is merged into this explicit map.
module.exports = function lifecycleEnvironment(root) {
  const { run, env } = require('./research-env.cjs')(root, 'electron-lifecycle');
  const guardHash = identity.snapshot(root, ['tools/research-job-run.ps1'])['tools/research-job-run.ps1'];
  env.POWERSHELL_TELEMETRY_OPTOUT = '1';
  env.POWERSHELL_UPDATECHECK = 'Off';
  env.PSModuleAnalysisCachePath = path.join(run, 'module-analysis-cache');
  env.RESEARCH_JOB_GUARD_SHA256 = guardHash;
  schema.validateValues(env, { admission: false, descendant: false, crash: false, crashDescendant: false },
    { run, root, node: process.execPath, systemRoot: process.env.SystemRoot, guardHash });
  schema.validateFiles(root, run, 'electron-lifecycle');
  return { run, env };
};
