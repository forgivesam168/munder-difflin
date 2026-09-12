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
