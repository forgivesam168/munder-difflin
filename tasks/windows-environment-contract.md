# 2026-09-09 Research helper environment contract

Status: project-local implementation candidate, not implemented isolation or launch approval.
Scope: research-job-preflight Node launcher, PowerShell observer/helper and fixed Node
probe child. Electron remains gated; a future Electron child needs its own reviewed map.

## Verified source reality

- tools/research-env.cjs builds a new object, not a host environment spread. Its only
  environment-derived host input here is SystemRoot; PATH includes process.execPath's
  directory and OS directories. Generic executableDirs is empty at this call site.
- tools/research-job-preflight.cjs adds three PowerShell settings plus guard digest and
  mode-specific executable/fixture/token fields. spawnSync receives that explicit object.
- tools/research-job-run.ps1 checks nine directory variables, module cache path and
  eight fixed controls. It does not validate all keys/values.
- tools/research-job-preflight.ps1 Admit enumerates Environment.GetEnvironmentVariables
  into a Unicode block. The crash observer's ProcessStartInfo does not clear/rebuild
  Environment. Neither forwarding route currently enforces a complete allowlist.
- Prior empty-job receipts prove those probes succeeded, not exact post-startup key
  equality or that tools honor telemetry flags. No new native evidence in this cycle.

## Decision and complete producer inventory

Implement one project-local validated environment map, then use it explicitly at BOTH
forwarding routes. Never serialize the entire observed helper environment to a child.
Reject unexpected input keys at the Node launch boundary. PowerShell may add startup
keys: do not infer they are approved inputs or forward them. Validate required inputs
there, construct a fresh output map, and record unexpected key count only if useful;
never log unknown names/values (they can themselves contain sensitive information).
This design is environment propagation control, not a sandbox for the helper itself.

| Producer keys (case-insensitive Windows names) | Required value / validation |
| --- | --- |
| HOME, USERPROFILE | run/home directory |
| TEMP, TMP | run/temp directory |
| APPDATA, LOCALAPPDATA | run/appdata, run/localappdata |
| XDG_CONFIG_HOME, XDG_CACHE_HOME, XDG_DATA_HOME | run/config, run/cache, run/data |
| PSModuleAnalysisCachePath | run/module-analysis-cache regular-file target |
| GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT | 1, 0 |
| GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_KEY_1 | 2, core.hooksPath, init.templateDir |
| GIT_CONFIG_VALUE_0, GIT_CONFIG_VALUE_1 | run/hooks, run/templates directories |
| GIT_CONFIG_GLOBAL, NPM_CONFIG_USERCONFIG | run/empty-config, existing empty regular file |
| NPM_CONFIG_GLOBALCONFIG | run/empty-npm-global, existing empty regular file |
| NPM_CONFIG_CACHE | run/npm-cache directory |
| NPM_CONFIG_REGISTRY | https://registry.npmjs.org/; configuration only, no network permission |
| ELECTRON_CACHE, electron_config_cache | run/electron-cache directory |
| POWERSHELL_TELEMETRY_OPTOUT, POWERSHELL_UPDATECHECK | 1, Off |
| TUNNELMOLE_TELEMETRY, DO_NOT_TRACK | 0, 1 |
| NODE_DISABLE_COMPILE_CACHE, FORCE_COLOR | 1, 0 |
| SystemRoot, ComSpec, PATHEXT | launch-bound OS root, its System32/cmd.exe, .COM;.EXE;.BAT;.CMD |
| PATH | exact ordered current Node directory, SystemRoot/System32, SystemRoot/System32/WindowsPowerShell/v1.0; no empty or relative segments |
| RESEARCH_JOB_GUARD_SHA256 | exact launch snapshot digest; freshness, not independent trust |
| RESEARCH_NODE_EXECUTABLE | only admission/crash modes: exact launch-bound Node executable |
| RESEARCH_JOB_FIXTURE | only descendant modes: exact repository tools/research-job-descendant.cjs |
| RESEARCH_CRASH_TOKEN | only crash modes: launcher-generated UUID, exact handshake value |
| RESEARCH_LEAF_TOKEN | only descendant modes: launcher-generated UUID, exact completion value |

Use fixed key lists, reject duplicates ignoring case at serialized input boundaries,
and exact ordinal values after deliberate path derivation. Required missing/empty keys
fail; mode-inapplicable optional keys fail. Do not add arbitrary passthrough keys.
Validate repository/run first; path targets must stay at those exact static locations,
with non-reparse directories/files. Reject embedded NUL in keys/values before Win32
serialization. Preserve the sorted double-NUL-terminated Unicode block convention.

Launch-bound means supplied by the local launcher and captured in the receipt, not
independently authenticated. SystemRoot currently comes from parent environment and
must be explicitly documented/validated as a trusted OS-path input, not silently called
an OS-attested fact. Node and PowerShell binaries already have receipt hashes; hashes
do not grant trust. No new executable discovery or host directory scanning is needed.

## Integrated implementation task and acceptance

Affected files: research-job-preflight.cjs, research-job-preflight.ps1, research-job-run.ps1,
a focused environment-map helper/test if necessary, and receipt source inventory.
Keep generic research-env.cjs behavior stable for other test/build consumers.

1. Build/validate a complete launch map with a fixed schema and mode-specific fields;
   bind resolved OS/Node identities to the run input and evidence. Use structured data,
   not assembled shell syntax. If transported by file, include its identity in evidence
   and apply existing run/source constraints before use.
2. Validate/rebuild after PowerShell starts. Supply that fresh map to both the C# child
   block and ProcessStartInfo.Environment.Clear()/explicit entries for crash helper.
   A non-allowlisted key must never reach either child; do not rely on blacklists.
3. Unit cases: exact positive maps for each mode, unknown/case-duplicate key, each
   required missing/wrong value, wrong optional mode, NUL, redirected config/cache,
   nonempty config, wrong executable/fixture, malformed tokens. No secret values.
4. Actual finite Node probe reports only equality/result/count against synthetic test
   expectations (never raw environment). Synthetic extra sentinel injected after
   helper startup must not reach Node or nested helper; test both routes. Missing
   required input rejects before native creation. Existing source freshness remains.
5. Reuse earlier Job mechanism evidence; rerun normal admission and one crash-helper
   route because propagation changed. No broad crash matrix unless failure warrants it.
   Empty Job alone is insufficient for this change. Bound probes with existing watchdogs.

Completion: both routes demonstrably use the same validated map, denied sentinel absent,
mode requirements enforced, source/receipt identities consistent, independent review
has no blocker. Then evaluate supervisor integration; do not enable Electron as a
side effect of environment PASS.

## Limits and recovery

PowerShell startup precedes script checks. Explicit parent env and -NoProfile are source
facts, not proof of zero startup filesystem/network effects. Prior synthetic-home
StartupProfileData-NonInteractive writes remain known. No claim of protection against
hostile launcher, same-user tampering, concurrent reparse replacement, native library
loading, brokers, inherited OS credentials, or network use. These need separate controls
before company adoption; this document accepts no such risk for the Human.

Medium-risk future implementation: fail closed on invalid map, no fallback to full
inheritance. Roll back only the integrated map change if necessary while keeping native
Electron gate false. Retain failure receipts; never restore unsafe inheritance to make
a probe pass. Documentation rollback is removal of this candidate and its resume link.
