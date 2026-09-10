'use strict';

// tunnelmole 2.4.0 mistakenly depends on itself. electron-builder 26.16's
// final module traversal follows that self edge indefinitely. Remove only
// this redundant metadata edge; retain all runtime code and other dependencies.
// Re-evaluate rather than silently patch a different upstream release.
const fs = require('node:fs');
const path = require('node:path');

function normalizeManifest(manifest) {
  if (manifest.name !== 'tunnelmole' || manifest.version !== '2.4.0') {
    throw new Error('Unsupported tunnelmole metadata version; review packaging workaround');
  }
  const edge = manifest.dependencies?.tunnelmole;
  if (edge === undefined) return false; // already normalized
  if (edge !== '^2.1.6') throw new Error('Unexpected tunnelmole self dependency; review required');
  delete manifest.dependencies.tunnelmole;
  return true;
}

if (require.main === module) {
  const root = fs.realpathSync(path.join(__dirname, '..'));
  const modules = fs.realpathSync(path.join(root, 'node_modules'));
  const file = fs.realpathSync(path.join(modules, 'tunnelmole', 'package.json'));
  for (const target of [modules, file]) {
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Packaging metadata resolves outside the repository');
    }
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (normalizeManifest(manifest)) fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  // npm list may otherwise trust stale metadata in its generated hidden lock,
  // even after the package manifest was corrected. Invalidate only that cache;
  // the authoritative root package-lock.json retains registry provenance.
  const cache = path.join(modules, '.package-lock.json');
  if (fs.existsSync(cache)) fs.unlinkSync(cache);
  console.log('[patch-tunnelmole] redundant self dependency absent');
}

module.exports = { normalizeManifest };
