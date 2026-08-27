from __future__ import annotations


def alert_payload():
    return {
        "to": "+919966007804",
        "template": "breach_alert",
        "variables": {
            "app": "Instagram",
            "reason": "found in a public breach (471 exposures)",
            "when": "8/27/2026, 3:04 PM",
        },
    }


def test_whatsapp_rejects_password_fields_without_calling_twilio(
    client,
    account_factory,
    monkeypatch,
):
    account = account_factory("alice")
    called = False

    def fake_send(_):
        nonlocal called
        called = True
        return "SM-test"

    monkeypatch.setattr("main.alerts.send_whatsapp_alert", fake_send)
    payload = alert_payload()
    payload["password"] = "must-never-be-sent"
    response = client.post("/api/alerts/whatsapp", json=payload, headers=account["headers"])
    assert response.status_code == 422
    assert called is False
    assert "must-never-be-sent" not in response.text


def test_whatsapp_uses_mocked_provider_and_is_rate_limited(client, account_factory, monkeypatch):
    account = account_factory("alice")
    monkeypatch.setattr("main.alerts.send_whatsapp_alert", lambda _: "SM123")

    sent = client.post("/api/alerts/whatsapp", json=alert_payload(), headers=account["headers"])
    assert sent.status_code == 200
    assert sent.json() == {"ok": True, "sid": "SM123"}

    limited = client.post("/api/alerts/whatsapp", json=alert_payload(), headers=account["headers"])
    assert limited.status_code == 429


def test_audit_rejects_forbidden_secret_fields(client, account_factory):
    account = account_factory("alice")
    response = client.post(
        "/api/audit",
        json={
            "action": "item.updated",
            "detail": "metadata only",
            "severity": "info",
            "password": "must-never-be-accepted",
        },
        headers=account["headers"],
    )
    assert response.status_code == 422
    assert "must-never-be-accepted" not in response.text


def test_audit_ip_and_identity_are_filled_server_side(client, account_factory):
    admin = account_factory("admin", role="admin")
    created = client.post(
        "/api/audit",
        json={"action": "client.event", "detail": "metadata only", "severity": "info"},
        headers=admin["headers"],
    )
    assert created.status_code == 200

    events = client.get("/api/audit", headers=admin["headers"]).json()["events"]
    event = next(item for item in events if item["action"] == "client.event")
    assert event["actor"] == "admin"
    assert event["role"] == "admin"
    assert event["ip"] == "testclient"
