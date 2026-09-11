# 2026-09-10 Pre-runtime governance reconciliation

Goal remains PAUSED; original31 criteria/authority/research questions unchanged.
No Electron process (including suspended), native tests, build, package, install, network,
remote Git, main merge/rebase or Starter writes occurred this cycle.

## Exact source boundary

Initial research/electron-security-poc HEAD: a3880c8840dc9604865a2c5a1ed9e25d75589e2f.
Main before/after: 3f53763fa4b82748e9e1ea6bff69e01fdfc52823. Final research HEAD: 802e534c9284b9a09db5b9425b0986be28a3953d.
Initial76 changed/untracked files are exhaustively enumerated with raw SHA256, byte size,
classification and disposition in candidate-2026-09-10.json. All original source bytes
were preserved; only tasks/todo.md was updated for this cycle. Newly created governance
report/inventory are outside the initial snapshot and intentionally remain local/untracked.
Full original tracked binary diff: .tmp/governance-20260910/tracked-before.patch;
SHA256 50d7f34a1f336815c32ab239722b710501285cd6237bf6b8b30fe92eb503bec2. Full staged patches for both commits also retained there.
Lock delta JSON covers all415 changed/added/removed package records (110/189/116).
Staged file lists were exact allowlists; each staged blob equaled worktree bytes after
CRLF normalization before commit. Index was empty before and after checkpoints.
No active non-sample Git hooks or signing override observed.

Existing local commits retained:
- 13a14b87a4b7656460b6797972c8e73b1b26d581: upstream updater source-disabled.
- a3880c8840dc9604865a2c5a1ed9e25d75589e2f: project IPC sender/renderer permission boundary.
Their historical tests were dirty-candidate evidence, not isolated full-app verification.

## New local checkpoints

1. 1aac5c1b23f4701c71f2f04789cb5d0ce9ce76b6: synthetic environment/runner and source identity foundation (5 paths).
   Fresh source-identity3PASS through research-run, .tmp/command-OMXDHU/command.log;
   unchanged historical environment use supports compatibility. Runner is an authorized
   entrypoint utility, not command authorization or OS isolation. Disk hash is freshness,
   not authenticity. `.tmp/` ignore keeps generated research data out of accidental add.
2. 802e534c9284b9a09db5b9425b0986be28a3953d: Electron43/SQLite13 migration, graph recovery and Windows native packaging
   (13 paths). Manifest/root lock dependency/engine fields match. Fresh packaging3PASS
   plus hook TypeScript check exit0 (396538). Read-only migration review completed.
   Prior profile packaging .tmp/command-VciQR2/command.log and packaged native2PASS
   .tmp/command-yexUe1/command.log remain valid historical component/artifact evidence.
   Lock, metadata helper, profile and build hook hashes match durable prior records.
   Native tests/build were NOT rerun. Not every source had historical hash binding;
   current focused evidence binds the staged candidate, not a clean-checkout full suite.
   Historical packaged artifact predates updater/root security work; it is NOT a current
   protected application. Inventory .tmp/package-profile-verified/artifact-inventory.json
   retains expected SHA256 b5a1a85bc07f08c70c3a74ec49d68f2156d40492c7230f05cf057f1f58155655.

## Retained semantic obligations

- root-consent12 files: reviewed source/synthetic tests cover document-session grants,
  static confinement, revocation and selected refusal handling. b1CJzM15PASS,
  ndw8OG27PASS; most final hashes match todo, fs/git complete historical hash binding
  absent. Preserve as mixed/incomplete root integration: remaining consumers and native
  dialog/reload/crash behavior cannot be included as finished. Eligible future bounded
  research-source checkpoint after explicit scope/verification, not forced this cycle.
- windows-compatibility5 files: POSIX socket semantics and Windows-only test assumptions.
  Historical focused3/9/5/9PASS; source provenance identifiable but no complete exact
  current-source binding. Cheap focused rerun required before future independent commit.
- native-job-probes17 files: completed individual probes coexist with shared evolving
  guard/native classes. AUT9tl current source snapshot matches fully; QPx8v2 differs in
  native class; qyWT7H differs in four sources. Keep old PASS as dated mechanism evidence.
  Do not assert a single current native matrix PASS or force unfinished integrations in.
- lifecycle-research19 files: static contracts and suspended admission completed;
  qbByvN hashes all match, workload NOT_RUN_SUSPENDED / cleanup PROCESS_EXIT_OBSERVED.
  Running wiring is incomplete. Legacy disabled spawn/taskkill still needs replacement.
  Shared receipt writer remains with this cohort; committing it without its existing
  mixed lifecycle receipt tests would obscure verification responsibility.
- suite-runner1 file: identifiable local research tool, but historical rAkywJ suite log
  has no exact current runner identity. Mark evidence-unbound, preserve; no claim unknown
  authorship is resolved by old PASS. No other inspected source was unattributable to
  an obligation; individual coverage gaps remain explicit in inventory.
- governance4 initial files plus new report/inventory: durable local records/contracts,
  intentionally untracked, latest resume entry supersedes dated ACTIVE wording.

## Rollback and next milestone

