param([Parameter(Mandatory)][string]$Workspace)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/research-job-run.ps1')
$root = Join-Path $Workspace 'repo'
$run = Join-Path $root '.tmp/electron-lifecycle-ABC123'
$exe = Join-Path $root 'node_modules/electron/dist/electron.exe'
$script = Join-Path $root 'tools/research-electron-lifecycle.cjs'
foreach ($directory in @($run, [IO.Path]::GetDirectoryName($exe), [IO.Path]::GetDirectoryName($script))) {
    $null = [IO.Directory]::CreateDirectory($directory)
}
[IO.File]::WriteAllText($exe, 'inert')
[IO.File]::WriteAllText($script, 'inert')
$count = 0
function Reject([string]$RunPath, [string]$ExePath, [string]$ScriptPath) {
    $rejected = $false
    try { $null = Get-ResearchLifecycleInvocation -Repository $root -Run $RunPath -Executable $ExePath -Script $ScriptPath }
    catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected rejection' }
    $script:count++
}
$value = Get-ResearchLifecycleInvocation -Repository $root -Run $run -Executable $exe -Script $script
if ($value.Executable -cne $exe -or $value.WorkingDirectory -cne $run -or
    $value.Arguments.Count -ne 3 -or $value.Arguments[0] -cne $script -or
    $value.Arguments[1] -cne '--fixture' -or $value.Arguments[2] -cne $run) { throw 'Invocation mismatch' }
$count++
Reject $run (Join-Path $root 'other.exe') $script
Reject $run $exe (Join-Path $root 'other.cjs')
Reject (Join-Path $root '.tmp/job-preflight-ABC123') $exe $script
Reject '.tmp/electron-lifecycle-ABC123' $exe $script
[IO.File]::Move($exe, $exe + '-saved')
Reject $run $exe $script
[IO.Directory]::CreateDirectory($exe) | Out-Null
Reject $run $exe $script
# Separate repositories avoid cleanup/removing evidence or junctions.
foreach ($relative in @('tools', 'node_modules', 'node_modules/electron', 'node_modules/electron/dist')) {
    $root = Join-Path $Workspace ('redirect-' + $count)
    $run = Join-Path $root '.tmp/electron-lifecycle-ABC123'
    $exe = Join-Path $root 'node_modules/electron/dist/electron.exe'
    $script = Join-Path $root 'tools/research-electron-lifecycle.cjs'
    foreach ($dir in @($run, [IO.Path]::GetDirectoryName($exe), [IO.Path]::GetDirectoryName($script))) { [IO.Directory]::CreateDirectory($dir) | Out-Null }
    [IO.File]::WriteAllText($exe, 'inert'); [IO.File]::WriteAllText($script, 'inert')
    $directory = Join-Path $root $relative
    [IO.Directory]::Move($directory, $directory + '-saved')
    New-Item -ItemType Junction -Path $directory -Target ($directory + '-saved') | Out-Null
    Reject $run $exe $script
}
[ordered]@{ result='PASS'; checks=$count; scope='static invocation only' } | ConvertTo-Json -Compress
