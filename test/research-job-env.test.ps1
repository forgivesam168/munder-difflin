param([Parameter(Mandatory)][string]$Workspace)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/research-job-run.ps1')
$variables = @{}
$mapping = @{ HOME='home'; USERPROFILE='home'; TEMP='temp'; TMP='temp'; APPDATA='appdata'; LOCALAPPDATA='localappdata'; XDG_CONFIG_HOME='config'; XDG_CACHE_HOME='cache'; XDG_DATA_HOME='data' }
foreach ($name in $mapping.Keys) {
    $variables[$name] = Join-Path $Workspace $mapping[$name]
    $null = [IO.Directory]::CreateDirectory($variables[$name])
}
$variables.PSModuleAnalysisCachePath = Join-Path $Workspace 'module-analysis-cache'
Assert-ResearchJobEnvironmentPaths $Workspace $variables
$count = 1
function Expect-Rejection($candidate, [string]$message = '') {
    $rejected = $false
    try { Assert-ResearchJobEnvironmentPaths $Workspace $candidate } catch {
        if ($message -and $_.Exception.Message -cne $message) { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Expected environment rejection' }
    $script:count++
}
foreach ($name in $variables.Keys) {
    $candidate = $variables.Clone()
    $candidate.Remove($name)
    Expect-Rejection $candidate
    $candidate[$name] = $Workspace
    Expect-Rejection $candidate
}
$null = [IO.Directory]::CreateDirectory($variables.PSModuleAnalysisCachePath)
Expect-Rejection $variables 'Research module cache must not be a directory or reparse point'
Move-Item -LiteralPath $variables.PSModuleAnalysisCachePath -Destination (Join-Path $Workspace 'module-cache-original')
$null = New-Item -ItemType Junction -Path $variables.PSModuleAnalysisCachePath -Target (Join-Path $Workspace 'module-cache-original')
Expect-Rejection $variables 'Research module cache must not be a directory or reparse point'
# Replace only the synthetic cache directory with an in-workspace junction.
$original = $variables.XDG_CACHE_HOME
Move-Item -LiteralPath $original -Destination (Join-Path $Workspace 'cache-original')
$null = New-Item -ItemType Junction -Path $original -Target (Join-Path $Workspace 'cache-original')
Expect-Rejection $variables 'Research environment directory invalid: XDG_CACHE_HOME'
[ordered]@{ result='PASS'; checks=$count } | ConvertTo-Json -Compress
