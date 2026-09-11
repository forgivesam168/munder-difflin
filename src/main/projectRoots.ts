import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/** No current-drive resolution or Windows device namespaces in consent roots. */
export function isFullyQualifiedPath(value: string): boolean {
  if (!isAbsolute(value)) return false;
  if (process.platform !== 'win32') return true;
  const path = value.replace(/\//g, '\\');
  if (/^[A-Za-z]:\\/.test(path)) return true;
  const parts = path.split('\\');
  return parts[0] === '' && parts[1] === ''
    && [parts[2], parts[3]].every(part => !!part && !['.', '..', '?'].includes(part));
}

/** Main-owned document-session grants. Neither persisted quick-picks nor renderer data
 * can add grants. Consent precedes filesystem resolution, including UNC paths.
 * This detects static root retargeting, not concurrent filesystem replacement.
 */
export class ProjectRootGrants {
  private revoked = false;
  private readonly grants = new Map<string, string>();
  private readonly denied = new Set<string>();
  private readonly pending = new Map<string, { key: string; operation: Promise<string> }>();

  revoke(): void {
    this.revoked = true;
    this.grants.clear();
  }

  get isRevoked(): boolean { return this.revoked; }

  private assertActive(): void {
    if (this.revoked) throw new Error('Project root grants revoked after document change');
  }

  async authorize(root: unknown, consent: (root: string) => Promise<boolean>, scope: 'project' | 'inspect' = 'project'): Promise<string> {
    this.assertActive();
    if (typeof root !== 'string' || !isFullyQualifiedPath(root) || root.length > 4096 || /[\x00-\x1f]/.test(root)) {
      throw new Error('Project root must be a fully qualified absolute directory path');
    }
    const requested = resolve(root);
    const key = `${scope}\0${requested}`;
    // Fold only refusals/prompt exclusion, never positive grants: Windows can
    // contain distinct case-sensitive directories with otherwise identical names.
    const refusalKey = process.platform === 'win32' ? key.toLowerCase() : key;
    if (this.denied.has(refusalKey)) throw new Error('Project root denied for this document session');
    const active = this.pending.get(refusalKey);
    if (active) {
      if (active.key !== key) throw new Error('A differently cased root request is pending; retry after it finishes');
      return active.operation;
    }
    const operation = this.resolveGrant(requested, consent, key, refusalKey);
    this.pending.set(refusalKey, { key, operation });
    try { return await operation; }
    finally { this.pending.delete(refusalKey); }
  }

  private async resolveGrant(root: string, consent: (root: string) => Promise<boolean>, key: string, refusalKey: string): Promise<string> {
    const existing = this.grants.get(key);
    if (!existing && !await consent(root)) {
      this.denied.add(refusalKey);
      throw new Error('Project root access declined');
    }
    this.assertActive();
    const canonical = await realpath(root);
    if (existing && existing !== canonical) {
      this.grants.delete(key);
      this.denied.add(refusalKey);
      throw new Error('Project root target changed; grant revoked for this document session');
    }
    if (!(await stat(canonical)).isDirectory()) throw new Error('Project root is not a directory');
    this.assertActive();
    this.grants.set(key, canonical);
    return canonical;
  }
}
