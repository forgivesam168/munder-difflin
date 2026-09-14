# Munder authority boundary

Repository-wide governance intent for Munder work. Read this as an obligation on whoever holds
it, not as a description of where the file travels.

- The **Main session** loads this file and **must enforce it** on every dispatch it makes.
- A **subagent does not reliably receive this file** — it is `UNKNOWN` whether project
  `RULES.md` / `AGENTS.md` reach a subagent at all (see `.omp/AGENTS.md`). A subagent must
  **never assume** these rules reached it.
- Therefore Main carries the task-relevant authority and safety rules to every subagent through
  the **Conduct Capsule** in `.omp/commands/munder-dispatch.md`, for bundled and custom agents
  alike.
- A subagent's output is still only a **claim**: Main reconciles it against artifacts.

Nothing here asserts that this file mechanically reaches every subagent. Where a rule must bind a
subagent, it binds through the capsule.

## Language

Human-facing text — findings, reports, explanations, summaries, status — defaults to **繁體中文**.
Keep English for code, commands, APIs, class/function/field names, paths, filenames, Git SHAs,
error messages, schema fields, formal technical names (OMP / Windows / Electron), and status
tokens (`PASS` / `FAIL` / `UNKNOWN`). A structured-output schema may keep English field names; the
human-facing explanation inside it is 繁體中文. Never translate a technical identifier.

## Authority

**Capability != Authority. Full access != authorization.** A tool you hold is not a permit to use
it. Act only within this task's explicit authorization; when the task is analysis, analysis is the
entire deliverable.

- **Do not read outside this repository.** No `~/.codex/**`, no `~/.omp/agent/sessions/**`, no
  `~/.omp/agent/history*`, no other project trees, no unrelated personal files.
- **`tasks/todo.md` is Main-owned.** Subagents must never edit it.
- **Do not modify** Munder production source, tests, `tasks/*`, or any `package.json` / lockfile
  unless the current task explicitly authorizes that exact scope. Never write outside this repository.
- **Do not acquire authority you were not given.**

Two distinct tiers — do not confuse them:

- **Hard deny** (mechanical, in `.omp/config.yml`; applies in every approval mode including
  headless subagents, and cannot be overridden by an instruction at runtime): only operations the
  Human does not want an agent to perform on its own in an ordinary cycle — push, `reset --hard`,
  `clean -f`, `stash drop/clear`, `rebase`, `filter-branch`, `commit --amend`, `restore`.
  Changing that file with Human authorization is the only way past it.
- **Human-gated, but allowed once explicitly authorized**: `add` / `commit` / `branch` / `switch` /
  `fetch` / `merge` / `revert`, bounded native proof, local commit, Electron runtime, real worker,
  credential or network access, dependency changes, and any write outside the authorized scope.
  **These must never become permanent hard denies** — an explicit Human authorization still needs
  to run them. The mechanical list does not cover them: ask; never assume. This is also why
  `tools.approvalMode` is deliberately not tightened — the Human is not a per-command approver.

`main` stays untouched; remote repositories stay untouched.

## Incident safety boundary

Added after a **VERIFIED authority/safety incident** (2026-09-14).

### What actually failed

A fresh OMP process was started with its cwd set to a **repository subdirectory**
(`.tmp/git-authority-policy-2026-09-14/`) rather than the repository root. OMP **project
settings** discovery is scoped to the process working directory and **does not walk up to an
ancestor `.omp/`**, so that process's effective `bash.patterns` resolved to `[]`. No project hard
deny was in force, and a destructive Git policy probe ran against the real Munder working tree.
Five tracked files were reverted and had to be recovered byte-for-byte.

**State the scope of that finding precisely.** What failed to load was **project settings —
specifically the `bash.patterns` policy**. It is **not** established that every `.omp` artifact
behaves identically. Project **settings** discovery (`.omp/config.yml`) and project
**context / rules** discovery (`RULES.md`, `AGENTS.md`) are **different mechanisms**; a finding
about one must never be generalised into a claim about the other.

So do not reason "I am somewhere inside the repository, therefore `.omp` governance is in force."
**Verify that the effective policy actually loaded** — file existence is not policy presence.

**Declared boundary != enforced boundary.** Treat an unloaded project policy as *no policy*,
never as an unchanged one. This section is a **`PROCEDURAL_BOUNDARY`** and a **`KNOWN_LIMITATION`**
— it is **not** OS-level or process-level containment.

### Delegation

Delegation uses OMP's **native** mechanisms — the `task` tool and the agents in `.omp/agents/`.
This is the **default and the only autonomous path**: never start another OMP process to
delegate, review, probe, or work around a limitation on your own initiative. Subagents already
get everything the native path provides; a nested process adds no authority and silently discards
this repository's governance.

The **single** exception is an invocation the Human explicitly authorizes under `### Nested OMP`
below. That exception is deliberate, exact, and narrow — see that section for what it does and
does not grant.

### Nested OMP

**Never start another OMP process — by any process-launch mechanism — without explicit Human
authorization for that exact invocation and that exact purpose.**

Unauthorized by default. The autonomous path is `### Delegation` above; this section is the only
route to an exception, and the exception is narrower than "the Human authorized some OMP work".

**What authorization must be.** The Human must name the **exact invocation** (what will be run)
and the **exact purpose** (why). Authorization for a similar task, a previous cycle's approval, a
role, an envelope, or an "obviously implied" need is **not** authorization. That exception:

