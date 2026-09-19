<#
.SYNOPSIS
    Non-native contract and compile-only harness for the B1 ConPTY/Job proof.

.DESCRIPTION
    The default path only emits the proof contract.  -CompileOnly parses and
    compiles the embedded native declarations without calling a Windows API.
    Only an explicit -Native invocation can create the fixed synthetic child.

    The native path is intentionally not a worker launcher.  It accepts one
    fixed inert fixture, builds one STARTUPINFOEX attribute list containing
    both the pseudoconsole and direct Job-list attributes, and uses only the
    bounded TerminateJobObject stop path for forced cleanup.

    Transport lifetime changes do not establish stdio routing.  The native
    root-early-exit claim still requires both fixed markers in drained bytes.
#>
[CmdletBinding()]
param(
    [switch]$CompileOnly,
    [switch]$Native,
    [switch]$AdmissionOnly,
    [ValidateSet('normal-descendant', 'root-early-exit', 'bounded-stop', 'timeout',
        'query-failure', 'helper-failure', 'receipt-failure', 'unrelated-sentinel', 'pty-io')]
    [string]$Scenario = 'normal-descendant',
    [string]$NodeExecutable,
    [string]$ProofRoot,
    [string]$AdmissionRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-WindowsPlatform {
    return [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
}

function Get-FileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-CanonicalRegularFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Absolute file path required' }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -cne $Path) { throw 'Canonical file path required' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if (-not ($item -is [IO.FileInfo]) -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $item.FullName -cne $full) {
        throw 'Regular non-reparse file required'
    }
    return $full
}

function Get-CanonicalDirectory {
    param([Parameter(Mandatory)][string]$Path)
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Absolute directory path required' }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -cne $Path) { throw 'Canonical directory path required' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if (-not ($item -is [IO.DirectoryInfo]) -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $item.FullName -cne $full) {
        throw 'Regular non-reparse directory required'
    }
    return $full
}

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$harnessPath = Get-CanonicalRegularFile -Path ([IO.Path]::GetFullPath($PSCommandPath))
$fixturePath = [IO.Path]::GetFullPath((Join-Path $repository 'test\fixtures\research-job-conpty-child.cjs'))
$fixturePath = Get-CanonicalRegularFile -Path $fixturePath
$sourceIdentity = [ordered]@{
    repositoryId = 'forgivesam168/munder-difflin'
    harnessPath = $harnessPath
    harnessSha256 = Get-FileSha256 -Path $harnessPath
}
$fixtureIdentity = [ordered]@{
    path = $fixturePath
    sha256 = Get-FileSha256 -Path $fixturePath
    contract = 'fixed inert descendant and PTY I/O fixture'
}

function Get-NativeExecutionState {
    param([bool]$NativeEntryAttempted, [bool]$NativeReceiptReturned)
    if (-not $NativeEntryAttempted) { return 'NOT_ATTEMPTED' }
    if (-not $NativeReceiptReturned) { return 'ATTEMPTED_NO_RECEIPT' }
    return 'EXECUTED_WITH_RECEIPT'
}

function Get-SafeErrorMetadata {
    param([Parameter(Mandatory)][System.Exception]$Exception)
    $hResult = $null
    $win32ErrorCode = $null
    if ($Exception.PSObject.Properties['HResult']) { $hResult = [int]$Exception.HResult }
    if ($Exception -is [ComponentModel.Win32Exception]) { $win32ErrorCode = [int]$Exception.NativeErrorCode }
    return [ordered]@{ hResult = $hResult; win32ErrorCode = $win32ErrorCode }
}

function New-Receipt {
    param(
        [Parameter(Mandatory)][string]$Result,
        [Parameter(Mandatory)][string]$CleanupState,
        [bool]$NativeExecuted = $false,
        [string]$FailureStage = $null,
        [object]$Native = $null,
        [bool]$NativeEntryAttempted = $false,
        [bool]$NativeReceiptReturned = $false,
        [string]$NativeExecutionState = $null,
        [string]$OuterFailureStage = $null,
        [ValidateSet('NONE', 'ADMISSION', 'COMPILE', 'ENVIRONMENT', 'NATIVE_ENTRY', 'NATIVE_RECEIPT', 'DURABLE_RECEIPT', 'NATIVE_LIFECYCLE')]
        [string]$ErrorCategory = 'NONE',
        [Nullable[int]]$ErrorHResult = $null,
        [Nullable[int]]$Win32ErrorCode = $null,
        [ValidateSet('NOT_RUN', 'PASS', 'FAIL', 'UNKNOWN')]
        [string]$AdmissionResult = 'NOT_RUN',
        [string[]]$AdmissionChecks = @()
    )
    $get = {
        param([string]$Name, $Default)
        if ($null -ne $Native) {
            $property = $Native.PSObject.Properties[$Name]
            if ($null -ne $property) { return $property.Value }
        }
        return $Default
    }
    $nativeErrorCategory = & $get 'errorCategory' 'NONE'
    $nativeHResult = & $get 'errorHResult' $null
    $nativeWin32ErrorCode = & $get 'win32ErrorCode' $null
    $effectiveErrorCategory = if ($ErrorCategory -ne 'NONE') { $ErrorCategory } else { [string]$nativeErrorCategory }
    $effectiveHResult = if ($null -ne $ErrorHResult) { $ErrorHResult } else { $nativeHResult }
    $effectiveWin32ErrorCode = if ($null -ne $Win32ErrorCode) { $Win32ErrorCode } else { $nativeWin32ErrorCode }
    return [ordered]@{
        schemaVersion = 1
        proofId = 'munder-b1-conpty-job-ownership'
        scenario = $Scenario
        sourceIdentity = $sourceIdentity
        fixtureIdentity = $fixtureIdentity
        rootProcessId = & $get 'rootProcessId' $null
        rootCreationSucceeded = [bool](& $get 'rootCreationSucceeded' $false)
        rootJobMember = [bool](& $get 'rootJobMember' $false)
        descendantObserved = [bool](& $get 'descendantObserved' $false)
        rootExit = & $get 'rootExit' $null
        terminationRequested = [bool](& $get 'terminationRequested' $false)
        terminationCount = [int](& $get 'terminationCount' 0)
        activeProcessesAfterRootExit = & $get 'activeProcessesAfterRootExit' $null
        activeProcessesFinal = & $get 'activeProcessesFinal' $null
        queryError = & $get 'queryError' $null
        pseudoConsoleClosed = [bool](& $get 'pseudoConsoleClosed' $false)
        ioDrained = [bool](& $get 'ioDrained' $false)
        drainDiagnostics = & $get 'drainDiagnostics' $null
        cleanupState = $CleanupState
        forcedStop = [bool](& $get 'forcedStop' $false)
        unrelatedProcessTouched = [bool](& $get 'unrelatedProcessTouched' $false)
        unrelatedSentinelSurvived = [bool](& $get 'unrelatedSentinelSurvived' $false)
        # ActiveProcesses is a worker-tree observation only.  Windows-owned
        # conhost.exe/OpenConsole.exe and the HPCON/pipe transport are not
        # claimed as worker descendants; their lifecycle is separate.
        workerTreeClaim = 'synthetic root and its descendants only'
        pseudoConsoleHostIncluded = $false
        unrelatedSentinelCreated = [bool](& $get 'unrelatedSentinelCreated' $false)
        unrelatedSentinelProcessId = & $get 'unrelatedSentinelProcessId' $null
        unrelatedSentinelExit = & $get 'unrelatedSentinelExit' $null
        unrelatedSentinelAliveAfterStop = [bool](& $get 'unrelatedSentinelAliveAfterStop' $false)
        unrelatedSentinelOutsideProofJob = [bool](& $get 'unrelatedSentinelOutsideProofJob' $false)
        unrelatedSentinelCleanupVerified = [bool](& $get 'unrelatedSentinelCleanupVerified' $false)
        unrelatedSentinelCleanupState = [string](& $get 'unrelatedSentinelCleanupState' 'UNKNOWN')
        admissionResult = $AdmissionResult
        admissionChecks = @($AdmissionChecks)
        result = $Result
        nativeExecuted = $NativeExecuted
        nativeEntryAttempted = $NativeEntryAttempted
        nativeReceiptReturned = $NativeReceiptReturned
        nativeExecutionState = if ($NativeExecutionState) { $NativeExecutionState } else { Get-NativeExecutionState -NativeEntryAttempted $NativeEntryAttempted -NativeReceiptReturned $NativeReceiptReturned }
        outerFailureStage = if ([string]::IsNullOrEmpty($OuterFailureStage)) { $null } else { $OuterFailureStage }
        errorCategory = $effectiveErrorCategory
        errorHResult = $effectiveHResult
        win32ErrorCode = $effectiveWin32ErrorCode
        failureStage = if ($FailureStage) { $FailureStage } elseif ($OuterFailureStage) { $OuterFailureStage } else { & $get 'failureStage' $null }
    }
}

