# Fixed A1 admission only. There are no executable/argv/root parameters.
$ErrorActionPreference = 'Stop'
if ($args.Count -ne 0) { throw 'A1 supervisor accepts no arguments' }
$repository = Split-Path -Parent $PSScriptRoot
$run = Join-Path $repository '.tmp/a1-native-004'
if ([Environment]::CurrentDirectory -cne $run) { throw 'Fixed A1 cwd required' }
function Assert-A1Path([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or [IO.Path]::GetFullPath($Path) -cne $Path) { throw 'Canonical path required' }
    $current = [IO.Path]::GetPathRoot($Path)
    foreach ($part in $Path.Substring($current.Length).Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)) {
        $current = Join-Path $current $part
        if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked path refused' }
    }
}
function Get-A1Hash([string]$Path) {
    Assert-A1Path $Path
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($Path))).ToLowerInvariant()
}
function Get-A1Timing($candidate, $contract) {
    if ((($contract.Keys | Sort-Object) -join ',') -cne (($candidate.contract.Keys | Sort-Object) -join ',')) { throw 'Contract keys mismatch' }
foreach ($key in @('version','runId','unboundMs')) { if ($contract[$key] -cne $candidate.contract[$key]) { throw 'Contract identity mismatch' } }
foreach ($group in @('phaseMs','supervisorMs')) {
    if ((($contract[$group].Keys | Sort-Object) -join ',') -cne (($candidate.contract[$group].Keys | Sort-Object) -join ',')) { throw 'Contract keys mismatch' }
    foreach ($key in $contract[$group].Keys) { if ($contract[$group][$key] -ne $candidate.contract[$group][$key]) { throw 'Contract budget mismatch' } }
}
$p = $contract.phaseMs; $s = $contract.supervisorMs
 $derived = [ResearchEmptyJob]::A1Timing($p.startup,$p.human,$p.close,$s.launchMargin,$s.cleanup,$s.bootstrap,$s.outerMargin,$s.fallback)
$expectedTiming = @{startup=$p.startup;human=$p.human;close=$p.close;bootstrap=$s.bootstrap;launchMargin=$s.launchMargin;
    workload=$derived[0];cleanup=$derived[1];outerMargin=$s.outerMargin;outer=$derived[2];fallback=$s.fallback}
if ((($expectedTiming.Keys | Sort-Object) -join ',') -cne (($candidate.timeouts.Keys | Sort-Object) -join ',')) { throw 'Timing keys mismatch' }
foreach ($key in $expectedTiming.Keys) { if ($candidate.timeouts[$key] -ne $expectedTiming[$key]) { throw 'Inconsistent A1 timing budgets' } }
    return ,$derived
}
$permitPath = Join-Path $run 'authorization.used.json'
# No permit => no Add-Type, no Job, no Electron process.
Assert-A1Path $permitPath
$permit = [IO.File]::ReadAllText($permitPath) | ConvertFrom-Json -AsHashtable
$requestPath = Join-Path $run 'request.json'
Assert-A1Path $requestPath
$request = [IO.File]::ReadAllText($requestPath) | ConvertFrom-Json -AsHashtable
$payloadPath = Join-Path $run 'candidate.json'
$payloadHash = Get-A1Hash $payloadPath
$candidate = [IO.File]::ReadAllText($payloadPath) | ConvertFrom-Json -AsHashtable
if (($permit.Keys | Sort-Object) -join ',' -cne 'candidateSha256,expiresAt,runId,version' -or
    ($request.Keys | Sort-Object) -join ',' -cne 'candidateSha256,environmentSha256,nonce,runId,version' -or
    $permit.expiresAt -isnot [long] -or $permit.version -isnot [long] -or $request.version -isnot [long] -or
    $permit.expiresAt -gt ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 600000)) { throw 'Invalid A1 permit/request schema' }
if ($permit.version -ne 1 -or $permit.runId -cne 'a1-native-004' -or $permit.candidateSha256 -cne $payloadHash -or
    $request.version -ne 1 -or $request.runId -cne 'a1-native-004' -or $request.candidateSha256 -cne $payloadHash -or
    $request.nonce -cnotmatch '^[a-f0-9]{64}$' -or $request.environmentSha256 -cne $candidate.configurationSha256 -or
    $permit.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) { throw 'A1 permit/request mismatch or expiry' }
