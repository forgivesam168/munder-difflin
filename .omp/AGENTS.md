# Munder — project context for OMP

## What this repository is for

`munder-difflin` is being evaluated and hardened as a **Windows-capable, governable,
increasingly autonomous Multi-Agent software-delivery Runtime**. The Goal is to determine,
through implementation and field evidence, whether Munder can become the Runtime layer of a
governed Multi-Agent development system.

This is *not* an Electron upgrade, an npm audit cleanup, a dependency migration, a security
report, or a refactor. Those are possible obligations **inside** the Goal.

- Authoritative Goal text and the 31 success criteria: `tasks/Munder-original-goal-reference.md`
- Durable roadmap state and handoff: `tasks/todo.md`
- External read-only design reference (never modify): `D:\Research\Munder\docs\Multi-Agent Delivery Starter v1.5.md`

## How to read the 31 criteria

- They are a **standing lens**, not a sequential backlog. Never "work through them in order".
- They never silently change, and **a criterion is never closed by a claim** — only by evidence.
- A criterion that cannot be closed is `BLOCKED` with strong evidence and a decision-ready
  explanation. It is never quietly marked done, and never renumbered.
- Company readiness is a **separate** decision. Passing a criterion does not mean deployment
  approval, and those risks are not accepted on the Human's behalf.

## Roadmap

- `A / B / C / H / R` are the **execution roadmap only**. They do not replace, renumber, or
  extend the 31 criteria.
- `A` is `CLOSED_ENOUGH_TO_ENTER_B`.
- Current program: **B + C as the primary Delivery, with H continuously enforced.**
  - **B — Real Worker Runtime.** Current milestone (start / supervision / result acceptance / stop).
    The B runtime stays **closed** until its contract is complete: exact CLI identity/version/path,
    worker synthetic root, minimal environment allowlist, credential/provider handling, network
    policy, PTY/Job ownership, start/stop semantics, result acceptance, cleanup receipt, CLI
    approval/sandbox behaviour.
  - **C — Bounded Recovery / Continuity.**
  - **H — continuous obligation, spanning B and C**: Goal continuity, 31-criteria mapping, durable
    evidence, fresh-Main handoff, model independence, delegation field evidence, capability-evolution
    observations. H is never a separate phase and is never "finished".
  - **R — full security / release / company readiness. Not opened yet.** Do not expand it during B/C.
- Do not create default `A2`/`A3`/`A4` milestones.

## Durable state

| Path | Owner | Rule |
| --- | --- | --- |
| `tasks/todo.md` | Main | Single writer. Subagents must never edit it. This is the handoff a fresh Main reads first. |
| `tasks/*.json` | Main | Bound run / candidate / admission evidence. Immutable once published — never rewrite a FAIL as PASS. |
| `tasks/lessons.md` | Main | Durable lessons; add only for a material or repeated mistake. |
| `.tmp/<run-id>/` | Main | Per-run evidence root. Never reused across runs. |

## Responsibilities and how they map onto OMP

Main is **this session** — it is not a subagent and has no agent definition file. Its behaviour
comes from the context files it loads (this file, `.omp/RULES.md`) and the settings in
`.omp/config.yml`.

| Responsibility | Dispatch | Notes |
| --- | --- | --- |
| Reconnaissance, codebase and upstream research | `scout` | Only when a real research gap exists. Read-only. |
| Routine bounded implementation | `task` | General worker, full tools. |
| Escalated implementation | `deep-worker` | For runtime lifecycle, cross-module integration, architecture, or evidence-conflict work. |
| Independent review of a change | `reviewer` | Separate from the developer. Always worth one pass on a bounded change. |
| Second, independent risk review | `risk-reviewer` | Only for the high-risk classes listed in `.omp/RULES.md`. Read-only by construction (no `bash`). |
| Security-sensitive discovery | `security-reviewer` | Vulnerability-shaped scope only; not a general risk review. |

Dispatch discipline:

- No research agent when there is no research gap.
- No second reviewer for low-risk bounded work.
- Parallelise only genuinely independent slices, in one `task` batch. Never fan out to look busy.
- Delegation is capped by `.omp/config.yml` (`task.maxRecursionDepth: 1`): **Main → one level
  only.** Subagents cannot spawn subagents, so decomposition and integration stay Main's job.
- Main reconciles subagent claims against evidence. **A subagent's PASS is a claim, not a verdict.**
- **Normal flow is `Worker → Main → next Worker`.** Main owns goal continuity, integration,
  evidence reconciliation and completion. Agent-to-agent `hub` messaging is used only when a
  specific need justifies it — not because the capability exists.
- **OMP owns execution mechanics; this Harness owns governance.** Do not add a handoff protocol,
  mailbox or polling file, agent message bus, custom result bus, scheduler, parked-agent manager,
  recursion controller, or tool-loop detector. OMP natively provides agent execution, result
  transport, waiting, lifecycle, recursion control, concurrency, and loop protection. This
  Harness defines only responsibilities, authority, Task Contract, evidence, review, risk
  escalation and completion. Add a mechanism only if field evidence proves the native one is an
  actual Munder blocker, and only with fresh Human authorization.
