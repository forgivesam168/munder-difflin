param([switch]$ExplicitEnvironment, [switch]$WorkloadTimeout, [switch]$Admission, [switch]$Descendant, [switch]$Deadline, [switch]$CloseJob, [switch]$ReceiptFault, [switch]$RootFailure, [switch]$RootTimeout, [switch]$QueryFault, [switch]$RunningQueryFault, [switch]$TerminationFault,
    [switch]$CrashHelper, [switch]$CrashObserver, [switch]$CrashDescendant)
$ErrorActionPreference = 'Stop'
$guardPath = Join-Path $PSScriptRoot 'research-job-run.ps1'
if ($env:RESEARCH_JOB_GUARD_SHA256 -cnotmatch '^[a-f0-9]{64}$' -or
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($guardPath))).ToLowerInvariant() -cne $env:RESEARCH_JOB_GUARD_SHA256) {
    throw 'Research guard source identity mismatch'
}
. $guardPath
$null = Assert-ResearchJobRun -Repository (Split-Path -Parent $PSScriptRoot) -Run ([Environment]::CurrentDirectory)
Assert-ResearchJobEnvironmentPaths -Run ([Environment]::CurrentDirectory) -Variables ([Environment]::GetEnvironmentVariables())
Assert-ResearchJobEnvironmentControls -Variables ([Environment]::GetEnvironmentVariables())
if ($Descendant -and -not $Admission) { throw 'Descendant requires admission' }
if ($Deadline -and -not $Descendant) { throw 'Deadline requires descendant' }
if ($CloseJob -and (-not $Admission -or $Descendant -or $Deadline)) { throw 'CloseJob requires plain admission' }
if ($ReceiptFault -and (-not $Admission -or $Descendant -or $Deadline -or $CloseJob)) { throw 'ReceiptFault requires plain admission' }
if ($CrashHelper -and (-not $Admission -or ($Descendant -ne $CrashDescendant) -or $Deadline -or $CloseJob -or $ReceiptFault -or $CrashObserver)) { throw 'Invalid CrashHelper mode' }
if ($CrashObserver -and ($Admission -or $Descendant -or $Deadline -or $CloseJob -or $ReceiptFault)) { throw 'Observer mode is exclusive' }
if ($CrashDescendant -and -not ($CrashObserver -or $CrashHelper)) { throw 'CrashDescendant requires crash mode' }
if ($RootFailure -and (-not $Admission -or -not $Descendant -or $Deadline -or $CloseJob -or $ReceiptFault -or $CrashObserver -or $CrashHelper)) { throw 'Invalid root failure mode' }
if ($RootTimeout -and (-not $Admission -or $Descendant -or $Deadline -or $CloseJob -or $ReceiptFault -or $RootFailure -or $CrashObserver -or $CrashHelper)) { throw 'Invalid root timeout mode' }
if ($QueryFault -and (-not $Admission -or $Descendant -or $Deadline -or $CloseJob -or $ReceiptFault -or $RootFailure -or $RootTimeout -or $CrashObserver -or $CrashHelper)) { throw 'Invalid query fault mode' }
if ($RunningQueryFault -and -not $QueryFault) { throw 'Running query fault requires query fault mode' }
if ($TerminationFault -and -not $RunningQueryFault) { throw 'Termination fault requires running fault fixture' }
if ($WorkloadTimeout -and (-not $Admission -or -not $Descendant -or $Deadline -or $RootFailure -or $RootTimeout -or $QueryFault -or $CloseJob -or $ReceiptFault -or $CrashHelper -or $CrashObserver)) { throw 'Invalid workload timeout mode' }
if ($Descendant -or $CrashDescendant) {
    Assert-ResearchJobFixture -Repository (Split-Path -Parent $PSScriptRoot) -Fixture $env:RESEARCH_JOB_FIXTURE
}
if ($ExplicitEnvironment -and (-not $Admission -or $Descendant -or $Deadline -or $CloseJob -or $ReceiptFault -or $RootFailure -or $RootTimeout -or $QueryFault -or $CrashHelper -or $CrashObserver -or $WorkloadTimeout)) { throw 'Explicit environment requires plain admission' }
$inputVariables = if ($ExplicitEnvironment) { [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable } else { [Environment]::GetEnvironmentVariables() }
if ($inputVariables -isnot [Collections.IDictionary]) { throw 'Environment map required' }
Assert-ResearchJobEnvironmentPaths -Run ([Environment]::CurrentDirectory) -Variables $inputVariables
Assert-ResearchJobEnvironmentControls -Variables $inputVariables
$childEnvironment = Get-ResearchJobChildEnvironment -Variables $inputVariables -Admission ([bool]$Admission) -Descendant ([bool]($Descendant -or $CrashDescendant)) -Crash ([bool]($CrashObserver -or $CrashHelper))
if ($ExplicitEnvironment -and ($inputVariables.Count -ne $childEnvironment.Count -or $inputVariables['RESEARCH_NODE_EXECUTABLE'] -cne $env:RESEARCH_NODE_EXECUTABLE)) { throw 'Unexpected explicit environment map' }
# Synthetic sentinel is never an allowed forwarded input. Also checks observer route.
if ($CrashHelper -and [Environment]::GetEnvironmentVariable('RESEARCH_ENV_SENTINEL')) { throw 'Unexpected forwarded sentinel' }
# Admission creates a fixed Node child; Descendant adds the finite-lived leaf fixture.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ResearchEmptyJob {
    public static uint RemainingMilliseconds(long elapsed, uint budget) {
        if (elapsed < 0) throw new ArgumentOutOfRangeException("elapsed");
        return elapsed >= budget ? 0u : budget - (uint)elapsed;
    }
    public static uint MonitorRemaining(long workloadElapsed, uint workloadBudget, long cleanupElapsed, bool lifecycle = false) {
        // Negative cleanup elapsed means termination has not succeeded yet.
        return cleanupElapsed < 0 ? RemainingMilliseconds(workloadElapsed, workloadBudget)
            : RemainingMilliseconds(cleanupElapsed, lifecycle ? 10000u : 2000u);
    }
    public static string QuoteArgument(string value) {
        if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid argument");
        var result = new System.Text.StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits data, uint size);
    [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool QueryLimits(IntPtr job, int kind, out ExtendedLimits data, uint size, out uint returned);
    [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool QueryAccounting(IntPtr job, int kind, out Accounting data, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Startup {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
        IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreateProcessW(string application, System.Text.StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
        IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool TerminateProcess(SafeHandle process, uint exitCode);
    public static void TerminateHelper(SafeHandle process) { Check(TerminateProcess(process, 0xE0010001)); }
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    static long CreationTime(IntPtr process) {
        long created, exited, kernel, user;
        Check(GetProcessTimes(process, out created, out exited, out kernel, out user));
        return created;
    }
    public static IntPtr Capture(uint pid, long created) {
        IntPtr process = OpenProcess(0x101000, false, pid); // SYNCHRONIZE | QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            if (CreationTime(process) != created || WaitForSingleObject(process, 0) != 258)
                throw new InvalidOperationException("Root identity/liveness mismatch");
            return process;
        } catch { CloseHandle(process); throw; }
    }
    public static bool ObserveExit(IntPtr process) { return WaitForSingleObject(process, 2000) == 0; }
    public static void ReleaseObserved(IntPtr process) { Check(CloseHandle(process)); }
    static void PublishCrashIdentity(IntPtr process, uint pid, bool descendant) {
        string token = Environment.GetEnvironmentVariable("RESEARCH_CRASH_TOKEN");
        Guid parsed;
        if (!Guid.TryParse(token, out parsed)) throw new InvalidOperationException("Missing run token");
        string ready = System.IO.Path.Combine(Environment.CurrentDirectory, "crash-ready.txt");
        System.IO.File.WriteAllLines(ready + ".tmp", new string[] {
            token, pid.ToString(), CreationTime(process).ToString(), descendant ? "descendant" : "root" });
        System.IO.File.Move(ready + ".tmp", ready);
        System.Threading.Thread.Sleep(10000);
        throw new InvalidOperationException("Observer did not terminate helper in time");
    }
    static void PublishDescendant(IntPtr job) {
        string[] identity = System.IO.File.ReadAllLines(System.IO.Path.Combine(Environment.CurrentDirectory, "leaf-ready.txt"));
        if (identity.Length != 2 || identity[0] != Environment.GetEnvironmentVariable("RESEARCH_CRASH_TOKEN"))
            throw new InvalidOperationException("Invalid leaf handshake");
        uint pid = uint.Parse(identity[1]);
        IntPtr leaf = OpenProcess(0x101000, false, pid);
        if (leaf == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            bool member;
            Check(IsProcessInJob(leaf, job, out member));
            if (!member || WaitForSingleObject(leaf, 0) != 258)
                throw new InvalidOperationException("Leaf membership/liveness mismatch");
            PublishCrashIdentity(leaf, pid, true);
        } finally { Check(CloseHandle(leaf)); }
    }
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public class AdmissionResult {
        public uint ChildExit;
        public uint? TotalProcesses, ActiveProcesses;
        public bool Member;
        public uint ActiveAfterRootExit;
        public bool TimedOut, TerminationSucceeded, RootFailed, RootTimedOut;
        public uint ActiveBeforeTermination;
        public bool SuspendedBeforeClose, LastJobHandleClosed, ExitObservedAfterClose;
        public bool ReceiptWriteFailed;
        public int? QueryErrorCode;
        public bool RunningBeforeQueryFault;
        public int? TerminationErrorCode;
        public bool RunningBeforeTerminationFault;
    }
    sealed class ReceiptProbeFailure : Exception { }
    sealed class QueryProbeFailure : Exception {
        public int Code;
        public QueryProbeFailure(int code) { Code = code; }
    }
    sealed class TerminationProbeFailure : Exception {
        public int Code;
        public TerminationProbeFailure(int code) { Code = code; }
    }
    public static AdmissionResult Admit(string executable, bool descendant, string fixture, bool forceDeadline, bool closeJob, bool receiptFault, bool crashHelper, System.Collections.IDictionary childEnvironment, bool rootFailure = false, bool rootTimeout = false, bool queryFault = false, bool runningQueryFault = false, bool terminationFault = false, bool workloadTimeout = false, bool explicitEnvironment = false, bool lifecycleSuspended = false, bool lifecycleRunning = false, bool lifecycleStopProbe = false) {
        if (!System.IO.Path.IsPathFullyQualified(executable) || executable.Contains("\""))
            throw new ArgumentException("Absolute executable required");
        if (lifecycleSuspended && (!closeJob || descendant || forceDeadline || receiptFault || crashHelper || rootFailure || rootTimeout || queryFault || runningQueryFault || terminationFault || workloadTimeout || explicitEnvironment || !System.IO.Path.IsPathFullyQualified(fixture)))
            throw new ArgumentException("Invalid suspended lifecycle mode");
        if (lifecycleRunning && (lifecycleSuspended || closeJob || descendant || forceDeadline || receiptFault || crashHelper || rootFailure || rootTimeout || queryFault || runningQueryFault || terminationFault || workloadTimeout || explicitEnvironment || !System.IO.Path.IsPathFullyQualified(fixture)))
            throw new ArgumentException("Invalid running lifecycle mode");
        if (lifecycleStopProbe && !lifecycleRunning) throw new ArgumentException("Stop probe requires running lifecycle");
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr attributes = IntPtr.Zero, jobValue = IntPtr.Zero, environment = IntPtr.Zero;
        bool initialized = false;
        ProcessInfo child = new ProcessInfo();
        AdmissionResult failureEvidence = null;
        try {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
            IntPtr size = IntPtr.Zero;
            bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (sizing || Marshal.GetLastWin32Error() != 122 || size == IntPtr.Zero)
                throw new InvalidOperationException("Attribute sizing failed");
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
            initialized = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, job);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue,
                new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)); // JOB_LIST
            // Explicit allowlisted map, not the helper's post-startup environment.
            var entries = new System.Collections.Generic.List<string>();
            foreach (System.Collections.DictionaryEntry entry in childEnvironment)
                entries.Add(entry.Key + "=" + entry.Value);
            entries.Sort(StringComparer.OrdinalIgnoreCase);
            environment = Marshal.StringToHGlobalUni(string.Join("\0", entries) + "\0\0");
            var startup = new StartupEx();
            startup.Startup.Size = (uint)Marshal.SizeOf<StartupEx>();
            startup.Attributes = attributes;
            if (descendant && (!System.IO.Path.IsPathFullyQualified(fixture) || fixture.Contains("\"")))
                throw new ArgumentException("Absolute fixture required");
            var command = new System.Text.StringBuilder(QuoteArgument(executable) + " " +
                (descendant ? QuoteArgument(fixture) + (rootFailure ? " " + QuoteArgument("--fail-root") : "") : QuoteArgument("-e") + " " +
                QuoteArgument(explicitEnvironment ? "require('fs').writeFileSync('child-environment.json',JSON.stringify(Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),require('crypto').createHash('sha256').update(v).digest('hex')]))),{flag:'wx'})" : runningQueryFault ? "require('fs').writeFileSync('query-root-ready','ready',{flag:'wx'});setTimeout(()=>process.exit(0),5000)" : rootTimeout ? "setTimeout(()=>process.exit(0),3000)" : "process.exit(process.env.RESEARCH_ENV_SENTINEL===undefined?0:91)")));
            if (lifecycleSuspended || lifecycleRunning)
                command = new System.Text.StringBuilder(QuoteArgument(executable) + " " + QuoteArgument(fixture) + " " + QuoteArgument("--fixture") + " " + QuoteArgument(Environment.CurrentDirectory));
            string queryReady = System.IO.Path.Combine(Environment.CurrentDirectory, "query-root-ready");
            if (runningQueryFault && (System.IO.File.Exists(queryReady) || System.IO.Directory.Exists(queryReady)))
                throw new InvalidOperationException("Query readiness path already exists");
            var workloadClock = System.Diagnostics.Stopwatch.StartNew();
            uint workloadBudget = lifecycleRunning ? 40000u : rootTimeout ? 200u : workloadTimeout ? 1500u : descendant ? 8000u : 5000u;
            Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                0x08080400u | ((closeJob || receiptFault || (queryFault && !runningQueryFault) || (crashHelper && !descendant)) ? 4u : 0u), environment, Environment.CurrentDirectory, ref startup, out child));
            // CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT
            // CloseJob adds CREATE_SUSPENDED; never resumed and executes no fixture.
            bool member;
            Check(IsProcessInJob(child.Process, job, out member));
            if (!member) throw new InvalidOperationException("Child missing from job");
            if (lifecycleStopProbe)
                Console.WriteLine("{\"phase\":\"owned-root\",\"pid\":" + child.Pid + ",\"created\":\"" + CreationTime(child.Process) + "\"}");
            if (crashHelper && !descendant) PublishCrashIdentity(child.Process, child.Pid, false);
            if (queryFault) {
                if (runningQueryFault) {
                    var readyClock = System.Diagnostics.Stopwatch.StartNew();
                    while (!System.IO.File.Exists(queryReady)) {
                        if (readyClock.ElapsedMilliseconds >= 2000 || WaitForSingleObject(child.Process, 0) != 258)
                            throw new InvalidOperationException("Query root readiness failed");
                        System.Threading.Thread.Sleep(20);
                    }
                    if (System.IO.File.ReadAllText(queryReady) != "ready")
                        throw new InvalidOperationException("Invalid query root readiness");
                }
                if (WaitForSingleObject(child.Process, 0) != 258)
                    throw new InvalidOperationException("Expected live query-fault root");
                if (terminationFault) {
                    // Inject an invalid handle without disturbing the owned Job.
                    if (TerminateJobObject(IntPtr.Zero, 124))
                        throw new InvalidOperationException("Expected termination failure");
                    throw new TerminationProbeFailure(Marshal.GetLastWin32Error());
                }
                Accounting invalid;
                uint returned;
                if (QueryAccounting(job, int.MaxValue, out invalid, (uint)Marshal.SizeOf<Accounting>(), out returned))
                    throw new InvalidOperationException("Expected query failure");
                throw new QueryProbeFailure(Marshal.GetLastWin32Error());
            }
            if (receiptFault) {
                if (WaitForSingleObject(child.Process, 0) != 258)
                    throw new InvalidOperationException("Expected live suspended child before receipt fault");
                // Existing synthetic cwd is a directory, never a disposable file.
                // Writing it as a file must fail; only that specific failure is injected.
                try { System.IO.File.WriteAllText(Environment.CurrentDirectory, "synthetic receipt"); }
                catch (UnauthorizedAccessException) { throw new ReceiptProbeFailure(); }
                throw new InvalidOperationException("Expected receipt write failure did not occur");
            }
            if (closeJob) {
                if (WaitForSingleObject(child.Process, 0) != 258) // WAIT_TIMEOUT
                    throw new InvalidOperationException("Expected live suspended child");
                Check(CloseHandle(job)); job = IntPtr.Zero;
                if (WaitForSingleObject(child.Process, 2000) != 0)
                    throw new InvalidOperationException("Child exit not observed after job close");
                uint observedExit;
                Check(GetExitCodeProcess(child.Process, out observedExit));
                return new AdmissionResult { ChildExit = observedExit, Member = member,
                    SuspendedBeforeClose = true, LastJobHandleClosed = true, ExitObservedAfterClose = true };
            }
            bool terminated = false;
            bool workloadExpired = false;
            System.Diagnostics.Stopwatch cleanupClock = null;
            uint activeBeforeTermination = 0;
            uint waitResult = WaitForSingleObject(child.Process, RemainingMilliseconds(workloadClock.ElapsedMilliseconds, workloadBudget));
            bool rootTimedOut = waitResult == 258;
            if (rootTimedOut) {
                Accounting before;
                uint returned, beforeSize = (uint)Marshal.SizeOf<Accounting>();
                Check(QueryAccounting(job, 1, out before, beforeSize, out returned));
                if (returned != beforeSize) throw new InvalidOperationException("Accounting size mismatch");
                activeBeforeTermination = before.ActiveProcesses;
                Check(TerminateJobObject(job, 124));
                terminated = true;
                cleanupClock = System.Diagnostics.Stopwatch.StartNew();
                if (WaitForSingleObject(child.Process, MonitorRemaining(workloadClock.ElapsedMilliseconds, workloadBudget, cleanupClock.ElapsedMilliseconds, lifecycleRunning)) != 0)
                    throw new InvalidOperationException("Timed-out root cleanup unverified");
            } else if (waitResult != 0) {
                throw new InvalidOperationException("Child wait failed");
            }
            uint code;
            Check(GetExitCodeProcess(child.Process, out code));
            bool rootFailed = !rootTimedOut && code != 0;
            // Preserve creation-bound identity until exit is captured, then release
            // references before expecting job accounting to retire this process.
            Check(CloseHandle(child.Thread)); child.Thread = IntPtr.Zero;
            Check(CloseHandle(child.Process)); child.Process = IntPtr.Zero;
            var postRootClock = System.Diagnostics.Stopwatch.StartNew();
            uint lastActive = 0, lastTotal = 0;
            uint activeAfterRootExit = 0;
            bool firstQuery = true;
            do {
                Accounting accounting;
                uint returned, accountingSize = (uint)Marshal.SizeOf<Accounting>();
                Check(QueryAccounting(job, 1, out accounting, accountingSize, out returned));
                lastActive = accounting.ActiveProcesses; lastTotal = accounting.TotalProcesses;
                if (returned != accountingSize) throw new InvalidOperationException("Accounting size mismatch");
                if (firstQuery) {
                    activeAfterRootExit = accounting.ActiveProcesses;
                    firstQuery = false;
                    if (descendant && !rootFailed && !rootTimedOut && activeAfterRootExit == 0)
                        throw new InvalidOperationException("No active descendant observed after root exit");
                    if (crashHelper && descendant && !rootFailed && !rootTimedOut) PublishDescendant(job);
                }
                if (!terminated && RemainingMilliseconds(workloadClock.ElapsedMilliseconds, workloadBudget) == 0)
                    workloadExpired = true;
                // Lifetime accounting is not a unique-process identity count.
                if (accounting.ActiveProcesses == 0 && accounting.TotalProcesses >= 1) {
                    if (forceDeadline && !terminated)
                        throw new InvalidOperationException("Work ended before deadline termination");
                    return new AdmissionResult { ChildExit = code, Member = member,
                        TotalProcesses = accounting.TotalProcesses, ActiveProcesses = accounting.ActiveProcesses,
                        ActiveAfterRootExit = activeAfterRootExit, TimedOut = rootTimedOut || workloadExpired || (forceDeadline && terminated), RootFailed = rootFailed, RootTimedOut = rootTimedOut,
                        TerminationSucceeded = terminated, ActiveBeforeTermination = activeBeforeTermination };
                }
                if (!terminated && (workloadExpired || rootFailed || (forceDeadline && postRootClock.ElapsedMilliseconds >= 200))) {
                    activeBeforeTermination = accounting.ActiveProcesses;
                    Check(TerminateJobObject(job, 124));
                    terminated = true;
                    cleanupClock = System.Diagnostics.Stopwatch.StartNew();
                }
                System.Threading.Thread.Sleep(20);
            } while (cleanupClock == null || MonitorRemaining(workloadClock.ElapsedMilliseconds, workloadBudget, cleanupClock.ElapsedMilliseconds, lifecycleRunning) > 0);
            throw new InvalidOperationException("Job accounting mismatch: active=" + lastActive + ", total=" + lastTotal);
        } catch (TerminationProbeFailure error) {
            failureEvidence = new AdmissionResult { Member = true,
                TerminationErrorCode = error.Code, RunningBeforeTerminationFault = true };
        } catch (QueryProbeFailure error) {
            failureEvidence = new AdmissionResult { Member = true, SuspendedBeforeClose = !runningQueryFault,
                QueryErrorCode = error.Code, RunningBeforeQueryFault = runningQueryFault };
        } catch (ReceiptProbeFailure) {
            failureEvidence = new AdmissionResult { Member = true, SuspendedBeforeClose = true,
                ReceiptWriteFailed = true };
        } finally {
            // Close job first even when later resource release fails. No PID cleanup.
            bool closed = job == IntPtr.Zero || CloseHandle(job);
            bool exited = false;
            if (failureEvidence != null && closed) {
                exited = WaitForSingleObject(child.Process, 2000) == 0;
                uint observedExit;
                if (exited && GetExitCodeProcess(child.Process, out observedExit)) {
                    failureEvidence.ChildExit = observedExit;
                    failureEvidence.LastJobHandleClosed = true;
                    failureEvidence.ExitObservedAfterClose = true;
                } else exited = false;
            }
            if (child.Thread != IntPtr.Zero) closed = CloseHandle(child.Thread) && closed;
            if (child.Process != IntPtr.Zero) closed = CloseHandle(child.Process) && closed;
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (!closed) throw new InvalidOperationException("Handle close failed");
            if (failureEvidence != null && !exited)
                throw new InvalidOperationException("Fault cleanup exit unverified");
        }
        return failureEvidence;
    }
    public static uint Run() {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            uint size = (uint)Marshal.SizeOf<ExtendedLimits>();
            Check(SetInformationJobObject(job, 9, ref limits, size));
            ExtendedLimits observed;
            uint returned;
            Check(QueryLimits(job, 9, out observed, size, out returned));
            if (returned != size || observed.Basic.Flags != 0x2000)
                throw new InvalidOperationException("Job limits mismatch");
            Accounting accounting;
            uint accountingSize = (uint)Marshal.SizeOf<Accounting>();
            Check(QueryAccounting(job, 1, out accounting, accountingSize, out returned));
            if (returned != accountingSize || accounting.ActiveProcesses != 0 || accounting.TotalProcesses != 0)
                throw new InvalidOperationException("Expected empty private job");
            return accounting.ActiveProcesses;
        } finally { Check(CloseHandle(job)); }
    }
}
'@
try {
if ($CrashObserver) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = [Environment]::ProcessPath
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = [Environment]::CurrentDirectory
    $info.Environment.Clear()
    foreach ($key in $childEnvironment.Keys) { $info.Environment[$key] = $childEnvironment[$key] }
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $PSCommandPath, '-Admission', '-CrashHelper')) {
        $info.ArgumentList.Add($arg)
    }
    if ($CrashDescendant) { $info.ArgumentList.Add('-Descendant'); $info.ArgumentList.Add('-CrashDescendant') }
    $helper = [Diagnostics.Process]::Start($info)
    $observed = [IntPtr]::Zero
    try {
        $ready = [IO.Path]::Combine([Environment]::CurrentDirectory, 'crash-ready.txt')
        $wait = [Diagnostics.Stopwatch]::StartNew()
        while (-not [IO.File]::Exists($ready)) {
            if ($helper.HasExited -or $wait.ElapsedMilliseconds -ge 10000) { throw 'Helper readiness failed' }
            Start-Sleep -Milliseconds 20
        }
        $identity = [IO.File]::ReadAllLines($ready)
        $expectedKind = if ($CrashDescendant) { 'descendant' } else { 'root' }
        if ($identity.Length -ne 4 -or $identity[0] -ne $env:RESEARCH_CRASH_TOKEN -or $identity[3] -ne $expectedKind) { throw 'Invalid process handshake' }
        $observed = [ResearchEmptyJob]::Capture([uint32]$identity[1], [long]$identity[2])
        if ($helper.HasExited) { throw 'Helper exited before injection' }
        [ResearchEmptyJob]::TerminateHelper($helper.SafeHandle) # Explicit fault code, retained handle only.
        if (-not $helper.WaitForExit(3000)) { throw 'Helper termination unobserved' }
        if ($helper.ExitCode -ne -536805375) { throw 'Helper did not exit with injected termination code' }
        if (-not [ResearchEmptyJob]::ObserveExit($observed)) { throw 'Observed process exit unverified' }
        [ordered]@{ result='PASS'; helperTerminated=$true; processIdentityVerified=$true;
            processExitObserved=$true; observedKind=$expectedKind; helperExit=$helper.ExitCode; accounting=$null } | ConvertTo-Json -Compress
    } finally {
        try {
            if ($observed -ne [IntPtr]::Zero) { [ResearchEmptyJob]::ReleaseObserved($observed) }
        } finally {
            try {
                if (-not $helper.HasExited) { $helper.Kill(); $null = $helper.WaitForExit(3000) }
            } finally { $helper.Dispose() }
        }
    }
    exit 0
}
$active = [ResearchEmptyJob]::Run()
$admissionEvidence = if ($Admission) {
    [ResearchEmptyJob]::Admit($env:RESEARCH_NODE_EXECUTABLE, [bool]$Descendant, $env:RESEARCH_JOB_FIXTURE, [bool]$Deadline, [bool]$CloseJob, [bool]$ReceiptFault, [bool]$CrashHelper, $childEnvironment, [bool]$RootFailure, [bool]$RootTimeout, [bool]$QueryFault, [bool]$RunningQueryFault, [bool]$TerminationFault, [bool]$WorkloadTimeout, [bool]$ExplicitEnvironment)
} else { $null }
[ordered]@{
    result = 'PASS'
    powershell = $PSVersionTable.PSVersion.ToString()
    architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    assemblyLocation = [ResearchEmptyJob].Assembly.Location
    extendedLimitsSize = [Runtime.InteropServices.Marshal]::SizeOf([type][ResearchEmptyJob+ExtendedLimits])
    activeProcesses = $active
    admission = [bool]$Admission
    descendant = [bool]$Descendant
    deadline = [bool]$Deadline
    closeJob = [bool]$CloseJob
    receiptFault = [bool]$ReceiptFault
    admissionEvidence = $admissionEvidence
    checks = @('in-memory compilation', 'set and read kill-on-close', 'empty job accounting', 'owned handle closed')
} | ConvertTo-Json -Compress
} catch {
    $failure = $_.Exception
    $nativeCode = $null
    while ($null -ne $failure) {
        if ($failure -is [ComponentModel.Win32Exception]) {
            $nativeCode = $failure.NativeErrorCode
            break
        }
        $failure = $failure.InnerException
    }
    [ordered]@{ result='FAIL'; failureStage='native-execution';
        cleanupResult='UNVERIFIED'; nativeErrorCode=$nativeCode } | ConvertTo-Json -Compress
    exit 1
}
