param([uint32]$RootPid, [long]$RootCreated, [string]$SubjectRun, [string]$RequestSha256)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'tools/research-job-run.ps1')
$null = Assert-ResearchJobRun -Repository $root -Run ([Environment]::CurrentDirectory) -Mode 'electron-lifecycle'
$null = Assert-ResearchJobRun -Repository $root -Run $SubjectRun -Mode 'electron-lifecycle'
if ($RequestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid request identity' }
$ready = [IO.File]::ReadAllText((Join-Path $SubjectRun 'stop-root-ready.json')) | ConvertFrom-Json
if ($ready.pid -ne $RootPid -or $ready.requestSha256 -cne $RequestSha256) { throw 'Wrong ready root' }
# Compile only the previously reviewed native type; no launcher or new Job.
$source = [IO.File]::ReadAllText((Join-Path $root 'tools/research-job-preflight.ps1'))
$match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Native type missing' }
Add-Type -TypeDefinition $match.Groups[1].Value
$observed = [IntPtr]::Zero
try {
    # Known creation-bound root only; never enumerate/discover a host process.
    $observed = [ResearchEmptyJob]::Capture($RootPid, $RootCreated)
    [Console]::Out.WriteLine('{"phase":"captured","alive":true}')
    if (-not [ResearchEmptyJob]::ObserveExit($observed)) { throw 'Root exit unobserved' }
    [Console]::Out.WriteLine('{"phase":"observed","exitObserved":true,"accounting":null}')
} finally {
    if ($observed -ne [IntPtr]::Zero) { [ResearchEmptyJob]::ReleaseObserved($observed) }
}
