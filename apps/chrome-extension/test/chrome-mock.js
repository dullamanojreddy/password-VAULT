// Minimal chrome.* mock — just enough surface area for router.js and
// messaging.js to run under vitest without a real browser extension host.
import { vi } from 'vitest'

export const EXTENSION_ID = 'test-extension-id'

export function installChromeMock() {
  const storageData = {}
  const badges = {}

  globalThis.chrome = {
    runtime: { id: EXTENSION_ID },
    storage: {
      local: {
        get: vi.fn(async (key) => {
          if (typeof key === 'string') return { [key]: storageData[key] }
          return { ...storageData }
        }),
        set: vi.fn(async (obj) => { Object.assign(storageData, obj) }),
        remove: vi.fn(async (key) => { delete storageData[key] }),
      },
    },
    action: {
      setBadgeText: vi.fn(async ({ tabId, text }) => { badges[tabId] = text }),
      setBadgeBackgroundColor: vi.fn(async () => {}),
    },
    tabs: {
      onUpdated: { addListener: vi.fn() },
    },
  }

  return { storageData, badges }
}

export function makeSender(overrides = {}) {
  // Mirrors the real chrome.runtime.MessageSender shape: `url` is a
  // TOP-LEVEL field (the sending frame's URL), separate from `tab.url`
  // (which is the tab's current top-frame URL and can differ in a frame).
  const tab = overrides.tab ?? { id: 1, url: 'https://example.com/login' }
  return { id: EXTENSION_ID, tab, url: tab.url, ...overrides }
}