foreach ($map in @($candidate.adapterSha256, $candidate.overlaySha256)) {
    foreach ($name in $map.Keys) {
        if ([IO.Path]::IsPathRooted($name) -or $name.Split('/') -contains '..') { throw 'Nonlocal source' }
        if ((Get-A1Hash (Join-Path $repository $name)) -cne $map[$name]) { throw 'Source changed' }
    }
}
foreach ($entry in @(@{Map=$candidate.outputs; Base=(Join-Path $run 'artifact')}, @{Map=$candidate.electron.files; Base=(Join-Path $repository 'node_modules/electron/dist')})) {
    function Get-A1Files([string]$Directory) {
        Assert-A1Path $Directory
        foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
            Assert-A1Path $item.FullName
            if ($item.PSIsContainer) { Get-A1Files $item.FullName } else { $item.FullName }
        }
    }
    $actual = @(Get-A1Files $entry.Base)
    if ($actual.Count -ne $entry.Map.Count) { throw 'Artifact inventory changed' }
    foreach ($name in $entry.Map.Keys) {
        if ([IO.Path]::IsPathRooted($name) -or $name.Split('/') -contains '..') { throw 'Nonlocal artifact' }
        if ((Get-A1Hash (Join-Path $entry.Base $name)) -cne $entry.Map[$name]) { throw 'Artifact changed' }
    }
}
if ((Get-A1Hash ([Environment]::ProcessPath)) -cne $candidate.powershellSha256) { throw 'PowerShell changed' }
$variables = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
function Get-A1Environment([bool]$Helper) {
    $data = Join-Path $run $(if ($Helper) {'helper-data'} else {'app-data'})
    $map = [ordered]@{SystemRoot=$candidate.systemRoot; ComSpec=(Join-Path $candidate.systemRoot 'System32/cmd.exe'); PATHEXT='.COM;.EXE;.BAT;.CMD';
        PATH=(Join-Path $candidate.systemRoot 'System32'); DO_NOT_TRACK='1'; TUNNELMOLE_TELEMETRY='0'; NODE_DISABLE_COMPILE_CACHE='1';
        POWERSHELL_TELEMETRY_OPTOUT='1'; POWERSHELL_UPDATECHECK='Off'; PSModuleAnalysisCachePath=(Join-Path $run 'helper-data/module-cache')}
    foreach ($key in @('HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP')) {$map[$key] = Join-Path $data $key.ToLowerInvariant()}
    if (-not $Helper) {$map.MUNDER_A1_PROJECT=(Join-Path $run 'project'); $map.MUNDER_A1_APP_DATA=$data}
    return $map
}
$expected = Get-A1Environment $true
if ($variables.Count -ne $expected.Count) { throw 'Unexpected helper environment key' }
foreach ($key in $expected.Keys) {if ($variables[$key] -cne $expected[$key]) {throw 'Helper environment mismatch'}}
$projected = Get-A1Environment $false
foreach ($key in @('HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP')) {
    Assert-A1Path $projected[$key]
    if (@(Get-ChildItem -LiteralPath $projected[$key] -Force).Count -ne 0) {throw 'Nonempty synthetic environment'}
}
$project = Join-Path $run 'project'
if (@(Get-ChildItem -LiteralPath $project -Force).Count -ne 1 -or (Get-A1Hash (Join-Path $project 'readme.txt')) -cne $candidate.syntheticProject.files['readme.txt']) {throw 'Synthetic project drift'}
$executable = Join-Path $repository 'node_modules/electron/dist/electron.exe'
$entry = Join-Path $run 'artifact/main/index.js'
$source = [IO.File]::ReadAllText((Join-Path $repository 'tools/research-job-preflight.ps1'))
$match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Native class missing' }
Add-Type -TypeDefinition $match.Groups[1].Value
# Read the same hash-bound JSON used by the app and Node admission, not another budget table.
$contractPath = Join-Path $repository 'src/shared/a1-contract.json'
if ((Get-A1Hash $contractPath) -cne $candidate.overlaySha256['src/shared/a1-contract.json']) { throw 'Timing source drift' }
$contract = [IO.File]::ReadAllText($contractPath) | ConvertFrom-Json -AsHashtable
$derived = Get-A1Timing $candidate $contract
$null = [ResearchEmptyJob]::A1Command($executable, $entry, $run)
# Exclusive admission marker prevents replay even if the helper is invoked directly.
$marker = [IO.File]::Open((Join-Path $run 'native-attempt.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$marker.Dispose()
[Console]::Out.WriteLine('{"phase":"ready"}')
try {
    $native = [ResearchEmptyJob]::Admit($executable, $false, $entry, $false, $false, $false, $false, $projected,
        $false, $false, $false, $false, $false, $false, $false, $false, $true, $false, $true, $derived[0], $derived[1])
    [Console]::Out.WriteLine(([ordered]@{phase='complete'; run=$run; candidateSha256=$payloadHash; requestSha256=(Get-A1Hash $requestPath); native=$native} | ConvertTo-Json -Depth 4 -Compress))
} catch {
    $cause=$_.Exception.GetBaseException()
    $nativeErrorCode=if($cause -is [ComponentModel.Win32Exception]){$cause.NativeErrorCode}else{$null}
    [Console]::Out.WriteLine(([ordered]@{phase='failed';cleanup='UNVERIFIED';nativeErrorCode=$nativeErrorCode}|ConvertTo-Json -Compress))
    exit 1
}
