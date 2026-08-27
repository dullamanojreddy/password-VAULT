# Demonstration Script — Both Clients

Two runnable demos. **Demo A (Chrome extension) is the safe one — lead with
it.** Demo B (desktop) depends on the .NET helper compiling, which has never
been verified; rehearse it before committing to it on stage.

---

## Pre-flight (do this before you present)

```bash
npm install
npm test                      # expect 147 passing
npm run build:extension
npx serve apps/chrome-extension/test/fixtures -l 8080   # leave running
```

Load `apps/chrome-extension/dist` via `chrome://extensions` → Developer mode
→ Load unpacked. Pin the AEGIS icon.

Have three tabs ready:
1. <http://localhost:8080/demo.html> — fixtures
2. `chrome://extensions` — to show the reload/inspect surface
3. The web app (`npm run dev -w frontend`) — for the zero-knowledge reveal

---

## Demo A · Chrome extension (~3 minutes)

### A1 — Unlock (20 s)

Click the AEGIS icon. It says **Vault locked**.

> "The extension starts locked. There's no 'remember me' — the key only ever
> lives in the service worker's memory."

Enter `alice` / `Demo@Vault2026` → **Unlock vault**.

### A2 — Signup form: generate and fill (45 s)

Scroll to **§2 Signup form**. Click the "Choose a password" field.

The AEGIS panel appears showing generated password, strength badge, score,
and estimated crack time.

> "Generated with `crypto.getRandomValues` and rejection sampling — never
> `Math.random`, which is predictable and has been exploited in real
> attacks."

- Click **Generate Again** — new password, live re-scoring.
- Click **Use Password** — **both** the password and confirm-password fields
  fill.

### A3 — Password-change form (20 s)

Scroll to **§3**. Click the **current** password field → no panel. Click the
**new** password field → panel appears.

> "It read the site's own `autocomplete` attributes to tell current-password
> from new-password, so it only offers to generate where that makes sense."

### A4 — Dynamic form / duplicate prevention (30 s)

Scroll to **§4**. Click **Inject signup form**, then focus its password
field — detected, panel appears.

Click **Re-render it 5×**.

> "That's a framework remount — five brand-new sets of DOM nodes. Exactly one
> panel exists, because the panel is a singleton in a shadow root."

Optional: DevTools → Elements → search `aegis-assistant-host` → one node.

### A5 — Payment form is refused (15 s)

Scroll to **§5**. Focus the password field inside the payment form.

> "Nothing. There's a `cc-number` field in this form, so AEGIS stays out
> entirely — and payment hosts are excluded in the manifest too."

### A6 — Origin binding / phishing rejection (30 s)

Show the popup on the demo page — the saved credential is offered.

> "Origin matching is exact on scheme, host, and port. No subdomain
> wildcarding — that fuzziness is exactly what `bank.com.evil.tld` exploits."

Point to the test proving it:

```bash
npm run test:extension -- -t "phishing"
```

### A7 — Service-worker restart (20 s)

`chrome://extensions` → AEGIS → **service worker** → terminate it (or wait
for idle). Reopen the popup: **locked again**.

> "MV3 kills the worker when idle. The key was a plain in-memory variable,
> so it died with it. Nothing persists an unlocked session — a restart is
> always locked."

---

## Demo B · Windows desktop assistant (~2 minutes)

> **Only run this if `dotnet build` succeeded during rehearsal.** If it did
> not, say so and show the Electron UI + tests instead — that is still a
> real deliverable.

### B1 — Start it

```bash
cd apps/desktop/native-helper/AegisNativeHelper && dotnet run    # terminal 1
npm run dev -w @aegis/desktop                                     # terminal 2
```

Show the tray icon: lock status, **Pause Assistant**, enable/disable, quit.

### B2 — Unlock and show controls

Unlock in the app window. Walk the three tabs: **Assistant**, **Credentials**,
**Apps** (per-application allow/deny).

### B3 — Detection and insertion

Focus a password field in a supported UIA application.

> "Detected through UI Automation focus-change events. No keyboard hook, no
> screenshots, no OCR, no clipboard watching — and that's enforced by a test
> that greps our own source for those APIs and fails the build if it finds
> them."

Show it:

```bash
npm run test:desktop -- -t "keylogging"
```

Click **Insert Password**.

> "Before writing, the helper re-checks the automation ID, the process ID,
> the executable hash, and that it's still a password field. Any mismatch
> refuses."

### B4 — Refusal on target change (the important one)

With the panel open, switch to a different window, then click **Insert
Password**.

> "Refused — the foreground process changed since detection."

### B5 — Fallback and clipboard

**Credentials** tab → **Copy** → point at the clearing countdown.

> "Self-clearing clipboard, and it only wipes if the clipboard still holds
> *our* value — it never clobbers something you copied yourself."

---

## Demo C · The zero-knowledge proof (~45 s) — strongest closer

Switch to the **web app**. Log in as `admin / Admin@Vault2026` → **Vault
Registry**.

> "This is the complete server-side record — exactly what an admin, a
> database dump, or an attacker who owns the backend would get."

Point at real `iv` and `ct` base64 values. Click **Attempt decrypt**.

> "`OperationError` — the AES-GCM authentication tag can't be verified. That
> isn't a scripted message; it's the browser's real crypto engine refusing.
> The key is derived from Alice's master password inside *her* browser. No
> admin role, no database credential, no server-side key recovers this."

Close with:

> "Passwords are analysed, generated, and filled everywhere the user works —
> browser and desktop — and the server never sees a single one of them."

---

## If something goes wrong

| Symptom | Cause / fix |
|---|---|
| No panel on the fixtures page | Opened via `file://`. Serve over `http://localhost:8080`. |
| Popup says locked right after unlocking | Service worker was suspended. Reopen and unlock — this is correct behaviour, and worth narrating. |
| Extension missing after a rebuild | Click reload on the AEGIS card in `chrome://extensions`. |
| `ENOENT \\.\pipe\aegis-native-helper` | The .NET helper is not running. Everything except detection/insertion still works. |
| Desktop shows no detection | Target app has no UIA accessibility support. Use the Credentials-tab copy fallback and say so — see `docs/LIMITATIONS.md`. |
| Breach check finds nothing | Offline. The local corpus is small; use **Demo: Simulate a Breach** on the web app's Security Health page. |

## Things to say honestly if asked

- The three clients **do not yet share one vault** — the backend that
  enables that is in progress. Each client's store uses the identical
  algorithm and schema, so they sync the moment it lands.
- The .NET helper's live UI Automation behaviour is **unverified**; the
  logic is unit-tested in both JS and C#.
- PBKDF2 rather than Argon2, deliberately — native WebCrypto support, no
  WASM dependency. Argon2 is the v2 upgrade.
