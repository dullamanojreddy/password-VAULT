// Resolves and compares application identity for the process behind a
// detected UI Automation element. Two halves, deliberately split:
//
//   - IdentityComparer.Matches(...) is pure and unit-tested directly
//     (AegisNativeHelper.Tests/IdentityResolverTests.cs) — this is the exact
//     logic requirement #9 depends on ("revalidate before insertion").
//   - IdentityResolver.Resolve(pid) does the real Win32/process work and is
//     NOT unit-testable without a live process to inspect; it's exercised
//     only by running the helper for real (see the desktop README's
//     "known limitations" section for what that means for verification
//     status in this environment).
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace AegisNativeHelper;

public sealed class UnsupportedTargetException(string reason) : Exception(reason);

public static class IdentityComparer
{
    /// <summary>
    /// Mirrors packages/shared/src/credential-schema.js's appIdentityMatches
    /// exactly: requires the strongest identity signal both sides share, and
    /// NEVER falls back to matching on process name alone (a name proves
    /// nothing — "chrome.exe" exists on every Windows machine).
    /// </summary>
    public static bool Matches(AppIdentity saved, AppIdentity observed)
    {
        if (saved.Type != observed.Type) return false;

        if (!string.IsNullOrEmpty(saved.PackageFamilyId) && !string.IsNullOrEmpty(observed.PackageFamilyId))
            return saved.PackageFamilyId == observed.PackageFamilyId;

        if (!string.IsNullOrEmpty(saved.ExecutableHash) && !string.IsNullOrEmpty(observed.ExecutableHash))
            return saved.ExecutableHash == observed.ExecutableHash;

        return false;
    }
}

public static class IdentityResolver
{
    /// <summary>
    /// Resolves the verified identity of the process owning <paramref name="pid"/>.
    /// Throws UnsupportedTargetException — never attempts elevation, never
    /// silently degrades to a weaker identity signal — when the process is
    /// protected, elevated relative to us, or otherwise inaccessible.
    /// </summary>
    public static AppIdentity Resolve(int pid)
    {
        Process process;
        try
        {
            process = Process.GetProcessById(pid);
        }
        catch (ArgumentException)
        {
            throw new UnsupportedTargetException($"process {pid} no longer exists");
        }

        string exePath;
        try
        {
            exePath = process.MainModule?.FileName
                ?? throw new UnsupportedTargetException($"could not resolve executable path for pid {pid}");
        }
        catch (Win32Exception)
        {
            // Access denied — typically an elevated or protected process we
            // are not allowed to inspect from a non-elevated helper. This is
            // the expected, correct outcome for those targets (spec
            // requirement #19/#20): report unsupported, never try harder by
            // requesting elevation.
            throw new UnsupportedTargetException($"access denied resolving module info for pid {pid} (likely an elevated or protected process)");
        }
        catch (InvalidOperationException)
        {
            throw new UnsupportedTargetException($"pid {pid} exited before its module info could be read");
        }

        var packageFamilyId = TryGetPackageFamilyName(process.Handle);
        if (packageFamilyId is not null)
        {
            return new AppIdentity
            {
                Type = "uwp",
                PackageFamilyId = packageFamilyId,
                ProcessName = process.ProcessName,
            };
        }

        return new AppIdentity
        {
            Type = "win32",
            ExecutableHash = HashFile(exePath),
            Publisher = TryGetSignedPublisher(exePath),
            ProcessName = process.ProcessName,
        };
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        using var sha256 = SHA256.Create();
        return Convert.ToHexStringLower(sha256.ComputeHash(stream));
    }

    private static string? TryGetSignedPublisher(string path)
    {
        try
        {
#pragma warning disable SYSLIB0057 // CreateFromSignedFile is obsolete in favor of X509CertificateLoader in newer TFMs; acceptable here pending a follow-up bump.
            using var cert = X509Certificate.CreateFromSignedFile(path);
#pragma warning restore SYSLIB0057
            return cert.Subject;
        }
        catch
        {
            return null; // unsigned executable — not an error, just no publisher signal available
        }
    }

    // ── UWP package family name resolution (P/Invoke) ───────────────────
    // GetPackageFamilyName is the documented Win32 API for resolving a
    // running process's package identity (kernel32/appmodel.h). Returns
    // null (not an exception) for a traditional, non-packaged Win32 process
    // — that's the expected, common case, not a failure.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFamilyName(IntPtr hProcess, ref int packageFamilyNameLength, System.Text.StringBuilder? packageFamilyName);

    private const int APPMODEL_ERROR_NO_PACKAGE = 15700;

    private static string? TryGetPackageFamilyName(IntPtr processHandle)
    {
        int length = 0;
        int rc = GetPackageFamilyName(processHandle, ref length, null);
        if (rc == APPMODEL_ERROR_NO_PACKAGE) return null; // not a packaged app — normal
        if (rc != 122 /* ERROR_INSUFFICIENT_BUFFER */) return null;

        var sb = new System.Text.StringBuilder(length);
        rc = GetPackageFamilyName(processHandle, ref length, sb);
        return rc == 0 ? sb.ToString() : null;
    }
}
