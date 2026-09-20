using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Munder.WindowsOwnedPty
{
    public sealed class LaunchRequest
    {
        public string executablePath { get; set; }
        public string[] args { get; set; }
        public string cwd { get; set; }
        public Dictionary<string, string> env { get; set; }
        public int cols { get; set; }
        public int rows { get; set; }
        public int timeoutMs { get; set; }
        public int cleanupMs { get; set; }
        public string ioMode { get; set; } = "CONPTY";
    }

    public sealed class ExitReceipt
    {
        public int? rootPid { get; set; }
        public int? rootExit { get; set; }
        public bool rootJobMember { get; set; }
        public int? activeProcessesFinal { get; set; }
        public string cleanupState { get; set; } = "UNVERIFIED";
        public bool ioDrained { get; set; }
        public bool pseudoConsoleClosed { get; set; }
        public string ioMode { get; set; } = "CONPTY";
        public bool inputClosed { get; set; }
        public string reason { get; set; } = "launch-failure";
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public string error { get; set; }
    }

    public static class NativeHost
    {
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
        const uint STARTF_USESTDHANDLES = 0x00000100;
        const uint PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
        const uint PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
        const uint HANDLE_FLAG_INHERIT = 0x00000001;
        // Win32 error codes carried on the int error channel fed by Marshal.GetLastWin32Error().
        const int ERROR_INSUFFICIENT_BUFFER = 122;
        const int ERROR_BROKEN_PIPE = 109;
        const int ERROR_OPERATION_ABORTED = 995;
        const uint THREAD_TERMINATE = 0x0001;
        const uint WAIT_OBJECT_0 = 0;
        const int JobObjectBasicAccountingInformation = 1;
        const int JobObjectExtendedLimitInformation = 9;
        const int MaxControlLineBytes = 48 * 1024;
        const int MaxWriteBytes = 24 * 1024;
        const int MaxPendingCommands = 64;

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct BasicAccountingInformation
        {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            public int bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct Coord
        {
            public short X, Y;
            public Coord(short x, short y) { X = x; Y = y; }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfo
        {
            public uint cb;
            public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public ushort wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfoEx
        {
            public StartupInfo StartupInfo;
            public IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInformation
        {
            public IntPtr hProcess, hThread;
            public uint dwProcessId, dwThreadId;
        }

        sealed class ProtocolWriter
        {
            readonly Stream output;
            readonly object gate = new object();
            bool closed;

            public ProtocolWriter(Stream value) { output = value; }

            public void Send(object value)
            {
                byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value);
                lock (gate)
                {
                    if (closed) return;
                    output.Write(bytes, 0, bytes.Length);
                    output.WriteByte((byte)'\n');
                    output.Flush();
                }
            }

            public void Close()
            {
                lock (gate) { closed = true; }
            }
        }

        sealed class OutputDrain
        {
            readonly IntPtr handle;
            readonly ProtocolWriter protocol;
            readonly ManualResetEventSlim readerThreadReady = new ManualResetEventSlim(false);
            IntPtr readerThread;
            int cancelAttempts;
            int error;
            Task task;

            public OutputDrain(IntPtr value, ProtocolWriter writer)
            {
                handle = value;
                protocol = writer;
            }

            public bool Completed { get { return task != null && task.IsCompleted; } }
            public bool CancellationUsed { get { return Volatile.Read(ref cancelAttempts) != 0; } }
            public int Error { get { return Volatile.Read(ref error); } }

            public void Start()
            {
                task = Task.Factory.StartNew(ReadLoop, CancellationToken.None,
                    TaskCreationOptions.LongRunning, TaskScheduler.Default);
            }

            void ReadLoop()
            {
                readerThread = OpenThread(THREAD_TERMINATE, false, GetCurrentThreadId());
                if (readerThread == IntPtr.Zero) error = Marshal.GetLastWin32Error();
                readerThreadReady.Set();
                if (readerThread == IntPtr.Zero) return;
                byte[] buffer = new byte[4096];
                while (true)
                {
                    uint read;
                    if (!ReadFile(handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero))
                    {
                        int value = Marshal.GetLastWin32Error();
                        if (value != ERROR_BROKEN_PIPE) error = value;
                        return;
                    }
                    if (read == 0) return;
                    protocol.Send(new { type = "data", data = Convert.ToBase64String(buffer, 0, checked((int)read)) });
                }
            }

            public bool Wait(int milliseconds)
            {
                return task != null && task.Wait(milliseconds);
            }

            public bool StopReader(int milliseconds)
            {
                if (task == null || task.IsCompleted) return true;
                if (readerThreadReady.Wait(500) && readerThread != IntPtr.Zero)
                {
                    Interlocked.Increment(ref cancelAttempts);
                    if (!CancelSynchronousIo(readerThread))
                    {
                        int value = Marshal.GetLastWin32Error();
                        if (value != ERROR_OPERATION_ABORTED) error = value;
                    }
                }
                return task.Wait(milliseconds);
            }

            public void CloseReaderThread()
            {
                if (readerThread != IntPtr.Zero)
                {
                    CloseHandle(readerThread);
                    readerThread = IntPtr.Zero;
                }
            }
        }

        sealed class ControlState
        {
            public readonly object gate = new object();
            public readonly Queue<JsonElement> commands = new Queue<JsonElement>();
            public readonly AutoResetEvent available = new AutoResetEvent(false);
            public readonly ManualResetEvent stop = new ManualResetEvent(false);
            public string reason;
            public string error;
            public bool eof;
            public IntPtr inputWrite;
            public bool inputClosed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, ref ExtendedLimitInformation info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, out BasicAccountingInformation info, uint length, out uint returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SecurityAttributes attributes, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr pseudoConsole);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern int ResizePseudoConsole(IntPtr pseudoConsole, Coord size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern void ClosePseudoConsole(IntPtr pseudoConsole);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")]
        static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CreateProcessW(string application, [In, Out] StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
            IntPtr environment, string currentDirectory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool ReadFile(IntPtr file, byte[] buffer, uint count, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool WriteFile(IntPtr file, byte[] buffer, uint count, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CancelSynchronousIo(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenThread(uint access, bool inherit, uint threadId);
        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CloseHandle(IntPtr handle);

        static void Check(bool value, string stage)
        {
            if (!value) throw new Win32Exception(Marshal.GetLastWin32Error(), stage);
        }

        static void CheckHr(int value, string stage)
        {
            if (value != 0) throw new InvalidOperationException(stage + ": HRESULT=0x" + value.ToString("X8"));
        }

        static string QuoteArgument(string value)
        {
            if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid argument");
            StringBuilder result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value)
            {
                if (ch == '\\') { slashes++; continue; }
                if (ch == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(ch);
                slashes = 0;
            }
            result.Append('\\', slashes * 2);
            return result.Append('"').ToString();
        }

        static string BuildCommandLine(LaunchRequest launch)
        {
            StringBuilder result = new StringBuilder(QuoteArgument(launch.executablePath));
            foreach (string argument in launch.args)
            {
                result.Append(' ').Append(QuoteArgument(argument));
                if (result.Length > 32766) throw new ArgumentException("CreateProcess command line is too long");
            }
            return result.ToString();
        }

        static IntPtr BuildEnvironment(Dictionary<string, string> values)
        {
            List<KeyValuePair<string, string>> entries = new List<KeyValuePair<string, string>>(values);
            entries.Sort((left, right) => StringComparer.OrdinalIgnoreCase.Compare(left.Key, right.Key));
            HashSet<string> keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> entry in entries)
            {
                if (String.IsNullOrEmpty(entry.Key) || entry.Key.IndexOf('=') >= 0 || entry.Key.IndexOf('\0') >= 0 ||
                    entry.Value == null || entry.Value.IndexOf('\0') >= 0 || !keys.Add(entry.Key))
                    throw new ArgumentException("Invalid environment entry");
                block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
                if (block.Length > 128 * 1024) throw new ArgumentException("Environment block is too large");
            }
            block.Append('\0');
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        static string ReadBoundedLine(Stream input, int maximumBytes)
        {
            MemoryStream line = new MemoryStream();
            while (line.Length <= maximumBytes)
            {
                int value = input.ReadByte();
                if (value < 0) return line.Length == 0 ? null : Encoding.UTF8.GetString(line.ToArray());
                if (value == '\n') return Encoding.UTF8.GetString(line.ToArray()).TrimEnd('\r');
                line.WriteByte((byte)value);
            }
            throw new InvalidDataException("Control frame exceeds bounded size");
        }

        static void RequestStop(ControlState control, string reason, string error = null)
        {
            lock (control.gate)
            {
                if (control.reason == null)
                {
                    control.reason = reason;
                    control.error = error;
                }
            }
            control.stop.Set();
            control.available.Set();
        }

        static void ReadControls(Stream input, ControlState control)
        {
            try
            {
                while (!control.stop.WaitOne(0))
                {
                    string line = ReadBoundedLine(input, MaxControlLineBytes);
                    if (line == null)
                    {
                        control.eof = true;
                        RequestStop(control, "stop", "control input closed");
                        return;
                    }
                    if (line.Length == 0) continue;
                    using (JsonDocument document = JsonDocument.Parse(line))
                    {
                        JsonElement clone = document.RootElement.Clone();
                        lock (control.gate)
                        {
                            if (control.commands.Count >= MaxPendingCommands)
                            {
                                RequestStop(control, "helper-failure", "control queue exceeded bounded capacity");
                                return;
                            }
                            control.commands.Enqueue(clone);
                        }
                        control.available.Set();
                    }
                }
            }
            catch (Exception error)
            {
                RequestStop(control, "helper-failure", "control reader failed: " + error.Message);
            }
        }

        static bool TryTake(ControlState control, out JsonElement command)
        {
            lock (control.gate)
            {
                if (control.commands.Count != 0)
                {
                    command = control.commands.Dequeue();
                    return true;
                }
            }
            command = default(JsonElement);
            return false;
        }

        static void ProcessControls(ControlState control, IntPtr job, IntPtr inputWrite, IntPtr pseudoConsole, bool raw)
        {
            try
            {
                while (!control.stop.WaitOne(0))
                {
                    JsonElement command;
                    if (!TryTake(control, out command))
                    {
                        control.available.WaitOne(100);
                        continue;
                    }
                    JsonElement typeElement;
                    if (command.ValueKind != JsonValueKind.Object || !command.TryGetProperty("type", out typeElement) || typeElement.ValueKind != JsonValueKind.String)
                        throw new InvalidDataException("Invalid control frame");
                    string type = typeElement.GetString();
                    if (type == "stop")
                    {
                        RequestStop(control, "stop");
                        return;
                    }
                    if (type == "resize")
                    {
                        if (raw) throw new InvalidDataException("Resize is not supported for RAW_PIPE");
                        int cols = command.GetProperty("cols").GetInt32();
                        int rows = command.GetProperty("rows").GetInt32();
                        if (cols < 1 || cols > 32767 || rows < 1 || rows > 32767) throw new InvalidDataException("Invalid resize bounds");
                        CheckHr(ResizePseudoConsole(pseudoConsole, new Coord((short)cols, (short)rows)), "ResizePseudoConsole");
                        continue;
                    }
                    if (type == "close-input")
                    {
                        if (!raw || control.inputClosed) throw new InvalidDataException("Invalid input closure");
                        Check(CloseHandle(control.inputWrite), "Close input");
                        control.inputWrite = IntPtr.Zero;
                        control.inputClosed = true;
                        continue;
                    }
                    if (type == "write" || type == "input")
                    {
                        if ((type == "input") != raw || control.inputClosed) throw new InvalidDataException("Invalid input mode or closed input");
                        string encoded = command.GetProperty("data").GetString();
                        byte[] data = Convert.FromBase64String(encoded ?? "");
                        if (data.Length == 0 || data.Length > MaxWriteBytes) throw new InvalidDataException("Invalid write size");
                        uint written;
                        if (!WriteFile(inputWrite, data, (uint)data.Length, out written, IntPtr.Zero) || written != data.Length)
                            throw new Win32Exception(Marshal.GetLastWin32Error(), "WriteFile");
                        continue;
                    }
                    throw new InvalidDataException("Unknown control frame");
                }
            }
            catch (Exception error)
            {
                RequestStop(control, "helper-failure", "control processor failed: " + error.Message);
            }
        }

        static bool QueryActive(IntPtr job, out int active, out int error)
        {
            BasicAccountingInformation info;
            uint returned;
            bool okay = QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out info,
                (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)), out returned);
            if (!okay) { active = -1; error = Marshal.GetLastWin32Error(); return false; }
            if (returned != Marshal.SizeOf(typeof(BasicAccountingInformation))) { active = -1; error = ERROR_INSUFFICIENT_BUFFER; return false; }
            active = checked((int)info.ActiveProcesses);
            error = 0;
            return true;
        }

        static bool WaitActiveZero(IntPtr job, int milliseconds, out int active, out int error)
        {
            Stopwatch watch = Stopwatch.StartNew();
            do
            {
                if (!QueryActive(job, out active, out error)) return false;
                if (active == 0) return true;
                Thread.Sleep(20);
            } while (watch.ElapsedMilliseconds < milliseconds);
            return QueryActive(job, out active, out error) && active == 0;
        }

        static void CloseOwned(ref IntPtr handle)
        {
            if (handle == IntPtr.Zero) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        public static void Run(LaunchRequest launch, Stream controlInput, Stream protocolOutput)
        {
            ProtocolWriter protocol = new ProtocolWriter(protocolOutput);
            ExitReceipt receipt = new ExitReceipt();
            IntPtr job = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero;
            IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, pseudoConsole = IntPtr.Zero;
            IntPtr attributes = IntPtr.Zero, jobValue = IntPtr.Zero, environment = IntPtr.Zero, inheritedHandles = IntPtr.Zero;
            bool attributesInitialized = false;
            ProcessInformation process = new ProcessInformation();
            OutputDrain drain = null;
            ControlState control = new ControlState();
            Task controlReader = null, controlProcessor = null;
            bool processCreated = false;
            try
            {
                if (launch == null || launch.args == null || launch.env == null || launch.args.Length > 256 || launch.env.Count > 512 ||
                    launch.cols < 1 || launch.rows < 1 || launch.cols > 32767 || launch.rows > 32767 ||
                    launch.timeoutMs < 100 || launch.timeoutMs > 86400000 || launch.cleanupMs < 100 || launch.cleanupMs > 60000)
                    throw new ArgumentException("Invalid native launch request");
                if (launch.ioMode != "CONPTY" && launch.ioMode != "RAW_PIPE") throw new ArgumentException("Invalid I/O mode");
                receipt.ioMode = launch.ioMode;
                string commandLine = BuildCommandLine(launch);
                environment = BuildEnvironment(launch.env);

                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW");
                ExtendedLimitInformation limits = new ExtendedLimitInformation();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits,
                    (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))), "SetInformationJobObject");

                SecurityAttributes security = new SecurityAttributes { nLength = Marshal.SizeOf(typeof(SecurityAttributes)), bInheritHandle = 1 };
                Check(CreatePipe(out inputRead, out inputWrite, ref security, 0), "CreatePipe input");
                Check(CreatePipe(out outputRead, out outputWrite, ref security, 0), "CreatePipe output");
                Check(SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation input");
                Check(SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0), "SetHandleInformation output");
                bool raw = launch.ioMode == "RAW_PIPE";
                if (!raw) CheckHr(CreatePseudoConsole(new Coord((short)launch.cols, (short)launch.rows), inputRead, outputWrite, 0, out pseudoConsole), "CreatePseudoConsole");

                IntPtr attributeSize = IntPtr.Zero;
                bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeSize);
                if (sizing || Marshal.GetLastWin32Error() != ERROR_INSUFFICIENT_BUFFER || attributeSize == IntPtr.Zero)
                    throw new InvalidOperationException("STARTUPINFOEX attribute sizing failed");
                if (attributeSize.ToInt64() > Int32.MaxValue) throw new InvalidOperationException("STARTUPINFOEX attribute list is too large");
                attributes = Marshal.AllocHGlobal(attributeSize.ToInt32());
                Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref attributeSize), "InitializeProcThreadAttributeList");
                attributesInitialized = true;
                if (!raw) Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE),
                    pseudoConsole, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute PSEUDOCONSOLE");
                jobValue = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobValue, job);
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_JOB_LIST),
                    jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute JOB_LIST");

                StartupInfoEx startup = new StartupInfoEx();
                startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
                startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                startup.lpAttributeList = attributes;
                if (raw)
                {
                    startup.StartupInfo.hStdInput = inputRead;
                    startup.StartupInfo.hStdOutput = outputWrite;
                    startup.StartupInfo.hStdError = outputWrite;
                }
                if (raw)
                {
                    inheritedHandles = Marshal.AllocHGlobal(IntPtr.Size * 2);
                    Marshal.WriteIntPtr(inheritedHandles, inputRead);
                    Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size, outputWrite);
                    Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST),
                        inheritedHandles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute HANDLE_LIST");
                }
                StringBuilder mutableCommandLine = new StringBuilder(commandLine);
                Check(CreateProcessW(launch.executablePath, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, raw,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, environment, launch.cwd,
                    ref startup, out process), "CreateProcessW");
                processCreated = true;
                CloseOwned(ref inputRead);
                CloseOwned(ref outputWrite);
                CloseOwned(ref process.hThread);

                receipt.rootPid = checked((int)process.dwProcessId);
                bool member;
                Check(IsProcessInJob(process.hProcess, job, out member), "IsProcessInJob");
                receipt.rootJobMember = member;
                if (!member) throw new InvalidOperationException("Root process is not a creation-time Job member");

                drain = new OutputDrain(outputRead, protocol);
                drain.Start();
                protocol.Send(new { type = "started", pid = receipt.rootPid.Value });
                controlReader = Task.Factory.StartNew(() => ReadControls(controlInput, control), CancellationToken.None,
                    TaskCreationOptions.LongRunning, TaskScheduler.Default);
                control.inputWrite = inputWrite;
                inputWrite = IntPtr.Zero;
                controlProcessor = Task.Factory.StartNew(() => ProcessControls(control, job, control.inputWrite, pseudoConsole, raw), CancellationToken.None,
                    TaskCreationOptions.LongRunning, TaskScheduler.Default);

                Stopwatch lifetime = Stopwatch.StartNew();
                while (true)
                {
                    if (control.stop.WaitOne(0)) break;
                    int active, queryError;
                    if (!QueryActive(job, out active, out queryError))
                    {
                        RequestStop(control, "helper-failure", "QueryInformationJobObject failed: " + queryError);
                        break;
                    }
                    if (active == 0) { receipt.reason = "exit"; break; }
                    if (lifetime.ElapsedMilliseconds >= launch.timeoutMs)
                    {
                        RequestStop(control, "timeout");
                        break;
                    }
                    Thread.Sleep(20);
                }

                if (control.reason != null)
                {
                    receipt.reason = control.reason;
                    receipt.error = control.error;
                    if (!TerminateJobObject(job, 0xE0010001))
                    {
                        receipt.reason = "helper-failure";
                        receipt.error = "TerminateJobObject failed: " + Marshal.GetLastWin32Error();
                    }
                }

                int finalActive, finalError;
                if (WaitActiveZero(job, launch.cleanupMs, out finalActive, out finalError))
                {
                    receipt.activeProcessesFinal = finalActive;
                    receipt.cleanupState = "VERIFIED_EMPTY";
                }
                else
                {
                    receipt.activeProcessesFinal = finalActive < 0 ? (int?)null : finalActive;
                    receipt.cleanupState = "UNVERIFIED";
                    if (receipt.error == null) receipt.error = "Job cleanup was not verified empty" + (finalError == 0 ? "" : ": " + finalError);
                }

                if (WaitForSingleObject(process.hProcess, 0) == WAIT_OBJECT_0)
                {
                    uint exitCode;
                    if (GetExitCodeProcess(process.hProcess, out exitCode)) receipt.rootExit = unchecked((int)exitCode);
                }
            }
            catch (Exception error)
            {
                receipt.reason = processCreated ? "helper-failure" : "launch-failure";
                receipt.error = error.Message;
                if (job != IntPtr.Zero) TerminateJobObject(job, 0xE0010001);
                if (job != IntPtr.Zero)
                {
                    int active, queryError;
                    if (WaitActiveZero(job, Math.Max(100, launch == null ? 1000 : launch.cleanupMs), out active, out queryError))
                    {
                        receipt.activeProcessesFinal = active;
                        receipt.cleanupState = "VERIFIED_EMPTY";
                    }
                }
            }
            finally
            {
                control.stop.Set();
                control.available.Set();
                if (pseudoConsole != IntPtr.Zero)
                {
                    ClosePseudoConsole(pseudoConsole);
                    pseudoConsole = IntPtr.Zero;
                    receipt.pseudoConsoleClosed = true;
                }
                // Job termination releases a blocked pipe writer before its owned handle is closed.
                bool processorStopped = controlProcessor == null || controlProcessor.Wait(Math.Max(100, launch.cleanupMs));
                if (processorStopped)
                {
                    if (control.inputWrite != IntPtr.Zero)
                    {
                        bool closed = CloseHandle(control.inputWrite);
                        control.inputWrite = IntPtr.Zero;
                        control.inputClosed = closed;
                    }
                    receipt.inputClosed = receipt.ioMode == "RAW_PIPE" && control.inputClosed;
                }
                CloseOwned(ref inputWrite);
                if (drain != null)
                {
                    int drainWait = launch == null ? 1000 : Math.Max(100, launch.cleanupMs);
                    bool completed = drain.Wait(drainWait);
                    if (!completed) completed = drain.StopReader(Math.Min(drainWait, 1500));
                    receipt.ioDrained = completed && !drain.CancellationUsed && drain.Error == 0;
                    if (completed)
                    {
                        CloseOwned(ref outputRead);
                        drain.CloseReaderThread();
                    }
                }
                else CloseOwned(ref outputRead);
                CloseOwned(ref inputRead);
                CloseOwned(ref outputWrite);
                CloseOwned(ref process.hThread);
                CloseOwned(ref process.hProcess);
                if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
                if (inheritedHandles != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandles);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                CloseOwned(ref job);
                try { protocol.Send(new { type = "exit", receipt = receipt }); } catch { }
                protocol.Close();
            }
        }
    }
}
