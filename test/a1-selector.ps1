$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
foreach($file in @('tools/a1-supervisor.ps1','tools/research-job-preflight.ps1')) {
 $tokens=$null;$errors=$null
 $null=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root $file),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'Invalid PowerShell syntax'}
}
$source=[IO.File]::ReadAllText((Join-Path $root 'tools/research-job-preflight.ps1'))
$match=[regex]::Match($source,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if(-not $match.Success){throw 'Missing class'}
# Compilation and PURE selectors only. Never call Admit or any Win32 method.
Add-Type -TypeDefinition $match.Groups[1].Value
$run=Join-Path $root '.tmp/a1-native-001'
$exe=Join-Path $root 'node_modules/electron/dist/electron.exe'
$entry=Join-Path $run 'artifact/main/index.js'
$command=[ResearchEmptyJob]::A1Command($exe,$entry,$run)
if($command -cne ([ResearchEmptyJob]::QuoteArgument($exe)+' '+[ResearchEmptyJob]::QuoteArgument($entry)+' '+[ResearchEmptyJob]::QuoteArgument('--munder-controlled-read'))){throw 'Wrong command'}
foreach($values in @(@($exe,'arbitrary.js',$run),@('C:\other.exe',$entry,$run),@($exe,$entry,(Join-Path $root '.tmp/other')))) {
 $failed=$false
 try {$null=[ResearchEmptyJob]::A1Command($values[0],$values[1],$values[2])}catch{$failed=$true}
 if(-not $failed){throw 'Invalid A1 dispatch accepted'}
}
if([ResearchEmptyJob]::MonitorRemaining(70001,70000,0,$true)-ne 10000){throw 'Cleanup budget drift'}
[Console]::Out.WriteLine('{"scope":"compile-and-pure-selectors-only","checks":5,"nativeCreation":false}')
