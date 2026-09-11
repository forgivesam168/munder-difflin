'use strict';

// Fixed Windows launch-input schema. Values/paths require additional validation;
// this does not authorize forwarding the helper's post-startup environment.
const required = [
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1',
  'GIT_TERMINAL_PROMPT', 'TUNNELMOLE_TELEMETRY', 'DO_NOT_TRACK',
  'NODE_DISABLE_COMPILE_CACHE', 'FORCE_COLOR', 'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_REGISTRY',
  'ELECTRON_CACHE', 'electron_config_cache', 'SystemRoot', 'ComSpec', 'PATHEXT',
  'POWERSHELL_TELEMETRY_OPTOUT', 'POWERSHELL_UPDATECHECK', 'PSModuleAnalysisCachePath',
  'RESEARCH_JOB_GUARD_SHA256'
];

function validate(env, { admission, descendant, crash, crashDescendant }) {
  for (const flag of [admission, descendant, crash, crashDescendant]) {
    if (typeof flag !== 'boolean') throw new Error('Invalid research environment mode');
  }
  if ((descendant && !admission) || (crash && admission) || (crashDescendant && !crash)) {
    throw new Error('Invalid research environment mode');
  }
  const allowed = new Set(required.map(key => key.toUpperCase()));
  if (admission || crash) allowed.add('RESEARCH_NODE_EXECUTABLE');
  if (crash) allowed.add('RESEARCH_CRASH_TOKEN');
  if (descendant || crashDescendant) {
    allowed.add('RESEARCH_JOB_FIXTURE');
    allowed.add('RESEARCH_LEAF_TOKEN');
  }
  const seen = new Set();
  for (const [key, value] of Object.entries(env)) {
    const normalized = key.toUpperCase();
    if (!allowed.has(normalized) || seen.has(normalized) ||
        typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
      // Do not expose unknown keys or supplied values in diagnostics.
      throw new Error('Invalid research environment schema');
    }
    seen.add(normalized);
  }
  if (seen.size !== allowed.size) throw new Error('Incomplete research environment schema');
}

function validateValues(env, mode, context) {
  validate(env, mode);
  const path = require('node:path').win32;
  const { run, root, node, systemRoot, guardHash, crashToken, leafToken } = context;
  const normalized = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]));
  const expected = {
    PATH: [path.dirname(node), path.join(systemRoot, 'System32'),
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    SystemRoot: systemRoot, ComSpec: path.join(systemRoot, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_KEY_1: 'init.templateDir',
    GIT_TERMINAL_PROMPT: '0', TUNNELMOLE_TELEMETRY: '0', DO_NOT_TRACK: '1',
    NODE_DISABLE_COMPILE_CACHE: '1', FORCE_COLOR: '0',
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
    RESEARCH_JOB_GUARD_SHA256: guardHash
  };
  const paths = {
    HOME: 'home', USERPROFILE: 'home', TEMP: 'temp', TMP: 'temp',
    APPDATA: 'appdata', LOCALAPPDATA: 'localappdata', XDG_CONFIG_HOME: 'config',
    XDG_CACHE_HOME: 'cache', XDG_DATA_HOME: 'data', PSModuleAnalysisCachePath: 'module-analysis-cache',
    GIT_CONFIG_GLOBAL: 'empty-config', NPM_CONFIG_USERCONFIG: 'empty-config',
    NPM_CONFIG_GLOBALCONFIG: 'empty-npm-global', GIT_CONFIG_VALUE_0: 'hooks',
    GIT_CONFIG_VALUE_1: 'templates', NPM_CONFIG_CACHE: 'npm-cache',
    ELECTRON_CACHE: 'electron-cache', electron_config_cache: 'electron-cache'
  };
  for (const [key, suffix] of Object.entries(paths)) expected[key] = path.join(run, suffix);
  if (mode.admission || mode.crash) expected.RESEARCH_NODE_EXECUTABLE = node;
  if (mode.crash) expected.RESEARCH_CRASH_TOKEN = crashToken;
  if (mode.descendant || mode.crashDescendant) {
    expected.RESEARCH_JOB_FIXTURE = path.join(root, 'tools', 'research-job-descendant.cjs');
    expected.RESEARCH_LEAF_TOKEN = leafToken;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value !== 'string' || normalized[key.toUpperCase()] !== value) {
      throw new Error('Research environment value mismatch');
    }
  }
}

function validateFiles(root, run, mode = 'job-preflight') {
  const fs = require('node:fs');
  const path = require('node:path');
  const fail = () => { throw new Error('Invalid research environment filesystem'); };
  if (mode !== 'job-preflight' && mode !== 'electron-lifecycle') fail();
  const namePattern = mode === 'job-preflight'
    ? /^job-preflight-[A-Za-z0-9]{6}$/ : /^electron-lifecycle-[A-Za-z0-9]{6}$/;
  if (!path.isAbsolute(root) || !path.isAbsolute(run) || path.resolve(root) !== root ||
      path.resolve(run) !== run || path.dirname(run) !== path.join(root, '.tmp') ||
      !namePattern.test(path.basename(run))) fail();
  // Static checks only; trusted ancestors and no concurrent replacement assumed.
  for (const directory of [root, path.join(root, '.tmp'), run,
    ...['home', 'temp', 'appdata', 'localappdata', 'config', 'cache', 'data',
      'hooks', 'templates', 'npm-cache', 'electron-cache'].map(name => path.join(run, name))]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) fail();
  }
  for (const name of ['empty-config', 'empty-npm-global', 'module-analysis-cache']) {
    const file = path.join(run, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat && name === 'module-analysis-cache') continue;
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file ||
        (name !== 'module-analysis-cache' && stat.size !== 0)) fail();
  }
}

module.exports = { validate, validateValues, validateFiles };
