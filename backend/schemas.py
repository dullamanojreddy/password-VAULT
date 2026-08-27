from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


security_logger = logging.getLogger("aegis.security")

Role = Literal["user", "admin"]
Status = Literal["active", "suspended"]
Strength = Literal["critical", "weak", "fair", "strong", "elite"]
Severity = Literal["info", "warn", "critical"]
CompromiseReason = Literal["breach", "reuse", "admin-flag"]
Source = Literal["web", "extension", "desktop"]

FORBIDDEN_FIELD_NAMES = {
    "password",
    "plaintext",
    "key",
    "masterpassword",
    "token",
    "secret",
}


def _normalized_key(value: object) -> str:
    return "".join(ch for ch in str(value).lower() if ch.isalnum())


def _find_forbidden_field(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if _normalized_key(key) in FORBIDDEN_FIELD_NAMES:
                return str(key)
            found = _find_forbidden_field(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = _find_forbidden_field(nested)
            if found:
                return found
    return None


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RegisterRequest(StrictModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=120)
    salt: str = Field(min_length=1, max_length=4096)
    verifier: str = Field(min_length=1, max_length=4096)
    role: Role = "user"


class VerifyRequest(StrictModel):
    username: str = Field(min_length=1, max_length=64)
    verifier: str = Field(min_length=1, max_length=4096)


class UserView(StrictModel):
    id: str
    username: str
    name: str
    role: Role
    salt: str
    status: Status
    mfa: bool
    rotation_required: bool = Field(serialization_alias="rotationRequired")
    phone: str | None
    created_at: datetime = Field(serialization_alias="createdAt")
    last_seen: datetime = Field(serialization_alias="lastSeen")


class UserStatusRequest(StrictModel):
    status: Status


class EncryptedBlob(StrictModel):
    # These strings are opaque. The backend intentionally does not decode,
    # normalize, decrypt, or otherwise inspect their contents.
    alg: str = Field(min_length=1, max_length=64)
    iv: str = Field(min_length=1, max_length=4096)
    ct: str = Field(min_length=1, max_length=1_000_000)


class AppIdentity(StrictModel):
    type: str = Field(min_length=1, max_length=64)
    executable_hash: str | None = Field(default=None, alias="executableHash", max_length=512)
    package_family_id: str | None = Field(default=None, alias="packageFamilyId", max_length=512)
    publisher: str | None = Field(default=None, max_length=512)


class ItemWrite(StrictModel):
    app: str = Field(min_length=1, max_length=200)
    username: str = Field(min_length=1, max_length=320)
    url: str | None = Field(default=None, max_length=2048)
    category: str = Field(default="Other", max_length=100)
    password: EncryptedBlob
    strength: Strength
    entropy: int = Field(ge=0, le=1_000_000)
    favorite: bool = False
    source: Source | None = None
    origin_hash: str | None = Field(default=None, alias="originHash", max_length=512)
    app_identity: AppIdentity | None = Field(default=None, alias="appIdentity")


class ItemView(StrictModel):
    id: str
    user_id: str = Field(serialization_alias="userId")
    app: str
    username: str
    url: str | None
    category: str
    password: EncryptedBlob | None = None
    strength: Strength
    entropy: int
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")
    favorite: bool
    locked: bool
    compromised_at: datetime | None = Field(default=None, serialization_alias="compromisedAt")
    compromise_reason: CompromiseReason | None = Field(default=None, serialization_alias="compromiseReason")
    breach_notified_at: datetime | None = Field(default=None, serialization_alias="breachNotifiedAt")
    source: Source | None
    origin_hash: str | None = Field(default=None, serialization_alias="originHash")
    app_identity: AppIdentity | None = Field(default=None, serialization_alias="appIdentity")


class AdminItemView(ItemView):
    owner: str
    owner_phone: str | None = Field(default=None, serialization_alias="ownerPhone")


class PolicyPayload(StrictModel):
    min_length: int = Field(default=14, alias="minLength", ge=8, le=256)
    require_upper: bool = Field(default=True, alias="requireUpper")
    require_lower: bool = Field(default=True, alias="requireLower")
    require_digit: bool = Field(default=True, alias="requireDigit")
    require_symbol: bool = Field(default=True, alias="requireSymbol")
    min_entropy: int = Field(default=60, alias="minEntropy", ge=0, le=1024)
    block_breached: bool = Field(default=True, alias="blockBreached")
    block_reuse: bool = Field(default=True, alias="blockReuse")
    rotation_days: int = Field(default=90, alias="rotationDays", ge=1, le=3650)
    auto_lock_minutes: int = Field(default=5, alias="autoLockMinutes", ge=1, le=1440)
    clipboard_clear_seconds: int = Field(default=15, alias="clipboardClearSeconds", ge=1, le=300)


class PolicyUpdate(StrictModel):
    min_length: int | None = Field(default=None, alias="minLength", ge=8, le=256)
    require_upper: bool | None = Field(default=None, alias="requireUpper")
    require_lower: bool | None = Field(default=None, alias="requireLower")
    require_digit: bool | None = Field(default=None, alias="requireDigit")
    require_symbol: bool | None = Field(default=None, alias="requireSymbol")
    min_entropy: int | None = Field(default=None, alias="minEntropy", ge=0, le=1024)
    block_breached: bool | None = Field(default=None, alias="blockBreached")
    block_reuse: bool | None = Field(default=None, alias="blockReuse")
    rotation_days: int | None = Field(default=None, alias="rotationDays", ge=1, le=3650)
    auto_lock_minutes: int | None = Field(default=None, alias="autoLockMinutes", ge=1, le=1440)
    clipboard_clear_seconds: int | None = Field(default=None, alias="clipboardClearSeconds", ge=1, le=300)

    @model_validator(mode="after")
    def require_a_change(self):
        if not self.model_fields_set:
            raise ValueError("At least one policy field is required")
        return self


class AuditCreate(StrictModel):
    action: str = Field(min_length=1, max_length=120)
    detail: str = Field(default="", max_length=2000)
    severity: Severity = "info"

    @model_validator(mode="before")
    @classmethod
    def reject_secret_fields(cls, value: Any) -> Any:
        forbidden = _find_forbidden_field(value)
        if forbidden:
            security_logger.warning("Rejected forbidden field on audit payload")
            raise ValueError("Audit payload contains a forbidden field")
        return value


class AuditEventView(StrictModel):
    id: str
    ts: datetime
    actor: str
    role: str
    action: str
    detail: str
    severity: Severity
    ip: str


class AlertVariables(StrictModel):
    app: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=500)
    when: str = Field(min_length=1, max_length=120)


class AlertRequest(StrictModel):
    to: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    template: Literal["breach_alert"]
    variables: AlertVariables

    @model_validator(mode="before")
    @classmethod
    def reject_secret_fields(cls, value: Any) -> Any:
        forbidden = _find_forbidden_field(value)
        if forbidden:
            security_logger.warning("Rejected forbidden field on WhatsApp alert payload")
            raise ValueError("Alert payload contains a forbidden field")
        return value
