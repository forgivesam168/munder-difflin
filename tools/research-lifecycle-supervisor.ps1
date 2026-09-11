param([switch]$Inert, [string]$NodeExecutable, [switch]$StopProbe)
$ErrorActionPreference = 'Stop'
if ($StopProbe -and -not $Inert) { throw 'Stop probe requires inert mode' }
# Separate deny gate: this integration cycle authorizes only the fixed Node stand-in.
$NativeLaunchEnabled = $false
if (-not $Inert -and -not $NativeLaunchEnabled) { throw 'Running Electron supervisor disabled pending acceptance' }
$root = Split-Path -Parent $PSScriptRoot
$guard = Join-Path $PSScriptRoot 'research-job-run.ps1'
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($guard))).ToLowerInvariant()
if ($hash -cne $env:RESEARCH_JOB_GUARD_SHA256) { throw 'Guard identity mismatch' }
. $guard
$run = Assert-ResearchJobRun -Repository $root -Run ([Environment]::CurrentDirectory) -Mode 'electron-lifecycle'
$variables = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
if ($variables -isnot [Collections.IDictionary]) { throw 'Explicit map required' }
$projected = Get-ResearchLifecycleEnvironment -Run $run -Variables $variables
function Get-FixedLifecycleDispatch {
    param([string]$Repository, [string]$Run, [bool]$Inert, [string]$NodeExecutable)
    $invocation = Get-ResearchLifecycleInvocation -Repository $Repository -Run $Run -Executable (Join-Path $Repository 'node_modules/electron/dist/electron.exe') -Script (Join-Path $Repository 'tools/research-electron-lifecycle.cjs')
    if (-not $Inert) {
        if ($NodeExecutable) { throw 'Electron dispatch excludes Node executable override' }
        return [pscustomobject]@{ Executable=$invocation.Executable; Script=$invocation.Arguments[0] }
    }
    $node = [IO.FileInfo]::new($NodeExecutable)
    $fixture = [IO.FileInfo]::new((Join-Path $Repository 'test/research-lifecycle-bound-inert.cjs'))
    if (-not [IO.Path]::IsPathFullyQualified($NodeExecutable) -or $node.Name -cne 'node.exe' -or
        -not $node.Exists -or ($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        -not $fixture.Exists -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ([IO.DirectoryInfo]::new($fixture.DirectoryName).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Invalid fixed inert invocation'
    }
    return [pscustomobject]@{ Executable=$node.FullName; Script=$fixture.FullName }
}
$dispatch = Get-FixedLifecycleDispatch -Repository $root -Run $run -Inert ([bool]$Inert) -NodeExecutable $NodeExecutable
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'research-job-preflight.ps1'))
$match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Native class not found' }
Add-Type -TypeDefinition $match.Groups[1].Value
[Console]::Out.WriteLine('{"phase":"ready"}')
try {
    $native = [ResearchEmptyJob]::Admit($dispatch.Executable, $false, $dispatch.Script, $false, $false, $false, $false, $projected, $false, $false, $false, $false, $false, $false, $false, $false, $true, [bool]$StopProbe)
    [Console]::Out.WriteLine(([ordered]@{ phase='complete'; run=$run; native=$native } | ConvertTo-Json -Depth 4 -Compress))
} catch {
    # Native finally closes the Job; unexpected errors never imply empty accounting.
    $cause = $_.Exception.GetBaseException()
    $nativeErrorCode = if ($cause -is [ComponentModel.Win32Exception]) { $cause.NativeErrorCode } else { $null }
    [Console]::Out.WriteLine(([ordered]@{ phase='failed'; cleanup='UNVERIFIED'; nativeErrorCode=$nativeErrorCode } | ConvertTo-Json -Compress))
    exit 1
}
