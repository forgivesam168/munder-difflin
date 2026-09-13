import { CODEX_ENV_ALLOWLIST, isCanonicalAbsolutePath, isCredentialLikeEnvironmentKey } from './codexWorkerContract';

/**
 * Environment construction for agent PTYs, as a pure function so the layering
 * is testable off-process (the same trick `buildMissingCliScript` uses for its
 * `platform` parameter).
 *
 * The layering rule, bottom to top:
 *   1. the inherited environment, minus the parent Claude session's identity
 *   2. the app's own defaults (PATH, terminal identity, locale)
 *   3. per-agent values (`opts.env`) — always win, even over the strip below
 */

/**
 * The app is often launched from INSIDE a Claude Code session (`npm run dev`
 * typed into a claude terminal), so that session's identity markers arrive via
 * `process.env` and would flow into every agent CLI. CLAUDE_CODE_CHILD_SESSION
 * makes the agent believe it is a child session and silently DISABLES
 * transcript saving ("Transcript saving is off — inherited
 * CLAUDE_CODE_CHILD_SESSION marker"), which breaks --resume for every agent of
 * that run: their sessions never reach disk (bit us live 2026-08-16/17 — no
 * worker transcript ever existed). The session id, pid, messaging socket+token,
 * effort, execpath and entrypoint likewise all describe the PARENT session,
 * never a fresh agent.
 *
 * Stripped by PREFIX rather than by name: the CLI grows new markers faster
 * than a hardcoded list keeps up (a five-name list was already seven short of
 * a live session's dump when review caught it). Agents are top-level sessions
 * regardless of how the app was launched, so they inherit NONE of the parent's
 * Claude identity.
 */
const CLAUDE_MARKER_RE = /^CLAUDE(CODE|_)/;

/**
 * Configuration, not identity: these share the prefix but are the OPERATOR's
 * own choices — where the CLI keeps its config, how it authenticates, which
 * backend serves it. An operator who exported them wants agents to see them,
 * and stripping them breaks agents in exactly the quiet way the strip above
 * exists to prevent. Everything session-scoped stays out of this list.
 */
const CLAUDE_CONFIG_KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX'
]);

export function buildPtyEnv(
  parentEnv: NodeJS.ProcessEnv,
  userPath: string,
  agentEnv?: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // Layer 1 — inherit, minus the parent session's Claude identity. Only this
  // layer is stripped: a marker set deliberately via `agentEnv` below survives,
  // so per-agent environment overrides (and future per-agent env features)
  // cannot be silently wiped by the strip.
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v === undefined) continue;
    if (CLAUDE_MARKER_RE.test(k) && !CLAUDE_CONFIG_KEEP.has(k)) continue;
    inherited[k] = v;
  }
  return {
    ...inherited,
    PATH: userPath,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Help apps that look for a real interactive shell
    FORCE_COLOR: '1',
    // A Finder/Dock-launched Electron app inherits NO locale from launchd
    // (`launchctl getenv LANG` is empty), so without this every child runs in
    // the C/POSIX locale — where macOS's CoreFoundation default text encoding
    // is Mac OS Roman (__CF_USER_TEXT_ENCODING=<uid>:0:0). Any locale-sensitive
    // tool an agent runs then decodes UTF-8 as MacRoman and paints mojibake
    // into the grid ("—" → "‚Äî"), which copy faithfully reproduces. This
    // terminal IS UTF-8 (xterm.js + Unicode11), so say so.
    //
    // LC_CTYPE only, deliberately: it is the character-encoding category. Using
    // LC_ALL would also override collation and date formatting for every user
    // who never exported a locale. A locale the user really did export wins.
    ...(platform === 'win32'
      ? {}
      : {
          LANG: parentEnv.LANG ?? 'en_US.UTF-8',
          LC_CTYPE:
            parentEnv.LC_ALL ?? parentEnv.LC_CTYPE ?? parentEnv.LANG ?? 'en_US.UTF-8'
        }),
    // Per-agent hive identity (AGENT_ID, HIVE_ROOT, …) when provided.
    ...(agentEnv ?? {})
  };
}

/** Explicit inputs for the B1 Codex environment. There is deliberately no
 * parent/process environment parameter: a future runtime must construct this
 * allowlist rather than inherit the host or the operator's daily Codex setup.
 */
export interface CodexWorkerEnvironmentInput {
  path: string;
  home: string;
  userProfile: string;
  temp: string;
  tmp: string;
  codexHome: string;
}

const CODEX_ENV_INPUT_KEYS = ['path', 'home', 'userProfile', 'temp', 'tmp', 'codexHome'] as const;

function assertCodexEnvironmentInput(input: CodexWorkerEnvironmentInput): void {
  if (!input || typeof input !== 'object'
    || Object.keys(input).sort().join(',') !== [...CODEX_ENV_INPUT_KEYS].sort().join(',')) {
    throw new Error('Invalid Codex environment inputs');
  }
  for (const key of CODEX_ENV_INPUT_KEYS) {
    const value = input[key];
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) {
      throw new Error('Invalid Codex environment inputs');
    }
  }
  if (![input.home, input.userProfile, input.temp, input.tmp, input.codexHome].every(isCanonicalAbsolutePath)) {
    throw new Error('Codex environment directories must be canonical absolute paths');
  }
}

function isEnvironmentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build the fixed B1 Codex environment. This is pure and not connected to
 * `PtyManager` or any production spawn path in this milestone.
 */
export function buildCodexWorkerEnv(input: CodexWorkerEnvironmentInput): Record<string, string> {
  assertCodexEnvironmentInput(input);
  return Object.freeze({
    PATH: input.path,
    HOME: input.home,
    USERPROFILE: input.userProfile,
    TEMP: input.temp,
    TMP: input.tmp,
    CODEX_HOME: input.codexHome,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '1'
  });
}

/** Validate a constructed B1 environment without consulting host state. */
export function validateCodexWorkerEnv(
  value: unknown,
  expected?: CodexWorkerEnvironmentInput
): Record<string, string> {
  if (!isEnvironmentRecord(value)) {
    throw new Error('Invalid Codex environment');
  }
  const env = value;
  const actualKeys = Object.keys(env).sort();
  const expectedKeys = [...CODEX_ENV_ALLOWLIST].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Codex environment is not the fixed allowlist');
  }
  if (actualKeys.some(isCredentialLikeEnvironmentKey)) {
    throw new Error('Credential-like environment variable is forbidden');
  }
  for (const key of CODEX_ENV_ALLOWLIST) {
    const item = env[key];
    if (typeof item !== 'string' || !item || item.length > 4096 || /[\x00-\x1f]/.test(item)) {
      throw new Error('Invalid Codex environment value');
    }
  }
  if (![env.HOME, env.USERPROFILE, env.TEMP, env.TMP, env.CODEX_HOME].every(isCanonicalAbsolutePath)) {
    throw new Error('Codex environment directories must be canonical absolute paths');
  }
  if (env.TERM !== 'xterm-256color' || env.COLORTERM !== 'truecolor' || env.FORCE_COLOR !== '1') {
    throw new Error('Codex environment defaults do not match policy');
  }
  if (expected) {
    const constructed = buildCodexWorkerEnv(expected);
    for (const key of CODEX_ENV_ALLOWLIST) {
      if (env[key] !== constructed[key]) throw new Error('Codex environment value mismatch');
    }
  }
  const result: Record<string, string> = {};
  for (const key of CODEX_ENV_ALLOWLIST) {
    const item = env[key];
    if (typeof item !== 'string') throw new Error('Invalid Codex environment value');
    result[key] = item;
  }
  return Object.freeze(result);
}
