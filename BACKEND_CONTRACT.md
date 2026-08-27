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
```

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
