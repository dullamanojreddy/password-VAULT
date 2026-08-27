using AegisNativeHelper;
using Xunit;

namespace AegisNativeHelper.Tests;

public class IdentityComparerTests
{
    [Fact]
    public void MatchesOnPackageFamilyId()
    {
        var saved = new AppIdentity { Type = "uwp", PackageFamilyId = "Contoso.App_8wekyb3d8bbwe" };
        var observed = new AppIdentity { Type = "uwp", PackageFamilyId = "Contoso.App_8wekyb3d8bbwe" };
        Assert.True(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void RejectsDifferentPackageFamilyId()
    {
        var saved = new AppIdentity { Type = "uwp", PackageFamilyId = "Contoso.App_8wekyb3d8bbwe" };
        var observed = new AppIdentity { Type = "uwp", PackageFamilyId = "Evil.App_1234567890abc" };
        Assert.False(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void MatchesOnExecutableHash()
    {
        var saved = new AppIdentity { Type = "win32", ExecutableHash = "abc123" };
        var observed = new AppIdentity { Type = "win32", ExecutableHash = "abc123" };
        Assert.True(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void RejectsDifferentExecutableHash_EvenWithSameProcessName()
    {
        var saved = new AppIdentity { Type = "win32", ExecutableHash = "abc123", ProcessName = "app" };
        var observed = new AppIdentity { Type = "win32", ExecutableHash = "TAMPERED", ProcessName = "app" };
        Assert.False(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void RefusesToMatchOnProcessNameAlone()
    {
        // Neither side has a strong signal — a shared process name proves
        // nothing, so this must NOT match.
        var saved = new AppIdentity { Type = "win32", ProcessName = "chrome" };
        var observed = new AppIdentity { Type = "win32", ProcessName = "chrome" };
        Assert.False(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void RejectsMismatchedIdentityType()
    {
        var saved = new AppIdentity { Type = "uwp", PackageFamilyId = "x" };
        var observed = new AppIdentity { Type = "win32", ExecutableHash = "x" };
        Assert.False(IdentityComparer.Matches(saved, observed));
    }

    [Fact]
    public void RejectsWhenOnlyOneSideHasAStrongSignal()
    {
        var saved = new AppIdentity { Type = "win32", ExecutableHash = "abc123" };
        var observed = new AppIdentity { Type = "win32", ProcessName = "app" };
        Assert.False(IdentityComparer.Matches(saved, observed));
    }
}

public class IdentityResolverTests
{
    [Fact]
    public void Resolve_ThrowsUnsupportedTarget_ForNonexistentProcess()
    {
        // PID 0 is the System Idle Process pseudo-PID — never a valid target.
        Assert.Throws<UnsupportedTargetException>(() => IdentityResolver.Resolve(-1));
    }

    [Fact]
    public void Resolve_ProducesWin32IdentityWithHash_ForTheCurrentTestProcess()
    {
        var identity = IdentityResolver.Resolve(Environment.ProcessId);
        Assert.Equal("win32", identity.Type);
        Assert.False(string.IsNullOrWhiteSpace(identity.ExecutableHash));
        Assert.Equal(64, identity.ExecutableHash!.Length); // sha256 hex
    }

    [Fact]
    public void Resolve_IsStable_ForTheSameProcess()
    {
        var a = IdentityResolver.Resolve(Environment.ProcessId);
        var b = IdentityResolver.Resolve(Environment.ProcessId);
        Assert.True(IdentityComparer.Matches(a, b));
    }
}
