# Security Policy

## Scope

Munder Difflin is a desktop app that spawns local processes in PTYs and reads/writes
project files. Local execution is not an isolation guarantee. Optional Slack and
webhook integrations expose HTTP ingress and can create public tunnels; agent
runtimes and integrations can also contact external services.

This research fork is under security evaluation and is not approved for company
deployment. Current evidence and unresolved boundaries are tracked in `tasks/todo.md`.

## Research update policy

The updater is disabled in source (`src/main/updater.ts`), independently of persisted
`autoUpdate` settings and packaged/development mode. Updater IPC actions return an
explicit refusal; initialization does not load the native updater, schedule polling,
fetch release HTML, read preview files, or open release URLs. Re-enabling requires a
reviewed update source and artifact policy. Existing packaging publish metadata is
not an approved channel. This control does not block network access elsewhere in
the application or in spawned agents. Older POC artifacts built before this change
do not contain the control and must not be treated as protected.

## Supported versions

This is an early prototype. Security fixes target the `main` branch only.

| Version | Supported |
|---|---|
| `main` | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Use GitHub's **private vulnerability reporting**: the *Security → Report a
  vulnerability* tab on https://github.com/chaitanyagiri/munder-difflin, **or**
- Email **girichaitanya11@gmail.com** with a description, reproduction steps, and
  impact.

You can expect an acknowledgement within a few days. Once a fix is available we'll
credit you (unless you prefer to stay anonymous).

## Notes for reviewers

- Renderer ↔ main IPC goes through a typed `contextBridge` (`window.cth`); the renderer
  has no direct Node access (`nodeIntegration: false`, `contextIsolation: true`).
- Filesystem helpers enforce lexical and static realpath containment. Renderer
  root authorization, concurrent link replacement and other host access paths
  remain separate unresolved boundaries; this is not an OS sandbox.
- The hive's own committer does not prevent spawned agents from invoking Git or
  accessing credentials available to their execution environment. A worktree is
  not credential or repository isolation.
