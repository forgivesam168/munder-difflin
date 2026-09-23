import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface OwnedPtyLaunch {
  securityContext: 'CURRENT_PROCESS' | 'RESTRICTED_LOW';
  ioMode?: 'CONPTY' | 'RAW_PIPE';
  helperPath: string;
  helperSha256: string;
  scriptPath: string;
  scriptSha256: string;
  nativeSourcePath: string;
  nativeSourceSha256: string;
  executablePath: string;
  executableSha256: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  helperEnv: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
  timeoutMs: number;
  cleanupMs: number;
}

export interface OwnedPtyReceipt {
  securityContext: 'CURRENT_PROCESS' | 'RESTRICTED_LOW';
  restrictedTokenVerified: boolean;
  childTokenVerified: boolean;
  ioMode?: 'CONPTY' | 'RAW_PIPE';
  inputClosed?: boolean;
  rootPid: number | null;
  rootExit: number | null;
  rootJobMember: boolean;
  activeProcessesFinal: number | null;
  cleanupState: 'VERIFIED_EMPTY' | 'UNVERIFIED';
  ioDrained: boolean;
  pseudoConsoleClosed: boolean;
  reason: 'exit' | 'stop' | 'timeout' | 'helper-failure' | 'launch-failure';
  error?: string;
}

interface OwnedPtyCallbacks {
  onData(data: string): void;
  /** Exact child bytes before decoding; CONPTY is explicitly merged. */
  onRawData?(stream: 'stdout' | 'stderr' | 'conpty', bytes: Buffer): void;
  /** Native acknowledgment, not merely a queued control write. */
  onInput?(kind: 'written' | 'closed', bytes: number): void;
  onStarted(pid: number): void;
  onExit(receipt: OwnedPtyReceipt): void;
}

interface ControlFrame {
  type: 'write' | 'resize' | 'stop' | 'input' | 'close-input';
  data?: string;
  cols?: number;
  rows?: number;
}

const HASH = /^[a-f0-9]{64}$/;
const MAX_INITIAL_BYTES = 512 * 1024;
const MAX_CONTROL_BYTES = 48 * 1024;
const MAX_PENDING_BYTES = 256 * 1024;
const MAX_PROTOCOL_LINE = 96 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;
const MAX_ENV_ENTRIES = 512;
const MAX_ENV_CHARS = 128 * 1024;
const MAX_ARGS = 256;
const MAX_ARG_CHARS = 32_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CLEANUP_MS = 60_000;
const HELPER_ENV_KEYS: Readonly<Record<string, true>> = {
  SYSTEMROOT: true,
  COMSPEC: true,
  PATH: true,
  HOME: true,
  USERPROFILE: true,
  TEMP: true,
  TMP: true,
  APPDATA: true,
  LOCALAPPDATA: true,
  POWERSHELL_TELEMETRY_OPTOUT: true,
  POWERSHELL_UPDATECHECK: true,
  PSMODULEANALYSISCACHEPATH: true
};

function failedReceipt(reason: OwnedPtyReceipt['reason'], error: string, securityContext: OwnedPtyLaunch['securityContext']): OwnedPtyReceipt {
  return {
    securityContext, restrictedTokenVerified: false, childTokenVerified: false,
    ioMode: 'CONPTY', inputClosed: false,
    rootPid: null,
    rootExit: null,
    rootJobMember: false,
    activeProcessesFinal: null,
    cleanupState: 'UNVERIFIED',
    ioDrained: false,
    pseudoConsoleClosed: false,
    reason,
    error
  };
}

function regularCanonicalFile(value: string, label: string): string {
  if (!value || resolve(value) !== value) throw new Error(`${label} must be an absolute canonical path`);
  const stat = lstatSync(value);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file`);
  if (realpathSync.native(value) !== value) throw new Error(`${label} must not traverse links`);
  return value;
}

function canonicalDirectory(value: string): string {
  if (!value || resolve(value) !== value) throw new Error('cwd must be an absolute canonical path');
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('cwd must be a regular non-link directory');
  if (realpathSync.native(value) !== value) throw new Error('cwd must not traverse links');
  return value;
}

function validateHash(value: string, label: string): string {
  if (!HASH.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function validateEnvironment(
  value: Readonly<Record<string, string>>,
  label: string,
  allowedKeys?: Readonly<Record<string, true>>
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  const entries = Object.entries(value);
  if (entries.length > MAX_ENV_ENTRIES) throw new Error(`${label} has too many entries`);
  let chars = 0;
  const folded = new Set<string>();
  for (const [key, entry] of entries) {
    if (!key || key.includes('=') || key.includes('\0') || typeof entry !== 'string' || entry.includes('\0')) {
      throw new Error(`${label} contains an invalid entry`);
    }
    const normalized = key.toUpperCase();
    if (allowedKeys && allowedKeys[normalized] !== true) throw new Error(`${label} contains a forbidden key: ${key}`);
    if (folded.has(normalized)) throw new Error(`${label} contains case-insensitive duplicate keys`);
    folded.add(normalized);
    chars += key.length + entry.length + 2;
    if (chars > MAX_ENV_CHARS) throw new Error(`${label} is too large`);
    result[key] = entry;
  }
  return result;
}

function validateInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its supported bounds`);
  }
  return value;
}

