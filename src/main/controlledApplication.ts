import { app, ipcMain, Menu } from 'electron';
import type { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ControlledStartup } from './controlledStartup';
import { createApplicationWindow } from './applicationWindow';
import { registerProjectAccess } from './projectIpc';
import { isTrustedRendererIpc } from './browserSecurity';

/** Controlled mode of the product entry; no service/config/worker graph is loaded. */
export async function startControlledApplication(mode: ControlledStartup): Promise<void> {
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
  const { projectRootGrants } = registerProjectAccess(windows, documentUrl, mode.projectRoot);
  ipcMain.handle('app:controlledRead', event => {
    if (!isTrustedRendererIpc(event, documentUrl, [...windows].some(win => win.webContents === event.sender))) {
      throw new Error('Untrusted controlled startup sender');
    }
    return { projectRoot: mode.projectRoot };
  });
  const deadline = setTimeout(() => app.exit(1), 60_000);
  app.on('will-quit', () => clearTimeout(deadline));
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
  wc.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) revoke(); });
  wc.on('render-process-gone', () => { revoke(); app.exit(1); });
  wc.on('destroyed', revoke);
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
}
