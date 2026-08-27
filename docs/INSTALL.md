# Build & Install Guide

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | ≥ 20 (tested on 24.13.1) | everything |
| npm | ≥ 10 (tested on 11.8.0) | everything |
| .NET SDK | 8.0 | Windows native helper only |
| Chrome / Chromium | ≥ 116 | extension |
| Windows | 10 or 11 | desktop assistant |

Install the .NET 8 SDK from <https://dotnet.microsoft.com/download/dotnet/8.0>
if `dotnet --version` is not found.

## One-time setup

```bash
git clone https://github.com/lucky2132621326/password-VAULT.git
cd password-VAULT
npm install          # installs all workspaces
```

## Run everything's tests

```bash
npm test                 # all JS workspaces (147 tests)
npm run test:shared      # 35
npm run test:extension   # 46
npm run test:desktop     # 71
```

---

## 1 · Web application

```bash
npm run build:web            # production build
npm run dev -w frontend      # dev server on http://localhost:5173
```

Demo accounts: `alice / Demo@Vault2026` (user), `admin / Admin@Vault2026` (admin).

---

## 2 · Chrome extension

### Build

```bash
npm run build:extension
```

Produces `apps/chrome-extension/dist/` — a complete, loadable unpacked MV3
extension.

### Load into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the folder: `apps/chrome-extension/dist`
5. The AEGIS icon appears in the toolbar. Pin it for the demo.

### First use

1. Click the AEGIS toolbar icon → the popup shows **Vault locked**.
2. Enter any account name and master password. The **first** unlock for a
   given account name provisions that local profile with that password;
   subsequent unlocks verify against it.
3. The popup now shows **Unlocked**, plus any saved credentials matching the
   current tab's origin.

### Serve the demo fixtures

Content scripts only match `http`/`https`, so `file://` will not work:

```bash
npx serve apps/chrome-extension/test/fixtures -l 8080
```

Then open <http://localhost:8080/demo.html>. (`localhost` is treated as a
secure origin, so fill and save are enabled.)

### Rebuilding after a change

```bash
npm run build:extension
```

Then click the **reload** icon on the AEGIS card in `chrome://extensions`.

---

## 3 · Windows desktop assistant

### Build the native helper

```bash
cd apps/desktop/native-helper
dotnet build -c Release
dotnet test                     # runs the C# unit tests
```

> ⚠️ This has **never been compiled** in the development environment used to
> write it (no .NET SDK was available). Expect to fix compilation errors on
> first build. See `docs/LIMITATIONS.md`.

### Run in development

Three processes, in this order:

```bash
# Terminal 1 — the UI Automation helper (creates the named pipe)
cd apps/desktop/native-helper/AegisNativeHelper
dotnet run

# Terminal 2 — the renderer dev server (port 5180, NOT 5173)
npm run dev:renderer -w @aegis/desktop

# Terminal 3 — Electron
npm run start:electron -w @aegis/desktop
```

Or, from `apps/desktop`, `npm run dev` runs terminals 2 and 3 together via
`concurrently`. The helper must still be started separately.

If the helper is not running, Electron logs
`native helper error: connect ENOENT \\.\pipe\aegis-native-helper` on a
reconnect loop. That is expected and harmless — the vault, generator,
credential list, and manual copy fallback all work without it; only
automatic field detection and insertion require the helper.

### Package for distribution

```bash
cd apps/desktop/native-helper && dotnet build -c Release && cd ../../..
npm run package:win -w @aegis/desktop
```

Produces an NSIS installer under `apps/desktop/dist/`. Configured as a
per-user install with `requestedExecutionLevel: asInvoker` — **no
administrator rights required** to install or run.

---

## Repository layout

```
frontend/                     existing AEGIS web app (unchanged)
packages/shared/              canonical crypto, strength, schema, vault client
apps/chrome-extension/
  ├── manifest.json           MV3 manifest
  ├── src/background/         service worker + pure message router
  ├── src/content/            classifier, observer, panel, content script
  ├── src/popup/  src/options/
  ├── test/fixtures/demo.html demo pages
  └── dist/                   build output — load this into Chrome
apps/desktop/
  ├── electron/main/          main process, IPC router, policy, clipboard, bridge
  ├── electron/preload/       contextBridge surface
  ├── src/                    React renderer
  └── native-helper/          .NET 8 UI Automation helper + xUnit tests
docs/                         overview, threat model, permissions, limitations, demo
```
