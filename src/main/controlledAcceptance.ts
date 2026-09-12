import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import contract from '../shared/a1-contract.json';
import type { ControlledStartup } from './controlledStartup';
import { assertControlledPath } from './controlledStartup';

export const A1_SEQUENCE = ['deny', 'reload', 'allow', 'read', 'display', 'reload', 'allow', 'read', 'display'] as const;
export const A1_CONTENT = 'A1 synthetic read\n';

export type A1Phase = 'startup' | 'human' | 'close';
export type A1Reason = 'STARTUP_TIMEOUT' | 'HUMAN_INTERACTION_TIMEOUT' | 'CLOSE_TIMEOUT'
  | 'RENDERER_GONE' | 'SEQUENCE_MISMATCH' | 'NORMAL_CLOSE_INCOMPLETE' | 'PASS';
export interface A1Terminal { result: 'PASS' | 'FAIL'; phase: A1Phase; reason: A1Reason; events: string[] }
interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
const clock: Clock = { now: () => performance.now(), setTimeout, clearTimeout };
const timeoutReason: Record<A1Phase, A1Reason> = {
  startup: 'STARTUP_TIMEOUT', human: 'HUMAN_INTERACTION_TIMEOUT', close: 'CLOSE_TIMEOUT'
};

/** Fixed total phase deadlines. Repeated Ready, reload and progress never renew them. */
export class ControlledAcceptance {
  private events: string[] = [];
  private finished = false;
  private phase: A1Phase = 'startup';
  private deadline: number;
  private timer: ReturnType<typeof setTimeout>;
  constructor(private readonly publish: (result: A1Terminal) => void,
    private readonly fail: () => void = () => undefined, private readonly time: Clock = clock) {
    this.deadline = time.now() + contract.phaseMs.startup;
    this.timer = time.setTimeout(() => this.tick(), contract.phaseMs.startup);
  }
  private enter(phase: A1Phase): void {
    this.time.clearTimeout(this.timer);
    this.phase = phase;
    this.deadline = this.time.now() + contract.phaseMs[phase];
    this.timer = this.time.setTimeout(() => this.tick(), contract.phaseMs[phase]);
  }
  private tick(): void {
    if (!this.expire()) this.timer = this.time.setTimeout(() => this.tick(), Math.max(1, this.deadline - this.time.now()));
  }
  private expire(): boolean {
    if (this.finished) return true;
    if (this.time.now() < this.deadline) return false;
    this.end(timeoutReason[this.phase]);
    return true;
  }
  private end(reason: A1Reason): void {
    if (this.finished) return;
    this.finished = true;
    this.time.clearTimeout(this.timer);
    try { this.publish({ result: reason === 'PASS' ? 'PASS' : 'FAIL', phase: this.phase, reason, events: [...this.events] }); }
    finally { if (reason !== 'PASS') this.fail(); }
  }
  ready(): void {
    if (!this.expire() && this.phase === 'startup') this.enter('human');
  }
  observe(event: string): void {
    if (this.expire()) return;
    const expected = A1_SEQUENCE[this.events.length];
    this.events.push(event);
    if (this.phase !== 'human' || event !== expected) { this.end('SEQUENCE_MISMATCH'); return; }
    if (this.events.length === A1_SEQUENCE.length) this.enter('close');
  }
  display(content: unknown): void {
    if (this.expire()) return;
    if (content !== A1_CONTENT) { this.end('SEQUENCE_MISMATCH'); return; }
    this.observe('display');
  }
  rendererGone(): void { if (!this.expire()) this.end('RENDERER_GONE'); }
  finish(): void {
    if (!this.expire()) this.end(this.phase === 'close' && this.events.length === A1_SEQUENCE.length ? 'PASS' : 'NORMAL_CLOSE_INCOMPLETE');
  }
  dispose(): void { this.time.clearTimeout(this.timer); }
}

export function controlledAcceptance(mode: ControlledStartup, fail: () => void = () => undefined): ControlledAcceptance | undefined {
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
    || request.version !== 1 || request.runId !== contract.runId
    || ![request.candidateSha256, request.environmentSha256, request.nonce].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) {
    throw new Error('Invalid A1 request binding');
  }
  const candidateFile = join(run, 'candidate.json');
  assertControlledPath(candidateFile);
  const candidateBytes = readFileSync(candidateFile);
  const valueCandidate: unknown = JSON.parse(candidateBytes.toString('utf8'));
  if (!valueCandidate || typeof valueCandidate !== 'object') throw new Error('Invalid A1 candidate');
  const candidate = valueCandidate as Record<string, unknown>;
  if (createHash('sha256').update(candidateBytes).digest('hex') !== request.candidateSha256
    || candidate.runId !== contract.runId || candidate.configurationSha256 !== request.environmentSha256
    || JSON.stringify(candidate.contract) !== JSON.stringify(contract)) throw new Error('Invalid A1 candidate contract binding');
  const resultFile = join(mode.appData, 'a1-result.json');
  if (existsSync(resultFile)) throw new Error('A1 result already exists');
  return new ControlledAcceptance(result => {
    const temporary = `${resultFile}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: contract.version, runId: request.runId,
      candidateSha256: request.candidateSha256, nonce: request.nonce,
      requestSha256: createHash('sha256').update(bytes).digest('hex'), ...result }), { flag: 'wx' });
    renameSync(temporary, resultFile);
  }, fail);
}
