// Mirrors electron/main/native-protocol.js field-for-field. Keep the two in
// sync — this is the wire contract for the named pipe both processes share.
using System.Text.Json.Serialization;

namespace AegisNativeHelper;

public enum ScreenClassification
{
    Login,
    Signup,
    PasswordChange,
    Unknown,
}

public static class ScreenClassificationJson
{
    public static string ToWire(ScreenClassification c) => c switch
    {
        ScreenClassification.Login => "login",
        ScreenClassification.Signup => "signup",
        ScreenClassification.PasswordChange => "password-change",
        _ => "unknown",
    };
}

public record AppIdentity
{
    [JsonPropertyName("type")]
    public required string Type { get; init; } // "win32" | "uwp"

    [JsonPropertyName("executableHash")]
    public string? ExecutableHash { get; init; }

    [JsonPropertyName("packageFamilyId")]
    public string? PackageFamilyId { get; init; }

    [JsonPropertyName("publisher")]
    public string? Publisher { get; init; }

    [JsonPropertyName("processName")]
    public string? ProcessName { get; init; }
}

public record ControlDescriptor
{
    [JsonPropertyName("automationId")]
    public required string AutomationId { get; init; }

    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("controlType")]
    public string? ControlType { get; init; }
}

public record ProcessDescriptor
{
    [JsonPropertyName("pid")]
    public required int Pid { get; init; }

    [JsonPropertyName("processName")]
    public string? ProcessName { get; init; }
}

public record FieldDetectedPayload
{
    [JsonPropertyName("classification")]
    public required string Classification { get; init; }

    [JsonPropertyName("confidence")]
    public required double Confidence { get; init; }

    [JsonPropertyName("control")]
    public required ControlDescriptor Control { get; init; }

    [JsonPropertyName("process")]
    public required ProcessDescriptor Process { get; init; }

    [JsonPropertyName("appIdentity")]
    public required AppIdentity AppIdentity { get; init; }

    [JsonPropertyName("window")]
    public WindowDescriptor? Window { get; init; }
}

public record WindowDescriptor
{
    [JsonPropertyName("title")]
    public string? Title { get; init; }
}

public record InsertRequestPayload
{
    [JsonPropertyName("requestId")]
    public required string RequestId { get; init; }

    [JsonPropertyName("password")]
    public required string Password { get; init; }

    [JsonPropertyName("expectedIdentity")]
    public required AppIdentity ExpectedIdentity { get; init; }

    [JsonPropertyName("expectedProcessId")]
    public required int ExpectedProcessId { get; init; }

    [JsonPropertyName("expectedAutomationId")]
    public required string ExpectedAutomationId { get; init; }
}

public record InsertResultPayload
{
    [JsonPropertyName("requestId")]
    public required string RequestId { get; init; }

    [JsonPropertyName("ok")]
    public required bool Ok { get; init; }

    [JsonPropertyName("error")]
    public string? Error { get; init; }
}

public record UnsupportedTargetPayload
{
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }
}

public record SetPausedPayload
{
    [JsonPropertyName("paused")]
    public required bool Paused { get; init; }
}

/// <summary>Envelope shape: {"type": "...", "payload": {...}}. Deserialized
/// generically first (to read `type`), then re-parsed into the specific
/// payload record once we know which one applies.</summary>
public record Envelope
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    [JsonPropertyName("payload")]
    public System.Text.Json.JsonElement Payload { get; init; }
}
