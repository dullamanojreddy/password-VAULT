from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True)
    username: str = Field(unique=True, index=True)
    name: str
    role: str = "user"
    salt: str
    verifier: str
    status: str = "active"
    mfa: bool = False
    rotation_required: bool = False
    phone: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    last_seen: datetime = Field(default_factory=utc_now)


class Item(SQLModel, table=True):
    __tablename__ = "items"

    id: str = Field(primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    app: str
    username: str
    url: str | None = None
    category: str = "Other"
    password_alg: str
    password_iv: str
    password_ct: str
    strength: str
    entropy: int
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    favorite: bool = False

    # Nullable for records created before compromise handling was introduced.
    locked: bool | None = Field(default=False)
    compromised_at: datetime | None = None
    compromise_reason: str | None = None
    breach_notified_at: datetime | None = None

    source: str | None = None
    origin_hash: str | None = None
    app_identity: str | None = None


class AuditEvent(SQLModel, table=True):
    __tablename__ = "audit_events"

    id: str = Field(primary_key=True)
    ts: datetime = Field(default_factory=utc_now, index=True)
    actor: str
    role: str
    action: str
    detail: str
    severity: str
    ip: str


class PolicySettings(SQLModel, table=True):
    __tablename__ = "policy_settings"

    id: int = Field(default=1, primary_key=True)
    min_length: int = 14
    require_upper: bool = True
    require_lower: bool = True
    require_digit: bool = True
    require_symbol: bool = True
    min_entropy: int = 60
    block_breached: bool = True
    block_reuse: bool = True
    rotation_days: int = 90
    auto_lock_minutes: int = 5
    clipboard_clear_seconds: int = 15