function sha256(path: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    let bytesRead: number;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    closeSync(descriptor);
  }
}

function assertHash(path: string, expected: string, label: string): void {
  const actual = sha256(path);
  if (!timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error(`${label} SHA-256 mismatch`);
  }
}

function validateReceipt(value: unknown): OwnedPtyReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid exit receipt');
  const receipt = value as Record<string, unknown>;
  const nullableInteger = (entry: unknown): entry is number | null => entry === null || Number.isInteger(entry);
  if (!nullableInteger(receipt.rootPid) || !nullableInteger(receipt.rootExit) ||
      typeof receipt.rootJobMember !== 'boolean' || !nullableInteger(receipt.activeProcessesFinal) ||
      (receipt.cleanupState !== 'VERIFIED_EMPTY' && receipt.cleanupState !== 'UNVERIFIED') ||
      typeof receipt.ioDrained !== 'boolean' || typeof receipt.pseudoConsoleClosed !== 'boolean' ||
      !['exit', 'stop', 'timeout', 'helper-failure', 'launch-failure'].includes(String(receipt.reason)) ||
      (receipt.error !== undefined && typeof receipt.error !== 'string')) {
    throw new Error('invalid exit receipt fields');
  }
  return receipt as unknown as OwnedPtyReceipt;
}

