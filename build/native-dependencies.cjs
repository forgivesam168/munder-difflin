'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function useWindowsPrebuilds(target, host, buildFromSource) {
  return target.platform === 'win32' && target.arch === 'x64'
    && host.platform === 'win32' && host.arch === 'x64' && !buildFromSource;
}

function assertProject(appDir) {
  if (fs.realpathSync(appDir) !== fs.realpathSync(root)) {
    throw new Error('Native packaging hook must operate on this project');
  }
}

function run(script) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root, stdio: 'inherit', windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Packaging preparation failed: ${script} (${result.status})`);
}

/** @param {import('app-builder-lib').BeforePackContext} context */
exports.beforePack = async function beforePack(context) {
  assertProject(context.packager.info.appDir);
  if (!useWindowsPrebuilds(
    { platform: context.electronPlatformName, arch: require('builder-util').Arch[context.arch] },
    { platform: process.platform, arch: process.arch },
    process.env.npm_config_build_from_source === 'true'
  )) throw new Error('Windows prebuild profile requires native Windows x64; use the base configuration for source/other targets');
  run('tools/setup-native.cjs');
  console.log('[native-packaging] validated Windows x64 prebuilds; skipping redundant rebuild');
};

// afterExtract runs AFTER dependency rebuild and BEFORE dependency collection.
// A rebuild/npm operation may restore upstream metadata or its hidden cache.
/** @param {import('app-builder-lib').AfterPackContext} context */
exports.afterExtract = async function afterExtract(context) {
  assertProject(context.packager.info.appDir);
  run('tools/patch-tunnelmole-metadata.cjs');
};

exports.useWindowsPrebuilds = useWindowsPrebuilds;
