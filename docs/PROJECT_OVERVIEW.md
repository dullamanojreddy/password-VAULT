# AEGIS — Full Project Description

**Team:** 2 people · **Event:** TCS TechDay
**Problem statement:** A password vault that analyses passwords, recommends strong ones, has admin + user modes, and stays strictly focused on security.

---

## 1. The core idea (this is the pitch)

Most password-manager demos store passwords in a database and encrypt them with one shared server-side key. If the admin account or the database leaks, every password leaks with it.

**AEGIS is zero-knowledge: the server — and therefore the admin — mathematically cannot read any user's password, even with full database access.**

One sentence for judges:

> *The encryption key is derived from the user's master password inside their own browser and never leaves it, so the backend only ever stores unreadable ciphertext.*

This is implemented for real using the browser's native WebCrypto API — not a progress bar, not a mock.

### How it works, step by step

1. Alice types her master password into the login screen.
2. Her browser runs it through **PBKDF2-HMAC-SHA256, 600,000 iterations**, with a 128-bit random salt. This is deliberately slow — it makes offline brute force ~600,000× more expensive per guess.
3. That produces an **AES-256 key**, marked *non-extractable* in WebCrypto — even our own JavaScript cannot read the raw key bytes back out.
4. Every saved password is encrypted individually with **AES-256-GCM** using a **fresh random 96-bit IV**, so identical passwords produce different ciphertext every time.
5. What gets persisted is only `{ alg, iv, ct }` — random-looking bytes.
6. On lock / idle timeout / app exit, the key reference is dropped. Nobody can turn that ciphertext back into plaintext without the master password.

The master password itself is **never** transmitted. Only a separate, weaker *verifier* hash is stored, used solely to check "is this the right master password?"

---

## 2. What is built today

### A. Web application (`frontend/`) — React 19 + Vite + Tailwind v4 · **complete**

**User role** (`alice / Demo@Vault2026`)
- **Dashboard** — vault strength score, passwords stored, weak count, reused count, quick-access list with real brand logos, inline password generator, security recommendations, recent activity feed
- **My Vault** — search/filter by category, reveal/copy/edit/delete, reuse warnings, compromise-lock state
- **Generator** — random-string and Diceware-passphrase modes, live strength analysis, breach check
- **Security Health** — breach/reuse/weak/stale scan, vault score, prioritised action queue, WhatsApp alert setup, demo breach trigger
- **About** — architecture explainer + threat model

**Admin role** (`admin / Admin@Vault2026`)
- **Users** — provision/suspend, force rotation, inspect metadata (never plaintext)
- **Vault Registry** — the zero-knowledge proof screen: real ciphertext for every credential, plus an "Attempt decrypt" button that genuinely fails with `OperationError` because AES-GCM's authentication tag can't be verified without the owner's key
- **Policy** — org-wide password rules (min length, complexity, entropy floor, rotation interval, auto-lock, clipboard clear), enforced client-side *before* encryption
- **Audit Log** — timestamped record of logins, failed logins, reveals, copies, policy changes, suspensions; exportable

**Security features (all real)**
- CSPRNG password generation (`crypto.getRandomValues` + rejection sampling — never `Math.random`)
- Breach checking via HIBP's **k-anonymity** range API (only the first 5 chars of a SHA-1 hash leave the device), with an offline corpus fallback
- Entropy-based strength scoring with explainable penalties (dictionary words, leetspeak, keyboard walks, sequences, repeats, years) and crack-time estimates
- Self-clearing clipboard, idle auto-lock that drops the key from memory
- Item-level compromise lock: a breached credential locks (reveal/copy disabled) until rotated — the whole account is never deleted
- Automatic WhatsApp breach alerts (metadata only — app name + severity, **never** the password)

### B. Shared package (`packages/shared/`) — **complete, 35 tests passing**

The canonical AEGIS crypto/strength/policy/schema modules, plus a `LocalVaultClient` interface used by both new clients. Kept byte-identical with the web app's versions so every client is cryptographically interoperable.

Also defines: strict origin normalisation & matching (phishing-resistant), desktop app-identity matching, and metadata-only audit events.

### C. Chrome extension (`apps/chrome-extension/`) — **complete, 46 tests passing, builds to a loadable MV3 unpacked extension**

- Detects login / signup / password-change / unknown forms via autocomplete attributes, labels, names, form structure, and URL context
- Shows an in-page suggestion panel (generated password + score + strength + crack time) on signup/password-change fields
- Fills both password and confirmation fields, only after explicit approval
- Offers saved credentials on login forms **only on an exactly-matching origin**
- Blocks fill on plain-HTTP pages, refuses payment forms and Chrome internal pages
- Service worker holds the key in memory only — an MV3 restart genuinely comes back locked
- Scoped, debounced MutationObserver (only new subtrees, never full-document rescans); Shadow-DOM aware; singleton panel prevents duplicates across framework re-renders
- Every privileged message is schema-validated with sender/tab/origin checks

### D. Windows desktop assistant (`apps/desktop/`) — **complete, 66 tests passing, Electron main process verified to launch**