function Write-Receipt {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Receipt, [string]$DurablePath)
    $json = $Receipt | ConvertTo-Json -Depth 12 -Compress
    if ($DurablePath) {
        if ([IO.File]::Exists($DurablePath)) { throw 'Duplicate proof receipt' }
        $pending = "$DurablePath.pending"
        if ([IO.File]::Exists($pending)) { throw 'Pending proof receipt already exists' }
        try {
            [IO.File]::WriteAllText($pending, $json, [Text.UTF8Encoding]::new($false))
            [IO.File]::Move($pending, $DurablePath)
        } catch {
            if ([IO.File]::Exists($pending)) { Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue }
            throw
        }
    }
    [Console]::Out.WriteLine($json)
}

function Assert-FixedInputs {
    if (-not $NodeExecutable) { throw 'Fixed NodeExecutable is required' }
    $node = Get-CanonicalRegularFile -Path $NodeExecutable
    if ([IO.Path]::GetExtension($node) -cne '.exe' -or
        [IO.Path]::GetFileName($node) -cne 'node.exe') { throw 'Native executable must be the direct node.exe file' }
    if ($fixturePath -cne [IO.Path]::GetFullPath((Join-Path $repository 'test\fixtures\research-job-conpty-child.cjs'))) {
        throw 'Unexpected fixed ConPTY fixture'
    }
    return $node
}

function Assert-ProofRoot {
    if (-not $ProofRoot) { throw 'Native mode requires fixed ProofRoot' }
    if ($AdmissionRoot) { throw 'Native mode cannot accept AdmissionRoot' }
    $tmp = [IO.Path]::GetFullPath((Join-Path $repository '.tmp'))
    if ([IO.Path]::GetDirectoryName($ProofRoot) -cne $tmp -or
        [IO.Path]::GetFileName($ProofRoot) -cnotmatch '^conpty-job-proof-[A-Za-z0-9]{6}$') {
        throw 'ProofRoot must be a fixed direct synthetic .tmp child'
    }
    if ([IO.Directory]::Exists($ProofRoot)) { $null = Get-CanonicalDirectory -Path $ProofRoot }
    return [IO.Path]::GetFullPath($ProofRoot)
}

function Assert-AdmissionRoot {
    if (-not $AdmissionRoot) { throw 'AdmissionOnly requires a separate AdmissionRoot' }
    if ($ProofRoot) { throw 'AdmissionOnly cannot accept ProofRoot' }
    $tmp = [IO.Path]::GetFullPath((Join-Path $repository '.tmp'))
    if ([IO.Path]::GetDirectoryName($AdmissionRoot) -cne $tmp -or
        [IO.Path]::GetFileName($AdmissionRoot) -cnotmatch '^conpty-admission-[A-Za-z0-9]{6}$') {
        throw 'AdmissionRoot must be a fixed direct synthetic .tmp child'
    }
    if ([IO.Directory]::Exists($AdmissionRoot)) { $null = Get-CanonicalDirectory -Path $AdmissionRoot }
    return [IO.Path]::GetFullPath($AdmissionRoot)
}

function New-NativeEnvironmentBlock {
    param([Parameter(Mandatory)][string]$NodePath, [Parameter(Mandatory)][string]$Root)
    $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', 'Process')
    $comSpec = [Environment]::GetEnvironmentVariable('ComSpec', 'Process')
    if (-not $systemRoot -or -not $comSpec) { throw 'Required Windows runtime paths are unavailable' }
    $systemRoot = [IO.Path]::GetFullPath($systemRoot)
    $comSpec = [IO.Path]::GetFullPath($comSpec)
    if (-not [IO.Directory]::Exists($systemRoot) -or -not [IO.File]::Exists($comSpec)) {
        throw 'Required Windows runtime paths are invalid'
    }
    $nodeDir = [IO.Path]::GetDirectoryName($NodePath)
    $homePath = [IO.Path]::Combine($Root, 'home')
    $userProfilePath = [IO.Path]::Combine($Root, 'user-profile')
    $temp = [IO.Path]::Combine($Root, 'temp')
    foreach ($directory in @($homePath, $userProfilePath, $temp)) {
        $null = [IO.Directory]::CreateDirectory($directory)
    }
    $values = [ordered]@{
        SystemRoot = $systemRoot
        ComSpec = $comSpec
        PATH = "$nodeDir;$systemRoot\System32"
        HOME = $homePath
        USERPROFILE = $userProfilePath
        TEMP = $temp
        TMP = $temp
        TERM = 'xterm-256color'
        COLORTERM = 'truecolor'
        FORCE_COLOR = '1'
        NODE_DISABLE_COMPILE_CACHE = '1'
    }
    foreach ($key in $values.Keys) {
        if ($key -match '(?i)(API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE|PRIVATE[_-]?KEY|PROXY)') {
            throw 'Credential-like environment key is forbidden'
        }
    }
    return ([string]::Join([char]0, @($values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })) + [char]0 + [char]0)
}

