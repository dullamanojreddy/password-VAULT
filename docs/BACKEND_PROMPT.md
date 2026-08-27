# Backend Build Prompt — AEGIS

> Give this whole file to your AI assistant (or work through it yourself).
> Read `docs/PROJECT_OVERVIEW.md` first for the full context.

---

You are building the backend for **AEGIS**, a zero-knowledge password vault. The frontend (React web app), a Chrome extension, and a Windows desktop assistant are already complete and working. Your job is the server that lets all three share one vault.

Repository: `https://github.com/lucky2132621326/password-VAULT.git`
Work in a new top-level `backend/` directory. **Do not modify `frontend/`, `apps/`, or `packages/`.**

---

## THE ONE RULE THAT DEFINES THIS PROJECT

**The server never receives a plaintext password, and never receives a master password.**

Every `password` field crossing the wire is already an encrypted blob:

```json
{ "alg": "AES-256-GCM", "iv": "<base64>", "ct": "<base64>" }
```

Your job is to store and return that blob **byte-for-byte**. Do not parse it, do not decrypt it, do not validate its contents, do not log it. You cannot decrypt it — you don't have the key and never will. That is the entire security model, and it is the thing the judges will be shown.

If you ever find yourself writing code that needs the plaintext of a stored password, something has gone wrong — stop and re-read this section.

### Never log, store, or return
- Master passwords
- Plaintext passwords
- Encryption keys
- Decrypted payloads
- Complete authentication tokens
- Clipboard contents

---

## STACK

- **FastAPI** (Python 3.11+)
- **SQLModel + SQLite** (single file — no DB server to provision)
- **Uvicorn** for dev
- **python-jose** or **PyJWT** for tokens, **passlib** *only* if you hash the verifier server-side (see auth note below)
- **twilio** for WhatsApp alerts

Keep dependencies minimal. Everything must run with:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The frontend dev server already proxies `/api/*` to `http://127.0.0.1:8000` (see `frontend/vite.config.js`) — do not change that.

---

## DATA MODEL

```python
class User(SQLModel, table=True):
    id: str = Field(primary_key=True)
    username: str = Field(unique=True, index=True)
    name: str
    role: Literal["user", "admin"] = "user"
    salt: str                      # base64, generated CLIENT-side by PBKDF2
    verifier: str                  # base64 — NOT the encryption key, just an auth check
    status: Literal["active", "suspended"] = "active"
    mfa: bool = False
    rotation_required: bool = False
    phone: str | None = None       # E.164, for WhatsApp alerts — never anything sensitive
    created_at: datetime
    last_seen: datetime

class EncryptedBlob(BaseModel):    # embedded, not a table
    alg: str
    iv: str
    ct: str

class Item(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    app: str
    username: str
    url: str | None = None
    category: str = "Other"
    password_alg: str              # store the three blob fields as columns,
    password_iv: str               # or one JSON column — your call
    password_ct: str
    strength: Literal["critical","weak","fair","strong","elite"]
    entropy: int
    created_at: datetime
    updated_at: datetime
    favorite: bool = False
    # Breach-response fields (all optional — older records may lack them)
    locked: bool = False
    compromised_at: datetime | None = None
    compromise_reason: Literal["breach","reuse","admin-flag"] | None = None
    breach_notified_at: datetime | None = None
    # Client-provenance / binding metadata (all optional)
    source: str | None = None      # "web" | "extension" | "desktop"
    origin_hash: str | None = None # sha256 of normalized origin, for fast lookup
    app_identity: str | None = None # JSON: {type, executableHash?, packageFamilyId?, publisher?}

class AuditEvent(SQLModel, table=True):
    id: str = Field(primary_key=True)
    ts: datetime
    actor: str
    role: str
    action: str
    detail: str                    # METADATA ONLY — never a password
    severity: Literal["info","warn","critical"]
    ip: str
```

**Backward compatibility is mandatory:** every field marked optional must stay optional. Existing records that lack them are still valid credentials.

---

## ENDPOINTS

### Auth

