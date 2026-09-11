# Static path preflight only. Caller's repository derives from the loaded script,
# never from environment input. Does not defend concurrent directory replacement.
function Assert-ResearchJobFixture {
    param([string]$Repository, [string]$Fixture)
    $expected = [IO.Path]::Combine($Repository, 'tools', 'research-job-descendant.cjs')
    if (-not [IO.Path]::IsPathFullyQualified($Repository) -or
        -not [string]::Equals($Fixture, $expected, [StringComparison]::Ordinal)) {
        throw 'Unexpected research descendant fixture'
    }
    $directory = [IO.DirectoryInfo]::new([IO.Path]::Combine($Repository, 'tools'))
    $file = [IO.FileInfo]::new($expected)
    if (-not $directory.Exists -or -not $file.Exists -or
        ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Research descendant fixture must be a non-reparse file'
    }
}

function Get-ResearchLifecycleInvocation {
    param([Parameter(Mandatory)][string]$Repository, [Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$Script)
    # Repository must come from the helper's own script location, never child input.
    # Static validation only: no authenticity or concurrent replacement guarantee.
    if (-not [IO.Path]::IsPathFullyQualified($Repository) -or
        [IO.Path]::GetFullPath($Repository) -cne $Repository -or
        -not [IO.Path]::IsPathFullyQualified($Run) -or [IO.Path]::GetFullPath($Run) -cne $Run) {
        throw 'Canonical lifecycle paths required'
    }
    $expectedExecutable = [IO.Path]::Combine($Repository, 'node_modules', 'electron', 'dist', 'electron.exe')
    $expectedScript = [IO.Path]::Combine($Repository, 'tools', 'research-electron-lifecycle.cjs')
    if ($Executable -cne $expectedExecutable -or $Script -cne $expectedScript) {
        throw 'Unexpected lifecycle invocation'
    }
    $runPath = Assert-ResearchJobRun -Repository $Repository -Run $Run -Mode 'electron-lifecycle'
    foreach ($name in @('tools', 'node_modules', 'node_modules/electron', 'node_modules/electron/dist')) {
        $directory = [IO.DirectoryInfo]::new([IO.Path]::Combine($Repository, $name))
        if (-not $directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Redirected or missing lifecycle directory'
        }
    }
    foreach ($name in @($expectedExecutable, $expectedScript)) {
        $file = [IO.FileInfo]::new($name)
        if (-not $file.Exists -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Invalid lifecycle file'
        }
    }
    return [pscustomobject]@{ Executable=$expectedExecutable; Arguments=@($expectedScript, '--fixture', $runPath); WorkingDirectory=$runPath }
}

function Get-ResearchJobChildEnvironment {
    param([System.Collections.IDictionary]$Variables, [bool]$Admission, [bool]$Descendant, [bool]$Crash)
    $keys = @('PATH','HOME','USERPROFILE','TEMP','TMP','APPDATA','LOCALAPPDATA',
        'XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_GLOBAL','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0',
        'GIT_CONFIG_KEY_1','GIT_CONFIG_VALUE_1','GIT_TERMINAL_PROMPT','TUNNELMOLE_TELEMETRY',
        'DO_NOT_TRACK','NODE_DISABLE_COMPILE_CACHE','FORCE_COLOR','NPM_CONFIG_USERCONFIG',
        'NPM_CONFIG_GLOBALCONFIG','NPM_CONFIG_CACHE','NPM_CONFIG_REGISTRY','ELECTRON_CACHE',
        'electron_config_cache','SystemRoot','ComSpec','PATHEXT','POWERSHELL_TELEMETRY_OPTOUT',
        'POWERSHELL_UPDATECHECK','PSModuleAnalysisCachePath','RESEARCH_JOB_GUARD_SHA256')
    if ($Admission -or $Crash) { $keys += 'RESEARCH_NODE_EXECUTABLE' }
    if ($Crash) { $keys += 'RESEARCH_CRASH_TOKEN' }
    if ($Descendant) { $keys += @('RESEARCH_JOB_FIXTURE','RESEARCH_LEAF_TOKEN') }
    $result = @{}
    foreach ($key in $keys) {
        $value = $Variables[$key]
        if ($value -isnot [string] -or $value.Length -eq 0 -or $value.Contains([char]0)) {
            throw 'Invalid research child environment'
        }
        $result[$key] = $value
    }
    return $result
}

function Get-ResearchLifecycleEnvironment {
    param([Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Variables)
    # Run is already validated by the caller. Strict plain lifecycle map, no
    # probe controls or ignored extras. Does not authenticate the input source.
    $projected = Get-ResearchJobChildEnvironment -Variables $Variables -Admission $false -Descendant $false -Crash $false
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($key in $Variables.Keys) {
        if ($key -isnot [string] -or -not $seen.Add($key) -or -not $projected.ContainsKey($key)) {
            throw 'Invalid lifecycle environment schema'
        }
    }
    if ($seen.Count -ne $projected.Count) { throw 'Incomplete lifecycle environment schema' }
    Assert-ResearchJobEnvironmentPaths -Run $Run -Variables $projected
    Assert-ResearchJobEnvironmentControls -Variables $projected
    return $projected
}

function Assert-ResearchJobEnvironmentControls {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Variables)
    # Validate existing launcher policy; do not repair or log supplied values.
    $expected = @{
        POWERSHELL_TELEMETRY_OPTOUT='1'; POWERSHELL_UPDATECHECK='Off'
        GIT_CONFIG_NOSYSTEM='1'; GIT_TERMINAL_PROMPT='0'
        TUNNELMOLE_TELEMETRY='0'; DO_NOT_TRACK='1'
        NODE_DISABLE_COMPILE_CACHE='1'; FORCE_COLOR='0'
    }
    foreach ($name in $expected.Keys) {
        if (-not [string]::Equals([string]$Variables[$name], $expected[$name], [StringComparison]::Ordinal)) {
            throw "Research environment control mismatch: $name"
        }
    }
}

function Assert-ResearchJobEnvironmentPaths {
    param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)][System.Collections.IDictionary]$Variables)
    # Run must already pass Assert-ResearchJobRun. Static checks only; not an env allowlist.
    $directories = @{
        HOME='home'; USERPROFILE='home'; TEMP='temp'; TMP='temp'
        APPDATA='appdata'; LOCALAPPDATA='localappdata'
        XDG_CONFIG_HOME='config'; XDG_CACHE_HOME='cache'; XDG_DATA_HOME='data'
    }
    foreach ($name in $directories.Keys) {
        $expected = [IO.Path]::Combine($Run, $directories[$name])
        if (-not [string]::Equals([string]$Variables[$name], $expected, [StringComparison]::Ordinal)) {
            throw "Research environment path mismatch: $name"
        }
        $item = [IO.DirectoryInfo]::new($expected)
        if (-not $item.Exists -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Research environment directory invalid: $name"
        }
    }
    if (-not [string]::Equals([string]$Variables['PSModuleAnalysisCachePath'],
        [IO.Path]::Combine($Run, 'module-analysis-cache'), [StringComparison]::Ordinal)) {
        throw 'Research environment path mismatch: PSModuleAnalysisCachePath'
    }
    $cache = [IO.FileInfo]::new([IO.Path]::Combine($Run, 'module-analysis-cache'))
    if ([IO.Directory]::Exists($cache.FullName) -or
        (($cache.Attributes -ne -1) -and ($cache.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw 'Research module cache must not be a directory or reparse point'
    }
}

function Assert-ResearchJobRun {
    param([Parameter(Mandatory)][string]$Repository, [Parameter(Mandatory)][string]$Run,
        [ValidateSet('job-preflight', 'electron-lifecycle')][string]$Mode = 'job-preflight')
    if ($Mode -cne 'job-preflight' -and $Mode -cne 'electron-lifecycle') { throw 'Invalid research run mode' }
    $namePattern = if ($Mode -ceq 'job-preflight') { '^job-preflight-[A-Za-z0-9]{6}$' } else { '^electron-lifecycle-[A-Za-z0-9]{6}$' }
    if (-not [IO.Path]::IsPathFullyQualified($Repository) -or -not [IO.Path]::IsPathFullyQualified($Run)) {
        throw 'Fully qualified research paths required'
    }
    $repositoryPath = [IO.Path]::GetFullPath($Repository)
    $runPath = [IO.Path]::GetFullPath($Run)
    $basePath = [IO.Path]::Combine($repositoryPath, '.tmp')
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($runPath), $basePath, [StringComparison]::Ordinal) -or
        [IO.Path]::GetFileName($runPath) -cnotmatch $namePattern) {
        throw 'Expected direct repository run directory matching mode'
    }
    foreach ($directory in @($repositoryPath, $basePath, $runPath)) {
        $item = [IO.DirectoryInfo]::new($directory)
        if (-not $item.Exists -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Research directories must exist without reparse points'
        }
    }
    return $runPath
}