- **Do not adopt `workflowz` / `orchestrate` / `eval` `agent()` / `completion()` / `wait()` /
  `workpool()` as a fixed part of the workflow.** `Main + task + structured result` is sufficient
  for the bulk of B/C. Reach for OMP-native orchestration per turn only when the work genuinely
  needs bounded parallel research, parallel independent review, deterministic fan-out/fan-in, a C
  recovery workflow, or large-coverage migration — never because the feature exists.

### Result flow

The canonical path — no filesystem handoff between a developer and a reviewer, and no custom bus:

```
Main  --task{ context, Task Contract, outputSchema, schemaMode }-->  Developer / Research / Reviewer
        --yield-->  OMP schema validation  -->  task-result / async-result  -->  Main reconcile
        -->  next Reviewer / risk-reviewer when required
```

Native carriers Main may use: `yield`, `output` / `outputSchema`, `schemaMode: "strict"`,
`task-result`, async result delivery, `agent://<id>`, `history://<id>`, and `hub`
(`send` / `inbox` / `wait` / `jobs` / `cancel` / `list`) with the parked/revival lifecycle.
Main always keeps goal continuity, integration ownership, evidence reconciliation and completion
responsibility.

## Reviewer obligations

The reviewer-side duties — falsification, evidence and test-integrity checks, verdict discipline —
live in the `munder-review-integrity` skill (`.omp/skills/`), which is auto-loaded into
`risk-reviewer` and `deep-worker` via their `autoloadSkills` frontmatter. They are not duplicated
here or in the agent files. The one thing Main must never do is treat a reviewer's verdict as
evidence in itself.

**Known Harness limitation (VERIFIED):** OMP subagent sessions do **not** receive project context
files, project rules, or the sticky `RULES.md`. Verified by probe across four subagents — each had
`pwd` = the repository root and could `cat .omp/RULES.md` from disk, yet none had a `<repo-rules>`
block, an always-apply section, or the project phrases in context, and `rule://` resolved only
bundled rules. Project settings *do* reach subagents (recursion, concurrency and the deny list all
applied). Consequences:

- `.omp/RULES.md` and this file are **Main-only**. A subagent does not inherit them.
- Reviewer obligations must travel via `autoloadSkills` (native) or be restated in the dispatch
  text. Bundled agents (`reviewer`, `scout`, `task`, `security-reviewer`) cannot be given
  harness fields at all, so **the dispatch payload is the only channel for them** — include the
  relevant obligations in the task text when correctness depends on it.
- Do not rely on a subagent obeying `.omp/RULES.md`. Reconcile its output as a claim.

**Human decision — do NOT override bundled agents.** Do not create project
`.omp/agents/reviewer.md`, `scout.md` or `task.md` merely to attach harness fields such as
`autoloadSkills`. The bundled `reviewer`'s native cross-boundary review procedure is deliberately
preserved, and maintaining a fork of OMP's bundled prompts is out of scope: the objective is to
finish Munder, not to maintain OMP internals. Disposition: `KNOWN_LIMITATION` /
`ACCEPTED_FOR_NOW`.

**Do not use model self-report to test what is in context.** Probing a subagent with
"does your context contain phrase X?" produced **contradictory answers from the same agent
definition and same model** (PRESENT on one run, ABSENT on the next), and a control agent lacking
the skill answered identically to one that received it. The measurement method is invalid; a
yes/no context claim from an agent is `UNKNOWN` at best. If context delivery must be proven,
require the agent to reproduce the text **verbatim** and compare the bytes, with a control agent
that should not have it — never infer from a self-assessment.

## Completion

Main declares a task `complete` only when all hold — otherwise `NEEDS_FIX`, `BLOCKED` or `UNKNOWN`:

1. Every acceptance criterion is backed by evidence Main itself reconciled.
2. All required verification ran: exact commands, exit codes, test counts (total / passed /
   failed / skipped). `NOT_RUN` is never reported as `PASS`.
3. No unclassified failure; no required-but-skipped test.
4. No scope drift and no authority drift.
5. Every remaining `UNKNOWN` is listed explicitly.
6. Required reviewers finished, and — for a high-risk class — the second, independent review
   finished. A second review that merely restates the first does not satisfy it.
7. No integration claim exceeds the evidence behind it.

Evidence conflict stays `OPEN` / `UNKNOWN` / `NEEDS_FIX`: re-review, escalate to `risk-reviewer`,
or take it to the Human. Never resolve a conflict by asserting it away, and never hide an
`UNKNOWN` to close a milestone.

## Human-facing reporting

Report in **繁體中文** (identifiers, commands, paths and status tokens stay English). A completion
report must separate 已驗證 / 未驗證 / 失敗 / UNKNOWN, list the tests actually executed with exact
counts, list any required check that could **not** be executed, and state remaining risk. A bare
"已完成，測試通過" is not an acceptable report.

