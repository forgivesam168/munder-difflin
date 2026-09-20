$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$MaxInitialBytes = 512 * 1024
$MaxEnvironmentEntries = 512
$MaxEnvironmentChars = 128 * 1024
$MaxArgs = 256
$MaxArgumentChars = 32000
$AllowedHelperEnvironment = @(
    'SystemRoot', 'ComSpec', 'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
    'POWERSHELL_TELEMETRY_OPTOUT', 'POWERSHELL_UPDATECHECK', 'PSModuleAnalysisCachePath'
)

function Read-BoundedUtf8Line {
    param(
        [Parameter(Mandatory)][IO.Stream]$Stream,
        [Parameter(Mandatory)][int]$MaximumBytes
    )
    $buffer = [Collections.Generic.List[byte]]::new([Math]::Min($MaximumBytes, 4096))
    while ($buffer.Count -le $MaximumBytes) {
        $value = $Stream.ReadByte()
        if ($value -lt 0) {
            if ($buffer.Count -eq 0) { return $null }
            break
        }
        if ($value -eq 10) { break }
        $buffer.Add([byte]$value)
    }
    if ($buffer.Count -gt $MaximumBytes) { throw 'Initial launch frame exceeds bounded size' }
    $bytes = $buffer.ToArray()
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    $line = $encoding.GetString($bytes)
    return $line.TrimEnd("`r")
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            return ([Convert]::ToHexString($sha.ComputeHash($stream))).ToLowerInvariant()
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
}

function Assert-LowerSha256 {
    param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string]$Name)
    if ($Value -isnot [string] -or $Value -cnotmatch '^[a-f0-9]{64}$') { throw "$Name must be a lowercase SHA-256" }
    return [string]$Value
}

function Get-CanonicalRegularFile {
    param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string]$Name)
    if ($Value -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($Value)) { throw "$Name must be an absolute path" }
    $full = [IO.Path]::GetFullPath([string]$Value)
    if ($full -cne [string]$Value) { throw "$Name must be canonical" }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item -isnot [IO.FileInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.FullName -cne $full) {
        throw "$Name must be a regular non-reparse file"
    }
    return $full
}

function Get-CanonicalDirectory {
    param([Parameter(Mandatory)][object]$Value)
    if ($Value -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($Value)) { throw 'cwd must be an absolute path' }
    $full = [IO.Path]::GetFullPath([string]$Value)
    if ($full -cne [string]$Value) { throw 'cwd must be canonical' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item -isnot [IO.DirectoryInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.FullName -cne $full) {
        throw 'cwd must be a regular non-reparse directory'
    }
    return $full
}

function Assert-Hash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Name
    )
    if ((Get-Sha256 -Path $Path) -cne $Expected) { throw "$Name SHA-256 mismatch" }
}

function Assert-BoundedEnvironment {
    param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Value -or $Value -isnot [Management.Automation.PSCustomObject]) { throw "$Name must be an object" }
    $properties = @($Value.PSObject.Properties)
    if ($properties.Count -gt $MaxEnvironmentEntries) { throw "$Name has too many entries" }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $characters = 0
    foreach ($property in $properties) {
        if ([string]::IsNullOrEmpty($property.Name) -or $property.Name.Contains('=') -or $property.Name.Contains([char]0) -or
            $property.Value -isnot [string] -or ([string]$property.Value).Contains([char]0) -or -not $seen.Add($property.Name)) {
            throw "$Name contains an invalid entry"
        }
        $characters += $property.Name.Length + ([string]$property.Value).Length + 2
        if ($characters -gt $MaxEnvironmentChars) { throw "$Name is too large" }
    }
}

function Write-FailureReceipt {
    param([Parameter(Mandatory)][string]$Message)
    $receipt = [ordered]@{
        type = 'exit'
        receipt = [ordered]@{
            rootPid = $null
            rootExit = $null
            rootJobMember = $false
            activeProcessesFinal = $null
            cleanupState = 'UNVERIFIED'
            ioDrained = $false
            pseudoConsoleClosed = $false
            ioMode = 'CONPTY'
            inputClosed = $false
            reason = 'launch-failure'
            error = $Message
        }
    }
    [Console]::Out.WriteLine(($receipt | ConvertTo-Json -Depth 4 -Compress))
}

