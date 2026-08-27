// Named pipe transport, secured by a PipeSecurity ACL scoped to the current
// Windows user — that ACL IS the authentication boundary (see
// electron/main/native-protocol.js's header comment for why no shared-
// secret token is used instead). Newline-delimited JSON framing, one client
// at a time (the Electron app), auto-recovering if that client disconnects.
using System.IO.Pipes;
using System.IO.Pipes.AccessControl;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace AegisNativeHelper;

public sealed class PipeServer : IDisposable
{
    private const string PipeName = "aegis-native-helper";
    private StreamWriter? _writer;
    private readonly object _writerLock = new();

    public event Action<Envelope>? MessageReceived;

    public async Task RunAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            var security = BuildCurrentUserOnlySecurity();
            using var stream = NamedPipeServerStreamAcl.Create(
                PipeName, PipeDirection.InOut, maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous,
                inBufferSize: 0, outBufferSize: 0, pipeSecurity: security);

            try
            {
                await stream.WaitForConnectionAsync(token);

                lock (_writerLock) { _writer = new StreamWriter(stream, Encoding.UTF8) { AutoFlush = true }; }
                using var reader = new StreamReader(stream, Encoding.UTF8);

                string? line;
                while ((line = await reader.ReadLineAsync(token)) is not null)
                {
                    Dispatch(line);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (IOException)
            {
                // Client (Electron) disconnected — loop back and wait for a
                // reconnect rather than treating this as fatal.
            }
            finally
            {
                lock (_writerLock) { _writer = null; }
            }
        }
    }

    private void Dispatch(string line)
    {
        try
        {
            var envelope = JsonSerializer.Deserialize<Envelope>(line);
            if (envelope is not null) MessageReceived?.Invoke(envelope);
        }
        catch (JsonException)
        {
            // Malformed frame from the client — drop it, keep the pipe alive.
        }
    }

    /// <summary>Best-effort send; silently no-ops if nothing is connected —
    /// the next field-detected event will resync state once Electron
    /// reconnects, so there is nothing to queue or retry here.</summary>
    public void Send(object message)
    {
        lock (_writerLock)
        {
            if (_writer is null) return;
            try { _writer.WriteLine(JsonSerializer.Serialize(message)); }
            catch (IOException) { /* client just disconnected mid-write */ }
        }
    }

    private static PipeSecurity BuildCurrentUserOnlySecurity()
    {
        var security = new PipeSecurity();
        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("could not resolve the current Windows user SID");
        security.SetAccessRule(new PipeAccessRule(currentUser, PipeAccessRights.ReadWrite, AccessControlType.Allow));
        // No rule is granted to any other identity (Everyone, Authenticated
        // Users, etc.) — the absence of a grant is the deny. This is what
        // makes the pipe itself the auth boundary instead of a token.
        return security;
    }

    public void Dispose() { }
}
