from __future__ import annotations

import logging


CIPHERTEXT = {
    "alg": "AES-256-GCM",
    "iv": "AAECAwQFBgcICQoL",
    "ct": "dGhpcy1pcy1vcGFxdWUtY2lwaGVydGV4dA==",
}


def item_payload(blob=None):
    return {
        "app": "GitHub",
        "username": "alice",
        "url": "https://github.com",
        "category": "Developer",
        "password": blob or CIPHERTEXT,
        "strength": "elite",
        "entropy": 118,
        "source": "extension",
        "originHash": "origin-hash",
        "appIdentity": None,
    }


def test_ciphertext_round_trips_byte_identically(client, account_factory):
    account = account_factory("alice")
    created = client.post("/api/items", json=item_payload(), headers=account["headers"])
    assert created.status_code == 201

    response = client.get("/api/items", headers=account["headers"])
    assert response.status_code == 200
    assert response.json()["items"][0]["password"] == CIPHERTEXT


def test_plaintext_field_never_reaches_response_log_or_database(client, account_factory, caplog):
    from sqlmodel import Session, select

    from db import get_engine
    from models import Item

    marker = "UniqueTestPlaintext999"
    account = account_factory("alice")
    payload = item_payload()
    payload["plaintext"] = marker

    with caplog.at_level(logging.INFO):
        response = client.post("/api/items", json=payload, headers=account["headers"])

    assert response.status_code == 422
    assert marker not in response.text
    assert all(marker not in record.getMessage() for record in caplog.records)
    with Session(get_engine()) as session:
        assert session.exec(select(Item)).all() == []


def test_user_cannot_read_update_or_delete_another_users_item(client, account_factory):
    alice = account_factory("alice")
    bob = account_factory("bob")
    created = client.post("/api/items", json=item_payload(), headers=bob["headers"])
    item_id = created.json()["id"]

    assert client.get(f"/api/items/{item_id}", headers=alice["headers"]).status_code == 404
    assert client.put(f"/api/items/{item_id}", json=item_payload(), headers=alice["headers"]).status_code == 404
    assert client.delete(f"/api/items/{item_id}", headers=alice["headers"]).status_code == 404
    assert client.get("/api/items", headers=alice["headers"]).json()["items"] == []


def test_locked_item_omits_blob_and_rotation_clears_lock(client, account_factory):
    from datetime import datetime, timezone

    from sqlmodel import Session, select

    from db import get_engine
    from models import Item

    account = account_factory("alice")
    item_id = client.post("/api/items", json=item_payload(), headers=account["headers"]).json()["id"]

    with Session(get_engine()) as session:
        item = session.exec(select(Item).where(Item.id == item_id)).one()
        item.locked = True
        item.compromised_at = datetime.now(timezone.utc)
        item.compromise_reason = "breach"
        item.breach_notified_at = datetime.now(timezone.utc)
        session.add(item)
        session.commit()

    locked = client.get("/api/items", headers=account["headers"]).json()["items"][0]
    assert locked["locked"] is True
    assert "password" not in locked

    rotated_blob = {"alg": "AES-256-GCM", "iv": "new-iv", "ct": "new-ct"}
    rotated = client.put(
        f"/api/items/{item_id}",
        json=item_payload(rotated_blob),
        headers=account["headers"],
    )
    assert rotated.status_code == 200

    after = client.get(f"/api/items/{item_id}", headers=account["headers"]).json()["item"]
    assert after["locked"] is False
    assert after["password"] == rotated_blob
    assert "compromisedAt" not in after
    assert "compromiseReason" not in after
    assert "breachNotifiedAt" not in after
