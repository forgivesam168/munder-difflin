'use strict';

// Environment containment for this repository's synthetic tests and package
// experiments. It does not restrict filesystem or network access at OS level.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function researchEnvironment(root, label, executableDirs = []) {
  if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid research run label');
  const base = path.join(root, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(base));
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('Research directory resolves outside the repository');
  }
  const run = fs.mkdtempSync(path.join(base, `${label}-`));
  const dirs = Object.fromEntries([
    'home', 'temp', 'appdata', 'localappdata', 'config', 'cache', 'data',
    'hooks', 'templates', 'npm-cache', 'electron-cache', 'gyp-cache'
  ].map(name => [name, path.join(run, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  const emptyConfig = path.join(run, 'empty-config');
  fs.writeFileSync(emptyConfig, '');
  const env = {
    PATH: [path.dirname(process.execPath), ...executableDirs,
      ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot, 'System32'),
        path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')] : ['/usr/bin', '/bin'])].join(path.delimiter),
    HOME: dirs.home, USERPROFILE: dirs.home, TEMP: dirs.temp, TMP: dirs.temp,
    APPDATA: dirs.appdata, LOCALAPPDATA: dirs.localappdata,
    XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, XDG_DATA_HOME: dirs.data,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: dirs.hooks,
    GIT_CONFIG_KEY_1: 'init.templateDir', GIT_CONFIG_VALUE_1: dirs.templates,
    GIT_TERMINAL_PROMPT: '0', TUNNELMOLE_TELEMETRY: '0', DO_NOT_TRACK: '1',
    NODE_DISABLE_COMPILE_CACHE: '1', FORCE_COLOR: '0',
    NPM_CONFIG_USERCONFIG: emptyConfig, NPM_CONFIG_GLOBALCONFIG: path.join(run, 'empty-npm-global'),
    NPM_CONFIG_CACHE: dirs['npm-cache'], NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    ELECTRON_CACHE: dirs['electron-cache'], electron_config_cache: dirs['electron-cache']
  };
  fs.writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot;
    env.ComSpec = path.join(env.SystemRoot, 'System32', 'cmd.exe');
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  }
  return { run, dirs, env };
};
