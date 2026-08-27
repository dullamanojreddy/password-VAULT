using AegisNativeHelper;
using Xunit;

namespace AegisNativeHelper.Tests;

public class ClassificationTests
{
    private static FieldContext Ctx(
        string automationId = "", string name = "", string windowTitle = "",
        string[]? siblings = null, bool isPassword = true)
        => new(automationId, name, windowTitle, siblings ?? Array.Empty<string>(), isPassword);

    [Fact]
    public void NonPasswordControl_IsUnknownWithZeroConfidence()
    {
        var result = Classification.Classify(Ctx(name: "Username", isPassword: false));
        Assert.Equal(ScreenClassification.Unknown, result.Kind);
        Assert.Equal(0.0, result.Confidence);
    }

    [Fact]
    public void CurrentPasswordName_ClassifiesAsLogin()
    {
        var result = Classification.Classify(Ctx(name: "Password", windowTitle: "Sign in"));
        Assert.Equal(ScreenClassification.Login, result.Kind);
    }

    [Fact]
    public void NewPasswordAutomationId_ClassifiesAsSignup()
    {
        var result = Classification.Classify(Ctx(automationId: "NewPasswordBox", windowTitle: "Create account"));
        Assert.Equal(ScreenClassification.Signup, result.Kind);
    }

    [Fact]
    public void ConfirmPasswordSibling_ClassifiesAsSignup()
    {
        var result = Classification.Classify(Ctx(
            automationId: "pw1", windowTitle: "Register",
            siblings: new[] { "Confirm password" }));
        Assert.Equal(ScreenClassification.Signup, result.Kind);
    }

    [Fact]
    public void ResetPasswordWindow_ClassifiesAsPasswordChange()
    {
        var result = Classification.Classify(Ctx(windowTitle: "Reset password"));
        Assert.Equal(ScreenClassification.PasswordChange, result.Kind);
    }

    [Fact]
    public void ChangePasswordWindow_ClassifiesAsPasswordChange()
    {
        var result = Classification.Classify(Ctx(name: "New password", windowTitle: "Change password"));
        Assert.Equal(ScreenClassification.PasswordChange, result.Kind);
    }

    [Fact]
    public void NoSignalAtAll_IsUnknownWithLowConfidence()
    {
        var result = Classification.Classify(Ctx(automationId: "textBox3", windowTitle: "Untitled"));
        Assert.Equal(ScreenClassification.Unknown, result.Kind);
        Assert.True(result.Confidence < 0.5);
    }

    [Fact]
    public void SignupContextOnly_HasLowerConfidenceThanExplicitFieldSignal()
    {
        var contextOnly = Classification.Classify(Ctx(windowTitle: "Sign up for an account"));
        var explicitSignal = Classification.Classify(Ctx(name: "New password", windowTitle: "Sign up"));
        Assert.Equal(ScreenClassification.Signup, contextOnly.Kind);
        Assert.True(explicitSignal.Confidence > contextOnly.Confidence);
    }
}
