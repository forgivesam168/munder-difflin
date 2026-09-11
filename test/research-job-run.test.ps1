param([Parameter(Mandatory)][string]$Workspace)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/research-job-run.ps1')
$count = 0
function Expect-Rejection([string]$Repository, [string]$Run, [string]$Mode = 'job-preflight') {
    $rejected = $false
    try { $null = Assert-ResearchJobRun -Repository $Repository -Run $Run -Mode $Mode }
    catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected rejection' }
    $script:count++
}
$root = Join-Path $Workspace 'repo'
$base = Join-Path $root '.tmp'
$run = Join-Path $base 'job-preflight-ABC123'
$null = [IO.Directory]::CreateDirectory($run)
if ((Assert-ResearchJobRun -Repository $root -Run $run) -cne $run) { throw 'Valid run mismatch' }
$count++
$lifecycle = Join-Path $base 'electron-lifecycle-ABC123'
$null = [IO.Directory]::CreateDirectory($lifecycle)
if ((Assert-ResearchJobRun -Repository $root -Run $lifecycle -Mode 'electron-lifecycle') -cne $lifecycle) { throw 'Lifecycle run mismatch' }
$count++
Expect-Rejection $root $lifecycle
Expect-Rejection $root $run 'electron-lifecycle'
foreach ($mode in @('', 'other', 'JOB-PREFLIGHT')) { Expect-Rejection $root $run $mode }
Expect-Rejection $root $Workspace
Expect-Rejection $root (Join-Path $base 'other-ABC123')
Expect-Rejection $root (Join-Path $run 'job-preflight-ABC123')
Expect-Rejection $root '.tmp/job-preflight-ABC123'
$file = Join-Path $base 'job-preflight-FILE12'
[IO.File]::WriteAllText($file, 'synthetic')
Expect-Rejection $root $file
$target = Join-Path $Workspace 'target'
$null = [IO.Directory]::CreateDirectory($target)
$redirectedRun = Join-Path $base 'job-preflight-LINK12'
$null = New-Item -ItemType Junction -Path $redirectedRun -Target $target
Expect-Rejection $root $redirectedRun
$otherRoot = Join-Path $Workspace 'other-repo'
$null = [IO.Directory]::CreateDirectory($otherRoot)
$null = [IO.Directory]::CreateDirectory((Join-Path $target 'job-preflight-ABC123'))
$null = New-Item -ItemType Junction -Path (Join-Path $otherRoot '.tmp') -Target $target
Expect-Rejection $otherRoot (Join-Path $otherRoot '.tmp/job-preflight-ABC123')
$rootLink = Join-Path $Workspace 'repo-link'
$null = New-Item -ItemType Junction -Path $rootLink -Target $root
Expect-Rejection $rootLink (Join-Path $rootLink '.tmp/job-preflight-ABC123')
[ordered]@{ result='PASS'; checks=$count } | ConvertTo-Json -Compress
