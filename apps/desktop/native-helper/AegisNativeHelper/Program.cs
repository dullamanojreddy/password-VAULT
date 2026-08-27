// Entry point: wires the UIA focus watcher to the named-pipe transport.
// Runs headless (no window of its own) at the current user's privilege
// level — never elevated.
//
// The re-validation in HandleInsertRequest is the heart of spec requirement
// #9: between the moment a field was detected and the moment the user
// approves insertion, the foreground window / process / control could all
// have changed (deliberately, by an attacker racing the dialog). Every one
// of those is re-checked here against the values captured at detection
// time, and any mismatch refuses the insert.
using System.Text.Json;
using System.Windows.Automation;

namespace AegisNativeHelper;

public static class Program
{
    private static DetectedField? _lastDetected;
    private static AutomationElement? _lastElement;
    private static bool _paused;

    public static async Task<int> Main()
    {
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

        var pipe = new PipeServer();
        using var watcher = new UiaWatcher();

        watcher.FieldDetected += detected =>
        {
            if (_paused) return;
            _lastDetected = detected;
            _lastElement = AutomationElement.FocusedElement;
            pipe.Send(new
            {
                type = "field-detected",
                payload = new FieldDetectedPayload
                {
                    Classification = ScreenClassificationJson.ToWire(detected.Classification.Kind),
                    Confidence = detected.Classification.Confidence,
                    Control = new ControlDescriptor { AutomationId = detected.AutomationId, Name = detected.Context.Name },
                    Process = new ProcessDescriptor { Pid = detected.ProcessId, ProcessName = detected.AppIdentity.ProcessName },
                    AppIdentity = detected.AppIdentity,
                    Window = new WindowDescriptor { Title = detected.Context.WindowTitle },
                },
            });
        };

        watcher.FieldLost += () =>
        {
            _lastDetected = null;
            _lastElement = null;
            pipe.Send(new { type = "field-lost", payload = new { } });
        };

        watcher.UnsupportedTarget += reason =>
            pipe.Send(new { type = "unsupported-target", payload = new UnsupportedTargetPayload { Reason = reason } });

        pipe.MessageReceived += envelope => HandleMessage(pipe, envelope);

        pipe.Send(new { type = "hello", payload = new { version = "0.1.0" } });

        await pipe.RunAsync(cts.Token);
        return 0;
    }

    private static void HandleMessage(PipeServer pipe, Envelope envelope)
    {
        switch (envelope.Type)
        {
            case "insert-request":
            {
                var req = envelope.Payload.Deserialize<InsertRequestPayload>();
                if (req is null) return;
                var result = HandleInsertRequest(req);
                pipe.Send(new { type = "insert-result", payload = result });
                break;
            }
            case "set-paused":
            {
                var payload = envelope.Payload.Deserialize<SetPausedPayload>();
                if (payload is not null) _paused = payload.Paused;
                break;
            }
            case "shutdown":
                Environment.Exit(0);
                break;
        }
    }

    /// <summary>
    /// Re-validates EVERYTHING about the target before writing a secret into
    /// it. Any single mismatch refuses the insert — we never "best effort"
    /// our way into typing a password somewhere unintended.
    /// </summary>
    private static InsertResultPayload HandleInsertRequest(InsertRequestPayload req)
    {
        InsertResultPayload Refuse(string error) =>
            new() { RequestId = req.RequestId, Ok = false, Error = error };

        if (_lastDetected is null || _lastElement is null)
            return Refuse("no active detected field");

        // 1. The focused element must still be the one we detected.
        AutomationElement focused;
        try { focused = AutomationElement.FocusedElement; }
        catch (ElementNotAvailableException) { return Refuse("focused element is no longer available"); }

        AutomationElement.AutomationElementInformation focusedInfo;
        try { focusedInfo = focused.Current; }
        catch (ElementNotAvailableException) { return Refuse("focused element vanished during validation"); }

        // 2. Automation ID must match the one captured at detection time.
        if ((focusedInfo.AutomationId ?? string.Empty) != req.ExpectedAutomationId)
            return Refuse("focused control changed since detection");

        // 3. Process ID must match.
        if (focusedInfo.ProcessId != req.ExpectedProcessId)
            return Refuse("foreground process changed since detection");

        // 4. Executable/package identity must STILL resolve to the same
        //    verified identity — a PID can be recycled, so matching the pid
        //    alone is not sufficient.
        AppIdentity liveIdentity;
        try { liveIdentity = IdentityResolver.Resolve(focusedInfo.ProcessId); }
        catch (UnsupportedTargetException ex) { return Refuse($"target became unsupported: {ex.Message}"); }

        if (!IdentityComparer.Matches(req.ExpectedIdentity, liveIdentity))
            return Refuse("application identity no longer matches the credential's bound identity");

        // 5. Still a password control (never write a secret into a field
        //    that has since become a plain, visible text box).
        bool isPassword;
        try { isPassword = (bool)(focused.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty) ?? false); }
        catch { isPassword = false; }
        if (!isPassword) return Refuse("target control is no longer a password field");

        // 6. ValuePattern only — no simulated-keystroke fallback.
        return UiaWatcher.TryInsertPassword(focused, req.Password)
            ? new InsertResultPayload { RequestId = req.RequestId, Ok = true }
            : Refuse("control does not expose a settable UI Automation value (unsupported target)");
    }
}
