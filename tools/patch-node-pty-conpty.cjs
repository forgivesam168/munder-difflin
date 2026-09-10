#!/usr/bin/env node
'use strict';
/**
 * Windows-only node-pty crash guard, re-applied on every install (postinstall,
 * after electron-rebuild). No-op on non-Windows and when already patched.
 *
 * node-pty forks `conpty_console_list_agent.js` to enumerate console processes
 * when a pty is killed/exits. For a child whose console is already gone — e.g.
 * an agent CLI that manages its own console and exits fast (Antigravity's `agy`)
 * — `getConsoleProcessList(shellPid)` throws "AttachConsole failed" UNCAUGHT in
 * that forked helper, which cascades into a whole-app crash (exit 255). Wrap it
 * so it degrades to an empty list instead.
 */
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const agent = join(__dirname, '..', 'node_modules', 'node-pty', 'lib', 'conpty_console_list_agent.js');
if (!existsSync(agent)) throw new Error('node-pty console helper missing; install dependencies first');

const src = readFileSync(agent, 'utf8');
// Idempotent: only patch the original unguarded form.
const needsConsoleGuard = src.includes('var consoleProcessList = getConsoleProcessList(shellPid);');

const guarded =
  'var consoleProcessList = [];\n' +
  '// PATCHED: AttachConsole can fail when the shell console is already gone (e.g.\n' +
  "// a fast-exiting agent CLI that owns its console). Don't let the uncaught throw\n" +
  '// crash this forked helper and cascade into a whole-app crash.\n' +
  'try { consoleProcessList = getConsoleProcessList(shellPid); } catch (e) { consoleProcessList = []; }';

if (!needsConsoleGuard && !src.includes(guarded)) {
  throw new Error('node-pty console guard changed; inspect before installation');
}

let out = needsConsoleGuard ? src.replace('var consoleProcessList = getConsoleProcessList(shellPid);', guarded) : src;
if (needsConsoleGuard) out = out.replace(
  'process.send({ consoleProcessList: consoleProcessList });',
  'try { process.send({ consoleProcessList: consoleProcessList }); } catch (e) { /* parent gone */ }'
);
if (out !== src) {
  writeFileSync(agent, out, 'utf8');
  console.log('[patch-node-pty-conpty] guarded conpty_console_list_agent against AttachConsole crash');
}

// node-pty 1.1.0 closes only the output socket on natural ConPTY exit. The
// input pipe and conout worker's server stay referenced, keeping Electron's
// Node runtime alive after the shell has ended. Explicit kill already disposes
// the worker; apply the same resource disposal to natural exit, without killing
// a process by a potentially reused PID.
const ptyAgent = join(__dirname, '..', 'node_modules', 'node-pty', 'lib', 'windowsPtyAgent.js');
const ptySource = readFileSync(ptyAgent, 'utf8');
const marker = '// PATCHED: release natural-exit ConPTY resources';
const cleanup = `        this._outSocket.destroy();\n        ${marker}\n        this._inSocket.destroy();\n        this._conoutSocketWorker.dispose();`;
if (ptySource.includes(marker) && !ptySource.includes(cleanup)) {
  throw new Error('node-pty natural-exit guard is incomplete; inspect before installation');
}
if (!ptySource.includes(marker)) {
  const target = '        this._outSocket.destroy();';
  if (ptySource.split(target).length !== 2) {
    throw new Error('node-pty natural-exit patch target changed; inspect before installation');
  }
  writeFileSync(ptyAgent, ptySource.replace(target, cleanup), 'utf8');
  console.log('[patch-node-pty-conpty] disposed natural-exit input pipe and conout worker');
}
