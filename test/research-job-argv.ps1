param([Parameter(Mandatory)][string]$Cases)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Compile the actual production C# block without running the PowerShell entrypoint.
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../tools/research-job-preflight.ps1'))
$match = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $match.Success) { throw 'Production native source not found' }
Add-Type -TypeDefinition $match.Groups[1].Value
$values = ConvertFrom-Json ([IO.File]::ReadAllText($Cases))
$encoded = @($values | ForEach-Object { [ResearchEmptyJob]::QuoteArgument($_) })
$rejected = $false
try { $null = [ResearchEmptyJob]::QuoteArgument("a$([char]0)b") } catch { $rejected = $true }
if (-not $rejected) { throw 'NUL accepted' }
ConvertTo-Json -InputObject $encoded -Compress
