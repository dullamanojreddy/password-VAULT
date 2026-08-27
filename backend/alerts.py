from __future__ import annotations

import json
import os

from twilio.rest import Client

from schemas import AlertRequest


class AlertServiceError(RuntimeError):
    pass


TEMPLATE_ENV = {
    "breach_alert": "TWILIO_BREACH_TEMPLATE_SID",
}


def send_whatsapp_alert(body: AlertRequest) -> str:
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    content_sid = os.getenv(TEMPLATE_ENV[body.template])
    from_number = os.getenv("TWILIO_WHATSAPP_FROM", "+14155238886")

    if not account_sid or not auth_token or not content_sid:
        raise AlertServiceError("WhatsApp service is not configured")

    try:
        client = Client(account_sid, auth_token)
        message = client.messages.create(
            from_=f"whatsapp:{from_number}",
            content_sid=content_sid,
            content_variables=json.dumps(body.variables.model_dump(), separators=(",", ":")),
            to=f"whatsapp:{body.to}",
        )
    except Exception as exc:
        raise AlertServiceError("WhatsApp provider rejected the request") from exc

    return str(message.sid)
