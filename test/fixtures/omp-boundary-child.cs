using System;
using System.IO;
using System.Collections.Generic;
using System.Threading;

public static class OmpBoundaryChild
{
    static string Quote(string value) {
        var text = new System.Text.StringBuilder("\"");
        foreach (char c in value) {
            if (c == '"' || c == '\\') text.Append('\\').Append(c);
            else if (c < 32) text.Append("\\u").Append(((int)c).ToString("x4"));
            else text.Append(c);
        }
        return text.Append('"').ToString();
    }
    static string DecodePath(string value) {
        byte[] bytes = Convert.FromBase64String(value);
        if (bytes.Length == 0 || bytes.Length > 32768) throw new InvalidDataException("Path bound");
        string path = new System.Text.UTF8Encoding(false, true).GetString(bytes);
        if (!Path.IsPathRooted(path) || path.IndexOf('\0') >= 0) throw new InvalidDataException("Invalid path");
        return path;
    }
    static string Attempt(string name, Action action) {
        int error = 0;
        try { action(); }
        catch (UnauthorizedAccessException e) { error = e.HResult & 65535; }
        catch (IOException e) { error = e.HResult & 65535; }
        return "{\"name\":" + Quote(name) + ",\"success\":" + (error == 0 ? "true" : "false") + ",\"error\":" + error + "}";
    }
    public static int Main(string[] args) {
        try { return Run(args); }
        catch (Exception error) {
            // Diagnostics require only the core runtime, never an optional serializer.
            Console.Error.WriteLine("BOUNDARY_CHILD_FAILURE: " + error.ToString());
            Console.Error.Flush();
            return 70;
        }
    }
    static int Run(string[] args) {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        byte[] input;
        using (var stream = Console.OpenStandardInput()) using (var bytes = new MemoryStream()) {
            byte[] block = new byte[4096]; int count;
            while ((count = stream.Read(block, 0, block.Length)) != 0) {
                if (bytes.Length + count > 65536) throw new InvalidDataException("Input bound");
                bytes.Write(block, 0, count);
            }
            input=bytes.ToArray();
        }
        string[] lines = new System.Text.UTF8Encoding(false, true).GetString(input).Split('\n');
        if (lines.Length < 6 || lines[0] != "OMP_BOUNDARY_1" || (lines[1] != "0" && lines[1] != "1")) throw new InvalidDataException("Input protocol");
        bool wait = lines[1] == "1";
        string ledger = DecodePath(lines[2]);
        int cursor = 3, writableCount;
        if (!Int32.TryParse(lines[cursor++], out writableCount) || writableCount < 1 || writableCount > 32 || cursor + writableCount >= lines.Length) throw new InvalidDataException("Writable count");
        var writable = new List<string>();
        for (int i = 0; i < writableCount; i++) writable.Add(DecodePath(lines[cursor++]));
        int protectedCount;
        if (!Int32.TryParse(lines[cursor++], out protectedCount) || protectedCount != 3 || cursor + protectedCount != lines.Length) throw new InvalidDataException("Protected count");
        var protectedFiles = new List<string>();
        for (int i = 0; i < protectedCount; i++) protectedFiles.Add(DecodePath(lines[cursor++]));
        var operations = new List<string>();
        foreach (string dir in writable) {
            string a=Path.Combine(dir,"boundary-write"), b=Path.Combine(dir,"boundary-renamed"), sub=Path.Combine(dir,"boundary-dir");
            operations.Add(Attempt(dir+":create", () => File.WriteAllText(a,"a")));
            operations.Add(Attempt(dir+":append", () => File.AppendAllText(a,"b")));
            operations.Add(Attempt(dir+":truncate", () => { using(var f=File.Open(a,FileMode.Truncate)) {} }));
            operations.Add(Attempt(dir+":rename", () => File.Move(a,b)));
            operations.Add(Attempt(dir+":delete", () => File.Delete(b)));
            operations.Add(Attempt(dir+":mkdir", () => Directory.CreateDirectory(sub)));
            operations.Add(Attempt(dir+":rmdir", () => Directory.Delete(sub)));
        }
        foreach (string file in protectedFiles) {
            operations.Add(Attempt(file+":overwrite", () => File.WriteAllText(file,"bad")));
            operations.Add(Attempt(file+":append", () => File.AppendAllText(file,"bad")));
            operations.Add(Attempt(file+":truncate", () => { using(var f=File.Open(file,FileMode.Truncate)) {} }));
            operations.Add(Attempt(file+":rename", () => File.Move(file,file+".replaced")));
            operations.Add(Attempt(file+":delete", () => File.Delete(file)));
        }
        operations.Add(Attempt("ledger:create", () => File.WriteAllText(Path.Combine(ledger,"forbidden"),"bad")));
        operations.Add(Attempt("ledger:mkdir", () => Directory.CreateDirectory(Path.Combine(ledger,"forbidden-dir"))));
        var quotedArgs = new List<string>();
        foreach (string arg in args) quotedArgs.Add(Quote(arg));
        Console.WriteLine("{\"cwd\":" + Quote(Environment.CurrentDirectory) + ",\"args\":[" + String.Join(",", quotedArgs.ToArray()) + "],\"base64\":" + Quote(Convert.ToBase64String(input)) + ",\"eof\":true,\"operations\":[" + String.Join(",", operations.ToArray()) + "]}");
        Console.Out.Flush();
        if (wait) Thread.Sleep(Timeout.Infinite);
        return 0;
    }
}
