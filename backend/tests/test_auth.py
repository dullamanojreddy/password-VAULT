from __future__ import annotations


def test_register_verify_and_authenticated_round_trip(client):
    assert client.get("/api/health").json() == {"ok": True}

    register = client.post(
        "/api/auth/register",
        json={
            "username": "alice",
            "name": "Alice",
            "salt": "client-generated-salt",
            "verifier": "client-generated-verifier",
        },
    )
    assert register.status_code == 201
    assert register.json()["user"]["username"] == "alice"
    assert "verifier" not in register.text

    verify = client.post(
        "/api/auth/verify",
        json={"username": "alice", "verifier": "client-generated-verifier"},
    )
    assert verify.status_code == 200
    token = verify.json()["token"]

    policy = client.get("/api/policy", headers={"Authorization": f"Bearer {token}"})
    assert policy.status_code == 200
    assert policy.json()["policy"]["minLength"] == 14


def test_wrong_verifier_is_rejected(client):
    client.post(
        "/api/auth/register",
        json={"username": "alice", "name": "Alice", "salt": "salt", "verifier": "correct"},
    )
    response = client.post(
        "/api/auth/verify",
        json={"username": "alice", "verifier": "wrong"},
    )
    assert response.status_code == 401
    assert response.json() == {"ok": False, "error": "Invalid credentials"}


def test_verify_is_rate_limited(client):
    for _ in range(5):
        response = client.post(
            "/api/auth/verify",
            json={"username": "missing-user", "verifier": "wrong"},
        )
        assert response.status_code == 401

    limited = client.post(
        "/api/auth/verify",
        json={"username": "missing-user", "verifier": "wrong"},
    )
    assert limited.status_code == 429


def test_logout_revokes_the_presented_token(client, account_factory):
    account = account_factory("alice")
    assert client.post("/api/auth/logout", headers=account["headers"]).status_code == 200
    assert client.get("/api/policy", headers=account["headers"]).status_code == 401


def test_verifier_is_hashed_again_before_storage(client, account_factory):
    from sqlmodel import Session, select

    from db import get_engine
    from models import User

    raw_verifier = "DistinctClientVerifierValue"
    account_factory("alice", verifier=raw_verifier)
    with Session(get_engine()) as session:
        user = session.exec(select(User).where(User.username == "alice")).one()
        assert user.verifier != raw_verifier
        assert user.verifier.startswith("scrypt$")
