using System;
using System.CodeDom.Compiler;
using Microsoft.CSharp;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;

public static class WindowsWfpLocalhostPoc
{
    // Windows SDK ABI, x64 only. FWP_VALUE0/CONDITION_VALUE0 are 16-byte tagged unions.
    [StructLayout(LayoutKind.Explicit, Size = 16)] public struct Value { [FieldOffset(0)] public uint type; [FieldOffset(8)] public IntPtr pointer; [FieldOffset(8)] public uint u32; [FieldOffset(8)] public ushort u16; [FieldOffset(8)] public byte u8; }
    [StructLayout(LayoutKind.Sequential)] public struct Display { public IntPtr name, description; }
    [StructLayout(LayoutKind.Sequential)] public struct Blob { public uint size; public IntPtr data; }
    [StructLayout(LayoutKind.Sequential)] public struct Session { public Guid key; public Display display; public uint flags, timeout, pid; public IntPtr sid, username; public int kernel; }
    [StructLayout(LayoutKind.Sequential)] public struct Sublayer { public Guid key; public Display display; public uint flags; public IntPtr provider; public Blob providerData; public ushort weight; }
    [StructLayout(LayoutKind.Sequential)] public struct Condition { public Guid field; public uint match; public Value value; }
    [StructLayout(LayoutKind.Sequential)] public struct Action { public uint type; public Guid key; }
    [StructLayout(LayoutKind.Explicit, Size = 200)] public struct Filter
    {
        [FieldOffset(0)] public Guid key; [FieldOffset(16)] public Display display; [FieldOffset(32)] public uint flags;
        [FieldOffset(40)] public IntPtr provider; [FieldOffset(48)] public Blob providerData; [FieldOffset(64)] public Guid layer;
        [FieldOffset(80)] public Guid sublayer; [FieldOffset(96)] public Value weight; [FieldOffset(112)] public uint count;
        [FieldOffset(120)] public IntPtr conditions; [FieldOffset(128)] public Action action;
        [FieldOffset(152)] public ulong context; [FieldOffset(168)] public IntPtr reserved;
        [FieldOffset(176)] public ulong id; [FieldOffset(184)] public Value effectiveWeight;
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetDefaultDllDirectories(uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetDllDirectoryW(string path);
    // Explicit type initialization runs before Main and before any WFP/network work.
    static WindowsWfpLocalhostPoc()
    {
        if (!SetDefaultDllDirectories(0x00000800) || !SetDllDirectoryW("")) throw new InvalidOperationException("Safe system-only DLL search initialization failed");
        V4 = new Guid("c38d57d1-05a7-4c33-904f-7fbceee60e82"); V6 = new Guid("4a72393b-319f-44bc-84c3-ba54dcb3b6b4");
        App = new Guid("d78e1e87-8644-4ea5-9437-d809ecefc971"); Protocol = new Guid("3971ef2b-623e-4f9a-8cb1-6e79b806b9a7"); Address = new Guid("b235ae9a-1d64-49b8-a44c-5ff3d9095045"); Port = new Guid("c35a604d-d22b-4e1a-91b4-68f674ee674b");
        Json = new JavaScriptSerializer { MaxJsonLength = 262144 };
    }
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)] static extern uint FwpmEngineOpen0(string server, uint auth, IntPtr identity, ref Session session, out IntPtr engine);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineClose0(IntPtr engine);
    // FWPM_SESSION0 is queried through the session enumeration API; there is no session GetByKey import.
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSessionCreateEnumHandle0(IntPtr engine, IntPtr template, out IntPtr handle);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSessionEnum0(IntPtr engine, IntPtr handle, uint count, out IntPtr entries, out uint returned);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSessionDestroyEnumHandle0(IntPtr engine, IntPtr handle);
    [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)] static extern uint FwpmGetAppIdFromFileName0(string file, out IntPtr blob);
    [DllImport("fwpuclnt.dll")] static extern void FwpmFreeMemory0(ref IntPtr memory);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerAdd0(IntPtr engine, ref Sublayer layer, IntPtr security);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerGetByKey0(IntPtr engine, ref Guid key, out IntPtr layer);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterAdd0(IntPtr engine, ref Filter filter, IntPtr security, out ulong id);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterGetByKey0(IntPtr engine, ref Guid key, out IntPtr filter);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterCreateEnumHandle0(IntPtr engine, IntPtr template, out IntPtr handle);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterEnum0(IntPtr engine, IntPtr handle, uint count, out IntPtr entries, out uint returned);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterDestroyEnumHandle0(IntPtr engine, IntPtr handle);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerCreateEnumHandle0(IntPtr engine, IntPtr template, out IntPtr handle);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerEnum0(IntPtr engine, IntPtr handle, uint count, out IntPtr entries, out uint returned);
    [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerDestroyEnumHandle0(IntPtr engine, IntPtr handle);
    static readonly Guid V4, V6, App, Protocol, Address, Port;
    static readonly JavaScriptSerializer Json;
    const int DisplayNameLimit = 128;
    const string SessionName = "Munder WFP localhost proof session";
    const string CleanupSessionName = "Munder WFP localhost cleanup query session";
    const string SublayerName = "Munder WFP localhost proof sublayer";
    const string V4PermitName = "Munder WFP localhost V4 permit";
    const string V4BlockName = "Munder WFP localhost V4 catch-all block";
    const string V6BlockName = "Munder WFP localhost V6 catch-all block";
    sealed class NativeDisplay : IDisposable
    {
        public readonly Display Value;
        public NativeDisplay(string name)
        {
            Require(!String.IsNullOrEmpty(name) && name.Length <= DisplayNameLimit, "Display name length bound");
            Value = new Display { name = Marshal.StringToHGlobalUni(name) };
        }
        public void Dispose() { Marshal.FreeHGlobal(Value.name); }
    }
    static void AssertDisplay(Display display, string expected)
    {
        Require(display.name != IntPtr.Zero && !String.IsNullOrEmpty(expected) && expected.Length <= DisplayNameLimit, "Non-null bounded display name required");
        Require(Marshal.PtrToStringUni(display.name) == expected, "Display name mismatch");
    }
    static void OpenSession(ref Session session, string name, string role, out IntPtr engine)
    {
        using (NativeDisplay display = new NativeDisplay(name))
        {
            session.display = display.Value;
            try
            {
                AssertDisplay(session.display, name);
                Check(FwpmEngineOpen0(null, 10, IntPtr.Zero, ref session, out engine), "FwpmEngineOpen0", role, session.key);
            }
            finally { session.display = new Display(); }
        }
    }
    sealed class WfpException : Exception
    {
        public readonly uint Code;
        public readonly string Api, Role;
        public readonly Guid ObjectKey;
        public WfpException(uint code, string api, string role, Guid objectKey) : base("WFP:0x" + code.ToString("X8")) { Code = code; Api = api; Role = role; ObjectKey = objectKey; }
    }
    static void Check(uint code) { Check(code, "UNSPECIFIED", "query-or-enumeration", Guid.Empty); }
    static void Check(uint code, string api, string role, Guid objectKey) { if (code != 0) throw new WfpException(code, api, role, objectKey); }
    static string Hash(string file) { using (SHA256 h = SHA256.Create()) using (FileStream s = File.OpenRead(file)) return BitConverter.ToString(h.ComputeHash(s)).Replace("-", "").ToLowerInvariant(); }
    static void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
    static void NoLinks(string path)
    {
        for (string p = path; !String.IsNullOrEmpty(p); p = Path.GetDirectoryName(p)) Require((File.GetAttributes(p) & FileAttributes.ReparsePoint) == 0, "Reparse point rejected");
    }
    static Value Number(uint type, uint value) { return new Value { type = type, u32 = value }; }
    static Condition C(Guid field, Value value) { return new Condition { field = field, match = 0, value = value }; }
    static byte[] Bytes(IntPtr pointer)
    {
        Blob b = (Blob)Marshal.PtrToStructure(pointer, typeof(Blob)); Require(b.size > 0 && b.size <= 65536, "Invalid app ID size");
        byte[] result = new byte[b.size]; Marshal.Copy(b.data, result, 0, result.Length); return result;
    }
    static void CompileFixture(string fixture, string executable)
    {
        Require(!File.Exists(executable), "Prepare cannot overwrite an executable");
        using (CSharpCodeProvider compiler = new CSharpCodeProvider())
        {
            CompilerParameters parameters = new CompilerParameters(new string[] { "System.dll", "System.Web.Extensions.dll" }, executable);
            parameters.GenerateExecutable = true; parameters.GenerateInMemory = false; parameters.CompilerOptions = "/platform:x64 /optimize+";
            parameters.TempFiles = new TempFileCollection(Path.GetDirectoryName(executable), true);
            CompilerResults result = compiler.CompileAssemblyFromFile(parameters, fixture);
            List<string> errors = new List<string>(); foreach (CompilerError error in result.Errors) if (!error.IsWarning && errors.Count < 16) errors.Add(error.ToString());
            Require(result.NativeCompilerReturnValue == 0 && !result.Errors.HasErrors, "Fixture compilation failed: " + String.Join("; ", errors.ToArray()));
        }
    }
    static bool Equal(byte[] a, byte[] b) { if (a.Length != b.Length) return false; for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false; return true; }
    static object QuerySession(IntPtr engine, Guid key, string expectedName)
    {
        IntPtr handle; Check(FwpmSessionCreateEnumHandle0(engine, IntPtr.Zero, out handle));
        try
        {
            for (int page = 0; page < 1024; page++)
            {
                IntPtr entries = IntPtr.Zero; uint count;
                try
                {
                    Check(FwpmSessionEnum0(engine, handle, 128, out entries, out count));
                    Require(count <= 128, "Session enumeration count bound");
                    for (int i = 0; i < count; i++)
                    {
                        Session actual = (Session)Marshal.PtrToStructure(Marshal.ReadIntPtr(entries, i * IntPtr.Size), typeof(Session));
                        if (actual.key != key) continue;
                        Require(actual.flags == 1 && actual.pid == (uint)Process.GetCurrentProcess().Id && actual.kernel == 0, "Dynamic session query mismatch");
                        AssertDisplay(actual.display, expectedName);
                        return new { status = "MATCH", source = "FwpmSessionEnum0", key = actual.key, displayName = expectedName, flags = actual.flags, processId = actual.pid, kernelMode = actual.kernel };
                    }
                    Require(count != 0, "Dynamic session not found; query UNKNOWN");
                }
                finally { if (entries != IntPtr.Zero) FwpmFreeMemory0(ref entries); }
            }
            throw new InvalidOperationException("Session enumeration bound exhausted; query UNKNOWN");
        }
        finally { Check(FwpmSessionDestroyEnumHandle0(engine, handle)); }
    }
    static object Install(IntPtr engine, Guid sub, Guid key, Guid layer, bool permit, ushort port, IntPtr app)
    {
        string name = permit ? V4PermitName : layer == V4 ? V4BlockName : V6BlockName;
        string role = permit ? "v4-permit" : layer == V4 ? "v4-catch-all-block" : "v6-catch-all-block";
        Condition[] conditions = permit ? new Condition[] { C(App, new Value { type = 12, pointer = app }), C(Protocol, Number(1, 6)), C(Address, Number(3, 0x7f000001)), C(Port, Number(2, port)) } : new Condition[] { C(App, new Value { type = 12, pointer = app }) };
        int size = Marshal.SizeOf(typeof(Condition)); IntPtr block = Marshal.AllocHGlobal(size * conditions.Length);
        // The condition buffer and UTF-16 name remain owned until add/query completes.
        try
        {
            using (NativeDisplay display = new NativeDisplay(name))
            {
            for (int i = 0; i < conditions.Length; i++) Marshal.StructureToPtr(conditions[i], IntPtr.Add(block, i * size), false);
            Filter wanted = new Filter { key = key, display = display.Value, layer = layer, sublayer = sub, weight = Number(1, permit ? 15U : 1U), count = (uint)conditions.Length, conditions = block, action = new Action { type = permit ? 0x1002U : 0x1001U } };
            ulong id;
            AssertDisplay(wanted.display, name);
            Check(FwpmFilterAdd0(engine, ref wanted, IntPtr.Zero, out id), "FwpmFilterAdd0", role, key); IntPtr queried = IntPtr.Zero;
            try
            {
                Check(FwpmFilterGetByKey0(engine, ref key, out queried)); Filter got = (Filter)Marshal.PtrToStructure(queried, typeof(Filter));
                Require(got.key == key && got.layer == layer && got.sublayer == sub && got.flags == 0 && got.provider == IntPtr.Zero && got.providerData.size == 0 && got.id == id && got.action.type == wanted.action.type && got.weight.type == 1 && got.weight.u8 == wanted.weight.u8 && got.count == conditions.Length, "Filter query mismatch");
                AssertDisplay(got.display, name);
                List<object> evidence = new List<object>();
                for (int i = 0; i < conditions.Length; i++)
                {
                    Condition actual = (Condition)Marshal.PtrToStructure(IntPtr.Add(got.conditions, i * size), typeof(Condition)); Condition expected = conditions[i];
                    Require(actual.field == expected.field && actual.match == 0 && actual.value.type == expected.value.type, "Condition query mismatch");
                    if (actual.field == App) Require(Equal(Bytes(actual.value.pointer), Bytes(app)), "App ID query mismatch");
                    else Require(actual.value.u32 == expected.value.u32, "Condition value mismatch");
                    evidence.Add(new { field = actual.field, match = actual.match, type = actual.value.type, value = actual.field == App ? Convert.ToBase64String(Bytes(actual.value.pointer)) : actual.value.u32.ToString() });
                }
                Require(got.effectiveWeight.type == 4, "Effective weight type mismatch");
                return new { key = key, displayName = name, id = id.ToString(), layer = got.layer, sublayer = got.sublayer, action = got.action.type, weight = got.weight.u8, effectiveWeight = unchecked((ulong)Marshal.ReadInt64(got.effectiveWeight.pointer)).ToString(), conditions = evidence, query = "MATCH" };
            }
            finally { if (queried != IntPtr.Zero) FwpmFreeMemory0(ref queried); }
            }
        }
        finally { Marshal.FreeHGlobal(block); }
    }
    static object Absence(Guid sub, Guid[] keys, out int remaining)
    {
        remaining = -1;
        Session session = new Session { key = Guid.NewGuid(), flags = 1 }; IntPtr engine = IntPtr.Zero;
        int filters = 0, sublayers = 0, found = 0;
        try
        {
            OpenSession(ref session, CleanupSessionName, "cleanup-query-session", out engine);
            object sessionQuery = QuerySession(engine, session.key, CleanupSessionName);
            for (int kind = 0; kind < 2; kind++)
            {
                IntPtr handle; Check(kind == 0 ? FwpmFilterCreateEnumHandle0(engine, IntPtr.Zero, out handle) : FwpmSubLayerCreateEnumHandle0(engine, IntPtr.Zero, out handle));
                try
                {
                    bool exhausted = false;
                    for (int page = 0; page < 1024; page++)
                    {
                        IntPtr entries = IntPtr.Zero; uint count;
                        try
                        {
                            Check(kind == 0 ? FwpmFilterEnum0(engine, handle, 128, out entries, out count) : FwpmSubLayerEnum0(engine, handle, 128, out entries, out count));
                            Require(count <= 128, "Enumeration count bound");
                            for (int i = 0; i < count; i++)
                            {
                                IntPtr p = Marshal.ReadIntPtr(entries, i * IntPtr.Size);
                                if (kind == 0) { Filter f = (Filter)Marshal.PtrToStructure(p, typeof(Filter)); filters++; if (f.sublayer == sub || Array.IndexOf(keys, f.key) >= 0) found++; }
                                else { Sublayer s = (Sublayer)Marshal.PtrToStructure(p, typeof(Sublayer)); sublayers++; if (s.key == sub) found++; }
                            }
                            if (count == 0) { exhausted = true; break; }
                        }
                        finally { if (entries != IntPtr.Zero) FwpmFreeMemory0(ref entries); }
                    }
                    Require(exhausted, "Enumeration bound exhausted; absence UNKNOWN");
                }
                finally { Check(kind == 0 ? FwpmFilterDestroyEnumHandle0(engine, handle) : FwpmSubLayerDestroyEnumHandle0(engine, handle)); }
            }
            remaining = found;
            return new { status = found == 0 ? "ABSENT" : "OBJECTS_REMAIN", enumerationComplete = true, remaining = found, filtersEnumerated = filters, sublayersEnumerated = sublayers, independentSession = session.key, sessionQuery = sessionQuery };
        }
        finally { if (engine != IntPtr.Zero) Check(FwpmEngineClose0(engine)); }
    }
    static Dictionary<string, object> Target(string executable, string protocol, IPAddress address, int port, Guid nonce)
    {
        ProcessStartInfo info = new ProcessStartInfo(executable, protocol + " " + address + " " + port + " " + nonce.ToString("D"));
        info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.WorkingDirectory = Path.GetDirectoryName(executable);
        info.EnvironmentVariables.Clear(); info.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot"); info.EnvironmentVariables["TEMP"] = info.WorkingDirectory; info.EnvironmentVariables["TMP"] = info.WorkingDirectory;
        using (Process process = Process.Start(info))
        {
            // The frozen, repository-owned fixture emits a single bounded JSON line, not an arbitrary program.
            if (!process.WaitForExit(5000)) { process.Kill(); Require(process.WaitForExit(2000), "Target termination UNKNOWN"); throw new TimeoutException("Target process deadline"); }
            string output = process.StandardOutput.ReadToEnd(), error = process.StandardError.ReadToEnd();
            Require(process.ExitCode == 0 && output.Length <= 4096 && error.Length == 0, "Target output/exit mismatch");
            Dictionary<string, object> result = Json.Deserialize<Dictionary<string, object>>(output);
            Require((string)result["schema"] == "wfp-local-target" && (string)result["protocol"] == protocol && (string)result["address"] == address.ToString() && Convert.ToInt32(result["port"]) == port && (string)result["nonce"] == nonce.ToString("D"), "Target receipt identity mismatch");
            return result;
        }
    }
    static object TcpRow(string executable, TcpListener listener, bool allowed, string label)
    {
        IPEndPoint endpoint = (IPEndPoint)listener.LocalEndpoint;
        using (Socket control = new Socket(endpoint.AddressFamily, SocketType.Stream, ProtocolType.Tcp))
        {
            IAsyncResult pending = control.BeginConnect(endpoint, null, null);
            using (WaitHandle wait = pending.AsyncWaitHandle) Require(wait.WaitOne(1500), "Control timeout"); control.EndConnect(pending);
            Require(listener.Pending(), "Control not observed"); using (Socket accepted = listener.AcceptSocket()) { }
        }
        Dictionary<string, object> target = Target(executable, "tcp", endpoint.Address, endpoint.Port, Guid.NewGuid());
        bool observed = listener.Pending(); if (observed) using (Socket accepted = listener.AcceptSocket()) { }
        bool connected = (string)target["outcome"] == "CONNECTED";
        // Timeouts are not explicit denials and cannot establish the requested proof.
        bool denied = (string)target["outcome"] == "SOCKET_ERROR" && Convert.ToInt32(target["socketError"]) == (int)SocketError.AccessDenied;
        return new { label = label, address = endpoint.Address.ToString(), port = endpoint.Port, control = "CONNECTED_AND_ACCEPTED", target = target, receiverObserved = observed, pass = allowed ? connected && observed : denied && !observed };
    }
    static bool Receive(UdpClient receiver, Guid nonce)
    {
        receiver.Client.ReceiveTimeout = 1000; IPEndPoint sender = new IPEndPoint(IPAddress.Any, 0);
        try { byte[] bytes = receiver.Receive(ref sender); Require(Equal(bytes, nonce.ToByteArray()) && IPAddress.IsLoopback(sender.Address), "Unexpected UDP datagram; observation UNKNOWN"); return true; }
        catch (SocketException ex) { if (ex.SocketErrorCode == SocketError.TimedOut) return false; throw; }
    }
    static object UdpRow(string executable, UdpClient receiver)
    {
        IPEndPoint endpoint = (IPEndPoint)receiver.Client.LocalEndPoint; Guid before = Guid.NewGuid();
        using (UdpClient control = new UdpClient(AddressFamily.InterNetwork)) control.Send(before.ToByteArray(), 16, endpoint);
        Require(Receive(receiver, before), "UDP pre-control unobserved"); Guid targetNonce = Guid.NewGuid();
        Dictionary<string, object> target = Target(executable, "udp", endpoint.Address, endpoint.Port, targetNonce); bool observed = Receive(receiver, targetNonce);
        Guid after = Guid.NewGuid(); using (UdpClient control = new UdpClient(AddressFamily.InterNetwork)) control.Send(after.ToByteArray(), 16, endpoint);
        bool healthy = Receive(receiver, after); Require(healthy, "UDP post-control unobserved");
        return new { label = "udp-disallowed", address = endpoint.Address.ToString(), port = endpoint.Port, controlBefore = true, controlAfter = healthy, target = target, receiverObserved = observed, observationMilliseconds = 1000, pass = !observed && ((string)target["outcome"] == "SENT" || ((string)target["outcome"] == "SOCKET_ERROR" && Convert.ToInt32(target["socketError"]) == (int)SocketError.AccessDenied)) };
    }
    public static int Main(string[] args)
    {
        Dictionary<string, object> receipt = new Dictionary<string, object>(); receipt["schema"] = "wfp-localhost-proof"; receipt["version"] = 1; receipt["DNS_SERVICE_DELEGATION_CONTAINMENT"] = "UNKNOWN"; receipt["classification"] = "UNKNOWN"; receipt["cleanup"] = "NOT_OPENED";
        IntPtr engine = IntPtr.Zero, app = IntPtr.Zero; Guid sub = Guid.NewGuid(); Guid[] keys = { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() }; List<TcpListener> listeners = new List<TcpListener>(); UdpClient udp = null; bool installPhase = false, liveAttempted = false, elevationRequired = false;
        FileStream frozenProbe = null;
        bool elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        try
        {
            Require(IntPtr.Size == 8, "x64 required");
            bool preparing = args.Length == 1 && args[0] == "--prepare";
            Require(preparing || (args.Length == 3 && (args[0] == "--static" || args[0] == "--live") && System.Text.RegularExpressions.Regex.IsMatch(args[1], "^[0-9a-f]{64}$") && System.Text.RegularExpressions.Regex.IsMatch(args[2], "^[0-9a-f]{64}$")), "Strict syntax: --prepare OR --static|--live controller-sha256 probe-sha256");
            bool live = !preparing && args[0] == "--live";
            string controller = Path.GetFullPath(typeof(WindowsWfpLocalhostPoc).Assembly.Location), run = Path.GetDirectoryName(controller);
            string executable = Path.Combine(run, "WfpEgressProbe.exe"), fixture = null;
            Require(Path.GetFileName(controller) == "WindowsWfpLocalhostPoc.exe", "Exact controller name required");
            NoLinks(controller);
            if (!live)
            {
                string root = Path.GetDirectoryName(Path.GetDirectoryName(run));
                fixture = Path.Combine(root, "test", "fixtures", "wfp-egress-probe.cs");
                Require(Path.GetFileName(Path.GetDirectoryName(run)) == ".tmp" && Path.GetFileName(run).StartsWith("windows-wfp-localhost-poc-", StringComparison.Ordinal) && File.Exists(Path.Combine(root, "src", "main", "windowsWfpLocalhostPoc.cs")) && File.Exists(fixture), "Repository-owned invocation required");
                NoLinks(fixture);
                if (preparing) { Require(!elevated, "Prepare requires non-admin"); CompileFixture(fixture, executable); }
            }
            NoLinks(executable);
            frozenProbe = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (!preparing) Require(Hash(controller) == args[1] && Hash(executable) == args[2], "Frozen image mismatch");
            receipt["identity"] = live ? (object)new { controller = controller, controllerSha256 = Hash(controller), probe = executable, probeSha256 = Hash(executable) } : new { controller = controller, controllerSha256 = Hash(controller), probe = executable, probeSha256 = Hash(executable), fixture = fixture, fixtureSha256 = Hash(fixture) };
            Require(Marshal.SizeOf(typeof(Filter)) == 200 && Marshal.SizeOf(typeof(Condition)) == 40 && Marshal.SizeOf(typeof(Sublayer)) == 72 && Marshal.SizeOf(typeof(Session)) == 72, "ABI size mismatch");
            receipt["representation"] = new { pointerSize = IntPtr.Size, filterSize = 200, conditionSize = 40, sublayerSize = 72, sessionSize = 72 };
            if (preparing || args[0] == "--static") { Require(!elevated, "Static mode requires non-admin"); receipt["classification"] = "STATIC_ONLY_NO_WFP_NO_NETWORK"; }
            else
            {
                Session session = new Session { key = Guid.NewGuid(), flags = 1 }; receipt["objects"] = new { session = session.key, sublayer = sub, filters = keys };
                receipt["sessionQuery"] = new { status = "UNKNOWN" };
                liveAttempted = true; installPhase = true; OpenSession(ref session, SessionName, "proof-session", out engine);
                receipt["sessionQuery"] = QuerySession(engine, session.key, SessionName);
                Check(FwpmGetAppIdFromFileName0(executable, out app)); byte[] appBytes = Bytes(app); receipt["appIdBase64"] = Convert.ToBase64String(appBytes);
                using (SHA256 digest = SHA256.Create()) receipt["appIdSha256"] = BitConverter.ToString(digest.ComputeHash(appBytes)).Replace("-", "").ToLowerInvariant();
                Sublayer layer = new Sublayer { key = sub, weight = 0x100 };
                using (NativeDisplay display = new NativeDisplay(SublayerName))
                {
                    layer.display = display.Value;
                    try
                    {
                        AssertDisplay(layer.display, SublayerName);
                        Check(FwpmSubLayerAdd0(engine, ref layer, IntPtr.Zero), "FwpmSubLayerAdd0", "proof-sublayer", sub);
                    }
                    finally { layer.display = new Display(); }
                }
                IntPtr query = IntPtr.Zero;
                try { Check(FwpmSubLayerGetByKey0(engine, ref sub, out query)); Sublayer actual = (Sublayer)Marshal.PtrToStructure(query, typeof(Sublayer)); Require(actual.key == sub && actual.flags == 0 && actual.provider == IntPtr.Zero && actual.providerData.size == 0 && actual.weight == layer.weight, "Sublayer query mismatch"); AssertDisplay(actual.display, SublayerName); receipt["sublayerQuery"] = "MATCH"; receipt["sublayerDisplayName"] = SublayerName; }
                finally { if (query != IntPtr.Zero) FwpmFreeMemory0(ref query); }
                IPAddress local = null; string nicId = null;
                foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces()) if (nic.OperationalStatus == OperationalStatus.Up)
                    foreach (UnicastIPAddressInformation address in nic.GetIPProperties().UnicastAddresses)
                        if (local == null && address.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address.Address) && !address.Address.Equals(IPAddress.Any)) { local = address.Address; nicId = nic.Id; }
                Require(local != null, "Same-host non-loopback IPv4 unavailable"); receipt["sameHost"] = new { address = local.ToString(), interfaceId = nicId, operationalStatus = "Up", source = "GetAllNetworkInterfaces.UnicastAddresses" };
                foreach (IPAddress address in new IPAddress[] { IPAddress.Loopback, IPAddress.Loopback, IPAddress.IPv6Loopback, local }) { TcpListener listener = new TcpListener(address, 0); listeners.Add(listener); listener.Start(4); Require(((IPEndPoint)listener.LocalEndpoint).Port >= 1024, "Listener port bound"); }
                udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)); Require(((IPEndPoint)udp.Client.LocalEndPoint).Port >= 1024, "UDP port bound");
                ushort approved = (ushort)((IPEndPoint)listeners[0].LocalEndpoint).Port;
                List<object> filters = new List<object>(); receipt["filters"] = filters;
                filters.Add(Install(engine, sub, keys[0], V4, true, approved, app));
                filters.Add(Install(engine, sub, keys[1], V4, false, approved, app));
                filters.Add(Install(engine, sub, keys[2], V6, false, approved, app));
                ulong permitWeight = UInt64.Parse((string)filters[0].GetType().GetProperty("effectiveWeight").GetValue(filters[0], null));
                ulong blockWeight = UInt64.Parse((string)filters[1].GetType().GetProperty("effectiveWeight").GetValue(filters[1], null));
                Require(permitWeight > blockWeight, "Effective weight ordering mismatch");
                installPhase = false; receipt["queryBeforeTraffic"] = true;
                List<object> matrix = new List<object>(); receipt["matrix"] = matrix;
                string[] labels = { "tcp-approved", "tcp-disallowed", "tcp-ipv6", "tcp-same-host" };
                for (int i = 0; i < listeners.Count; i++) matrix.Add(TcpRow(executable, listeners[i], i == 0, labels[i])); matrix.Add(UdpRow(executable, udp));
                bool pass = true; foreach (object row in matrix) if (!(bool)row.GetType().GetProperty("pass").GetValue(row, null)) pass = false;
                receipt["classification"] = pass ? "EXACT_APP_LOCALHOST_MATRIX_PROVEN" : "MATRIX_NOT_PROVEN";
            }
        }
        catch (Exception ex)
        {
            WfpException wfp = ex as WfpException;
            elevationRequired = !elevated && wfp != null && wfp.Code == 5;
            receipt["error"] = ex.GetType().Name + ": " + ex.Message;
            if (wfp != null)
            {
                receipt["wfpErrorCode"] = wfp.Code;
                receipt["wfpFailure"] = new { api = wfp.Api, role = wfp.Role, objectKey = wfp.ObjectKey, errorCode = wfp.Code, errorHex = "0x" + wfp.Code.ToString("X8") };
            }
            receipt["classification"] = elevationRequired ? "HUMAN_ELEVATION_REQUIRED_FOR_WFP_PROOF" : installPhase && wfp != null ? "WFP_POLICY_INSTALLATION_BLOCKED" : "UNKNOWN";
        }
        finally
        {
            foreach (TcpListener listener in listeners) { try { listener.Stop(); } catch (Exception ex) { receipt["listenerCleanupError"] = ex.Message; receipt["classification"] = "UNKNOWN"; } }
            if (udp != null) { try { udp.Close(); } catch (Exception ex) { receipt["udpCleanupError"] = ex.Message; receipt["classification"] = "UNKNOWN"; } }
            if (app != IntPtr.Zero) FwpmFreeMemory0(ref app);
            if (frozenProbe != null) frozenProbe.Dispose();
            uint close = 0;
            if (engine != IntPtr.Zero)
            {
                close = FwpmEngineClose0(engine); receipt["engineCloseCode"] = close;
            }
            if (liveAttempted)
            {
                try
                {
                    Require(close == 0, "Dynamic engine close failed");
                    int remaining; receipt["cleanup"] = Absence(sub, keys, out remaining);
                    receipt["WFP_PROOF_OBJECTS_REMAINING"] = remaining;
                    if (remaining != 0) receipt["classification"] = "PROOF_OBJECTS_REMAIN";
                }
                catch (Exception ex)
                {
                    WfpException wfp = ex as WfpException;
                    bool denied = !elevated && wfp != null && wfp.Code == 5;
                    receipt["cleanup"] = new { status = denied ? "UNVERIFIED_ELEVATION_REQUIRED" : "UNKNOWN", enumerationComplete = false, error = ex.Message };
                    receipt["classification"] = elevationRequired && denied && close == 0 ? "HUMAN_ELEVATION_REQUIRED_FOR_WFP_PROOF" : "UNKNOWN";
                }
            }
        }
        Console.WriteLine(Json.Serialize(receipt)); string classification = (string)receipt["classification"];
        return classification == "EXACT_APP_LOCALHOST_MATRIX_PROVEN" || classification == "STATIC_ONLY_NO_WFP_NO_NETWORK" ? 0 : 2;
    }
}
