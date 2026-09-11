# 2026-09-11 Actual read consumer native IPC candidate

Current outcome 2026-09-11: authorized actual-read fixture aFH8ku PASS, normal renderer
content delivery and same-document revoked-read result rejection; actual reads completed.
Job root/helper0/member/active0, all3 gates restored. Evidence and scope limitations:
native-read-run-2026-09-11.json and latest todo section. Authorization consumed.
Below prior/candidate statements are historical, not standing runtime authority.

NODE_VERIFIED_NATIVE_NOT_AUTHORIZED. All3 gates false. One proposed command:
node tools/research-run.cjs tools/research-electron-lifecycle.cjs
'C:/Program Files/PowerShell/7/pwsh.exe'

Existing27-source native IPC fixture extended to29 inputs, adding production fs.ts and
its imageTypes.ts runtime import. No production source edits. Fixed preload adds only
readControl/readRevoked requests, no arbitrary roots/channels/payloads. Research channel
uses actual extracted production wrapper; synthetic consent remains fixed to run.
Listener calls actual readFileText(canonicalRun, 'ipc-read-fixture.txt'). That file is
created exclusively (wx) inside the new run with fixed synthetic content. Normal read
must deliver expected content; revoked read directly revokes the grant before readFileText,
requires successful actual read, then requires renderer-side invoke rejection. Both real
read completions asserted. No native dialog or actual fs:readFile registration claim:
this exercises the real consumer function through the fixed research IPC channel.
Prior2 synthetic constant requests and reload/renderer termination/destroyed scenarios
remain included. New fifth bound-result assertion required; old4 checks rejected.

Node protocol3PASS8RnpQv, binding3PASSG8tBnn; syntax2PASS. Protocol uses VM transport,
real synthetic file/consumer/grants and production wrapper. Normal wrong reply and read
wrong reply fail with handler removal. No native execution evidence for new source29.
Prior mgQ27v remains historical PASS bound to its own27-input sources. Legacy v1 result
logic untouched; expensive/native tests not rerun without new justification.

Fresh Human one-attempt risk acceptance required. Recheck source29, binaries, both gate
copies from native-read-2026-09-11.json, then temporarily open3 gates. Preserve existing
synthetic environment, sandbox/context isolation, exact URL filter, deny permissions,
25s fixture/40s native/10s cleanup/85s parent budgets. Same supervisor/Job contract.
Regardless of outcome restore exact disabled copies in finally and verify hashes.
Require helper/root0, Member true, ActiveProcesses0, durable source/request/result-bound
five-check PASS and no timeout/query/storage failure. Otherwise FAIL/UNVERIFIED as
appropriate; preserve logs and receipts, no retries, no broader host inspection.
Unexpected host/network/credential effect: stop and ask Human. No network allowance,
company data, real profiles, release/updater or remote write authority.

Medium effect: real reads of only the freshly created synthetic file, inside supervised
fixture. Rollback six modified files from .tmp/native-read-20260911/ before copies while
preserving evidence/newer edits; gates restored separately. No dependency/deployment/restart.
No cancellation/rollback claim: reads intentionally complete after revoke. No inference
for write/delete/Git mutations, pending navigation/crash IPC, full-app or company readiness.
Remaining next step is Human-authorized one-run integration, not more isolated preflight.
