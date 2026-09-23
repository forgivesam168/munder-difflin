import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { launchOwnedPty } from './windowsOwnedPty';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import type { ModelRoute } from './modelAccessAuthority';
import type { InertRuntimeDescriptor } from './runtimeAdapter';
import type { OwnedPtyReceipt, OwnedPtyLaunch, OwnedPtyHandle } from './windowsOwnedPty';
import type { Socket } from 'node:net';

/** Preparation utilities, not an OMP launcher or an admission authority. */
export const PROOF_LIMITS = Object.freeze({ bodyBytes: 32768, bodyTopLevelKeys: 64, bodyKeyBytes: 128, headerBytes: 4096,
  requests: 8, streamBytes: 65536, lines: 256, lineBytes: 8192, manifestBytes: 262144, timeoutMs: 5000 });
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SYNTHETIC_PREFIX = 'munder-local-only-';
/** Field names that must never be persisted, even as the key text of an observed request body. */
const SECRET_KEY = /authorization|password|secret|credential|api.?key|access.?token/i;
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
function fail(message: string): never { throw new Error(message); }
function integer(value: unknown, min: number, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('Invalid bounded integer');
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value) || value.includes(SYNTHETIC_PREFIX)) fail('Invalid proof identifier');
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) fail('Invalid SHA256');
}
/** Bounded proof-safe top-level key name. The explicit key-length bound keeps hostile key text out of evidence. */
function bodyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PROOF_LIMITS.bodyKeyBytes
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) && !value.includes(SYNTHETIC_PREFIX) && !SECRET_KEY.test(value);
}
/** Canonically sorted own enumerable top-level keys, or null when any key is unbounded or unobservable.
 * Null means the request fails closed and no key text is retained. Values are never captured.
 * The count and key-length bounds are explicit so hostile key text cannot reach evidence. */
