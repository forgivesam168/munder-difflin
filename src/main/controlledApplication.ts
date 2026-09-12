import { app, ipcMain, Menu } from 'electron';
import type { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ControlledStartup } from './controlledStartup';
import { createApplicationWindow } from './applicationWindow';
import { registerProjectAccess } from './projectIpc';
import { isTrustedRendererIpc } from './browserSecurity';
import contract from '../shared/a1-contract.json';
import { controlledAcceptance } from './controlledAcceptance';

/** Controlled mode of the product entry; no service/config/worker graph is loaded. */
export async function startControlledApplication(mode: ControlledStartup): Promise<void> {
  let failureExitRequested = false;
  const fail = (): void => { if (!failureExitRequested) { failureExitRequested = true; app.exit(1); } };
  const acceptance = controlledAcceptance(mode, fail);
  for (const key of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps', 'temp'] as const) {
    const path = join(mode.appData, key);
    mkdirSync(path, { recursive: true });
    app.setPath(key, path);
  }
  // Refuse every other IPC by absence of registration, including synchronous IPC.
  // The ordinary service registry is never imported in this mode.
  const rendererRoot = join(__dirname, '../renderer');
  const documentPath = join(rendererRoot, 'index.html');
  const documentUrl = pathToFileURL(documentPath).href;
  const windows = new Set<BrowserWindow>();
  const { projectRootGrants } = registerProjectAccess(windows, documentUrl, mode.projectRoot, event => acceptance?.observe(event));
  ipcMain.handle('app:controlledReadDisplayed', (event, content: unknown) => {
    if (!isTrustedRendererIpc(event, documentUrl, [...windows].some(win => win.webContents === event.sender))) {
      throw new Error('Untrusted controlled display sender');
    }
    acceptance?.display(content);
  });
  ipcMain.handle('app:controlledReadReady', event => {
    if (!isTrustedRendererIpc(event, documentUrl, [...windows].some(win => win.webContents === event.sender))) {
      throw new Error('Untrusted controlled Ready sender');
    }
    acceptance?.ready();
  });
  ipcMain.handle('app:controlledRead', event => {
    if (!isTrustedRendererIpc(event, documentUrl, [...windows].some(win => win.webContents === event.sender))) {
      throw new Error('Untrusted controlled startup sender');
    }
    return { projectRoot: mode.projectRoot };
  });
  // Preserve the pre-admission controlled UI's existing bound when no request exists.
  const deadline = acceptance ? undefined : setTimeout(fail, contract.unboundMs);
  app.on('will-quit', () => { clearTimeout(deadline); acceptance?.dispose(); });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const win = createApplicationWindow({
    title: 'Munder Difflin — Controlled project read', width: 1000, height: 720,
    webPreferences: { partition: 'a1-controlled', additionalArguments: ['--munder-controlled-read'] }
  });
  windows.add(win);
  const wc = win.webContents;
  const revoke = (): void => { projectRootGrants.get(wc)?.revoke(); projectRootGrants.delete(wc); };
  let loaded = false;
  wc.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) { revoke(); if (loaded) acceptance?.observe('reload'); }
  });
  wc.on('render-process-gone', () => { revoke(); try { acceptance?.rendererGone(); } finally { fail(); } });
  wc.on('destroyed', revoke);
  win.on('close', () => { try { acceptance?.finish(); } catch { fail(); } });
  win.on('closed', () => { revoke(); windows.delete(win); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', event => event.preventDefault());
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  wc.session.setPermissionCheckHandler(() => false);
  wc.session.on('will-download', event => event.preventDefault());
  wc.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      const rel = relative(rendererRoot, fileURLToPath(url));
      allowed = url.protocol === 'file:' && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel);
    } catch { /* All non-product resources and network requests are denied. */ }
    callback({ cancel: !allowed });
  });
  await win.loadFile(documentPath);
  loaded = true;
}
