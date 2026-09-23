using System;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Web.Script.Serialization;

// No DNS, providers, credentials, arbitrary payloads or external destinations.
public static class WfpEgressProbe
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 4 || (args[0] != "tcp" && args[0] != "udp")) throw new ArgumentException("Strict syntax: tcp|udp literal-address port nonce");
            IPAddress address;
            int port;
            Guid nonce;
            if (!IPAddress.TryParse(args[1], out address) || !Int32.TryParse(args[2], out port) || port < 1024 || port > 65535 || !Guid.TryParseExact(args[3], "D", out nonce)) throw new ArgumentException("Invalid bounded endpoint");
            bool local = IPAddress.IsLoopback(address);
            foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
                if (nic.OperationalStatus == OperationalStatus.Up)
                    foreach (UnicastIPAddressInformation item in nic.GetIPProperties().UnicastAddresses)
                        if (item.Address.Equals(address)) local = true;
            if (!local || (args[0] == "udp" && !address.Equals(IPAddress.Loopback))) throw new ArgumentException("Only assigned local addresses accepted");
            string outcome = "UNKNOWN";
            int error = 0;
            using (Socket socket = new Socket(address.AddressFamily, args[0] == "tcp" ? SocketType.Stream : SocketType.Dgram, args[0] == "tcp" ? ProtocolType.Tcp : ProtocolType.Udp))
            {
                socket.SendTimeout = 1200;
                socket.ReceiveTimeout = 1200;
                try
                {
                    if (args[0] == "tcp")
                    {
                        IAsyncResult pending = socket.BeginConnect(new IPEndPoint(address, port), null, null);
                        using (System.Threading.WaitHandle wait = pending.AsyncWaitHandle)
                        {
                            if (!wait.WaitOne(1200)) outcome = "TIMEOUT";
                            else { socket.EndConnect(pending); outcome = "CONNECTED"; }
                        }
                    }
                    else { socket.SendTo(nonce.ToByteArray(), new IPEndPoint(address, port)); outcome = "SENT"; }
                }
                catch (SocketException ex) { error = (int)ex.SocketErrorCode; outcome = "SOCKET_ERROR"; }
            }
            Console.WriteLine(new JavaScriptSerializer().Serialize(new { schema = "wfp-local-target", protocol = args[0], address = address.ToString(), port = port, nonce = nonce.ToString("D"), outcome = outcome, socketError = error }));
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine(new JavaScriptSerializer().Serialize(new { schema = "wfp-local-target", outcome = "INVALID_INVOCATION", error = ex.Message }));
            return 2;
        }
    }
}
