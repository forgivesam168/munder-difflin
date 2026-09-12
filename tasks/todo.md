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