function bodyKeys(value: Record<string, unknown>): readonly string[] | null {
  const keys = Object.keys(value);
  return keys.length > PROOF_LIMITS.bodyTopLevelKeys || !keys.every(bodyKey) ? null : Object.freeze(keys.sort());
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Expected plain proof object');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail('Unexpected proof fields');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('Missing proof data field');
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function snapshot<T>(value: T): T { return freeze(JSON.parse(JSON.stringify(value)) as T); }
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export interface AuthSentinelEvidence { readonly present: boolean; readonly sha256: string | null; readonly matched: boolean }
export interface LocalAuthSentinel {
  /** Ephemeral use only. Never add this value to a descriptor, request capture, or manifest. */
  authorization(): string;
  observe(authorization: string | undefined): AuthSentinelEvidence;
  destroy(): void;
}
export function createLocalAuthSentinel(): LocalAuthSentinel {
  let secret: Buffer | null = Buffer.from(SYNTHETIC_PREFIX + randomBytes(24).toString('hex'));
  return Object.freeze({
    authorization() { if (!secret) fail('Sentinel destroyed'); return `Bearer ${secret.toString('ascii')}`; },
    observe(authorization: string | undefined) {
      if (!secret) fail('Sentinel destroyed');
      const expected = Buffer.concat([Buffer.from('Bearer '), secret]);
      const supplied = Buffer.from(authorization ?? '', 'utf8');
      try {
        const matched = supplied.length === expected.length && timingSafeEqual(supplied, expected);
        // Persist only the synthetic match, never a rejected credential's hash or bytes.
        return Object.freeze({ present: supplied.length > 0, sha256: matched ? sha(supplied) : null, matched });
      } finally { expected.fill(0); supplied.fill(0); }
    },
    destroy() { secret?.fill(0); secret = null; }
  });
}
export const RESPONSE_FIXTURES = Object.freeze(['STREAMING_SUCCESS', 'NON_STREAMING_SUCCESS', 'HTTP_ERROR',
  'MALFORMED_RESPONSE', 'PREMATURE_EOF', 'INCOMPLETE_COMPLETION'] as const);
export type ResponseFixture = typeof RESPONSE_FIXTURES[number];
export interface RequestEvidence {
  readonly order: number; readonly method: string; readonly path: string; readonly bodyBytes: number;
  /** Exact Content-Type string that passed request validation; validation rejects every other value. */
  readonly contentType: string;
  /** Hash of the bounded raw request body bytes, computed before any decoding or semantic parsing. */
  readonly bodySha256: string;
  /** Sorted own enumerable top-level keys of a valid top-level JSON object; empty otherwise. Never values. */
  readonly topLevelKeys: readonly string[];
  /** True only when an own `stream` property was observed on a valid top-level object. */
  readonly streamPresent: boolean;
  /** Boolean `stream` value; null when absent or when a present value was not a boolean. */
  readonly streamValue: boolean | null;
  /** 'VALID' only for a top-level JSON object with a bounded key set and an exact `model` identifier;
   * every other body — malformed JSON, non-object, unbounded key set, absent/invalid model — is 'INVALID'
   * and retains no key text or model. */
  readonly json: 'VALID' | 'INVALID'; readonly model: string | null; readonly auth: AuthSentinelEvidence;
  readonly accepted: boolean;
}
export interface ResponseEvidence {
  readonly order: number; readonly httpStatus: number; readonly contentType: string;
  readonly generatedBytes: number; readonly generatedSha256: string;
  /** Body bytes handed to the local socket, not peer receipt. ABORTED is unknown (null), never fabricated zero. */
  readonly emittedBytes: number | null; readonly emittedSha256: string | null;
  readonly transport: 'COMPLETE' | 'PREMATURE_EOF' | 'ABORTED';
  readonly streaming: boolean; readonly parseValid: boolean;
  readonly terminalType: 'response.completed' | 'response.incomplete' | null;
}
// Identity proves local issuance only. Read-only evidence is reusable, never consumed;
// serialization deliberately loses provenance. No runtime admission is granted.
const serverIssuers = new WeakMap<object, object>();
const issuedSnapshots = new WeakMap<object, object>();
function requireServerEvidence(value: FakeServerSnapshot, issuer: FakeResponsesServer): void {
  const owner = serverIssuers.get(issuer);
  if (!owner || issuedSnapshots.get(value) !== owner) fail('Server issuer binding mismatch');
}
export interface FakeServerSnapshot {
  readonly origin: string; readonly fixture: ResponseFixture; readonly listening: boolean;
  readonly closed: boolean; readonly overflow: boolean; readonly rejected: number;
  readonly requests: readonly RequestEvidence[];
  /** Consistency digest over the exact capture array; a substituted field changes it. Not a secret. */
  readonly requestsSha256: string;
  readonly responses: readonly ResponseEvidence[];
  readonly responsesSha256: string;
}
export interface FakeResponsesServer {
  readonly origin: string;
  snapshot(): FakeServerSnapshot;
  close(): Promise<FakeServerSnapshot>;
}
// These handcrafted transport fixtures make no claim about real OMP fixture selection or completion conformance.
function responseFixture(fixture: ResponseFixture): { status: number; contentType: string; bytes: Buffer; truncate: boolean } {
  const complete = { id: 'resp_fixture', object: 'response', status: 'completed',
    output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'provider-free fixture result', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const streaming = fixture === 'STREAMING_SUCCESS' || fixture === 'INCOMPLETE_COMPLETION';
  const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const terminal = fixture === 'INCOMPLETE_COMPLETION' ? 'response.incomplete' : 'response.completed';
  const body = fixture === 'HTTP_ERROR' ? '{"error":{"type":"fixture_error","message":"deterministic failure"}}'
    : fixture === 'MALFORMED_RESPONSE' ? '{not-json'
    : !streaming ? JSON.stringify(complete)
    : frame('response.created', { type: 'response.created', sequence_number: 0,
      response: { ...complete, status: 'in_progress', output: [] } })
      + frame('response.output_text.delta', { type: 'response.output_text.delta', sequence_number: 1,
        item_id: 'msg_fixture', output_index: 0, content_index: 0, delta: 'provider-free fixture result' })
      + frame(terminal, { type: terminal, sequence_number: 2, response: terminal === 'response.completed' ? complete
        : { ...complete, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } });
  return { status: fixture === 'HTTP_ERROR' ? 503 : 200,
    contentType: streaming ? 'text/event-stream' : 'application/json', bytes: Buffer.from(body), truncate: fixture === 'PREMATURE_EOF' };
}
function parseResponse(bytes: Buffer, streaming: boolean): Pick<ResponseEvidence, 'parseValid' | 'terminalType'> {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!streaming) {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response object');
      return { parseValid: true, terminalType: value.object === 'response' && value.status === 'completed' ? 'response.completed'
        : value.object === 'response' && value.status === 'incomplete' ? 'response.incomplete' : null };
    }
    if (!text.endsWith('\n\n')) throw new Error('Unterminated SSE');
    let terminalType: ResponseEvidence['terminalType'] = null;
    for (const frame of text.slice(0, -2).split('\n\n')) {
      const lines = frame.split('\n');
      if (lines.length !== 2 || !lines[0].startsWith('event: ') || !lines[1].startsWith('data: ') || terminalType)
        throw new Error('Invalid SSE frame');
      const type = lines[0].slice(7), value = JSON.parse(lines[1].slice(6));
      if (!value || value.type !== type) throw new Error('SSE type mismatch');
      if (type === 'response.completed' || type === 'response.incomplete') {
        if (value.response?.object !== 'response' || value.response.status !== (type === 'response.completed' ? 'completed' : 'incomplete'))
          throw new Error('SSE status mismatch');
        terminalType = type;
      }
    }
    return { parseValid: true, terminalType };
  } catch { return { parseValid: false, terminalType: null }; }
}
/** Reusable issuer-local observation, not admission. Multiple responses fail closed for completion. */
export function responseCompletionFacts(value: FakeServerSnapshot, issuer: FakeResponsesServer):
  Pick<CompletionInput, 'httpStatus' | 'transportEnded' | 'responseValid' | 'explicitCompleted' | 'explicitIncomplete'> {
  requireServerEvidence(value, issuer);
  const response = value.responses.length === 1 && value.requests.filter(request => request.accepted).length === 1
    ? value.responses[0] : undefined;
  return { httpStatus: response?.httpStatus ?? null, transportEnded: response?.transport === 'COMPLETE',
    responseValid: response?.parseValid ?? false,
    explicitCompleted: response?.terminalType === 'response.completed',
    explicitIncomplete: response?.terminalType === 'response.incomplete' };
}
export async function startFakeResponsesServer(sentinel: LocalAuthSentinel, fixture: ResponseFixture,
  port = 0): Promise<FakeResponsesServer> {
  if (!(RESPONSE_FIXTURES as readonly string[]).includes(fixture)) fail('Unknown response fixture');
  integer(port, 0, 65535);
  const captures: RequestEvidence[] = [];
  const responses: ResponseEvidence[] = [], issuer = {};
  let count = 0, rejected = 0, overflow = false, closed = false;
  let closing: Promise<FakeServerSnapshot> | undefined;
  const sockets = new Set<Socket>();
  const reject = (response: ServerResponse, status: number) => {
    const socket = response.socket;
    response.once('finish', () => socket?.destroy());
    rejected++; response.writeHead(status, { connection: 'close' }); response.end();
  };
  const server: Server = createServer({ maxHeaderSize: PROOF_LIMITS.headerBytes }, (request: IncomingMessage, response: ServerResponse) => {
    const order = ++count;
    if (count > PROOF_LIMITS.requests) { overflow = true; reject(response, 429); request.resume(); return; }
    if (request.method !== 'POST' || request.url !== '/v1/responses') { reject(response, 404); request.resume(); return; }
    if (request.rawHeaders.length > 64 || request.headers['content-type'] !== 'application/json'
      || request.headers['content-encoding'] !== undefined || request.headers.authorization === undefined
      || request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === 'authorization').length !== 1) {
      reject(response, 400); request.resume(); return;
    }
    let auth: AuthSentinelEvidence;
    try { auth = sentinel.observe(request.headers.authorization); } catch { reject(response, 401); request.resume(); return; }
    if (!auth.matched) { reject(response, 401); request.resume(); return; }
    let size = 0, exceeded = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > PROOF_LIMITS.bodyBytes) { exceeded = true; chunks.length = 0;
        if (!response.headersSent) reject(response, 413); request.pause(); return; }
      if (!exceeded) chunks.push(chunk);
    });
    request.on('error', () => { if (!response.headersSent) reject(response, 400); });
    request.on('end', () => {
      if (exceeded) return;
      // Hash the exact bounded raw bytes before any decoding or semantic interpretation.
      const raw = Buffer.concat(chunks), bodySha256 = sha(raw);
      let model: string | null = null, valid = false, topLevelKeys: readonly string[] = [];
      let streamPresent = false, streamValue: boolean | null = null;
      try {
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const object = parsed as Record<string, unknown>;
          // A body whose top-level key set is unboundable is not admissible request-shape evidence.
          const keys = bodyKeys(object);
          if (keys !== null) {
            const candidate = object.model;
            identifier(candidate);
            topLevelKeys = keys; model = candidate; valid = true;
            // Absent, boolean and non-boolean `stream` are three distinct observed facts; never coerced.
            const stream = object.stream;
            streamPresent = Object.hasOwn(object, 'stream');
            streamValue = streamPresent && typeof stream === 'boolean' ? stream : null;
          }
        }
      } catch { /* Invalid body is deliberately never retained. */ }
      // A bounded valid object with an exact model and an absent-or-boolean stream is accepted.
      const accepted = valid && model !== null && (!streamPresent || streamValue !== null);
      captures.push(Object.freeze({ order, method: 'POST', path: '/v1/responses', bodyBytes: size,
        contentType: request.headers['content-type'] as string, bodySha256, topLevelKeys, streamPresent, streamValue,
        json: valid ? 'VALID' : 'INVALID', model, auth, accepted }));
      captures.sort((left, right) => left.order - right.order);
      if (!accepted) { reject(response, 400); return; }
      // Buffers are private, never mutated or exposed; emitted bytes are exactly this prefix.
      const generated = responseFixture(fixture), bytes = generated.bytes;
      const emitted = generated.truncate ? bytes.subarray(0, 29) : bytes;
      let settled = false;
      const record = (transport: ResponseEvidence['transport'], written: Buffer) => {
        if (settled) return;
        settled = true;
        const streaming = generated.contentType === 'text/event-stream';
        responses.push(freeze({ order, httpStatus: generated.status, contentType: generated.contentType,
          generatedBytes: bytes.length, generatedSha256: sha(bytes),
          emittedBytes: transport === 'ABORTED' ? null : written.length,
          emittedSha256: transport === 'ABORTED' ? null : sha(written),
          transport, streaming, ...parseResponse(written, streaming) }));
        responses.sort((left, right) => left.order - right.order);
      };
      response.once('close', () => record('ABORTED', Buffer.alloc(0)));
      response.once('error', () => record('ABORTED', Buffer.alloc(0)));
      response.writeHead(generated.status, { 'content-type': generated.contentType, 'content-length': bytes.length });
      if (generated.truncate) {
        response.write(emitted, error => {
          record(error ? 'ABORTED' : 'PREMATURE_EOF', error ? Buffer.alloc(0) : emitted);
          response.socket?.end();
        });
      } else {
        response.once('finish', () => record('COMPLETE', emitted));
        response.end(emitted);
      }
    });
  });
  server.maxHeadersCount = 32;
  server.requestTimeout = PROOF_LIMITS.timeoutMs;
  server.headersTimeout = PROOF_LIMITS.timeoutMs;
  server.timeout = PROOF_LIMITS.timeoutMs;
  server.on('timeout', socket => socket.destroy());
  server.on('connection', socket => {
    if (sockets.size >= PROOF_LIMITS.requests) { socket.destroy(); return; }
    sockets.add(socket);
    const deadline = setTimeout(() => socket.destroy(), PROOF_LIMITS.timeoutMs);
    socket.on('close', () => { clearTimeout(deadline); sockets.delete(socket); });
  });
  server.on('clientError', (_error, socket) => { rejected++; socket.destroy(); });
  try {
    await new Promise<void>((accept, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', rejectListen); accept(); });
    });
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(accept => server.close(() => accept()));
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close(); for (const socket of sockets) socket.destroy(); fail('Non-loopback listener refused');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const take = (): FakeServerSnapshot => {
    const value = snapshot({ origin, fixture, listening: server.listening, closed, overflow,
      rejected, requests: captures, requestsSha256: sha(JSON.stringify(captures)),
      responses, responsesSha256: sha(JSON.stringify(responses)) });
    issuedSnapshots.set(value, issuer);
    return value;
  };
  const handle: FakeResponsesServer = Object.freeze({ origin, snapshot: take, close() {
    if (!closing) closing = new Promise<FakeServerSnapshot>((accept, rejectClose) => {
      server.close(error => { if (error) { rejectClose(error); return; } closed = true; accept(take()); });
      for (const socket of sockets) socket.destroy();
    });
    return closing;
  } });
  serverIssuers.set(handle, issuer);
  return handle;
}

