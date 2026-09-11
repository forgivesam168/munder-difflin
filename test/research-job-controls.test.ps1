$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/research-job-run.ps1')
# Actual synthetic launcher environment is the positive fixture.
$variables = [Environment]::GetEnvironmentVariables()
Assert-ResearchJobEnvironmentControls $variables
$count = 1
foreach ($name in @('POWERSHELL_TELEMETRY_OPTOUT', 'POWERSHELL_UPDATECHECK',
    'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'TUNNELMOLE_TELEMETRY',
    'DO_NOT_TRACK', 'NODE_DISABLE_COMPILE_CACHE', 'FORCE_COLOR')) {
    foreach ($variant in @('missing', 'changed', 'empty')) {
        $candidate = $variables.Clone()
        switch ($variant) {
            missing { $candidate.Remove($name) }
            changed { $candidate[$name] = 'synthetic-invalid-value' }
            empty { $candidate[$name] = '' }
        }
        $rejected = $false
        try { Assert-ResearchJobEnvironmentControls $candidate } catch {
            if ($_.Exception.Message -cne "Research environment control mismatch: $name") { throw }
            $rejected = $true
        }
        if (-not $rejected) { throw "Expected rejection: $name ($variant)" }
        $count++
    }
}
[ordered]@{ result='PASS'; checks=$count } | ConvertTo-Json -Compress
