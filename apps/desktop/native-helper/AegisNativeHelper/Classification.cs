// Pure classification logic — no UI Automation calls in this file, so it is
// directly unit-testable (see AegisNativeHelper.Tests/ClassificationTests.cs)
// without a live desktop session. UiaWatcher.cs is responsible for gathering
// a FieldContext from the real UIA tree and handing it to Classify().
//
// Windows controls don't carry HTML's `autocomplete="new-password"` signal,
// so this leans more heavily on AutomationId/Name/window-title text than the
// Chrome extension's classifier does — which is exactly why confidence is
// reported alongside the verdict rather than a bare yes/no.
using System.Text.RegularExpressions;

namespace AegisNativeHelper;

public sealed record FieldContext(
    string AutomationId,
    string Name,
    string WindowTitle,
    IReadOnlyList<string> SiblingControlNames,
    bool IsPassword
);

public sealed record ClassificationResult(ScreenClassification Kind, double Confidence);

public static class Classification
{
    private static readonly Regex NewPasswordHints = new(
        @"new.?password|create.?password|choose.?a.?password|confirm.?password|password.?confirm|repeat.?password",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex CurrentPasswordHints = new(
        @"current.?password|log.?in.?password|^password$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ResetHints = new(
        @"reset.?password|forgot.?password|change.?password|update.?password",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SignupHints = new(
        @"sign.?up|signup|register|create.?account|join|new.?account",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex LoginHints = new(
        @"log.?in|sign.?in|welcome.?back",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static ClassificationResult Classify(FieldContext ctx)
    {
        if (!ctx.IsPassword)
            return new ClassificationResult(ScreenClassification.Unknown, 0.0);

        var text = string.Join(' ', new[] { ctx.AutomationId, ctx.Name, ctx.WindowTitle }
            .Concat(ctx.SiblingControlNames)
            .Where(s => !string.IsNullOrWhiteSpace(s)));

        bool hasNewSignal = NewPasswordHints.IsMatch(text);
        bool hasCurrentSignal = CurrentPasswordHints.IsMatch(text);
        bool hasResetSignal = ResetHints.IsMatch(text);
        bool hasSignupContext = SignupHints.IsMatch(text);
        bool hasLoginContext = LoginHints.IsMatch(text);

        // Strongest, least ambiguous signal first: a reset/forgot-password
        // flow is unmistakable regardless of which other hints also fire.
        if (hasResetSignal)
            return new ClassificationResult(ScreenClassification.PasswordChange, 0.9);

        if (hasNewSignal && !hasCurrentSignal)
        {
            return hasLoginContext && !hasSignupContext
                ? new ClassificationResult(ScreenClassification.PasswordChange, 0.75) // "new password" inside an otherwise-login/account-security window
                : new ClassificationResult(ScreenClassification.Signup, 0.8);
        }

        if (hasCurrentSignal)
            return new ClassificationResult(ScreenClassification.Login, 0.85);

        // No field-level signal — fall back to window-title/context clues,
        // reported with lower confidence since it's the least reliable path.
        if (hasSignupContext) return new ClassificationResult(ScreenClassification.Signup, 0.5);
        if (hasLoginContext) return new ClassificationResult(ScreenClassification.Login, 0.5);

        return new ClassificationResult(ScreenClassification.Unknown, 0.2);
    }
}
