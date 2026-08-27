// ─── AEGIS Desktop Assistant — Electron main process ───────────────────────
// Security posture (all required, none optional):
//   nodeIntegration: false   — renderer never gets Node globals
//   contextIsolation: true   — renderer JS and preload JS run in separate
//                              worlds; only contextBridge-exposed methods
//                              cross that boundary
//   sandbox: true            — renderer process runs in Chromium's OS-level
//                              sandbox, same as a regular web page
//   no remote-code loading, no `remote` module, no `webviewTag`
// The vault key lives ONLY in the LocalVaultClient instance below — a
// module-level variable in this process, never written to disk, never
// passed to the renderer. Locking, suspending, or quitting drops the
// reference; there is no path that keeps it alive past that.
import { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, powerMonitor, nativeImage } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LocalVaultClient } from '@aegis/shared/vault-client'
import { makeFileStorageAdapter } from './storage-adapter.js'
import { createPolicyStore } from './policy-store.js'
import { createClipboardGuard } from './clipboard-guard.js'
import { NativeHelperBridge } from './native-bridge.js'
import { createIpcRouter } from './ipc-router.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let tray = null

const storage = makeFileStorageAdapter(join(app.getPath('userData'), 'vault-store'))
const vaultClient = new LocalVaultClient(storage, { clientName: 'desktop' })
const policyStore = createPolicyStore(storage)
const nativeBridge = new NativeHelperBridge()
const clipboardGuard = createClipboardGuard({
  writeText: (t) => clipboard.writeText(t),
  readText: () => clipboard.readText(),
})

const ipcRouter = createIpcRouter({
  vaultClient,
  policyStore,
  nativeHelper: { requestInsert: (args) => nativeBridge.requestInsert(args) },
  clipboard: {
    writeAndScheduleClear: (text, seconds) =>
      clipboardGuard.writeAndScheduleClear(text, seconds, (remaining) => {
        mainWindow?.webContents.send('clipboard/countdown', { remaining })
      }),
  },
})

function appKeyFor(appIdentity) {
  return appIdentity?.packageFamilyId ?? appIdentity?.executableHash ?? appIdentity?.processName ?? 'unknown'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180')
  } else {
    mainWindow.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, '..', '..', 'public', 'icons', 'tray32.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  refreshTrayMenu()
  tray.on('click', () => { mainWindow?.show() })
}

async function refreshTrayMenu() {
  const status = vaultClient.getStatus()
  const policy = await policyStore.getState()
  tray?.setToolTip(`AEGIS — ${status.locked ? 'Locked' : 'Unlocked'}`)
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: `AEGIS — ${status.locked ? 'Locked' : `Unlocked (${status.username})`}`, enabled: false },
    { type: 'separator' },
    { label: policy.paused ? 'Resume Assistant' : 'Pause Assistant', click: async () => { await policyStore.setPaused(!policy.paused); refreshTrayMenu() } },
    { label: policy.globallyEnabled ? 'Disable AEGIS' : 'Enable AEGIS', click: async () => { await policyStore.setGloballyEnabled(!policy.globallyEnabled); refreshTrayMenu() } },
    { type: 'separator' },
    { label: 'Open AEGIS', click: () => mainWindow?.show() },
    { label: status.locked ? 'Unlock…' : 'Lock now', click: async () => { if (!status.locked) { await vaultClient.lock('tray'); refreshTrayMenu() } else mainWindow?.show() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ]))
}

// ── Native helper event relay ───────────────────────────────────────────
nativeBridge.on('field-detected', async (payload) => {
  const key = appKeyFor(payload.appIdentity)
  if (!(await policyStore.shouldEngage(key))) return // globally disabled, paused, or denied for this app
  mainWindow?.webContents.send('native/field-detected', payload)
})
nativeBridge.on('field-lost', () => mainWindow?.webContents.send('native/field-lost', {}))
nativeBridge.on('unsupported-target', (payload) => mainWindow?.webContents.send('native/unsupported-target', payload))
nativeBridge.on('error', (err) => console.error('[AEGIS] native helper error:', err.message))
nativeBridge.on('protocol-error', (msg) => console.warn('[AEGIS] rejected native helper message:', msg))

// ── Renderer IPC ─────────────────────────────────────────────────────────
ipcMain.handle('aegis-ipc', async (_event, message) => ipcRouter.handle(message))

// ── Auto-lock (idle) ───────────────────────────────────────────────────
setInterval(async () => {
  if (!vaultClient.isUnlocked()) return
  const policy = await vaultClient.getPolicy()
  const idleSeconds = powerMonitor.getSystemIdleTime()
  if (idleSeconds > policy.autoLockMinutes * 60) {
    await vaultClient.lock('idle timeout')
    mainWindow?.webContents.send('assistant/policy-changed', { locked: true })
    refreshTrayMenu()
  }
}, 5000)

powerMonitor.on('suspend', () => vaultClient.lock('system suspend'))
powerMonitor.on('lock-screen', () => vaultClient.lock('screen locked'))

app.on('before-quit', async () => {
  app.isQuitting = true
  await vaultClient.lock('app exit')
  nativeBridge.disconnect()
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  nativeBridge.connect()
  mainWindow.once('ready-to-show', () => mainWindow.show())
})

app.on('window-all-closed', () => {
  // Tray-resident app: closing the window does not quit AEGIS (see the
  // `close` handler above), so this only fires on real app.quit().
  if (process.platform !== 'darwin') app.quit()
})
