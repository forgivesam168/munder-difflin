using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Web.Script.Serialization;

public static class OwnedLowChild
{
    [StructLayout(LayoutKind.Sequential)] struct Label { public IntPtr sid; public uint attributes; }
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr value, int size, out int returned);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool SetTokenInformation(IntPtr token, int kind, IntPtr value, int size);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSidToSidW(string value, out IntPtr sid);
    [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr sd,out uint size);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr sd,out bool present,out IntPtr acl,out bool defaulted);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd,out bool present,out IntPtr acl,out bool defaulted);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string name,int type,uint info,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
    static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    static object Info(IntPtr token, int kind)
    {
        int size; GetTokenInformation(token, kind, IntPtr.Zero, 0, out size);
        if (size <= 0 || size > 1048576) throw new Exception("Token size");
        IntPtr p = Marshal.AllocHGlobal(size);
        try {
            Check(GetTokenInformation(token, kind, p, size, out size));
            if (kind == 1 || kind == 25) return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;
            if (kind == 3) {
                var values = new List<long>(); int count = Marshal.ReadInt32(p);
                for (int i = 0; i < count; i++) values.Add(Marshal.ReadInt64(p, 4 + i * 12));
                return values;
            }
            return Marshal.ReadInt32(p);
        } finally { Marshal.FreeHGlobal(p); }
    }
    static void Secure(string path, string level)
    {
        IntPtr sd; uint size;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;OICI;FA;;;WD)S:(ML;OICI;NW;;;" + level + ")", 1, out sd, out size));
        try {
            bool present, defaulted; IntPtr acl;
            Check(GetSecurityDescriptorDacl(sd, out present, out acl, out defaulted));
            uint error = SetNamedSecurityInfoW(path,1,0x80000004U,IntPtr.Zero,IntPtr.Zero,acl,IntPtr.Zero);
            if (error != 0) throw new System.ComponentModel.Win32Exception((int)error);
            Check(GetSecurityDescriptorSacl(sd, out present, out acl, out defaulted));
            error = SetNamedSecurityInfoW(path,1,0x10,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,acl);
            if (error != 0) throw new System.ComponentModel.Win32Exception((int)error);
        } finally { LocalFree(sd); }
    }
    static object Attempt(string name, Action action)
    {
        try { action(); return new { name=name, success=true, error=0 }; }
        catch (UnauthorizedAccessException e) { return new { name=name, success=false, error=e.HResult & 65535 }; }
    }
    public static int Main(string[] args)
    {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        if (args[0] == "setup") {
            Secure(args[1], "ME");
            Directory.CreateDirectory(Path.Combine(args[1], "worker"));
            Directory.CreateDirectory(Path.Combine(args[1], "ledger"));
            Secure(Path.Combine(args[1], "worker"), "LW");
            Secure(Path.Combine(args[1], "ledger"), "ME");
            foreach (string name in new[] { "overwrite", "append", "truncate", "rename", "delete" }) File.WriteAllText(Path.Combine(args[1], "ledger", name), "unchanged");
            Console.WriteLine(WindowsIdentity.GetCurrent().User.Value); return 0;
        }
        IntPtr token; Check(OpenProcessToken(GetCurrentProcess(), 0x88, out token));
        try {
            var result = new Dictionary<string, object>();
            result["user"] = Info(token,1); result["integrity"] = Info(token,25);
            result["tokenType"] = Info(token,8); result["policy"] = Info(token,27);
            result["restrictingCount"] = Info(token,11); result["privileges"] = Info(token,3);
            result["cwd"] = Environment.CurrentDirectory; result["args"] = args;
            result["marker"] = Environment.GetEnvironmentVariable("OWNED_LITERAL");
            using (var input = Console.OpenStandardInput()) using (var bytes = new MemoryStream()) {
                input.CopyTo(bytes); result["base64"] = Convert.ToBase64String(bytes.ToArray()); result["eof"] = true;
            }
            if (args[0] == "mutate") {
                string worker=Path.Combine(args[1],"worker"), ledger=Path.Combine(args[1],"ledger");
                var operations = new List<object>();
                operations.Add(Attempt("worker.create", () => File.WriteAllText(Path.Combine(worker,"a"),"a")));
                operations.Add(Attempt("worker.append", () => File.AppendAllText(Path.Combine(worker,"a"),"b")));
                operations.Add(Attempt("worker.rename", () => File.Move(Path.Combine(worker,"a"),Path.Combine(worker,"b"))));
                operations.Add(Attempt("worker.delete", () => File.Delete(Path.Combine(worker,"b"))));
                operations.Add(Attempt("worker.mkdir", () => Directory.CreateDirectory(Path.Combine(worker,"dir"))));
                operations.Add(Attempt("worker.rmdir", () => Directory.Delete(Path.Combine(worker,"dir"))));
                operations.Add(Attempt("ledger.overwrite", () => File.WriteAllText(Path.Combine(ledger,"overwrite"),"bad")));
                operations.Add(Attempt("ledger.append", () => File.AppendAllText(Path.Combine(ledger,"append"),"bad")));
                operations.Add(Attempt("ledger.truncate", () => { using (var s=File.Open(Path.Combine(ledger,"truncate"),FileMode.Truncate)) {} }));
                operations.Add(Attempt("ledger.create", () => File.WriteAllText(Path.Combine(ledger,"new"),"bad")));
                operations.Add(Attempt("ledger.rename", () => File.Move(Path.Combine(ledger,"rename"),Path.Combine(ledger,"moved"))));
                operations.Add(Attempt("ledger.delete", () => File.Delete(Path.Combine(ledger,"delete"))));
                result["operations"] = operations;
                IntPtr sid; Check(ConvertStringSidToSidW("S-1-16-8192",out sid));
                IntPtr label=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Label)));
                try {
                    Marshal.StructureToPtr(new Label { sid=sid, attributes=0x20 },label,false);
                    bool raised=SetTokenInformation(token,25,label,Marshal.SizeOf(typeof(Label))+(int)GetLengthSid(sid));
                    result["raised"]=raised; result["raiseError"]=raised ? 0 : Marshal.GetLastWin32Error();
                    result["integrityAfter"]=Info(token,25);
                } finally { Marshal.FreeHGlobal(label); LocalFree(sid); }
            }
            Console.WriteLine(new JavaScriptSerializer().Serialize(result)); Console.Out.Flush();
            if (args[0] == "wait") Thread.Sleep(Timeout.Infinite);
            return 0;
        } finally { CloseHandle(token); }
    }
}
