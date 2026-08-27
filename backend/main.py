from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

import alerts
from alerts import AlertServiceError
from auth import (
    SlidingWindowRateLimiter,
    hash_verifier,
    issue_token,
    require_admin,
    require_auth,
    verify_verifier,
)
from db import configure_database, get_session, init_db
from models import AuditEvent, Item, PolicySettings, User, utc_now
from schemas import (
    AdminItemView,
    AlertRequest,
    AppIdentity,
    AuditCreate,
    AuditEventView,
    EncryptedBlob,
    ItemView,
    ItemWrite,
    PolicyPayload,
    PolicyUpdate,
    RegisterRequest,
    UserStatusRequest,
    UserView,
    VerifyRequest,
)


load_dotenv()

access_logger = logging.getLogger("aegis.access")
security_logger = logging.getLogger("aegis.security")


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _write_audit(
    session: Session,
    request: Request,
    *,
    actor: str,
    role: str,
    action: str,
    detail: str,
    severity: str = "info",
) -> AuditEvent:
    event = AuditEvent(
        id=str(uuid.uuid4()),
        ts=utc_now(),
        actor=actor,
        role=role,
        action=action,
        detail=detail,
        severity=severity,
        ip=_ip(request),
    )
    session.add(event)
    return event


def _user_view(user: User) -> dict:
    return UserView(
        id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
        salt=user.salt,
        status=user.status,
        mfa=user.mfa,
        rotation_required=user.rotation_required,
        phone=user.phone,
        created_at=user.created_at,
        last_seen=user.last_seen,
    ).model_dump(by_alias=True)


def _decode_app_identity(raw: str | None) -> AppIdentity | None:
    if not raw:
        return None
    try:
        return AppIdentity.model_validate(json.loads(raw))
    except (ValueError, TypeError):
        return None


def _item_view(item: Item, *, include_password: bool) -> dict:
    password = None
    if include_password:
        password = EncryptedBlob(alg=item.password_alg, iv=item.password_iv, ct=item.password_ct)

    view = ItemView(
        id=item.id,
        user_id=item.user_id,
        app=item.app,
        username=item.username,
        url=item.url,
        category=item.category,
        password=password,
        strength=item.strength,
        entropy=item.entropy,
        created_at=item.created_at,
        updated_at=item.updated_at,
        favorite=item.favorite,
        locked=bool(item.locked),
        compromised_at=item.compromised_at,
        compromise_reason=item.compromise_reason,
        breach_notified_at=item.breach_notified_at,
        source=item.source,
        origin_hash=item.origin_hash,
        app_identity=_decode_app_identity(item.app_identity),
    )
    return view.model_dump(by_alias=True, exclude_none=True)


def _admin_item_view(item: Item, owner: User) -> dict:
    password = EncryptedBlob(alg=item.password_alg, iv=item.password_iv, ct=item.password_ct)
    view = AdminItemView(
        id=item.id,
        user_id=item.user_id,
        app=item.app,
        username=item.username,
        url=item.url,
        category=item.category,
        password=password,
        strength=item.strength,
        entropy=item.entropy,
        created_at=item.created_at,
        updated_at=item.updated_at,
        favorite=item.favorite,
        locked=bool(item.locked),
        compromised_at=item.compromised_at,
        compromise_reason=item.compromise_reason,
        breach_notified_at=item.breach_notified_at,
        source=item.source,
        origin_hash=item.origin_hash,
        app_identity=_decode_app_identity(item.app_identity),
        owner=owner.username,
        owner_phone=owner.phone,
    )
    return view.model_dump(by_alias=True, exclude_none=True)


def _policy_view(policy: PolicySettings) -> dict:
    return PolicyPayload(
        min_length=policy.min_length,
        require_upper=policy.require_upper,
        require_lower=policy.require_lower,
        require_digit=policy.require_digit,
        require_symbol=policy.require_symbol,
        min_entropy=policy.min_entropy,
        block_breached=policy.block_breached,
        block_reuse=policy.block_reuse,
        rotation_days=policy.rotation_days,
        auto_lock_minutes=policy.auto_lock_minutes,
        clipboard_clear_seconds=policy.clipboard_clear_seconds,
    ).model_dump(by_alias=True)


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(require_auth)]
AdminDep = Annotated[User, Depends(require_admin)]