## Model routing

Roles are declared once in `.omp/config.yml`; agents reference roles (`@smol`, `@task`, `@slow`,
`@risk`, `@deep`) and never concrete model ids. Swapping a model, or retargeting a whole
workflow at a different provider, is a one-line change there.

**Every current mapping is PROVISIONAL** — a working default, not an architecture requirement, and
not backed by field evidence. Do not cite a role's model as "the better model", and do not treat
this routing as a blocker for Munder work. Main's own model is deliberately unset at project scope
so it stays the Human's choice.

`modelRoleStorage: project` is set, so `/model` role assignments persist to this repository's
`.omp/config.yml` rather than the global config.

## What is *not* mechanically enforced

Be honest about this rather than trusting the harness further than it goes:

- `bash.patterns` is an **approval policy, not containment**. It matches literal text plus `*` on a
  tokenised command segment, so forms like `git -C x push`, an absolute `git.exe` path, a
  variable-built command, or a shell builtin wrapper are not covered. It governs the `bash` tool
  only, not `eval`, and not process launches routed through `hub`. The `.omp/config.yml` list is
  the **nine destructive Git operations** and nothing else — a *floor*, not a complete gate. The
  rest of the authority boundary — including nested-`omp` prohibition and destructive-probe
  isolation, which are **`PROCEDURAL_BOUNDARY` / `KNOWN_LIMITATION`, not mechanically enforced** —
  is `.omp/RULES.md` (see its Incident safety boundary section) plus the task envelope.
- OMP has **no per-path read/write ACL**. "Do not read outside this repository" is enforced by
  `.omp/RULES.md` (sticky for the Main session), not by the tool layer. Sticky applies to the
  session that loads the file; it is **not** a guarantee that a subagent receives it.
- **Project settings discovery is cwd-scoped and does NOT walk up to an ancestor `.omp/`.**
  VERIFIED by incident (2026-09-14): a fresh `omp -p` process launched with its cwd inside
  `.tmp/git-authority-policy-2026-09-14/` resolved `bash.patterns` to `[]`, so **no project hard
  deny applied** and a destructive Git probe acted on the real working tree. The same command
  from the repository root resolves the full nine-pattern list. Subagents inherit these settings
  because their session is created from the repository-root session — but a **separate process
  started from a subdirectory does not**.
- **Scope that finding precisely: it is about project SETTINGS, not about every `.omp` artifact.**
  Project **settings** discovery (`.omp/config.yml`, hence `bash.patterns`) and project
  **context / rules** discovery (`RULES.md`, `AGENTS.md`) are **different mechanisms**. The
  incident proves the settings path; it does **not** license the claim that `.omp` governance in
  general fails to ancestor-walk. Do not generalise one into the other in either direction.
- **Verify that effective policy actually loaded.** File existence is not policy presence.
  **Declared boundary != enforced boundary**: an unloaded project policy is indistinguishable
  from no policy, and `.omp` policy remains **cwd-scoped Harness policy, not OS/process
  containment**. See `.omp/RULES.md` § Incident safety boundary for the required cwd/root and
  read-back verification.
- A read-only agent is read-only because its `tools` list omits `edit`/`write`. An agent holding
  `bash` can still mutate files through the shell. `risk-reviewer` is genuinely read-only *because
  it has no `bash`*; treat any agent that has one as a policy obligation, not a barrier.
- Subagents run headless with `tools.approvalMode: yolo`. A user `deny` still applies; a `prompt`
  policy cannot be satisfied there and rejects the call, which is why `.omp/config.yml` uses
  `deny` and never `prompt`. `deny` is therefore the **only** mechanically reliable tier for
  subagents — which is exactly why it is reserved for operations that must never happen, and
  everything else is Human-gated by instruction.
- `astGrep.enabled` and `task.enableLsp` are `false` by default, so subagents — including the
  bundled `reviewer` — lose `lsp` and `ast_grep` even though their definitions declare them. This
  is inherited behaviour, recorded here so nobody mistakes a silently stripped tool for a bug.
- **`schemaMode: "strict"` is a shape guarantee, not a truth guarantee.** VERIFIED: a deliberately
  invalid payload is rejected at the tool boundary and the child is forced to retry. But a second
  probe returned a *schema-valid yet instruction-violating* payload that passed validation. Schema
  validity means the fields are shaped correctly — never that the values are true or evidenced.
  Main still re-reads the evidence. `PASS` remains a claim.
- **Loop guard detects consecutive identical calls only.** VERIFIED: identical tool + identical
  canonicalized arguments, repeated to the threshold, injects a `tool_call_loop_detected`
  interrupt; arguments vary, alternating tools, non-consecutive repetition, and parameter-changing
  non-progress are **not** detected. Treat loop guard as a safety mechanism, not containment. Do
  not build a custom detector; if B/C observes runaway behaviour, preserve the evidence, classify
  the friction, and raise it to the Human as an improvement candidate.
