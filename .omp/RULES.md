# Munder authority boundary

Applies to every session in this repository, including subagents, developers and reviewers.

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
