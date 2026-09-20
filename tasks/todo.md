# 2026-09-20 provider backend realization — CURRENT HANDOFF

本 checkpoint 接續 accepted execution-preparation checkpoint `0d91954e7909425c570b0af37713a6ddb2ac01b6`。接受範圍是 **inert provider backend mechanics + exact-byte RAW_PIPE transport + existing bounded-worker lifecycle integration**；production provider authority仍刻意不存在，真實credential、provider network、endpoint approval及provider CLI/model invocation均未授權、未執行。舊 FAIL / UNKNOWN / BLOCKED evidence 保留，不改寫。

- VERIFIED starting identity：branch `research/electron-security-poc`，starting HEAD `0d91954e7909425c570b0af37713a6ddb2ac01b6`，tree `6e6ecd7619397c20dcdae816e6dc8d4d4645ed41`；開始與結束均無 staged paths。protected compatibility cohort `src/shared/codexRemote.ts`、`test/agent-token-cap.test.cjs`、`test/cli-install-ladder.test.cjs`、`test/codex-remote.test.cjs`、`test/transcript-project-dir.test.cjs` hashes 保持既有值且未納入候選。
- VERIFIED candidate paths / final SHA256：`src/main/windowsOwnedPty.ts` `df3af0f04747a1c60c25e3716670d922f21d53b853a4a3235867bda3535639ce`；`src/main/windowsOwnedPty.cs` `4f12034c5ceb6ffa8bc45bbe26909d9445fe0a2a7530a9b398fd03cec2183583`；`src/main/windowsOwnedPty.ps1` `25fd0b4927e260b8af98c1ec781bdfc907c453786f609c2b15708eb177c5f62b`；`src/main/pty.ts` `1895240dab91b83ee657b56bfa21db98c616343fa69b9254fb4ddfae51257b4e`；`src/main/providerExecutionPreparation.ts` `4c368cf33a6655797b6ad4af9408b36f08a595929e82b0e9939b0b07a6cd8487`；`src/main/providerWorker.ts` `c49a6bc840a37f07df86f1973bae20c12fe4c2f8a79b7042afbc913777ec32ca`；`src/main/boundedWorker.ts` `5af3dad8772cd78597ed2afe1a36aab19e57d255fe3663c09cff2143d3f19a8b`；`test/provider-execution-preparation.test.cjs` `9c9deedb47db35280e814b9bc00eb9f17b985782e66ac81d8790867686030a45`；`test/provider-worker-preflight.test.cjs` `fb33a27fe77d41916f2e5820c88a45beb6318a65c329b84ecfb5fd270c8f7005`；`test/owned-pty-runtime.test.cjs` `997e9efeb8d4e82249716e253c3486116881965e3d6e0bda86d7c3235160cb6a`；`test/fixtures/provider-raw-input.cjs` `b64049cd96724f9894340cac6c214ae376fd1bb749d252a9e0dbb1507758edfd`。候選 scoped diff SHA256 `9ffd5809c7e40552ad0c0aec76c430d462ae8da794d43bff0b2eef5f4ff53cee`。
- VERIFIED authority boundary：`createProviderExecutionIssuer` mint 的opaque credential/task/network capabilities只能由Main-held issuer消費；copy、JSON、substitution、revocation、expiry與spent replay均拒絕。credential material目前僅`INERT_NON_SECRET_CREDENTIAL`，不得冒充production credential；synthetic provenance不能升級為Human authority。
- VERIFIED endpoint / network boundary：canonical HTTPS endpoint、alternate origin、redirect、caller override、proxy與credential-like env在prepare/consume兩層拒絕；`Full Access`不隱含network authority。此為`APPLICATION_LEVEL_ENDPOINT_BINDING`；DNS與OS egress containment仍`UNKNOWN`。production現有`spawnAgentCore` callsites不提供private bridge authority，因此provider launch保持fail-closed。
- VERIFIED task / result binding：request exact UTF-8 bytes、task digest、contract、synthetic root及run identity在launch前重新驗證；provider evidence被納入bounded binding digest。terminal output或exit 0不能取代strict durable result；PASS配non-zero exit降級`UNKNOWN`。result publication、acceptance與capability consumption均once-only。
- VERIFIED RAW_PIPE mechanics：Windows native host只把child `inputRead`與`outputWrite`加入`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`；parent ends移除inherit flag。輸入透過bounded base64 frames傳送exact bytes後關stdin；stdout/stderr exact UTF-8 bytes被drain。Job Object、stop/timeout/launch-failure、handle/pseudoconsole清理及`cleanupState`/`ioDrained`/`inputClosed` receipt仍由existing owned-PTY lifecycle證明；preflight READY不是native run receipt。
- VERIFIED authoritative validation：focused provider suites `24/24 PASS`；worker contract/launch `23/23 PASS`；owned runtime+compile `12/12 PASS`；full scoped suite `61/61 PASS`，`0 fail / 0 skipped / 0 cancelled`；`tsc --noEmit -p tsconfig.node.json` exit 0；`electron-vite build` exit 0（main 86 modules、preload 1 module、renderer 2588 modules transformed）。合計報告以各命令自身counts為準，不把重疊套件相加宣稱唯一test總數。
- VERIFIED historical FAIL 保留：backend初次provider run `15/23 PASS, 8 FAIL`，原因為tests仍使用舊`mintCredential` signature / 舊literal authority及RAW_PIPE fixture未完成；Developer修復後Main重新跑至`24/24 PASS`。沒有刪除失敗test、`skip`、`only`或弱化assertion。
- VERIFIED module observation：built bundle內`createProviderWorkerBridge → prepareBoundedWorker → consumeProviderWorkerBridge`初始化順序存在且未觀察到cycle `ReferenceError`。直接以plain Node require built Electron main達到startup後因Electron `app` API為undefined而拒絕；因此packaged Electron runtime startup仍`UNKNOWN`，不得視為PASS。
- VERIFIED independent reviews：`ProviderBackendCorrectness` verdict `PASS`，無blocking finding；`ProviderBackendRisk`第二獨立review verdict `PASS`，無authority bypass。Risk review列LOW：renderer消費`pty:exit`/`pty:bounded-result`語義未驗證，以及input delivery失敗後preparation只能fail-closed並由Main建立fresh attempt。Reviewer未執行validation；counts以Main evidence為準。
- UNKNOWN / residual：packaged Electron實機啟動；renderer是否只把acceptance/recovery投影用於顯示；OS/DNS egress containment；通用secret detection（目前只做bounded high-signal guard）；group-policy/security-software注入的Windows edge env；真實provider CLI、credential及model request。`providerCliProof=NOT_RUN`，provider invocation=`NOT_RUN`，network request=`NO`。
- H / criteria：本slice增加criteria 5、11–14、22、25–28、31的repository-scoped evidence，但不接受R/company readiness、不宣稱OS sandbox或production provider readiness。Harness維持FROZEN，H continuous。
- 下一個Human gate：任何真實provider execution仍需新的明確、bounded Human authority envelope，指定dedicated credential backend/handoff、approved origin與application/OS enforcement evidence、exact candidate/task/run/worker、expiry/attempt上限、CLI/model command、network authority、redaction及evidence保存。現有synthetic capabilities與本checkpoint不得重用為真實credential或network許可；Human retains push authority。

# 2026-09-20 provider execution preparation — CURRENT HANDOFF

本 checkpoint 接續 accepted launch bridge `7e67b95abfdb07391682e1a6f4c0b521c3637d81`。接受範圍是 **credential / endpoint / task / durable-result execution preparation contracts**；真實 credential backend、provider CLI、provider network/model invocation仍未授權且在最後launch consumption明確fail-closed。舊 evidence、兩次focused historical FAIL、UNKNOWN與BLOCKED均保留，不改寫。

- VERIFIED starting state：branch `research/electron-security-poc`，starting HEAD `7e67b95abfdb07391682e1a6f4c0b521c3637d81`，與`origin/research/electron-security-poc` ahead 1 / behind 0；index empty。protected compatibility cohort 5/5 SHA256保持`dcfa018c…` / `6340a028…` / `bfc9ede9…` / `c9deccaa…` / `ca60e7d8…`，未修改、未stage；既有untracked evidence保留。
- VERIFIED exact candidate paths：`src/main/providerExecutionPreparation.ts`、`src/main/boundedWorker.ts`、`src/main/providerWorker.ts`、`test/provider-execution-preparation.test.cjs`、`test/provider-worker-preflight.test.cjs`。Final working-byte SHA256依序：`0f38d9fc65009ae8b81eecc0e720a87a052d487a60868e91f2fecabbd5e1c034`、`46991d685990c08e812d87cc20d49bc222d18814fc6bf41596cf9ace542ba216`、`6d67c9ed2a7e4e3f1709d43671188c9a012f71f4772a4a35737dad3b7c913e78`、`242fab16af883f9c2ffd3a5a2e1b09f89055350cd669dcc93f2dcea17ce7a391`、`6b9642ef196718e77f9bc399e8705043fe26d6a589f1c49a55250bb2600bce42`；scoped diff SHA256 `7c89aba7655673c22b1fb814371865ebbf013e6fbdabc89219db195a1abc0a5c`。
- VERIFIED credential boundary：`createProviderExecutionIssuer()`只mint module-private WeakMap/WeakSet opaque capabilities；JSON serialization throws，structural/spread/foreign handles拒絕。`ProviderCredentialAuthorization`綁`recordId`、`grantedBy:'HUMAN'`、purpose、完整contract scope digest、canonical endpoint與expiry；metadata不含secret bytes，也誠實註明不驗證out-of-band Human provenance。正常daily auth/config、logged-in state、host credential env與secret broker皆未讀。
- VERIFIED once-only / replay：`consumeProviderExecutionPreparation`先重證mint/expiry/revocation/binding、request digest/schema/task bytes與endpoint/env；全部通過後才同時把credential/task state標`spent=true`，再刻意throw `BLOCKED_BACKEND_REQUIREMENT`。因此首個有效嘗試燒毀此次Main/Human authority但無provider effect；第二次在backend前以spent拒絕。偽造、過期、revoked、task substitution、endpoint/env failure皆在spend前拒絕。
- VERIFIED endpoint architecture：只接受canonical lowercase HTTPS origin；default 443省略，userinfo/path/query/hash/trailing-dot/alternate origin/redirect/caller override/proxy-like或credential-like env拒絕。Policy明列`APPLICATION_LEVEL_ENDPOINT_BINDING`、`configurationBackend:'NOT_IMPLEMENTED'`、`execution:'BLOCKED_BACKEND_REQUIREMENT'`、`OS_LEVEL_NETWORK_CONTAINMENT:'UNKNOWN'`。DNS resolution與OS egress未受containment，未宣稱APPROVED。
- VERIFIED task transport：request document strict schema為`{contract, task:{encoding:'utf8',text}}`；完整contract identity/source/root綁定，task exact UTF-8 bytes非空且最多65,536 bytes，`SHA256(taskBytes)===contract.taskDigest`，request document最多1MiB且另綁request digest。`describeProviderTaskTransport`只建立`EXACT_BYTES_THEN_EOF`、`shell:false`的future descriptor；delivery backend仍`NOT_IMPLEMENTED`，沒有把caller argv/env/hive/renderer/file-backed spawn fields重新放入launch。
- VERIFIED bridge/runtime integration：`createProviderWorkerBridge.authorize`額外要求matching opaque execution preparation；ticket/binding將其帶入existing `prepareBoundedWorker`。`assertLaunchPreconditions`在任何native effect前重證file hashes/request/root/result slot，再consume execution preparation；production仍因backend missing fail-closed，`state.launched`不置位。既有`PreparedBoundedWorker`、PtyManager/Owned ConPTY、result acceptance與recovery architecture保持，無第二runtime/supervisor/result system。
- VERIFIED durable result transport：`createProviderTaskResultAdapter`為Main-only adapter；`publishBoundedWorkerTaskResult`要求minted + consumed launch +未accepted/未published，先拒duplicate slot，再以key-aware bounded secret-content guard與`validateTaskResult`綁candidate/task/run/worker/taskDigest/source，限制result bytes，並以atomic-exclusive bytes publication寫existing result slot；成功後才標published。Existing acceptance仍獨占artifact enumeration/hash/containment、native cleanup與acceptance receipt。Process exit/terminal output不會生成PASS；exit0 + absent result仍UNKNOWN。
- VERIFIED secret handling：result strict schema不承載diagnostic/headers/auth state；dangerous key names、Bearer、PEM、standalone`sk-`與key assignment形狀拒絕。Scanner明列不是通用secret detector；strict result schema與artifact verification仍是主要boundary。沒有secret/log/telemetry/evidence輸出。
- VERIFIED Main authoritative validation（final replay-repaired candidate）：`node --test test/provider-execution-preparation.test.cjs test/provider-worker-preflight.test.cjs` 22/22 PASS；`node --test test/codex-worker-contract.test.cjs test/worker-launch.test.cjs` 23/23 PASS；`node --test test/owned-pty-runtime.test.cjs test/owned-pty-compile.test.cjs` 12/12 PASS；`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` exit0。總計57 tests /57 pass /0 fail /0 skip。Provider invocation=NO；credential access=NO；network request=NO。
- VERIFIED historical validation failures保留：首次final focused run 25/26（duplicate ordering被scanner先攔）；修復後第二次仍25/26（embedded taskId `p-bridge-task-001`誤中舊`sk-`substring）。兩次均由Developer修復、Main refreeze/revalidate；沒有刪test、skip、only或弱化assertion。
- VERIFIED reviews：初次correctness `ProviderExecutionCorrectness`為`NEEDS_FIX`，指出spent fields dead與replay test證錯機制；Developer修復後`ProviderReplayCorrectness` PASS、findingClosed=true。Initial risk `ProviderExecutionRisk` PASS（同一spent issue列LOW future risk）；repair後`ProviderReplayRisk` PASS、findingClosed=true。Reviewers read-only；test counts以Main evidence為準。
- VERIFIED delegation deviations：`ProviderSecretRepair`違反no-validation限制，執行兩個focused suites與一個已刪throwaway diagnostic；其validation evidence標`NONAUTHORITATIVE`且不作acceptance依據。Main重新執行所有authoritative validation。未見credential/network/persistent out-of-scope mutation或authority incident。
- H / criteria：本slice補強criteria 5、11–14、22、25–28與31的repository-scoped evidence；不外推OS containment。Harness維持FROZEN，H continuous，R/company readiness仍DEFERRED。
- UNKNOWN / NOT_AUTHORIZED：actual secret-store/backend choice、out-of-band Human credential attestation、real credential handoff、provider configuration backend、provider network authority、approved endpoint enforcement、DNS/OS egress containment、real provider CLI/model behavior、packaged Electron module-cycle observation、deployment/company readiness。Actual provider/model request未執行。
- 下一個Human authorization：需要一次明確且bounded的 **credential + endpoint backend + provider network + one-attempt provider execution** envelope，指定真實dedicated credential handoff/backend、approved provider origin與application/OS enforcement evidence、exact candidate/task/run/worker、expiry/attempt上限、provider CLI/model command、network authority與evidence/redaction保存。現有checkpoint/opaque metadata不能被重用為真credential或provider request許可；Human retains push authority。

# 2026-09-20 provider preflight → bounded launch bridge — CURRENT HANDOFF

本節接續 accepted provider preflight `70a719f0`。本 checkpoint 接受的是 **identity-bound Main-only bridge 到既有 `PreparedBoundedWorker` / governed owned-PTY launch-ready boundary**；production 仍未取得 credential/network/endpoint/provider invocation authority，沒有 provider/model request。舊 evidence/FAIL/BLOCKED 保留，不改寫。

- VERIFIED starting checkpoint：branch `research/electron-security-poc`，starting HEAD `70a719f020ff1df2dda9742088b4014c62a4297a`，starting tree `80add41e6771e6b08c9e2b6d40f760227757326d`；index empty。protected compatibility cohort 5/5 SHA256 MATCH並保持 unstaged；既有26-path untracked cohort保留。
- VERIFIED exact candidate paths：`src/main/providerWorker.ts`、`src/main/boundedWorker.ts`、`src/main/index.ts`、`src/main/pty.ts`、`test/provider-worker-preflight.test.cjs`。Final file SHA256依序：`3671d6fb55505ec41727ccef741491e70553470ade1fc8d47a1e3b4fcfe0dac7`、`421a11eb848125d1a37ea06e89d1d1f259e2f22a9d46867647ff5c57f1e76872`、`3d1a0cbced3ddf61d00a1ee4df1b1f66dea714c5b4c57030e18671c0fe476885`、`3386f7ef5ee59bdf31448b6cdba9feb943f930d6d277f99edbba919709f53577`、`986a6d5e3ec2703f02a3658ca32d890f33154484dceb7d5c620d61d1269726fb`；scoped diff SHA256 `981d2a49f53bf360716922f812c6c5f88653c07a7d4f97caf0418490b14c890f`。
- VERIFIED bridge architecture：`createProviderWorkerBridge()` 建立 Main-held closure；issuer-local WeakMap ticket與module-private `SPENT_PREFLIGHTS` / `BRIDGE_BINDINGS`把 minted `ProviderWorkerPreflight`、explicit invocation authority與matching `BoundedWorkerPermit`轉成既有 `prepareBoundedWorker()` 的一次性 binding。`spawnAgentCore`私有issuer在generic side effects之前嘗試prepare，成功只重建 `{id,cwd,command,boundedWorker}`並走既有 bounded branch；production所有現有caller不傳第三個authority參數，因此目前仍fail-closed。
- VERIFIED unforgeability / replay：renderer `pty:spawn`、file-backed `processSpawnRequest`拒絕`providerWorkerPreflight`/`boundedWorker`；direct `PtyManager.spawn`在bounded/generic dispatch前拒絕preflight。Structural copy、JSON reparse、foreign issuer ticket、forged ticket、ticket/preflight replay與copied `PreparedBoundedWorker`均拒絕。Bridge attempt消耗ticket/preflight；`consumePreparedBoundedWorker`再提供launch once-only。
- VERIFIED identity/binding：candidate/task/run/worker/taskDigest/repository commit+tree、executable canonical path/version/SHA256、fixed `CODEX_WORKER_ARGV`、explicit allowlisted env、permitId/expiry、helper/native script/native source path+SHA256、request/result/artifact/host receipt與bounds綁入existing bounded preparation/binding digest。沒有request-authored provider argv/env進入launch。
- VERIFIED addendum A：preflight `processOwnership` / `resultConsumer` READY只屬admission evidence。實際run仍必須由`launchOwnedPty`的當次`OwnedPtyReceipt`與`prepared.accept()`證明Job membership/descendants/stop/timeout/cleanup/I/O drain/pseudoconsole/durable result；existing recovery classification不變。
- VERIFIED addendum B：preflight mint保存原permit expiry；bridge consumption重查expiry，不renew、不替換；bounded prepare要求permit expiry完全相等，`consumePreparedBoundedWorker`在native effect前再次重查。
- VERIFIED addendum C：existing bounded preparation與launch consumption重證canonical/link-free regular files、executable/fixture/helper/native hashes、request bytes/contract、fresh synthetic root、empty result slot與absent acceptance receipt；stored preflight digests不代替launch-time reproof。
- VERIFIED addendum D：issuer ticket、bridge binding、preflight、`PreparedBoundedWorker`與durable acceptance皆once-only / replay-resistant。Risk review另記LOW operational tradeoff：bounded preparation失敗也燒毀preflight right，方向fail-closed，需新Human permit才可重試。
- VERIFIED launch-ready proof：新增test以real local `process.execPath`、PowerShell helper、bounded fixture、native script/source與即時SHA256，走`prepareProviderBackedWorker`→`bridge.authorize`→`bridge.prepare`取得genuine minted `PreparedBoundedWorker`，停在consume/launch之前。此test明列mocked/derived READY只證bridge mechanics；`providerInvocationAllowed:false`、`launchAuthority:'NOT_GRANTED'`、`launchable:false`保持。child_process/fs-write/socket-connect witnesses皆0；provider/model invocation = NO。
- VERIFIED Main authoritative validation（final candidate）：`node --test test/provider-worker-preflight.test.cjs` 17/17 PASS；`node --test test/codex-worker-contract.test.cjs test/worker-launch.test.cjs` 23/23 PASS；`node --test test/owned-pty-runtime.test.cjs test/owned-pty-compile.test.cjs` 12/12 PASS；`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` exit0。總計52 tests /52 pass /0 fail /0 skip。第一次provider suite 15/16 FAIL是stale source-text assertion，保留為歷史validation failure；Developer修復test契約後Main refreeze/revalidate。
- VERIFIED reviews：final correctness `ProviderBridgeCorrectnessFinal` PASS；final risk `ProviderBridgeRiskFinal` PASS，皆read-only artifact review。Prior correctness/risk也PASS；final delta review確認mocked READY未被升格、無test weakening、A–D不變。Reviewer未執行validation，其test counts僅Main evidence。
- VERIFIED delegation friction：`ProviderBridgeProof` writer在完成test edit後未正常yield且被Main取消；取消payload schema invalid，不作acceptance evidence。Main重讀其artifact、執行完整authoritative validation、refreeze並取得兩個final reviews；無concrete unauthorized mutation/network/credential/Git evidence。
- VERIFIED credential/network/endpoint disposition：actual dedicated credential provisioning `NOT_AUTHORIZED`；daily auth/config、logged-in state、process env secrets、secret broker未讀。Provider network `NOT_AUTHORIZED`；endpoint enforcement `OPEN_DECISION`；production沒有authority ticket，provider/model invocation = NO。
- H / 31-criteria mapping：criteria 5、11–14、22、25–28、29–30獲得本slice bounded evidence；Criterion31僅repository-scoped/test evidence，不外推OS containment。R/company readiness仍DEFERRED。
- UNKNOWN / NOT_AUTHORIZED：actual credential handoff、provider login state、provider network/model execution、endpoint enforcement APPROVED、real provider CLI sandbox/effectiveness、authorized positive Electron/native provider run、OS filesystem/process containment、deployment/provider/company readiness。Module cycle在Node test-loader/typecheck與source review下未見defect；actual packaged Electron load仍UNKNOWN，不升格為PASS。
- 下一個Human authorization：必須明確指定dedicated credential provision/handoff mechanism、approved endpoint enforcement、provider network authority，以及是否允許一次bounded provider CLI/model invocation（含exact run/candidate bounds與evidence preservation）。本checkpoint不能被重用為provider request許可；Human retains push authority。

