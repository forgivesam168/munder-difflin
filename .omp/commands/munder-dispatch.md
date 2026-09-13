---
description: Render the bounded-task dispatch contract for a Munder task
---

Dispatch the Munder task below. Follow this contract exactly; it exists so authority, scope and
evidence stay bounded and so the result can be reconciled without replaying context.

TASK: $ARGUMENTS

Before dispatching, decide and state:

1. **Research gap?** Is any unresolved fact needed (upstream behaviour, an API contract, how the
   current code actually works)? If yes, dispatch `scout` for it first — and only that. If no,
   say `NONE` and skip; a research agent with nothing to resolve is pure overhead. A fact this
   task turns on that nobody has verified stays `UNKNOWN` until someone does — never fill it in.
2. **Execution owner.** `task` for routine bounded work; `deep-worker` when the path is a
   Windows/Electron runtime lifecycle, process ownership, native boundary, cross-module
   integration, architecture, or evidence conflict. State which, and why.
3. **Risk class.** Does it hit any class in `.omp/RULES.md` (security-sensitive, native/process
   ownership, credential, network, filesystem authority, Electron/IPC privilege, updater,
   plugin/Skill/MCP authority, destructive Git transition, security finding, `UNKNOWN`→`PASS`,
   production enablement, difficult-to-reverse architecture, evidence conflict)?
4. **Authority tier.** Is anything here **hard deny** (cannot be authorized at runtime — the
   pattern must be changed in `.omp/config.yml` with Human approval), or **Human-gated but
   allowed once explicitly authorized**? Name it, and stop there rather than assuming the answer.

Then dispatch with a task body containing all of:

- **Target** — exact files, symbols and paths; explicit non-goals.
- **Change** — the specific add/remove/rename, with the existing pattern to follow.
- **Acceptance** — the observable result, and the command that demonstrates it.
- **Authority** — what this dispatch may and may not touch, including writes and Git.
- **Conduct** — the rules a subagent does **not** inherit. Subagents receive none of `.omp/RULES.md`,
  `.omp/AGENTS.md`, or this command. For a bundled agent (`reviewer`, `scout`, `task`,
  `security-reviewer`) the task text is the **only** channel. Main assembles this capsule
  automatically from the Harness on every dispatch — **the Human must never be asked to re-paste
  it each cycle.** Keep it minimum-sufficient: the responsibility, Task Contract, authority,
  acceptance criteria, required evidence, the `FACT`/`INFERENCE`/`UNKNOWN` discipline,
  `Evidence > Claim`, Test Integrity, Completion Integrity, 繁體中文 human-facing output, and the
  task-specific stop conditions — **not** the whole of `.omp/AGENTS.md` or `.omp/RULES.md`.
  Whenever the work touches code, evidence or a report, include: no reading outside this
  repository; no Git state change, no commit, push, reset, clean or stash; no writes outside the
  authorized scope; never convert `UNKNOWN` to `PASS`; `NOT_RUN` is never `PASS`; a negative
  result is a valid outcome; never weaken a test to manufacture green.
  Do **not** treat a custom agent's `autoloadSkills` as a substitute for this capsule: whether that
  skill reliably reaches a subagent is currently `UNKNOWN` (see `.omp/AGENTS.md`). Send the capsule
  for every agent, custom or bundled.
- **Evidence** — exactly what must come back: the commands run, their exit codes, test counts
  (total / passed / failed / skipped), exact changes, artifact identity, and any `UNKNOWN`.
  Tell the worker that `NOT_RUN` is never `PASS` and that a negative result is a valid outcome.

After the worker returns:

- **Reconcile, do not accept.** Re-run or re-read the evidence yourself. Only what an artifact
  shows is `VERIFIED`; a worker's `PASS` is a claim. Check the diff for scope drift and the log
  for authority drift, and look for unexplained filesystem or runtime effects.
- Dispatch `reviewer` on the change. Dispatch `risk-reviewer` **only** if (3) was answered yes,
  and state explicitly that it is a second, independent review that must contribute a *different*
  check — a restatement of the first review does not complete it.
- Apply the `complete` gate in `.omp/AGENTS.md` condition by condition. If any condition fails,
  the outcome is `needs fix` / `blocked` / `unknown` — never `complete`.
- Never invent the missing evidence, never accept agent confidence as evidence, and never hide an
  `UNKNOWN` to close the task. Evidence conflict stays open: re-review, escalate, or ask.
- Write durable state to `tasks/todo.md` (Main-owned; no subagent may write it), recording the
  outcome, the evidence actually seen, and what a fresh Main would need.

Report to the Human in 繁體中文, separating 已驗證 / 未驗證 / 失敗 / UNKNOWN.
