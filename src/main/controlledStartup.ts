import { realpathSync, statSync, readdirSync, lstatSync } from 'node:fs';
import { basename, dirname, join, resolve, parse, sep } from 'node:path';
import { isFullyQualifiedPath } from './projectRoots';

export interface ControlledStartup { projectRoot: string; appData: string }

/** Inspect each local component before realpath can follow a static junction. */
export function assertControlledPath(path: string): void {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Controlled A1 refuses linked paths');
  }
}

/** Launch configuration is explicit and fail closed. This is not an OS sandbox. */
export function controlledStartup(argv: readonly string[], env: NodeJS.ProcessEnv): ControlledStartup | undefined {
  const requested = argv.includes('--munder-controlled-read');
  const keys = Object.keys(env).filter(key => key.toUpperCase().startsWith('MUNDER_A1_'));
  if (!requested && keys.length === 0 && !argv.some(arg => arg.startsWith('--munder-controlled'))) return undefined;
  if (!requested || keys.some(key => !['MUNDER_A1_PROJECT', 'MUNDER_A1_APP_DATA'].includes(key))) {
    throw new Error('Invalid controlled startup mode');
  }
  if (Object.keys(env).some(key => ['ELECTRON_RENDERER_URL', 'NODE_OPTIONS'].includes(key.toUpperCase()) && env[key])
    || argv.some(arg => arg.startsWith('--') && arg !== '--munder-controlled-read')) {
    throw new Error('Controlled startup refuses runtime overrides');
  }
  const projectRoot = env.MUNDER_A1_PROJECT;
  const appData = env.MUNDER_A1_APP_DATA;
  if (!projectRoot || !appData || !isFullyQualifiedPath(projectRoot) || !isFullyQualifiedPath(appData)
    || (process.platform === 'win32' && [projectRoot, appData].some(path => !/^[A-Za-z]:[\\/]/.test(path)))
    || basename(projectRoot) !== 'project' || basename(appData) !== 'app-data'
    || dirname(projectRoot) !== dirname(appData) || !basename(dirname(projectRoot)).startsWith('a1-')) {
    throw new Error('Controlled startup requires explicit sibling synthetic project and app-data directories');
  }
  for (const path of [projectRoot, appData]) {
    if (resolve(path) !== path) throw new Error('Controlled startup requires canonical paths');
    assertControlledPath(path);
    if (realpathSync(path) !== path || !statSync(path).isDirectory()) {
      throw new Error('Controlled startup requires canonical directories without link redirection');
    }
  }
  const environmentKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'];
  if (readdirSync(appData).some(name => !environmentKeys.includes(name.toUpperCase()) || name !== name.toLowerCase())) {
    throw new Error('Controlled app-data must contain only empty synthetic environment directories');
  }
  for (const key of environmentKeys) {
    if (env[key] !== join(appData, key.toLowerCase())) throw new Error(`Controlled startup requires synthetic ${key}`);
    const path = env[key];
    if (path) assertControlledPath(path);
    if (!path || realpathSync(path) !== path || !statSync(path).isDirectory() || readdirSync(path).length !== 0) {
      throw new Error('Controlled environment directories must be canonical and empty');
    }
  }
  return Object.freeze({ projectRoot, appData });
}
