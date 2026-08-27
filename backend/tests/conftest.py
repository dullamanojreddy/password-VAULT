from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["AEGIS_JWT_SECRET"] = "test-only-jwt-secret-with-more-than-32-bytes"
os.environ["AEGIS_JWT_EXPIRE_MINUTES"] = "30"
os.environ["AEGIS_SCRYPT_N"] = "1024"

from main import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path: Path):
    database_url = f"sqlite:///{(tmp_path / 'aegis-test.db').as_posix()}"
    app = create_app(database_url=database_url)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def account_factory(client: TestClient):
    def create(username: str, *, role: str = "user", verifier: str | None = None):
        submitted_verifier = verifier or f"verifier-for-{username}"
        register = client.post(
            "/api/auth/register",
            json={
                "username": username,
                "name": username.title(),
                "salt": f"salt-for-{username}",
                "verifier": submitted_verifier,
                "role": role,
            },
        )
        assert register.status_code == 201, register.text
        verify = client.post(
            "/api/auth/verify",
            json={"username": username, "verifier": submitted_verifier},
        )
        assert verify.status_code == 200, verify.text
        body = verify.json()
        return {
            "headers": {"Authorization": f"Bearer {body['token']}"},
            "user": body["user"],
            "verifier": submitted_verifier,
        }

    return create