$inputStream = [Console]::OpenStandardInput()
# Windows and PowerShell add process-local defaults during bootstrap. Do not
# propagate them: the native worker receives only the separately validated map.
foreach ($key in @([Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).Keys)) {
    if ([string]$key -notin $AllowedHelperEnvironment) {
        [Environment]::SetEnvironmentVariable([string]$key, $null, [EnvironmentVariableTarget]::Process)
    }
}
try {
    $line = Read-BoundedUtf8Line -Stream $inputStream -MaximumBytes $MaxInitialBytes
    if ([string]::IsNullOrEmpty($line)) { throw 'Initial launch frame is missing' }
    $launch = $line | ConvertFrom-Json -Depth 8
    $expectedProperties = @(
        'helperPath', 'helperSha256', 'scriptPath', 'scriptSha256', 'nativeSourcePath', 'nativeSourceSha256',
        'executablePath', 'executableSha256', 'args', 'cwd', 'env', 'cols', 'rows', 'timeoutMs', 'cleanupMs', 'ioMode'
    )
    $actualProperties = @($launch.PSObject.Properties.Name)
    if ($actualProperties.Count -ne $expectedProperties.Count -or
        @($actualProperties | Where-Object { $_ -cnotin $expectedProperties }).Count -ne 0) {
        throw 'Initial launch frame schema is invalid'
    }
    if ($launch.ioMode -cnotin @('CONPTY', 'RAW_PIPE')) { throw 'Invalid I/O mode' }

    $helperPath = Get-CanonicalRegularFile -Value $launch.helperPath -Name 'helperPath'
    $scriptPath = Get-CanonicalRegularFile -Value $launch.scriptPath -Name 'scriptPath'
    $nativeSourcePath = Get-CanonicalRegularFile -Value $launch.nativeSourcePath -Name 'nativeSourcePath'
    $executablePath = Get-CanonicalRegularFile -Value $launch.executablePath -Name 'executablePath'
    $cwd = Get-CanonicalDirectory -Value $launch.cwd
    if ([IO.Path]::GetExtension($helperPath) -cne '.exe' -or [IO.Path]::GetExtension($scriptPath) -cne '.ps1' -or
        [IO.Path]::GetExtension($nativeSourcePath) -cne '.cs' -or [IO.Path]::GetExtension($executablePath) -cne '.exe') {
        throw 'Launch file extensions are invalid'
    }

    $helperSha256 = Assert-LowerSha256 -Value $launch.helperSha256 -Name 'helperSha256'
    $scriptSha256 = Assert-LowerSha256 -Value $launch.scriptSha256 -Name 'scriptSha256'
    $nativeSourceSha256 = Assert-LowerSha256 -Value $launch.nativeSourceSha256 -Name 'nativeSourceSha256'
    $executableSha256 = Assert-LowerSha256 -Value $launch.executableSha256 -Name 'executableSha256'
    $currentHelper = Get-CanonicalRegularFile -Value ([Environment]::ProcessPath) -Name 'current helper'
    if ($currentHelper -cne $helperPath) { throw 'Running helper identity does not match helperPath' }
    if ([IO.Path]::GetFullPath($PSCommandPath) -cne $scriptPath) { throw 'Running script identity does not match scriptPath' }
    Assert-Hash -Path $helperPath -Expected $helperSha256 -Name 'helperPath'
    Assert-Hash -Path $scriptPath -Expected $scriptSha256 -Name 'scriptPath'
    Assert-Hash -Path $nativeSourcePath -Expected $nativeSourceSha256 -Name 'nativeSourcePath'
    Assert-Hash -Path $executablePath -Expected $executableSha256 -Name 'executablePath'

    if ($launch.args -isnot [Array] -or $launch.args.Count -gt $MaxArgs) { throw 'args count is invalid' }
    $argumentCharacters = 0
    foreach ($argument in $launch.args) {
        if ($argument -isnot [string] -or ([string]$argument).Contains([char]0)) { throw 'args contains an invalid value' }
        $argumentCharacters += ([string]$argument).Length
        if (([string]$argument).Length -gt $MaxArgumentChars -or $argumentCharacters -gt $MaxArgumentChars) { throw 'args is too large' }
    }
    Assert-BoundedEnvironment -Value $launch.env -Name 'env'
    foreach ($bound in @(
        @('cols', $launch.cols, 1, 32767),
        @('rows', $launch.rows, 1, 32767),
        @('timeoutMs', $launch.timeoutMs, 100, 86400000),
        @('cleanupMs', $launch.cleanupMs, 100, 60000)
    )) {
        if (($bound[1] -isnot [int] -and $bound[1] -isnot [long]) -or
            [long]$bound[1] -lt [long]$bound[2] -or [long]$bound[1] -gt [long]$bound[3]) {
            throw "$($bound[0]) is outside its supported bounds"
        }
    }

    # Source text is never built from launch data. Its pinned file identity was
    # checked above, and Add-Type receives only that fixed canonical path.
    Add-Type -Path $nativeSourcePath -ErrorAction Stop
    $nativeJson = ([ordered]@{
        executablePath = $executablePath
        ioMode = $launch.ioMode
        args = @($launch.args)
        cwd = $cwd
        env = $launch.env
        cols = [int]$launch.cols
        rows = [int]$launch.rows
        timeoutMs = [int]$launch.timeoutMs
        cleanupMs = [int]$launch.cleanupMs
    } | ConvertTo-Json -Depth 6 -Compress)
    $nativeLaunch = [Text.Json.JsonSerializer]::Deserialize(
        $nativeJson,
        [Munder.WindowsOwnedPty.LaunchRequest],
        [Text.Json.JsonSerializerOptions]::new()
    )
    [Munder.WindowsOwnedPty.NativeHost]::Run($nativeLaunch, $inputStream, [Console]::OpenStandardOutput())
    $inputStream.Dispose()
} catch {
    Write-FailureReceipt -Message $_.Exception.Message
    exit 1
}
