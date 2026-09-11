param([Parameter(Mandatory)][string]$Workspace)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/research-job-run.ps1')
$repository = Join-Path $Workspace 'repository'
$tools = Join-Path $repository 'tools'
$null = [IO.Directory]::CreateDirectory($tools)
$fixture = Join-Path $tools 'research-job-descendant.cjs'
[IO.File]::WriteAllText($fixture, 'synthetic')
Assert-ResearchJobFixture $repository $fixture
$count = 1
function Reject([string]$Candidate) {
    $rejected = $false
    try { Assert-ResearchJobFixture $repository $Candidate } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected fixture rejection' }
    $script:count++
}
Reject ''
Reject 'tools/research-job-descendant.cjs'
Reject (Join-Path $tools 'other.cjs')
Reject ($fixture + ' ')
[IO.File]::Move($fixture, ($fixture + '.saved'))
Reject $fixture
$null = [IO.Directory]::CreateDirectory($fixture)
Reject $fixture
# Independent synthetic repository with redirected tools directory, no deletion.
$repository = Join-Path $Workspace 'redirected'
$null = [IO.Directory]::CreateDirectory($repository)
$target = Join-Path $Workspace 'target'
$null = [IO.Directory]::CreateDirectory($target)
[IO.File]::WriteAllText((Join-Path $target 'research-job-descendant.cjs'), 'synthetic')
$null = New-Item -ItemType Junction -Path (Join-Path $repository 'tools') -Target $target
Reject (Join-Path $repository 'tools/research-job-descendant.cjs')
[ordered]@{ result='PASS'; checks=$count } | ConvertTo-Json -Compress