export type ActualModelIdentity = 'ACTUAL_MODEL_IDENTITY_MATCH' | 'ACTUAL_MODEL_IDENTITY_MISMATCH' | 'ACTUAL_MODEL_IDENTITY_NOT_OBSERVED';
export interface ModelIdentityEvidence {
  readonly routeModel: string; readonly modelsFileModel: string; readonly argvModel: string;
  readonly requestModels: readonly string[]; readonly classification: ActualModelIdentity;
}
export function compareActualModelIdentity(route: ModelRoute, adapter: InertRuntimeDescriptor,
  requests: readonly RequestEvidence[]): ModelIdentityEvidence {
  identifier(route.model);
  if (adapter.adapterId !== 'omp' || !adapter.config.isolation || !adapter.args) fail('OMP inert descriptor required');
  const models = JSON.parse(adapter.config.isolation.modelsYaml);
  exact(models, ['providers']); exact(models.providers, ['cliproxyapi']);
  exact(models.providers.cliproxyapi, ['baseUrl', 'api', 'models']);
  if (models.providers.cliproxyapi.api !== 'openai-responses' || !Array.isArray(models.providers.cliproxyapi.models)
    || models.providers.cliproxyapi.models.length !== 1) fail('Noncanonical models.yml');
  exact(models.providers.cliproxyapi.models[0], ['id']);
  const modelsFileModel = models.providers.cliproxyapi.models[0].id;
  identifier(modelsFileModel);
  const indices = adapter.args.flatMap((value, index) => value === '--model' ? [index] : []);
  if (indices.length !== 1 || adapter.args.some(value => value.startsWith('--model='))) fail('Ambiguous argv model');
  const argvModel = adapter.args[indices[0] + 1]; identifier(argvModel);
  if (requests.length > PROOF_LIMITS.requests) fail('Too many request observations');
  const requestModels = requests.filter(request => request.accepted && request.model !== null).map(request => request.model!);
  requestModels.forEach(identifier);
  const preparationMatches = route.model === adapter.model && route.model === modelsFileModel
    && argvModel === `cliproxyapi/${route.model}`;
  const classification: ActualModelIdentity = !preparationMatches ? 'ACTUAL_MODEL_IDENTITY_MISMATCH' : requestModels.length === 0
    ? 'ACTUAL_MODEL_IDENTITY_NOT_OBSERVED' : requestModels.every(model => model === route.model) ? 'ACTUAL_MODEL_IDENTITY_MATCH' : 'ACTUAL_MODEL_IDENTITY_MISMATCH';
  return snapshot({ routeModel: route.model, modelsFileModel, argvModel, requestModels, classification });
}

export interface NdjsonLineEvidence {
  readonly number: number; readonly order: number; readonly bytes: number; readonly sha256: string;
  readonly terminated: boolean; readonly json: 'VALID' | 'INVALID'; readonly topLevelKeys: readonly string[];
  readonly event: string | null; readonly type: string | null;
}
export interface NdjsonEvidence {
  readonly bytes: number; readonly sha256: string; readonly lines: readonly NdjsonLineEvidence[];
  readonly historical: 'MATCH' | 'MISMATCH' | 'NOT_APPLICABLE';
}
/** All bytes (including newline and invalid UTF-8) are hashed before interpreting a line.
 * This observer is deliberately not createOmpFixtureCompletionRecognizer. */
export function observeNdjson(bytes: Buffer, historicalSequence?: readonly string[]): NdjsonEvidence {
  if (!Buffer.isBuffer(bytes) || bytes.length > PROOF_LIMITS.streamBytes) fail('NDJSON byte bound exceeded');
  if (historicalSequence && historicalSequence.length > PROOF_LIMITS.lines) fail('Historical sequence bound exceeded');
  historicalSequence?.forEach(identifier);
  const lines: NdjsonLineEvidence[] = [];
  let start = 0;
  while (start < bytes.length) {
    if (lines.length === PROOF_LIMITS.lines) fail('NDJSON line bound exceeded');
    const newline = bytes.indexOf(10, start), end = newline < 0 ? bytes.length : newline + 1;
    const raw = bytes.subarray(start, end);
    if (raw.length > PROOF_LIMITS.lineBytes) fail('NDJSON line byte bound exceeded');
    const base = { number: lines.length + 1, order: lines.length + 1, bytes: raw.length,
      sha256: sha(raw), terminated: newline >= 0 };
    let valid = false, topLevelKeys: string[] = [], event: string | null = null, type: string | null = null;
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      valid = true;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value);
        if (keys.length > 64 || keys.some(key => !ID.test(key) || key.includes(SYNTHETIC_PREFIX)
          || SECRET_KEY.test(key))) fail('Unsafe NDJSON keys');
        topLevelKeys = keys;
        const candidate = (key: string): string | null => {
          const field = (value as Record<string, unknown>)[key];
          return typeof field === 'string' && ID.test(field) && !field.includes(SYNTHETIC_PREFIX) ? field : null;
        };
        event = candidate('event'); type = candidate('type');
      }
    } catch { valid = false; topLevelKeys = []; event = null; type = null; }
    lines.push({ ...base, json: valid ? 'VALID' : 'INVALID', topLevelKeys, event, type }); start = end;
  }
  const historical = historicalSequence === undefined ? 'NOT_APPLICABLE'
    : lines.every(line => line.json === 'VALID' && line.terminated)
      && equal(lines.map(line => line.type ?? line.event), historicalSequence) ? 'MATCH' : 'MISMATCH';
  return snapshot({ bytes: bytes.length, sha256: sha(bytes), lines, historical });
}

export type CompletionOutcome = 'COMPLETION_PROVEN' | 'COMPLETION_NOT_PROVEN' | 'EVENT_SCHEMA_MISMATCH'
  | 'PROCESS_EXIT_WITHOUT_TERMINAL_EVENT' | 'HTTP_COMPLETED_BUT_AGENT_COMPLETION_UNKNOWN' | 'SILENT_ABORT_OBSERVED';
