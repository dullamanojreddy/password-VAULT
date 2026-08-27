from __future__ import annotations

from test_items import CIPHERTEXT, item_payload


def test_non_admin_is_forbidden_from_admin_routes(client, account_factory):
    user = account_factory("alice")
    assert client.get("/api/users", headers=user["headers"]).status_code == 403
    assert client.get("/api/admin/items", headers=user["headers"]).status_code == 403
    assert client.put("/api/policy", json={"minLength": 20}, headers=user["headers"]).status_code == 403


def test_admin_registry_returns_ciphertext_but_never_verifiers(client, account_factory):
    admin = account_factory("admin", role="admin")
    user = account_factory("alice")
    client.post("/api/items", json=item_payload(), headers=user["headers"])

    registry = client.get("/api/admin/items", headers=admin["headers"])
    assert registry.status_code == 200
    assert registry.json()["items"][0]["password"] == CIPHERTEXT

    users = client.get("/api/users", headers=admin["headers"])
    assert users.status_code == 200
    assert "verifier" not in users.text


def test_admin_can_update_policy_and_require_rotation(client, account_factory):
    admin = account_factory("admin", role="admin")
    user = account_factory("alice")

    policy = client.put(
        "/api/policy",
        json={"minLength": 20, "clipboardClearSeconds": 10},
        headers=admin["headers"],
    )
    assert policy.status_code == 200
    assert policy.json()["policy"]["minLength"] == 20
    assert policy.json()["policy"]["clipboardClearSeconds"] == 10

    rotate = client.post(f"/api/users/{user['user']['id']}/rotate", headers=admin["headers"])
    assert rotate.status_code == 200
    users = client.get("/api/users", headers=admin["headers"]).json()["users"]
    alice = next(candidate for candidate in users if candidate["username"] == "alice")
    assert alice["rotationRequired"] is True


def test_only_the_initial_account_can_bootstrap_admin(client, account_factory):
    account_factory("admin", role="admin")
    second = client.post(
        "/api/auth/register",
        json={
            "username": "another-admin",
            "name": "Another Admin",
            "salt": "salt",
            "verifier": "verifier",
            "role": "admin",
        },
    )
    assert second.status_code == 403