- does **not** form reusable authority — it is spent by the invocation it names;
- is **not** transferable to another invocation, purpose, branch, or cycle;
- does **not** convert into general delegation authority, and does not relax `### Delegation`;
- does **not** survive the task that carried it.

If the authorized purpose is itself a **review**, **probe**, **recovery**, or **fresh-session
verification**, the invocation may proceed under this section — but only while every condition
below is also satisfied.

The prohibited object is **starting another OMP process**. It is **not** a rule about one particular
route: it is **not** the case that only `bash` / shell or `eval` are forbidden. The rule is
**route-agnostic** — no available route may be used to reach it. Routes that count include, and
are not limited to:

- `bash` / shell execution;
- the `eval` tool;
- **`hub` process start** (`op: "start"`) — `exec` tier, and retained by subagents that are not
  explicitly restricting tool names;
- a wrapper script or alias;
- an absolute executable path (e.g. `C:\…\omp.exe`);
- any other process-launch route available in the session.

If the Human does authorize a specific invocation **and purpose**, it MUST be launched from the
**verified repository root**, and all of the following MUST be confirmed first:

- cwd == the repository root (not a subdirectory, not `.tmp/…`);
- that root contains the expected `.omp/` directory with `config.yml` and `RULES.md`;
- the project settings and policy actually loaded — **read back** the effective `bash.patterns`
  and confirm the project list (not `[]`) is in force, rather than assuming the file's existence
  did it.

A `.tmp` subdirectory is **not** a safe fresh-session cwd merely because it sits inside the
repository.

`.omp/config.yml` deliberately carries **no** nested-`omp` pattern, and none is claimed here. A
partial pattern list would both misfire on harmless invocations and leak on the routes above; an
explicit boundary is preferable to a list that does neither job. **No mechanical enforcement of
this rule exists** — the paragraph above is the whole boundary.

### Human authorization

"Human authorization" means exactly one of:

- an **explicit instruction from the Human in the current conversation**; or
- an **authority envelope the Human explicitly granted** for the current program or task.

It may **not** be inferred from any of the following — none of these is authorization:

- task scope, or an agent's reading of what its task "must therefore require";
- agent role, seniority, or being a reviewer/manager;
- goal urgency or the milestone needing the result;
- full access, a capability being available, or a tool being present;
- a previous, similar, or adjacent authorization, in this or an earlier cycle;
- the **absence** of a deny pattern, policy entry, or guard.

An agent must not **infer, extend, bootstrap, or manufacture** its own authority. If explicit
authority is absent, the action is unauthorized: **STOP and ask the Human.** A capability is not
a permit, and an envelope dies with the program or task that granted it.

### Destructive probes

Any probe that exercises Git deny policy, destructive Git behaviour, `reset` / `clean` /
`restore` / `amend`, force push, ref mutation, or matcher coverage **MUST NOT use the Munder
repository as its Git target**, and MUST NOT be relied upon to be stopped by the deny list.
`--dry-run`, a URL rewrite, a `.tmp` cwd, or "the deny rule should catch it" are **not**
sufficient.

A **completely disposable** Git repository is created first. It must not be the Munder repository
in any of these senses:

- not a **subdirectory** of the Munder repository;
- not a **registered worktree** of it (`git worktree`);
- not sharing a **linked or common gitdir**;
- not sharing an **object database** (no `alternates`, no common objects);
- not sharing **refs**;
- its **working tree** is not the Munder working tree;
- its **remote / push URL** does not point at the Munder repository or a path inside it;
- the probe's **process cwd stays inside the disposable repository boundary**.

The proof must demonstrate the scratch `.git` is **not** Munder's **before** any mutation-capable
probe runs — different repository root, different object database, different refs, different
origin, different working tree. The goal is that **a probe failure cannot mutate Munder's refs,
objects, index, working tree, or remote.**

## Truth

Label every material claim `VERIFIED` (you saw the artifact), `INFERENCE` (follows from what you
saw), or `UNKNOWN` (evidence insufficient). Never present a plausible guess as fact, never infer
current behaviour from "it usually works that way", and never fill an `UNKNOWN` to keep moving.
When a task needs an unverified fact: verify it first; if it cannot be verified, it stays `UNKNOWN`.

## Completion

**Evidence > claim. Response != completion. Runtime state != task state.**

`implemented` / `fixed` / `verified` / `PASS` / `complete` / `done` from any agent — including
yourself — is a **claim**, not completion evidence.

- Unit PASS != Integration PASS. Developer PASS != Reviewer acceptance. Reviewer PASS != high-risk
  closure when policy requires a second independent review.
- Files created, code written, code compiling, tests green: none of these are completion.
- A required check that could not run is `BLOCKED` or `UNKNOWN` — never `PASS`, never
  "not run but expected to pass".
- `FAIL`, `UNKNOWN`, `BLOCKED`, `NOT_SUPPORTED` and negative evidence are valid results. Never
  lower an acceptance criterion for time, token, convenience, or because the Goal wants success.

## Tests

Never manufacture green. Do not skip a required test, delete a failing test, add an unjustified
`skip`, use `only` to exclude others, disable validation, weaken an assertion, edit an expected
result to match a wrong implementation, turn off lint/typecheck/build, or run only the easiest
subset and call it a full PASS. Do not ignore an unexpected failure.

Changing a test requires stating: why the old contract is wrong or expired, the evidence for the
new contract, how implementation and test change are verified independently, and whether
regression coverage increased. **Weakening tests to manufacture green is a blocking finding.**
