from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from db import get_session
from models import User


JWT_ALGORITHM = "HS256"
_EPHEMERAL_JWT_SECRET = secrets.token_urlsafe(48)
bearer = HTTPBearer(auto_error=False)


def _scrypt_n() -> int:
    return int(os.getenv("AEGIS_SCRYPT_N", str(2**14)))


def hash_verifier(verifier: str) -> str:
    salt = os.urandom(16)
    n, r, p = _scrypt_n(), 8, 1
    digest = hashlib.scrypt(verifier.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${digest.hex()}"


def verify_verifier(verifier: str, stored: str) -> bool:
    try:
        algorithm, n_raw, r_raw, p_raw, salt_raw, digest_raw = stored.split("$", 5)
        if algorithm != "scrypt":
            return False
        candidate = hashlib.scrypt(
            verifier.encode("utf-8"),
            salt=bytes.fromhex(salt_raw),
            n=int(n_raw),
            r=int(r_raw),
            p=int(p_raw),
            dklen=len(bytes.fromhex(digest_raw)),
        )
        return hmac.compare_digest(candidate.hex(), digest_raw)
    except (ValueError, TypeError):
        return False


def _jwt_secret() -> str:
    return os.getenv("AEGIS_JWT_SECRET") or _EPHEMERAL_JWT_SECRET


def issue_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    minutes = int(os.getenv("AEGIS_JWT_EXPIRE_MINUTES", "30"))
    payload = {
        "sub": user.id,
        "jti": secrets.token_urlsafe(24),
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
        "typ": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication") from exc
    if payload.get("typ") != "access" or not payload.get("sub") or not payload.get("jti"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication")
    return payload


def require_auth(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    payload = decode_token(credentials.credentials)
    if payload["jti"] in request.app.state.revoked_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication")

    user = session.exec(select(User).where(User.id == payload["sub"])).first()
    if user is None or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication")

    request.state.user_id = user.id
    request.state.token_jti = payload["jti"]
    return user


def require_admin(user: Annotated[User, Depends(require_auth)]) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                return False
            events.append(now)
            return True
