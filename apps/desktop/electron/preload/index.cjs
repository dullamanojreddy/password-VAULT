// ─── Preload bridge ──────────────────────────────────────────────────────
// The ONLY surface the renderer can reach. contextIsolation is on and
// nodeIntegration is off (see main/index.js), so this is the sole channel
// between untrusted renderer code and anything privileged — every method
// here is a thin, validated wrapper around a single ipcRenderer.invoke
// call; there is no generic "run this" escape hatch, no direct Node access,
// and no way for the renderer to reach the filesystem, the vault key, or
// the native-helper connection except through the specific verbs below.
const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED_EVENTS = new Set(['native/field-detected', 'native/field-lost', 'native/unsupported-target', 'clipboard/countdown', 'assistant/policy-changed'])

contextBridge.exposeInMainWorld('aegis', {
  // Generic-looking but NOT arbitrary: main process's ipcRouter validates
  // `action` against a fixed allow-list schema (see ipc-router.js) before
  // doing anything — this is a dispatch call, not a remote-code channel.
  invoke: (action, payload) => ipcRenderer.invoke('aegis-ipc', { action, payload }),

  on: (eventName, handler) => {
    if (!ALLOWED_EVENTS.has(eventName)) throw new Error(`unknown event "${eventName}"`)
    const wrapped = (_event, payload) => handler(payload)
    ipcRenderer.on(eventName, wrapped)
    return () => ipcRenderer.removeListener(eventName, wrapped)
  },
})
