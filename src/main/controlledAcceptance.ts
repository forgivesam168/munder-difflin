import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ControlledStartup } from './controlledStartup';
import { assertControlledPath } from './controlledStartup';

export const A1_SEQUENCE = ['deny', 'reload', 'allow', 'read', 'display', 'reload', 'allow', 'read', 'display'] as const;
export const A1_CONTENT = 'A1 synthetic read\n';

/** Evidence for the fixed native acceptance workload, not authorization to launch. */
export class ControlledAcceptance {
  private events: string[] = [];
  private failed = false;
  private finished = false;
  constructor(private readonly publish: (result: { result: 'PASS' | 'FAIL'; events: string[] }) => void) {}
  observe(event: string): void {
    if (this.finished) return;
    if (this.events.length >= A1_SEQUENCE.length) { this.failed = true; return; }
    if (event !== A1_SEQUENCE[this.events.length]) this.failed = true;
    this.events.push(event);
  }
  display(content: unknown): void {
    if (content !== A1_CONTENT) this.failed = true;
    this.observe('display');
  }
  finish(normalClose: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.publish({ result: normalClose && !this.failed && this.events.length === A1_SEQUENCE.length ? 'PASS' : 'FAIL', events: this.events });
  }
}

export function controlledAcceptance(mode: ControlledStartup): ControlledAcceptance | undefined {
  const run = dirname(mode.appData);
  const file = join(run, 'request.json');
  // Existing controlled use without the admission protocol retains its read-only UI.
  if (!existsSync(file)) return undefined;
  assertControlledPath(file);
  const bytes = readFileSync(file);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid A1 request');
  const request = value as Record<string, unknown>;
  if (Object.keys(request).sort().join(',') !== 'candidateSha256,environmentSha256,nonce,runId,version'
    || request.version !== 1 || request.runId !== 'a1-native-001'
    || ![request.candidateSha256, request.environmentSha256, request.nonce].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) {
    throw new Error('Invalid A1 request binding');
  }
  const resultFile = join(mode.appData, 'a1-result.json');
  if (existsSync(resultFile)) throw new Error('A1 result already exists');
  return new ControlledAcceptance(result => {
    const temporary = `${resultFile}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, runId: request.runId,
      candidateSha256: request.candidateSha256, nonce: request.nonce,
      requestSha256: createHash('sha256').update(bytes).digest('hex'), ...result }), { flag: 'wx' });
    renameSync(temporary, resultFile);
  });
}
