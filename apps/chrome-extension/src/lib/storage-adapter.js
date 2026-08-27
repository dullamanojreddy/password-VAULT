// Wraps chrome.storage.local behind the {get,set,remove} contract
// @aegis/shared's LocalVaultClient expects. chrome.storage.local persists
// only what we explicitly write — and this file, LocalVaultClient, and
// crypto.js are the entire universe of things this extension ever writes
// there. Grep this repo for "storage.local.set" if you ever need to audit
// exactly what touches disk.
export function makeChromeStorageAdapter() {
  return {
    async get(key) {
      const result = await chrome.storage.local.get(key)
      return result[key]
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value })
    },
    async remove(key) {
      await chrome.storage.local.remove(key)
    },
  }
}
