param([string]$NodeExecutable)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'tools/research-job-run.ps1')
$run = Assert-ResearchJobRun -Repository $root -Run ([Environment]::CurrentDirectory) -Mode 'electron-lifecycle'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'tools/research-lifecycle-supervisor.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Invalid supervisor syntax' }
$functions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-FixedLifecycleDispatch' }, $true))
if ($functions.Count -ne 1) { throw 'Expected single fixed dispatch function' }
# Execute only the effect-free selector definition, not the supervisor launcher.
Invoke-Expression $functions[0].Extent.Text
$electron = Get-FixedLifecycleDispatch -Repository $root -Run $run -Inert $false
if ($electron.Executable -cne (Join-Path $root 'node_modules/electron/dist/electron.exe') -or
    $electron.Script -cne (Join-Path $root 'tools/research-electron-lifecycle.cjs')) { throw 'Electron selection mismatch' }
$inert = Get-FixedLifecycleDispatch -Repository $root -Run $run -Inert $true -NodeExecutable $NodeExecutable
if ($inert.Executable -cne $NodeExecutable -or
    $inert.Script -cne (Join-Path $root 'test/research-lifecycle-bound-inert.cjs')) { throw 'Inert selection mismatch' }
foreach ($case in @('override', 'wrong-run', 'relative-node')) {
    $rejected = $false
    try {
        if ($case -eq 'override') { $null = Get-FixedLifecycleDispatch -Repository $root -Run $run -Inert $false -NodeExecutable $NodeExecutable }
        elseif ($case -eq 'wrong-run') { $null = Get-FixedLifecycleDispatch -Repository $root -Run ($run + '-wrong') -Inert $false }
        else { $null = Get-FixedLifecycleDispatch -Repository $root -Run $run -Inert $true -NodeExecutable 'node.exe' }
    } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid dispatch accepted' }
}
'{"result":"PASS","checks":5,"scope":"selection-only"}'