export interface OwnedPtyHandle {
  input(bytes: Uint8Array): void;
  closeInput(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
  completion: Promise<OwnedPtyReceipt>;
}

export function launchOwnedPty(
  input: OwnedPtyLaunch,
  callbacks: OwnedPtyCallbacks
): OwnedPtyHandle {
  const required = ['securityContext', 'helperPath', 'helperSha256', 'scriptPath', 'scriptSha256', 'nativeSourcePath', 'nativeSourceSha256', 'executablePath', 'executableSha256', 'args', 'cwd', 'env', 'helperEnv', 'cols', 'rows', 'timeoutMs', 'cleanupMs'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || required.some(key => !Object.prototype.hasOwnProperty.call(input, key)) ||
      Object.keys(input).some(key => !required.includes(key) && key !== 'ioMode')) throw new Error('Invalid launch schema');
  const securityContext = input.securityContext;
  if (securityContext !== 'CURRENT_PROCESS' && securityContext !== 'RESTRICTED_LOW') throw new Error('Invalid security context');
  const ioMode = input.ioMode ?? 'CONPTY';
  if (ioMode !== 'CONPTY' && ioMode !== 'RAW_PIPE') throw new Error('Invalid I/O mode');
  if (securityContext === 'RESTRICTED_LOW' && ioMode !== 'RAW_PIPE') throw new Error('RESTRICTED_LOW requires RAW_PIPE');
  let inputClosed = false;
  let acknowledgedInputClosed = false;
  let inputBytesPending = 0;
  let pendingReceipt: OwnedPtyReceipt | null = null;
  let startedPid: number | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let settled = false;
  let started = false;
  let stopRequested = false;
  let pendingBytes = 0;
  let stdoutBuffer = '';
  let stderrBytes = 0;
  let stderrText = '';
  let startupTimer: NodeJS.Timeout | undefined;
  let outerTimer: NodeJS.Timeout | undefined;
  let failureTimer: NodeJS.Timeout | undefined;
  const pending: ControlFrame[] = [];
  const decoder = new StringDecoder('utf8');
  const errorDecoder = new StringDecoder('utf8');
  let resolveCompletion!: (receipt: OwnedPtyReceipt) => void;
  const completion = new Promise<OwnedPtyReceipt>((resolvePromise) => { resolveCompletion = resolvePromise; });

  const finish = (receipt: OwnedPtyReceipt): void => {
    if (settled) return;
    settled = true;
    clearTimeout(startupTimer);
    clearTimeout(outerTimer);
    clearTimeout(failureTimer);
    for (const trailing of [decoder.end(), errorDecoder.end()]) {
      if (trailing) {
        try { callbacks.onData(trailing); } catch { /* completion must remain single-shot */ }
      }
    }
    try { callbacks.onExit(receipt); } catch { /* callback errors do not alter ownership cleanup */ }
    resolveCompletion(receipt);
  };

  const stopHelper = (): void => {
    if (!child) return;
    try { child.kill(); } catch { /* retained helper may already be gone */ }
  };

  const fail = (reason: OwnedPtyReceipt['reason'], error: string): void => {
    if (settled || pendingReceipt) return;
    const receipt = failedReceipt(reason, error, securityContext);
    receipt.ioMode = ioMode;
    receipt.rootPid = startedPid;
    pendingReceipt = receipt;
    stopHelper();
    failureTimer = setTimeout(() => finish(receipt), cleanupMs);
  };

  const send = (frame: ControlFrame): void => {
    if (settled) return;
    let encoded: string;
    try { encoded = `${JSON.stringify(frame)}\n`; } catch { fail('helper-failure', 'control frame serialization failed'); return; }
    const bytes = Buffer.byteLength(encoded);
    if (bytes > MAX_CONTROL_BYTES) { fail('helper-failure', 'control frame exceeds bounded protocol size'); return; }
    if (!child || !child.stdin.writable) {
      if (pendingBytes + bytes > MAX_PENDING_BYTES) { fail('helper-failure', 'pending control data exceeds bounded capacity'); return; }
      pending.push(frame);
      pendingBytes += bytes;
      return;
    }
    child.stdin.write(encoded, 'utf8', (error) => {
      if (error) queueMicrotask(() => {
        if (!settled) fail('helper-failure', `helper input failed: ${error.message}`);
      });
    });
  };

  const flushPending = (): void => {
    const frames = pending.splice(0);
    pendingBytes = 0;
    for (const frame of frames) send(frame);
  };

  const consumeLine = (line: string): void => {
    if (pendingReceipt) return;
    if (!line) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { fail('helper-failure', 'helper emitted malformed JSON'); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      fail('helper-failure', 'helper emitted an invalid frame');
      return;
    }
    const frame = message as Record<string, unknown>;
    if (frame.type === 'started') {
      if (started || !Number.isSafeInteger(frame.pid) || Number(frame.pid) <= 0) {
        fail('helper-failure', 'helper emitted an invalid started frame');
        return;
      }
      started = true;
      startedPid = Number(frame.pid);
      clearTimeout(startupTimer);
      try { callbacks.onStarted(Number(frame.pid)); } catch (error) {
        send({ type: 'stop' });
        fail('helper-failure', `onStarted callback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (frame.type === 'data') {
      if (!started || typeof frame.data !== 'string' || frame.data.length > MAX_PROTOCOL_LINE || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)
        || (ioMode === 'RAW_PIPE' ? frame.stream !== 'stdout' && frame.stream !== 'stderr' : frame.stream !== 'conpty')) {
        fail('helper-failure', 'helper emitted an invalid data frame');
        return;
      }
      const bytes = Buffer.from(frame.data, 'base64');
      try {
        if (bytes.toString('base64') !== frame.data) throw new Error('noncanonical data frame');
        const stream = frame.stream as 'stdout' | 'stderr' | 'conpty';
        callbacks.onRawData?.(stream, Buffer.from(bytes));
        const text = (stream === 'stderr' ? errorDecoder : decoder).write(bytes);
        if (text) callbacks.onData(text);
      } catch (error) {
        send({ type: 'stop' });
        fail('helper-failure', `onData callback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (frame.type === 'input-written' || frame.type === 'input-closed') {
      try {
        if (!started || ioMode !== 'RAW_PIPE' || acknowledgedInputClosed) throw new Error('invalid input acknowledgment');
        if (frame.type === 'input-written') {
          if (!Number.isSafeInteger(frame.bytes) || Number(frame.bytes) <= 0 || Number(frame.bytes) > inputBytesPending)
            throw new Error('invalid input byte acknowledgment');
          inputBytesPending -= Number(frame.bytes);
          callbacks.onInput?.('written', Number(frame.bytes));
        } else {
          if (!inputClosed || inputBytesPending !== 0) throw new Error('premature input closure');
          acknowledgedInputClosed = true;
          callbacks.onInput?.('closed', 0);
        }
      } catch { fail('helper-failure', 'invalid input acknowledgment'); }
      return;
    }
    if (frame.type === 'exit') {
      try {
        const receipt = validateReceipt(frame.receipt);
        if (receipt.securityContext !== securityContext || typeof receipt.restrictedTokenVerified !== 'boolean' ||
            typeof receipt.childTokenVerified !== 'boolean' ||
            (securityContext === 'CURRENT_PROCESS' && (receipt.restrictedTokenVerified || receipt.childTokenVerified)) ||
            (securityContext === 'RESTRICTED_LOW' && receipt.reason !== 'launch-failure' && receipt.reason !== 'helper-failure' &&
              (!receipt.restrictedTokenVerified || !receipt.childTokenVerified))) throw new Error('Invalid security context receipt');
        if (receipt.ioMode !== ioMode || typeof receipt.inputClosed !== 'boolean'
          || (ioMode === 'RAW_PIPE' && receipt.pseudoConsoleClosed)) throw new Error('invalid I/O mode receipt');
        if (receipt.rootPid !== startedPid || (receipt.reason === 'exit' && (!started || receipt.rootExit === null)))
          throw new Error('invalid process identity receipt');
        pendingReceipt = receipt;
      } catch (error) {
        fail('helper-failure', error instanceof Error ? error.message : String(error));
        return;
      }
      child?.stdin.end();
      return;
    }
    fail('helper-failure', 'helper emitted an unknown frame');
  };
  if (process.platform !== 'win32') throw new Error('owned ConPTY backend requires Windows');
  const helperPath = regularCanonicalFile(input.helperPath, 'helperPath');
  const scriptPath = regularCanonicalFile(input.scriptPath, 'scriptPath');
  const nativeSourcePath = regularCanonicalFile(input.nativeSourcePath, 'nativeSourcePath');
  const executablePath = regularCanonicalFile(input.executablePath, 'executablePath');
  const cwd = canonicalDirectory(input.cwd);
  const helperSha256 = validateHash(input.helperSha256, 'helperSha256');
  const scriptSha256 = validateHash(input.scriptSha256, 'scriptSha256');
  const nativeSourceSha256 = validateHash(input.nativeSourceSha256, 'nativeSourceSha256');
  const executableSha256 = validateHash(input.executableSha256, 'executableSha256');
  if (!helperPath.toLowerCase().endsWith('.exe') || !scriptPath.toLowerCase().endsWith('.ps1') ||
      !nativeSourcePath.toLowerCase().endsWith('.cs') || !executablePath.toLowerCase().endsWith('.exe')) {
    throw new Error('helper, script, native source, and executable extensions are invalid');
  }
  if (!Array.isArray(input.args) || input.args.length > MAX_ARGS) throw new Error('args exceeds its supported count');
  let argChars = 0;
  const args = input.args.map((arg) => {
    if (typeof arg !== 'string' || arg.includes('\0')) throw new Error('args contains an invalid value');
    argChars += arg.length;
    if (arg.length > MAX_ARG_CHARS || argChars > MAX_ARG_CHARS) throw new Error('args exceeds its supported size');
    return arg;
  });
  const env = validateEnvironment(input.env, 'env');
  const helperEnv = validateEnvironment(input.helperEnv, 'helperEnv', HELPER_ENV_KEYS);
  const cols = validateInteger(input.cols, 1, 32767, 'cols');
  const rows = validateInteger(input.rows, 1, 32767, 'rows');
  const timeoutMs = validateInteger(input.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, 'timeoutMs');
  const cleanupMs = validateInteger(input.cleanupMs, MIN_TIMEOUT_MS, MAX_CLEANUP_MS, 'cleanupMs');

  assertHash(helperPath, helperSha256, 'helperPath');
  assertHash(scriptPath, scriptSha256, 'scriptPath');
  assertHash(nativeSourcePath, nativeSourceSha256, 'nativeSourcePath');
  assertHash(executablePath, executableSha256, 'executablePath');

  const launch = {
    helperPath, helperSha256, scriptPath, scriptSha256, nativeSourcePath, nativeSourceSha256,
    executablePath, executableSha256, args, cwd, env, cols, rows, timeoutMs, cleanupMs, ioMode, securityContext
  };
  const initial = `${JSON.stringify(launch)}\n`;
  if (Buffer.byteLength(initial) > MAX_INITIAL_BYTES) throw new Error('initial launch frame exceeds bounded protocol size');

  try {
    child = spawn(helperPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath], {
      cwd,
      env: helperEnv,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const receipt = failedReceipt('launch-failure', `helper launch failed: ${error instanceof Error ? error.message : String(error)}`, securityContext);
    receipt.ioMode = ioMode;
    queueMicrotask(() => finish(receipt));
    return {
      input(): void { throw new Error('Launch failed'); },
      closeInput(): void { throw new Error('Launch failed'); },
      write(): void { /* launch already failed */ },
      resize(): void { /* launch already failed */ },
      stop(): void { /* launch already failed */ },
      completion
    };
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    queueMicrotask(() => {
      if (settled) return;
      stdoutBuffer += chunk;
      if (stdoutBuffer.length > MAX_PROTOCOL_LINE && !stdoutBuffer.includes('\n')) {
        fail('helper-failure', 'helper output frame exceeds bounded protocol size');
        return;
      }
      let newline: number;
      while (!settled && (newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.length > MAX_PROTOCOL_LINE) { fail('helper-failure', 'helper output frame exceeds bounded protocol size'); return; }
        consumeLine(line);
      }
    });
  });
  child.stderr.on('data', (chunk: Buffer) => {
    queueMicrotask(() => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderrText += chunk.toString('utf8');
      else if (!settled) fail('helper-failure', 'helper stderr exceeds bounded capacity');
    });
  });
  child.stdin.on('error', (error) => {
    queueMicrotask(() => {
      if (!settled) fail('helper-failure', `helper input failed: ${error.message}`);
    });
  });
  child.on('error', (error) => {
    queueMicrotask(() => {
      if (!settled) finish({ ...failedReceipt('launch-failure', `helper launch failed: ${error.message}`, securityContext), ioMode });
    });
  });
  child.on('close', (code, signal) => {
    queueMicrotask(() => {
      if (settled) return;
      if (pendingReceipt) {
        finish(pendingReceipt);
        return;
      }
      const detail = stderrText.trim();
      finish({ ...failedReceipt(started ? 'helper-failure' : 'launch-failure',
        `helper exited without a final receipt (code=${String(code)}, signal=${String(signal)})${detail ? `: ${detail}` : ''}`, securityContext), ioMode, rootPid: startedPid });
    });
  });
  child.stdin.write(initial, 'utf8', (error) => {
    queueMicrotask(() => {
      if (error && !settled) fail('launch-failure', `initial helper input failed: ${error.message}`);
      else flushPending();
    });
  });
  startupTimer = setTimeout(() => fail('launch-failure', 'helper startup deadline expired'), Math.min(timeoutMs, 30_000));
  outerTimer = setTimeout(() => fail('helper-failure', 'helper exceeded the bounded outer lifetime'), timeoutMs + cleanupMs + 10_000);

  return {
    input(bytes: Uint8Array): void {
      if (ioMode !== 'RAW_PIPE' || inputClosed || settled || pendingReceipt) throw new Error('Raw input unavailable');
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 65_536) throw new Error('Invalid raw input bounds');
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      inputBytesPending += buffer.length;
      for (let offset = 0; offset < buffer.length; offset += 24 * 1024)
        send({ type: 'input', data: buffer.subarray(offset, offset + 24 * 1024).toString('base64') });
    },
    closeInput(): void {
      if (ioMode !== 'RAW_PIPE' || inputClosed || settled || pendingReceipt) throw new Error('Raw input unavailable');
      inputClosed = true;
      send({ type: 'close-input' });
    },
    write(data: string): void {
      if (ioMode !== 'CONPTY') throw new Error('Generic write cannot deliver raw input');
      if (typeof data !== 'string') { fail('helper-failure', 'write data must be a string'); return; }
      const bytes = Buffer.from(data, 'utf8');
      if (bytes.length === 0) return;
      for (let offset = 0; offset < bytes.length && !settled; offset += 24 * 1024) {
        send({ type: 'write', data: bytes.subarray(offset, offset + 24 * 1024).toString('base64') });
      }
    },
    resize(cols: number, rows: number): void {
      if (ioMode !== 'CONPTY') throw new Error('RAW_PIPE cannot resize');
      send({
        type: 'resize',
        cols: validateInteger(cols, 1, 32767, 'cols'),
        rows: validateInteger(rows, 1, 32767, 'rows')
      });
    },
    stop(): void {
      if (stopRequested || settled) return;
      stopRequested = true;
      send({ type: 'stop' });
    },
    completion
  };
}
