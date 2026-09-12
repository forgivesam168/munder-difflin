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
$run=Join-Path $root '.tmp/a1-native-004'
$exe=Join-Path $root 'node_modules/electron/dist/electron.exe'
$entry=Join-Path $run 'artifact/main/index.js'
$command=[ResearchEmptyJob]::A1Command($exe,$entry,$run)
if($command -cne ([ResearchEmptyJob]::QuoteArgument($exe)+' '+[ResearchEmptyJob]::QuoteArgument($entry)+' '+[ResearchEmptyJob]::QuoteArgument('--munder-controlled-read'))){throw 'Wrong command'}
foreach($values in @(@($exe,'arbitrary.js',$run),@('C:\other.exe',$entry,$run),@($exe,$entry,(Join-Path $root '.tmp/other')))) {
 $failed=$false
 try {$null=[ResearchEmptyJob]::A1Command($values[0],$values[1],$values[2])}catch{$failed=$true}
 if(-not $failed){throw 'Invalid A1 dispatch accepted'}
}
$contract=Get-Content (Join-Path $root 'src/shared/a1-contract.json') -Raw | ConvertFrom-Json
$p=$contract.phaseMs;$s=$contract.supervisorMs
$budgets=[ResearchEmptyJob]::A1Timing($p.startup,$p.human,$p.close,$s.launchMargin,$s.cleanup,$s.bootstrap,$s.outerMargin,$s.fallback)
$node=(& node -e "console.log(JSON.stringify(require('./tools/a1-candidate.cjs').timeouts()))") | ConvertFrom-Json
if($budgets[0] -ne $node.workload -or $budgets[1] -ne $node.cleanup -or $budgets[2] -ne $node.outer){throw 'Node/native timing mismatch'}
if([ResearchEmptyJob]::MonitorRemaining(($node.workload+1),$node.workload,0,$true,$node.cleanup)-ne $node.cleanup){throw 'Cleanup budget drift'}
$failed=$false;try{$null=[ResearchEmptyJob]::A1Timing(0,$p.human,$p.close,$s.launchMargin,$s.cleanup,$s.bootstrap,$s.outerMargin,$s.fallback)}catch{$failed=$true}
if(-not $failed){throw 'Invalid timing accepted'}
# Evaluate only the supervisor's pure contract function, never its executable body.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'tools/a1-supervisor.ps1'),[ref]$tokens,[ref]$errors)
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-A1Timing'},$true)
if(-not $fn){throw 'Missing pure contract validator'}
. ([ScriptBlock]::Create($fn.Extent.Text))
$contract=Get-Content (Join-Path $root 'src/shared/a1-contract.json') -Raw | ConvertFrom-Json -AsHashtable
$timing=(& node -e "console.log(JSON.stringify(require('./tools/a1-candidate.cjs').timeouts()))") | ConvertFrom-Json -AsHashtable
$candidate=@{contract=$contract;timeouts=$timing}
$checked=Get-A1Timing $candidate $contract
if($checked[0] -ne $node.workload){throw 'Supervisor timing drift'}
$candidate.timeouts.outer=$node.workload
$failed=$false;try{$null=Get-A1Timing $candidate $contract}catch{$failed=$true}
if(-not $failed){throw 'Insufficient outer accepted by supervisor'}
[Console]::Out.WriteLine('{"scope":"compile-and-pure-selectors-only","checks":9,"nativeCreation":false}')
