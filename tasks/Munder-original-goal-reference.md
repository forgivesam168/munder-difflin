# Munder 原始目標與 31 項成功條件——來源回復參考

## 用途與界線

本檔由使用者先前上傳的原始 Goal 文字，依章節邊界直接節錄，供回復目前 repository 缺少的目標與成功條件。它不是新 Goal、執行提示詞、目前授權書，也不代表任一條件已通過。

- 原始來源檔名：`已貼上文字 (1)(20260907-090225).txt`。
- 原始檔案大小：47014 bytes。
- 原始檔 SHA256：`153bde8d7120efb3415d6ae4d7001f9be7cb57aaf2b9bc9294c1cc52c16c8776`。
- 以下原文區段直接複製原始位元組，保留 CRLF 換行與原有文字；本檔整體不是原始檔，不能套用原始檔雜湊。
- 本次節錄僅包含整體目標、長期願景、模型獨立性、Starter 定位、上層需求研究、能力演進、31 項成功條件及公司採用的獨立判定；不包含原始 Goal 的完整操作／授權章節。
- 原始第 30 項要求遠端不變。後續使用者已另外批准指定研究分支的單次推送：這項歷史例外應另行記錄，不修改原文，也不由本檔延續為新的推送權限。
- 原始未決條件即使有證據支持列為 BLOCKED，也不能標為功能完成、安全驗收或公司放行。
- 現行較新的授權、安全限制與已用畢的一次性許可，須由目前專案紀錄及 Human 指示核對。本檔不恢復已到期的 runtime 授權，也不准許修改 Starter。
- `Windows 安全可用優先`、`Munder 外層監督與內層 CLI 的分工`及之後的里程碑安排，應標為後續決策／建議，不偽裝成原始 31 項的原文。

## 節錄追溯

- 區段 A：原始檔第 65–382 行；節錄 SHA256 `819e8357dd44a5bcc86162e16a8a8e6fbfc18f7e1e221c80f116d270696fac16`。
- 區段 B：原始檔第 1819–1954 行；節錄 SHA256 `2005f3404963d6d13d2a0538b7be57c0d32bdd66b858f2de0b6a94758bd317a5`。

---

以下為原始英文節錄，保留原文以避免重譯改變驗收條件。

# OVERALL GOAL

Transform the current munder-difflin fork into a well-understood, hardened,
modernized, Windows-capable candidate Runtime for my future company
Multi-Agent software-delivery environment.

This is NOT merely:

- an Electron upgrade
- an npm audit cleanup
- a dependency migration
- a security report
- a refactor
- a Munder feature exercise

Those are possible obligations inside the larger Goal.

The real objective is to determine, through implementation and field evidence,
whether Munder can evolve into a trustworthy and useful Runtime for a governed,
high-quality, increasingly autonomous Multi-Agent Development System.


# LONG-TERM VISION

The longer-term system I want to build is approximately:

Human Intent
    ↓
Research
    ↓
Requirement Analysis
    ↓
Specification
    ↓
Architecture
    ↓
Planning
    ↓
Task Decomposition
    ↓
Dependency / Integration Obligations
    ↓
Task Contracts
    ↓
Portable Multi-Agent Delivery Harness
    ↓
Munder Runtime
    ↓
Codex CLI / other replaceable Agent runtimes
    ↓
Replaceable Models / Providers
    ↓
Implementation
    ↓
Verification
    ↓
Review
    ↓
Integration Verification
    ↓
Recovery / Re-plan
    ↓
Acceptance / Closure


The desired future is not one where the Human manually operates every Agent.

The Human should progressively spend less time on:

- issuing command-by-command instructions
- deciding routine workflow transitions
- watching worker completion
- manually retrying failed workers
- selecting a Reviewer for every trivial task
- repeatedly reconstructing project state

and progressively more time on:

- understanding user intent
- domain research
- requirement quality
- specification
- architecture
- project decomposition
- agent/capability design
- important product decisions
- material security/risk decisions
- Human acceptance


