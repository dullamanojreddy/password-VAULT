// Real UI Automation wiring: focus-change events only. Deliberately absent
// from this entire file — by design, not oversight — is anything resembling
// a global keyboard hook, GetAsyncKeyState polling, screen capture, OCR, or
// clipboard monitoring. Insertion happens exclusively through UIA's
// ValuePattern; if a target doesn't expose it, we report it unsupported
// (see InsertPassword below) rather than falling back to simulated
// keystrokes.
using System.Diagnostics;
using System.Windows.Automation;

namespace AegisNativeHelper;

public sealed record DetectedField(
    FieldContext Context,
    ClassificationResult Classification,
    int ProcessId,
    AppIdentity AppIdentity,
    string AutomationId
);

public sealed class UiaWatcher : IDisposable
{
    // Processes we deliberately never engage with, so the desktop assistant
    // can't double-fire alongside the Chrome extension inside the browser's
    // own password fields (spec requirement #4 under FEATURE 2).
    private static readonly HashSet<string> IgnoredProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi",
    };

    private readonly AutomationFocusChangedEventHandler _handler;
    private AutomationElement? _lastElement;

    public event Action<DetectedField>? FieldDetected;
    public event Action? FieldLost;
    public event Action<string>? UnsupportedTarget;

    public UiaWatcher()
    {
        _handler = OnFocusChanged;
        Automation.AddAutomationFocusChangedEventHandler(_handler);
    }

    private void OnFocusChanged(object sender, AutomationFocusChangedEventArgs e)
    {
        // A UIA event handler runs on Windows' event-delivery thread — any
        // unhandled exception here can destabilize the whole automation
        // subsystem for this process, so every path below is defensive.
        try
        {
            if (sender is not AutomationElement element) return;

            AutomationElement.AutomationElementInformation current;
            try { current = element.Current; }
            catch (ElementNotAvailableException) { return; } // focus already moved on

            if (current.ProcessId <= 4) return; // System Idle / System — never touch these

            string? processName = TryGetProcessName(current.ProcessId);
            if (processName is not null && IgnoredProcessNames.Contains(processName))
                return; // leave browser password fields to the Chrome extension entirely

            if (current.ControlType != ControlType.Edit)
            {
                if (ReferenceEquals(_lastElement, null)) return;
                _lastElement = null;
                FieldLost?.Invoke();
                return;
            }

            bool isPassword;
            try { isPassword = (bool)(element.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty) ?? false); }
            catch { isPassword = false; }

            if (!isPassword)
            {
                // Not every focused Edit control is interesting — only
                // report loss if we were previously tracking something.
                if (_lastElement is not null) { _lastElement = null; FieldLost?.Invoke(); }
                return;
            }

            var context = BuildFieldContext(element, current);
            var classification = Classification.Classify(context);
            if (classification.Kind == ScreenClassification.Unknown) return;

            AppIdentity identity;
            try
            {
                identity = IdentityResolver.Resolve(current.ProcessId);
            }
            catch (UnsupportedTargetException ex)
            {
                UnsupportedTarget?.Invoke(ex.Message);
                return;
            }

            _lastElement = element;
            FieldDetected?.Invoke(new DetectedField(
                context, classification, current.ProcessId, identity, current.AutomationId ?? string.Empty));
        }
        catch
        {
            // Never let a UIA callback exception propagate out of Windows'
            // event-delivery thread.
        }
    }

    private static FieldContext BuildFieldContext(AutomationElement element, AutomationElement.AutomationElementInformation current)
    {
        string windowTitle = "";
        try
        {
            var window = TreeWalker.ControlViewWalker.GetParent(element);
            var depth = 0;
            while (window is not null && depth < 12)
            {
                if (window.Current.ControlType == ControlType.Window) { windowTitle = window.Current.Name ?? ""; break; }
                window = TreeWalker.ControlViewWalker.GetParent(window);
                depth++;
            }
        }
        catch { /* best-effort only — an empty title just lowers classification confidence */ }

        var siblingNames = new List<string>();
        try
        {
            var parent = TreeWalker.ControlViewWalker.GetParent(element);
            if (parent is not null)
            {
                var child = TreeWalker.ControlViewWalker.GetFirstChild(parent);
                var count = 0;
                while (child is not null && count < 20)
                {
                    var name = child.Current.Name;
                    if (!string.IsNullOrWhiteSpace(name)) siblingNames.Add(name);
                    child = TreeWalker.ControlViewWalker.GetNextSibling(child);
                    count++;
                }
            }
        }
        catch { /* best-effort */ }

        return new FieldContext(
            AutomationId: current.AutomationId ?? "",
            Name: current.Name ?? "",
            WindowTitle: windowTitle,
            SiblingControlNames: siblingNames,
            IsPassword: true);
    }

    private static string? TryGetProcessName(int pid)
    {
        try { return Process.GetProcessById(pid).ProcessName; }
        catch { return null; }
    }

    /// <summary>
    /// Inserts <paramref name="password"/> via UIA ValuePattern only. Never
    /// falls back to SendKeys/simulated input if ValuePattern is
    /// unavailable — that would be exactly the "silent fallback to
    /// simulated keystrokes" the spec forbids. Returns false (not an
    /// exception) for an unsupported control, which the caller reports as
    /// "insert refused."
    /// </summary>
    public static bool TryInsertPassword(AutomationElement element, string password)
    {
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var patternObj))
            return false;
        try
        {
            ((ValuePattern)patternObj).SetValue(password);
            return true;
        }
        catch (ElementNotEnabledException)
        {
            return false;
        }
    }

    public void Dispose()
    {
        Automation.RemoveAutomationFocusChangedEventHandler(_handler);
    }
}
