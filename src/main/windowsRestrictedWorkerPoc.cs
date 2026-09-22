using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Munder.RestrictedWorkerPoc
{
    // Standalone .NET Framework console executable; never loaded by the production launcher.
    public static class Program
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        static readonly byte[] Input = new byte[] { 0, 255, 13, 10, 65, 0, 66 };
        static Dictionary<string, object> D(params object[] pairs) { var d = new Dictionary<string, object>(); for (int i = 0; i < pairs.Length; i += 2) d.Add((string)pairs[i], pairs[i + 1]); return d; }
        static void Check(bool ok, string api) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), api); }
        static void Require(bool ok, string invariant) { if (!ok) throw new InvalidOperationException(invariant); }
        static void Close(ref IntPtr h) { if (h != IntPtr.Zero && h != new IntPtr(-1)) CloseHandle(h); h = IntPtr.Zero; }
        static string Hash(byte[] bytes) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        static string Sid(IntPtr sid) { IntPtr text; Check(ConvertSidToStringSidW(sid, out text), "ConvertSidToStringSidW"); try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); } }
        static IntPtr Info(IntPtr token, int kind) { int size; GetTokenInformation(token, kind, IntPtr.Zero, 0, out size); Require(size > 0 && size < 1048576, "Token information bounds"); IntPtr p = Marshal.AllocHGlobal(size); try { Check(GetTokenInformation(token, kind, p, size, out size), "GetTokenInformation:" + kind); return p; } catch { Marshal.FreeHGlobal(p); throw; } }
        static Dictionary<string, object> Token(IntPtr token)
        {
            var result = D();
            foreach (int kind in new int[] { 1, 2, 3, 8, 11, 25, 27 })
            {
                IntPtr p = Info(token, kind);
                try
                {
                    if (kind == 1 || kind == 25) result[kind == 1 ? "userSid" : "integritySid"] = Sid(Marshal.ReadIntPtr(p));
                    else if (kind == 8 || kind == 27) result[kind == 8 ? "tokenType" : "mandatoryPolicy"] = Marshal.ReadInt32(p);
                    else
                    {
                        int count = Marshal.ReadInt32(p); var rows = new List<object>();
                        for (int i = 0; i < count; i++)
                        {
                            if (kind == 3) { IntPtr row = IntPtr.Add(p, 4 + i * 12); rows.Add(D("luid", Marshal.ReadInt64(row).ToString(), "attributes", Marshal.ReadInt32(row, 8))); }
                            else { IntPtr row = IntPtr.Add(p, (IntPtr.Size == 8 ? 8 : 4) + i * Marshal.SizeOf(typeof(SidAttributes))); var sa = (SidAttributes)Marshal.PtrToStructure(row, typeof(SidAttributes)); rows.Add(D("sid", Sid(sa.sid), "attributes", sa.attributes)); }
                        }
                        result[kind == 3 ? "privileges" : kind == 2 ? "groups" : "restrictedSids"] = rows;
                    }
                }
                finally { Marshal.FreeHGlobal(p); }
            }
            result["isRestricted"] = IsTokenRestricted(token); return result;
        }
        static IntPtr Current(uint access) { IntPtr t; Check(OpenProcessToken(GetCurrentProcess(), access, out t), "OpenProcessToken"); return t; }
        static bool Integrity(IntPtr token, string sid, out int error)
        {
            IntPtr s; Check(ConvertStringSidToSidW(sid, out s), "ConvertStringSidToSidW");
            IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAttributes)));
            try { Marshal.StructureToPtr(new SidAttributes { sid = s, attributes = 0x20 }, p, false); bool ok = SetTokenInformation(token, 25, p, Marshal.SizeOf(typeof(SidAttributes)) + (int)GetLengthSid(s)); error = ok ? 0 : Marshal.GetLastWin32Error(); return ok; }
            finally { Marshal.FreeHGlobal(p); LocalFree(s); }
        }
        static string Security(string path, string user, string level)
        {
            IntPtr sd; uint size;
            Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;WD)S:(ML;OICI;NW;;;" + level + ")", 1, out sd, out size), "ConvertStringSecurityDescriptor");
            try
            {
                bool present, defaulted; IntPtr dacl, sacl;
                Check(GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted), "GetSecurityDescriptorDacl");
                Require(present && dacl != IntPtr.Zero, "Explicit DACL required");
                uint error = SetNamedSecurityInfoW(path, 1, 0x80000004U, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
                if (error != 0) throw new Win32Exception((int)error, "SetNamedSecurityInfoW:DACL");
                Check(GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted), "GetSecurityDescriptorSacl");
                Require(present && sacl != IntPtr.Zero, "Explicit mandatory label required");
                // LABEL_SECURITY_INFORMATION, not SACL_SECURITY_INFORMATION: the latter
                // requests ACCESS_SYSTEM_SECURITY and would require SeSecurityPrivilege.
                error = SetNamedSecurityInfoW(path, 1, 0x10U, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
                if (error != 0) throw new Win32Exception((int)error, "SetNamedSecurityInfoW:LABEL");
            }
            finally { LocalFree(sd); }
            return QuerySecurity(path);
        }
        static string QuerySecurity(string path)
        {
            uint size; GetFileSecurityW(path, 0x14, IntPtr.Zero, 0, out size); Require(size > 0 && size < 65536, "Security descriptor bounds");
            IntPtr sd = Marshal.AllocHGlobal((int)size), text = IntPtr.Zero;
            try { Check(GetFileSecurityW(path, 0x14, sd, size, out size), "GetFileSecurityW"); Check(ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 0x14, out text, out size), "Security descriptor query"); return Marshal.PtrToStringUni(text); }
            finally { if (text != IntPtr.Zero) LocalFree(text); Marshal.FreeHGlobal(sd); }
        }
        // Metadata only: the normally loaded modules of this exact helper, not a tree scan.
        static List<string> ModulePaths()
        {
            var paths = new List<string>();
            using (var process = Process.GetCurrentProcess())
                foreach (ProcessModule module in process.Modules)
                {
                    Require(paths.Count < 256, "Module diagnostic bound");
                    paths.Add(module.FileName);
                }
            paths.Sort(StringComparer.OrdinalIgnoreCase); return paths;
        }
        static Dictionary<string, object> AccessDiagnostic(string path, IntPtr token)
        {
            var r = D("path", path, "scope", "FILE_GENERIC_READ_EXECUTE_ACCESSCHECK_NOT_IMAGE_LOADER_PROOF");
            IntPtr sd = IntPtr.Zero, impersonation = IntPtr.Zero, privileges = IntPtr.Zero;
            try
            {
                r["securityDescriptor"] = QuerySecurity(path);
                uint size; GetFileSecurityW(path, 0x17, IntPtr.Zero, 0, out size);
                Require(size > 0 && size < 65536, "Access descriptor bound");
                sd = Marshal.AllocHGlobal((int)size);
                Check(GetFileSecurityW(path, 0x17, sd, size, out size), "GetFileSecurityW:access");
                Check(DuplicateToken(token, 2, out impersonation), "DuplicateToken:access");
                var mapping = new GenericMapping { read = 0x120089, write = 0x120116, execute = 0x1200A0, all = 0x1FFFFF };
                uint length = 4096, granted; bool allowed; privileges = Marshal.AllocHGlobal((int)length);
                Check(AccessCheck(sd, impersonation, 0x1200A9, ref mapping, privileges, ref length, out granted, out allowed), "AccessCheck");
                r["accessStatus"] = allowed; r["grantedAccess"] = granted; r["status"] = "OBSERVED";
            }
            catch (Exception e) { var w = e as Win32Exception; r["status"] = "UNKNOWN"; r["error"] = e.Message; r["win32Error"] = w == null ? (object)null : w.NativeErrorCode; }
            finally { Close(ref impersonation); if (sd != IntPtr.Zero) Marshal.FreeHGlobal(sd); if (privileges != IntPtr.Zero) Marshal.FreeHGlobal(privileges); }
            return r;
        }
        static Dictionary<string, object> Operation(string name, Func<bool> action)
        {
            bool ok = action(); int error = ok ? 0 : Marshal.GetLastWin32Error(); return D("operation", name, "success", ok, "win32Error", error);
        }
        static bool WritePath(string path, uint disposition, bool append = false)
        {
            IntPtr h = CreateFileW(path, append ? 4U : 0x40000000U, 7, IntPtr.Zero, disposition, 0x80, IntPtr.Zero);
            if (h == new IntPtr(-1)) return false;
            try { uint n; return WriteFile(h, Input, (uint)Input.Length, out n, IntPtr.Zero) && n == Input.Length; } finally { CloseHandle(h); }
        }
        static int Worker(string mode, string root)
        {
            Console.WriteLine("MANAGED_WORKER_ENTRY_V1"); Console.Out.Flush();
            IntPtr token = Current(0x88);
            try
            {
                var r = D("token", Token(token), "cwd", Environment.CurrentDirectory, "executable", Process.GetCurrentProcess().MainModule.FileName);
                using (var stream = Console.OpenStandardInput()) using (var bytes = new MemoryStream())
                {
                    byte[] buffer = new byte[128]; int n; while ((n = stream.Read(buffer, 0, buffer.Length)) != 0) { Require(bytes.Length + n <= 4096, "stdin bound"); bytes.Write(buffer, 0, n); }
                    r["stdinBytes"] = bytes.Length; r["stdinSha256"] = Hash(bytes.ToArray()); r["stdinEof"] = true;
                }
                if (mode == "entry") { Console.WriteLine(Json.Serialize(r)); return 0; }
                if (mode == "wait") { Console.WriteLine(Json.Serialize(D("ready", true, "token", r["token"], "stdinEof", true))); Console.Out.Flush(); Thread.Sleep(Timeout.Infinite); return 99; }
                string worker = Path.Combine(root, "worker"), ledger = Path.Combine(root, "ledger"), receipt = Path.Combine(ledger, "attempt.receipt");
                var operations = new List<object>();
                operations.Add(Operation("worker.create", () => WritePath(Path.Combine(worker, "a"), 1)));
                operations.Add(Operation("worker.append", () => WritePath(Path.Combine(worker, "a"), 3, true)));
                operations.Add(Operation("worker.rename", () => MoveFileW(Path.Combine(worker, "a"), Path.Combine(worker, "b"))));
                operations.Add(Operation("worker.delete", () => DeleteFileW(Path.Combine(worker, "b"))));
                operations.Add(Operation("worker.mkdir", () => CreateDirectoryW(Path.Combine(worker, "dir"), IntPtr.Zero)));
                operations.Add(Operation("worker.rmdir", () => RemoveDirectoryW(Path.Combine(worker, "dir"))));
                operations.Add(Operation("ledger.overwrite", () => WritePath(receipt, 3)));
                operations.Add(Operation("ledger.append", () => WritePath(receipt, 3, true)));
                operations.Add(Operation("ledger.truncate", () => WritePath(receipt, 5)));
                operations.Add(Operation("ledger.create", () => WritePath(Path.Combine(ledger, "new"), 1)));
                operations.Add(Operation("ledger.rename", () => MoveFileW(receipt, Path.Combine(ledger, "moved"))));
                operations.Add(Operation("ledger.delete", () => DeleteFileW(receipt)));
                operations.Add(Operation("ledger.mkdir", () => CreateDirectoryW(Path.Combine(ledger, "dir"), IntPtr.Zero)));
                r["operations"] = operations;
                int error; bool raised = Integrity(token, "S-1-16-8192", out error);
                r["integrityRaise"] = D("success", raised, "win32Error", error, "finalToken", Token(token));
                Console.WriteLine(Json.Serialize(r)); return 0;
            }
            finally { Close(ref token); }
        }
        static Dictionary<string, object> Launch(IntPtr token, string root, bool timeout, Dictionary<string, object> receipt, bool diagnose = false)
        {
            IntPtr job = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
            IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobValue = IntPtr.Zero, env = IntPtr.Zero; bool initialized = false;
            ProcessInfo process = new ProcessInfo(); var r = D("schema", "restricted-child-launch", "version", 1, "variantId", receipt["variantId"], "token", Token(token), "mode", diagnose ? "entry" : timeout ? "timeout" : "normal", "ioMode", "RAW_PIPE", "creationTimeJob", true,
                "createProcessAsUser", null, "pid", null, "jobMember", null, "exitCode", null, "exitCodeHex", null, "managedCodeReached", false, "stdoutBytes", 0, "eof", false, "activeProcessesFinal", null, "cleanup", "UNKNOWN", "worker", null,
                "handleList", new string[] { "stdin-read", "stdout-write" }, "stderr", "stdout-write", "jobLimitFlags", 0x2000, "creationFlags", 0x8080400);
            receipt[diagnose ? "entry" : timeout ? "timeout" : "normal"] = r;
            try
            {
                job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObjectW");
                var limit = new ExtendedLimit(); limit.basic.flags = 0x2000;
                Check(SetInformationJobObject(job, 9, ref limit, (uint)Marshal.SizeOf(typeof(ExtendedLimit))), "SetInformationJobObject");
                var sa = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), inherit = 1 };
                Check(CreatePipe(out inputRead, out inputWrite, ref sa, 4096), "CreatePipe:stdin"); Check(CreatePipe(out outputRead, out outputWrite, ref sa, 65536), "CreatePipe:stdout");
                Check(SetHandleInformation(inputWrite, 1, 0), "SetHandleInformation:stdin"); Check(SetHandleInformation(outputRead, 1, 0), "SetHandleInformation:stdout");
                IntPtr size = IntPtr.Zero; bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                Require(!sizing && Marshal.GetLastWin32Error() == 122 && size.ToInt64() > 0 && size.ToInt64() < 65536, "Attribute sizing");
                attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "InitializeProcThreadAttributeList"); initialized = true;
                handles = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handles, inputRead); Marshal.WriteIntPtr(handles, IntPtr.Size, outputWrite);
                jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero), "HANDLE_LIST");
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "JOB_LIST");
                string executable = Process.GetCurrentProcess().MainModule.FileName;
                string cwd = Path.Combine(root, "worker");
                // A closed environment, not a projection of the parent's credentials or provider settings.
                var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                    { "SystemRoot", Environment.GetEnvironmentVariable("SystemRoot") },
                    { "TEMP", cwd }, { "TMP", cwd }
                };
                var environmentBlock = new StringBuilder();
                foreach (var entry in environment) environmentBlock.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
                environmentBlock.Append('\0');
                r["environment"] = environment;
                env = Marshal.StringToHGlobalUni(environmentBlock.ToString());
                var start = new StartupEx(); start.start.cb = (uint)Marshal.SizeOf(typeof(StartupEx)); start.start.flags = 0x100; start.start.input = inputRead; start.start.output = outputWrite; start.start.error = outputWrite; start.attributes = attributes;
                r["executable"] = executable; r["cwd"] = cwd;
                bool launched = CreateProcessAsUserW(token, executable, new StringBuilder("\"" + executable + "\" --worker " + (diagnose ? "entry" : timeout ? "wait" : "normal") + " \"" + root + "\""), IntPtr.Zero, IntPtr.Zero, true, 0x80400 | 0x08000000, env, cwd, ref start, out process);
                int launchError = launched ? 0 : Marshal.GetLastWin32Error();
                r["createProcessAsUser"] = D("success", launched, "win32Error", launchError);
                if (!launched) throw new Win32Exception(launchError, "CreateProcessAsUserW");
                r["pid"] = process.pid;
                bool member; Check(IsProcessInJob(process.process, job, out member), "IsProcessInJob"); r["jobMember"] = member; Require(member, "JOB_COMPATIBILITY_BLOCKED");
                Close(ref inputRead); Close(ref outputWrite);
                uint written; bool wrote = WriteFile(inputWrite, Input, (uint)Input.Length, out written, IntPtr.Zero);
                r["stdinWrite"] = D("success", wrote, "bytes", written, "win32Error", wrote ? 0 : Marshal.GetLastWin32Error());
                Close(ref inputWrite); r["inputClosed"] = true;
                var output = new MemoryStream(); bool eof = false, terminated = false; var clock = Stopwatch.StartNew(); long deadline = timeout ? 1500 : 15000;
                while (true)
                {
                    uint available; bool peek = PeekNamedPipe(outputRead, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero);
                    if (!peek) { int e = Marshal.GetLastWin32Error(); if (e == 109) eof = true; else throw new Win32Exception(e, "PeekNamedPipe"); }
                    if (eof) r["eof"] = true;
                    if (peek && available > 0)
                    {
                        Require(output.Length + available <= 65536, "stdout bound"); byte[] bytes = new byte[Math.Min(available, 4096U)]; uint n;
                        Check(ReadFile(outputRead, bytes, (uint)bytes.Length, out n, IntPtr.Zero), "ReadFile:stdout"); output.Write(bytes, 0, (int)n);
                        r["stdoutBytes"] = output.Length;
                        string prefix = Encoding.UTF8.GetString(output.GetBuffer(), 0, (int)Math.Min(output.Length, 25));
                        if (prefix.StartsWith("MANAGED_WORKER_ENTRY_V1\r\n", StringComparison.Ordinal) || prefix.StartsWith("MANAGED_WORKER_ENTRY_V1\n", StringComparison.Ordinal)) r["managedCodeReached"] = true;
                    }
                    uint wait = WaitForSingleObject(process.process, 0); if (wait == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject");
                    if (wait == 0 && eof) break;
                    if (clock.ElapsedMilliseconds >= deadline && !terminated) { Check(TerminateJobObject(job, 124), "TerminateJobObject"); terminated = true; }
                    if (clock.ElapsedMilliseconds >= deadline + 5000) throw new TimeoutException("Job/pipe cleanup deadline");
                    Thread.Sleep(5);
                }
                uint exit; Check(GetExitCodeProcess(process.process, out exit), "GetExitCodeProcess");
                Accounting accounting; uint returned;
                do { Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), out returned), "QueryInformationJobObject"); if (accounting.active == 0) break; Thread.Sleep(5); } while (clock.ElapsedMilliseconds < deadline + 5000);
                r["exitCode"] = exit; r["exitCodeHex"] = "0x" + exit.ToString("X8"); r["terminatedJob"] = terminated; r["activeProcessesFinal"] = accounting.active; r["pipeDrained"] = eof; r["eof"] = eof;
                Require(accounting.active == 0, "JOB_COMPATIBILITY_BLOCKED");
                Require(eof, "RAW_PIPE_COMPATIBILITY_BLOCKED");
                string workerOutput = Encoding.UTF8.GetString(output.ToArray()).Trim();
                const string marker = "MANAGED_WORKER_ENTRY_V1";
                bool reached = workerOutput == marker || workerOutput.StartsWith(marker + "\r\n", StringComparison.Ordinal) || workerOutput.StartsWith(marker + "\n", StringComparison.Ordinal);
                r["managedCodeReached"] = reached;
                r["workerOutput"] = workerOutput;
                if (reached) { string payload = workerOutput.Substring(marker.Length).Trim(); if (payload.Length != 0) r["worker"] = Json.DeserializeObject(payload); }
                return r;
            }
            catch (Exception e) { var w = e as Win32Exception; r["error"] = D("message", e.Message, "win32Error", w == null ? (object)null : w.NativeErrorCode); return r; }
            finally
            {
                bool cleanupOk = true;
                if (job != IntPtr.Zero) cleanupOk = TerminateJobObject(job, 125);
                if (process.process != IntPtr.Zero)
                {
                    cleanupOk = WaitForSingleObject(process.process, 5000) == 0 && cleanupOk;
                    uint finalExit; if (GetExitCodeProcess(process.process, out finalExit)) { r["exitCode"] = finalExit; r["exitCodeHex"] = "0x" + finalExit.ToString("X8"); }
                }
                if (job != IntPtr.Zero) { Accounting final; uint returned; bool queried = QueryInformationJobObject(job, 1, out final, (uint)Marshal.SizeOf(typeof(Accounting)), out returned); if (queried) r["activeProcessesFinal"] = final.active; cleanupOk = queried && final.active == 0 && cleanupOk; }
                Close(ref process.thread); Close(ref process.process); Close(ref inputRead); Close(ref inputWrite); Close(ref outputRead); Close(ref outputWrite); Close(ref job);
                if (initialized) DeleteProcThreadAttributeList(attributes);
                foreach (IntPtr p in new IntPtr[] { attributes, handles, jobValue, env }) if (p != IntPtr.Zero) Marshal.FreeHGlobal(p);
                r["cleanup"] = cleanupOk ? "JOB_EMPTY_HANDLES_CLOSED" : "UNKNOWN";
            }
        }
        static void ValidateToken(Dictionary<string, object> t, string user, bool everyone)
        {
            Require((string)t["userSid"] == user && (string)t["integritySid"] == "S-1-16-4096" && Convert.ToInt32(t["tokenType"]) == 1 && (Convert.ToInt32(t["mandatoryPolicy"]) & 1) == 1, "Derived token identity and MIC");
            var rows = t["restrictedSids"] as System.Collections.IEnumerable; int count = 0;
            foreach (Dictionary<string, object> row in rows) { count++; Require(everyone && (string)row["sid"] == "S-1-1-0", "Restricting SID dimension"); }
            Require(count == (everyone ? 1 : 0) && (!everyone || (bool)t["isRestricted"]), "Restricting SID dimension");
            foreach (Dictionary<string, object> p in (System.Collections.IEnumerable)t["privileges"]) Require((string)p["luid"] == "23", "Privilege stripping");
        }
        static void ValidateLaunch(Dictionary<string, object> r, uint exit)
        {
            Require(!r.ContainsKey("error") && (bool)((Dictionary<string, object>)r["createProcessAsUser"])["success"] && (bool)r["jobMember"] && (bool)r["inputClosed"] && (bool)r["eof"] && Convert.ToUInt32(r["activeProcessesFinal"]) == 0 && (string)r["cleanup"] == "JOB_EMPTY_HANDLES_CLOSED", "Launch lifecycle incomplete");
            Require(Convert.ToUInt32(r["exitCode"]) == exit && (bool)r["terminatedJob"] == (exit == 124), "Unexpected child exit");
        }
        public static int Main(string[] args)
        {
            if (args.Length == 3 && args[0] == "--worker") return Worker(args[1], args[2]);
            if (args.Length != 1) return 2;
            string root = Path.GetFullPath(args[0]);
            var receipt = D("schema", "restricted-child-image-diagnosis", "version", 1, "authority", "PROVIDER_FREE_TEST_ONLY", "network", "NOT_AUTHORIZED", "credentials", "NONE", "OMP", "NOT_RUN", "CLIProxyAPI", "NOT_RUN", "classification", null, "matrixStatus", "UNKNOWN");
            IntPtr current = IntPtr.Zero, restricted = IntPtr.Zero; bool created = false; int result = 1;
            try
            {
                Require(!Directory.Exists(root), "Fresh test root required"); Directory.CreateDirectory(root); created = true;
                current = Current(0x8B); var before = Token(current); receipt["parentToken"] = before;
                Require((string)before["integritySid"] == "S-1-16-8192", "Medium parent required; no elevation");
                string user = (string)before["userSid"], ledger = Path.Combine(root, "ledger"), worker = Path.Combine(root, "worker");
                string helper = Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName);
                string run = Path.GetDirectoryName(helper);
                Require(String.Equals(Path.Combine(run, "state"), root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(run).StartsWith("windows-restricted-worker-poc-", StringComparison.Ordinal) && Path.GetFileName(Path.GetDirectoryName(run)) == ".tmp" && Path.GetFileName(helper) == "RestrictedWorkerPoc.exe", "Exact test-owned helper/run boundary required");
                // Bind only this test run and executable, never repository/system ancestors.
                // Equal DACLs on the two roots leave Low MIC as their mutation discriminator.
                receipt["runSecurity"] = Security(run, user, "ME");
                receipt["helperSecurity"] = Security(helper, user, "ME");
                Directory.CreateDirectory(ledger); Directory.CreateDirectory(worker);
                receipt["ledgerSecurity"] = Security(ledger, user, "ME"); receipt["workerSecurity"] = Security(worker, user, "LW");
                string file = Path.Combine(ledger, "attempt.receipt"); byte[] original = Encoding.UTF8.GetBytes("main-owned-test-receipt\n"); File.WriteAllBytes(file, original);
                receipt["ledgerFileSecurity"] = QuerySecurity(file); receipt["ledgerHashBefore"] = Hash(original);
                var variants = D(); receipt["variants"] = variants;
                receipt["helperPath"] = helper;
                var modules = ModulePaths(); receipt["normallyLoadedModulePaths"] = modules;
                foreach (string id in new string[] { "A", "B" })
                {
                    bool everyone = id == "A";
                    var variant = D("schema", "restricted-child-variant", "version", 1, "variantId", id);
                    variants[id] = variant;
                    variant["restrictionConstruction"] = D("flags", 1, "disabledSids", new string[0], "restrictingSids", everyone ? new string[] { "S-1-1-0" } : new string[0], "writeRestricted", false, "identityIsolation", false);
                    IntPtr restrictingSid = IntPtr.Zero, restrictingEntry = IntPtr.Zero;
                    try
                    {
                        if (everyone)
                        {
                            Check(ConvertStringSidToSidW("S-1-1-0", out restrictingSid), "ConvertStringSidToSidW:restricting Everyone");
                            restrictingEntry = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAttributes)));
                            Marshal.StructureToPtr(new SidAttributes { sid = restrictingSid, attributes = 0 }, restrictingEntry, false);
                        }
                        Check(CreateRestrictedToken(current, 1, 0, IntPtr.Zero, 0, IntPtr.Zero, everyone ? 1U : 0U, restrictingEntry, out restricted), "CreateRestrictedToken");
                    }
                    finally { if (restrictingEntry != IntPtr.Zero) Marshal.FreeHGlobal(restrictingEntry); if (restrictingSid != IntPtr.Zero) LocalFree(restrictingSid); }
                    int error; if (!Integrity(restricted, "S-1-16-4096", out error)) throw new Win32Exception(error, "SetTokenInformation:Low");
                    var derived = Token(restricted); variant["restrictedToken"] = derived; ValidateToken(derived, user, everyone);
                    var diagnostics = new List<object>(); variant["fileDiagnostics"] = diagnostics;
                    diagnostics.Add(AccessDiagnostic(helper, restricted));
                    foreach (string module in modules) if (!String.Equals(module, helper, StringComparison.OrdinalIgnoreCase)) diagnostics.Add(AccessDiagnostic(module, restricted));
                    Launch(restricted, root, false, variant, true);
                    if (everyone) Close(ref restricted);
                }
                var a = (Dictionary<string, object>)variants["A"]; var b = (Dictionary<string, object>)variants["B"];
                var aLaunch = (Dictionary<string, object>)a["entry"]; var bLaunch = (Dictionary<string, object>)b["entry"];
                ValidateLaunch(aLaunch, 0xC0000022);
                Require(!(bool)aLaunch["managedCodeReached"] && Convert.ToInt64(aLaunch["stdoutBytes"]) == 0, "Variant A negative control not observed");
                if (!(bool)bLaunch["managedCodeReached"])
                {
                    ValidateLaunch(bLaunch, 0xC0000022);
                    Require(Convert.ToInt64(bLaunch["stdoutBytes"]) == 0, "Unexpected pre-managed output");
                    receipt["classification"] = "IMAGE_INITIALIZATION_BLOCK_REMAINS";
                    receipt["matrixStatus"] = "OBSERVED_IMAGE_INIT_BLOCK"; result = 0;
                }
                else
                {
                ValidateLaunch(bLaunch, 0);
                Require(bLaunch["worker"] is Dictionary<string, object>, "B entry receipt missing");
                ValidateToken((Dictionary<string, object>)((Dictionary<string, object>)bLaunch["worker"])["token"], user, false);
                receipt["normal"] = Launch(restricted, root, false, b);
                receipt["timeout"] = Launch(restricted, root, true, b);
                ValidateLaunch((Dictionary<string, object>)receipt["normal"], 0);
                ValidateLaunch((Dictionary<string, object>)receipt["timeout"], 124);
                foreach (string mode in new string[] { "normal", "timeout" })
                {
                    var launch = (Dictionary<string, object>)receipt[mode];
                    Require((bool)launch["managedCodeReached"] && launch["worker"] is Dictionary<string, object>, "Worker receipt missing");
                    var child = (Dictionary<string, object>)launch["worker"];
                    ValidateToken((Dictionary<string, object>)child["token"], user, false);
                    Require((bool)child["stdinEof"], "Worker stdin EOF missing");
                    var input = (Dictionary<string, object>)launch["stdinWrite"];
                    Require((bool)input["success"] && Convert.ToInt32(input["bytes"]) == Input.Length, "Exact input write");
                }
                Require((bool)((Dictionary<string, object>)((Dictionary<string, object>)receipt["timeout"])["worker"])["ready"], "Timeout readiness missing");
                byte[] after = File.ReadAllBytes(file); string[] entries = Directory.GetFileSystemEntries(ledger);
                receipt["ledgerHashAfter"] = Hash(after); receipt["ledgerEntries"] = Array.ConvertAll(entries, Path.GetFileName);
                Require(Hash(after) == Hash(original) && entries.Length == 1 && entries[0] == file, "LEDGER_MUTATION_NOT_BLOCKED"); receipt["ledgerUnchanged"] = true;
                File.AppendAllText(file, "main-update"); receipt["mainUpdate"] = File.ReadAllText(file) == Encoding.UTF8.GetString(original) + "main-update"; File.Delete(file); receipt["mainDelete"] = !File.Exists(file);
                // Both B lifecycle paths have completed before checking the mutation evidence.
                var observation = (Dictionary<string, object>)((Dictionary<string, object>)receipt["normal"])["worker"];
                string[] expected = new string[] { "worker.create", "worker.append", "worker.rename", "worker.delete", "worker.mkdir", "worker.rmdir", "ledger.overwrite", "ledger.append", "ledger.truncate", "ledger.create", "ledger.rename", "ledger.delete", "ledger.mkdir" };
                var observedOperations = (object[])observation["operations"];
                Require(observedOperations.Length == expected.Length, "Mutation matrix incomplete");
                for (int i = 0; i < expected.Length; i++) Require((string)((Dictionary<string, object>)observedOperations[i])["operation"] == expected[i], "Mutation matrix ordering");
                foreach (Dictionary<string, object> operation in (object[])observation["operations"])
                {
                    bool allowed = ((string)operation["operation"]).StartsWith("worker.");
                    Require((bool)operation["success"] == allowed && Convert.ToInt32(operation["win32Error"]) == (allowed ? 0 : 5), allowed ? "LOW_INTEGRITY_WORKSPACE_NOT_WRITABLE" : "LEDGER_MUTATION_NOT_BLOCKED");
                }
                var raise = (Dictionary<string, object>)observation["integrityRaise"];
                Require(!(bool)raise["success"] && Convert.ToInt32(raise["win32Error"]) != 0 && (string)((Dictionary<string, object>)raise["finalToken"])["integritySid"] == "S-1-16-4096", "SELF_INTEGRITY_RAISE_POSSIBLE");
                ValidateToken((Dictionary<string, object>)raise["finalToken"], user, false);
                Require((bool)observation["stdinEof"] && Convert.ToInt32(observation["stdinBytes"]) == Input.Length && (string)observation["stdinSha256"] == Hash(Input), "RAW_PIPE_COMPATIBILITY_BLOCKED");
                Require(String.Equals((string)observation["cwd"], worker, StringComparison.OrdinalIgnoreCase) && String.Equals((string)observation["executable"], helper, StringComparison.OrdinalIgnoreCase), "Worker launch identity");
                Require((bool)receipt["mainUpdate"] && (bool)receipt["mainDelete"], "Main ledger authority");
                receipt["classification"] = "EVERYONE_RESTRICTING_SID_IMAGE_INIT_CONFLICT";
                receipt["matrixStatus"] = "FULL_B_MATRIX_RECORDED";
                receipt["WINDOWS_RESTRICTED_WORKER_TOKEN_POC"] = "VERIFIED_FOR_VARIANT_B";
                receipt["RESTRICTED_LOW_INTEGRITY_BOUNDARY"] = "PROVEN_PROVIDER_FREE_NOT_INTEGRATED"; result = 0;
                }
            }
            catch (Exception e)
            {
                var w = e as Win32Exception;
                receipt["matrixStatus"] = "UNKNOWN";
                receipt["classification"] = null;
                receipt["error"] = D("api", e.Message, "type", e.GetType().Name, "win32Error", w == null ? (object)null : w.NativeErrorCode);
            }
            finally
            {
                Close(ref restricted); Close(ref current);
                try { if (created) Directory.Delete(root, true); receipt["cleanup"] = "REMOVED_TEST_ROOT"; }
                catch (Exception e) { receipt["cleanup"] = e.Message; receipt["classification"] = null; receipt["matrixStatus"] = "UNKNOWN"; result = 1; }
                if (result != 0) { receipt.Remove("WINDOWS_RESTRICTED_WORKER_TOKEN_POC"); receipt.Remove("RESTRICTED_LOW_INTEGRITY_BOUNDARY"); }
            }
            Console.WriteLine(Json.Serialize(receipt)); return result;
        }
        [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr sid; public uint attributes; }
        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int length; public IntPtr descriptor; public int inherit; }
        [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long user, job; public uint flags; public UIntPtr min, max; public uint count; public UIntPtr affinity; public uint priority, scheduling; }
        [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public Io io; public UIntPtr a,b,c,d; }
        [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedSize; public IntPtr reserved2,input,output,error; }
        [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup start; public IntPtr attributes; }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
        [StructLayout(LayoutKind.Sequential)] struct GenericMapping { public uint read, write, execute, all; }
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr duplicate);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(IntPtr sd,IntPtr token,uint desired,ref GenericMapping mapping,IntPtr privileges,ref uint length,out uint granted,out bool allowed);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr sd,out bool present,out IntPtr acl,out bool defaulted);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd,out bool present,out IntPtr acl,out bool defaulted);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string name,int type,uint information,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr t,int kind,IntPtr p,int size,out int returned);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr t,int kind,IntPtr p,int size);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr t,uint flags,uint disable,IntPtr sids,uint delete,IntPtr privileges,uint restrict,IntPtr restricted,out IntPtr result);
        [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
        [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertSidToStringSidW(IntPtr sid,out IntPtr text);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr sd,out uint size);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd,uint revision,uint info,out IntPtr text,out uint size);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetFileSecurityW(string path,uint info,IntPtr sd,uint size,out uint needed);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeleteFileW(string path);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool MoveFileW(string from,string to);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,IntPtr sa);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool RemoveDirectoryW(string path);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr sa,string name);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit info,uint size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint size,out uint returned);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SecurityAttributes sa,uint size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token,string application,StringBuilder command,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint timeout);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr h,byte[] bytes,uint count,out uint written,IntPtr overlap);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr h,byte[] bytes,uint count,out uint read,IntPtr overlap);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool PeekNamedPipe(IntPtr h,IntPtr buffer,uint size,IntPtr read,out uint available,IntPtr left);
    }
}