# 2026-09-20 provider-backed integration preflight — CURRENT HANDOFF

本節為最新 checkpoint，接續已接受 minimum provider-free B / bounded C。它只接受 **real Codex provider production preflight fail-closed integration**；沒有 provider credential、network/model invocation、endpoint approval、launch bridge 或 company readiness。舊 evidence/FAIL/BLOCKED 保留，不改寫。

- VERIFIED starting checkpoint：branch `research/electron-security-poc`，HEAD 與 `origin/research/electron-security-poc` 均為 `7aab62bac2af271e5a69e1bb05d3fe7a27b3a4df`，ahead/behind `0/0`；index empty。protected compatibility cohort 5/5 SHA256 MATCH，保持 unstaged；既有 26-path untracked cohort保留。
- VERIFIED accepted local commit：`70a719f020ff1df2dda9742088b4014c62a4297a`（parent `7aab62ba`），message `feat: gate provider worker preflight`。Exact paths：`src/main/providerWorker.ts`、`src/main/index.ts`、`src/main/pty.ts`、`test/provider-worker-preflight.test.cjs`。未 push；目前 local ahead origin 1，`main` 未改。
- VERIFIED production path：Main 建立 `prepareProviderBackedWorker` → explicit `CodexWorkerContract` / fixed `buildCodexWorkerLaunch` / explicit `buildCodexWorkerEnv` → ten-gate `evaluateCodexAdmission` → module-private WeakMap mint。Main 將 minted preflight 交給 `spawnAgentCore` 時，該 branch 位於 bounded branch、cwd/provider/install/worktree/hive/env/remote/PTTY side effects之前，僅回 fail-closed result；不執行 provider CLI/PTY。
- VERIFIED intake boundary：renderer `pty:spawn` 與 file-backed `processSpawnRequest` 都拒絕 `providerWorkerPreflight`；structural copy/JSON reparse不能通過 WeakMap identity。`PtyManager.spawn` 另在 bounded/generic dispatch 前 defense-in-depth 拒絕該欄位，避免 future direct caller 靜默落入 generic spawn。
- VERIFIED identity/environment：real provider executable由 canonical absolute path + version + SHA256 descriptor綁定，shell shim拒絕；candidate/task/run/worker/taskDigest/repository commit/tree 綁定；argv 固定 `-a never -s workspace-write`、`shell:false`。Env 僅 explicit fixed allowlist，`HOME`/`USERPROFILE`/`TEMP`/`TMP`/`CODEX_HOME` 綁 synthetic root，credential-like host env拒絕，沒有讀 normal daily `~/.codex` auth/config 或 secret broker。
- VERIFIED authority semantics：`providerAdmissionReady` 只表示 ten-gate readiness，不是 permission；本 slice `providerInvocationAllowed:false`（literal）、`launchAuthority:'NOT_GRANTED'`、`launchable:false`。即使 pure all-evidence admission為 READY，也無 launch right、無 `PreparedBoundedWorker`、無 provider invocation。
- VERIFIED gate disposition：credential `BLOCKED`（沿用 `DEDICATED_PREPROVISIONED`，但 `dedicatedPreprovisioned=false` / `handoffAuthorized=false`；daily auth/config/provider secrets DENY）；provider network `BLOCKED` / `NOT_AUTHORIZED`；endpoint `BLOCKED` / `OPEN_DECISION`；Full Access/YOLO 不授予 provider network；runtime permit/ownership/result consumer仍是 required gates。
- VERIFIED existing B/C reuse：contract、fixed env/launch、accepted `PtyManager.spawnBounded` / owned ConPTY Job / durable result / recovery semantics保持；本 slice沒有平行 runtime。真正 future launch bridge 必須從新 Human authority開始，將已授權 provider preflight安全轉成既有 `PreparedBoundedWorker`，本 checkpoint刻意未實作。
- VERIFIED Main validation：`node --test test/provider-worker-preflight.test.cjs` 15/15 PASS；`node --test test/codex-worker-contract.test.cjs test/worker-launch.test.cjs` 23/23 PASS；`node --test test/owned-pty-runtime.test.cjs test/owned-pty-compile.test.cjs` 12/12 PASS；`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` exit0。總計50 tests /50 pass /0 fail /0 skip。Provider invocation = NO。
- VERIFIED reviews：final correctness `ProviderCorrectnessFinal` PASS；final risk `ProviderRiskFinal` PASS，皆 artifact-only。第一次 correctness reviewer違反 no-commands contract，自行執行 tests/hash/git；其 validation evidence標 `NONAUTHORITATIVE` 並排除，Main validation不受影響。初次 risk finding：`providerInvocationAllowed` readiness歧義 MEDIUM 與 `PtyManager` direct-bypass defense LOW，皆由 Developer修復、Main refreeze/revalidate、兩個 final reviews確認關閉。
- VERIFIED evidence：`.tmp/provider-preflight-03/freeze.json` SHA256 `67b5e1b60c15e1d22c70be89b6df31a65356193387e8dc9bf5a3e2c376256107`；`validation.json` `895132b811d222cc54c48a5bca9074457e780a5a020a70c5aa25b1cd240c32c7`；`acceptance.json` `ceb4804e53c3151b57995046138cb808554753300ab3a1d0dfd2cfc0000b381d`。
- H / 31-criteria mapping：criteria 5（credential/network/process/runtime authority surface disposition）、11–14（Windows/tests/integration evidence）、22（authority不得默默擴張）、25–26（delegation friction與Main reconciliation）、27–28（reviewable local commit/fresh handoff）、29–30（main/remote untouched）獲得本 slice bounded evidence；其他 criteria不因 preflight自動 CLOSED。Criterion 31僅能說 repository-scoped paths受控，不外推 OS containment。
- UNKNOWN / NOT_AUTHORIZED：actual dedicated provider credential handoff、provider network/model execution、endpoint enforcement APPROVED、provider login/auth state、preflight→`PreparedBoundedWorker` launch bridge、CLI sandbox effectiveness、OS filesystem/process containment、production/provider readiness、deployment/company readiness。R仍 DEFERRED。
- 下一個 Human authority：若繼續，必須明確授權一個新的 bounded **provider launch bridge / credential-and-network evidence** slice，逐項指定 dedicated credential provision mechanism、allowed provider endpoint/enforcement、是否允許一次 bounded provider invocation、run/candidate bounds、evidence preservation。現有 authority不能被重用為 provider request許可。Human retains push authority；本 commit未 push。

# 2026-09-19 B → C minimum local acceptance — CURRENT HANDOFF

本節為 fresh Main 的最新接手入口，取代下方 historical Human gate；歷史 FAIL/BLOCKED 與舊 candidate bounds 保留為證據，不改寫。Human 已明確 resume B → C with H continuous。本 checkpoint 接受的是 **provider-free minimum B + bounded minimum C local implementation**，不是 provider readiness、OS containment、company readiness 或 R 開啟。

- VERIFIED repository state：branch `research/electron-security-poc`；HEAD `7aab62bac2af271e5a69e1bb05d3fe7a27b3a4df`，parent `d99f93588e67d50a4b68967cb8a701cd3782a6e1`。本輪 local-only chain：`1d993e40` bounded Windows worker runtime → `d99f9358` provider-free lifecycle repair → `7aab62ba` bounded recovery classification。未 push、`main` 未改、index empty。
- VERIFIED compatibility cohort preserved unstaged，SHA256 5/5 MATCH：`src/shared/codexRemote.ts` `dcfa018c…`、`test/agent-token-cap.test.cjs` `6340a028…`、`test/cli-install-ladder.test.cjs` `bfc9ede9…`、`test/codex-remote.test.cjs` `c9deccaa…`、`test/transcript-project-dir.test.cjs` `ca60e7d8…`。既有 26-path untracked historical cohort 保留。
- VERIFIED compile gate accepted/committed：production `windowsOwnedPty.cs` fresh PowerShell 7 compile；compile regression 2/2 PASS；TypeScript no-emit exit0。compile-gate commit `1d993e40` 的 correctness/risk reviews 已完成；未把 delegated validation 當 acceptance evidence。
- VERIFIED minimum B provider-free START/SUPERVISION/RESULT/STOP/CLEANUP：`test/owned-pty-runtime.test.cjs` 九個 native modes皆使用 production `PtyManager`/owned backend；START admission/fixed identity/environment、Job ownership、full-duplex I/O、descendant、timeout、operator stop、durable PASS/FAIL、missing/malformed/stale rejection、VERIFIED_EMPTY cleanup 均有 Main-owned evidence。Process exit alone 不構成 result acceptance。
- VERIFIED B validation：runtime 9/9 PASS；contract 9/9 PASS；compile 2/2 PASS；TypeScript exit0。correctness review 最初 MEDIUM 指出 durable duplicate coverage 缺 fresh preparation/host receipt path，Developer 修復後 reviewer recheck PASS；risk review PASS_WITH_PROCEDURAL_CONDITIONS。accepted B repair commit `d99f93588e67d50a4b68967cb8a701cd3782a6e1`。
- VERIFIED minimum C：`classifyBoundedWorkerRecovery` 僅分類，不 mint permit、不 launch、不刪除/覆寫 evidence。所有 decision `automaticAttempts: 0`、`providerNetwork: NOT_AUTHORIZED`。fresh attempt eligibility 不是 authority；只能由 Main 以不同 `PreparedBoundedWorker` / runId / workerId / permitId / syntheticRoot / resultSlot / hostReceiptBinding，重跑全部 admission checks。
- VERIFIED C state map：durable PASS/FAIL 與 operator stop → `TERMINAL`；timeout/helper-failure/launch-failure/missing/invalid 僅在 ownership/cleanup 已證實後 → `FRESH_ATTEMPT_ELIGIBLE`；duplicate/conflict、publication/acceptance failure、native receipt invalid、cleanup unverified、PASS/exit conflict、terminal unknown → `RECONCILIATION_REQUIRED`。沒有 blind retry/scheduler。
- VERIFIED C authoritative validation：runtime 10/10 PASS、contract 9/9 PASS、compile 2/2 PASS、TypeScript no-emit exit0；runtime assertions證明 classification 不啟動第二 process/helper、consumed preparation不可 replay。freeze `.tmp/c-recovery-01/freeze.json` SHA256 `3c8a1bddb2f409b1a5b602f9ca5713618628ee00b8b07f063f277e5ad721dcd6`；validation SHA256 `30b99a9444a32133f96e65c77f2849b3f251d31f73401c63ad3289dca535e795`；acceptance SHA256 `3dfe72cd39eaec55c4681dc5182d0a89c415c5a259ab4e1fbaa8bb2c4e4f7560`。
- VERIFIED reviews：`RecoveryCorrectnessFinal` PASS；`RecoveryRisk` PASS and permits local acceptance/commit while evidence remains preserved, no push, main untouched。早先 correctness reviewer 的唯一 HIGH finding 是對 cleanup/ACCEPTED 分支順序的誤讀；該 reviewer 重讀後明確撤回，不作 finding/evidence。
- VERIFIED accepted minimum C commit `7aab62bac2af271e5a69e1bb05d3fe7a27b3a4df`，exact paths：`src/main/boundedWorker.ts`、`src/main/pty.ts`、`test/owned-pty-runtime.test.cjs`。
- H / 31-criteria mapping：criteria 11–14（Windows material behavior、typecheck/tests、runtime/integration evidence）取得本 checkpoint 的 bounded positive evidence；22（self-improvement不得默默擴權）由 zero-attempt/Main-only recovery保持；25–26（delegation field evidence/Main goal continuity）本輪再次取得正反證據，包括 reviewer stale-reading correction；27–28 由 local reviewed commits與本 handoff推進；29–30 保持（main/remote untouched）；31 僅能 VERIFIED repository-scoped operations，repo-external absence仍依授權邊界，不外推 OS containment。其餘 criteria 不因 minimum B/C 自動 CLOSED。
- UNKNOWN / NOT PROVEN：provider credentials、provider network execution/endpoint enforcement、generic provider runtime readiness、CLI provider approval/sandbox behavior、OS/process containment、production deployment、company readiness。R 仍 deferred；不得替 Human 接受 material security risk。
- Capability-evolution field signal：保留 `Main + task + structured result + independent review`；本輪不需要 custom bus/scheduler。重複 friction：reviewer 可能誤讀 current line order，Main 必須以 frozen artifact 反證並要求撤回/重審，而不能接受 verdict 作證據。
- 下一步：B/C minimum local checkpoint 已接受。後續若要開啟 provider-backed worker、credential/network policy、CLI sandbox/approval 或 R/company-readiness，必須取得 fresh Human authority；現有授權不涵蓋。Evidence roots與 historical runtime evidence不得刪除/覆寫。

# 2026-09-19 BCH bounded runtime resume — BCH_HUMAN_GATE_REQUIRED

本節取代下方 historical Human gate，依 Human「RESUME BCH B-RUNTIME IMPLEMENTATION」授權。B/C 尚未完成；不代表 provider readiness 或 company readiness。