- Electron + React UI with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, strict CSP, minimal preload bridge
- .NET 8 native helper using **UI Automation focus-change events only** — no keyboard hooks, no keylogging, no screenshots, no OCR, no clipboard monitoring (enforced by an automated static test)
- Detects password controls via UIA `IsPassword`, control type, automation ID, labels, sibling controls
- Ignores browser processes so it never conflicts with the Chrome extension
- Re-validates window, process ID, executable/package identity, **and** the control itself immediately before insertion — any mismatch refuses
- Inserts only via UIA `ValuePattern`; never silently falls back to simulated keystrokes
- Binds credentials to package family ID (packaged apps) or executable hash (traditional apps) — **never** process name alone
- System tray, lock/unlock status, Pause Assistant, per-app allow/deny, global enable/disable, auto-lock, clipboard-clear countdown
- Named-pipe IPC secured by a current-user-only ACL, schema-validated in both directions
- Runs `asInvoker` — never requests administrator privileges

### E. Test coverage — **147 automated tests, all passing**

| Suite | Tests | Covers |
|---|---|---|
| `packages/shared` | 35 | KDF determinism, AES-GCM round-trip, fresh-IV uniqueness, wrong-key & tampered-ciphertext safety, CSPRNG-only generation, origin/phishing matching, app-identity matching, no-plaintext-persistence, audit trail |
| `apps/chrome-extension` | 46 | Form classification (login/signup/change/unknown/payment), dynamic & SPA forms, duplicate-panel prevention, origin matching, phishing rejection, HTTP rejection, locked vault, service-worker restart, malformed/unauthorised messages, no plaintext persistence |
| `apps/desktop` | 66 | UIA classification, policy store, pause & per-app deny, clipboard auto-clear (incl. not clobbering user copies), IPC schema validation, identity mismatch refusal, locked vault, atomic storage writes, static no-keylogging/no-plaintext-logging guard |

---

## 3. What is NOT built yet — the backend

**This is the part being handed to the second team member.**

Right now each client (web, extension, desktop) keeps its **own** encrypted local store:

| Client | Storage |
|---|---|
| Web app | browser `localStorage` |
| Chrome extension | `chrome.storage.local` |
| Desktop assistant | JSON files under Electron's `userData` |

All three use the **identical encryption algorithm and identical item schema**, so records are already forward-compatible — but they don't yet *sync*.

**Why they can't sync today:** browsers isolate storage per origin by design, and a native desktop process cannot read a browser tab's JavaScript state at all. There is no way — short of breaking the browser's security model — for an extension or desktop app to read the web app's `localStorage`. The only correct bridge is a shared server.

**That server is the backend.** Once it exists, all three clients point at the same API, and a password saved in Chrome instantly appears in the desktop app and the web vault.

### The backend's job in one line

> Store ciphertext it cannot read, and serve it back to authenticated clients.

It never sees a master password, never sees a plaintext password, never holds an encryption key. It is deliberately "dumb" about secrets — that dumbness *is* the security property.

### Planned stack

- **FastAPI** (Python) — fast to write, automatic Swagger docs at `/docs` (great for judges), easy JWT/session auth
- **SQLite + SQLModel** — plenty for a hackathon; a single file, no server to provision
- **Twilio** — the one place that talks to a third party, for WhatsApp breach alerts (metadata only)

---

## 4. Architecture at a glance

```
┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐
│   Web app    │   │ Chrome extension │   │ Desktop assistant │
│  (React)     │   │     (MV3)        │   │ (Electron + .NET) │
└──────┬───────┘   └────────┬─────────┘   └─────────┬─────────┘
       │                    │                       │
       │   master password → PBKDF2 → AES-256 key   │
       │        (in-memory only, per client)        │
       │                    │                       │
       └────────────────────┼───────────────────────┘
                            │  only ciphertext + metadata
                            ▼
                 ┌─────────────────────┐
                 │  FastAPI backend    │  ← TO BUILD
                 │  SQLite (ciphertext)│
                 │  Twilio (alerts)    │
                 └─────────────────────┘
```

---

## 5. Demo script (~90 seconds)

1. Login screen — point out the master-password explanation.
2. Log in as **alice** → Dashboard: vault strength, stat tiles, brand logos.
3. **Security Health** — "it already found breached and reused passwords."
4. **Demo: Simulate a Breach** → pick GitHub → *Trigger breach*. Watch it flip ELITE → CRITICAL, auto-lock, and fire a WhatsApp alert — live, offline, no wifi needed.
5. **Generator** — generate one, show the live strength breakdown.
6. Lock, log in as **admin**.
7. **Vault Registry** — show real ciphertext → click **Attempt decrypt** → it fails on screen with `OperationError`.
8. **Policy** + **Audit Log** — org-wide control and accountability.
9. Close with the one-liner from §1.

---

## 6. Anticipated judge questions

**"What if I forget my master password?"**
The vault is unrecoverable by design — that's the zero-knowledge trade-off. Real products add optional recovery codes generated at signup; that's our next step.

**"Why PBKDF2 and not Argon2?"**
Argon2 resists GPU/ASIC attacks better and is a good v2 upgrade. PBKDF2 is natively supported by every browser's WebCrypto with no extra library — critical for a demo that must just work. 600,000 iterations follows OWASP's current guidance.

**"Can the admin see passwords?"**
No — and we demonstrate it live. Admin sees account existence, timestamps, categories, and non-reversible strength labels (computed client-side and uploaded without the password), which is enough to enforce policy without any privacy violation.

**"What if the database is stolen?"**
The attacker gets useless encrypted blobs. Decrypting one requires brute-forcing 600,000 PBKDF2 iterations per guess against that user's master password.

**"Is this actually secure or just a demo?"**
The primitives (PBKDF2, AES-256-GCM, CSPRNG) are real, standard, and use genuine browser APIs — inspectable in DevTools. Simplified for the hackathon: no server-side login rate limiting yet, no master-password recovery flow, and the shared backend is still being built. The crypto boundary itself is not a mockup.
