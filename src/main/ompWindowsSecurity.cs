using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// Invoked only by the Main-local boundary module. No process creation or token export.
public static class OmpWindowsSecurity
{
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint GetNamedSecurityInfoW(string p, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string p, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s, uint rev, out IntPtr sd, out uint size);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr acl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr acl, out bool defaulted);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr sd);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string p, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out FileInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle h, System.Text.StringBuilder text, uint size, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct FileInfo { public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write; public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow; }
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static RawSecurityDescriptor QueryDescriptor(string path, uint information)
    {
        IntPtr owner, group, dacl, sacl, sd;
        uint error = GetNamedSecurityInfoW(path, 1, information, out owner, out group, out dacl, out sacl, out sd);
        if (error != 0) throw new Win32Exception((int)error, "Query security information=" + information + " failed: " + path + " (Win32=" + error + ")");
        try {
            uint length = GetSecurityDescriptorLength(sd);
            if (length == 0 || length > 1048576) throw new Exception("Security descriptor size refused");
            byte[] bytes = new byte[length]; Marshal.Copy(sd, bytes, 0, (int)length);
            return new RawSecurityDescriptor(bytes, 0);
        } finally { LocalFree(sd); }
    }
    static RawAcl QueryMandatoryLabel(string path)
    {
        IntPtr owner, group, dacl, sacl, sd;
        uint error = GetNamedSecurityInfoW(path, 1, 0x10, out owner, out group, out dacl, out sacl, out sd);
        if (error != 0) throw new Win32Exception((int)error, "Query LABEL ACL failed: " + path + " (Win32=" + error + ")");
        try {
            if (sacl == IntPtr.Zero) throw new Exception("LABEL query returned null ACL: " + path);
            // ACL header: BYTE revision, BYTE reserved, WORD AclSize, WORD AceCount.
            // Copy while the owning native SD is alive, without serializing that SD.
            int length = (ushort)Marshal.ReadInt16(sacl, 2);
            int count = (ushort)Marshal.ReadInt16(sacl, 4);
            if (length < 8 || count != 1) throw new Exception("LABEL ACL header mismatch: path=" + path + " AclSize=" + length + " AceCount=" + count);
            byte[] bytes = new byte[length]; Marshal.Copy(sacl, bytes, 0, length);
            var acl = new RawAcl(bytes, 0);
            if (acl.Count != 1 || (int)acl[0].AceType != 17) throw new Exception("LABEL ACL requires one mandatory ACE: " + path);
            return acl;
        } finally { LocalFree(sd); }
    }
    static string Expected(bool directory, bool low)
    {
        string sid = WindowsIdentity.GetCurrent().User.Value;
        string inherit = directory ? "OICI" : "";
        return "O:" + sid + "D:P(A;" + inherit + ";FA;;;" + sid + ")(A;" + inherit + ";FA;;;SY)S:(ML;" + inherit + ";NW;;;" + (low ? "LW" : "ME") + ")";
    }
    public static object Observe(string path, bool directory, bool low, bool apply)
    {
        for (string ancestor = Path.GetDirectoryName(path); !String.IsNullOrEmpty(ancestor); ancestor = Path.GetDirectoryName(ancestor)) {
            using (SafeFileHandle parent = CreateFileW(ancestor, 0x80, 7, IntPtr.Zero, 3, 0x00200000 | 0x02000000, IntPtr.Zero)) {
                if (parent.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                FileInfo parentInfo; Check(GetFileInformationByHandle(parent, out parentInfo));
                if ((parentInfo.attributes & 0x400) != 0 || (parentInfo.attributes & 0x10) == 0) throw new Exception("Native ancestor reparse/type refused");
                var parentName = new System.Text.StringBuilder(32768);
                uint parentCount = GetFinalPathNameByHandleW(parent, parentName, (uint)parentName.Capacity, 0);
                if (parentCount == 0 || parentCount >= parentName.Capacity || !String.Equals(parentName.ToString().TrimEnd('\\'), ("\\\\?\\" + ancestor).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new Exception("Native ancestor physical mismatch");
            }
        }
        // OPEN_REPARSE_POINT prevents following the final component. The JS owner checks
        // every ancestor too; native physical name and identity are re-observed each time.
        using (SafeFileHandle h = CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x00200000 | 0x02000000, IntPtr.Zero)) {
            if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            FileInfo info; Check(GetFileInformationByHandle(h, out info));
            if ((info.attributes & 0x400) != 0 || ((info.attributes & 0x10) != 0) != directory || (!directory && info.links != 1)) throw new Exception("Reparse/type/hardlink refused");
            var physical = new System.Text.StringBuilder(32768);
            uint count = GetFinalPathNameByHandleW(h, physical, (uint)physical.Capacity, 0);
            if (count == 0 || count >= physical.Capacity || !String.Equals(physical.ToString(), "\\\\?\\" + path, StringComparison.OrdinalIgnoreCase)) throw new Exception("Physical path mismatch");
            string expected = Expected(directory, low);
            if (apply) {
                // Never take ownership: ownership must already be the same Human SID.
                var before = QueryDescriptor(path, 1 | 4);
                if (before.Owner == null || before.Owner.Value != WindowsIdentity.GetCurrent().User.Value) throw new Exception("Foreign owner refused");
                IntPtr sd; uint size; Check(ConvertStringSecurityDescriptorToSecurityDescriptorW(expected, 1, out sd, out size));
                try {
                    bool present, defaulted; IntPtr dacl, sacl;
                    Check(GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted));
                    if (!present || dacl == IntPtr.Zero) throw new Exception("Missing DACL");
                    Check(GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted));
                    if (!present || sacl == IntPtr.Zero) throw new Exception("Missing MIC");
                    // Request WRITE_DAC and LABEL authority independently, matching the
                    // production proof fixture. Never request SACL_SECURITY_INFORMATION
                    // or enable SeSecurityPrivilege for a mandatory-label operation.
                    uint error = SetNamedSecurityInfoW(path, 1, 0x80000004U, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
                    if (error != 0) throw new Win32Exception((int)error, "Set protected DACL failed: " + path + " (Win32=" + error + ")");
                    error = SetNamedSecurityInfoW(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
                    if (error != 0) throw new Win32Exception((int)error, "Set mandatory label failed: " + path + " (Win32=" + error + ")");
                } finally { LocalFree(sd); }
            }
            var actual = QueryDescriptor(path, 1 | 4);
            string observed = actual.GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
            var mandatoryLabel = QueryMandatoryLabel(path);
            string mandatoryLabelAuthority = AceAuthority(mandatoryLabel[0]);
            var wanted = new RawSecurityDescriptor(expected);
            // ACE order is not authority. Compare complete semantic multisets, retaining
            // multiplicity, SID, type, mask and every flag; never ignore inherited ACEs.
            string detail = " path=" + path + " expected=" + expected + " observedAccess=" + observed
                + " observedMandatoryLabel=" + mandatoryLabelAuthority
                + " expectedControl=" + wanted.ControlFlags + " observedControl=" + actual.ControlFlags;
            if (actual.Owner == null || actual.Owner.Value != wanted.Owner.Value) throw new Exception("Security owner mismatch" + detail);
            if ((actual.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0) throw new Exception("DACL not protected" + detail);
            CompareAcl(actual.DiscretionaryAcl, wanted.DiscretionaryAcl, "DACL", detail);
            CompareAcl(mandatoryLabel, wanted.SystemAcl, "MIC", detail);
            return new { path=path, directory=directory, owner=actual.Owner.Value, sddl=observed, mandatoryLabelAuthority=mandatoryLabelAuthority, volume=info.volume, fileId=info.indexHigh.ToString("x8") + info.indexLow.ToString("x8"), links=info.links, integrity=low ? "LOW" : "MEDIUM", noWriteUp=true, inheritable=directory, protectedDacl=true };
        }
    }
    static string AceAuthority(GenericAce ace)
    {
        // ACCESS_ALLOWED_ACE and SYSTEM_MANDATORY_LABEL_ACE share HEADER, MASK,
        // SID layout. Refuse object/callback/unknown ACEs rather than dropping data.
        int type = (int)ace.AceType;
        if (type != 0 && type != 17) throw new Exception("Unexpected authority ACE type=" + type);
        byte[] bytes = new byte[ace.BinaryLength]; ace.GetBinaryForm(bytes, 0);
        if (bytes.Length < 16) throw new Exception("Truncated authority ACE");
        var sid = new SecurityIdentifier(bytes, 8);
        if (bytes.Length != 8 + sid.BinaryLength) throw new Exception("Unexpected authority ACE payload");
        return type + ":" + (int)ace.AceFlags + ":" + BitConverter.ToUInt32(bytes, 4) + ":" + sid.Value;
    }
    static void CompareAcl(RawAcl actual, RawAcl expected, string label, string detail)
    {
        if (actual == null || expected == null) throw new Exception(label + " missing ACL" + detail);
        var a = new System.Collections.Generic.List<string>();
        var b = new System.Collections.Generic.List<string>();
        try {
            for (int i = 0; i < actual.Count; i++) a.Add(AceAuthority(actual[i]));
            for (int i = 0; i < expected.Count; i++) b.Add(AceAuthority(expected[i]));
        } catch (Exception e) { throw new Exception(label + " semantic decode failed" + detail, e); }
        a.Sort(StringComparer.Ordinal); b.Sort(StringComparer.Ordinal);
        string observed = String.Join("|", a.ToArray()), wanted = String.Join("|", b.ToArray());
        if (observed != wanted) throw new Exception(label + " authority mismatch expectedACEs=" + wanted + " observedACEs=" + observed + detail);
    }
}