export interface CompletionInput {
  readonly exitCode: number | null; readonly timedOut: boolean; readonly httpStatus: number | null;
  readonly transportEnded: boolean; readonly responseValid: boolean; readonly explicitCompleted: boolean;
  readonly usefulOutput: boolean; readonly explicitIncomplete: boolean;
}
export function classifyCompletion(input: CompletionInput): CompletionOutcome {
  exact(input, ['exitCode', 'timedOut', 'httpStatus', 'transportEnded', 'responseValid', 'explicitCompleted', 'usefulOutput', 'explicitIncomplete']);
  if (input.exitCode !== null) integer(input.exitCode, -2147483648, 2147483647);
  if (input.httpStatus !== null) integer(input.httpStatus, 100, 599);
  for (const key of ['timedOut', 'transportEnded', 'responseValid', 'explicitCompleted', 'usefulOutput', 'explicitIncomplete'] as const)
    if (typeof input[key] !== 'boolean') fail('Invalid completion fact');
  if (input.timedOut || (input.exitCode !== null && input.exitCode !== 0)) return 'SILENT_ABORT_OBSERVED';
  if (!input.responseValid && input.httpStatus !== null && input.transportEnded) return 'EVENT_SCHEMA_MISMATCH';
  if (input.httpStatus === null) return input.exitCode !== null ? 'PROCESS_EXIT_WITHOUT_TERMINAL_EVENT' : 'COMPLETION_NOT_PROVEN';
  if (input.httpStatus < 200 || input.httpStatus >= 300 || !input.transportEnded || input.explicitIncomplete) return 'COMPLETION_NOT_PROVEN';
  if (!input.explicitCompleted) return 'HTTP_COMPLETED_BUT_AGENT_COMPLETION_UNKNOWN';
  return input.exitCode === 0 && input.usefulOutput ? 'COMPLETION_PROVEN' : 'COMPLETION_NOT_PROVEN';
}

export interface ByteEvidence { readonly bytes: number; readonly sha256: string; readonly base64: string }
export interface ProcessOrderEvidence { readonly order: number; readonly elapsedMs: number;
  readonly kind: 'STARTED' | 'STDIN_WRITTEN' | 'STDIN_CLOSED' | 'STDOUT' | 'STDERR' | 'EXIT' | 'CLOSE' | 'TIMEOUT' | 'ERROR' }
