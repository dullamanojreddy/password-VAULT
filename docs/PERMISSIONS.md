# Permissions Justification

## Chrome extension (`apps/chrome-extension/manifest.json`)

Principle applied: request the least that makes the feature work, prefer
optional/per-site grants, and never request a permission "just in case".

### Required permissions

| Permission | Why it is needed | What breaks without it |
|---|---|---|
| `storage` | Persist the encrypted vault (`chrome.storage.local`), per-site allow/deny rules, and the audit log. Only ciphertext and metadata are ever written. | No credential storage at all. |
| `scripting` | Reserved for programmatic injection on sites granted access at runtime via `optional_host_permissions`, rather than shipping a blanket static injection for every host. | Cannot activate on a site the user grants access to on demand. |
| `activeTab` | Lets the popup act on the tab the user explicitly invoked it on, without holding standing access to that origin. | The popup could not read the current tab's origin to offer matching credentials. |
| `alarms` | Schedules periodic lock/expiry checks that survive MV3 service-worker suspension (a plain `setTimeout` does not). | Idle-lock timing becomes unreliable when Chrome suspends the worker. |

### Optional host permissions

```json
"optional_host_permissions": ["http://*/*", "https://*/*"]
```

Declared **optional**, not required. The user grants access per site.
`activeTab` covers the common popup-driven flow without any standing grant.

### Content-script matches

```json
"matches": ["http://*/*", "https://*/*"]
```

Password fields can appear on any site, and a form detector that only runs
on a hardcoded allowlist would miss most of them. To bound the exposure:

- **`exclude_matches`** removes Google account pages, PayPal, Stripe,
  `checkout.*` hosts, and the Chrome Web Store.
- Chrome itself blocks injection into `chrome://` internal pages, the Web
  Store, and other extensions' pages — no manifest entry needed.
- The script does nothing on a page with no password field: no network
  calls, no storage access, no UI.
- Payment forms are detected and skipped at runtime, in addition to the
  host-level exclusions.
- Per-site deny rules (Options page) suppress the extension on any host the
  user chooses.

### Permissions deliberately **not** requested

| Not requested | Why we avoid it |
|---|---|
| `tabs` | `activeTab` + `sender.tab` already provide everything needed. The full `tabs` permission would grant visibility into every tab's URL. |
| `webRequest` / `webRequestBlocking` | We never inspect or modify network traffic. |
| `cookies` | Never read or set cookies. |
| `history`, `bookmarks`, `downloads` | Irrelevant to the feature. |
| `clipboardRead` | We never read the clipboard. (The desktop app writes and clears its own value only.) |
| `nativeMessaging` | The extension does not talk to the desktop helper — deliberately separate attack surfaces. |
| `<all_urls>` as a **required** host permission | Downgraded to optional, per the guidance above. |

### Content Security Policy

```json
"extension_pages": "script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none'"
```

No remote code, no `eval`, no CDN. Everything is bundled at build time by
esbuild into self-contained files.

---

## Windows desktop assistant (`apps/desktop`)

### OS-level privileges

| Capability | Status |
|---|---|
| Administrator elevation | **Never requested.** `app.manifest` sets `requestedExecutionLevel = asInvoker`, `uiAccess = false`. |
| UI Automation client access | Standard user-level API. No special entitlement needed to read accessible properties of same-privilege applications. |
| Global keyboard hooks | **Not used.** Enforced by an automated source scan (`test/no-keylogging.test.js`). |
| Screen capture / OCR | **Not used.** Same enforcement. |
| Clipboard monitoring | **Not used.** The app writes its own value and clears it; it never watches clipboard changes. |
| Filesystem | Only Electron's per-user `userData` directory, for the encrypted vault store. |
| Network | The Electron process makes no outbound connections except the k-anonymity breach lookup (5 hash characters). |

### Electron renderer hardening

```js
nodeIntegration: false,   // renderer has no Node globals
contextIsolation: true,   // preload and page run in separate worlds
sandbox: true,            // OS-level Chromium sandbox
webviewTag: false,        // no embedded browser surface
```

Plus a strict CSP in `index.html` (`default-src 'self'`, `object-src 'none'`,
`base-uri 'none'`, `frame-ancestors 'none'`).

The renderer reaches privileged functionality only through a minimal
`contextBridge` surface exposing two methods — `invoke(action, payload)` and
`on(eventName, handler)` — where `action` is validated against a fixed
allow-list schema in the main process and `eventName` against a fixed set of
four permitted events. There is no generic "execute this" channel.

### Native helper IPC

The helper listens on `\\.\pipe\aegis-native-helper`, created with a
`PipeSecurity` ACL granting `ReadWrite` to **only the current Windows user's
SID**. No rule is granted to `Everyone` or `Authenticated Users` — the
absence of a grant is the deny.

That ACL is the authentication boundary, which is *why* no shared-secret
token is used: a token would have to travel through a command-line argument,
an environment variable, or a file, and the spec (correctly) forbids putting
secrets in any of those. Messages are still schema-validated in both
directions regardless, because "the transport is trusted" and "the payload
is well-formed" are different guarantees.

### What the desktop assistant refuses to touch

- UAC secure desktop and Windows sign-in / credential-provider screens
- Protected system processes (PID ≤ 4)
- Processes elevated relative to the helper (reported as unsupported when
  module inspection returns access-denied, never retried with elevation)
- Controls that expose no settable UI Automation value
- Browser processes (`chrome`, `msedge`, `firefox`, `brave`, `opera`,
  `vivaldi`) — deliberately ignored so the desktop assistant never conflicts
  with the Chrome extension