def create_app(database_url: str | None = None) -> FastAPI:
    if database_url:
        configure_database(database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        init_db()
        if not os.getenv("AEGIS_JWT_SECRET"):
            security_logger.warning("AEGIS_JWT_SECRET is unset; using an ephemeral development key")
        yield

    application = FastAPI(
        title="AEGIS Zero-Knowledge Vault API",
        version="1.0.0",
        description=(
            "Stores opaque AES-256-GCM ciphertext and credential metadata. "
            "The service never receives master passwords, encryption keys, or plaintext vault passwords."
        ),
        lifespan=lifespan,
    )

    allowed_origins = ["http://localhost:5173"]
    extension_origin = os.getenv("AEGIS_EXTENSION_ORIGIN")
    if extension_origin:
        if not re.fullmatch(r"chrome-extension://[a-p]{32}", extension_origin):
            raise RuntimeError("AEGIS_EXTENSION_ORIGIN must be an exact Chrome extension origin")
        allowed_origins.append(extension_origin)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    application.state.verify_limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60)
    application.state.alert_limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    application.state.revoked_tokens = set()

    @application.middleware("http")
    async def metadata_only_access_log(request: Request, call_next):
        started = time.perf_counter()
        response_status = 500
        try:
            response = await call_next(request)
            response_status = response.status_code
            return response
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            access_logger.info(
                "request method=%s path=%s status=%s user_id=%s duration_ms=%.2f",
                request.method,
                request.url.path,
                response_status,
                getattr(request.state, "user_id", "anonymous"),
                duration_ms,
            )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, __: RequestValidationError):
        return JSONResponse(status_code=422, content={"ok": False, "error": "Invalid request"})

    @application.exception_handler(HTTPException)
    async def http_error_handler(_: Request, exc: HTTPException):
        error = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": error})

    @application.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        security_logger.error(
            "Unhandled server error type=%s path=%s",
            type(exc).__name__,
            request.url.path,
        )
        return JSONResponse(status_code=500, content={"ok": False, "error": "Internal server error"})

    @application.get("/api/health")
    def health():
        return {"ok": True}

    @application.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
    def register(body: RegisterRequest, request: Request, session: SessionDep):
        username = body.username.strip().lower()
        existing = session.exec(select(User).where(User.username == username)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username is already registered")
        if body.role == "admin" and session.exec(select(User.id)).first() is not None:
            raise HTTPException(status_code=403, detail="Admin bootstrap is already complete")

        now = utc_now()
        user = User(
            id=str(uuid.uuid4()),
            username=username,
            name=body.name.strip(),
            role=body.role,
            salt=body.salt,
            verifier=hash_verifier(body.verifier),
            created_at=now,
            last_seen=now,
        )
        session.add(user)
        _write_audit(
            session,
            request,
            actor=username,
            role=body.role,
            action="auth.registered",
            detail="Account registered",
        )
        try:
            session.commit()
            session.refresh(user)
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail="Username is already registered") from exc
        return {"ok": True, "user": _user_view(user)}

    @application.post("/api/auth/verify")
    def verify(body: VerifyRequest, request: Request, session: SessionDep):
        username = body.username.strip().lower()
        if not request.app.state.verify_limiter.allow(username):
            raise HTTPException(status_code=429, detail="Too many verification attempts")

        user = session.exec(select(User).where(User.username == username)).first()
        valid = verify_verifier(body.verifier, user.verifier) if user else False
        if user is None:
            # Match the slow verifier path so account existence is harder to time.
            hash_verifier(body.verifier)

        if not valid:
            _write_audit(
                session,
                request,
                actor=username or "anonymous",
                role=user.role if user else "-",
                action="auth.failed",
                detail="Credential verification failed",
                severity="warn",
            )
            session.commit()
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if user.status != "active":
            raise HTTPException(status_code=403, detail="Account is suspended")

        user.last_seen = utc_now()
        _write_audit(
            session,
            request,
            actor=user.username,
            role=user.role,
            action="auth.verified",
            detail="Verifier accepted",
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        token = issue_token(user)
        return {"ok": True, "token": token, "user": _user_view(user)}

    @application.post("/api/auth/logout")
    def logout(request: Request, user: UserDep):
        request.app.state.revoked_tokens.add(request.state.token_jti)
        return {"ok": True}

    @application.get("/api/users")
    def list_users(_: AdminDep, session: SessionDep):
        users = session.exec(select(User).order_by(User.created_at)).all()
        return {"users": [_user_view(user) for user in users]}

    @application.post("/api/users/{user_id}/status")
    def set_user_status(
        user_id: str,
        body: UserStatusRequest,
        request: Request,
        admin: AdminDep,
        session: SessionDep,
    ):
        target = session.exec(select(User).where(User.id == user_id)).first()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        target.status = body.status
        session.add(target)
        _write_audit(
            session,
            request,
            actor=admin.username,
            role=admin.role,
            action="user.status",
            detail=f"User status changed to {body.status}",
            severity="warn" if body.status == "suspended" else "info",
        )
        session.commit()
        return {"ok": True}

    @application.post("/api/users/{user_id}/rotate")
    def require_rotation(user_id: str, request: Request, admin: AdminDep, session: SessionDep):
        target = session.exec(select(User).where(User.id == user_id)).first()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        target.rotation_required = True
        session.add(target)
        _write_audit(
            session,
            request,
            actor=admin.username,
            role=admin.role,
            action="user.rotation",
            detail="Credential rotation required",
            severity="warn",
        )
        session.commit()
        return {"ok": True}

    @application.get("/api/items")
    def list_items(user: UserDep, session: SessionDep):
        items = session.exec(
            select(Item).where(Item.user_id == user.id).order_by(Item.updated_at.desc())
        ).all()
        return {
            "items": [
                _item_view(item, include_password=not bool(item.locked))
                for item in items
            ]
        }

    @application.get("/api/items/{item_id}")
    def get_item(item_id: str, user: UserDep, session: SessionDep):
        item = session.exec(
            select(Item).where(Item.id == item_id, Item.user_id == user.id)
        ).first()
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found")
        return {"item": _item_view(item, include_password=not bool(item.locked))}

    @application.post("/api/items", status_code=status.HTTP_201_CREATED)
    def create_item(body: ItemWrite, request: Request, user: UserDep, session: SessionDep):
        now = utc_now()
        item = Item(
            id=str(uuid.uuid4()),
            user_id=user.id,
            app=body.app,
            username=body.username,
            url=body.url,
            category=body.category,
            password_alg=body.password.alg,
            password_iv=body.password.iv,
            password_ct=body.password.ct,
            strength=body.strength,
            entropy=body.entropy,
            created_at=now,
            updated_at=now,
            favorite=body.favorite,
            source=body.source,
            origin_hash=body.origin_hash,
            app_identity=(
                json.dumps(body.app_identity.model_dump(by_alias=True), separators=(",", ":"), sort_keys=True)
                if body.app_identity
                else None
            ),
        )
        session.add(item)
        _write_audit(
            session,
            request,
            actor=user.username,
            role=user.role,
            action="item.created",
            detail="Encrypted credential created",
        )
        session.commit()
        return {"ok": True, "id": item.id}

    @application.put("/api/items/{item_id}")
    def update_item(
        item_id: str,
        body: ItemWrite,
        request: Request,
        user: UserDep,
        session: SessionDep,
    ):
        item = session.exec(
            select(Item).where(Item.id == item_id, Item.user_id == user.id)
        ).first()
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found")

        item.app = body.app
        item.username = body.username
        item.url = body.url
        item.category = body.category
        item.password_alg = body.password.alg
        item.password_iv = body.password.iv
        item.password_ct = body.password.ct
        item.strength = body.strength
        item.entropy = body.entropy
        item.updated_at = utc_now()
        if "favorite" in body.model_fields_set:
            item.favorite = body.favorite
        if "source" in body.model_fields_set:
            item.source = body.source
        if "origin_hash" in body.model_fields_set:
            item.origin_hash = body.origin_hash
        if "app_identity" in body.model_fields_set:
            item.app_identity = (
                json.dumps(body.app_identity.model_dump(by_alias=True), separators=(",", ":"), sort_keys=True)
                if body.app_identity
                else None
            )

        # Supplying a fresh ciphertext blob is the rotation operation.
        item.locked = False
        item.compromised_at = None
        item.compromise_reason = None
        item.breach_notified_at = None
        session.add(item)
        _write_audit(
            session,
            request,
            actor=user.username,
            role=user.role,
            action="item.updated",
            detail="Encrypted credential rotated",
        )
        session.commit()
        return {"ok": True}

    @application.delete("/api/items/{item_id}")
    def delete_item(item_id: str, request: Request, user: UserDep, session: SessionDep):
        item = session.exec(
            select(Item).where(Item.id == item_id, Item.user_id == user.id)
        ).first()
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found")
        session.delete(item)
        _write_audit(
            session,
            request,
            actor=user.username,
            role=user.role,
            action="item.deleted",
            detail="Encrypted credential deleted",
            severity="warn",
        )
        session.commit()
        return {"ok": True}

    @application.get("/api/admin/items")
    def admin_items(_: AdminDep, session: SessionDep):
        rows = session.exec(select(Item, User).join(User, Item.user_id == User.id)).all()
        return {"items": [_admin_item_view(item, owner) for item, owner in rows]}

    @application.get("/api/policy")
    def get_policy(_: UserDep, session: SessionDep):
        policy = session.exec(select(PolicySettings).where(PolicySettings.id == 1)).one()
        return {"policy": _policy_view(policy)}

    @application.put("/api/policy")
    def update_policy(
        body: PolicyUpdate,
        request: Request,
        admin: AdminDep,
        session: SessionDep,
    ):
        policy = session.exec(select(PolicySettings).where(PolicySettings.id == 1)).one()
        for field in body.model_fields_set:
            value = getattr(body, field)
            if value is not None:
                setattr(policy, field, value)
        session.add(policy)
        _write_audit(
            session,
            request,
            actor=admin.username,
            role=admin.role,
            action="policy.updated",
            detail="Organization policy updated",
            severity="warn",
        )
        session.commit()
        session.refresh(policy)
        return {"ok": True, "policy": _policy_view(policy)}

    @application.get("/api/audit")
    def get_audit(
        _: AdminDep,
        session: SessionDep,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, alias="pageSize", ge=1, le=100),
    ):
        all_events = session.exec(select(AuditEvent).order_by(AuditEvent.ts.desc())).all()
        start = (page - 1) * page_size
        selected = all_events[start : start + page_size]
        events = [
            AuditEventView(
                id=event.id,
                ts=event.ts,
                actor=event.actor,
                role=event.role,
                action=event.action,
                detail=event.detail,
                severity=event.severity,
                ip=event.ip,
            ).model_dump()
            for event in selected
        ]
        return {"events": events, "page": page, "pageSize": page_size, "total": len(all_events)}

    @application.post("/api/audit")
    def create_audit(body: AuditCreate, request: Request, user: UserDep, session: SessionDep):
        _write_audit(
            session,
            request,
            actor=user.username,
            role=user.role,
            action=body.action,
            detail=body.detail,
            severity=body.severity,
        )
        session.commit()
        return {"ok": True}

    @application.post("/api/alerts/whatsapp")
    def send_whatsapp(body: AlertRequest, request: Request, user: UserDep):
        if not request.app.state.alert_limiter.allow(user.id):
            raise HTTPException(status_code=429, detail="WhatsApp alert rate limit exceeded")
        try:
            sid = alerts.send_whatsapp_alert(body)
        except AlertServiceError:
            security_logger.warning("WhatsApp provider request failed for user_id=%s", user.id)
            raise HTTPException(status_code=502, detail="WhatsApp alert could not be sent") from None
        return {"ok": True, "sid": sid}

    return application


app = create_app()
