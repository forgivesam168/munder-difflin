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
#>
[CmdletBinding()]
param(
    [switch]$CompileOnly,
    [switch]$Native,
    [ValidateSet('normal-descendant', 'root-early-exit', 'bounded-stop', 'timeout',
        'query-failure', 'helper-failure', 'receipt-failure', 'unrelated-sentinel', 'pty-io')]
    [string]$Scenario = 'normal-descendant',
    [string]$NodeExecutable,
    [string]$ProofRoot
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

function New-Receipt {
    param(
        [Parameter(Mandatory)][string]$Result,
        [Parameter(Mandatory)][string]$CleanupState,
        [bool]$NativeExecuted = $false,
        [string]$FailureStage = $null,
        [object]$Native = $null
    )
    $get = {
        param([string]$Name, $Default)
        if ($null -ne $Native) {
            $property = $Native.PSObject.Properties[$Name]
            if ($null -ne $property) { return $property.Value }
        }
        return $Default
    }
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
        cleanupState = $CleanupState
        forcedStop = [bool](& $get 'forcedStop' $false)
        unrelatedProcessTouched = [bool](& $get 'unrelatedProcessTouched' $false)
        unrelatedSentinelSurvived = [bool](& $get 'unrelatedSentinelSurvived' $false)
        # ActiveProcesses is a worker-tree observation only.  Windows-owned
        # conhost.exe/OpenConsole.exe and the HPCON/pipe transport are not
        # claimed as worker descendants; their lifecycle is separate.
        workerTreeClaim = 'synthetic root and its descendants only'
        pseudoConsoleHostIncluded = $false
        result = $Result
        nativeExecuted = $NativeExecuted
        failureStage = if ($FailureStage) { $FailureStage } else { & $get 'failureStage' $null }
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

function Assert-NativeInput {
    if (-not $NodeExecutable -or -not $ProofRoot) { throw 'Native mode requires fixed NodeExecutable and ProofRoot' }
    $node = Get-CanonicalRegularFile -Path $NodeExecutable
    if ([IO.Path]::GetExtension($node) -cne '.exe' -or
        [IO.Path]::GetFileName($node) -cne 'node.exe') { throw 'Native executable must be the direct node.exe file' }
    if ($fixturePath -cne [IO.Path]::GetFullPath((Join-Path $repository 'test\fixtures\research-job-conpty-child.cjs'))) {
        throw 'Unexpected fixed ConPTY fixture'
    }
    $tmp = [IO.Path]::GetFullPath((Join-Path $repository '.tmp'))
    if ([IO.Path]::GetDirectoryName($ProofRoot) -cne $tmp -or
        [IO.Path]::GetFileName($ProofRoot) -cnotmatch '^conpty-job-proof-[A-Za-z0-9]{6}$') {
        throw 'ProofRoot must be a fixed direct synthetic .tmp child'
    }
    if ([IO.Directory]::Exists($ProofRoot)) { $null = Get-CanonicalDirectory -Path $ProofRoot }
    return $node
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
    $home = [IO.Path]::Combine($Root, 'home')
    $profile = [IO.Path]::Combine($Root, 'user-profile')
    $temp = [IO.Path]::Combine($Root, 'temp')
    foreach ($directory in @($home, $profile, $temp)) {
        $null = [IO.Directory]::CreateDirectory($directory)
    }
    $values = [ordered]@{
        SystemRoot = $systemRoot
        ComSpec = $comSpec
        PATH = "$nodeDir;$systemRoot\System32"
        HOME = $home
        USERPROFILE = $profile
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
        public string cleanupState = "UNKNOWN";
        public bool forcedStop;
        public bool unrelatedProcessTouched;
        public bool unrelatedSentinelSurvived;
        public string result = "UNKNOWN";
        public bool nativeExecuted = true;
        public string failureStage;
    }

    public static class ConptyJobProofNative {
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const uint PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
        const uint PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
        const uint HANDLE_FLAG_INHERIT = 0x00000001;
        const uint ERROR_INSUFFICIENT_BUFFER = 122;
        const uint ERROR_BROKEN_PIPE = 109;
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
        [DllImport("kernel32.dll", SetLastError = false)]
        static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool IsProcessInJob(IntPtr processHandle, IntPtr jobHandle, out bool result);
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
        static extern bool CloseHandle(IntPtr hObject);

        sealed class UnknownProof : Exception { public UnknownProof(string message) : base(message) { } }

        sealed class OutputDrain {
            readonly IntPtr handle;
            readonly object sync = new object();
            readonly StringBuilder text = new StringBuilder();
            public int? errorCode;
            public Task task;
            public OutputDrain(IntPtr value) { handle = value; }
            public void Start() {
                task = Task.Factory.StartNew(Read, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            }
            void Read() {
                var buffer = new byte[4096];
                while (true) {
                    uint read;
                    if (!ReadFile(handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero)) {
                        int error = Marshal.GetLastWin32Error();
                        lock (sync) { errorCode = error == ERROR_BROKEN_PIPE ? (int?)null : error; }
                        return;
                    }
                    if (read == 0) return;
                    lock (sync) { text.Append(Encoding.UTF8.GetString(buffer, 0, (int)read)); }
                }
            }
            public bool Contains(string marker, int milliseconds) {
                var watch = System.Diagnostics.Stopwatch.StartNew();
                while (watch.ElapsedMilliseconds < milliseconds) {
                    lock (sync) { if (text.ToString().Contains(marker, StringComparison.Ordinal)) return true; }
                    Thread.Sleep(20);
                }
                lock (sync) { return text.ToString().Contains(marker, StringComparison.Ordinal); }
            }
            public bool Wait(int milliseconds) { return task != null && task.Wait(milliseconds); }
        }

        static void Check(bool value, string stage) {
            if (!value) throw new Win32Exception(Marshal.GetLastWin32Error(), stage);
        }
        static void CheckHr(int value, string stage) {
            if (value != 0) throw new InvalidOperationException(stage + ": HRESULT=0x" + value.ToString("X8"));
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
            OutputDrain drain = null;
            try {
                ValidateFixedInputs(executable, fixture, root, scenario);
                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW");
                var limits = new ExtendedLimitInformation();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))), "SetInformationJobObject");

                var security = new SecurityAttributes { nLength = Marshal.SizeOf(typeof(SecurityAttributes)), bInheritHandle = 1 };
                Check(CreatePipe(out inputRead, out inputWrite, ref security, 0), "CreatePipe input");
                Check(CreatePipe(out outputRead, out outputWrite, ref security, 0), "CreatePipe output");
                Check(SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation input");
                Check(SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation output");
                CheckHr(CreatePseudoConsole(new Coord(80, 25), inputRead, outputWrite, 0, out pseudoConsole), "CreatePseudoConsole");
                CloseOwned(ref inputRead, ref closeOkay);
                CloseOwned(ref outputWrite, ref closeOkay);

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
                startup.lpAttributeList = attributes;
                var commandLine = new StringBuilder(FixedCommand(executable, fixture, scenario));
                Check(CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, environmentBlock, root,
                    ref startup, out process), "CreateProcessW");
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
                    receipt.descendantObserved = drain.Contains("DESCENDANT_READY\n", 2000) && active > 0;
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
                    if (scenario == "bounded-stop" || scenario == "timeout" || scenario == "root-early-exit") {
                        receipt.forcedStop = true; forcedCleanup = true;
                        if (!RequestBoundedStop(job, receipt)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Bounded Job stop");
                    }
                    if (scenario == "normal-descendant" || scenario == "unrelated-sentinel") {
                        if (!WaitActiveZero(job, 10000, out active, out queryError)) throw new UnknownProof("Normal Job completion was not verified");
                        receipt.activeProcessesFinal = active;
                        if (!drain.Contains("DESCENDANT_DONE\n", 2000)) throw new InvalidOperationException("Descendant completion marker missing");
                    }
                    if (scenario == "unrelated-sentinel") {
                        uint currentExit;
                        Check(GetExitCodeProcess(GetCurrentProcess(), out currentExit), "Unrelated sentinel query");
                        if (currentExit != 259) throw new InvalidOperationException("Unrelated sentinel did not survive");
                        receipt.unrelatedSentinelSurvived = true;
                    }
                }
                receipt.result = "PASS";
            } catch (UnknownProof error) {
                receipt.result = "UNKNOWN";
                receipt.failureStage = error.Message;
            } catch (Exception error) {
                receipt.result = "FAIL";
                receipt.failureStage = error is Win32Exception ? "native-call-failed" : "proof-assertion-failed";
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
                if (pseudoConsole != IntPtr.Zero) {
                    ClosePseudoConsole(pseudoConsole);
                    pseudoConsole = IntPtr.Zero;
                    receipt.pseudoConsoleClosed = true;
                }
                CloseOwned(ref inputWrite, ref closeOkay);
                CloseOwned(ref outputRead, ref closeOkay);
                if (drain != null) {
                    receipt.ioDrained = drain.Wait(3000) && !drain.errorCode.HasValue;
                    if (!receipt.ioDrained && receipt.result == "PASS") receipt.result = "UNKNOWN";
                }
                if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); attributes = IntPtr.Zero; }
                if (jobValue != IntPtr.Zero) { Marshal.FreeHGlobal(jobValue); jobValue = IntPtr.Zero; }
                CloseOwned(ref process.hThread, ref closeOkay);
                CloseOwned(ref process.hProcess, ref closeOkay);
                CloseOwned(ref inputRead, ref closeOkay);
                CloseOwned(ref outputWrite, ref closeOkay);
                if (job != IntPtr.Zero) { CloseOwned(ref job, ref closeOkay); }
                if (!closeOkay && receipt.result == "PASS") receipt.result = "UNKNOWN";
                if (receipt.cleanupState != "VERIFIED_EMPTY" && receipt.result == "PASS") receipt.result = "UNKNOWN";
                if (receipt.result == "PASS" &&
                    (!receipt.rootCreationSucceeded || !receipt.rootJobMember || !receipt.rootExit.HasValue ||
                     receipt.queryError != null || receipt.activeProcessesFinal != 0 ||
                     !receipt.pseudoConsoleClosed || !receipt.ioDrained ||
                     (scenario != "pty-io" && !receipt.descendantObserved) ||
                     (scenario == "unrelated-sentinel" && !receipt.unrelatedSentinelSurvived)))
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
if ($CompileOnly -and $Native) { throw 'CompileOnly and Native are mutually exclusive' }

if ($CompileOnly) {
    $null = Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage $null
    $receipt.nativeExecuted = $false
    $receipt.verification = 'PASS'
    $receipt.failureStage = $null
    $receipt.checks = @('PowerShell parsed', 'embedded C# compiled', 'native entry not invoked')
    Write-Receipt -Receipt $receipt
    exit 0
}

if (-not $Native) {
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -FailureStage 'native-mode-not-requested'
    $receipt.checks = @('contract-only default', 'no process creation', 'no ConPTY creation', 'no Job termination')
    Write-Receipt -Receipt $receipt
    exit 0
}

try {
    $node = Assert-NativeInput
    $null = Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    $root = [IO.Path]::GetFullPath($ProofRoot)
    $environmentBlock = New-NativeEnvironmentBlock -NodePath $node -Root $root
    $environmentPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($environmentBlock)
    try {
        $nativeReceipt = [Munder.Research.ConptyJobProofNative]::Run(
            'munder-b1-conpty-job-ownership', $Scenario, $node, $fixturePath, $root, $environmentPointer)
        $receipt = New-Receipt -Result ([string]$nativeReceipt.result) -CleanupState ([string]$nativeReceipt.cleanupState) -NativeExecuted $true -Native $nativeReceipt
        $receipt.checks = @(
            'private unnamed Job', 'KILL_ON_JOB_CLOSE', 'ConPTY pipes and HPCON',
            'STARTUPINFOEX PSEUDOCONSOLE plus JOB_LIST', 'direct CreateProcessW',
            'root membership and ActiveProcesses queries', 'bounded TerminateJobObject stop',
            'separate pseudoConsoleClosed and ioDrained observations')
        $receiptPath = [IO.Path]::Combine($root, 'proof-receipt.json')
        try {
            Write-Receipt -Receipt $receipt -DurablePath $receiptPath
        } catch {
            $receipt.result = 'UNKNOWN'
            $receipt.cleanupState = 'UNKNOWN'
            $receipt.failureStage = 'durable-receipt-write-failed'
            Write-Receipt -Receipt $receipt
            exit 1
        }
        exit $(if ($receipt.result -eq 'PASS') { 0 } else { 1 })
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($environmentPointer)
    }
} catch {
    $receipt = New-Receipt -Result 'UNKNOWN' -CleanupState 'UNKNOWN' -NativeExecuted $false -FailureStage 'native-admission-or-compile-failed'
    Write-Receipt -Receipt $receipt
    exit 1
}