export interface RawProcessEvidence {
  readonly kind: 'REPOSITORY_FAKE_CHILD_ONLY'; readonly pid: number | null;
  readonly stdin: ByteEvidence; readonly stdinClosed: boolean; readonly stdout: ByteEvidence; readonly stderr: ByteEvidence;
  readonly exitCode: number | null; readonly signal: string | null; readonly timedOut: boolean;
  readonly overflow: boolean; readonly closed: boolean; readonly events: readonly ProcessOrderEvidence[];
  readonly jobReceipt: OwnedPtyReceipt; readonly jobBinding: 'SAME_OWNED_LAUNCH';
}
function byteEvidence(bytes: Buffer): ByteEvidence { return { bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') }; }
export type FakeChildMode = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'OVERFLOW';
/** Only the repository Node fixture can launch. The actual Job owner supplies all bytes and its receipt. */
export async function runRepositoryFakeChild(mode: FakeChildMode,
  backend: Pick<OwnedPtyLaunch, 'helperPath' | 'helperSha256' | 'scriptPath' | 'scriptSha256'
    | 'nativeSourcePath' | 'nativeSourceSha256' | 'helperEnv' | 'executableSha256'>,
  timeoutMs = 1000): Promise<RawProcessEvidence> {
  if (!['SUCCESS', 'FAILURE', 'TIMEOUT', 'OVERFLOW'].includes(mode)) fail('Unknown fake child mode');
  integer(timeoutMs, 100, PROOF_LIMITS.timeoutMs);
  exact(backend, ['helperPath', 'helperSha256', 'scriptPath', 'scriptSha256', 'nativeSourcePath', 'nativeSourceSha256', 'helperEnv', 'executableSha256']);
  if (basename(process.execPath).toLowerCase() !== 'node.exe'
    || basename(backend.helperPath).toLowerCase() !== 'pwsh.exe') fail('Provider-free fixture requires Node and PowerShell only');
  if (resolve(backend.scriptPath) !== resolve(__dirname, 'windowsOwnedPty.ps1')
    || resolve(backend.nativeSourcePath) !== resolve(__dirname, 'windowsOwnedPty.cs')) fail('Repository owner substitution');
  // Node's Windows crypto initialization needs SystemRoot; never inherit the helper or ambient environment.
  const systemRoot = backend.helperEnv.SystemRoot;
  if (typeof systemRoot !== 'string' || !systemRoot.trim() || systemRoot.length > 32767 || systemRoot.includes('\0'))
    fail('Repository Node fixture requires bounded SystemRoot');
  const fixture = resolve(__dirname, '../../test/fixtures/omp-proof-raw-child.cjs');
  const input = Buffer.from([0, 255, 13, 10, 65]);
  const start = process.hrtime.bigint(), events: ProcessOrderEvidence[] = [];
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let stdoutBytes = 0, stderrBytes = 0, overflow = false, stdinWritten = false;
  const event = (kind: ProcessOrderEvidence['kind']) => {
    if (events.length >= 1020 && !['EXIT', 'CLOSE', 'TIMEOUT', 'STDIN_CLOSED'].includes(kind)) { overflow = true; owner.stop(); return; }
    events.push({ order: events.length + 1, elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, kind });
  };
  const owner: OwnedPtyHandle = launchOwnedPty({ ...backend, executablePath: process.execPath,
    args: [fixture, mode], cwd: resolve(__dirname, '../..'), env: { SystemRoot: systemRoot }, securityContext: 'CURRENT_PROCESS',
    ioMode: 'RAW_PIPE', cols: 80, rows: 24, timeoutMs, cleanupMs: 2000 }, {
    onData() { /* Raw callbacks, not decoded text, are evidence. */ },
    onStarted() { event('STARTED'); owner.input(input); owner.closeInput(); },
    onInput(kind) { if (kind === 'written') { stdinWritten = true; event('STDIN_WRITTEN'); } else event('STDIN_CLOSED'); },
    onRawData(stream, bytes) {
      if (stream === 'conpty') fail('Merged stream cannot prove raw evidence');
      event(stream === 'stdout' ? 'STDOUT' : 'STDERR');
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const keep = bytes.subarray(0, Math.max(0, PROOF_LIMITS.streamBytes - used));
      if (keep.length) (stream === 'stdout' ? stdout : stderr).push(Buffer.from(keep));
      if (stream === 'stdout') stdoutBytes += keep.length; else stderrBytes += keep.length;
      if (keep.length !== bytes.length) { overflow = true; owner.stop(); }
    },
    onExit() { /* completion resolves the same native receipt after drains. */ }
  });
  const nativeReceipt = await owner.completion;
  const jobReceipt: OwnedPtyReceipt = nativeReceipt.error === undefined ? nativeReceipt
    : { ...nativeReceipt, error: 'OWNED_HELPER_ERROR_REDACTED' };
  if (jobReceipt.reason === 'timeout') event('TIMEOUT');
  // EXIT/CLOSE/TIMEOUT below are receipt observations, not native timestamps.
  event('EXIT');
  if (jobReceipt.ioDrained && jobReceipt.cleanupState === 'VERIFIED_EMPTY') event('CLOSE');
  const result: RawProcessEvidence = snapshot({ kind: 'REPOSITORY_FAKE_CHILD_ONLY', pid: jobReceipt.rootPid,
    stdin: byteEvidence(stdinWritten ? input : Buffer.alloc(0)), stdinClosed: jobReceipt.inputClosed === true,
    stdout: byteEvidence(Buffer.concat(stdout)), stderr: byteEvidence(Buffer.concat(stderr)),
    exitCode: jobReceipt.rootExit, signal: null, timedOut: jobReceipt.reason === 'timeout', overflow,
    closed: jobReceipt.ioDrained && jobReceipt.cleanupState === 'VERIFIED_EMPTY', events,
    jobReceipt, jobBinding: 'SAME_OWNED_LAUNCH' });
  ownedEvidence.add(result);
  return result;
}
const ownedEvidence = new WeakSet<object>();
const RECEIPT_REQUIRED = ['securityContext', 'restrictedTokenVerified', 'childTokenVerified', 'rootPid', 'rootExit',
  'rootJobMember', 'activeProcessesFinal', 'cleanupState', 'ioDrained', 'pseudoConsoleClosed', 'reason'];
function validateReceipt(receipt: OwnedPtyReceipt): void {
  const optional = ['ioMode', 'inputClosed', 'error'];
  exact(receipt, [...RECEIPT_REQUIRED, ...optional.filter(key => Object.hasOwn(receipt, key))]);
  if (!['CURRENT_PROCESS', 'RESTRICTED_LOW'].includes(receipt.securityContext)
    || !['VERIFIED_EMPTY', 'UNVERIFIED'].includes(receipt.cleanupState)
    || !['exit', 'stop', 'timeout', 'helper-failure', 'launch-failure'].includes(receipt.reason)) fail('Invalid owned receipt');
  for (const key of ['restrictedTokenVerified', 'childTokenVerified', 'rootJobMember', 'ioDrained', 'pseudoConsoleClosed'] as const)
    if (typeof receipt[key] !== 'boolean') fail('Invalid owned receipt boolean');
  if (receipt.rootPid !== null) integer(receipt.rootPid, 1, 2147483647);
  if (receipt.rootExit !== null) integer(receipt.rootExit, -2147483648, 2147483647);
  if (receipt.activeProcessesFinal !== null) integer(receipt.activeProcessesFinal, 0, 2147483647);
  if (receipt.ioMode !== undefined && !['CONPTY', 'RAW_PIPE'].includes(receipt.ioMode)) fail('Invalid receipt IO');
  if (receipt.inputClosed !== undefined && typeof receipt.inputClosed !== 'boolean') fail('Invalid receipt EOF');
  // Arbitrary helper error text can contain secret material. Only bounded symbolic errors enter this evidence layer.
  if (receipt.error !== undefined) identifier(receipt.error);
}

export const PROOF_STATES = Object.freeze(['PREPARED', 'NETWORK_BOUNDARY_VERIFIED', 'FAKE_SERVER_READY',
  'ATTEMPT_RESERVED', 'ADMISSION_CREATED', 'OMP_STARTED', 'OMP_COMPLETED_OR_FAILED', 'EVIDENCE_FROZEN', 'CLEANUP_VERIFIED'] as const);
export type ProofState = typeof PROOF_STATES[number];
export interface ProofTransition { readonly state: ProofState; readonly order: number; readonly bindingSha256: string; readonly evidenceSha256: string }
export interface ProofStateSnapshot { readonly mode: 'PROVIDER_FREE_SIMULATION_ONLY'; readonly bindingSha256: string;
  readonly state: ProofState; readonly transitions: readonly ProofTransition[] }
export interface ProofTransitionTicket { readonly next: ProofState }
/** State names model a future run. They do not create a durable attempt or an admission.
 * Tickets are object-identity capabilities and can be consumed once, by their issuing machine only. */
export class OneShotProofStateMachine {
  private readonly binding: string;
  private readonly history: ProofTransition[];
  private readonly tickets = new WeakSet<object>();
  private outstanding: ProofTransitionTicket | null = null;
  constructor(bindingSha256: string, preparedEvidenceSha256: string) {
    digest(bindingSha256); digest(preparedEvidenceSha256); this.binding = bindingSha256;
    this.history = [{ state: 'PREPARED', order: 1, bindingSha256, evidenceSha256: preparedEvidenceSha256 }];
  }
  prepare(next: ProofState): ProofTransitionTicket {
    if (this.outstanding || this.history.length >= PROOF_STATES.length || PROOF_STATES[this.history.length] !== next) fail('Invalid one-shot transition');
    const ticket = Object.freeze({ next }); this.tickets.add(ticket); this.outstanding = ticket; return ticket;
  }
  advance(ticket: ProofTransitionTicket, bindingSha256: string, evidenceSha256: string): ProofStateSnapshot {
    digest(evidenceSha256);
    if (!this.tickets.has(ticket) || this.outstanding !== ticket || bindingSha256 !== this.binding
      || PROOF_STATES[this.history.length] !== ticket.next) fail('Replay or substitution refused');
    this.tickets.delete(ticket); this.outstanding = null;
    this.history.push({ state: ticket.next, order: this.history.length + 1, bindingSha256, evidenceSha256 });
    return this.snapshot();
  }
  snapshot(): ProofStateSnapshot {
    return snapshot({ mode: 'PROVIDER_FREE_SIMULATION_ONLY', bindingSha256: this.binding,
      state: this.history[this.history.length - 1].state, transitions: this.history });
  }
}

export interface BinaryIdentity {
  readonly path: string; readonly bytes: number; readonly sha256: string;
  readonly expected: 'MATCH' | 'MISMATCH' | 'NOT_SUPPLIED';
  readonly semanticVersion: string | null; readonly versionSource: 'HISTORICAL' | 'INDEPENDENTLY_SUPPLIED' | 'UNKNOWN';
}
/** Reads a supplied path only. Never executes the binary or infers a semantic version from PE metadata. */
export async function inspectOmpBinaryIdentity(path: string,
  options: { expectedBytes?: number; expectedSha256?: string; semanticVersion?: string;
    versionSource?: 'HISTORICAL' | 'INDEPENDENTLY_SUPPLIED' } = {}): Promise<BinaryIdentity> {
  if (typeof path !== 'string' || !path || path.length > 1024) fail('Invalid binary path');
  exact(options, ['expectedBytes', 'expectedSha256', 'semanticVersion', 'versionSource'].filter(key => Object.hasOwn(options, key)));
  if ((options.expectedBytes === undefined) !== (options.expectedSha256 === undefined)) fail('Incomplete expected binary identity');
  if (options.expectedBytes !== undefined) integer(options.expectedBytes, 1, 512 * 1024 * 1024);
  if (options.expectedSha256 !== undefined) digest(options.expectedSha256);
  if ((options.semanticVersion === undefined) !== (options.versionSource === undefined)) fail('Unattributed semantic version');
  if (options.semanticVersion !== undefined && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(options.semanticVersion)) fail('Invalid semantic version');
  if (options.versionSource !== undefined && !['HISTORICAL', 'INDEPENDENTLY_SUPPLIED'].includes(options.versionSource)) fail('Invalid version source');
  const canonical = await realpath(path);
  const file = await open(canonical, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile()) fail('Binary is not a regular file');
    integer(before.size, 1, 512 * 1024 * 1024);
    const hash = createHash('sha256'), chunk = Buffer.alloc(65536);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, before.size - position), position);
      if (!bytesRead) fail('Binary changed during inspection');
      hash.update(chunk.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await file.stat();
    const named = await stat(canonical);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || after.ino !== before.ino || named.ino !== after.ino || named.dev !== after.dev
      || named.size !== after.size || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs
      || await realpath(path) !== canonical) fail('Binary changed during inspection');
    const sha256 = hash.digest('hex');
    return snapshot({ path: canonical, bytes: before.size, sha256,
      expected: options.expectedBytes === undefined ? 'NOT_SUPPLIED'
        : options.expectedBytes === before.size && options.expectedSha256 === sha256 ? 'MATCH' : 'MISMATCH',
      semanticVersion: options.semanticVersion ?? null, versionSource: options.versionSource ?? 'UNKNOWN' });
  } finally { await file.close(); }
}