- VERIFIED checkpoint：`research/electron-security-poc`，HEAD `a3a3e7b4819abadefd16bede77aad5cf51adf568`，parent `8ba814d71414616a2b8720ea68b79f8141d50815`；index empty。五檔 compatibility cohort SHA256 5/5 MATCH、保持 unstaged。未 push、未改 routing。
- Human 接受 B00007：fixed-topology root-early-exit descendant-readiness proof PASS。Main 已讀 `.tmp/conpty-job-proof-B00007/proof-receipt.json`：root member true、root exit0、root exit 後 active1、terminationCount1、final0、VERIFIED_EMPTY、pseudoConsoleClosed=true、ioDrained=true、BROKEN_PIPE109、cancellationAttempts0；descendant readiness 由 root relay。B00008 NOT REQUIRED，不執行。
- 此 proof 不證明 continuous descendant I/O、full-duplex worker PTY、durable result、provider credentials/network 或完整 runtime。B00001–B00006 的歷史結果保留，不改寫 FAIL。
- VERIFIED production reconstruction：`index.ts processSpawnRequest → spawnAgentCore → PtyManager.spawn → node-pty`。generic launch 仍 host-derived environment、broker grant 與 PID-tree stop；B admission/fixed launch/environment/result validators 未接線。node-pty `conpty.cc` 的 creation attributes 只有 PSEUDOCONSOLE，沒有 JOB_LIST。
- Minimum B contract：唯一 production session owner 沿用 PtyManager；bounded admission 在 generic side effects 前；explicit executable/task/source/run identity、bounded environment、creation-time private Job、bounded stop/timeout、observable cleanup；沿用 CodexTaskResult，host 驗證 durable bytes/identity/artifacts 並 once-only acceptance，exit0 不等於完成。Provider-free fixture 與 provider invocation 必須明確區分，不能偽造 network AUTHORIZED。
- B-RUNTIME-01 candidate cycles C1/C2/C3 已用完，全部未接受；停止修復，不建立 C4。Writer 已 terminal，沒有背景 writer。兩個 scouts 與兩個 writers 的 concrete runtime model identity UNKNOWN；config mapping 不作獨立模型證據。
- Persistent uncommitted candidate paths：`src/main/pty.ts`、`src/main/index.ts`、`src/main/boundedWorker.ts`、`src/main/windowsOwnedPty.ts`、`src/main/windowsOwnedPty.ps1`、`src/main/windowsOwnedPty.cs`、`test/fixtures/bounded-worker.cjs`、`test/owned-pty-runtime.test.cjs`。Main 另更新本檔；無 dependency/routing/proof harness 變更。尚未 correctness/risk review，沒有 local commit。
- C1：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` exit2，5 compiler errors（duplicate version、IPty readonly/Buffer adapter interface）。C2 修復後同命令 exit0。這不是 native/runtime PASS。
- C2：`node --test --test-name-pattern="lifecycle: pass$" test/owned-pty-runtime.test.cjs` exit1，total1/pass0/fail1/skipped0。`.tmp/b-runtime-pSEKXs/runtime-evidence.json`：launch-failure、rootPid null、cleanup UNVERIFIED；helper environment gate 拒絕。只執行 pass scenario，其他八個 scenarios NOT_RUN。
- Helper bootstrap 診斷（explicit helper env、無 worker）：PowerShell exit0，觀察 Windows/PowerShell 新增 PSModulePath/HOMEDRIVE/HOMEPATH/LOGONSERVER/PATHEXT/SYSTEMDRIVE/USERDOMAIN/USERNAME/WINDIR keys。C3 改為 helper bootstrap 清除非顯式 helper keys；worker env 仍獨立 explicit 9 keys。此修復尚未 reviewer 接受。
- C3：相同 targeted native test、fresh `.tmp/b-runtime-O8p0yj/`，exit1，total1/pass0/fail1/skipped0。receipt：launch-failure、rootPid null、cleanup UNVERIFIED；Add-Type compiler error `windowsOwnedPty.cs(493,104): CS0266`，uint ERROR_INSUFFICIENT_BUFFER 指派給 int。未建立 worker；未重跑同 failed command，未隱藏失敗。
- C3 frozen hashes：pty `f3c1093c0530a72aec4a6fb10cfb6839170827dc812607c5a7f716b6d7c27001`；index `2000a067821dbd75961995bba467c81f723ba3bd735637ca3789ff02ce640024`；boundedWorker `ad50383a3ba5788fe614032565a86dfe74ba1a493658d853b6890a71c6727f52`；native TS `bd395bce78fd8b0788cc89f5ad2e54947bc3b30f54f6ca0b995eecf436cf85ec`；PS1 `9844f626dd2b7a4969ed966585592685435c0435d8deca2f9a968b3fbaeb1033`；C# `dd0d5c4f909004d16a2420d6b1b73e220d5bd54d86de6c5881c9774b9b4fb4f9`；fixture `1a9f40c1a204b62f5b1b968c12eecfe1a60f6ca92d36bc14f74b1ad55d2b4588`；runtime test `6f41f5b83d878cbbf6831977befb88bdce90432bc968900b413780c80b9c355c`。
- Re-plan：垂直切片一次涵蓋 native bridge/admission/result/shutdown，驗證面過大。建議 Human 開啟新的 bounded repair allowance，先 compile-only C# / PowerShell，再 fresh provider-free integration，成功才進兩個 reviews；不因切分 task 自動重置上限。現有 source 保存但不能執行部署／宣稱完成。
- 驗證策略：production code provider-free success、missing/malformed/stale/duplicate result、stop/timeout、descendant cleanup；Main freeze 後 targeted tests，correctness 與獨立 risk review，identity unchanged 後 exact local staging/commit。未取得證據的 runtime gates 維持 false；provider connectivity NOT_PROVEN。
- C 只在 minimum B accepted 後開始；bounded retry/re-plan 必須 fresh identity、observable recovery receipt，不擴張 provider/network/credential authority。A frozen、R deferred、原始31 criteria不變。
- Rollout 未執行，沒有 local commit 或 push；candidate 不可部署。停止原因是 Human candidate-cycle 上限，不是 provider credential/network blocker。待決定：是否授權新一輪最多3 candidates 修復上述同 scope source，compile-only + fresh local runtime evidence + reviews；不授權則保留未驗收 candidate，不 reset/restore/delete。B runtime UNKNOWN/NOT_ACCEPTED，C NOT_STARTED，provider NOT_PROVEN。

# 2026-09-19 BCH Main-only recovery — BCH_HUMAN_GATE_REQUIRED

本節為最新 handoff；舊紀錄保留。接受的是 local proof-harness 修正，不是 B runtime / native scenario PASS。

- VERIFIED HEAD `17800cb4cddd15fac2a751a365fe6e981a20f4f6`，branch `research/electron-security-poc`；local remote-tracking checkpoint `4bffbd1863d681639a85d22d7327d5b237ea25b9`，未查詢 live remote，未 push。
- Local-only chain：`d1841798` diagnostic instrumentation → `d097c109` coder routing → `5f19bab2` wait for ConPTY drain before closing reader → `17800cb4` isolate ConPTY child standard handles。
- Compatibility cohort 五檔仍 5/5 SHA256 MATCH，46 insertions / 20 deletions，unstaged；config 與 HEAD 相同，Main default 未持久化。此 handoff 更新未包含於上述 HEAD。
- B00001–B00004 preserved。B00004 永久 FAIL：Job final0、root member true、root exit0、descendantObserved=false、ioDrained=false、91 captured bytes、ReadFile ERROR6；markers 位於 helper stdout。
- B00005（HEAD `5f19bab2`）FAIL：ioDrained=true、BROKEN_PIPE109、無 cancellation/deferred close、Job final0；markers 仍走 helper stdout。
- B00006（HEAD `17800cb4`）FAIL：102 captured bytes、ROOT_EXIT 已進入 ConPTY且 rootMarkerObserved=true；descendantMarkerObserved=false、ioDrained=true、BROKEN_PIPE109、cancellationAttempts0、outputReadCloseDeferred=false、Job final0、root exit0。helper stdout 不再有裸 fixture markers。
- Evidence：`.tmp/b1-helper-B0000{4,5,6}/{binding.json,run-evidence.json,stdout.log,stderr.log}` 與 `.tmp/conpty-job-proof-B0000{4,5,6}/proof-receipt.json`。B00005/6 supervisor 皆 exit0、helper exit1、timeout=false、retained final wait=true。所有 FAIL 均未改寫。
- MAIN_01 hashes：harness `5e0b97f237cdd83f308a4b9adcf0cf62466b42923b71accde31f965f60012106`；test `467402fea9fcfffd3d21259240e600199a266c0ec70a40fbb2c86860b93d0a3f`；cumulative diff vs d1841798 `e2caf353c1a5b49cb6e5565ec7e59f58784628033f71df14189d35a9a2ccc2b0`。
- MAIN_02 harness `5b0ab15481ededf9f3cba737949cf9a9896b4bd3a4252e3ab7e16cdc1a060c0a`；test 同上；cumulative diff `be8eed006c6dd0d6f8137a0c6c1461d677bee4f973cec983049f2d84dd6ec752`。兩輪 Main freeze 前後/測試後/review後 hashes MATCH。
- 兩輪分別執行 `node --test test/research-job-conpty-proof.test.cjs`：14 total /14 pass /0 fail /0 skip，exit0，僅 non-native；舊16/16與違規 writer compile/probes不作 acceptance。
- Main01Review/Main02Review source-level correct；Main01Risk/Main02Risk local proof-fix no blockers。審查不等同 native PASS。Risk result transport 曾 yield schema failure / stream disconnect，以同次分析的 hub 回覆取回，未製造 PASS。First reviewer 要求 precommit native 的誤解已依 Human 明確 postcommit-native 順序澄清。
- Model routing 未再調整。task/smol DeepSeek、slow Kimi、risk/deep Sol 為 config mapping；Main02Risk transport error明示 `cliproxyapi/gpt-5.6-sol`。其餘 concrete execution identity UNKNOWN，不聲稱全面 independent-model proof。
- FREEZE_INTEGRITY_FRICTION：前次 developer 宣稱 frozen 後仍寫入，舊 tests/reviews binding INVALID。Human 接受處置。PROMOTE TO PROGRAM INVARIANT：所有 writer terminal / authority結束後，Main核對paths/index/cohort/config並計算files/diff hashes才可freeze；每個test/review/commit gate重核identity；scope內drift→invalidate/refreeze/retest/rereview。
- TASK_SCOPE_COMPLIANCE_FRICTION：B1ResumeWriter 未經 Task 授權建立/執行/刪除 `.tmp/head-harness.ps1`、`.tmp/head-test.cjs`、`.tmp/probe-b1.ps1`，並自行 validation；工具紀錄反駁其 only-two-files自述。Human分類 TASK_SCOPE_VIOLATION/BOUNDED並接受處置；不得降格為identity drift。三paths不存在/不tracked；先前是否有內容UNKNOWN，不追查。此次修復Main-only且無hand-authored scratch。
- Future dispatch invariant：分列 PERSISTENT WRITE PATHS、TRANSIENT WRITE PATHS；無transient授權必須 `TRANSIENT WRITE PATHS = NONE`。Temporary creation/deletion亦是寫入；self-report不是證據。未建立hook/plugin/custom bus。
- B：只有bounded synthetic Job/root/drain部分證據；production wiring未開始，runtimeReady不得升READY。C未開始；A frozen，R deferred。31 criteria原文未變，不宣稱company readiness。
- Re-plan / Human gate：B00004–B00006三次native evidence cycles已用完，descendant I/O仍UNKNOWN。INFERENCE：fixture `detached:true` child的console/stdio語義是下一調查邊界；不得直接取消detached（既有lesson指出libuv parent-exit Job可殺descendant）。需Human授權新的bounded fixture/descendant-I/O調查與fresh run envelope；未執行B00007，未修改fixture。
- 下一決定：是否授權新scope包含 `test/fixtures/research-job-conpty-child.cjs`，保留creation-time Job、root-early-exit存活descendant、no provider network/credentials與嚴格marker acceptance，最多新的明確run數。不得用缺失marker仍PASS作替代。

# A milestone closure — CLOSED_ENOUGH_TO_ENTER_B

- A1 FINAL CLOSURE = PASS 且 FROZEN；A1 native acceptance obligation 已 COMPLETE。
- Thin A milestone closure review 結論：`CLOSED_ENOUGH_TO_ENTER_B`。
- Evidence-backed B blockers from A：`NONE`。
- A 可帶入 B 的基礎能力：
  - fail-closed controlled Windows bootstrap
  - synthetic project/environment binding
  - trusted renderer/preload/main IPC
  - consent/read/revoke/re-consent
  - generation/stale-result handling
  - candidate/source/artifact/result/provenance validation
  - bounded Job ownership / timeout / stop / cleanup receipt
  - controlled side-effect refusal
- A closure 不代表 company readiness，也不代表 real Codex worker 已可直接執行。
- 以下仍屬 B；B runtime 必須在其 contract 完成前保持關閉：
  - exact Codex CLI identity/version/path
  - worker synthetic root
  - minimal environment allowlist
  - credential/provider handling
  - network policy
  - PTY/Job ownership
  - start/stop semantics
  - result acceptance
  - cleanup receipt
  - CLI approval/sandbox behavior
- C/H/R obligations 保持未完成，但不阻擋開始 B 的 bounded engineering。
- 不建立預設 A2/A3/A4。
- 原始 31 success criteria 完全不變；A/B/C/H/R 只是 execution roadmap。
- 下一 phase：B — real Codex worker：start / supervision / result acceptance / stop。

# 2026-09-17 PRE-B/C DURABLE HANDOFF — fresh Main 接手入口（本節為最新狀態）

本節取代 2026-09-13 A closure 成為**當前接手入口**；下方 A1/001–007 歷史證據全部保留、不改寫。
本節只記錄已由 Main 一手核對的 artifact 事實；未經核對者標 `UNKNOWN`。

## Fresh Main 必須先知道的事

- **current HEAD** = `2bbaf058a5141b70c43efb17e7b0f676e1774b28`，branch `research/electron-security-poc`。
- **live remote checkpoint** = `47a63075bd7e05a6ff6c4d38f8b16db949aee9f9`（`origin/research/electron-security-poc`，由 Human 外部確認）。
- **local-only commits（未 push；本地領先 remote 3 個 commit）**：
  - `a0002cd1` fix: reconcile OMP governance boundaries
  - `bf1e37a9` fix: retarget reviewer model roles for independent review
  - `2bbaf058` fix: clarify OMP authority envelope semantics
- 完整鏈：`47a63075` → `a0002cd1` → `bf1e37a9` → `2bbaf058`（HEAD）。已 push 者僅到 `47a63075`。
- **index 空**；**compatibility dirty cohort 必須保留原樣、不得 stage/format/restore**：
  `src/shared/codexRemote.ts`、`test/{agent-token-cap,cli-install-ladder,codex-remote,transcript-project-dir}.test.cjs` —
  5 files / 46 insertions / 20 deletions，5/5 SHA256 已記錄。
- 26 個 untracked path-set（`.codex/`、`tasks/*.json` 歷史證據、`tasks/lessons.md`、`tools/research-test.cjs`）保留。

## A 狀態

- `CLOSED_ENOUGH_TO_ENTER_B`；A1 FINAL CLOSURE = PASS 且 feature scope FROZEN。
- A1 native acceptance obligation COMPLETE（native-007）；**不建立 008**。
- A closure 不代表 company readiness，也不代表 real Codex worker 已可執行。

## B 狀態 — source/contract 已落地，runtime 未接線、native 未執行

**VERIFIED：B1 bounded contract 已存在（`de03d3f5` feat: add bounded Codex worker contract）**

- `src/main/codexWorkerContract.ts` — contract / admission / result validation（純函式；檔頭自述
  `B1 contract/admission only. No filesystem, process, Electron, credential, or network API belongs in this module.`）
- `src/main/workerLaunch.ts` — `buildCodexWorkerLaunch`：固定 argv `['-a','never','-s','workspace-write']`、`shell: false`
- `src/main/ptyEnv.ts` — `buildCodexWorkerEnv` / `validateCodexWorkerEnv`：不吃 parent env，只走 9-key allowlist
  （`PATH, HOME, USERPROFILE, TEMP, TMP, CODEX_HOME, TERM, COLORTERM, FORCE_COLOR`）

**10 項 admission gates**（`ADMISSION_GATE_NAMES`）逐項對應 A closure 所列 B blocker：
`executableIdentity`、`taskIdentity`、`sourceIdentity`、`rootPolicy`、`environmentPolicy`、
`credentialPolicy`、`networkPolicy`、`processOwnership`、`resultPolicy`、`authority`。

**目前 admission default = `BLOCKED`、`runtimeReady: false`**：未提供 evidence 時
`evaluateCodexAdmission(contract)` 逐 gate 回 `BLOCKED`/`UNKNOWN`，整體為 `BLOCKED`。
`authority` gate 明列 `runtimePermit` 需 `PRESENT` 且 source/identity/Human approval 全數成立。

**production wiring：NOT DONE / CLOSED（VERIFIED）**

- `buildCodexWorkerEnv`、`buildCodexWorkerLaunch`、`evaluateCodexAdmission`、`validateTaskResult`、
  `classifyTerminal` 在 `src/` **零生產呼叫點**（僅自身檔案內定義與測試引用）。
- `src/main/pty.ts:652` 仍走既有 `buildPtyEnv(process.env, userPath, opts.env)` — 繼承 host env。
- `de03d3f5..HEAD` 對這三個檔案 **0 次後續變更**。

→ **Contract exists ≠ Real Worker Runtime exists。** 這些是 source-only 契約，不是 runtime 完成。

## B native proof 狀態

- **`109990e2` test: add ConPTY Job ownership proof harness** — `tools/research-job-conpty-proof.ps1`（383+ 行）、
  `test/research-job-conpty-proof.test.cjs`、`test/fixtures/research-job-conpty-child.cjs`。
  9 個 scenario：`normal-descendant, root-early-exit, bounded-stop, timeout, query-failure,
  helper-failure, receipt-failure, unrelated-sentinel, pty-io`；creation-time ConPTY + 直接 Job-list 雙屬性、
  無 post-creation membership fallback、無 PID discovery、無 shell runner。
- **`b7617416` fix: make ConPTY Job proof evidence diagnostic** — evidence/diagnostic 修正。
- **B native state = `NOT_RUN` / NO ACCEPTED NATIVE RECEIPT（VERIFIED）**：
  `.tmp/` 下不存在任何 `conpty-job-proof-*` / `conpty-admission-*` root；`tasks/` 無 B native receipt。
- 本輪重新執行（**僅 test-suite evidence，非 native proof**）：
  - `node --test test/codex-worker-contract.test.cjs` → **9 pass / 0 fail / 0 skip**
  - `node --test test/research-job-conpty-proof.test.cjs` → **13 pass / 0 fail / 0 skip**
    （13 項中 5 項帶 `skip: process.platform !== 'win32'`，本機為 win32 故實際執行、未 skip；
    其餘 8 項為 platform-independent 的 harness 靜態／契約檢查。native mode 從不被 test harness 選用。）
- harness 預設與 `-CompileOnly` / `-AdmissionOnly` 路徑皆**不執行 native**；僅顯式 `-Native` 才會建立固定 fixture child，
  且本輪未執行。

**下一個 B blocker（decision-ready，未執行、需新授權）：**
在 Windows 上完成 **actual native ConPTY + creation-time `JOB_LIST` proof** —— 即讓 harness 以顯式 `-Native`
在 fixed synthetic `conpty-job-proof-<6char>` root 下建立固定 inert fixture，取得 native receipt，
證明 creation-time PTY/Job ownership、bounded stop 與 `VERIFIED_EMPTY` cleanup。
在此 proof 通過前，production wiring 不得被視為已證實；本輪不執行它。

## Harness / governance checkpoint

- `5d595971` chore: add project-local OMP harness — `.omp/{AGENTS.md,RULES.md,config.yml,agents/*,commands/*,skills/*}`；
  治理與權威，執行機制交由 OMP native。
- 事故後治理鏈（全部 local-only，除 `47a63075` 已為 live remote）：
  - `47a63075` fix: harden OMP incident safety boundary — **live remote checkpoint**
  - `a0002cd1` fix: reconcile OMP governance boundaries — local-only
  - `bf1e37a9` fix: retarget reviewer model roles for independent review — local-only
  - `2bbaf058` fix: clarify OMP authority envelope semantics — local-only

**`bf1e37a9` commit-level verification（VERIFIED，本輪 PHASE 1）**

- parent = `a0002cd1`；subject 相符；changed paths 精確 2：`.omp/AGENTS.md`、`.omp/config.yml`。
- config delta 僅限 model-role routing 與其直接對應註解。role routing before → after：
  - `smol` `deepseek-v4.1-flash:low` → 不變
  - `task` `gpt-5.6-luna:medium` → 不變
  - `slow` `deepseek-v4-pro:high` → `kimi-k2.7-code:high`
  - `risk` `kimi-k2.7-code:high` → `gpt-5.6-sol:high`
  - `deep` `gpt-5.6-sol:high` → 不變
- **FACT / known routing property**：`risk` 與 `deep` 現為**相同** concrete model identity（`gpt-5.6-sol:high`）；
  `slow`（first review）與 `risk`（second review）為**不同** concrete model identity。
  此為 routing 事實，非 blocker —— Harness 未要求 `risk` 與 `deep` 必須不同。
  （註：「first review / second review」對應關係出自 `config.yml` 該行註解；bundled `reviewer` agent 是否
  確實採 `@slow`，在 bundled agent 定義不可檢視的前提下為 `UNKNOWN`，不影響上述 routing 事實與 Gate 結論。）
- invariants 未被修改：`modelRoleStorage: project`、`task.maxRecursionDepth: 1`、`task.maxConcurrency: 4`；
  `bash.patterns` 仍**精確 9 條** Git hard deny 且全為 `approval: deny`
  （`git push*`、`git reset --hard*`、`git clean -*`、`git stash drop*`、`git stash clear*`、`git rebase*`、
  `git filter-branch*`、`git commit --amend*`、`git restore*`）。無新增 nested-OMP pattern、
  `tools.approval*`、`launch.enabled`、extension 或 hook。
- `.omp/AGENTS.md` 描述與 config 一致：改後該列僅述「Read-only by construction (no `bash`)」，
  與 `risk-reviewer.md` 的 `tools:` 清單（無 `bash`）相符；**已移除**原本的
  「Different model expected (`@risk`), but that family separation is `INFERENCE`」措辭。
  全 `.omp/` 無任何「family separation guaranteed / different model guaranteed」類宣稱；
  `config.yml` 反而明寫 separation「is a mapping, not a runtime guarantee」。
- `2bbaf058` 未修改 `.omp/AGENTS.md` 或 `.omp/config.yml`；current HEAD 兩者與 `bf1e37a9` byte-identical。
- 原則保持：**model routing is PROVISIONAL，不是 architecture requirement**；不得作為 B/C 的 blocker。

## Incident durable lesson（2026-09-14，簡要）

- fresh OMP 以 repository subdirectory 為 cwd 啟動 → project settings / `bash.patterns` policy 未載入
  → destructive Git probe 作用於真實 repo → 五個 dirty files 被 revert → 逐 byte 復原完成。
- 最終 forensic audit 未發現無法解釋的 mutation；**remote 未被改變**。
- 事故後 established safety boundary：effective policy 必須**驗證已載入**（檔案存在 != policy 生效）；
  native `task` delegation 為預設；nested/fresh OMP 需 explicit Human authority；
  destructive Git/policy probe 需**完全隔離的 disposable Git repo**；
  **declared boundary != enforced boundary**；`bash.patterns` 是 safety floor，不是 containment。
- 此為 durable lesson，**不是新 milestone**。

## H continuous observation — RESULT_TRANSPORT_FRICTION

- Authority Wording Closure 期間，strict structured `yield` 因 harness 錯誤
  `yield cannot contain both data and error` 連續失敗，risk-reviewer 以 `status: failed (exit 1)` 結束。
- Reviewer 的**分析本身已完成**；Main 最終由**同一次 agent analysis**透過 alternate native result retrieval
  取得 review conclusion，並自行 reconcile primary evidence（未重跑第二次審查）。
- 分類：`RESULT_TRANSPORT_FRICTION` —— **不是** candidate defect，**不是**新 product milestone。
- Disposition：`OBSERVE / RECORD`。**不建立** custom result bus / wrapper / plugin / hook / scheduler。
  若 B/C 重複出現，再評估升格為 Harness / Runtime improvement candidate。

## Current roadmap truth

- **B + C 仍是 primary Delivery**；**H = continuous obligation**（非獨立 phase，永不「完成」）；
  **R = deferred / not opened**。
- 目前**沒有**開始 C implementation，**沒有**開始 R work。
- 原始 31 success criteria 完全不變；A/B/C/H/R 僅為 execution roadmap。
- incident 治理工作**不構成** B/C 已開始或完成的證據。
- 下一 B 步驟為上方 B native blocker；需新的明確 Human 授權與 exact candidate/run，本輪不執行。

# 2026-09-13 A1 native-007 — PASS / FINAL CLOSURE EVIDENCE

- A1 FINAL CLOSURE = PASS at Git checkpoint `02cf5d8704525dd0df9c41db0a8bfa1c58eab68c`; candidate `a1-native-007`, SHA256 `640b5d19573fb7d71e0d39562ea0d70714a4cae9f38dbbb4c58e419fcd9a7c7b`.
- Result v2 PASS / close / PASS; exact acceptance events are deny → reload → allow → read → display → reload → allow → read → display with attempts=1 and retries=0.
- Provenance validator PASS: 25 trace records; generation 1 initial Ready, reload-1 1→2 with generation 2 Ready, reload-2 2→3 with generation 3 Ready; both re-consents and read/display pairs are bound to the new generation.
- Lifecycle PASS: root exit 0, helper exit 0, Job Member=true, ActiveProcesses=0, cleanup VERIFIED_EMPTY, no timeout/query/termination/persistence failure; close sequence 24 precedes result publication sequence 25.
- Binding PASS: request SHA256 `996d0faefc1d40ca413ad978fa3e7a8611d49067eb5ed69e02ad15a1f5ed3e72`; result SHA256 `619204f9ad5b905b4c9cc6f83cf2557128b1d00ddc6a48432fd88f428b9c2b35`; trace SHA256 `dfd915b2686ebd35ed3fc31e1ce83dae9084900f3e8c2ecd4c99cedb84c3743e`; supervisor receipt SHA256 `3c526cc4dc4517ba90112a97f02291da633f6ad1cf6066ad3677e014ea20c5f5`; used authorization SHA256 `febd97217873516c7772f6cba7fe4b33f841ea16aa38cab1437152e5275b1d5f`; native-outcome SHA256 `1109ae4f50f8e3bfcd93c640165a2c2e1139905fdae603b1ad14644baa8c6037`.
- No independent screenshot/accessibility artifact was captured because the computer-use RPC was unavailable; optical proof is not claimed, and no evidence conflict was recorded.
- Permit consumed: `authorization.json` absent, `authorization.used.json` present; native gates remain false. 001–006 and rehearsal inventories remain preserved.
- A1 feature scope is FROZEN; native acceptance obligation is COMPLETE; no 008 is to be created. The original 31 success criteria remain unchanged.
- Human roadmap decision: next step is only a thin A milestone closure review for an evidence-backed blocker to B; if none exists, proceed to B real Codex worker start/supervision/result acceptance/stop. Do not create default A2/A3/A4 milestones.

# 2026-09-13 A1 native-007 — FINAL CLOSURE CANDIDATE

- A1 feature scope frozen; controlled behavior, provenance, budgets, sequence, Result v2, and supervisor semantics remain unchanged.
- 006 verified the complete required 9-event core path (`deny → reload → allow → read → display → reload → allow → read → display`) with generations 1 → 2 → 3, two reloads, two Ready acknowledgements, re-consent, read/display, provenance validation, and clean Job/process cleanup.
- 006 remains `FAIL / close / SEQUENCE_MISMATCH` solely because Human triggered an extra reload after the required sequence; evidence is immutable and is not rewritten as PASS.
- 007 is the final closure candidate: run root `.tmp/a1-native-007`, candidate digest `640b5d19573fb7d71e0d39562ea0d70714a4cae9f38dbbb4c58e419fcd9a7c7b`; no permit/request/attempt exists.
- A1 remaining obligation: complete the same exact 9-event sequence, then normal close.
- No further A1 evolution unless a new reproducible product defect is proven.

# 2026-09-13 A1 native-006 — FAIL / close SEQUENCE_MISMATCH

- A VERIFIED：固定 checkpoint `980a51b4726aee4e50e8e9840bc0e710f5d4b345`、candidate `e48bc86f2652b49b819954ddafd9bd03a6128918b1fb9b1a6bd0db55a7d079ca`、source/artifact/Electron/configuration/environment identities 與 fresh roots 通過 admission verify；006 無 prior marker，001–005/rehearsal、compatibility cohort、index 與 gates 未漂移。
- B EXECUTED：依 exact four-key permit 只執行一次 `node tools/a1-admission.cjs --run`，native attempts=1、retries=0；permit 已消耗，沒有 retry、fallback 或第二次 launch。
- C VERIFIED：Result v2 binding 成立；`result=FAIL`、phase=`close`、reason=`SEQUENCE_MISMATCH`。automated events 為 `deny → reload → allow → read → display → reload → allow → read → display → reload`，第十個 event 是預期 sequence 完成後的額外 reload。
- Provenance VERIFIED：`a1-event-trace.jsonl` 26 records；generation 1 Ready、`reload-1` 1→2、generation 2 Ready、`reload-2` 2→3、generation 3 Ready；`reload-3` 僅有 handler-entry/acceptance event，未進入 reload invocation、navigation 或 generation 4 Ready，隨即 publication terminal failure。
- Human visual UNKNOWN：本 run 尚未取得 Human screenshot/visual observation；不能由 automated trace 推測最後一次 reload 的實際操作來源。此 FAIL 不改寫為 consent/read defect 或 A1 PASS。
- D lifecycle VERIFIED：root exit1、helper exit0、Job Member=true、ActiveProcesses=0、cleanup `VERIFIED_EMPTY`；無 workload/outer/query/termination/persistence failure。request SHA256 `80d2224b9a5d1d19f06d8cebc0a38e9d026ca772d46ad9a1139c9242a93ee357`；result SHA256 `de39674637dbb285b9d7cf7f744aad5c1bcf8aac7de40b6e60943232272e7a81`；trace SHA256 `947de707170b40885e755763b2b3082a0833c8386e6f60800388436d08c1ca4c`；receipt SHA256 `1276837d713d66051a779205c74b7c6808e03662c85565d8716dbf24b0ec17b5`；used authorization SHA256 `9505373e1e6a1f27beddd089a314d055722664d37257019d7e13ad29b857e029`。
- Remaining：006 evidence immutable；A1 尚不能宣稱 PASS。需另行決定是否補 Human visual/provenance correlation 或建立新 candidate；本輪不 retry、不修改 source、不開始 B/C/H/R。

# 2026-09-13 A1 native-006 provenance candidate

- 005 保持 `FAIL / human / NORMAL_CLOSE_INCOMPLETE`；第一段 `deny → reload → allow → read → display` 已由 automated 與 Human visual 對上，第二次 reload/Ready 衝突仍 `UNKNOWN`。
- 本輪僅加入 A1 controlled run-local `a1-event-trace.jsonl`：Main 擁有 document generation 與 reload action ID，記錄 trusted handler/acceptance/reload/navigation/Ready/allow/read/display/close/result publication；不改 acceptance sequence、budgets、reload 或 consent/read/revoke semantics。
- 006 candidate：`tasks/a1-admission-candidate-006.json`，run root `.tmp/a1-native-006`，candidate digest 由 manifest 綁定；artifact 為本輪 source fix build，native 未執行，permit/request/nonce 未建立。
- deterministic provenance/source/admission/build/hash verification 完成後，下一 obligation 是另行授權的 006 native acceptance；001–005 與 rehearsal evidence immutable，無法以本輪 source candidate 宣稱 A1 PASS。

# 2026-09-13 A1 native-005 — FAIL / NORMAL_CLOSE_INCOMPLETE

- A VERIFIED：固定HEAD `560d8366e6a7b2e6b4302d1fe4e7d9005be28de7`、candidate `37d02b343c2f29db29ae666cd0d83f85aaec327a0d63b438a4f40a30c956c6aa`，先admission verify exit0/CLOSED；005 source/artifact/Electron/environment identities及empty pre-attempt roots匹配，001–004/rehearsal evidence與manifest hashes未變、compatibility cohort未漂移、index空、gates false。
- B EXECUTED：獨立Human一次性permit，exact schema；只執行一次`node tools/a1-admission.cjs --run`，native attempts1/retries0。沒有retry、fallback、source/candidate修改或第二次launch。
- C VERIFIED：Result v2 binding成立；`result=FAIL`、phase=`human`、reason=`NORMAL_CLOSE_INCOMPLETE`，events=`[deny,reload,allow,read,display]`。第一段deny/reload/allow/read/display prefix完成；第二次reload/re-consent/read/display及normal close未完成。這不是Human timeout或supervisor timeout。
- Human visual：Human 回報第一段 `deny → reload → allow → read → display` 與 automated 對上；其後第二次 Reload 並目視看到 Ready，但 automated events 沒有第二個 `reload`，形成 bounded evidence conflict，仍為 `UNKNOWN`。此為 Human visual observation，非 automated screenshot-pipe proof。
- C lifecycle VERIFIED：root exit1、helper exit0、Job Member=true、ActiveProcesses=0、cleanup VERIFIED_EMPTY；TimedOut/RootTimedOut=false，無query/termination/persistence failure。permit已消耗、active authorization不存在，gates final false。request `f7cfbb7d234e2a3f97131014c5236e20ca8ad7b0cbd462b43a09443f5e24e72d`；result `2322961372c94b6feb2bfd3eb5bef2ebacc8d355594373554c95cfc771b9ddd7`；receipt `e55de3808b0a2b468077eb5ddde7e7f1061f6f78e032f181244de214d4955c2e`；nonce只屬本次request。
- D evidence：完整原件保留於`.tmp/a1-native-005/`，summary [native-outcome.json](../.tmp/a1-native-005/native-outcome.json)；001/002/003/004/rehearsal unchanged。此 FAIL 的 automated terminal 是 acceptance sequence 未完成／normal close incomplete；Human visual 與 automated 的第二次 Reload/Ready 差異仍無法由 retained trace 解決，不歸因 consent/read defect。
- 下一obligation：保留005 failure material；A1尚缺第二次reload後trusted Ready、re-consent、第二次read/display與normal close。005 permit/run不可重用，任何未來runtime需新candidate/run/authorization；不外推full-app/worker/company/OS isolation readiness。

# 2026-09-12 A1 native-005 main-owned reload checkpoint

- A complete：baseline HEAD `5dd1288bf8de264e46caba5afc700d80fc9be417`，local reload fix未commit；005 root/manifest原不存在。歷史001–004/rehearsal immutable inventory逐項核對；rehearsal僅NON-ACCEPTANCE diagnostic evidence，不能升格PASS。
- B complete：只將existing main-owned reload fix與005 fixed identity直接綁定。renderer→narrow preload bridge→controlled/trusted owned current main-frame/document handler→revoke→唯一acceptance reload→wc.reload；pending去重、did-start-navigation只revoke、will-navigate仍fail closed。budgets/Result v2/sequence/security scope不改。
- C VERIFIED：重新40 focused A1 tests PASS/0 FAIL/0 SKIP、9 pure selectors PASS、worktree及materialized005的Node/web四項typechecks PASS；exclusive005 official build121 outputs/233 inputs，完整source/output/Electron/configuration/adapters hash validation與admission --verify exit0/CLOSED/nativeExecuted=false。exact source/diff review PASS；未重跑native matrix。
- Candidate：`tasks/a1-admission-candidate-005.json`，digest `37d02b343c2f29db29ae666cd0d83f85aaec327a0d63b438a4f40a30c956c6aa`；root `<REPOSITORY>/.tmp/a1-native-005`，新artifact/main/index.js SHA256 `9a98001c9b2a863a405f5e12176315f8570e713f9b0f32cf14174c620925fd1a`；Electron43.6.0 SHA256 `9e1b3c401c1a1988942d5684fede8040d089b0c496ab86b899415ba9bfa0e49c`；environment/configuration digest `d226fc981e256f37686a0390b99d983045e33a2882047eda49afffcb936fc933`。request/permit/nonce尚未建立。
- Contract VERIFIED：與004除runId外逐項一致，startup30s/Human300s/close15s、Job355s/cleanup10s/outer400s/fallback5s；原exact9 events與Result v2/terminal reasons相同。future containing Git tree/blob綁定source，payload中的sourceCommit僅build baseline，不內嵌future SHA。
- Preservation VERIFIED：001–004/rehearsal inventory digests與歷史manifest全匹配（identity在005manifest）；compatibility五檔及既有untracked、main/Starter/三false gates保留；index在stage前空。rehearsal仍僅NON-ACCEPTANCE diagnostic；歷史timing不倒推為VERIFIED，004最後read差異仍UNKNOWN。
- D：exact13-path allowlist見manifest.localCheckpoint.scope，單一local semantic commit；commit後實際tree/blob與preservation檢查，再只讀origin research。只source/direct tests/005 binding與curated metadata，無raw runtime/company/credential資料或workflow改動。無push/permit/Electron；rollback需另授權scoped revert，禁止reset/clean或刪除歷史資料。native仍需獨立Human授權。

# 2026-09-12 Controlled reload navigation integration source fix

- A / field finding：Human回報NON-ACCEPTANCE rehearsal正常啟動、Deny/Allow/read/display可操作；只按一次Reload後未恢復可操作狀態，未重複Reload，最後unbound60s結束。rehearsal reproduced reload stall outside acceptance protocol，不能再將此rehearsal stall歸因Human sequence error。歷史001/002/003/004與rehearsal全保留，沒有005/permit/native run。
- Root cause分類：VERIFIED SOURCE BEHAVIOR：5dd1288b renderer使用window.location.reload；main did-start-navigation先revoke並observe reload，而will-navigate無條件preventDefault。SUPPORTED BY FRAMEWORK CONTRACT：Electron v43.6.0 web-contents官方文件將did-start-navigation列在will-navigate之前，取消事件阻止後續navigation；main programmatic API不發出will-navigate，webContents.reload重新載入current page。upstream WebContents::Reload呼叫NavigationController.Reload。這支持renderer navigation與防護policy的integration conflict；每次歷史reload是否實際走完整cancel鏈仍INFERRED，未有native navigation trace。
- Primary sources：https://github.com/electron/electron/blob/v43.6.0/docs/api/web-contents.md （Navigation Events / will-navigate / contents.reload）；https://github.com/electron/electron/blob/v43.6.0/shell/browser/api/electron_api_web_contents.cc （WebContents::Reload）。本輪唯讀取得，未下載到歷史evidence目錄。
- B complete：renderer guard保留，只將navigation換成preload controlledReload→app:controlledReload；handler僅controlled application註冊，驗證owned webContents、current main frame、固定document URL。先鎖reloadPending、revoke current grant、在handler唯一observe reload，再main wc.reload；failed acceptance不繼續reload。pending期間重複IPC不再次觸發，did-finish-load清pending；新renderer仍需原trusted Ready。did-start-navigation只做保守revoke，不能重複產生acceptance event。
- Security invariants：will-navigate仍無條件preventDefault，network/popup/download/permission拒絕不變；IPC不接受target URL/argv/root。ProjectRootGrants與read/revoke/security modules不改，ordinary main未新增handler，budgets/Result v2/sequence/runId不變。scope為3 product files、2 focused test files、todo；不修runId架構。
- C VERIFIED：40 focused renderer/A1/parent tests PASS/0 FAIL/0 SKIP；涵蓋renderer不呼叫location.reload、trusted preload/main IPC、unowned/wrong URL/stale frame拒絕、pending double IPC單次reload、navigation event不重複計數、new document/frame lifecycle模型、fresh Ready、舊Allow不能跨reload沿用、完整原sequence、任意renderer navigation仍拒絕。模型是deterministic framework-contract測試，不是實際Chromium/native lifecycle proof。Node/web typecheck PASS；exact source diff review與diff --check PASS。
- C build/preservation：`node --test test/a1-bundle.test.cjs` 1 PASS，正式main/preload/renderer memory build write:false及controlled lazy-service boundary通過，不覆寫歷史artifact。001/002/003/004及rehearsal完整sorted inventory digest於修正前後相同；歷史manifest、compatibility、main/Starter/gates與index另外核對。沒有執行舊admission verify去修補預期的source drift。
- Historical disposition：rehearsal stall與003未見Ready可由cancelled-navigation/old-document保留解釋，但具體歷史時序INFERRED。002/003 Human原操作敘述保留，不將整個stall歸咎Human。001舊deadline原因推定不變；004最後observed read與reported Reload差異仍UNKNOWN，此fix不能反推已解釋該read事件。
- D / next：形成coherent source checkpoint候選；原004 artifact/manifest不改，新的source已與004binding不同，不可再用004 admission。下次native需新candidate（例如005）、artifact/source/environment binding、immutable checkpoint與獨立Human授權；本輪不建立005、不commit/push/Electron。剩餘native obligation為main-owned reload→new Ready→re-consent/display→normal close真實整合。High risk bounded source-only；rollback需另授權scoped revert，不reset/clean或刪evidence。

# 2026-09-12 A1 native-004 — FAIL / human SEQUENCE_MISMATCH

- A VERIFIED：admission --verify exit0/CLOSED，HEAD `5dd1288bf8de264e46caba5afc700d80fc9be417`、candidate `43f8037e41e6bb8be906bc4298f29cd3d7e195d484ce176dac41fa5e1f782d50`、bound source/artifact/Electron/environment identities匹配；001/002/003原件及manifests、compatibility未漂移、index空、三gates false、004無prior attempt。
- B EXECUTED：獨立Human一次性授權，exact四-key permit、expiresAt建立時+600000ms；只執行一次admission --run，native attempts1/retries0。未縮短Human budget、未workaround/重試/改source。
- C VERIFIED：Result v2 run/candidate/request/nonce binding PASS；FAIL、phase human、reason SEQUENCE_MISMATCH。exact events `[deny,reload,allow,read,display,read]`；第六事件預期reload，實際read。非Human timeout、非supervisor timeout。
- Human visual：Human明確回報一次native Allow後Read complete及畫面A1 synthetic read；之後只按一次Reload，未看到Ready，沒有再次Reload或Read/Allow，保持不操作。這是Human observation，非automated optical proof；Human稱附圖包含004 synthetic root/readme.txt/status/content，本工具session未取得image bytes，未建立image hash或獨立看圖驗證。
- Evidence discrepancy：首次allow/read/display與Human一致；其後Human回報Reload，automated記錄read而非reload。原因UNKNOWN，不推定Human誤操作、guard失敗或consent/read product defect；不能把本次改寫為Ready timeout。第二次reload完成／Ready回來尚未建立。
- Path claim：bound product events與Human visual支持一次正式renderer/preload/IPC/native consent/readFileText/display成功；完整第二次reload/re-consent/display/normal-close sequence未完成，A1仍FAIL。
- C lifecycle VERIFIED：root1/helper0、Job Member=true、ActiveProcesses=0、cleanup VERIFIED_EMPTY；TimedOut/RootTimedOut=false，無query/termination/persistence error。permit已消耗、active authorization不存在、三gates仍false；post-run verify({fresh:false})及result/receipt hash檢查PASS。001/002/003 inventories與manifests unchanged，compatibility保留，index空。
- D evidence：`.tmp/a1-native-004/`全部原件保留，索引native-outcome.json SHA256 `7c07e74054ec5780a2c87471311664257b7953521538db771676345199bccc32`；request `7635cabe8316da7e21a1352da2386d4963dd244128d40b3dec3ee2e710bfd86d`；result `7217a8a51128a446d410a916b1f9ec6232ee3f6746b3e3cb78a1fa8142ce5f8f`；receipt `5aa55abde45c75ef636457de1714b7c160aa81b5d19e5ceffac87e7f308c1aec`。
- 下一obligation：唯讀對照reported Reload與observed read的來源，保持原因UNKNOWN直到有證據；完整sequence/second re-consent/normal close仍待驗。004已消耗不可重用；任何新native須獨立run/candidate/authorization。形成failure evidence/document候選，未commit/push、未開始B，不外推full-app/worker/company/OS isolation readiness。

# 2026-09-12 A1 native-004 immutable local checkpoint

- A/C VERIFIED：baseline HEAD eab8602d、research branch、index空；exact10-path scope/raw hashes/Git blobs、004 candidate digest `43f8037e41e6bb8be906bc4298f29cd3d7e195d484ce176dac41fa5e1f782d50`、artifact/environment admission verify PASS。001/002/003 inventories及historical manifests、compatibility/untracked、main/Starter/三false gates全部保留；004無permit/request/attempt。
- B/D：只依Human授權exact10-path local commit，manifest scope為唯一allowlist；payload不變，metadata以containing commit表示source checkpoint，不嵌入future SHA。沿用39 tests、兩項old-FAIL/new-PASS regression、9 selectors、四typechecks、121 outputs/233 inputs及source review；本輪不重跑native matrix。staged/committed tree逐項驗證source identity，commit實際SHA由交付報告與local receipt記錄。
- Guard review：!ready/busy/reloading禁用Reload；同步ref latch先於navigation，阻止同document重複callback；新document等trusted Ready。沒有新增acceptance event、sequence/budgets/Result v2/Ready IPC/security改寫。Ready-after-reload根因仍UNKNOWN。
- 本節取代下方歷史uncommitted狀態；不改寫003 FAIL。只local checkpoint，origin research最後只讀查詢；push需另授權。無workflow/credential/company data/raw runtime evidence納入；不permit、不Electron。

# 2026-09-12 A1 native-004 Reload guard candidate

- A complete：003 Human確認Deny後第一次Reload未看到Ready，因此再次按Reload，與automated deny/reload/reload、human/SEQUENCE_MISMATCH一致。003為Human sequence deviation；source VERIFIED repeated Reload was enabled while !ready。consent/read defect NOT ESTABLISHED；Ready-after-reload root cause仍UNKNOWN。只增補本節，不覆寫001/002/003原件。
- Goal/B：僅controlled renderer local reloading state加同步ref latch，Reload只在ready且非busy/reloading可操作；setState可能batch，ref在navigation前阻止同一document重複callback。新document預設ready=false，仍等正式trusted Ready ack；不sleep、不自動reload、不重設deadline、不新增acceptance event。004 fixed identity及直接builder/adapter/selector bindings最小替換，不重構runId架構。
- C VERIFIED：39 focused renderer/A1/parent tests PASS/0 FAIL/0 SKIP；新增2 guard tests在舊eab8602d UI失敗、修正後PASS。hook driver刻意batch state，驗證同一closure連點只reload一次，並涵蓋!ready/busy/reloading與新document重新等ack；不等於React DOM/native scheduling proof。初次cross-VM continuation未排空造成1 test failure，改用setImmediate排空async後通過；初始結果保留 `.tmp/a1-004-evidence/tests-initial-failure.txt`。
- C VERIFIED：9 pure selector checks/nativeCreation=false；worktree與materialized004 source Node/web四項typecheck exit0；exclusive build121 outputs/233 inputs；admission --verify exit0/CLOSED/nativeExecuted=false；exact source diff review及diff --check PASS。budgets和receipt/expected sequence逐項deepEqual003，Result v2/schema與main/preload/Ready/security source未改；未重跑native matrix。
- D complete：candidate `43f8037e41e6bb8be906bc4298f29cd3d7e195d484ce176dac41fa5e1f782d50`，manifest `tasks/a1-admission-candidate-004.json`，run `<REPOSITORY>/.tmp/a1-native-004`，artifact/main/index.js與project/app-data/helper-data全部新binding。request/permit/nonce尚未建立，留待future authorization。source baseline eab8602d加本輪overlay，尚未形成immutable Git checkpoint，不得把baseline稱004source commit。
- Preservation VERIFIED：001/002各152檔、003共150檔以及三份historical manifests與本輪baseline inventories逐byte hash相同；compatibility五檔/untracked完整保留，index空、HEAD/main/Starter未變、三gates false。003 Human補充只記此節與004metadata，不修改原件。
- Coherent local commit candidate：exact10-path scope與source/test raw/Git blob identities見004manifest.localCheckpoint。只Reload guard/new test及必要identity companions、manifest/todo。未stage/commit/push/permit/Electron；decision-ready for source checkpoint與Human審查，native仍需immutable checkpoint及獨立授權。High-risk runtime未授權；rollback需另授權scoped source revert，不刪歷史材料或reset/clean。
- 下一004 native驗收（需獨立授權）：區分a) Ready正常回來，Human可繼續；b) Ready不回來，既有bounded Human phase/terminal diagnostics保留真正Ready/reload failure evidence。guard不是Ready根因修復或native PASS；budgets/schema/sequence/security/ordinary mode不改。

# 2026-09-12 A1 native-003 — FAIL / human SEQUENCE_MISMATCH

- A VERIFIED：先admission verify exit0/CLOSED，HEAD `eab8602d2b0c369f3ee89bfbc18415c25be8c131`，candidate `2d815ffff0e4c45039450662b0150d7057d4df5a0ffa3b35cdfed78001084a20`、source/artifact/Electron/environment identities匹配；001/002各152檔及manifest未變、compatibility未漂移、index空、三gates false、003無prior permit/request/attempt。
- B EXECUTED：本輪独立一次性Human授權；exact四-key permit，expiresAt建立時+600000ms；只執行一次admission --run，native attempts1/retries0。使用committed phase/supervisor budgets，沒有縮短Human phase。未修改source、未fallback或retry。
- C VERIFIED：Result v2 binding PASS；FAIL / phase human / reason SEQUENCE_MISMATCH；exact events `[deny,reload,reload]`，第三事件預期allow。不是timeout。003第二個reload來源UNKNOWN；不能套用002的Human deviation歸因，也不能直接稱consent/read product defect。
- Human visual UNKNOWN：closeout尚未收到003-specific操作/畫面觀察，已另詢問；無automated optical proof。正式bound product event支持trusted Ready及native consent deny路徑；沒有allow/read/display事件，完整renderer/preload/IPC/readFileText/result delivery及deny無內容的Human visual確認尚缺。
- C VERIFIED：root exit1、helper exit0、Job Member=true、ActiveProcesses=0、cleanup VERIFIED_EMPTY；TimedOut/RootTimedOut=false，無query/termination/persistence error。permit已消耗為authorization.used.json，active authorization不存在；post-run binding.verify({fresh:false})及result/receipt hashes匹配，三gates仍false。HEAD/main/Starter未變，index空，001/002與compatibility保留。
- D evidence：全部原件保留 `.tmp/a1-native-003/`，identity索引 `native-outcome.json`；request SHA256 `c1e90bae111b8aa2bb95a277a14d30ff685a80b06ba9e28a64de916052b106bf`，result `5d98ed8792ac003589d5d88f332f2438ebff0ce7fe618d456dc94ba93d52cd8c`，supervisor receipt `b721be533c0528c40df793970324c018e1a6d93be8e00627f0ad911dec983356`。nonce由本次admission新產生，未重用舊request/permit。
- 下一obligation：先對照003 Human操作與reload event來源；完整deny/allow/read/display/re-consent/normal-close acceptance仍未完成。003已消耗不可重用；任何後續runtime需獨立candidate/run與授權。形成failure evidence/document checkpoint候選，未stage/commit/push、未開始B；不支持A/full-app/worker/company/OS isolation readiness。001/002歷史結果保持不變。

# 2026-09-12 A1 native-003 candidate / local checkpoint

- Goal：只為新獨立 acceptance attempt 綁定003 identity；不啟動 Electron、不 permit、不 push。A complete：HEAD9b65、index空、001/002各152檔 inventories及兩個歷史 manifests保存於 `.tmp/a1-003-evidence/baseline.json`；003 root/manifest原不存在。B complete：只改run contract、fixed builder/admission/supervisor/selector identities；build archive baseline提升至目前product checkpoint9b65，保留既有overlay機制，不做architecture refactor。
- Human補充002原因：**FAIL — Human interaction sequence deviation**。Human明確回報未依既定sequence完成操作，與automated `[deny,reload,reload]` / human / SEQUENCE_MISMATCH一致。此新cause disposition取代前節closeout時UNKNOWN，不改寫002原始result/outcome/markers，不歸因consent/read defect。
- Field finding：per-attempt runId currently participates in committed source contract，causing source checkpoint churn for a fresh acceptance attempt。只記錄，A1 acceptance前不擴大處理。
- Invariants/risk：phase、terminal schema、Ready、consent/read/revoke、supervision、ordinary mode、dependencies不變。新request/nonce/permit只在未來獨立授權時產生，本輪不得預先建立。High-risk runtime仍CLOSED；rollout僅source/artifact binding；rollback需另授權scoped revert，禁止reset/clean或刪除失敗evidence。
- B/C complete：003 candidate digest `2d815ffff0e4c45039450662b0150d7057d4df5a0ffa3b35cdfed78001084a20`；manifest `tasks/a1-admission-candidate-003.json`；root `<REPOSITORY>/.tmp/a1-native-003`；artifact `artifact/main/index.js`、synthetic `project/readme.txt`、app-data/helper-data均為新root。新nonce/request/permit均未建立。
- C VERIFIED：37 focused Node tests PASS/0 FAIL/0 SKIP；9 pure selector checks PASS/nativeCreation=false；worktree及materialized003 source的Node/web typecheck四項exit0；exclusive build121 outputs/233 inputs，BUILT_NOT_RUN。candidate budgets逐項deepEqual002：startup30s、human300s、close15s、bootstrap30s、launchMargin10s、workload355s、cleanup10s、outerMargin5s、outer400s、fallback5s；Ready/reload不延長Human總額，Result v2不變。Main獨立exact diff review僅identity與baseline替換，沒有額外語意；native matrix N/A — 未變且未授權runtime。
- C final VERIFIED：admission `--verify` exit0/CLOSED/nativeExecuted=false；001/002各152檔與歷史manifest hashes unchanged，compatibility/untracked完整保留、main/Starter/gates unchanged、index空、diff --check PASS。
- D checkpoint scope：exact8 paths見003 manifest.localCheckpoint.scope；三個adapter companion的變更直接支援固定run root/permit/request/Job selector，未改supervision。manifest保存raw source/test hashes及Git clean-filtered blobs，containing commit tree作immutable binding，無future commit SHA self-reference。raw001/002/tmp、compatibility五檔、其他untracked不stage。
- Publication：僅identity source/selector與curated metadata，無新增credentials/company data/原始runtime logs/workflow changes。origin research目前9b65；預期只可由9b65正常fast-forward到本checkpoint實際SHA，push需下一輪授權。001/002原件全保留；本輪形成003source checkpoint不代表native PASS。下一Human授權須綁定實際commit、003digest/run與committed contract；仍須fresh prelaunch reconciliation。

# 2026-09-12 A1 native-002 — FAIL / human SEQUENCE_MISMATCH

- A VERIFIED：admission `--verify` exit0/CLOSED；HEAD 與 origin research ref 均為 `9b65dbf826c5068da1de559b5b61c14938b0fb08`。candidate `ffc4f8cbf1bdb0fb0b7717a5f3ad0a7a5cf7df6b062fc4fcdc67bbbcd1bd2b5c`、committed source blobs、artifact/Electron/configuration、compatibility cohort、001 全152檔與舊 manifest 匹配；index 空、三 gates false、002 無 prior attempt/permit。
- B EXECUTED：獨立 Human 一次性授權；依 committed phase-aware contract 建立四-key bounded permit，只執行一次 `node tools/a1-admission.cjs --run`，native attempts1/retries0。沒有縮短 Human budget，沒有重跑或修改 source。
- C VERIFIED：Result v2 綁定 run/candidate/request/nonce，FAIL、phase `human`、reason `SEQUENCE_MISMATCH`；exact events `[deny,reload,reload]`，第三項預期 `allow`。不是 Human timeout，也不是 supervisor timeout。第二個 reload 原因 UNKNOWN，不推定 Human 操作錯誤或 consent/read defect。
- C VERIFIED：root1/helper0、Job Member=true、ActiveProcesses=0、cleanup VERIFIED_EMPTY、TimedOut=false，無 query/termination/persistence failure。active authorization 不存在、used record 存在、attempt marker 存在，三 gates 仍 false。post-run binding.verify({fresh:false}) 與 result/receipt digest 交叉驗證 PASS；001/compatibility 未變。
- Human visual UNKNOWN：closeout 尚無本次002的具體 Human observation；001視窗截圖敘述不能移用。正式 bound product events 支持 trusted Ready 與 native consent deny 路徑；沒有 allow/read/display，完整 renderer/preload/IPC/readFileText/result delivery 尚未驗收。deny 無內容的 optical observation 尚缺。
- D：原件保留於 `.tmp/a1-native-002/`：authorization.used.json、request.json、native-attempt.json、app-data/a1-result.json、supervisor-receipt.json、candidate.json；identity 索引 `native-outcome.json`。request SHA256 `a36ad7c148c5f2f7d8b628bf3b8d0751fa63d2beb49b6c1d5fc4ed0c6419cb4a`；result `8b75c9fe6588e459b0668b8f1be6c7403c82cc64caaf29f7b6da79d57578aa8e`；receipt `122e59bf5c40d8ff7d067c560f4fca4b4cdc7644ba2cd5cdcdd86ff363f7e9a8`。
- 歷史區分：Attempt0 prelaunch mismatch / Electron NOT STARTED；001 native FAIL/events[]/deadline cause INFERRED 保持原樣；002 是另一獨立 attempt，terminal mismatch VERIFIED。均不能改寫為 A1 PASS。
- 下一 obligation：以 Human 操作觀察對照 reload event 來源；任何後續 native run 需新的 bound run/candidate 與獨立 authorization，不清除002 markers、不重用002。形成 failure evidence/document checkpoint 候選；未 stage/commit/push、未開始B。A1完整 sequence/allow/read/display/re-consent/normal-close PASS 尚缺；不外推 A/full-app/worker/company/OS isolation readiness。

# 2026-09-12 A1 phase-aware immutable local Git checkpoint

- A VERIFIED：branch `research/electron-security-poc`、baseline HEAD `40c4aefc227358b949bcf190119cf4c96f98c52a`、index 空；candidate-002 digest `ffc4f8cbf1bdb0fb0b7717a5f3ad0a7a5cf7df6b062fc4fcdc67bbbcd1bd2b5c`、source/test raw hashes／Git blob mappings、artifact/environment verify 完全匹配。001 的152檔、舊 manifest、五檔 compatibility hashes 保留。
- B：Human 本輪只授權 exact 17-path local commit，allowlist 見 manifest.localCheckpoint.scope。產品 source/test/contract/payload 未改，只更新本 checkpoint metadata/todo；以 containing commit 的實際 tree/blob 固化候選，不在 payload 內嵌 future commit SHA。本節取代下方歷史「uncommitted」狀態，不恢復舊 native 許可。
- C：提交前核對 exact staged scope、manifest sourceGitBlobs、staged/working filtered identities、diff --check；沿用37 tests、final19 tests、9 pure selectors、四個 Node/web typechecks、121 outputs/233 inputs 與 Low review。本輪只重新 verify identity，不重跑 build/tests/native matrix。shared JSON 是 A1 timing SSOT；保留 Result v2 binding、trusted Ready、consent/read/revoke/ordinary security 邊界。沒有 source/runtime 語意新增。
- D：只 local checkpoint；commit 後驗證實際 source tree、HEAD/main/index/compatibility/001/gates/Starter，再只讀查詢 origin research branch。遠端查詢結果與 full commit SHA 由本輪交付報告／local-only checkpoint receipt 記錄，避免 self-reference；不 push、不 permit、不 Electron。
- Publication/rollback：只 source/tests/contract 與 curated metadata，不納入 .codex、raw runtime/tmp、historical artifacts、credentials/company data/profile；沒有 workflow/dependency/ordinary mode 變更。rollback 需另授權 scoped revert，禁止 reset/clean。main `3f53763fa4b82748e9e1ea6bff69e01fdfc52823`、Starter SHA256 `f7c0ec39f4fd86496ae751834825d0404c4d3c940eb01bd41d4e47520dc135f9`、三 gates false。部署/migration/restart N/A — checkpoint only。

# 2026-09-12 A1 phase-aware timing candidate — VERIFIED source / native NOT RUN

- Goal/acceptance：只修 A1 Human timing 與 terminal diagnostics；startup→trusted renderer Ready→固定 Human 總額→final display→bounded close；reload/partial progress 不延長 deadline。single JSON contract 綁定 app/admission/Job/outer；insufficient outer 在 launch 前拒絕。run `a1-native-002`，舊 run 不覆寫、不重用。
- Field finding：Human 回報正式 controlled UI Ready、synthetic root/readme.txt/buttons，第一次 Read 前等待截圖外部檢查，完成 sequence 前 app 自行關閉，未觀察到 login/install/provider/unexpected UI。這是 Human visual observation，截圖未由 Main 取得；非 native-pipe evidence。60s branch 可產生 FAIL/empty events/exit1 VERIFIED；此次觸發該 branch INFERRED。舊 FAIL 不改寫。
- A complete：讀取 exact HEAD/source/adapter/tests/CI/lessons；HEAD `40c4aefc227358b949bcf190119cf4c96f98c52a`，index 空，既有五檔 compatibility 與 todo/evidence 保留。B complete：phase controller／trusted Ready／terminal schema／budget binding。C complete：下列 deterministic checks/build/hash/review。D complete：新 source candidate、exact runtime contract、limits 與下一 obligation；停止，不執行 native。
- Scope companions：新增 shared JSON timing contract；`tools/a1-build.cjs` materializes new baseline+overlay/run，`a1-supervisor.ps1` 與 `research-job-preflight.ps1` 僅 A1 budget/selector 接線，`windows-lifecycle-transport.cjs` 保留其他呼叫預設且接受 A1 contract budgets。renderer/preload 只新增 trusted Ready acknowledgement。
- High risk source-only：固定 phases startup30s/human300s/close15s；Job/outer 加固定 margin，由 contract 推導。效果/security/ordinary mode/worker/dependencies 不變；rollout 僅新 source/artifact，native/permit/commit/push 均未授權。Rollback 取消新 admission、保留全部 evidence，不 reset/clean。驗證信號為 terminal reason、phase deadline 與 budget inequalities；不需 deployment/migration/restart。
- Candidate：[a1-admission-candidate-002.json](a1-admission-candidate-002.json)，payload SHA256 `ffc4f8cbf1bdb0fb0b7717a5f3ad0a7a5cf7df6b062fc4fcdc67bbbcd1bd2b5c`；run `a1-native-002`。baseline HEAD 加五個明列 overlays，17-path local checkpoint scope／raw hashes／Git clean-filtered blob mapping／verification 在 manifest metadata；尚未 commit，不能把 baseline HEAD 稱為新 immutable source checkpoint。正式 artifact `.tmp/a1-native-002/artifact`，121 outputs／233 source inputs，全量 hash 綁定；materialized build source `.tmp/a1-build-source-002` 不消費 compatibility dirty source。
- Phase semantics：bound controller 建立於 controlled application 初始化、`app.whenReady`／window/loadFile 前，startup30s；renderer 已 commit project/controls 後，正式 preload→trusted main `app:controlledReadReady` 啟動 human300s。按鈕在 ack 成功後 enabled/Ready；不是 helper-ready、process-created 或 sleep。Ready 重複、reload、partial progress 不更新 deadline；最後一次正確 display 啟動 close15s，必須 normal close。monotonic deadline 並在事件入口先判到期，queued progress 不可逃過 timeout。未帶 admission request 的既有 controlled UI 60s bound 由 contract.unboundMs 保留，不屬新 native acceptance。
- Single SSOT：`src/shared/a1-contract.json` 的 phase/supervisor 原始 budgets；Node 推導 candidate.timeouts，PowerShell/C# pure validator 交叉核對同一 contract；app bundle 內 contract 與 request-bound candidate 逐項 identity 匹配。inner=30+300+15=345s；launchMargin10s → Job workload355s（CreateProcess 前起算）；bootstrap30s + workload355s + cleanup10s + outerMargin5s → outer400s（helper spawn 起算）；retained-helper fallback 最多再5s，監督停止路徑上限405s。`345 < 355 < 400`，cleanup margin 明列；prelaunch 任一衍生值不符拒絕。main event-loop timer 不宣稱硬即時／可中断同步 I/O；卡住由獨立 Job/outer bound 收斂，cleanup UNKNOWN 不升級為成功。
- Terminal result version2：保留 version/runId/candidateSha256/nonce/requestSha256/result/events，新增 phase=`startup|human|close`、reason=`STARTUP_TIMEOUT|HUMAN_INTERACTION_TIMEOUT|CLOSE_TIMEOUT|RENDERER_GONE|SEQUENCE_MISMATCH|NORMAL_CLOSE_INCOMPLETE|PASS`。failure 即持久化並 exit1；Human timeout 不是 supervisor timeout。parent 在 root0 gate 前可保留已綁定 terminal diagnostics；PASS 仍須 root0/Job-empty/no supervisor error。close 後若 renderer 再異常，idempotent failure exit 強制 root1，不覆寫已存在 terminal result，整體不得 PASS。
- C VERIFIED：`node --test test/a1-timing.test.cjs test/a1-admission.test.cjs test/a1-controlled-read.test.cjs test/research-lifecycle-parent.test.cjs` → 37 PASS/0 FAIL/0 SKIP；涵蓋全部 phase deadlines、Ready、reload/partial progress 不延期、mismatch/normal incomplete/renderer gone、request/candidate/result binding、Human-vs-supervisor timeout、late renderer failure。`pwsh -NoLogo -NoProfile -NonInteractive -File test/a1-selector.ps1` → PS parse/C# compile/9 pure checks PASS，含 Node/native derivation equality、直接 supervisor pure validator insufficient-outer refusal；未呼叫 Admit/Win32/native。
- C VERIFIED：worktree 與 materialized build source 的 Node/web `tsc --noEmit` 四檢查 exit0；`node tools/a1-build.cjs` official Vite memory build→exclusive artifacts exit0，controlled graph 不載入普通 service graph；`node tools/a1-admission.cjs --verify` exit0、exact digest、CLOSED/nativeExecuted false。Low fresh-context review 最終 PASS：其發現的 close 後 renderer-loss exit 缺口已修正並有 bound regression；review 本身不等於 tests/native evidence。初期 loader interop／PS comparison／duplicate exit 問題與修正摘要保留於 manifest.verification，未掩蓋失敗。
- Finalization：build 後只補 validator 的 missing-contract 明確拒絕及 regression assertion，未改 compiled inputs/outputs；保留初次 build draft 於 `.tmp/a1-timing-evidence/build-draft-{candidate,manifest}.json`，重新綁定 adapter 得到上述 final digest。19 個 timing/admission tests 再驗 PASS，final `--verify` PASS，fresh-context metadata/source review PASS。這是本輪尚未獲 runtime 授權的新 candidate 定稿，不改寫舊001證據或借用其授權。
- Preservation VERIFIED：旧 `a1-native-001` 全部152檔 byte hashes 等於本輪 baseline inventory，舊 manifest 不變；Attempt0、native attempt1、Human observation 分開記錄。五檔 compatibility hashes、HEAD/index/三 false gates 保留；002 無 authorization/request/used/attempt/receipt，native attempts0。舊001不可重用、清 marker、重建或改寫。歷史 source/admission receipts 只支持舊身分，不能當新 native PASS。
- Decision-ready：新的 bounded source/artifact candidate 可供 Human 審查與另授權 local checkpoint；形成 coherent local commit candidate，沒有 stage/commit/push。下一 native authorization 必须綁定新 exact Git checkpoint＋上述 digest/run、candidate roots/artifact/Electron/environment、candidate timing/sequence/result schema，permit 四 keys/最多十分鐘，attempts1/retries0；先完整 reconciliation，任何 drift/unknown effects/cleanup uncertainty fail closed。push 不為本地驗收必要，也未授權。
- Runtime 仍未驗：新 Ready/phase timeout/native dialogs/deny/allow/reload/re-consent/normal close/Job lifecycle 的真實整合；需新具名 Human authorization。A1 尚未 native accepted，A/full-app/worker/company/OS sandbox/credential isolation 不外推。下輪不需重跑未變 native matrix；本輪完成即停止。

# 2026-09-12 A1 authorized native attempt 1 — FAIL / cleanup VERIFIED_EMPTY

- Authority：新的獨立 Human 一次性許可，明確採 committed candidate 的 outer 115s；HEAD `40c4aefc227358b949bcf190119cf4c96f98c52a`、candidate `3e96029dab7f5d97ccd1b4ba074dc5b27a03a8494ec0865810cb1ad15e41f932`、run `a1-native-001`。前次 Attempt 0 是另一個已用畢授權，Electron NOT STARTED；其 prelaunch-rejection 原件／hash 保留，未混成 native attempt。
- A VERIFIED：先執行 `node tools/a1-admission.cjs --verify` exit0/CLOSED/nativeExecuted false；committed manifest、232 source input HEAD blobs、checkpoint companions、121 outputs／Electron distribution／configuration、五檔 compatibility cohort、HEAD/index、三 false gates、empty synthetic data 與無 prior native marker 核對通過。當前 todo 僅含前次拒絕紀錄增補；執行契約取 committed A1 integration 節。preflight evidence 見下方索引。
- B EXECUTED：按既有四 keys schema 建立 expiresAt=建立時+600000ms 的 permit；唯一一次 `node tools/a1-admission.cjs --run` exit1，native attempts=1、retries=0。authorization.used／request／exclusive native-attempt marker 與正式 app result／supervisor receipt 均已持久化；沒有 source/candidate/timeout 修改、build、額外 Electron launch 或 PID cleanup。
- C FAIL：app result `FAIL`、`events: []`；deny/allow/reload/re-consent/read/display 沒有被記錄，正式 renderer→preload→IPC→native consent→read 全路徑 NOT_PROVEN，normal close NOT_PROVEN。request/candidate/environment/nonce/result/receipt binding MATCH。root ChildExit=1、RootFailed=true；helper exit0、Member=true、ActiveProcesses=0、cleanup VERIFIED_EMPTY；TimedOut=false、RootTimedOut=false、query/termination errors=null、ReceiptWriteFailed=false、persistenceFailed=false。TotalProcesses=4 僅 accounting，不當作 topology。具體 app exit1 原因 UNKNOWN，receipt 未唯一區分 app deadline／其他 exit1 路徑。
- C UI limitation：computer-use `sky.list_windows` 回報 native pipe unavailable / os error2，沒有 screenshot 或 native dialog 目視證據；已請 Human 依原 sequence 操作及回報，寫入 outcome 時尚未收到。不用 React acknowledgement 或 process exit 證明 optical/native acceptance，不因擷取失敗重啟 app。
- D evidence：[native-outcome.json](../.tmp/a1-native-001/native-outcome.json)，SHA256 `64eb751c37bfd0b78281cc8cae7a3dea94aae6158f71c94736688f94753b1c83`，索引 used/request/attempt/result/receipt/candidate/preflight/前次 rejection 的完整 SHA256、bytes、timestamps。request `a4578eaf3ed37cbc02acc47ce051763aae39f9624acca99f284adacbf1fc01f5`；result `fe3ecb51acdfe8a447f0032aac6a9e5b0288d0ca39d1031173fab6fe2a59fb8a`；receipt `f4c87bf9cd109b7731ceda82953908668ad40e7d4208c1a333b1f6362f53dbbe`。全部 local-only；synthetic cache/data 及失敗材料保留。
- D postflight VERIFIED：`binding.verify({fresh:false})` PASS；candidate/artifact/environment identities 不變、五檔 compatibility hashes 不變、HEAD 不變、index 空、三 gates source hashes 不變且仍 false。authorization.json 不存在、used record 存在；本次許可因 run failure 已用畢。前次 rejection SHA256 仍 `7502a1b5dbe1574a10a85ccee9f4c82581466cdced374af3e8969780432bcf7c`。
- Remaining obligation：取得 Human 本次 UI 觀察；另授權診斷空 sequence／exit1 的原因，才可能形成修正候選與另一份具名 runtime 契約。本輪不得 retry 或改 source。A1 native acceptance 未通過，A/full-app/worker/company readiness 與 OS sandbox/credential isolation 均未成立。
- Checkpoint／風險：形成 coherent failure-evidence/documentation semantic checkpoint 候選，非產品修正或 native acceptance PASS；沒有 stage/commit/push。High runtime 已結束且 Job empty 有收據；rollback 為停止 admission 並保留全部材料，無部署/migration/restart。自審以 app FAIL/empty sequence 與 cleanup 成功分開判定；不啟動下一 cycle。

# 2026-09-12 A1 native acceptance — FAIL / pre-launch contract rejection

- A：本次唯一授權限定 HEAD `40c4aefc227358b949bcf190119cf4c96f98c52a`、candidate `3e96029dab7f5d97ccd1b4ba074dc5b27a03a8494ec0865810cb1ad15e41f932`、run `a1-native-001`。首先執行 `node tools/a1-admission.cjs --verify`，exit0，回傳 exact digest、gate CLOSED、nativeExecuted false。live branch `research/electron-security-poc`、HEAD 匹配、index 空，既有五檔 compatibility dirty 與 untracked 保留。
- B：STOP。Human 要求 outer parent hard stop 90000ms，但 immutable manifest `candidate.timeouts.outer`、`tools/a1-candidate.cjs` assertion 與 `tools/a1-admission.cjs` transport argument 均為 115000ms。verify 的 candidate 自洽檢查通過，並不證明符合本次授權。未完成其餘完整 pre-launch reconciliation，不聲稱全部通過；沒有修復、build、fallback 或 `--run`。
- C：native invocations 0；deny/allow/reload/re-consent/display/normal close 均 NOT_EXECUTED；root exit、Job ActiveProcesses、cleanup receipt N/A — 本次未啟動 native，沒有 OS cleanup 成功推論。authorization.json、authorization.used.json、request、native-attempt、result、supervisor receipt 均不存在；三歷史 gates 實際 source declaration 仍 false，沒有開啟或恢復操作。
- D：本次 Human 授權因 pre-launch rejection 已用畢；沒有建立 permit，故沒有 used record，不偽造消耗收據。durable evidence：[prelaunch-rejection.json](../.tmp/a1-native-001/prelaunch-rejection.json)，SHA256 `7502a1b5dbe1574a10a85ccee9f4c82581466cdced374af3e8969780432bcf7c`；含 verify outcome、refs/index/dirty snapshot、source/manifest/environment identities、gate declarations 與 run record absence。這是 local-only admission failure evidence，不是 runtime result。
- 下一 obligation：另行決定如何解決 90s/115s 契約差異；若改 source/candidate，需另授權並重新綁定身分，之後 runtime 亦需新明確授權。本輪不處理、不 retry、不開下一 cycle。
- 新 semantic Git checkpoint：沒有產品實作候選；僅形成拒絕結果的 evidence/documentation 候選，未 stage/commit/push。A1 真實正式 renderer/preload/IPC/native consent/read/revoke/close/Job 驗收仍未完成；不推升 A、full-app、worker、OS sandbox/credential isolation 或 company readiness。
- 風險／回復：High runtime admission 已拒絕；保留 candidate 與失敗材料。部署／migration／restart N/A — 未 launch、未改產品。只新增本紀錄與 run-specific rejection evidence；不刪除材料或更動既有 candidate。

# 2026-09-12 A1 admission immutable local checkpoint

- A/C VERIFIED：HEAD baseline `e7a8ae4e2930ed4157163dfb36b3a7035e8846ff`；既有 source/test hashes 匹配，沿用 24 tests／5 pure selector checks／Node-web typecheck 證據，不重跑未變 matrix。重新執行 artifact admission `--verify` 核對原 candidate；沒有 build 或 native run。
- B/D：exact 18-file allowlist 與 source Git blob mapping 見 manifest.localCheckpoint；candidate payload/digest 不變。parent/binding 為共用 transport extraction 的必要 companion，另記 hashes；Git clean-filtered 換行不冒充 raw-byte 相等。manifest 不嵌入即將產生的 commit SHA，以實際 Git tree 核對。
- 本節所在 local semantic commit 固化下方 source candidate，取代「保留未提交」狀態。commit 後只讀查詢 origin research branch；push 與 native acceptance 均需後續 Human 授權。保留 compatibility 五檔與其他 untracked，main／Starter／native gates 不變。

# 2026-09-12 A1 artifact / production admission integration

- A VERIFIED：HEAD `e7a8ae4e2930ed4157163dfb36b3a7035e8846ff`、research branch、index 空；既有 compatibility dirty cohort 與 untracked 保留。上一輪 source manifest 不改寫。
- B VERIFIED：正式 bootstrap → controlledApplication/preload/renderer/project IPC 增加 bound result；固定 `tools/a1-admission.cjs` → `a1-supervisor.ps1` → existing Job Admit 的 A1 selector，reuse shared lifecycle transport。只接受固定 entry/mode，不提供任意 executable/argv/root。缺 permit 不進入 helper/native；缺 result 或 cleanup unknown 永不 PASS。
- C VERIFIED：focused Node tests `a1-admission`、`a1-controlled-read`、`research-lifecycle-parent` 共 24 PASS；PS parse/C# compile/pure selector 5 checks PASS，沒有呼叫 Admit。materialized baseline+overlay 的 Node/web typecheck exit0；官方 Vite config memory-build 後 exclusive 寫入 121 outputs，232 source inputs；controlled static graph 檢查 PASS。Low fresh-context review 無剩餘 source blocker。未重跑歷史 native matrix。
- D VERIFIED source candidate：`tasks/a1-admission-candidate.json`，SHA256 `3e96029dab7f5d97ccd1b4ba074dc5b27a03a8494ec0865810cb1ad15e41f932`。固定 baseline `e7a8ae4e2930ed4157163dfb36b3a7035e8846ff` 加 manifest 五個 product overlays；adapter/source blob/output/config/tool binary hashes 已綁定。Electron 43.6.0 exe SHA256 `9e1b3c401c1a1988942d5684fede8040d089b0c496ab86b899415ba9bfa0e49c`。新產物在 `.tmp/a1-native-001/artifact`，沒有使用歷史 out/package。
- 下一次 Human run 契約：先 `node tools/a1-admission.cjs --verify` 比對本 candidate；Human 明確一次性授權後，才可在固定 run 下建立 `authorization.json`，exact keys `{version:1,runId:"a1-native-001",candidateSha256:<上述 digest>,expiresAt:<未來最多十分鐘的 epoch milliseconds>}`，再執行一次 `node tools/a1-admission.cjs --run`。目前 permit 不存在、歷史三 gates false；不得因本記錄自行執行。
- 固定 synthetic roots：`<REPOSITORY>/.tmp/a1-native-001/project`（唯一 `readme.txt`，UTF-8 `A1 synthetic read` + LF）、`app-data`、`helper-data`；後兩者各有 home/userprofile/appdata/localappdata/temp/tmp 空目錄。固定正式 entry `artifact/main/index.js --munder-controlled-read`，固定 repo Electron。允許 app 自身 synthetic runtime data、result/request/receipt/attempt files 和 bounded Job cleanup；product write/delete/Git、agent/install/provider/service/network 仍拒絕。
- 一次 workload：Read file → Deny → Reload and revoke access → Read file → Allow → 看到 synthetic content → Reload and revoke access → Read file → 再次 Allow → 看到 content → 正常關窗。app 60s、bootstrap 30s、Job workload 70s、cleanup 10s、outer 115s、retained-helper fallback 5s；最多一次 native-attempt，不重試。
- 成功條件：上述正式 result sequence／candidate／nonce／request digest 匹配，正常 close、root exit0、Job active0、無 timeout/query/termination/persistence error，且 Human native dialog/display 目視證據另記。React acknowledgement 並非 optical proof；supervisor process completion 不等於 Task completion。
- Stop/restore：identity drift、缺失/過期 permit、拒絕/錯序、app/helper timeout、result/receipt 缺失、Job cleanup unknown 均停止並保留 evidence；不自行第二次啟動、不以 PID discovery 清理。permit 原子消耗為 authorization.used.json；結束後確認 authorization.json 不存在，保留 used/request/native-attempt/result/receipt，歷史 gates false。若在消耗前拒絕，撤回該次 permit；cleanup unknown 必須另由 Human 決策，不推論 OS cleanup PASS。
- 未驗：本 candidate Electron/native dialog/Job lifecycle/revoke 的真實 runtime；full-app、worker supervision、company readiness。環境投影不是 OS sandbox/credential isolation。source hashes 只證明 local freshness，不證明 hostile-host authenticity。可作 coherent local source checkpoint，本輪不強迫 commit，保留 index 空與既有 cohort，不 push。
- High risk：只 source/build，reuse Job creation/cleanup；artifact 在 repo .tmp 新目錄，baseline committed source 加明列必要 overlay，不消費 compatibility dirty source。Rollback 取消 admission，保留材料；不 fallback／reset／clean／push。
- 直接 blocker：正式 app 缺 task result producer；沒有它，exit0/Job-empty 無法證明 A1。窄接 consent/read/renderer acknowledgement/close。環境需固定 A1 map，不能使用 fixture map。

# 2026-09-12 A1 local Git checkpoint

本節只記錄上一輪 source integration 的 Git 封存；不實作 artifact binding／supervisor adapter，不啟動 Electron，不 push。

- A VERIFIED：pre-commit branch/HEAD/index 與上一輪相同；manifest 的 source、dependency、compatibility raw hashes 及 candidate digest 全匹配；三個 native gates 仍 false。Starter hash 與上一輪相同，main 未變。
- B：exact staging allowlist 是 manifest.localCheckpoint.stagingAllowlist 的 14 路徑；產品 source/tests 完全未變，只補 checkpoint metadata 與 todo 公開用路徑表示。既有五路徑 compatibility cohort、.codex、其他 local evidence/tmp 全部排除。
- C：提交前逐項比對 staged source 與 sourceGitBlobIds，確認與原 worktree bytes 僅 Git clean-filtered 換行差異；review exact staged diff 與 diff --check。上一輪 36 PASS / 1 existing privilege SKIP、10 A1 cases PASS、Node/web typecheck、bundle graph 與 Low review 證據沿用，不偽稱本輪重跑或 clean-commit runtime PASS。
- D：本檔所在 A1 source checkpoint commit 取代下方「保留未提交」的歷史狀態；full SHA 由 git log 取得，避免 self-referential commit hash。commit 後只讀查詢 origin research ref，評估正常 fast-forward；本輪不 push。
- 公開範圍：private host root 改為 <REPOSITORY>；manifest 保留原 raw identities 並另列 Git blob mapping。沒有 credential/company data/raw logs。無 workflow 變更；此 research branch 不匹配現有 push branch/tag triggers。
- 風險／回復：source-only local checkpoint，不代表 runtime/adoption readiness。回復須另授權 scoped revert，禁止 reset/clean 或丟棄保留 cohort。下一個 A1 obligation 不在本輪執行。

# 2026-09-12 A1 正式 source integration — VERIFIED / runtime 未驗收

本節是目前接手入口；下方保留歷史研究與決策，不恢復一次性 native 授權。

- A VERIFIED：live HEAD `8ba3d67e0f0194ecdea171fa6e4b7d54c9ec88dc`、分支 `research/electron-security-poc`；main `3f53763fa4b82748e9e1ea6bff69e01fdfc52823`、index 空。既有 compatibility 五路徑仍為 46 additions / 20 deletions；全部既有 untracked 保留。舊 todo 的 `66cf7097` 是歷史值。
- Reconciliation VERIFIED：5 組 provenance 原件／redacted copy hash 全匹配；65 個 snapshot source mappings 中 63 不變，index/preload 兩項是本輪必要變更。三個 native source gates 均 false，沒有重跑舊 fixture matrix；舊 source-bound receipts 不適用新 candidate。原始 31 項引用不變。
- B VERIFIED：正式 Vite entry 現為 `src/main/bootstrap.ts`；先驗證 controlled mode，再 lazy import 受控 application 或一般 `index.ts`。受控圖不求值 config／PTY／analytics／integration services。兩種模式共用 `applicationWindow.ts` 與 `projectIpc.ts` 的正式 registration / consent / dispatch / `fs:readFile` → `readFileText`；正式 renderer entry → `ControlledRead` button → 正式 preload `readFile` → result display。
- B effects：受控模式只註冊 `app:controlledRead` 與 `fs:readFile`，即使 project consent 通過也沒有 write/delete/Git/agent/install/config/service handler。固定 root、拒絕 UNC／runtime overrides／缺或錯誤設定、canonical empty synthetic environment directories；lstat 逐段拒絕靜態 junction 後才 realpath。Electron app-data/session/cache/log/temp 重導；renderer network、非產品 file URL、popup、download、webview、web permission 拒絕。這些是 product source 控制，不是 OS sandbox／credential isolation。
- C VERIFIED：`node --test test/a1-controlled-read.test.cjs test/ide-image.test.cjs` → 36 PASS / 1 既有 Windows file-symlink privilege SKIP；junction cases PASS。A1 新增 10 cases 含完整 product module registration、正式 renderer button（inert hook driver）、preload、allow/deny、pending consent revoke、in-flight result suppression、重新同意、拒絕 effects／links。
- C VERIFIED：`npm run typecheck` → Node/web exit0（Node v24.13.0）；`node --test test/a1-bundle.test.cjs` → 1 PASS，正式 main/preload/renderer 的 Vite build `write:false`，未覆寫 out；實際 chunk graph 確認 lazy service boundary、同層 main chunks、共用 registration 與 renderer read call。`git diff --check` PASS。最終 Low fresh-context 唯讀 review：本 source scope 無剩餘 blocker；測試結果由 Main 執行／判定。
- D VERIFIED：source candidate 身分與 exact file hashes 見 [a1-source-integration-2026-09-12.json](a1-source-integration-2026-09-12.json)，digest `70f82c4dac362dbaf767c36928d35fcbffa7d472807676971f949ea61f0f557c`。12 個 source/test 路徑＋本 todo／manifest 為本輪 scope；既有 compatibility 五路徑另列且保留。形成適合 local source commit 的 coherent semantic checkpoint；本輪保留未提交 candidate，沒有為結束回合強迫 commit，沒有 stage/push。
- 限制：React DOM／native dialog／正式 Electron／full-app／worker supervision／company readiness 都未驗收。一般模式成功路徑保留原 service graph／read contract，只有編譯／共用 handler 證據，未啟動。撤銷是抑制 stale delivery，非 I/O cancellation；concurrent same-user retargeting／惡意 launcher 不在本 bounded mode 保證內。沒有 credential/profile/company data 存取、agent／install／外部 integration 啟動。

## 下一個 A1 obligation：將此正式 candidate 綁入 bounded Windows runtime 驗收（未執行）

缺少正式 entry 的 supervisor/source-artifact/environment admission adapter，會讓 **正式 app launch → creation-bound supervision → finite exit/cleanup evidence** 無法安全驗收。舊 adapter 固定 research fixture，不能改 argv 後冒用其 PASS；這不影響本輪已完成的 source integration。下一轮先完成該窄 adapter／artifact identity，再請求／使用具名 runtime 授權；不再建立平行 IPC fixture。

下一次 bounded run 的具體候選契約（不是執行許可）：

- Candidate：上述 HEAD＋manifest digest／compatibility hashes；現有 Electron `43.6.0` 的 `node_modules/electron/dist/electron.exe` SHA256 `9e1b3c401c1a1988942d5684fede8040d089b0c496ab86b899415ba9bfa0e49c`。本輪只做 memory build，**runnable artifact 尚未 materialize/hash**；下一輪必須由這組 source 產生 `.tmp/a1-runtime-001/artifact/{main,preload,renderer}`，含正式 `main/index.js`／lazy chunks／assets，記錄完整 hash 後才可 admission，不使用舊 out 或 fixture package。
- Synthetic root：`<REPOSITORY>/.tmp/a1-runtime-001/project`，唯一 fixture `readme.txt` 的 UTF-8 bytes 為 `A1 synthetic read\n`（末尾 LF）；不含 links/Git/company data。App-data 為 sibling `app-data`，只預建空的 `home,userprofile,appdata,localappdata,temp,tmp` 六目錄；runRoot 本輪未建立。
- Launch：固定以上 executable、materialized `artifact/main/index.js`、唯一 flag `--munder-controlled-read`。`MUNDER_A1_PROJECT`／`MUNDER_A1_APP_DATA` 指向上述絕對路徑；HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP 逐一指向對應空子目錄。Supervisor 必須清空再建立已驗證 allowlist env（OS 必要值沿既有 evidence 校驗），不完整繼承、不設 provider keys／真實 CODEX_HOME／renderer dev URL／NODE_OPTIONS；不得關閉 Electron sandbox。環境重導不等於 OS 憑證隔離。
- Effects：一次 app root＋必要 Chromium children；只載入本地 product assets、synthetic app-data/cache/log writes、上述專案 read、原生 deny/allow consent、reload/revoke、close。禁止 agent spawn/install/project mutation/Git/network/service。流程：deny 無內容 → reload → allow 顯示已知內容 → reload 要求重新同意 → close；任一未知 effect 立即停止。
- Timeouts：一次 attempt、零 retries；app 內 hard deadline 60s（exit1）；外層 root deadline 70s，最多 10s creation-bound tree cleanup，parent hard stop 90s。若新 adapter 不能提供這些保證，停止於 admission，不 native launch。
- Cleanup／stop：只操作該 run 的持有 handles／Job，不 PID 掃描／kill unrelated；保存 receipt、source/artifact/env 身分與 app-data，不自動刪除失敗材料。成功須有預期 read/deny/revoke 證據、root 正常退出及 Job active0；timeout、hash drift、缺 receipt、cleanup UNKNOWN、unexpected prompt/effect 一律 FAIL/UNKNOWN 並停止，沒有 fallback／下一 attempt。完成後 gates 恢復 false。
- High risk rollout：本輪 source only，下一次 runtime 另授權。Rollback＝取消該 launch／停用受控 candidate，保留 diff/evidence；不 reset/clean、不同時回退成一般啟動。監測信號為 refusal／有限退出／source-bound result／cleanup receipt。部署／migration N/A — 本輪沒有。

本輪已停止；不操作 stored Goal、main、Starter、Codex 設定，不自行開始 native run 或下一 cycle。

# 2026-09-12 原始目標回復與 Windows 安全可用里程碑對齊

本節為目前接手入口；下方 2026-09-11 snapshot 保留歷史證據，不是目前執行授權。
原始目標與 31 項原文見 [Munder-original-goal-reference.md](Munder-original-goal-reference.md)。
編號代表成功條件，不是 31 個依序執行的工作；本表摘要不取代原文。
本輪僅更新本待辦；目標引用原文不變。止於對照及下一項工程契約，等待下一次指示。

## 現況、證據效力與本輪 A–D

- VERIFIED：分支 `research/electron-security-poc`，HEAD `66cf7097c24ec16b92bc8f54c71c9be665d81ee1`，等於指定比對基準；main 為 `3f53763fa4b82748e9e1ea6bff69e01fdfc52823`，index 空。
- 既有 dirty cohort：`src/shared/codexRemote.ts` 與 `test/{agent-token-cap,cli-install-ladder,codex-remote,transcript-project-dir}.test.cjs`，合計 46 additions / 20 deletions。既有未追蹤目標引用、證據、lessons、`.codex/`、`tools/research-test.cjs` 全部保留；未讀 Codex 設定。
- `review-snapshot.json` 的 sourceCommit 是 `03c964b…`，不是目前 HEAD；65 個 sourceMapping 原始位元組雜湊本輪全匹配。其「Original31 criteria missing」是已由目標引用解決的歷史限制，不改寫舊 snapshot。
- `evidence/provenance.json` 的 5 組原件及 redacted copy 雜湊全部匹配；歷史 todo 雜湊匹配 `f50c1548…`。這證明材料身分仍有效，不是重跑或全應用驗收。
- Starter v1.5 唯讀核對：SHA256 `f7c0ec39f4fd86496ae751834825d0404c4d3c940eb01bd41d4e47520dc135f9`。沒有近層 AGENTS.md；遵循本輪使用者界線。
- A 完成：核對指定資料、正式讀取／工作者路徑及證據限制。B 完成：只寫本表、優先序、下一項契約與實戰觀察。C 完成：31 編號／引用／差異與證據核對、獨立審閱；結果見本輪驗證註記。D 完成：交接剩餘義務，停止。
- 風險 Low（文件）；產品測試／build／native probe N/A — 無產品變更且本輪禁止執行。部署、migration、restart N/A。回復僅移除本輪待辦增補，保留既有內容與所有研究成果；不使用 reset/clean。驗證信號為本輪只有 todo 變更、refs/index/保留材料不變。

## 目前里程碑與有範圍的決策

優先序 A → B → C 是本輪 Human 決定，並未刪除其他原始義務：

- **A：完整 Munder 在 Windows 的受控基本流程與必要安全控制。** 正式 app 啟動、專案存取與退出的實際路徑；不能用 synthetic fixture 或舊 package 代替。狀態 PARTIAL / 整體未驗證。
- **B：實際 Codex 工作者啟動、監督、結果驗收與停止。** Munder 外層負責派工授權、worker/run 身分、時限、停止、證據與驗收；CLI 內層執行任務／工具，其既有沙箱與核准能力須另驗，不能靠外層文字宣告。狀態 BLOCKED：正式 PTY 路徑尚無與研究契約等價的證據。
- **C：無進展／失敗時受限恢復與低成本接手。** 先保存成果、分類失敗，再依有限預算續行／接手；輸出活躍不等於任務進展。狀態候選，依賴 B 的可靠身分、terminal outcome 與成果引用。
- **持續義務 H：** Starter 實戰評估、上層需求到契約、能力演進、模型獨立性及交接。與 A/B/C 並行記錄，不另開長期規劃工程。**後續 R：** 完整安全處置、發佈／公司採用決策。
- 歷史推送例外：目標引用及本輪 Human 訊息確認曾另行授權指定研究分支的特定推送。歷史摘要線索（session `01a08be4-66d7-7eb1-bbab-16f5a4081c4c`，非本輪原始收據驗證）：一次將 `66cf7097c24ec16b92bc8f54c71c9be665d81ee1` 推至 `https://github.com/forgivesam168/munder-difflin.git` 的 `refs/heads/research/electron-security-poc`，不含 tags/force/main/其他 ref，摘要記錄已成功；目前 remote 狀態 UNKNOWN，線索可能過時。第 30 項原文保留，不能聲稱遠端從未改變，也不能延續已用畢許可；本輪不查遠端、不 push。
- 歷史一次性執行：WkZNda、46rZVD、mgQ27v、aFH8ku 分別見 supervisor 契約及相應 checkpoint/run；只適用指定 fixture/attempt，均記錄已用畢、gates restored。三個目前 source gates 均為 false。新執行需新範圍授權。
- stored Goal 不操作；不修改 main、Starter、Codex 設定，不 commit/push、不安裝、不讀憑證或公司資料、不擴張網路權限。必要才委派、最小上下文、預設 Low；不把工具能力或工程契約當成授權。

## 原始 31 項對照

狀態：已實作＝source 存在；已驗證＝指定範圍證據成立；歷史＝當時 artifact 的證據；候選＝尚未完成實作／實戰；BLOCKED＝缺具體整合或授權；UNKNOWN＝材料不足。PARTIAL、DEFERRED、BLOCKED 均不是功能完成。
證據縮寫：S=`review-snapshot.json`；V=`evidence/validation-summary.json`；N=`evidence/provenance.json` 與 `native-read-run-2026-09-11.json`；W=`windows-supervisor-contract.md`；E=`windows-environment-contract.md`；G=`governance-2026-09-10.md`；L=`lessons.md`。G/W/E 的舊「下一步」由較新具名證據取代。

| 原編號與語意摘要 | 目前狀態 | 適用證據 | 剩餘成果 | 里程碑 |
| --- | --- | --- | --- | --- |
| 1 架構與重要信任邊界足供安全評估 | PARTIAL 已識別 | SECURITY.md、src/main/index.ts、pty.ts、ptyEnv.ts | 正式啟動／agent／外部效果邊界評估閉合 | A/B/R |
| 2 既有安全發現對目前 code 重驗 | PARTIAL／歷史 | G、S；未取回完整舊 findings | 逐一綁定現行 source；未取回者 UNKNOWN | A/R |
| 3 重要安全發現適當處置 | PARTIAL／OPEN | SECURITY.md、G | 環境／網路／Git 等未決處置與 Human 決策 | A/B/R |
| 4 授權內高價值修正已實作驗證 | 部分已實作＋限定已驗證 | S/N、updater source、V | 正式 app 整合及其餘 in-scope 修正驗證 | A |
| 5 FS/path/IPC/process/env/credentials/external/updater/network/scripts/Skill/Plugin/MCP/Runtime 權限面 | PARTIAL，整體阻擋 | SECURITY.md、W/E、正式 PTY 路徑 | 各面適當處置；研究 map 不等於 worker 隔離 | A/B/R |
| 6 Electron／依賴現代化連貫，非盲抄 PR170 | 已實作／歷史驗證 | G、package.json、package-lock.json | 保持遷移理由與 current artifact 一致 | A/R |
| 7 Electron 支援版本或有證據阻擋理由 | 已選 43.6；當前支援性未重驗 | G、歷史 todo 的遷移決策 | 整體驗收前查官方當時支援政策；本輪不宣稱 current supported | A/R |
| 8 選定 Electron/Node 原生相容性 | 歷史 artifact 已驗證，現行全 app UNKNOWN | G：packaged native 2PASS | 含目前安全修正的 Windows app/artifact 相容性 | A |
| 9 相關 critical/high 依賴修補或理解及控制 | PARTIAL／OPEN | G：兩項 high TOML/Tunnelmole 歷史記錄 | 現行可達性、處置／必要控制；非零風險驗收 | A/R |
| 10 安裝／lifecycle 無未解外部效果 | PARTIAL／歷史 | G、L 的有效依賴圖／packaging 經驗 | 正式可重現安裝效果閉合；新安裝另授權 | A/R |
| 11 Windows 有實證非 macOS 推論 | 限定已驗證 | W/N、G 的 Windows native/package | 完整使用路徑 Windows 實證 | A/B |
| 12 重要 Windows path/process/native 行為已行使 | 部分已驗證／歷史 | W/N、V、L | 正式 PTY 停止、完整 app、未涵蓋 path 邊界 | A/B |
| 13 tests/typechecks/build 通過或有證據分類 | PARTIAL／歷史 | V：node/web exit0、image 26PASS/1SKIP | dirty cohort／clean artifact 的適用檢查；不冒稱 full suite | A/B |
| 14 Runtime/integration 聲明有適當驗證 | fixture 已驗證；正式 app BLOCKED | N/W 與下節路徑對照 | 正式 read/consent、worker 與恢復整合證據 | A/B/C |
| 15 Starter-compatible Runtime 適用性評估 | PARTIAL 候選；非採用批准 | W/E、SECURITY.md、本節 | 以 A/B/C 實戰作 evidence-based suitability 判定 | H/R |
| 16 Starter 未修改且具實戰發現 | 本輪文件已核對；有專案觀察 | Starter hash、L、下節觀察 | 持續有效性評估；不可升格通用規則 | H |
| 17 區分 Runtime 限制與 Starter 設計缺口 | 部分已記錄／假設待驗 | 正式 PTY 差距；Starter §11.13、§14 | 用 B/C 證據檢驗歸因 | H/B/C |
| 18 Intent→Research→需求→規格→架構→規劃→分解→整合義務→契約候選 | 專案局部候選 | 本表→A 邊界→下一項工程契約 | 完整上層鏈實例與可用性評估，非完整已交付方法 | H |
| 19 明確推導整合義務，非晚期臨時發現 | 本輪局部已明列 | A/B/C 路徑、下一項依賴／驗收 | 下一切片以正式入口驗證；廣泛推導能力仍候選 | H/A/B |
| 20 具治理的能力演進概念 | 專案候選 | 原始目標、下節觀察→試行→評估 | 跨實際交付驗證治理與成本 | H/C |
| 21 從實戰導出 Skill/Tool/Validator/Runbook/Hook/Runtime/移除 | 部分候選 | L、現有 source identity／receipt 工具 | 依穩定性分類並試行 keep/refine/remove；不先新增框架 | H |
| 22 自我改善不暗中擴權 | 本輪遵守；整體未證明 | gates false、G、授權段落 | worker/runtime 技術權限與能力變更控制驗證 | B/H/R |
| 23 設計保持模型獨立 | 設計原則／待驗 | 原始目標；本輪外層／內層責任契約 | 可替換 executor 的實際驗收；非綁定 Astra | H/B |
| 24 最低足夠模型路由可信路徑 | Low 政策／候選 | 本輪成本政策；S low review 記錄 | 有界工作與驗證器先行，失敗證據才升級；實際成本效益待驗 | C/H |
| 25 委派價值與協調成本實證 | 局部歷史；量化 UNKNOWN | S 的 snapshot_review、W 的 scoped review | 區分發現價值與交接成本，不虛構節省數據 | H/C |
| 26 Main 維持目標連續性 | 本輪對照／契約完成，持續義務 | 本待辦、目標引用、原始 snapshot 限制 | 未來每輪保留剩餘義務，worker 回覆不自動完成 | H |
| 27 研究分支具連貫可審實作／證據 | snapshot 已審；整體 PARTIAL | S 的局部 APPROVE、目前 dirty cohort | 保留並處置未提交 cohort；只在另授權後 Git 交付 | H/R |
| 28 新 Main 無需重播對話即可理解目前權威狀態 | 本 checkout 可接手；純 clone PARTIAL | 本表、目標引用、S/N | 目標引用尚未追蹤；原始材料 local-only／未知項保留 | H |
| 29 main 不變 | 本輪 VERIFIED；歷史記錄一致 | live main=3f53763f…、G/S | 持續保護；不是未來修改許可 | H |
| 30 remote 不變 | 原義保留＋歷史有限例外；remote UNKNOWN | 本輪 Human、目標引用；無精確推送收據 | 後續需要時核對指定 push 身分；不得續用許可 | H/R |
| 31 無關 host 檔案／目錄不變 | 本輪範圍遵守；全歷史 UNKNOWN | 本輪只更新 todo；Starter hash 相同 | 無 host 全面不變證明；不為補證擴大掃描 | H/R |

## 控制接入層級與直接阻擋

| 層級 | 已有控制／證據 | 不可外推／尚缺 |
| --- | --- | --- |
| 研究 fixture | W 的 Job ownership、bounded monitor、explicit map、run/source/result binding；N 的 aFH8ku 五 assertions、root/helper0、member/active0；原件與副本 hash 匹配 | 固定 hidden synthetic Electron；不是正式 app entry／完整 dialog／Codex。map 與 request filter 不是 OS 網路或憑證隔離；歷史 failure matrix 不等於所有 current source 重驗 |
| 已接入正式 source | index.ts 的 authorizeProjectRoot→handleProjectIpc→fs:readFile→readFileText；preload 的正式 bridge、renderer consumers、document revoke；updater source-disabled | source 存在、限定測試有效；目前原生證據未穿過真實 fs:readFile 註冊及 native consent；舊 packaged artifact 早於安全修正 |
| 正式 worker source，未受同等驗證 | preload pty:spawn→index.ts spawnAgentCore→pty.ts PtyManager.spawn→node-pty；buildPtyEnv 繼承 parent env；kill/killAll→ensureKilled/hardKillTree；既有 idle/token/watchers | src 未引用 research-lifecycle/research-job；不能聲稱 Job creation ownership、allowlist env、tree-empty receipt 已接入 worker。缺 CLI 真實身份／結果驗收／安全停止整合及無進展恢復實證 |

A 的直接阻擋：正式啟動會接觸 config/hive/integration broker、analytics 等啟動面（index.ts app.whenReady 區段），尚無本輪可用的整體受控入口證據；正式 consent/read 與退出未整合驗收；當前安全版本的完整 Windows artifact 未驗證。
B 的直接阻擋：正式 PTY 環境、建立／停止 ownership、結果與 Task acceptance 邊界尚未證明；可能 auto-install 的 spawn 分支不能沿用 fixture 許可。C 依賴上述可信事件及 durable 成果，不能只加 idle timer 或自動重試。

## 下一個具體工程契約：A1 正式應用受控專案讀取切片（待下輪授權）

**成果：** 在完整 Munder 正式 entry/renderer/preload 路徑，提供可審查的 Windows 受控啟動及「選取 synthetic 專案→原生同意／拒絕→正式 fs:readFile→內容顯示→reload/關閉撤銷與退出」。必要安全限制在正式應用入口生效；不再建立另一個平行 synthetic app／孤立 native probe。A1 只是 A 的首個整合切片，非 A/B/C 完成。

**最小實作範圍候選：** `src/main/index.ts` 的正式 startup/consent/dispatch、其實際 config/service 初始化依賴、`src/preload/index.ts` 與既有讀取 consumer；只在缺口需要時修改。先沿這條 call graph 固定確切檔案 allowlist、輸入／效果；不擴掃所有歷史。不得以抽取字串 callback 或固定 research channel 的 PASS 代替正式註冊。

**必要依賴及實際阻擋：**

1. 正式 startup 的 synthetic home/config/cache/data 路由及非必要 service/agent 自啟動拒絕：實際阻擋無憑證／無公司資料的 full app 啟動；研究 `research-env` 不能直接假設所有 app 依賴都遵守。需要檢查的是正式可達路徑，不是再跑 helper map matrix。
2. 受控入口只許指定 synthetic 專案與讀取效果。現有 project consent 同時涵蓋 write/Git，不能把 UI 的「允許」當成只讀安全邊界；需在受控執行範圍實際拒絕 mutation/agent/install/external effects。這阻擋 A1 安全執行，不要求先完成全產品寫入交易／公司級隔離。
3. 完整 app 的 lifecycle ownership、有限 workload/cleanup 與退出結果：reuse 研究機制及有效證據，但正式 entry/argv/依賴不同，須做直接整合適配；不把 fixed fixture launcher 改成無限制命令入口。阻擋一次 full app runtime 驗證，並不阻擋先做授權內 source 整合。
4. 現有 Windows dirty cohort 保留；只有 A1 build／路徑實際受影響的項目才納入明確範圍與精準驗證，不能以清空 worktree 或全部重驗為通行條件。

**驗收與預期證據：**

- 正式入口先落實上述效果界線；缺少／不符受控設定時在效果發生前拒絕，不能 fallback 到日常 host config 或 agent 自啟動。記錄 source/build 身分與生效控制；環境重導不宣稱 OS 隔離。
- 經真實 renderer action、preload、正式 IPC handler 及 native dialog：拒絕時無內容讀取，允許後顯示固定已知內容，跨 document 後舊授權／舊回覆不得交付，新 document 必須重新同意；退出有 bounded cleanup outcome。不得把失敗、缺 receipt 或 cleanup UNKNOWN 標為 PASS。
- 預期保留一組 source/artifact 綁定的正式入口 integration 結果、dialog/畫面或事件證據、run/cleanup receipt 與效果邊界檢查；沿用 N/W 的未變機制證據。先用非原生 handler/service integration tests 驗證接線與拒絕分支；實際 Electron 僅在另一個明確授權的 bounded run 中驗收。
- 精準 typecheck／受影響 tests／必要 build 綁定實際候選；人工／獨立審閱檢查正式 path 有無繞過。只測抽取 callback、exit0 或 mocked dialog 均不足完成 runtime 驗收。

**授權、風險與停止：** 此為待執行契約，非本輪產品變更或執行許可。安全／環境與正式 native 效果屬 High；下一輪需明確產品修改範圍、startup 拒絕效果與驗證授權。真實 app 執行另指定 exact candidate、合成根、次數、時限與停止方式；Codex／帳戶／provider 網路、安裝、Git、stored Goal 均不隨附。若既有能力無法限制效果，只交付具體 blocker／差異，不開 gate 或無限新增前置。回復為停用受控入口／取消 launch，保留失敗材料；不回退到不受控啟動。驗證信號為 scope-bound result、拒絕事件及 cleanup；不新增全面 telemetry 系統。

**後續而非 A1 前置：** B 的真實 Codex worker adapter（有限啟動、身分、環境、停止／結果驗收）、C 的無進展分類與有限接手；write/delete/Git 已發生效果的部分結果與重試語意、全 IPC 消費者、完整 crash matrix、打包分發、公司身份／網路／憑證／供應鏈決策。這些仍是原始義務；A1 排除相關效果才可先整合，不代表它們已安全或可以刪除。

## Starter 實戰觀察（專案內，不修改 Starter）

| 觀察與證據狀態 | 已有材料／限制 | 專案候選與評估方式 |
| --- | --- | --- |
| 重複前置核對：VERIFIED 多個切片重做 source/env/receipt 檢查；是否全屬浪費 UNKNOWN | W 的 9/10 environment→invocation→monitor→binding→dispatch 演進；部分確有 source 變更，不能算無效重測 | 現有 hash/receipt 作共用量測引用；只有輸入變更、矛盾或新正式邊界才重驗。下輪比較是否直接產生正式整合證據（Starter §5.9/5.10） |
| 晚發現／未閉合整合義務：VERIFIED 反覆「next integration」而正式 app/worker 仍缺 | W、G、snapshot 的 actual fs:readFile 下一步；目前正式 PTY 路徑差距 | Main 在切片前標出入口→consumer→效果→receipt；上層規格／分解缺口是 INFERRED，非證明 Starter 無效（§11.13/14.14） |
| 人工中斷與回復摩擦：Human 本輪要求停止孤立測試並回復原始目標；歷史總次數 UNKNOWN | 舊 todo 與 S 寫 Original31 missing，目標引用現已存在；一次性 native 許可確有各自 stop | 本待辦作單一接手入口；區分必要風險授權與例行排程。不能從一次糾偏推論所有 Human 停止都不必要（§13） |
| 成本／委派摩擦：已有 scoped low review；實際 token/金額節省 UNKNOWN | S/W 的 review，未取回完整成本計量；本輪讀取大檔的輸出截斷亦增加定點補讀 | 最小上下文、預設 Low、必要才委派、有限失敗後有證據才升級；下次以有效發現、返工與接手是否重建歷史評估（§6.7/14.9） |
| Runtime 限制與治理概念分層：VERIFIED fixture 與正式 worker 機制不同 | ptyEnv 繼承、PTY kill 路徑 vs W/E；L 記錄假 PASS 與 artifact 不完整 | 執行／停止放 Runtime，artifact 判斷放 Validator，剩餘義務放 durable todo，Main 保留驗收；先 project-local trial，再 keep/refine/remove（§10/12） |

以上形成局部能力演進候選：觀察→分類責任→既有工具／契約小幅試行→用實際成果與成本評估→保留／修正／移除；不新增 Skill/registry，不暗中取得新權限，不把單次經驗寫成通用 Starter 規則。

本輪驗證註記：31 列編號恰為 1–31；`git diff --check -- tasks/todo.md` 通過；65 source hashes、5 組 provenance 原件／副本與歷史 todo hash 匹配。除 todo 外的 tracked diff 與 porcelain status 經換行正規化逐行等於編輯前；HEAD/main/index 與 Starter hash 不變。Low 唯讀 `alignment_review` 對編號語意、證據層級、A1 整合範圍與授權邊界 PASS；要求補入本驗證註記，已補。審閱不構成 source/runtime 驗收，產品測試未執行。

## 2026-09-11 local review snapshot（歷史，以下保留）

## Authority and goal

Build a hardened, modernized, Windows-capable, governable and verifiable multi-agent
Runtime; continue Field Validation of Multi-Agent Delivery Starter v1.5. This is a
research snapshot, not product completion, general IPC safety or company readiness.
At snapshot time the original31 success criteria were missing from readable repository
authority. This historical gap is now addressed by Munder-original-goal-reference.md
and the 2026-09-12 mapping above; neither is whole-goal acceptance or new authority.
Starter is an external read-only reference, not redistributed here. Its recorded SHA256:
f7c0ec39f4fd86496ae751834825d0404c4d3c940eb01bd41d4e47520dc135f9.
Do not change main/Starter/remote or Codex settings, operate stored Goal, push, inspect
credentials/profiles/company data, expand network access or destructively clean artifacts.
One-time native authorizations are consumed; all3 launch gates remain false. Full Access
is capability, not authority. Further runtime requires a new bounded Human authorization.

## Latest verified integration

Actual-read run aFH8ku: two fixed synthetic readFileText calls completed; normal content
reached renderer, revoked-grant result was rejected. Five fixture assertions PASS;
root/helper0, Job membership and observed ActiveProcesses0/VERIFIED_EMPTY.
Direct grant revoke precedes read; renderer termination is a separate scenario. This is
not pending-navigation IPC, actual fs:readFile registration/native consent dialog, I/O
cancellation or mutation rollback. TotalProcesses5 is accounting, not topology.
Source29 disk identities remain matched. See evidence/actual-read-checkpoint.redacted.json
and evidence/provenance.json. Redacted copies have their OWN hashes; embedded digests
refer to retained originals. They are review material, not executable admission records.

## Source, contracts and evidence

- Review source commit: recorded in review-snapshot.json. Project IPC/root-consent source,
  consumers and tests plus native supervisor/environment/binding/fixture source included.
- windows-supervisor-contract.md and windows-environment-contract.md preserve mechanism
  and stop rules. Earlier entries are dated evidence, not current launch authority.
- native-read-admission-2026-09-11.md documents the executed scenario; authorization
  consumed, no automatic retry. Governance history: governance-2026-09-10.md.
- Original checkpoint: tasks/native-read-run-2026-09-11.json remains LOCAL ONLY. Original
  request/result/receipt and fixed file under .tmp/electron-lifecycle-aFH8ku/, log under
  .tmp/command-cUdnzw/. Complete prior todo preserved locally at
  .tmp/review-snapshot-20260911/todo-original.md; identity in review-snapshot.json.
- Other historical tasks manifests/findings, failure evidence and .tmp artifacts remain
  local, unmodified. They are not implicitly available from Git. Do not upload all logs.
- Dependencies: package-lock.json is committed; node_modules/binaries are not. Recorded
  binary hashes are local provenance, not distribution/authenticity/host isolation proof.

## Next bounded milestone and open obligations

1. Assess actual fs:readFile channel/native consent wiring against the fixed research
   channel. Define exact effect/receipt/cleanup scope before implementation or launch.
   Existing component PASS is not a blocker requiring another isolated native preflight.
2. Pending navigation/crash IPC delivery remains separate and unverified.
3. In-flight write/delete/Git mutation partial outcomes/cancellation remain OPEN. Stale
   response rejection cannot undo I/O and does not authorize retries.
4. Original31 reference recovered on 2026-09-12; preserve process/network/credential/update/skill,
   packaging/full-app, Windows compatibility and Starter evaluation obligations.
No full-app gate can close from the current fixture. Original full historical context is
local-only; the remaining source/evidence availability limits are not completion.

## This cycle A–D

A complete: baseline refs/index, source29/artifact hashes reconciled; no native rerun.
B complete: dependency-scoped source snapshot and curated existing tasks index/contracts;
original logs/manifests preserved. Public candidates exclude .codex, .tmp, node_modules,
external Starter and raw historical findings. Sanitized copies identify redaction mapping.
C: exact staging/dependency review and local checks recorded in review-snapshot.json;
validation-summary.json distinguishes current-worktree tests from clean-commit evidence.
D: local commits only, no push. Snapshot does not accept all public-disclosure risks.

## Rollback and retained work

No production behavior edits this cycle; snapshot preserves existing source. Rollback
must be a separately authorized scoped revert, not reset/clean; do not discard dirty work.
Keep compatibility changes in codexRemote and its four test files local, plus .codex and
research-test.cjs orchestrator (not needed to run the explicit fixture commands). They
are not reviewed/committed by this snapshot. Full application validation remains limited.
License: source MIT; asset licenses are separate and redistribution remains a Human
publication question. Detailed local security findings are not included for publication.
