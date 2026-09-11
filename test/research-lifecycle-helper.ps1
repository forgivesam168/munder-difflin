param([switch]$ValueFault, [switch]$Suspended, [switch]$RunningInert, [string]$NodeExecutable)
$ErrorActionPreference = 'Stop'
if ($RunningInert -and ($Suspended -or $ValueFault)) { throw 'Running inert mode excludes other modes' }
if (-not $RunningInert -and $NodeExecutable) { throw 'Unexpected Node executable' }
$root = Split-Path -Parent $PSScriptRoot
$guard = Join-Path $root 'tools/research-job-run.ps1'
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($guard))).ToLowerInvariant()
if ($hash -cne $env:RESEARCH_JOB_GUARD_SHA256) { throw 'Guard identity mismatch' }
. $guard
$run = Assert-ResearchJobRun -Repository $root -Run ([Environment]::CurrentDirectory) -Mode 'electron-lifecycle'
$variables = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
if ($variables -isnot [System.Collections.IDictionary]) { throw 'Explicit environment map required' }
[Environment]::SetEnvironmentVariable('RESEARCH_LIFECYCLE_HELPER_SENTINEL', 'synthetic')
$projected = Get-ResearchLifecycleEnvironment -Run $run -Variables $variables
$schemaChecks = 0
foreach ($fault in @('missing', 'duplicate')) {
    $candidate = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach ($key in $variables.Keys) { $candidate.Add($key, $variables[$key]) }
    if ($fault -eq 'missing') { $null = $candidate.Remove('HOME') }
    else { $candidate.Add('home', $variables['HOME']) }
    $rejected = $false
    try { $null = Get-ResearchLifecycleEnvironment -Run $run -Variables $candidate } catch { $rejected = $true }
    if (-not $rejected) { throw 'Schema fault accepted' }
    $schemaChecks++
}
if ($projected.ContainsKey('RESEARCH_LIFECYCLE_HELPER_SENTINEL')) { throw 'Unexpected forwarding' }
if ($ValueFault) { $projected['FORCE_COLOR'] = '1' }
$valueHashes = @{}
foreach ($key in $projected.Keys) {
    $valueHashes[$key.ToUpperInvariant()] = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($projected[$key]))).ToLowerInvariant()
}
$invocation = Get-ResearchLifecycleInvocation -Repository $root -Run $run -Executable (Join-Path $root 'node_modules/electron/dist/electron.exe') -Script (Join-Path $root 'tools/research-electron-lifecycle.cjs')
if ($invocation.Arguments.Count -ne 3 -or $invocation.Arguments[1] -cne '--fixture' -or $invocation.Arguments[2] -cne $run) { throw 'Invocation mismatch' }
$native = $null
if ($Suspended -or $RunningInert) {
    if ($ValueFault) { throw 'Suspended mode excludes faults' }
    # Compile only the existing native class; never execute the preflight launcher.
    $source = [IO.File]::ReadAllText((Join-Path $root 'tools/research-job-preflight.ps1'))
    $match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
    if (-not $match.Success) { throw 'Native class not found' }
    Add-Type -TypeDefinition $match.Groups[1].Value
    if ($Suspended) { $native = [ResearchEmptyJob]::Admit($invocation.Executable, $false, $invocation.Arguments[0], $false, $true, $false, $false, $projected, $false, $false, $false, $false, $false, $false, $false, $true) }
    else {
        # Test-only substitution: fixed repository Node fixture, never Electron.
        $node = [IO.FileInfo]::new($NodeExecutable)
        $fixture = [IO.FileInfo]::new((Join-Path $PSScriptRoot 'research-lifecycle-inert.cjs'))
        if (-not [IO.Path]::IsPathFullyQualified($NodeExecutable) -or $node.Name -cne 'node.exe' -or
            -not $node.Exists -or ($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            -not $fixture.Exists -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ([IO.DirectoryInfo]::new($PSScriptRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Invalid fixed inert invocation'
        }
        $native = [ResearchEmptyJob]::Admit($node.FullName, $false, $fixture.FullName, $false, $false, $false, $false, $projected, $false, $false, $false, $false, $false, $false, $false, $false, $true)
    }
}
[ordered]@{ result='PASS'; scope=$(if ($RunningInert) { 'running-inert' } elseif ($Suspended) { 'suspended-admission' } else { 'preflight-only' }); native=$native; schemaChecks=$schemaChecks; keys=@($projected.Keys | Sort-Object); valueHashes=$valueHashes; invocation=$invocation; sentinelExcluded=$true } | ConvertTo-Json -Depth 4 -Compress