Foundation and migration are separate local rollback boundaries. Do not reset/clean dirty
work. A future reviewed revert of migration (802e534c9284b9a09db5b9425b0986be28a3953d) must also reconcile installed packages
in an isolated locked environment; reverting source alone does not restore node_modules
patches, binaries or old artifacts. Foundation is depended on by migration documentation
and native test instructions: revert migration first if removing both. Never remove .tmp
research evidence. Kept dirty files can be compared with inventory hashes, not discarded.

Before running lifecycle: replace old parent with retained-helper supervision; bind fixed
invocation + explicit map into running monitor, lifecycle workload/cleanup/outer deadlines,
structured result/source verification and persistence-failure handling. Preserve deny gate
until deterministic inert integration tests and appropriate review support opening it.
Suspended creation is not callbacks, sandbox-child compatibility or Job-empty proof.
Root consumers, native consent, in-flight cancellation, concurrent path/Git indirection,
other IPC/credential/network boundaries and two high TOML/Tunnelmole findings remain open.
No release/company-readiness claim. Recommended next milestone: one coherent fixed
running-supervisor input/monitor/result slice tested with inert workload before Electron.

## Per-path disposition

Full raw hashes/evidence-source comparisons are in the JSON inventory; table below is
exhaustive for the76 initial files. Commit status is source history, not runtime approval.

| Path | Semantic group | Disposition |
| --- | --- | --- |
| `.github/workflows/ci.yml` | migration | committed |
| `.github/workflows/release.yml` | migration | committed |
| `.gitignore` | foundation | committed |
| `CONTRIBUTING.md` | migration | committed |
| `SECURITY.md` | root-consent | retained-mixed |
| `electron-builder.yml` | migration | committed |
| `package-lock.json` | migration | committed |
| `package.json` | migration | committed |
| `src/main/fs.ts` | root-consent | retained-mixed |
| `src/main/git.ts` | root-consent | retained-mixed |
| `src/main/index.ts` | root-consent | retained-mixed |
| `src/preload/index.ts` | root-consent | retained-mixed |
| `src/renderer/src/components/GitTab.tsx` | root-consent | retained-mixed |
| `src/renderer/src/components/terminalPool.ts` | root-consent | retained-mixed |
| `src/renderer/src/ide/GitPanes.tsx` | root-consent | retained-mixed |
| `src/renderer/src/ide/IdePanel.tsx` | root-consent | retained-mixed |
| `src/shared/codexRemote.ts` | windows-compatibility | retained-complete-needs-exact-source-test |
| `test/agent-token-cap.test.cjs` | windows-compatibility | retained-complete-needs-exact-source-test |
| `test/cli-install-ladder.test.cjs` | windows-compatibility | retained-complete-needs-exact-source-test |
| `test/codex-remote.test.cjs` | windows-compatibility | retained-complete-needs-exact-source-test |
| `test/ide-image.test.cjs` | root-consent | retained-mixed |
| `test/renderer-sandbox.test.cjs` | root-consent | retained-mixed |
| `test/transcript-project-dir.test.cjs` | windows-compatibility | retained-complete-needs-exact-source-test |
| `tools/patch-node-pty-conpty.cjs` | migration | committed |
| `build/native-dependencies.cjs` | migration | committed |
| `electron-builder.win.yml` | migration | committed |
| `src/main/projectRoots.ts` | root-consent | retained-mixed |
| `tasks/lessons.md` | governance | retained-durable-local |
| `tasks/todo.md` | governance | retained-durable-local |
| `tasks/windows-environment-contract.md` | governance | retained-durable-local |
| `tasks/windows-supervisor-contract.md` | governance | retained-durable-local |
| `test/native-modules.electron.test.cjs` | migration | committed |
| `test/packaging-dependencies.test.cjs` | migration | committed |
| `test/research-job-argv.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-budget.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-controls.test.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-env.test.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-environment.test.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-files.test.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-fixture.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-forwarding.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-job-run.test.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `test/research-lifecycle-callbacks.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-content.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-environment.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-helper.ps1` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-invocation.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-invocation.test.ps1` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-receipt.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-result.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-lifecycle-run.test.cjs` | lifecycle-research | retained-partial-integration |
| `test/research-source-identity.test.cjs` | foundation | committed |
| `tools/patch-tunnelmole-metadata.cjs` | migration | committed |
| `tools/research-argv-test.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-electron-lifecycle.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-env.cjs` | foundation | committed |
| `tools/research-forwarding-test.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-job-descendant.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-job-environment.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-job-preflight.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-job-preflight.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-job-run.ps1` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-lifecycle-callbacks.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-content.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-environment.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-helper-test.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-invocation.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-receipt.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-result.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-lifecycle-run.cjs` | lifecycle-research | retained-partial-integration |
| `tools/research-native-failure-test.cjs` | native-job-probes | retained-completed-probes-in-mixed-cohort |
| `tools/research-run.cjs` | foundation | committed |
| `tools/research-source-identity.cjs` | foundation | committed |
| `tools/research-test.cjs` | suite-runner | retained-evidence-unbound |
| `tools/research-write-receipt.cjs` | lifecycle-research | retained-partial-integration |
| `tools/setup-native.cjs` | migration | committed |