# QUALITY MUST NOT DEPEND ON THE STRONGEST MODEL

Astra is intentionally being used as a high-capability Main for this
experiment.

Do NOT design Munder, the Harness, Skills, workflows, or architecture around
Astra specifically.

The long-term system should obtain reliable delivery quality primarily from:

- strong Intent resolution
- good specifications
- appropriate architecture
- good Task decomposition
- clear responsibility
- explicit authority
- context engineering
- capability engineering
- Skills
- Tools
- deterministic Validators
- tests
- evidence
- verification
- independent judgment where useful
- integration verification
- Runtime state
- bounded recovery
- durable learning

Models should remain replaceable executors.

Eventually, ordinary or lower-cost models should be capable of reliably
performing bounded:

- analysis
- development
- testing
- review
- maintenance
- research

when the Harness gives them sufficient context, capabilities, constraints, and
evidence.

Stronger models should be used when Task characteristics or field evidence
justify them.


# PRIMARY HARNESS REFERENCE

Before making major Harness or Runtime conclusions, read this document in full:

D:\Research\Munder\docs\Multi-Agent Delivery Starter v1.5.md

This document is READ-ONLY during this Goal.

Do NOT:

- modify it
- reformat it
- move it
- rename it
- overwrite it
- delete it

Treat Starter v1.5 as:

- the current Portable Harness design reference
- a field-validation candidate
- a source of trust and responsibility semantics
- NOT unquestionable truth
- NOT a fixed workflow
- NOT a Runtime implementation
- NOT something that must be forced onto Munder

Important interpretation:

Starter defines portable semantics.

Munder is being evaluated as a Runtime / Environment realization.

Codex CLI and other execution systems are replaceable Runtime/execution
mechanisms.

Models and Providers are replaceable executors.

Do NOT redesign Starter merely to fit Munder.

Do NOT modify Starter during this Goal.

Instead, collect real field evidence showing:

- what works
- what is too heavy
- what is too weak
- what is missing
- what is duplicated
- what is misplaced
- what belongs in Runtime
- what belongs in Skill / Tool / Validator
- what belongs above the Starter
- what should be removed or simplified

A field finding is evidence for future Starter evolution, not automatic
permission to change universal governance.


# IMPORTANT UPPER-LAYER RESEARCH QUESTION

Starter v1.5 already identifies an important design gap above its current
delivery semantics.

Investigate the missing chain:

Human Intent
→ Research
→ Requirement Analysis
→ Specification
→ Architecture
→ Planning
→ Task Decomposition
→ Dependency / Integration Obligations
→ Task Contracts


The deeper question is:

How should a future Multi-Agent system reliably transform an imperfect,
ambiguous Human goal into well-founded executable work without allowing even a
very strong model to silently invent requirements or lose important system
obligations?

Use actual evidence from this project.

Do NOT prematurely turn an exploratory finding into universal process or
Starter governance.


# CAPABILITY EVOLUTION VISION

A second major research objective is to explore how the future Munder + Harness
could improve through actual delivery experience.

Desired conceptual loop:

Actual Delivery
    ↓
Observation
    ↓
Repeated friction / failure / Human intervention / duplicated effort
    ↓
Candidate Pattern
    ↓
Classification
    ↓
Capability Candidate
    ↓
Project-local Trial
    ↓
Evaluation
    ↓
Keep / Refine / Reject
    ↓
Promotion only when evidence justifies it


Possible dispositions include:

- Skill
- Reference
- Tool
- Script
- Validator
- Runbook
- Hook
- Plugin
- MCP / Adapter
- Runtime mechanism
- Durable State
- Governance issue
- Remove / simplify


Examples of useful signals include:

- repeated prompt patterns
- repeated manual procedures
- repeated Human intervention
- repeated review findings
- repeated recovery procedures
- repeated context retrieval
- repeated commands
- repeated testing procedures
- repeated integration gaps
- repeated worker failures
- repeated model escalation
- repeated expensive model usage for routine work


The future system may eventually be able to:

