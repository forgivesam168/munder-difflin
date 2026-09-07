import type { IpcMainInvokeEvent } from 'electron';

/** The app's top-level document is the only web permission principal.
 * Release HTML/iframes, other pages and unknown requesters have no grant.
 */
export function isRendererDocument(actual: string | undefined, expected: string, isMainFrame: boolean): boolean {
  if (!actual || !isMainFrame) return false;
  try {
    const request = new URL(actual);
    const app = new URL(expected);
    request.hash = '';
    app.hash = '';
    return request.href === app.href;
  } catch {
    return false;
  }
}

/** Native frame identity matters: an iframe can report the same URL as its parent. */
export function isTrustedRendererIpc(event: IpcMainInvokeEvent, expectedUrl: string, ownedSender: boolean): boolean {
  if (!ownedSender || event.sender.isDestroyed() || !event.senderFrame) return false;
  return event.senderFrame === event.sender.mainFrame
    && isRendererDocument(event.senderFrame.url, expectedUrl, true);
}

/** A microphone feature grants audio only, never camera/display capture.
 * Keep the UI's clipboard writes; reading uses the explicit preload API.
 * Unknown permissions and unspecified media are deliberately denied.
 */
export function rendererPermissionAllowed(
  permission: string,
  trustedDocument: boolean,
  microphoneLive: boolean,
  mediaTypes: readonly string[] = []
): boolean {
  if (!trustedDocument) return false;
  if (permission === 'clipboard-sanitized-write') return true;
  return permission === 'media' && microphoneLive && mediaTypes.length > 0
    && mediaTypes.every(type => type === 'audio');
}
