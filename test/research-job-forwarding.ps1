param([string]$Probe, [switch]$Crash)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $Probe) 'research-job-run.ps1')
$variables = [Environment]::GetEnvironmentVariables()
$variables['RESEARCH_ENV_SENTINEL'] = 'synthetic-only'
$allModes = $variables.Clone()
$allModes['RESEARCH_CRASH_TOKEN'] = 'synthetic-token'
$allModes['RESEARCH_JOB_FIXTURE'] = 'synthetic-fixture'
$allModes['RESEARCH_LEAF_TOKEN'] = 'synthetic-token'
foreach ($mode in @(@($false,$false,$false), @($true,$false,$false),
    @($true,$true,$false), @($false,$false,$true), @($false,$true,$true))) {
    $selected = Get-ResearchJobChildEnvironment $allModes $mode[0] $mode[1] $mode[2]
    if ($selected.ContainsKey('RESEARCH_ENV_SENTINEL') -or
        $selected.ContainsKey('RESEARCH_JOB_FIXTURE') -ne $mode[1] -or
        $selected.ContainsKey('RESEARCH_LEAF_TOKEN') -ne $mode[1] -or
        $selected.ContainsKey('RESEARCH_CRASH_TOKEN') -ne $mode[2] -or
        $selected.ContainsKey('RESEARCH_NODE_EXECUTABLE') -ne ($mode[0] -or $mode[2])) {
        throw 'Incorrect mode projection'
    }
}
$map = Get-ResearchJobChildEnvironment $variables $true $false ([bool]$Crash)
if ($map.ContainsKey('RESEARCH_ENV_SENTINEL')) { throw 'Sentinel copied' }
foreach ($key in @($map.Keys)) {
    $candidate = $variables.Clone(); $candidate.Remove($key)
    $rejected = $false
    try { $null = Get-ResearchJobChildEnvironment $candidate $true $false ([bool]$Crash) }
    catch { $rejected = $true }
    if (-not $rejected) { throw 'Missing input accepted' }
}
# Inject only after PowerShell startup; actual production script must remove it
# from both native child block and the nested PowerShell helper environment.
$env:RESEARCH_ENV_SENTINEL = 'synthetic-only'
if ($Crash) { & $Probe -CrashObserver } else { & $Probe -Admission }