- detect candidate patterns
- propose project-local capabilities
- generate candidate Skills / Tools / Validators
- test them
- evaluate them
- refine or reject them

However:

SELF-IMPROVEMENT MUST NOT MEAN UNGOVERNED SELF-MODIFICATION.

Capability creation does not grant authority.

A capability must never silently grant itself additional:

- filesystem access
- credential access
- network access
- Git authority
- plugin installation authority
- production authority
- company-wide scope
- governance authority
- risk acceptance authority




---

# SUCCESS CRITERIA

The Goal is successful when the following are satisfied, or any remaining item
is explicitly BLOCKED with strong evidence and a decision-ready explanation.


1. Current Munder architecture and material trust boundaries are sufficiently
   understood for a defensible security assessment.

2. Previously identified security findings have been reverified against current
   code.

3. Material security findings are dispositioned appropriately, for example:

   FIXED
   MITIGATED
   NOT APPLICABLE
   ACCEPTED FOR CONTROLLED POC
   DEFERRED WITH REASON
   BLOCKED
   HUMAN DECISION REQUIRED

4. High-value, well-supported security fixes inside current authority have been
   implemented and verified.

5. Filesystem, path, IPC, process, environment/credential, external-content,
   updater, network, lifecycle-script, Skill/Plugin/MCP, and Runtime authority
   surfaces have appropriate disposition.

6. Electron/dependency modernization is coherent and is NOT a blind copy of
   historical PR #170.

7. Electron ends on a defensible supported version or there is evidence-backed
   explanation why migration is blocked.

8. Native dependency compatibility is established for the chosen Electron /
   Node combination.

9. Critical/high dependency findings relevant to actual build/runtime paths are
   remediated or explicitly understood with appropriate controls.

10. Lifecycle scripts and dependency installation do not contain unexplained
    external effects.

11. Windows has meaningful evidence rather than inference from macOS.

12. Relevant Windows filesystem/path/process/native-module behavior has been
    exercised where material.

13. Relevant typechecks/tests/builds pass, or failures are correctly classified
    with evidence.

14. Runtime/integration claims are supported by appropriate verification.

15. Munder has an evidence-based suitability assessment as a future
    Starter-compatible Runtime.

16. Starter v1.5 has concrete field-validation findings without being modified.

17. Field evidence distinguishes Runtime limitations from Starter design gaps.

18. There is a concrete project-local candidate for:

    Intent
    → Research
    → Requirement Analysis
    → Specification
    → Architecture
    → Planning
    → Task Decomposition
    → Integration Obligations
    → Task Contracts

19. Integration-obligation derivation receives explicit treatment rather than
    being left to late ad-hoc discovery.

20. There is a concrete, governed Capability Evolution concept.

21. The Capability Evolution concept can explain how candidate Skills, Tools,
    Validators, Runbooks, Hooks, Runtime improvements, or removals emerge from
    field evidence.

22. Self-improvement never silently expands authority.

23. The resulting design remains model-independent.

24. There is a credible future path toward minimum-sufficient model routing.

25. Delegation behavior itself has produced useful field evidence about when
    multi-agent execution adds value versus coordination overhead.

26. Main remains responsible for Goal continuity even when subagents are used.

27. The research branch reaches a coherent, reviewable implementation and
    evidence state.

28. A fresh Main can understand the authoritative current state without
    replaying this entire conversation.

29. main remains untouched.

30. remote repositories remain untouched.

31. unrelated host files and directories remain untouched.


# COMPANY-READINESS IS A SEPARATE DECISION

Do NOT equate successful home/POC execution with company deployment approval.

At Goal closure, classify readiness separately, for example:

NOT READY
POC READY
CONTROLLED INTERNAL PILOT CANDIDATE
COMPANY ADOPTION REQUIRES ADDITIONAL CONTROLS


Identify what remains before company use, especially around:

- credential isolation
- repository isolation
- network policy
- telemetry
- plugins / MCP
- identity
- auditability
- update policy
- software supply chain
- role/authority enforcement
- Runtime isolation


Do not accept those risks on behalf of the Human.


