# AEGIS — Threat Model

Scope: the Chrome extension (`apps/chrome-extension`) and Windows desktop
assistant (`apps/desktop`), plus the shared crypto/vault layer
(`packages/shared`) they both build on.

---

## Security goal

**An attacker who obtains the stored data — by dumping the database, reading
`chrome.storage.local`, copying the desktop app's files, or compromising a
future backend server — learns nothing about any password.**

Everything below follows from that one goal.

## Trust boundaries

| Boundary | Trusted? | Why |
|---|---|---|
| User's typed master password | Trusted at the moment of entry | Unavoidable — this is the root of all key material |
| Derived AES-256 key, in process memory | Trusted while unlocked | Held only in a module-level variable; dropped on lock/exit |
| Persisted storage (`chrome.storage.local`, desktop JSON files, future DB) | **Untrusted** | Assumed readable by an attacker; only ever contains ciphertext |
| A future FastAPI backend | **Untrusted** | Same assumption — it stores blobs it cannot decrypt |
| Administrators | **Untrusted for secrets** | Can manage lifecycle and policy; cannot decrypt any credential |
| The web page a content script runs in | **Untrusted** | Isolated world; page scripts cannot reach extension state |
| Other desktop processes | **Untrusted** | Identity must be verified before any insertion |
| The user's OS and browser binary | Trusted | Out of scope — a compromised OS defeats any password manager |

---

## Assets

1. Master passwords — never persisted, never transmitted, never logged.
2. Derived AES-256 keys — memory only, non-extractable via WebCrypto.
3. Stored credential plaintext — exists only transiently during an approved
   fill/copy/reveal operation.
4. Vault metadata (app names, usernames, strength labels, timestamps) —
   lower sensitivity, but still access-controlled.

---

## Threats and mitigations

### T1 — Storage or backend compromise
*Attacker reads every stored byte.*

**Mitigated.** Each secret is sealed with AES-256-GCM under a key derived
from that user's master password via PBKDF2-HMAC-SHA256 at 600,000
iterations with a 128-bit random salt. Recovering one password means
brute-forcing the master password at 600,000 hash operations per guess.
A separate low-iteration verifier is stored for auth checks; it is not the
encryption key and does not help decrypt anything.

*Tested:* `packages/shared/test/crypto.test.js`,
`test/vault-client.test.js` ("never persists plaintext anywhere in storage").

### T2 — Malicious or curious administrator
*Admin has full application and database access.*

**Mitigated.** No admin-facing code path can decrypt. The admin registry
returns ciphertext plus non-reversible metadata only, and its "Attempt
decrypt" action genuinely fails with an AES-GCM tag-verification error.
Every admin action is written to the audit log.

### T3 — Phishing / lookalike domains
*User visits `bank.com.evil.tld`; attacker wants the saved `bank.com` credential.*

**Mitigated.** Origin matching is exact on scheme + host + port. No
subdomain wildcarding, no `www.`-stripping, no suffix matching — precisely
because that fuzziness is what a lookalike domain exploits. The background
worker re-derives the origin from `sender.tab.url` rather than trusting any
origin claimed in the message payload.

*Tested:* `packages/shared/test/credential-schema.test.js`
("phishing resistance"), `apps/chrome-extension/test/router.test.js`
("rejects REVEAL_CREDENTIAL when the requesting tab is on a different origin").

### T4 — Network downgrade / plaintext HTTP
*Credential filled on an `http://` page could be captured in transit.*

**Mitigated.** Fill and save are refused on insecure origins at three
layers: the panel disables the buttons, the content script re-checks before
acting, and the background router rejects the request. `localhost` and
`127.0.0.1` are permitted for local development only.

### T5 — Page scripts stealing extension state
*Hostile page JavaScript tries to read the vault or the suggestion panel's password.*

**Mitigated.** Content scripts run in Chrome's isolated world — page script
cannot reach their variables or listeners. The suggestion panel renders
inside a shadow root attached to `documentElement`. No key material or
decrypted credential is ever placed in a DOM attribute, `window` property,
or `postMessage` payload. All privileged work happens in the service
worker; the content script only receives what a specific approved action
returns.