```
POST /api/auth/register   { username, name, salt, verifier, role? }  -> { ok, user }
POST /api/auth/verify     { username, verifier }                     -> { ok, token, user }
POST /api/auth/logout                                                -> { ok }
GET  /api/health                                                     -> 200 { "ok": true }
```

**How auth works here (important, it's unusual):** the client derives *two* things from the master password — the AES key (never sent) and a `verifier` (sent). You compare the submitted `verifier` against the stored one. You are checking a value the client computed; you never see the password itself.

Best practice: hash the `verifier` again server-side with a slow hash (bcrypt/argon2) before storing, so a database leak doesn't hand over a directly-replayable value. Ask the frontend dev before changing the wire format.

Issue a JWT (or session cookie) on success. Every endpoint below requires it.

### Users (admin only)

```
GET  /api/users                                  -> { users: [...] }
POST /api/users/{id}/status  { status }          -> { ok }
POST /api/users/{id}/rotate                      -> { ok }
```

### Items

```
GET    /api/items                    -> { items: [...] }   # current user's only
POST   /api/items                    -> { ok, id }
PUT    /api/items/{id}               -> { ok }
DELETE /api/items/{id}               -> { ok }
```

Request body for POST/PUT:
```json
{ "app": "GitHub", "username": "alice", "url": "https://github.com",
  "category": "Developer",
  "password": { "alg": "AES-256-GCM", "iv": "...", "ct": "..." },
  "strength": "elite", "entropy": 118,
  "source": "extension", "originHash": "...", "appIdentity": null }
```

**Enforce the compromise lock server-side.** The clients already hide reveal/copy for a locked item, but that's UI convenience — anyone with dev tools can bypass it. Real enforcement lives here:

- `GET /api/items` must **omit the `password` blob** (or refuse) for any item where `locked = true`
- `PUT /api/items/{id}` with a new password clears `locked`, `compromised_at`, `compromise_reason`, and `breach_notified_at`

That way "you must rotate before you can read it again" is a server guarantee, not a client suggestion.

### Admin registry (admin only)

```
GET /api/admin/items   -> { items: [...] }
```

Returns every user's items with **the same ciphertext blobs** plus metadata (owner, app, username, category, strength, entropy, timestamps). This powers the "Vault Registry" demo screen where an admin sees encrypted data they provably cannot read. **Never add a decrypt endpoint here**, no matter how convenient it seems.

### Policy

```
GET /api/policy                 -> { policy: {...} }
PUT /api/policy   (admin only)  -> { ok, policy }
```

Shape:
```json
{ "minLength": 14, "requireUpper": true, "requireLower": true,
  "requireDigit": true, "requireSymbol": true, "minEntropy": 60,
  "blockBreached": true, "blockReuse": true, "rotationDays": 90,
  "autoLockMinutes": 5, "clipboardClearSeconds": 15 }
```

### Audit

```
GET  /api/audit   (admin only, paginated)  -> { events: [...] }
POST /api/audit   { action, detail, severity }  -> { ok }
```

Fill `ip` server-side from the request. Clients send metadata only — reject any payload containing a field named `password`, `plaintext`, `key`, `masterPassword`, `token`, or `secret`.

### WhatsApp breach alerts

```
POST /api/alerts/whatsapp
{ "to": "+919966007804", "template": "breach_alert",
  "variables": { "app": "Instagram",
                 "reason": "found in a public breach (471 exposures)",
                 "when": "8/27/2026, 3:04 PM" } }

-> 200 { "ok": true, "sid": "SM..." }
-> 502 { "ok": false, "error": "..." }
```

This is the **only** endpoint that talks to a third party. The body contains **no password** — only app name, reason, timestamp. If you ever see a `password` field arrive here, something upstream is broken; reject it and log a warning (without the value).

```python
import os, json
from twilio.rest import Client

client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])

@app.post("/api/alerts/whatsapp")
def send_alert(body: AlertRequest, user = Depends(require_auth)):
    message = client.messages.create(
        from_="whatsapp:+14155238886",
        content_sid=os.environ["TWILIO_BREACH_TEMPLATE_SID"],
        content_variables=json.dumps(body.variables),
        to=f"whatsapp:{body.to}",
    )
    return {"ok": True, "sid": message.sid}
```

**Credential handling — non-negotiable:**
- Twilio SID/token come from **environment variables only**. Never in code, never in a commit, never in a command-line argument.
- `.env` goes in `.gitignore`. Commit a `.env.example` with placeholder values instead.
- **The tokens previously shared in team chat must be rotated in the Twilio console before this ships.** Treat any credential that's been pasted into a chat as burned.
- Rate-limit this endpoint (e.g. 1 alert/minute/user) — it's the one route that spends real money and can spam a real phone.
- WhatsApp content templates must be pre-approved in the Twilio console; that's why the client sends a `template` name + `variables` rather than free text. Map `"breach_alert"` to your approved Content SID server-side.

---

## SECURITY REQUIREMENTS

1. **Authorization on every endpoint.** A user can only read/write their own items. Admin-only routes must verify `role == "admin"` server-side — never trust a role claim sent in a request body.
2. **No IDOR.** `GET /api/items/{id}` must scope by `user_id`, not just look up by id.
3. **Rate-limit `/api/auth/verify`** — it's the brute-force target. Something simple (5 attempts/minute/username) is fine.
4. **CORS**: allow only the frontend dev origin (`http://localhost:5173`) and the extension origin. Do not use `allow_origins=["*"]`.
5. **Never log request bodies** on item or auth routes. Log method, path, status, user id, duration — nothing else.
6. **Structured errors**: return `{ "ok": false, "error": "..." }`, never a raw stack trace, never a DB error message.
7. Validate every payload with Pydantic. Reject unknown fields rather than silently ignoring them.

---

## TESTS (required)

Use `pytest` + FastAPI's `TestClient`. Cover at minimum:

- Register → verify → authenticated request round-trip
- Wrong verifier is rejected
- **A stored ciphertext blob comes back byte-identical to what was sent**
- **No endpoint response, and no log line, ever contains a plaintext password** (assert on a distinctive test string like `UniqueTestPlaintext999`)
- User A cannot read, update, or delete User B's items
- A non-admin gets 403 on `/api/users`, `/api/admin/items`, `PUT /api/policy`
- A `locked` item's password blob is omitted from `GET /api/items`
- Rotating a locked item's password clears the lock
- `/api/alerts/whatsapp` rejects a payload containing a `password` field
- Audit `detail` rejects forbidden keys

Mock Twilio in tests — never send a real message from a test run.

---

## DELIVERABLES

```
backend/
├── main.py                 # FastAPI app + routes
├── models.py               # SQLModel tables
├── schemas.py              # Pydantic request/response models
├── auth.py                 # JWT issue/verify, dependencies
├── alerts.py               # Twilio WhatsApp integration
├── db.py                   # engine, session, init
├── tests/
│   ├── test_auth.py
│   ├── test_items.py
│   ├── test_admin.py
│   └── test_alerts.py
├── requirements.txt
├── .env.example
└── README.md               # setup, run, test, endpoint list
```

`README.md` must document: how to install and run, how to run tests, the full endpoint list, the environment variables required, and an explicit statement of what the server can and cannot see.

---

## DONE WHEN

1. `uvicorn main:app --reload --port 8000` starts cleanly
2. `GET /api/health` returns `200 {"ok": true}`
3. Swagger docs render at `/docs`
4. All pytest tests pass
5. A credential saved through the API comes back with byte-identical ciphertext
6. No plaintext password appears in any response, log, or database column
7. Admin routes are genuinely inaccessible to non-admin tokens
8. `.env` is gitignored and no secret is committed

---

## COORDINATE WITH THE FRONTEND DEV BEFORE

- Changing any request/response shape above
- Changing the auth flow (the `salt`/`verifier` split is load-bearing for zero-knowledge)
- Adding any field that would carry secret material

When the API is ready, the frontend swaps `packages/shared/src/vault-client.js`'s storage calls for `fetch` calls to these endpoints — that's the single integration point, and every page/component already sits behind it.