export interface ProofManifest {
  readonly schema: 'OMP_FIRST_PROOF_PROVIDER_FREE_V1';
  readonly mode: 'PROVIDER_FREE_SIMULATION_ONLY';
  readonly candidateId: string; readonly checkpoint: string; readonly taskSha256: string;
  readonly configSha256: string; readonly environmentSha256: string;
  readonly preparation: {
    readonly core: { readonly taskId: string; readonly runId: string; readonly workerId: string; readonly repositoryId: string; readonly treeSha: string };
    readonly adapter: { readonly id: 'omp'; readonly version: '18.2.7'; readonly thinking: string };
    readonly semanticVersionDisposition: { readonly value: '18.2.7'; readonly provenance: 'HISTORICAL_NOT_EXECUTED' };
    readonly endpoint: string; readonly trust: 'LOCAL_LOOPBACK'; readonly cwd: string;
    readonly environment: Readonly<Record<'HOME' | 'USERPROFILE' | 'PI_CODING_AGENT_DIR' | 'PI_CONFIG_DIR' | 'TEMP' | 'TMP', string>>;
    readonly modelsFile: { readonly path: string; readonly content: string; readonly bytes: number; readonly sha256: string; readonly model: string };
    readonly auth: { readonly present: true; readonly sha256: string };
    readonly listener: { readonly host: '127.0.0.1'; readonly port: number; readonly fixture: ResponseFixture; readonly bounds: typeof PROOF_LIMITS };
    readonly wfp: { readonly status: 'PENDING_NOT_EXECUTED'; readonly ref: string; readonly sha256: string };
    readonly durableReservation: { readonly status: 'FUTURE_NOT_CREATED'; readonly path: string; readonly sha256: string; readonly id: string };
    readonly admissionRef: { readonly status: 'FUTURE_NOT_CREATED'; readonly ref: string; readonly sha256: string; readonly id: string };
    readonly historicalSequence: readonly string[] | null;
  };
  readonly route: { readonly model: string; readonly scopeDigest: string; readonly evidenceId: string };
  readonly argv: readonly string[]; readonly binary: BinaryIdentity;
  readonly boundary: { readonly kind: 'TEST_LOOPBACK_ONLY'; readonly origin: string; readonly evidenceSha256: string };
  readonly reservation: { readonly kind: 'IN_MEMORY_SIMULATION'; readonly id: string; readonly bindingSha256: string };
  readonly admission: { readonly kind: 'IN_MEMORY_SIMULATION'; readonly id: string; readonly bindingSha256: string };
  readonly bindingSha256: string; readonly server: FakeServerSnapshot;
  readonly modelIdentity: ModelIdentityEvidence; readonly process: RawProcessEvidence;
  readonly ndjson: NdjsonEvidence; readonly completionInput: CompletionInput; readonly completion: CompletionOutcome;
  readonly states: ProofStateSnapshot;
  readonly cleanup: { readonly listenerClosed: boolean; readonly childClosed: boolean; readonly job: 'VERIFIED_EMPTY' };
}
const MANIFEST_KEYS = ['schema', 'mode', 'candidateId', 'checkpoint', 'taskSha256', 'configSha256', 'environmentSha256',
  'route', 'argv', 'binary', 'boundary', 'reservation', 'admission', 'bindingSha256', 'server', 'modelIdentity', 'process',
  'ndjson', 'completionInput', 'completion', 'states', 'cleanup', 'preparation'];