function Assert-BoundedEnvironmentBlock {
    param([Parameter(Mandatory)][string]$EnvironmentBlock, [Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$NodePath)
    $entries = @($EnvironmentBlock -split [char]0 | Where-Object { $_ })
    $expectedKeys = @('SystemRoot', 'ComSpec', 'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TERM', 'COLORTERM', 'FORCE_COLOR', 'NODE_DISABLE_COMPILE_CACHE')
    $actualKeys = @($entries | ForEach-Object { ($_ -split '=', 2)[0] })
    if ($actualKeys.Count -ne $expectedKeys.Count -or (@($actualKeys | Sort-Object -Unique).Count -ne $expectedKeys.Count) -or
        (@($actualKeys | Where-Object { $_ -notin $expectedKeys }).Count -ne 0)) {
        throw 'Bounded environment key allowlist validation failed'
    }
    $values = @{}
    foreach ($entry in $entries) {
        $pair = $entry -split '=', 2
        if ($pair.Count -ne 2) { throw 'Bounded environment entry is malformed' }
        $values[$pair[0]] = $pair[1]
    }
    $rootPrefix = $Root.TrimEnd('\') + '\'
    foreach ($key in @('HOME', 'USERPROFILE', 'TEMP', 'TMP')) {
        if (-not $values[$key].StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Bounded environment path escaped synthetic root for $key"
        }
    }
    $nodeDir = [IO.Path]::GetDirectoryName($NodePath)
    if ($values['PATH'] -cne "$nodeDir;$($values['SystemRoot'])\System32") { throw 'Bounded PATH validation failed' }
    return $true
}

$nativeSource = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Munder.Research {
    public sealed class ConptyJobProofReceipt {
        public int schemaVersion = 1;
        public string proofId;
        public string scenario;
        public int? rootProcessId;
        public bool rootCreationSucceeded;
        public bool rootJobMember;
        public bool descendantObserved;
        public int? rootExit;
        public bool terminationRequested;
        public int terminationCount;
        public int? activeProcessesAfterRootExit;
        public int? activeProcessesFinal;
        public string queryError;
        public bool pseudoConsoleClosed;
        public bool ioDrained;
        public DrainDiagnostics drainDiagnostics;
        public string cleanupState = "UNKNOWN";
        public bool forcedStop;
        public bool unrelatedProcessTouched;
        public bool unrelatedSentinelSurvived;
        public bool unrelatedSentinelCreated;
        public int? unrelatedSentinelProcessId;
        public int? unrelatedSentinelExit;
        public bool unrelatedSentinelAliveAfterStop;
        public bool unrelatedSentinelOutsideProofJob;
        public bool unrelatedSentinelCleanupVerified;
        public string unrelatedSentinelCleanupState = "UNKNOWN";
        public string result = "UNKNOWN";
        public bool nativeExecuted = true;
        public string failureStage;
        public string errorCategory = "NONE";
        public int? errorHResult;
        public int? win32ErrorCode;
    }

    // Additive observations only; null phase values mean the phase was not sampled.
    public sealed class DrainDiagnostics {
        public long bytesRead;
        public string capturedBytesBase64;
        public bool captureTruncated;
        public string terminalReadOutcome;
        public int? terminalReadError;
        public bool? rootMarkerObserved;
        public bool? descendantMarkerObserved;
        public string markerBufferPrefix;
        public int? markerBufferLength;
        public bool markerBufferTruncated;
        public bool? completedBeforePseudoConsoleClose;
        public bool? completedAfterPseudoConsoleClose;
        public bool? completedBeforeOutputReadClose;
        public bool? completedAfterOutputReadClose;
        public bool? waitResult;
        public bool completedAtSnapshot;
        public int? drainErrorCode;
        public bool? cancellationRequested;
        public bool cancellationUsed;
        public bool? cancellationStoppedReader;
        public int cancellationAttempts;
        public int? cancelErrorCode;
        public bool? waitAfterCancellation;
        public bool outputReadCloseDeferred;
        public int? closeFailureError;
    }

    public static class ConptyJobProofNative {
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const uint STARTF_USESTDHANDLES = 0x00000100;
        const uint PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
        const uint PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
        const uint HANDLE_FLAG_INHERIT = 0x00000001;
        const uint ERROR_INSUFFICIENT_BUFFER = 122;
        const uint ERROR_BROKEN_PIPE = 109;
        const uint THREAD_TERMINATE = 0x0001;
        const uint WAIT_OBJECT_0 = 0;
        const uint WAIT_TIMEOUT = 258;
        const int JobObjectBasicAccountingInformation = 1;
        const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimitInformation {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimitInformation {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct BasicAccountingInformation {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
        [StructLayout(LayoutKind.Sequential)]
        struct Coord { public short X, Y; public Coord(short x, short y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfo {
            public uint cb;
            public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public ushort wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr lpAttributeList; }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInformation { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, ref ExtendedLimitInformation lpJobObjectInfo, uint cbJobObjectInfoLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool QueryInformationJobObject(IntPtr hJob, int JobObjectInfoClass, out BasicAccountingInformation lpJobObjectInfo, uint cbJobObjectInfoLength, out uint lpReturnLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SecurityAttributes lpPipeAttributes, uint nSize);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern int CreatePseudoConsole(Coord size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern void ClosePseudoConsole(IntPtr hPC);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, uint dwFlags, ref IntPtr lpSize);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr Attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);
        [DllImport("kernel32.dll", SetLastError = false)]
        static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CreateProcessW(string lpApplicationName, [In, Out] StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref StartupInfoEx lpStartupInfo, out ProcessInformation lpProcessInformation);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool IsProcessInJob(IntPtr processHandle, IntPtr jobHandle, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool TerminateProcess(IntPtr processHandle, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool ReadFile(IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToRead, out uint lpNumberOfBytesRead, IntPtr lpOverlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool WriteFile(IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite, out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CancelSynchronousIo(IntPtr hThread);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenThread(uint dwDesiredAccess, bool bInheritHandle, uint dwThreadId);
        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CloseHandle(IntPtr hObject);

        sealed class UnknownProof : Exception { public UnknownProof(string message) : base(message) { } }

        sealed class OutputDrain {
            readonly IntPtr handle;
            readonly object sync = new object();
            readonly StringBuilder text = new StringBuilder();
            const int CaptureLimit = 64 * 1024;
            readonly byte[] captured = new byte[CaptureLimit];
            readonly ManualResetEventSlim readerThreadReady = new ManualResetEventSlim(false);
            IntPtr readerThread = IntPtr.Zero;
            int openedError;
            int cancelError;
            int cancelAttempts;
            int closeReaderError;
            int capturedCount;
            long bytesRead;
            string terminalReadOutcome = "PENDING";
            int? terminalReadError;
            bool? rootMarkerObserved;
            bool? descendantMarkerObserved;
            string markerBufferPrefix;
            int? markerBufferLength;
            bool ObserveMarker(string marker) {
                string value = text.ToString();
                bool found = value.Contains(marker, StringComparison.Ordinal) ||
                    (marker.EndsWith("\n", StringComparison.Ordinal) &&
                     value.Contains(marker.Substring(0, marker.Length - 1) + "\r\n", StringComparison.Ordinal));
                if (marker == "ROOT_EXIT\n") rootMarkerObserved = found;
                if (marker == "DESCENDANT_READY\n") {
                    descendantMarkerObserved = found;
                    markerBufferLength = text.Length;
                    markerBufferPrefix = text.ToString(0, Math.Min(text.Length, CaptureLimit));
                }
                return found;
            }
            public bool Completed { get { return task != null && task.IsCompleted; } }
            public void Snapshot(DrainDiagnostics diagnostics) {
                lock (sync) {
                    diagnostics.bytesRead = bytesRead;
                    diagnostics.capturedBytesBase64 = Convert.ToBase64String(captured, 0, capturedCount);
                    diagnostics.captureTruncated = bytesRead > capturedCount;
                    diagnostics.terminalReadOutcome = terminalReadOutcome;
                    diagnostics.terminalReadError = terminalReadError;
                    diagnostics.drainErrorCode = errorCode;
                    diagnostics.rootMarkerObserved = rootMarkerObserved;
                    diagnostics.descendantMarkerObserved = descendantMarkerObserved;
                    diagnostics.markerBufferPrefix = markerBufferPrefix;
                    diagnostics.markerBufferLength = markerBufferLength;
                    diagnostics.markerBufferTruncated = markerBufferLength > CaptureLimit;
                    diagnostics.completedAtSnapshot = Completed;
                    diagnostics.cancellationAttempts = cancelAttempts;
                    diagnostics.cancelErrorCode = cancelError == 0 ? (int?)null : cancelError;
                }
            }
            public int? errorCode;
            public Task task;
            public OutputDrain(IntPtr value) { handle = value; }
            public void Start() {
                task = Task.Factory.StartNew(Read, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            }
            void Capture(byte[] buffer, int read) {
                lock (sync) {
                    text.Append(Encoding.UTF8.GetString(buffer, 0, read));
                    int count = Math.Min(read, CaptureLimit - capturedCount);
                    Buffer.BlockCopy(buffer, 0, captured, capturedCount, count);
                    capturedCount += count;
                    bytesRead += read;
                }
            }
            void RecordTerminal(int? error) {
                lock (sync) {
                    if (error.HasValue) {
                        errorCode = error == ERROR_BROKEN_PIPE ? (int?)null : error;
                        terminalReadError = error;
                        terminalReadOutcome = error == ERROR_BROKEN_PIPE ? "BROKEN_PIPE" : "ERROR";
                    } else {
                        terminalReadOutcome = "ZERO_BYTES";
                    }
                }
            }
            void Read() {
                readerThread = OpenThread(THREAD_TERMINATE, false, GetCurrentThreadId());
                if (readerThread == IntPtr.Zero) openedError = Marshal.GetLastWin32Error();
                readerThreadReady.Set();
                if (readerThread == IntPtr.Zero) {
                    RecordTerminal(openedError);
                    return;
                }
                var buffer = new byte[4096];
                while (true) {
                    uint read;
                    if (!ReadFile(handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero)) {
                        int error = Marshal.GetLastWin32Error();
                        RecordTerminal(error);
                        return;
                    }
                    if (read == 0) {
                        RecordTerminal(null);
                        return;
                    }
                    Capture(buffer, (int)read);
                }
            }
            public bool Contains(string marker, int milliseconds) {
                var watch = System.Diagnostics.Stopwatch.StartNew();
                while (watch.ElapsedMilliseconds < milliseconds) {
                    lock (sync) { if (ObserveMarker(marker)) return true; }
                    Thread.Sleep(20);
                }
                lock (sync) { return ObserveMarker(marker); }
            }
            public bool Wait(int milliseconds) { return task != null && task.Wait(milliseconds); }
            // True only if a synchronous cancel was actually issued against the
            // reader; an aborted read may have left bytes unread.
            public bool CancellationIssued { get { return Volatile.Read(ref cancelAttempts) > 0; } }
            // CancelSynchronousIo is best effort and can miss the window between
            // two reads, so this returns true only once the reader task has actually
            // completed; no caller may treat an accepted cancel call as drained.
            public bool StopReader(int attemptMilliseconds, int attempts) {
                if (task == null) return false;
                if (task.Wait(attemptMilliseconds)) return true;
                if (readerThreadReady.Wait(1000) && readerThread != IntPtr.Zero) {
                    for (int attempt = 0; attempt < attempts; attempt++) {
                        // Between the timeout above and this iteration the reader may
                        // have finished on its own; a cancel is then neither needed
                        // nor issued, so the drain is not disqualified.
                        if (task.IsCompleted) return true;
                        Interlocked.Increment(ref cancelAttempts);
                        if (!CancelSynchronousIo(readerThread)) cancelError = Marshal.GetLastWin32Error();
                        if (task.Wait(attemptMilliseconds)) return true;
                    }
                }
                return task.IsCompleted;
            }
            public bool CloseReaderThreadHandle() {
                if (readerThread == IntPtr.Zero) return true;
                bool okay = CloseHandle(readerThread);
                if (!okay) closeReaderError = Marshal.GetLastWin32Error();
                readerThread = IntPtr.Zero;
                return okay;
            }
            public int ReaderCloseError { get { return closeReaderError; } }
        }

        static void Check(bool value, string stage) {
            if (!value) throw new Win32Exception(Marshal.GetLastWin32Error(), stage);
        }
        static void CheckHr(int value, string stage) {
            if (value != 0) throw new InvalidOperationException(stage + ": HRESULT=0x" + value.ToString("X8"));
        }
        static void CaptureSafeError(ConptyJobProofReceipt receipt, Exception error, string stage, string category) {
            receipt.failureStage = stage;
            receipt.errorCategory = category;
            receipt.errorHResult = error.HResult;
            var win32 = error as Win32Exception;
            if (win32 != null) receipt.win32ErrorCode = win32.NativeErrorCode;
        }
        static string Quote(string value) {
            if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid fixed argument");
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value) {
                if (ch == '\\') { slashes++; continue; }
                if (ch == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(ch); slashes = 0;
            }
            result.Append('\\', slashes * 2);
            return result.Append('"').ToString();
        }
        static string FixedCommand(string executable, string fixture, string scenario) {
            string argument;
            switch (scenario) {
                case "normal-descendant": argument = "--normal-descendant"; break;
                case "root-early-exit": argument = "--root-early-exit"; break;
                case "bounded-stop": argument = "--bounded-stop"; break;
                case "timeout": argument = "--timeout"; break;
                case "pty-io": argument = "--pty-io"; break;
                case "sentinel": argument = "--sentinel"; break;
                case "query-failure": argument = "--root-early-exit"; break;
                case "helper-failure": argument = "--root-early-exit"; break;
                case "receipt-failure": argument = "--root-early-exit"; break;
                case "unrelated-sentinel": argument = "--normal-descendant"; break;
                default: throw new ArgumentException("Unknown fixed proof scenario");
            }
            return Quote(executable) + " " + Quote(fixture) + " " + Quote(argument);
        }
        static void ValidateFixedInputs(string executable, string fixture, string root, string scenario) {
            if (!Path.IsPathFullyQualified(executable) || !Path.IsPathFullyQualified(fixture) || !Path.IsPathFullyQualified(root))
                throw new ArgumentException("Canonical fixed paths required");
            if (!String.Equals(Path.GetFileName(executable), "node.exe", StringComparison.Ordinal))
                throw new ArgumentException("Direct node.exe required");
            if (!String.Equals(Path.GetFileName(fixture), "research-job-conpty-child.cjs", StringComparison.Ordinal))
                throw new ArgumentException("Fixed ConPTY fixture required");
            if (!File.Exists(executable) || !File.Exists(fixture)) throw new FileNotFoundException("Fixed proof input missing");
            if (!Directory.Exists(root)) Directory.CreateDirectory(root);
            if (!new DirectoryInfo(root).FullName.Equals(Path.GetFullPath(root), StringComparison.Ordinal) ||
                (new DirectoryInfo(root).Attributes & FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("Synthetic proof root must be canonical and non-reparse");
            FixedCommand(executable, fixture, scenario);
        }

        static void CreateFixedSentinel(string executable, string fixture, string root, IntPtr environmentBlock, out ProcessInformation sentinel) {
            var startup = new StartupInfoEx();
            startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
            var commandLine = new StringBuilder(FixedCommand(executable, fixture, "sentinel"));
            Check(CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                CREATE_UNICODE_ENVIRONMENT, environmentBlock, root, ref startup, out sentinel), "Create sentinel");
        }
        static bool QueryActive(IntPtr job, out int active, out int error) {
            BasicAccountingInformation info;
            uint returned;
            bool okay = QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out info, (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)), out returned);
            if (!okay) { active = 0; error = Marshal.GetLastWin32Error(); return false; }
            if (returned != Marshal.SizeOf(typeof(BasicAccountingInformation))) { active = 0; error = 122; return false; }
            active = checked((int)info.ActiveProcesses); error = 0; return true;
        }
        static bool WaitActiveZero(IntPtr job, int milliseconds, out int final, out int error) {
            var watch = System.Diagnostics.Stopwatch.StartNew(); final = -1; error = 0;
            while (watch.ElapsedMilliseconds < milliseconds) {
                if (!QueryActive(job, out final, out error)) return false;
                if (final == 0) return true;
                Thread.Sleep(20);
            }
            if (!QueryActive(job, out final, out error)) return false;
            return final == 0;
        }
        static bool RequestBoundedStop(IntPtr job, ConptyJobProofReceipt receipt) {
            if (!TerminateJobObject(job, 0xE0010001)) return false;
            receipt.terminationRequested = true;
            receipt.terminationCount++;
            return true;
        }
        static void CloseOwned(ref IntPtr handle, ref bool okay) {
            if (handle == IntPtr.Zero) return;
            if (!CloseHandle(handle)) okay = false;
            handle = IntPtr.Zero;
        }

        public static ConptyJobProofReceipt Run(string proofId, string scenario, string executable, string fixture, string root, IntPtr environmentBlock) {
            var receipt = new ConptyJobProofReceipt { proofId = proofId, scenario = scenario, nativeExecuted = true };
            IntPtr job = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
            IntPtr pseudoConsole = IntPtr.Zero, attributes = IntPtr.Zero, jobValue = IntPtr.Zero, pseudoValue = IntPtr.Zero;
            bool attributesInitialized = false, rootExited = false, forcedCleanup = false, closeOkay = true;
            ProcessInformation process = new ProcessInformation();
            ProcessInformation sentinel = new ProcessInformation();
            bool sentinelCreated = false;
            OutputDrain drain = null;
            try {
                ValidateFixedInputs(executable, fixture, root, scenario);
                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW");
                var limits = new ExtendedLimitInformation();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))), "SetInformationJobObject");

                if (scenario == "unrelated-sentinel") {
                    CreateFixedSentinel(executable, fixture, root, environmentBlock, out sentinel);
                    sentinelCreated = true;
                    receipt.unrelatedSentinelCreated = true;
                    receipt.unrelatedSentinelProcessId = checked((int)sentinel.dwProcessId);
                }

                var security = new SecurityAttributes { nLength = Marshal.SizeOf(typeof(SecurityAttributes)), bInheritHandle = 1 };
                Check(CreatePipe(out inputRead, out inputWrite, ref security, 0), "CreatePipe input");
                Check(CreatePipe(out outputRead, out outputWrite, ref security, 0), "CreatePipe output");
                Check(SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation input");
                Check(SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation output");
                CheckHr(CreatePseudoConsole(new Coord(80, 25), inputRead, outputWrite, 0, out pseudoConsole), "CreatePseudoConsole");

                IntPtr attributeSize = IntPtr.Zero;
                bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeSize);
                if (sizing || Marshal.GetLastWin32Error() != ERROR_INSUFFICIENT_BUFFER || attributeSize == IntPtr.Zero)
                    throw new InvalidOperationException("STARTUPINFOEX attribute sizing failed");
                if (attributeSize.ToInt64() > Int32.MaxValue) throw new InvalidOperationException("STARTUPINFOEX attribute list is too large");
                attributes = Marshal.AllocHGlobal(attributeSize.ToInt32());
                Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref attributeSize), "InitializeProcThreadAttributeList");
                attributesInitialized = true;
                pseudoValue = pseudoConsole;
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE), pseudoValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute PSEUDOCONSOLE");
                jobValue = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobValue, job);
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_JOB_LIST), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute JOB_LIST");

                var startup = new StartupInfoEx();
                startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
                // Match node-pty's ConPTY launch: null standard handles prevent
                // the helper's redirected streams from bypassing the pseudoconsole.
                startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                startup.lpAttributeList = attributes;
                var commandLine = new StringBuilder(FixedCommand(executable, fixture, scenario));
                Check(CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, environmentBlock, root,
                    ref startup, out process), "CreateProcessW");
                // The pseudoconsole transport endpoints must remain valid until
                // the client process has consumed the PSEUDOCONSOLE attribute.
                CloseOwned(ref inputRead, ref closeOkay);
                CloseOwned(ref outputWrite, ref closeOkay);
                receipt.rootCreationSucceeded = true;
                receipt.rootProcessId = checked((int)process.dwProcessId);

                drain = new OutputDrain(outputRead);
                drain.Start();
                bool member;
                Check(IsProcessInJob(process.hProcess, job, out member), "IsProcessInJob");
                receipt.rootJobMember = member;
                if (!member) throw new InvalidOperationException("Root was not a direct Job member");

                if (scenario == "pty-io") {
                    if (!drain.Contains("PTY_READY\n", 3000)) throw new InvalidOperationException("PTY readiness marker missing");
                    byte[] input = Encoding.UTF8.GetBytes("proof-input\n"); uint written;
                    Check(WriteFile(inputWrite, input, (uint)input.Length, out written, IntPtr.Zero) && written == input.Length, "PTY input write");
                    uint wait = WaitForSingleObject(process.hProcess, 5000);
                    if (wait == WAIT_TIMEOUT) { receipt.forcedStop = true; forcedCleanup = true; if (!RequestBoundedStop(job, receipt)) throw new Win32Exception(Marshal.GetLastWin32Error(), "PTY bounded stop"); }
                    else if (wait != WAIT_OBJECT_0) throw new Win32Exception(Marshal.GetLastWin32Error(), "PTY root wait");
                    if (wait == WAIT_OBJECT_0) rootExited = true;
                    if (rootExited) { uint code; Check(GetExitCodeProcess(process.hProcess, out code), "GetExitCodeProcess"); receipt.rootExit = unchecked((int)code); }
                    if (!drain.Contains("PTY_ECHO:proof-input\n", 2000)) throw new InvalidOperationException("PTY echo marker missing");
                } else {
                    uint rootWait = WaitForSingleObject(process.hProcess, 5000);
                    if (rootWait == WAIT_TIMEOUT) { receipt.forcedStop = true; forcedCleanup = true; if (!RequestBoundedStop(job, receipt)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Root timeout stop"); }
                    else if (rootWait != WAIT_OBJECT_0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Root wait");
                    if (rootWait == WAIT_OBJECT_0) rootExited = true;
                    if (rootExited) { uint code; Check(GetExitCodeProcess(process.hProcess, out code), "GetExitCodeProcess"); receipt.rootExit = unchecked((int)code); }
                    int active, queryError;
                    if (!QueryActive(job, out active, out queryError)) throw new UnknownProof("ActiveProcesses after root exit query failed: " + queryError);
                    receipt.activeProcessesAfterRootExit = active;
                    receipt.descendantObserved = drain.Contains("ROOT_EXIT\n", 2000) &&
                        drain.Contains("DESCENDANT_READY\n", 2000) && active > 0;
                    if (scenario == "query-failure") {
                        BasicAccountingInformation ignored; uint returned;
                        if (QueryInformationJobObject(job, Int32.MaxValue, out ignored, (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)), out returned))
                            throw new InvalidOperationException("Query-failure injection unexpectedly succeeded");
                        receipt.queryError = Marshal.GetLastWin32Error().ToString();
                        throw new UnknownProof("Injected Job query failure");
                    }
                    if ((scenario == "normal-descendant" || scenario == "unrelated-sentinel") && !receipt.descendantObserved)
                        throw new InvalidOperationException("Expected descendant was not observed while root had exited");
                    if (scenario == "root-early-exit" && !receipt.descendantObserved)
                        throw new InvalidOperationException("Root exit did not leave the expected owned descendant");
                    if (scenario == "helper-failure" || scenario == "receipt-failure")
                        throw new UnknownProof("Injected proof helper/receipt failure");
                    if (scenario == "bounded-stop" || scenario == "timeout" || scenario == "root-early-exit" || scenario == "unrelated-sentinel") {
                        receipt.forcedStop = true; forcedCleanup = true;
                        if (!RequestBoundedStop(job, receipt)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Bounded Job stop");
                    }
                    if (scenario == "normal-descendant") {
                        if (!WaitActiveZero(job, 10000, out active, out queryError)) throw new UnknownProof("Normal Job completion was not verified");
                        receipt.activeProcessesFinal = active;
                        if (!drain.Contains("DESCENDANT_DONE\n", 2000)) throw new InvalidOperationException("Descendant completion marker missing");
                    }
                    if (scenario == "unrelated-sentinel") {
                        if (!sentinelCreated || sentinel.hProcess == IntPtr.Zero) throw new InvalidOperationException("Independent sentinel was not created");
                        bool sentinelInProofJob;
                        Check(IsProcessInJob(sentinel.hProcess, job, out sentinelInProofJob), "Unrelated sentinel Job query");
                        receipt.unrelatedSentinelOutsideProofJob = !sentinelInProofJob;
                        uint sentinelExit;
                        Check(GetExitCodeProcess(sentinel.hProcess, out sentinelExit), "Unrelated sentinel liveness query");
                        receipt.unrelatedSentinelAliveAfterStop = sentinelExit == 259;
                        receipt.unrelatedSentinelSurvived = receipt.unrelatedSentinelAliveAfterStop;
                        if (!receipt.unrelatedSentinelOutsideProofJob || !receipt.unrelatedSentinelAliveAfterStop)
                            throw new InvalidOperationException("Independent sentinel was touched by proof Job stop");
                    }
                }
                receipt.result = "PASS";
            } catch (UnknownProof error) {
                receipt.result = "UNKNOWN";
                CaptureSafeError(receipt, error, "native-query", "NATIVE_QUERY");
            } catch (Exception error) {
                receipt.result = "FAIL";
                CaptureSafeError(receipt, error, error is Win32Exception ? "native-call" : "native-assertion", error is Win32Exception ? "NATIVE_CALL" : "NATIVE_ASSERTION");
            } finally {
                if (job != IntPtr.Zero && receipt.result != "PASS" && !forcedCleanup) {
                    if (RequestBoundedStop(job, receipt)) { forcedCleanup = true; }
                    else if (String.IsNullOrEmpty(receipt.queryError)) receipt.queryError = Marshal.GetLastWin32Error().ToString();
                }
                if (!rootExited && process.hProcess != IntPtr.Zero) {
                    uint stoppedWait = WaitForSingleObject(process.hProcess, 3000);
                    if (stoppedWait == WAIT_OBJECT_0) {
                        uint stoppedCode;
                        if (GetExitCodeProcess(process.hProcess, out stoppedCode)) {
                            receipt.rootExit = unchecked((int)stoppedCode);
                            rootExited = true;
                        }
                    }
                }
                if (job != IntPtr.Zero) {
                    int active, queryError;
                    if (WaitActiveZero(job, 3000, out active, out queryError)) {
                        receipt.activeProcessesFinal = active;
                        receipt.cleanupState = "VERIFIED_EMPTY";
                    } else {
                        receipt.cleanupState = "FAILED";
                        if (String.IsNullOrEmpty(receipt.queryError)) receipt.queryError = queryError.ToString();
                        if (receipt.result == "PASS") receipt.result = "UNKNOWN";
                    }
                }
                var diagnostics = drain == null ? null : new DrainDiagnostics();
                bool outputReadDeferred = false;
                if (diagnostics != null) diagnostics.completedBeforePseudoConsoleClose = drain.Completed;
                if (pseudoConsole != IntPtr.Zero) {
                    ClosePseudoConsole(pseudoConsole);
                    pseudoConsole = IntPtr.Zero;
                    receipt.pseudoConsoleClosed = true;
                }
                if (diagnostics != null) diagnostics.completedAfterPseudoConsoleClose = drain.Completed;
                CloseOwned(ref inputWrite, ref closeOkay);
                if (drain != null) {
                    bool waited = drain.Wait(3000);
                    diagnostics.waitResult = waited;
                    if (!waited) {
                        // CancelSynchronousIo can arrive between two reads and stop
                        // nothing.  StopReader only returns true once the reader task
                        // has truly completed, so an accepted cancel call is never
                        // reported as drained.
                        diagnostics.cancellationRequested = true;
                        diagnostics.cancellationStoppedReader = drain.StopReader(1500, 2);
                        diagnostics.cancellationUsed = drain.CancellationIssued;
                        diagnostics.waitAfterCancellation = drain.Completed;
                        waited = diagnostics.cancellationStoppedReader == true;
                    }
                    bool readerStopped = waited;
                    if (readerStopped) {
                        diagnostics.completedBeforeOutputReadClose = drain.Completed;
                        CloseOwned(ref outputRead, ref closeOkay);
                        diagnostics.completedAfterOutputReadClose = drain.Completed;
                    } else {
                        // A read is still pending.  Closing outputRead here would
                        // invalidate the handle underneath ReadFile and destroy the
                        // evidence via ERROR_INVALID_HANDLE, so the close is deferred
                        // and process teardown owns this bounded, declared leak.
                        diagnostics.outputReadCloseDeferred = true;
                        outputReadDeferred = true;
                        closeOkay = false;
                    }
                    // An aborted reader stopped by cancellation may have left bytes
                    // unread, so it is never reported as drained.
                    receipt.ioDrained = readerStopped && !diagnostics.cancellationUsed && drain.errorCode == null;
                    drain.Snapshot(diagnostics);
                    receipt.drainDiagnostics = diagnostics;
                    if (readerStopped && !drain.CloseReaderThreadHandle()) {
                        diagnostics.closeFailureError = drain.ReaderCloseError;
                        closeOkay = false;
                    }
                    if (!receipt.ioDrained && receipt.result == "PASS") receipt.result = "UNKNOWN";
                }
                if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); attributes = IntPtr.Zero; }
                if (jobValue != IntPtr.Zero) { Marshal.FreeHGlobal(jobValue); jobValue = IntPtr.Zero; }
                CloseOwned(ref process.hThread, ref closeOkay);
                CloseOwned(ref process.hProcess, ref closeOkay);
                if (sentinelCreated && sentinel.hProcess != IntPtr.Zero) {
                    uint sentinelWait = WaitForSingleObject(sentinel.hProcess, 3000);
                    if (sentinelWait == WAIT_TIMEOUT) {
                        if (TerminateProcess(sentinel.hProcess, 0xE0010002)) {
                            sentinelWait = WaitForSingleObject(sentinel.hProcess, 3000);
                            receipt.unrelatedSentinelCleanupState = sentinelWait == WAIT_OBJECT_0 ? "RETAINED_HANDLE_TERMINATED" : "FAILED";
                        } else {
                            receipt.unrelatedSentinelCleanupState = "FAILED";
                        }
                    } else if (sentinelWait == WAIT_OBJECT_0) {
                        receipt.unrelatedSentinelCleanupState = "NATURAL_EXIT";
                    } else {
                        receipt.unrelatedSentinelCleanupState = "FAILED";
                    }
                    receipt.unrelatedSentinelCleanupVerified = sentinelWait == WAIT_OBJECT_0;
                    uint finalSentinelExit;
                    if (GetExitCodeProcess(sentinel.hProcess, out finalSentinelExit)) {
                        receipt.unrelatedSentinelExit = unchecked((int)finalSentinelExit);
                    } else {
                        receipt.unrelatedSentinelCleanupVerified = false;
                        receipt.unrelatedSentinelCleanupState = "FAILED";
                    }
                }
                CloseOwned(ref sentinel.hThread, ref closeOkay);
                CloseOwned(ref sentinel.hProcess, ref closeOkay);
                CloseOwned(ref inputRead, ref closeOkay);
                CloseOwned(ref outputWrite, ref closeOkay);
                // Close unassigned or completed-reader handles, never a live read.
                if (!outputReadDeferred) CloseOwned(ref outputRead, ref closeOkay);
                if (job != IntPtr.Zero) { CloseOwned(ref job, ref closeOkay); }
                if (!closeOkay && receipt.result == "PASS") receipt.result = "UNKNOWN";
                if (receipt.cleanupState != "VERIFIED_EMPTY" && receipt.result == "PASS") receipt.result = "UNKNOWN";
                if (receipt.result == "PASS" &&
                    (!receipt.rootCreationSucceeded || !receipt.rootJobMember || !receipt.rootExit.HasValue ||
                     receipt.queryError != null || receipt.activeProcessesFinal != 0 ||
                     !receipt.pseudoConsoleClosed || !receipt.ioDrained ||
                     (scenario != "pty-io" && !receipt.descendantObserved) ||
                     (scenario == "unrelated-sentinel" &&
                      (!receipt.unrelatedSentinelSurvived || !receipt.unrelatedSentinelCreated ||
                       !receipt.unrelatedSentinelOutsideProofJob || !receipt.unrelatedSentinelCleanupVerified))))
                    receipt.result = "UNKNOWN";
            }
            return receipt;
        }
    }
}
'@

if (-not (Test-WindowsPlatform)) {
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage 'windows-only-harness'
    Write-Receipt -Receipt $receipt
    exit 1
}
function Write-StageFailureReceipt {
    param(
        [Parameter(Mandatory)][ValidateSet('native-input-validation', 'embedded-csharp-compile', 'environment-preparation', 'native-entry-invocation', 'native-receipt-processing', 'durable-receipt-write')][string]$Stage,
        [Parameter(Mandatory)][ValidateSet('ADMISSION', 'COMPILE', 'ENVIRONMENT', 'NATIVE_ENTRY', 'NATIVE_RECEIPT', 'DURABLE_RECEIPT')][string]$Category,
        [System.Exception]$Exception = $null,
        [bool]$NativeEntryAttempted = $false,
        [bool]$NativeReceiptReturned = $false,
        [bool]$NativeExecuted = $false,
        [ValidateSet('NOT_RUN', 'PASS', 'FAIL', 'UNKNOWN')][string]$AdmissionResult = 'UNKNOWN',
        [string[]]$AdmissionChecks = @()
    )
    $metadata = if ($null -ne $Exception) { Get-SafeErrorMetadata -Exception $Exception } else { [ordered]@{ hResult = $null; win32ErrorCode = $null } }
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -NativeExecuted $NativeExecuted `
        -NativeEntryAttempted $NativeEntryAttempted -NativeReceiptReturned $NativeReceiptReturned `
        -NativeExecutionState (Get-NativeExecutionState -NativeEntryAttempted $NativeEntryAttempted -NativeReceiptReturned $NativeReceiptReturned) `
        -OuterFailureStage $Stage -ErrorCategory $Category -ErrorHResult $metadata.hResult `
        -Win32ErrorCode $metadata.win32ErrorCode -AdmissionResult $AdmissionResult -AdmissionChecks $AdmissionChecks
    $receipt.failureStage = $Stage
    Write-Receipt -Receipt $receipt
    return $receipt
}

if ($CompileOnly -and $Native) {
    Write-StageFailureReceipt -Stage 'native-input-validation' -Category 'ADMISSION' -AdmissionResult 'FAIL' | Out-Null
    exit 1
}
if ($CompileOnly -and $AdmissionOnly) {
    Write-StageFailureReceipt -Stage 'native-input-validation' -Category 'ADMISSION' -AdmissionResult 'FAIL' | Out-Null
    exit 1
}
if ($Native -and $AdmissionOnly) {
    Write-StageFailureReceipt -Stage 'native-input-validation' -Category 'ADMISSION' -AdmissionResult 'FAIL' | Out-Null
    exit 1
}

if ($CompileOnly) {
    try {
        $null = Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    } catch {
        Write-StageFailureReceipt -Stage 'embedded-csharp-compile' -Category 'COMPILE' -Exception $_.Exception | Out-Null
        exit 1
    }
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage $null
    $receipt.nativeExecuted = $false
    $receipt.verification = 'PASS'
    $receipt.failureStage = $null
    $receipt.checks = @('PowerShell parsed', 'embedded C# compiled', 'native entry not invoked')
    Write-Receipt -Receipt $receipt
    exit 0
}

if (-not $Native -and -not $AdmissionOnly) {
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage 'native-mode-not-requested'
    $receipt.checks = @('contract-only default', 'no process creation', 'no ConPTY creation', 'no Job termination')
    Write-Receipt -Receipt $receipt
    exit 0
}

if ($AdmissionOnly) {
    try {
        $node = Assert-FixedInputs
        $root = Assert-AdmissionRoot
    } catch {
        Write-StageFailureReceipt -Stage 'native-input-validation' -Category 'ADMISSION' -Exception $_.Exception -AdmissionResult 'FAIL' | Out-Null
        exit 1
    }
    try {
        $null = Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    } catch {
        Write-StageFailureReceipt -Stage 'embedded-csharp-compile' -Category 'COMPILE' -Exception $_.Exception -AdmissionResult 'UNKNOWN' | Out-Null
        exit 1
    }
    try {
        $environmentBlock = New-NativeEnvironmentBlock -NodePath $node -Root $root
        Assert-BoundedEnvironmentBlock -EnvironmentBlock $environmentBlock -Root $root -NodePath $node | Out-Null
    } catch {
        Write-StageFailureReceipt -Stage 'environment-preparation' -Category 'ENVIRONMENT' -Exception $_.Exception -AdmissionResult 'FAIL' | Out-Null
        exit 1
    }
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage $null `
        -AdmissionResult 'PASS' -AdmissionChecks @('fixed absolute node and fixture', 'embedded C# compiled', 'bounded environment prepared')
    $receipt.verification = 'PASS'
    $receipt.checks = @('AdmissionOnly', 'no native entry invoked', 'no Job/ConPTY/process creation')
    $receipt.failureStage = $null
    Write-Receipt -Receipt $receipt
    exit 0
}

try {
    $node = Assert-FixedInputs
    $root = Assert-ProofRoot
} catch {
    Write-StageFailureReceipt -Stage 'native-input-validation' -Category 'ADMISSION' -Exception $_.Exception -AdmissionResult 'FAIL' | Out-Null
    exit 1
}

try {
    $null = Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
} catch {
    Write-StageFailureReceipt -Stage 'embedded-csharp-compile' -Category 'COMPILE' -Exception $_.Exception | Out-Null
    exit 1
}

$environmentPointer = [IntPtr]::Zero
try {
    $environmentBlock = New-NativeEnvironmentBlock -NodePath $node -Root $root
    Assert-BoundedEnvironmentBlock -EnvironmentBlock $environmentBlock -Root $root -NodePath $node | Out-Null
    $environmentPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($environmentBlock)
} catch {
    Write-StageFailureReceipt -Stage 'environment-preparation' -Category 'ENVIRONMENT' -Exception $_.Exception | Out-Null
    exit 1
}

$nativeEntryAttempted = $true
$nativeReceipt = $null
$nativeReceiptReturned = $false
try {
    $nativeReceipt = [Munder.Research.ConptyJobProofNative]::Run(
        'munder-b1-conpty-job-ownership', $Scenario, $node, $fixturePath, $root, $environmentPointer)
    $nativeReceiptReturned = $null -ne $nativeReceipt
} catch {
    if ($environmentPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($environmentPointer) }
    Write-StageFailureReceipt -Stage 'native-entry-invocation' -Category 'NATIVE_ENTRY' -Exception $_.Exception `
        -NativeEntryAttempted $nativeEntryAttempted -NativeReceiptReturned $nativeReceiptReturned | Out-Null
    exit 1
}
if ($environmentPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($environmentPointer) }

try {
    if ($null -eq $nativeReceipt -or $nativeReceipt.GetType().FullName -ne 'Munder.Research.ConptyJobProofReceipt') {
        throw [InvalidOperationException]::new('Native receipt object was not returned')
    }
    if ([string]$nativeReceipt.result -notin @('PASS', 'FAIL', 'UNKNOWN') -or
        [string]$nativeReceipt.cleanupState -notin @('VERIFIED_EMPTY', 'FAILED', 'UNKNOWN')) {
        throw [InvalidOperationException]::new('Native receipt schema state was invalid')
    }
    $receipt = New-Receipt -Result ([string]$nativeReceipt.result) -CleanupState ([string]$nativeReceipt.cleanupState) `
        -NativeExecuted $true -Native $nativeReceipt -NativeEntryAttempted $nativeEntryAttempted `
        -NativeReceiptReturned $nativeReceiptReturned -NativeExecutionState (Get-NativeExecutionState `
            -NativeEntryAttempted $nativeEntryAttempted -NativeReceiptReturned $nativeReceiptReturned)
    $receipt.checks = @(
        'private unnamed Job', 'KILL_ON_JOB_CLOSE', 'ConPTY pipes and HPCON',
        'STARTUPINFOEX PSEUDOCONSOLE plus JOB_LIST', 'direct CreateProcessW',
        'root membership and ActiveProcesses queries', 'bounded TerminateJobObject stop',
        'separate pseudoConsoleClosed and ioDrained observations',
        'independent retained-handle sentinel outside proof Job'
    )
} catch {
    Write-StageFailureReceipt -Stage 'native-receipt-processing' -Category 'NATIVE_RECEIPT' -Exception $_.Exception `
        -NativeEntryAttempted $nativeEntryAttempted -NativeReceiptReturned $nativeReceiptReturned `
        -AdmissionResult 'NOT_RUN' | Out-Null
    exit 1
}

$receiptPath = [IO.Path]::Combine($root, 'proof-receipt.json')
try {
    Write-Receipt -Receipt $receipt -DurablePath $receiptPath
} catch {
    $metadata = Get-SafeErrorMetadata -Exception $_.Exception
    $receipt.result = 'UNKNOWN'
    $receipt.cleanupState = 'UNKNOWN'
    $receipt.outerFailureStage = 'durable-receipt-write'
    $receipt.errorCategory = 'DURABLE_RECEIPT'
    $receipt.errorHResult = $metadata.hResult
    $receipt.win32ErrorCode = $metadata.win32ErrorCode
    $receipt.failureStage = 'durable-receipt-write'
    $receipt.nativeExecutionState = 'EXECUTED_WITH_RECEIPT'
    $receipt.nativeEntryAttempted = $true
    $receipt.nativeReceiptReturned = $true
    Write-Receipt -Receipt $receipt
    exit 1
}
exit $(if ($receipt.result -eq 'PASS') { 0 } else { 1 })
