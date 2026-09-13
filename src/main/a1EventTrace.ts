import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertControlledPath } from './controlledStartup';

export type A1TraceKind = 'application-start' | 'document-load-request' | 'navigation-start'
  | 'reload-handler-entry' | 'acceptance-event' | 'reload-invocation' | 'navigation-finished'
  | 'ready' | 'window-close' | 'result-publication' | 'renderer-gone';

export interface A1TraceContext {
  documentGeneration?: number;
  sourceDocumentGeneration?: number;
  targetDocumentGeneration?: number;
  reloadActionId?: string;
  acceptanceEvent?: string;
}

export interface A1TraceSink {
  record(kind: A1TraceKind, context?: A1TraceContext): void;
  setDocumentGeneration(generation: number): void;
  currentDocumentGeneration(): number;
}

/** A1-only append-only provenance. It contains no paths, content or environment values. */
export class A1EventTrace implements A1TraceSink {
  readonly path: string;
  private sequence = 0;
  private readonly started: number;
  private generation = 0;
  private writeFailed = false;

  constructor(
    runRoot: string,
    private readonly runId: string,
    private readonly candidateSha256: string,
    private readonly requestSha256: string,
    private readonly now: () => number = () => performance.now()
  ) {
    assertControlledPath(runRoot);
    this.path = join(runRoot, 'a1-event-trace.jsonl');
    this.started = this.now();
  }

  setDocumentGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid A1 document generation');
    this.generation = generation;
  }

  currentDocumentGeneration(): number { return this.generation; }

  record(kind: A1TraceKind, context: A1TraceContext = {}): void {
    const monotonicMs = this.now();
    const documentGeneration = context.documentGeneration ?? this.generation;
    if (!Number.isSafeInteger(documentGeneration) || documentGeneration < 0) {
      this.writeFailed = true;
      return;
    }
    const record: Record<string, unknown> = {
      schemaVersion: 1,
      sequence: ++this.sequence,
      monotonicMs,
      elapsedMs: monotonicMs - this.started,
      runId: this.runId,
      candidateSha256: this.candidateSha256,
      requestSha256: this.requestSha256,
      kind,
      documentGeneration,
      frameIdentity: 'owned-main-frame',
      documentIdentity: 'controlled-read',
      trusted: true
    };
    for (const key of ['sourceDocumentGeneration', 'targetDocumentGeneration', 'reloadActionId', 'acceptanceEvent'] as const) {
      if (context[key] !== undefined) record[key] = context[key];
    }
    try {
      appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
    } catch {
      this.writeFailed = true;
    }
  }

  hasWriteFailure(): boolean { return this.writeFailed; }
}