/** Stable identity of the future-run preparation, not an authorization digest. */
export function proofBindingSha256(input: Pick<ProofManifest, 'candidateId' | 'checkpoint' | 'taskSha256' | 'configSha256'
  | 'environmentSha256' | 'route' | 'argv' | 'binary' | 'boundary' | 'preparation'>): string {
  return sha(JSON.stringify([input.candidateId, input.checkpoint, input.taskSha256, input.configSha256,
    input.environmentSha256, input.route.model, input.route.scopeDigest, input.route.evidenceId,
    input.argv, input.binary.path, input.binary.bytes, input.binary.sha256, input.binary.expected,
    input.binary.semanticVersion, input.binary.versionSource, input.boundary.kind, input.boundary.origin, input.boundary.evidenceSha256,
    input.preparation]));
}
function validateBytes(value: ByteEvidence): Buffer {
  exact(value, ['bytes', 'sha256', 'base64']); integer(value.bytes, 0, PROOF_LIMITS.streamBytes); digest(value.sha256);
  if (typeof value.base64 !== 'string' || value.base64.length > 4 * Math.ceil(PROOF_LIMITS.streamBytes / 3)) fail('Raw byte evidence oversized');
  const decoded = Buffer.from(value.base64, 'base64');
  if (decoded.toString('base64') !== value.base64 || decoded.length !== value.bytes || sha(decoded) !== value.sha256
    || decoded.includes(Buffer.from(SYNTHETIC_PREFIX))) fail('Raw byte evidence mismatch or credential material');
  return decoded;
}
function validateRawProcess(value: RawProcessEvidence): void {
  exact(value, ['kind', 'pid', 'stdin', 'stdinClosed', 'stdout', 'stderr', 'exitCode', 'signal', 'timedOut', 'overflow', 'closed', 'events', 'jobReceipt', 'jobBinding']);
  if (value.kind !== 'REPOSITORY_FAKE_CHILD_ONLY') fail('Real process evidence unsupported');
  if (value.pid !== null) integer(value.pid, 1, 2147483647);
  if (value.exitCode !== null) integer(value.exitCode, -2147483648, 2147483647);
  if (value.signal !== null && !['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV'].includes(value.signal)) fail('Invalid process signal');
  for (const key of ['stdinClosed', 'timedOut', 'overflow', 'closed'] as const)
    if (typeof value[key] !== 'boolean') fail('Invalid process boolean');
  validateBytes(value.stdin); validateBytes(value.stdout); validateBytes(value.stderr);
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > 1024) fail('Invalid process event count');
  let time = 0;
  value.events.forEach((entry, index) => {
    exact(entry, ['order', 'elapsedMs', 'kind']);
    if (entry.order !== index + 1 || typeof entry.elapsedMs !== 'number' || !Number.isFinite(entry.elapsedMs)
      || entry.elapsedMs < time || entry.elapsedMs > 60000 || typeof entry.kind !== 'string'
      || !['STARTED', 'STDIN_WRITTEN', 'STDIN_CLOSED', 'STDOUT', 'STDERR', 'EXIT', 'CLOSE', 'TIMEOUT', 'ERROR'].includes(entry.kind)) fail('Invalid process ordering');
    time = entry.elapsedMs;
  });
  const count = (kind: string) => value.events.filter(entry => entry.kind === kind).length;
  if (count('STARTED') > 1 || count('EXIT') > 1 || count('CLOSE') !== Number(value.closed)
    || count('STDIN_CLOSED') !== Number(value.stdinClosed) || count('TIMEOUT') !== Number(value.timedOut)
    || (value.closed && value.events[value.events.length - 1].kind !== 'CLOSE')) fail('Inconsistent process events');
  validateReceipt(value.jobReceipt);
  if (!ownedEvidence.has(value) || value.jobBinding !== 'SAME_OWNED_LAUNCH' || value.pid === null
    || value.jobReceipt.rootPid !== value.pid || value.jobReceipt.rootExit !== value.exitCode
    || value.jobReceipt.ioMode !== 'RAW_PIPE') fail('Receipt binding mismatch');
}
/** Reject non-data properties before serializing; impose global limits in addition to exact local schemas. */
function boundedData(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 16000 || depth > 12) fail('Manifest structure bound exceeded');
  if (typeof value === 'string') {
    if (value.length > 90000 || value.includes(SYNTHETIC_PREFIX) || /\bBearer\s|\bsk-[A-Za-z0-9]/i.test(value)) fail('Secret-like or oversized manifest string');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Nonfinite manifest number'); return; }
  if (!value || typeof value !== 'object') fail('Non-data manifest value');
  if (Array.isArray(value)) {
    if (value.length > 1024 || Reflect.ownKeys(value).length !== value.length + 1) fail('Invalid manifest array');
    for (let i = 0; i < value.length; i++) {
      const item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !('value' in item)) fail('Invalid manifest array item'); boundedData(item.value, depth + 1, budget);
    }
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Nonplain manifest data');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || SECRET_KEY.test(key)) fail('Raw auth-like manifest field');
      const item = Object.getOwnPropertyDescriptor(value, key);
      if (!item || !('value' in item) || !item.enumerable) fail('Non-data manifest field'); boundedData(item.value, depth + 1, budget);
    }
  }
}
export function freezeProofManifest(input: unknown, issuer: FakeResponsesServer): Readonly<ProofManifest> {
  boundedData(input); exact(input, MANIFEST_KEYS);
  if (Buffer.byteLength(JSON.stringify(input)) > PROOF_LIMITS.manifestBytes) fail('Manifest byte bound exceeded');
  const m = input as unknown as ProofManifest;
  const responseFacts = responseCompletionFacts(m.server, issuer);
  if (m.schema !== 'OMP_FIRST_PROOF_PROVIDER_FREE_V1' || m.mode !== 'PROVIDER_FREE_SIMULATION_ONLY') fail('Unsupported manifest schema');
  identifier(m.candidateId);
  if (typeof m.checkpoint !== 'string' || !/^[a-f0-9]{40}$/.test(m.checkpoint)) fail('Invalid checkpoint');
  [m.taskSha256, m.configSha256, m.environmentSha256, m.bindingSha256].forEach(digest);
  exact(m.route, ['model', 'scopeDigest', 'evidenceId']); identifier(m.route.model); identifier(m.route.evidenceId); digest(m.route.scopeDigest);
  if (!Array.isArray(m.argv) || m.argv.length < 2 || m.argv.length > 64 || m.argv.some(arg => typeof arg !== 'string' || arg.length > 1024)) fail('Invalid bounded argv');
  exact(m.binary, ['path', 'bytes', 'sha256', 'expected', 'semanticVersion', 'versionSource']);
  if (typeof m.binary.path !== 'string' || !m.binary.path || m.binary.path.length > 1024) fail('Invalid binary path');
  integer(m.binary.bytes, 1, 512 * 1024 * 1024); digest(m.binary.sha256);
  if (!['MATCH', 'MISMATCH', 'NOT_SUPPLIED'].includes(m.binary.expected)
    || !['UNKNOWN', 'HISTORICAL', 'INDEPENDENTLY_SUPPLIED'].includes(m.binary.versionSource)
    || (m.binary.semanticVersion === null) !== (m.binary.versionSource === 'UNKNOWN')
    || (m.binary.semanticVersion !== null && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(m.binary.semanticVersion))) fail('Invalid binary provenance');
  exact(m.boundary, ['kind', 'origin', 'evidenceSha256']); digest(m.boundary.evidenceSha256);
  if (m.boundary.kind !== 'TEST_LOOPBACK_ONLY' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(m.boundary.origin)
    || Number(m.boundary.origin.split(':').pop()) > 65535) fail('Invalid loopback boundary');
  if (proofBindingSha256(m) !== m.bindingSha256) fail('Preparation binding substitution');
  for (const claim of [m.reservation, m.admission]) {
    exact(claim, ['kind', 'id', 'bindingSha256']); identifier(claim.id);
    if (claim.kind !== 'IN_MEMORY_SIMULATION' || claim.bindingSha256 !== m.bindingSha256) fail('Simulated authority substitution');
  }
  exact(m.server, ['origin', 'fixture', 'listening', 'closed', 'overflow', 'rejected', 'requests', 'requestsSha256', 'responses', 'responsesSha256']);
  digest(m.server.responsesSha256);
  if (m.server.responses.some(response => response.transport === 'ABORTED')) fail('Response emitted bytes unknown after abort');
  if (sha(JSON.stringify(m.server.responses)) !== m.server.responsesSha256
    || !equal(m.server.responses.map(response => response.order), m.server.requests.filter(request => request.accepted).map(request => request.order)))
    fail('Response evidence substitution or pending response');
  if (m.server.origin !== m.boundary.origin || !(RESPONSE_FIXTURES as readonly string[]).includes(m.server.fixture)) fail('Server substitution');
  for (const key of ['listening', 'closed', 'overflow'] as const) if (typeof m.server[key] !== 'boolean') fail('Invalid server boolean');
  integer(m.server.rejected, 0, 2147483647);
  digest(m.server.requestsSha256);
  if (!Array.isArray(m.server.requests) || m.server.requests.length > PROOF_LIMITS.requests) fail('Too many captures');
  let lastOrder = 0;
  for (const request of m.server.requests) {
    exact(request, ['order', 'method', 'path', 'bodyBytes', 'contentType', 'bodySha256', 'topLevelKeys',
      'streamPresent', 'streamValue', 'json', 'model', 'auth', 'accepted']);
    integer(request.order, lastOrder + 1, PROOF_LIMITS.requests); lastOrder = request.order;
    integer(request.bodyBytes, 0, PROOF_LIMITS.bodyBytes);
    digest(request.bodySha256);
    if (typeof request.contentType !== 'string' || request.contentType !== 'application/json') fail('Invalid request content type');
    if (!Array.isArray(request.topLevelKeys)) fail('Invalid captured top-level keys');
    const topLevelKeys: readonly unknown[] = request.topLevelKeys;
    if (topLevelKeys.length > PROOF_LIMITS.bodyTopLevelKeys
      || !topLevelKeys.every(bodyKey) || !equal(topLevelKeys, [...topLevelKeys].sort())
      || !topLevelKeys.every((key, index) => topLevelKeys.indexOf(key) === index)) fail('Invalid captured top-level keys');
    if (typeof request.streamPresent !== 'boolean'
      || (request.streamValue !== null && typeof request.streamValue !== 'boolean')) fail('Invalid captured stream facts');
    exact(request.auth, ['present', 'sha256', 'matched']);
    if (typeof request.auth.present !== 'boolean' || typeof request.auth.matched !== 'boolean'
      || request.auth.matched !== (request.auth.sha256 !== null) || (request.auth.matched && !request.auth.present)) fail('Invalid redacted auth facts');
    if (request.auth.sha256 !== null) digest(request.auth.sha256);
    if (request.method !== 'POST' || request.path !== '/v1/responses' || typeof request.json !== 'string'
      || !['VALID', 'INVALID'].includes(request.json)
      || typeof request.accepted !== 'boolean'
      || !request.auth.matched) fail('Invalid request evidence');
    if (request.model !== null) identifier(request.model);
    // Stream presence, key membership and value type must describe one consistent observation.
    if (request.streamPresent !== topLevelKeys.includes('stream')) fail('Stream presence contradicts captured keys');
    if (!request.streamPresent && request.streamValue !== null) fail('Value retained for an absent stream field');
    if (request.json === 'INVALID') {
      if (topLevelKeys.length !== 0 || request.streamPresent || request.streamValue !== null
        || request.model !== null) fail('Invalid body retained semantic shape');
    } else if (request.model === null || !topLevelKeys.includes('model')) fail('Valid body lacks an observed exact model');
    // A present non-boolean `stream` stays durably observable as present/null; it is never accepted.
    if (request.streamPresent && request.streamValue === null && request.accepted) fail('Non-boolean stream silently accepted');
    if (request.accepted !== (request.json === 'VALID' && request.model !== null && (!request.streamPresent || request.streamValue !== null)))
      fail('Request acceptance contradicts observed shape');
  }
  if (sha(JSON.stringify(m.server.requests)) !== m.server.requestsSha256) fail('Request evidence substitution');
  exact(m.modelIdentity, ['routeModel', 'modelsFileModel', 'argvModel', 'requestModels', 'classification']);
  [m.modelIdentity.routeModel, m.modelIdentity.modelsFileModel, m.modelIdentity.argvModel].forEach(identifier);
  const models = m.server.requests.filter(request => request.accepted).map(request => request.model);
  const selectors = m.argv.flatMap((arg, index) => arg === '--model' ? [index] : []);
  if (selectors.length !== 1 || m.argv.some(arg => arg.startsWith('--model='))
    || m.argv[selectors[0] + 1] !== m.modelIdentity.argvModel || m.route.model !== m.modelIdentity.routeModel
    || !equal(models, m.modelIdentity.requestModels)) fail('Model evidence substitution');
  const identity: ActualModelIdentity = m.route.model !== m.modelIdentity.modelsFileModel
    || m.modelIdentity.argvModel !== `cliproxyapi/${m.route.model}` ? 'ACTUAL_MODEL_IDENTITY_MISMATCH'
    : models.length === 0 ? 'ACTUAL_MODEL_IDENTITY_NOT_OBSERVED' : models.every(model => model === m.route.model) ? 'ACTUAL_MODEL_IDENTITY_MATCH' : 'ACTUAL_MODEL_IDENTITY_MISMATCH';
  if (identity !== m.modelIdentity.classification) fail('Model classification mismatch');
  validateRawProcess(m.process);
  exact(m.ndjson, ['bytes', 'sha256', 'lines', 'historical']);
  if (!['MATCH', 'MISMATCH', 'NOT_APPLICABLE'].includes(m.ndjson.historical)) fail('Invalid historical classification');
  const observed = observeNdjson(validateBytes(m.process.stdout));
  if (observed.bytes !== m.ndjson.bytes || observed.sha256 !== m.ndjson.sha256 || !equal(observed.lines, m.ndjson.lines)) fail('NDJSON substitution');
  // Historical comparison is optional diagnostic data, never semantic completion authority.
  if (classifyCompletion(m.completionInput) !== m.completion || m.completionInput.exitCode !== m.process.exitCode
    || m.completionInput.httpStatus !== responseFacts.httpStatus
    || m.completionInput.transportEnded !== responseFacts.transportEnded
    || m.completionInput.responseValid !== responseFacts.responseValid
    || m.completionInput.explicitIncomplete !== responseFacts.explicitIncomplete
    || m.completionInput.explicitCompleted !== responseFacts.explicitCompleted
    || m.completionInput.usefulOutput !== observed.lines.some(line => line.type === 'fixture_completed' && line.json === 'VALID' && line.terminated)
    || m.completionInput.timedOut !== m.process.timedOut) fail('Completion substitution');
  if (m.completion === 'COMPLETION_PROVEN' && (m.modelIdentity.classification !== 'ACTUAL_MODEL_IDENTITY_MATCH'
    || m.process.overflow || m.server.overflow || m.server.rejected !== 0 || !m.process.stdinClosed || !m.process.closed || m.process.signal !== null)) fail('Completion lacks bounded evidence');
  exact(m.states, ['mode', 'bindingSha256', 'state', 'transitions']);
  if (m.states.mode !== m.mode || m.states.bindingSha256 !== m.bindingSha256 || m.states.state !== 'CLEANUP_VERIFIED'
    || !Array.isArray(m.states.transitions) || m.states.transitions.length !== PROOF_STATES.length) fail('Incomplete simulation chain');
  m.states.transitions.forEach((transition, index) => {
    exact(transition, ['state', 'order', 'bindingSha256', 'evidenceSha256']); digest(transition.evidenceSha256);
    if (transition.state !== PROOF_STATES[index] || transition.order !== index + 1 || transition.bindingSha256 !== m.bindingSha256) fail('State replay or substitution');
  });
  const p = m.preparation;
  exact(p, ['core', 'adapter', 'semanticVersionDisposition', 'endpoint', 'trust', 'cwd', 'environment', 'modelsFile', 'auth', 'listener', 'wfp', 'durableReservation', 'admissionRef', 'historicalSequence']);
  exact(p.core, ['taskId', 'runId', 'workerId', 'repositoryId', 'treeSha']);
  [p.core.taskId, p.core.runId, p.core.workerId, p.core.repositoryId].forEach(identifier);
  if (!/^[a-f0-9]{40}$/.test(p.core.treeSha)) fail('Invalid source tree');
  exact(p.adapter, ['id', 'version', 'thinking']); identifier(p.adapter.thinking);
  exact(p.semanticVersionDisposition, ['value', 'provenance']);
  if (p.adapter.id !== 'omp' || p.adapter.version !== '18.2.7' || p.semanticVersionDisposition.value !== '18.2.7'
    || p.semanticVersionDisposition.provenance !== 'HISTORICAL_NOT_EXECUTED'
    || m.binary.semanticVersion !== '18.2.7' || m.binary.versionSource !== 'HISTORICAL') fail('Semantic version provenance substitution');
  if (p.endpoint !== m.boundary.origin || p.trust !== 'LOCAL_LOOPBACK') fail('Route endpoint substitution');
  const pathField = (value: string) => { if (typeof value !== 'string' || !value || value.length > 1024) fail('Invalid preparation path'); };
  pathField(p.cwd);
  const cwdIndices = m.argv.flatMap((arg, index) => arg === '--cwd' ? [index] : []);
  const thinkingIndices = m.argv.flatMap((arg, index) => arg === '--thinking' ? [index] : []);
  if (cwdIndices.length !== 1 || thinkingIndices.length !== 1 || m.argv[cwdIndices[0] + 1] !== p.cwd
    || m.argv[thinkingIndices[0] + 1] !== p.adapter.thinking) fail('Adapter argv substitution');
  exact(p.environment, ['HOME', 'USERPROFILE', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'TEMP', 'TMP']);
  Object.values(p.environment).forEach(pathField);
  if (sha(JSON.stringify(p.environment)) !== m.environmentSha256) fail('Environment substitution');
  exact(p.modelsFile, ['path', 'content', 'bytes', 'sha256', 'model']); pathField(p.modelsFile.path);
  if (typeof p.modelsFile.content !== 'string' || Buffer.byteLength(p.modelsFile.content) > 8192
    || Buffer.byteLength(p.modelsFile.content) !== p.modelsFile.bytes || sha(p.modelsFile.content) !== p.modelsFile.sha256
    || p.modelsFile.sha256 !== m.configSha256 || p.modelsFile.model !== m.modelIdentity.modelsFileModel) fail('models.yml substitution');
  const expectedModels = { providers: { cliproxyapi: { baseUrl: p.endpoint + '/v1', api: 'openai-responses', models: [{ id: p.modelsFile.model }] } } };
  if (!equal(JSON.parse(p.modelsFile.content), expectedModels)) fail('Noncanonical models.yml');
  exact(p.auth, ['present', 'sha256']); digest(p.auth.sha256);
  if (p.auth.present !== true || m.server.requests.some(request => request.auth.sha256 !== p.auth.sha256)) fail('Synthetic auth substitution');
  exact(p.listener, ['host', 'port', 'fixture', 'bounds']);
  exact(p.listener.bounds, Object.keys(PROOF_LIMITS));
  if (p.listener.host !== '127.0.0.1' || p.listener.port !== Number(m.boundary.origin.split(':').pop())
    || p.listener.fixture !== m.server.fixture || !equal(p.listener.bounds, PROOF_LIMITS)) fail('Listener substitution');
  exact(p.wfp, ['status', 'ref', 'sha256']); pathField(p.wfp.ref); digest(p.wfp.sha256);
  if (p.wfp.status !== 'PENDING_NOT_EXECUTED') fail('WFP execution outside slice');
  exact(p.durableReservation, ['status', 'path', 'sha256', 'id']); pathField(p.durableReservation.path); digest(p.durableReservation.sha256);
  exact(p.admissionRef, ['status', 'ref', 'sha256', 'id']); pathField(p.admissionRef.ref); digest(p.admissionRef.sha256);
  if (p.durableReservation.status !== 'FUTURE_NOT_CREATED' || p.admissionRef.status !== 'FUTURE_NOT_CREATED'
    || p.durableReservation.id !== m.reservation.id || p.admissionRef.id !== m.admission.id) fail('Future authority reference substitution');
  if (p.historicalSequence !== null && !Array.isArray(p.historicalSequence)) fail('Invalid historical sequence');
  const historical = observeNdjson(validateBytes(m.process.stdout), p.historicalSequence ?? undefined);
  if (historical.historical !== m.ndjson.historical) fail('Historical comparison substitution');
  if (!m.process.jobReceipt.rootJobMember || m.process.jobReceipt.activeProcessesFinal !== 0
    || m.process.jobReceipt.cleanupState !== 'VERIFIED_EMPTY' || !m.process.jobReceipt.ioDrained) fail('Job cleanup unverified');
  exact(m.cleanup, ['listenerClosed', 'childClosed', 'job']);
  if (m.cleanup.listenerClosed !== true || m.cleanup.childClosed !== true || m.cleanup.job !== 'VERIFIED_EMPTY'
    || !m.server.closed || m.server.listening || !m.process.closed) fail('Cleanup not observed');
  return snapshot(m);
}
