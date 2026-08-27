// ─── Desktop-local assistant policy ────────────────────────────────────────
// Global enable/disable, pause, and per-application allow/deny rules for the
// desktop assistant. Deliberately separate from the AEGIS password policy
// (min length, entropy floor, etc. — that one lives in vaultClient.getPolicy
// and is NOT user-editable here, same as the extension's options page: it's
// admin-owned). This store only governs "does the assistant engage at all,"
// never password rules.

const KEY = 'aegis.desktop.assistant-policy'

const DEFAULTS = Object.freeze({
  globallyEnabled: true,
  paused: false,
  // { [processName-or-packageFamilyId]: 'allow' | 'deny' }
  perAppRules: {},
})

export function createPolicyStore(storage) {
  async function read() {
    return { ...DEFAULTS, ...(await storage.get(KEY)) }
  }
  async function write(patch) {
    const cur = await read()
    const next = { ...cur, ...patch }
    await storage.set(KEY, next)
    return next
  }

  return {
    async getState() { return read() },

    async setGloballyEnabled(enabled) { return write({ globallyEnabled: !!enabled }) },
    async setPaused(paused) { return write({ paused: !!paused }) },

    async setAppRule(appKey, rule) {
      if (rule !== 'allow' && rule !== 'deny') throw new Error('rule must be "allow" or "deny"')
      const cur = await read()
      const perAppRules = { ...cur.perAppRules, [appKey]: rule }
      return write({ perAppRules })
    },

    async clearAppRule(appKey) {
      const cur = await read()
      const perAppRules = { ...cur.perAppRules }
      delete perAppRules[appKey]
      return write({ perAppRules })
    },

    /** Should the assistant engage right now for this app identity? */
    async shouldEngage(appKey) {
      const s = await read()
      if (!s.globallyEnabled || s.paused) return false
      const rule = s.perAppRules[appKey]
      return rule !== 'deny'
    },
  }
}