### T6 — Forged or malformed extension messages
*Another extension, or injected code, sends crafted runtime messages.*

**Mitigated.** Every inbound message is validated for sender identity
(`sender.id === chrome.runtime.id`), a known action name, a well-formed
payload against a per-action schema, and (for tab-sourced messages) a
present sender URL. Unknown actions are rejected explicitly rather than
falling through.

*Tested:* `apps/chrome-extension/test/messaging.test.js` (10 tests).

### T7 — MV3 service worker termination leaking an unlocked session
*Chrome kills the worker; a naive design would persist the key to "stay logged in".*

**Mitigated by construction.** The vault client is a module-level variable.
Worker termination destroys it. Nothing writes the key or session to
storage, so a restarted worker necessarily starts locked.

*Tested:* `apps/chrome-extension/test/router.test.js`
("a freshly constructed router … starts locked even though data was already persisted").

### T8 — Desktop: inserting a password into the wrong application
*Attacker races the approval dialog, swapping the foreground window.*

**Mitigated.** Before writing, the native helper re-validates: the focused
element's automation ID, the process ID, the live-resolved executable hash
or package family ID, and that the control is still a password field. Any
mismatch refuses the insert. Identity matching never accepts a process name
alone — `chrome.exe` exists on every Windows machine and proves nothing.

*Tested:* `apps/desktop/test/ipc-router.test.js` ("process/executable identity
mismatch"), `native-helper/AegisNativeHelper.Tests/IdentityResolverTests.cs`.

### T9 — Desktop: keylogging / screen scraping as an implementation shortcut
*A naive assistant would hook the keyboard or OCR the screen.*

**Mitigated and enforced.** Detection uses UI Automation focus-change events
only; insertion uses UIA `ValuePattern` only, with no silent fallback to
simulated keystrokes. An automated test greps the entire desktop source for
`SetWindowsHookEx`, `GetAsyncKeyState`, `iohook`, `robotjs`, screenshot and
clipboard-watching APIs and fails the build if any appear.

*Tested:* `apps/desktop/test/no-keylogging.test.js` (20 file checks).

### T10 — Left-unlocked device / lingering clipboard
**Mitigated.** Idle auto-lock drops the key (not merely the UI). Copied
secrets self-clear after the policy countdown, and only if the clipboard
still holds our value — never clobbering something the user copied since.
Suspend and screen-lock also trigger a lock.

*Tested:* `apps/desktop/test/clipboard-guard.test.js` (7 tests).

### T11 — Credential theft via payment/checkout confusion
**Mitigated.** The extension never engages on forms containing payment
autocomplete fields, and payment/checkout hosts are excluded in the
manifest.

---

## Accepted risks (explicitly out of scope)

| Risk | Why accepted |
|---|---|
| Compromised OS, browser binary, or malicious browser extension with equal privileges | Any zero-knowledge design assumes an honest client at unlock time. Mitigated only by a strict extension CSP and shipping no remote code. |
| Malware with debugger access to process memory while unlocked | Defeats every password manager; out of scope for a user-level application. |
| Forgotten master password | Unrecoverable **by design** — the trade-off of zero knowledge. Optional recovery codes are a planned addition, not a shipped feature. |
| Metadata leakage (which apps a user has accounts for, credential strength labels) | Deliberately visible to admins so policy can be enforced centrally. Non-reversible; reveals no password content. |
| Traffic analysis of the k-anonymity breach lookup | The 5-character SHA-1 prefix is shared by hundreds of passwords; the service cannot determine which was checked. |
| UAC secure desktop, Windows sign-in, credential-provider screens, elevated processes | Never interacted with. Reported as unsupported rather than attempted. |

---

## What would break the model

Stated plainly so future contributors don't do it by accident:

1. Storing or transmitting the derived key or master password *in any form*.
2. Adding a server-side decrypt endpoint "for admin convenience".
3. Relaxing origin matching to suffix/subdomain comparison.
4. Matching desktop application identity on process name alone.
5. Falling back to simulated keystrokes when `ValuePattern` is unavailable.
6. Sending a password through the WhatsApp alert channel (metadata only).
7. Logging any variable holding a decrypted credential.
