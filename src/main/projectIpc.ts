import { BrowserWindow, dialog, ipcMain } from 'electron';
import { basename, dirname, relative, join, sep } from 'node:path';
import { lstat } from 'node:fs/promises';
import { ProjectRootGrants, isFullyQualifiedPath } from './projectRoots';
import { isTrustedRendererIpc } from './browserSecurity';
import { expandTilde, safeJoin, confinedPath, readFileText } from './fs';
import { assertControlledPath } from './controlledStartup';

/** Shared by the full service runtime and the controlled mode of the same app. */
export function registerProjectAccess(allWindows: Set<BrowserWindow>, rendererDocumentUrl: string, controlledRoot?: string,
  observe?: (event: 'allow' | 'deny' | 'read') => void) {
  const projectRootGrants = new WeakMap<Electron.WebContents, ProjectRootGrants>();

  async function authorizeProjectRoot(event: Electron.IpcMainInvokeEvent, root: unknown, scope: 'project' | 'inspect' = 'project'): Promise<string> {
    let grants = projectRootGrants.get(event.sender);
    if (!grants) { grants = new ProjectRootGrants(); projectRootGrants.set(event.sender, grants); }
    return grants.authorize(root, async requested => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return false;
      const decision = await dialog.showMessageBox(win, {
        type: 'question', title: 'Authorize project access',
        message: controlledRoot !== undefined ? 'Allow read-only access until this page reloads or closes?' : scope === 'inspect'
          ? 'Allow metadata checks and showing paths in the file browser until this page reloads or navigates?'
          : 'Allow filesystem and Git operations in this directory until this page reloads or navigates?',
        detail: `${requested}\n\n${controlledRoot !== undefined ? 'Only file reads are available in this run.' : scope === 'inspect'
          ? 'This permits metadata checks and file-browser display within this directory. File contents, writes and Git operations require separate project consent.'
          : 'This permits file reads, writes and Git operations.'} Saved project entries do not grant access. Declining blocks this access scope until the page reloads or this window is reopened.`,
        buttons: ['Deny', scope === 'inspect' ? 'Allow metadata and display' : 'Allow project access'], defaultId: 0, cancelId: 0, noLink: true
      });
      observe?.(decision.response === 1 ? 'allow' : 'deny');
      return decision.response === 1 && isTrustedRendererIpc(event, rendererDocumentUrl,
        [...allWindows].some(w => !w.isDestroyed() && w.webContents === event.sender));
    }, scope);
  }

  function handleProjectIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, async (event, ...args) => {
      const ownedSender = [...allWindows].some(w => !w.isDestroyed() && w.webContents === event.sender);
      if (!isTrustedRendererIpc(event, rendererDocumentUrl, ownedSender)) {
        throw new Error('Untrusted project IPC sender');
      }
      if (controlledRoot !== undefined && (channel !== 'fs:readFile' || args[0] !== controlledRoot)) {
        throw new Error('Controlled A1 effect refused');
      }
      if (controlledRoot !== undefined) assertControlledPath(controlledRoot);
      const absoluteTarget = channel === 'fs:statAbs' || channel === 'fs:revealPath';
      if (absoluteTarget) {
        if (typeof args[0] !== 'string' || args[0].length > 4096 || /[\x00-\x1f]/.test(args[0])) {
          throw new Error('Expected an absolute project path');
        }
        const rawTarget = args[0].trim();
        const tildeTarget = rawTarget === '~' || rawTarget.startsWith('~/') || rawTarget.startsWith('~\\');
        if (!tildeTarget && !isFullyQualifiedPath(rawTarget)) throw new Error('Expected a fully qualified absolute project path');
        // Pure expansion only: parent authorization still precedes realpath/stat.
        args[0] = expandTilde(args[0]);
        if (!isFullyQualifiedPath(args[0])) throw new Error('Expected a fully qualified absolute project path');
      }
      const authorization = authorizeProjectRoot(event, absoluteTarget ? dirname(args[0]) : args[0], absoluteTarget ? 'inspect' : 'project');
      const grantSession = projectRootGrants.get(event.sender);
      const canonical = await authorization;
      if (!isTrustedRendererIpc(event, rendererDocumentUrl,
        [...allWindows].some(w => !w.isDestroyed() && w.webContents === event.sender))) {
        throw new Error('Untrusted project IPC sender');
      }
      let responsePath: string | undefined;
      if (['fs:listDir', 'fs:readFile', 'fs:readBinary', 'fs:writeFile'].includes(channel)
        && typeof args[1] === 'string') {
        // Preserve the renderer's lexical path contract while executing only
        // against the canonical grant. Never translate an outside absolute path.
        const requestedPath = safeJoin(args[0], args[1]);
        if (!requestedPath) return { ok: false, error: 'path escapes root' };
        responsePath = requestedPath;
        args[1] = relative(args[0], requestedPath);
        if (controlledRoot !== undefined) {
          // Refuse static links before readFileText resolves them, including links
          // to network locations. Concurrent same-user retargeting is not isolated.
          let current = canonical;
          for (const part of ['', ...args[1].split(sep).filter(Boolean)]) {
            current = join(current, part);
            if ((await lstat(current)).isSymbolicLink()) throw new Error('Controlled A1 refuses linked paths');
          }
        }
      }
      if (absoluteTarget) {
        const target = await confinedPath(canonical, basename(args[0]));
        if (!target) throw new Error('Path escapes authorized project root');
        args[0] = target;
      } else {
        args[0] = canonical;
      }
      // Path resolution can yield while the requesting document/window changes.
      // Authenticate again immediately before dispatch, with no intervening await.
      if (projectRootGrants.get(event.sender) !== grantSession) {
        throw new Error('Project root grants revoked after document change');
      }
      if (!isTrustedRendererIpc(event, rendererDocumentUrl,
        [...allWindows].some(w => !w.isDestroyed() && w.webContents === event.sender))) {
        throw new Error('Untrusted project IPC sender');
      }
      const requestFrame = event.senderFrame;
      let result;
      try {
        result = await listener(event, ...args);
      } finally {
        // Suppress stale results/errors; this does not cancel or undo listener I/O.
        if (projectRootGrants.get(event.sender) !== grantSession || grantSession?.isRevoked) {
          throw new Error('Project root grants revoked after document change');
        }
        if (event.sender.mainFrame !== requestFrame || !isTrustedRendererIpc(event, rendererDocumentUrl,
          [...allWindows].some(w => !w.isDestroyed() && w.webContents === event.sender))) {
          throw new Error('Untrusted project IPC sender');
        }
      }
      if (channel === 'fs:readFile' && result?.ok === true) observe?.('read');
      return responsePath !== undefined && result?.ok === true
        ? { ...result, path: responsePath } : result;
    });
  }

  handleProjectIpc('fs:readFile', (_evt, root: unknown, rel: unknown) => {
    if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
    return readFileText(root, rel);
  });
  return { projectRootGrants, handleProjectIpc };
}
