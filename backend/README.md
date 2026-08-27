# AEGIS Backend

FastAPI service for the AEGIS zero-knowledge credential vault. It stores encrypted credential blobs and metadata for the web app, Chrome extension, and desktop assistant.

## Zero-knowledge boundary

The server can see:

- Account identity, client-generated PBKDF2 salt, and a server-side scrypt hash of the client verifier
- Credential metadata such as app, username, category, strength, timestamps, and provenance
- Opaque `{ alg, iv, ct }` ciphertext blobs
- Metadata-only audit and WhatsApp alert information

The server cannot see and must never receive:

- Master passwords
- Plaintext vault passwords
- AES encryption keys
- Decrypted payloads
- Clipboard contents

There is intentionally no decrypt endpoint. Ciphertext strings are stored and returned unchanged. The AES-256-GCM key remains exclusively in the client that derived it from the master password.

## Requirements

- Python 3.11 or newer
- SQLite, included with Python
- Twilio credentials only when real WhatsApp delivery is needed

## Install

From the repository root on Windows PowerShell:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and replace placeholders. `.env` is ignored by Git. Generate a JWT secret with a password manager or another cryptographically secure tool; do not commit it or pass it as a command-line argument.

## Run

From `backend/` with the virtual environment active:

```powershell
uvicorn main:app --reload --port 8000
```

Then open:

- Health check: `http://127.0.0.1:8000/api/health`
- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI document: `http://127.0.0.1:8000/openapi.json`

The frontend's Vite server proxies `/api/*` to port 8000.

## Test

```powershell
cd backend
python -m pytest -q
```

Tests use isolated temporary SQLite databases and mock WhatsApp delivery. They never contact Twilio.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `AEGIS_DATABASE_URL` | No | SQLAlchemy URL; defaults to `sqlite:///./aegis.db` |
| `AEGIS_JWT_SECRET` | Yes outside local development | JWT signing secret; an ephemeral key is used if omitted |
| `AEGIS_JWT_EXPIRE_MINUTES` | No | Access-token lifetime; defaults to 30 minutes |
| `AEGIS_EXTENSION_ORIGIN` | For extension access | Exact `chrome-extension://<32-character-id>` CORS origin |
| `TWILIO_ACCOUNT_SID` | For WhatsApp | Rotated Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | For WhatsApp | Rotated Twilio Auth Token |
| `TWILIO_BREACH_TEMPLATE_SID` | For WhatsApp | Approved Twilio Content SID for `breach_alert` |
| `TWILIO_WHATSAPP_FROM` | No | Sender number; defaults to Twilio's sandbox number |

Any Twilio credential previously pasted into chat must be rotated before use.

## Authentication

The client derives an AES key and a separate verifier from the master password. Only the verifier is sent. AEGIS hashes that verifier again with scrypt before database storage and compares it during verification. Successful verification returns a short-lived bearer JWT.

The first account in an empty database may request the `admin` role to bootstrap the deployment. After that, public registration cannot create another admin. Protected routes always load the current user and role from SQLite; request bodies and JWT role claims are never trusted for authorization.

Send the token as:

```text
Authorization: Bearer <token>
```

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Service health |
| `POST` | `/api/auth/register` | Public | Register salt and client verifier |
| `POST` | `/api/auth/verify` | Public, rate-limited | Verify and issue JWT |
| `POST` | `/api/auth/logout` | Authenticated | Revoke current JWT |
| `GET` | `/api/users` | Admin | List users without verifier hashes |
| `POST` | `/api/users/{id}/status` | Admin | Activate or suspend a user |
| `POST` | `/api/users/{id}/rotate` | Admin | Require credential rotation |
| `GET` | `/api/items` | Authenticated | List only the current user's items |
| `GET` | `/api/items/{id}` | Authenticated | Get one owner-scoped item |
| `POST` | `/api/items` | Authenticated | Store an opaque encrypted blob |
| `PUT` | `/api/items/{id}` | Authenticated | Replace blob and clear compromise lock |
| `DELETE` | `/api/items/{id}` | Authenticated | Delete an owner-scoped item |
| `GET` | `/api/admin/items` | Admin | List every ciphertext blob plus owner metadata |
| `GET` | `/api/policy` | Authenticated | Read organization policy |
| `PUT` | `/api/policy` | Admin | Update one or more policy fields |
| `GET` | `/api/audit` | Admin | Paginated audit events (`page`, `pageSize`) |
| `POST` | `/api/audit` | Authenticated | Submit metadata-only audit event |
| `POST` | `/api/alerts/whatsapp` | Authenticated, rate-limited | Send approved breach template through Twilio |

Locked items remain visible to their owner as metadata, but their `password` property is omitted until a `PUT` supplies a fresh encrypted blob. This enforces rotation server-side rather than relying on the UI.

## Security behavior

- Pydantic rejects unknown request fields.
- Item ownership is included in every user item query, preventing IDOR access.
- Admin routes check the role stored in SQLite.
- Verification is limited to five attempts per username per minute.
- WhatsApp sends are limited to one per authenticated user per minute.
- CORS permits only `http://localhost:5173` and the configured exact extension origin.
- Request logs contain only method, path, status, authenticated user ID, and duration.
- Validation, authorization, provider, and server failures return `{ "ok": false, "error": "..." }` without stack traces or database details.
