// ─── Pure message router ────────────────────────────────────────────────
// Everything the service worker does, minus the chrome.* wiring — so this
// file can be unit-tested with a mocked vault client and no real extension
// runtime. service-worker.js is the thin, untested-by-necessity shim that
// constructs the real LocalVaultClient/chrome APIs and hands them here.

import { ACTIONS } from '../lib/messaging.js'

/**
 * @param {{
 *   vaultClient: import('@aegis/shared/vault-client').LocalVaultClient,
 *   getSitePolicy: (origin: string) => Promise<'allow'|'deny'|undefined>,
 *   setSitePolicy: (origin: string, allow: boolean) => Promise<void>,
 *   onCredentialsOffered?: (tabId: number, count: number) => void,
 * }} deps
 */
export function createRouter(deps) {
  const { vaultClient, getSitePolicy, setSitePolicy, onCredentialsOffered } = deps

  async function handle(message, sender) {
    const { action, payload } = message

    switch (action) {
      case ACTIONS.GET_STATUS:
        return { ok: true, ...vaultClient.getStatus() }

      case ACTIONS.UNLOCK:
        return vaultClient.unlock(payload.username, payload.masterPassword)

      case ACTIONS.LOCK:
        await vaultClient.lock('user requested')
        return { ok: true }

      case ACTIONS.GENERATE_PASSWORD:
        return { ok: true, password: vaultClient.generatePassword(payload ?? {}) }

      case ACTIONS.ANALYZE_PASSWORD:
        return { ok: true, analysis: await vaultClient.analyzePassword(payload.password) }

      case ACTIONS.FIND_BY_ORIGIN: {
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        if (!vaultClient.assertSecureOrigin(payload.origin)) return { ok: false, error: 'insecure-origin' }
        const policy = await getSitePolicy(payload.origin)
        if (policy === 'deny') return { ok: true, matches: [] }
        return { ok: true, matches: await vaultClient.findByOrigin(payload.origin) }
      }

      case ACTIONS.REVEAL_CREDENTIAL: {
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        if (!sender?.tab?.url) return { ok: false, error: 'missing sender tab url' }
        const items = await vaultClient.findByOrigin(payload.origin)
        const item = items.find((i) => i.id === payload.id)
        if (!item) return { ok: false, error: 'not-found-or-origin-mismatch' }
        if (!vaultClient.assertOriginMatch(item, sender.tab.url)) return { ok: false, error: 'origin-mismatch' }
        const plaintext = await vaultClient.revealCredential(payload.id, { reasonForAudit: 'extension-autofill' })
        return plaintext == null ? { ok: false, error: 'locked-or-not-found' } : { ok: true, password: plaintext, username: item.username }
      }

      case ACTIONS.CREATE_CREDENTIAL: {
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        if (payload.url && !vaultClient.assertSecureOrigin(payload.url)) return { ok: false, error: 'insecure-origin' }
        return vaultClient.createCredential({ ...payload, source: 'extension' })
      }

      case ACTIONS.SUBMIT_AUDIT:
        await vaultClient.submitAudit(payload.action, payload.detail, payload.severity ?? 'info')
        return { ok: true }

      case ACTIONS.GET_SITE_POLICY: {
        const rule = await getSitePolicy(payload.origin)
        return { ok: true, allow: rule !== 'deny' }
      }

      case ACTIONS.SET_SITE_POLICY:
        await setSitePolicy(payload.origin, payload.allow)
        await vaultClient.submitAudit('assistant.site_policy_changed', `${payload.origin} -> ${payload.allow ? 'allow' : 'deny'}`, 'info')
        return { ok: true }

      case ACTIONS.OFFER_CREDENTIALS_FOR_TAB:
        if (sender?.tab?.id != null) onCredentialsOffered?.(sender.tab.id, payload.matches.length)
        return { ok: true }

      default:
        return { ok: false, error: `unhandled action "${action}"` }
    }
  }

  return { handle }
}
