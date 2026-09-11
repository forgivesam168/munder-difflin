$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../tools/research-job-preflight.ps1'))
$match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Production source not found' }
Add-Type -TypeDefinition $match.Groups[1].Value
foreach ($case in @(@(0,8000), @(1,7999), @(5000,3000), @(7999,1), @(8000,0), @(9000,0), @([long]::MaxValue,0))) {
    if ([ResearchEmptyJob]::RemainingMilliseconds([long]$case[0], 8000) -ne $case[1]) { throw 'Budget mismatch' }
}
$rejected = $false
try { $null = [ResearchEmptyJob]::RemainingMilliseconds(-1,8000) } catch { $rejected = $true }
if (-not $rejected) { throw 'Negative elapsed accepted' }
# A root that consumed 5s leaves 3s, rather than resetting the tree phase to8s.
if ([ResearchEmptyJob]::RemainingMilliseconds(5000,8000) -ne 3000) { throw 'Budget reset' }
foreach ($case in @(@(7999,-1,1), @(8000,-1,0), @(8000,0,2000),
    @(12000,1999,1), @(12000,2000,0), @(12000,3000,0))) {
    if ([ResearchEmptyJob]::MonitorRemaining($case[0],8000,$case[1]) -ne $case[2]) {
        throw 'Cleanup budget mismatch'
    }
}
foreach ($case in @(@(39999,-1,1), @(40000,-1,0), @(40000,0,10000),
    @(50000,9999,1), @(50000,10000,0), @(50000,10001,0))) {
    if ([ResearchEmptyJob]::MonitorRemaining($case[0],40000,$case[1],$true) -ne $case[2]) {
        throw 'Lifecycle cleanup budget mismatch'
    }
}
'{"result":"PASS","checks":21}'
