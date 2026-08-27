# AEGIS — Backend contract (FastAPI)

Frontend is fully working right now against an in-browser mock store
(`src/lib/vault.js` + `localStorage`). It does **not** need you to be running.
Wire the real API in whenever you're ready — swap `src/lib/vault.js`'s
persistence for `fetch` calls to these endpoints, same shapes.

## The one rule

**The server never receives a plaintext password and never receives the master
password.** Every `password` field that crosses the wire is already a JSON
blob: `{ "alg": "AES-256-GCM", "iv": "<base64>", "ct": "<base64>" }`. Your job
is to store and return that blob byte-for-byte. Don't parse it, don't touch it.

## Suggested endpoints

```
POST /api/auth/register     { username, salt, verifier, name, role }
POST /api/auth/verify       { username, verifier } -> { ok, user }
     # you compare `verifier` to what you stored at registration.
     # if you want real login sessions, issue a JWT/session cookie here.

GET  /api/users                                    (admin only)
POST /api/users/:id/status  { status: "active"|"suspended" }
POST /api/users/:id/rotate

GET  /api/items                                    (current user's items)
POST /api/items             { app, username, url, category,
                               password: {alg, iv, ct},
                               strength, entropy }
PUT  /api/items/:id         (same body)
DELETE /api/items/:id

GET  /api/admin/items                              (admin — metadata only,
                                                      same ciphertext blobs)

GET  /api/policy
PUT  /api/policy            (admin only)

GET  /api/audit             (admin only, paginated)
POST /api/audit             { action, detail, severity }

POST /api/alerts/whatsapp   { to, template, variables }
     # see "Breach alerts (WhatsApp)" below — this is the ONLY endpoint that
     # talks to a third party (Twilio), so it's the one place secrets live.
```

## Breach alerts (WhatsApp)

When a stored credential is flagged as compromised (breached in a public
dump, reused, or an admin flags it manually), the frontend locks that one
item and asks you to send a WhatsApp notification. **The request body never
contains a password** — only `{ to, template, variables }` where `variables`
is app name / reason / timestamp. Keep it that way: if you ever see a
`password` field on this route, something upstream broke the zero-knowledge
guarantee and the frontend has a bug.

```
POST /api/alerts/whatsapp
{ "to": "+919966007804", "template": "breach_alert",
  "variables": { "app": "Instagram", "reason": "found in a public breach (471 exposures)", "when": "8/27/2026, 3:04:12 PM" } }

-> 200 { "ok": true, "sid": "SM..." }
-> 502 { "ok": false, "error": "..." }   # frontend degrades gracefully either way
```

Server-side implementation (Twilio's Node SDK, called from FastAPI via a
small subprocess/queue, or reimplemented with `twilio` the Python package —
either is fine):

```python
# main.py — Twilio credentials NEVER go in frontend code, a repo, or a commit.
# Set these as real environment variables (.env, excluded via .gitignore,
# or your host's secret manager) and load them at runtime only.
import os
from twilio.rest import Client

client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])

@app.post("/api/alerts/whatsapp")
def send_alert(body: AlertRequest, user=Depends(require_auth)):
    message = client.messages.create(
        from_="whatsapp:+14155238886",           # Twilio sandbox/business number
        content_sid="HXb5b62575e6e4ff6129ad7c8efe1f983e",  # pre-approved template
        content_variables=json.dumps(body.variables),
        to=f"whatsapp:{body.to}",
    )
    return {"ok": True, "sid": message.sid}
```

A few things worth being deliberate about:

- **Rotate the Account SID / Auth Token before this ships anywhere** if they were
  ever pasted into a chat, a doc, or a commit — treat any credential that's been
  shared in plaintext as burned, regenerate it in the Twilio console.
- **`.env` goes in `.gitignore`.** Never commit it. If a `.env.example` is useful
  for teammates, commit that instead, with placeholder values.
- Content templates (the `content_sid`) must be pre-approved in the Twilio
  console before they can be sent outside the 24-hour session window — that's
  why the frontend sends a `template` name + `variables`, not free text; map
  `template: "breach_alert"` to your approved Content SID server-side.
- Rate-limit this endpoint per user (e.g. 1 alert / minute) — it's the one
  route that can spend real money and spam a real phone number.

## Minimal data model

```python
class User(BaseModel):
    id: str
    username: str
    name: str
    role: Literal["user", "admin"]
    salt: str          # base64, from client's PBKDF2 call
    verifier: str       # base64, NOT the encryption key — just an auth check
    status: Literal["active", "suspended"] = "active"
    mfa: bool = False
    rotation_required: bool = False
    phone: str | None = None   # E.164, WhatsApp alert target — never anything sensitive
    created_at: datetime
    last_seen: datetime

class EncryptedBlob(BaseModel):
    alg: str
    iv: str
    ct: str

class Item(BaseModel):
    id: str
    user_id: str
    app: str
    username: str
    url: str | None
    category: str
    password: EncryptedBlob
    strength: Literal["critical","weak","fair","strong","elite"]
    entropy: int
    created_at: datetime
    updated_at: datetime
    favorite: bool = False
    locked: bool = False              # true after a breach/admin flag — item unreadable until rotated
    compromised_at: datetime | None = None
    compromise_reason: Literal["breach", "reuse", "admin-flag"] | None = None
    breach_notified_at: datetime | None = None   # dedupes the auto WhatsApp alert — cleared on rotation

class AuditEvent(BaseModel):
    id: str
    ts: datetime
    actor: str
    role: str
    action: str
    detail: str
    severity: Literal["info","warn","critical"]
```

SQLite + SQLModel is plenty for a 2-3 hour build. `verifier` and `password.ct`
are just opaque strings to you — index by `id`/`user_id`, nothing else.

**On `locked` items:** the frontend already hides reveal/copy for a locked
item, but that's a UX nicety, not real enforcement — client-side checks can
be bypassed by anyone with dev tools. If you want this to actually hold up,
have `GET /api/items` omit the `password` blob (or refuse the request) for
any item where `locked: true`, and only restore it once `PUT /api/items/:id`
rotates the password (which should also clear the flag). That way the
"you must rotate before you can read it again" rule is enforced by the
server, not just hidden by the UI.

## CORS / dev

Frontend dev server proxies `/api/*` to `http://127.0.0.1:8000` already
(see `frontend/vite.config.js`), so just run:

```bash
uvicorn main:app --reload --port 8000
```

and hit `/api/health` returning `200 {"ok": true}` — that's the only thing
the frontend polls to detect you're alive (once you wire the switch below).

## Wiring it in later

Everything currently lives in `frontend/src/lib/vault.js`'s in-memory/
localStorage store. When you're ready to point it at your API, that's the
single file to change — every page already calls its exported functions
(`unlock`, `saveItem`, `allUsers`, `getAudit`, etc.), so no page component
needs to change.
