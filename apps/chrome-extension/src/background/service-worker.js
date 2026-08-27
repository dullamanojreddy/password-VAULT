// ─── AEGIS background service worker ───────────────────────────────────────
// The only place in this extension that ever touches the encryption key,
// the vault client, or decrypted credential data. Content scripts and the
// popup never see key material — they send validated requests here and get
// back only what the requested operation is supposed to return. The actual
// routing logic lives in router.js as a pure, unit-tested function; this
// file only wires it to the real chrome.* runtime.
//
// MV3 service workers are ephemeral: Chrome terminates this worker after a
// short idle period and restarts it on the next event. `vaultClient` is a
// plain module-level variable, so termination genuinely destroys the
// in-memory session and the derived key with it — there is no code path
// that persists either to survive a restart. A restarted worker starts
// locked, exactly like requirement #13 asks for. This is not simulated;
// it's a structural consequence of not writing the key anywhere.

import { LocalVaultClient } from '@aegis/shared/vault-client'
import { makeChromeStorageAdapter } from '../lib/storage-adapter.js'
import { validateMessage } from '../lib/messaging.js'
import { createRouter } from './router.js'

const vaultClient = new LocalVaultClient(makeChromeStorageAdapter(), { clientName: 'chrome-extension' })

const SITE_POLICY_KEY = 'aegis.ext.site-policy' // { [normalizedOrigin]: 'allow'|'deny' }

async function getSitePolicyMap() {
  const stored = await chrome.storage.local.get(SITE_POLICY_KEY)
  return stored[SITE_POLICY_KEY] ?? {}
}

const router = createRouter({
  vaultClient,
  async getSitePolicy(origin) {
    return (await getSitePolicyMap())[origin]
  },
  async setSitePolicy(origin, allow) {
    const map = await getSitePolicyMap()
    map[origin] = allow ? 'allow' : 'deny'
    await chrome.storage.local.set({ [SITE_POLICY_KEY]: map })
  },
  onCredentialsOffered(tabId, count) {
    if (count > 0) {
      chrome.action.setBadgeText({ tabId, text: String(count) })
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#38bdf8' })
    }
  },
})

async function syncToWebTabs(item) {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://localhost:5173/*', 'http://127.0.0.1:5173/*'] })
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (newItem) => {
            try {
              const KEY = 'aegis.db.v1'
              const raw = localStorage.getItem(KEY)
              const db = raw ? JSON.parse(raw) : { users: [], items: [], audit: [] }
              db.items = db.items || []
              const activeUser = db.users?.[0]
              if (activeUser) {
                newItem.userId = activeUser.id
              }
              const existingIdx = db.items.findIndex((i) => i.id === newItem.id)
              if (existingIdx >= 0) {
                db.items[existingIdx] = newItem
              } else {
                db.items.unshift(newItem)
              }
              localStorage.setItem(KEY, JSON.stringify(db))
              window.dispatchEvent(new CustomEvent('aegis:vault-updated', { detail: newItem }))
            } catch (e) {}
          },
          args: [item],
        }).catch(() => {})
      }
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const validation = validateMessage(message, sender)
  if (!validation.ok) {
    console.warn('[AEGIS] rejected message:', validation.error)
    sendResponse({ ok: false, error: validation.error })
    return false
  }

  router.handle(message, sender).then(async (result) => {
    if (message.action === 'aegis/create-credential' && result?.ok && result?.item) {
      await syncToWebTabs(result.item)
    }
    sendResponse(result)
  }).catch((err) => {
    sendResponse({ ok: false, error: err?.message ?? 'internal error' })
  })
  return true // keep the message channel open for the async response
})

// Clear the badge whenever a tab navigates, so a stale "credentials
// available" count never survives to a different page.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' })
})
