// ─── Canonical AEGIS credential shape ──────────────────────────────────────
// Mirrors the item shape frontend/src/lib/vault.js already persists:
//   { id, userId, app, username, url, category, password:{alg,iv,ct},
//     strength, entropy, createdAt, updatedAt, favorite,
//     locked, compromisedAt, compromiseReason, breachNotifiedAt }
//
// New fields below are ADDITIVE and OPTIONAL — an existing item that lacks
// them is still a fully valid credential. That's the backward-compatibility
// contract: nothing here may become required.

// A stable, hashed key for origin lookups (see normalizeOrigin/originHash
// below) — avoids re-parsing `url` on every match and gives extension/
// desktop clients a fast, consistent index.
export const ORIGIN_FIELD = 'originHash'

// Desktop-only: binds a credential to a specific application identity so it
// is never offered to (or filled into) a different, possibly malicious,
// program that merely shares a window title or process name.
export const APP_IDENTITY_FIELD = 'appIdentity'
/**
 * @typedef {Object} AppIdentity
 * @property {'win32'|'uwp'} type
 * @property {string} [executableHash]   sha256 of the resolved exe path's bytes, or a signed-publisher thumbprint — never the raw path alone
 * @property {string} [packageFamilyId]  UWP/packaged apps
 * @property {string} [publisher]        verified signer, when available
 * @property {string} [processName]      informational only — never used alone to authorize a fill
 */

export const SOURCE_FIELD = 'source' // 'web' | 'extension' | 'desktop' — informational only

/** Fields every credential draft must supply before encryption. */
const REQUIRED_DRAFT_FIELDS = ['app', 'username', 'password']

export function validateCredentialDraft(draft) {
  const errors = []
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['draft must be an object'] }
  for (const f of REQUIRED_DRAFT_FIELDS) {
    if (!draft[f] || typeof draft[f] !== 'string') errors.push(`"${f}" is required and must be a non-empty string`)
  }
  if (draft.appIdentity && typeof draft.appIdentity !== 'object') errors.push('"appIdentity" must be an object when present')
  if (draft.url != null && typeof draft.url !== 'string') errors.push('"url" must be a string when present')
  return { ok: errors.length === 0, errors }
}

// ─── Origin normalization & matching ───────────────────────────────────────
// Deliberately strict: scheme + host + port must match EXACTLY. No fuzzy
// subdomain matching, no www.-stripping — that fuzziness is exactly what a
// phishing lookalike domain would try to exploit ("secure-bank.evil.tld"
// must never be treated as a match for "bank.com").

export function normalizeOrigin(input) {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
    const u = new URL(withScheme)
    const port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '')
    const defaultPort = (u.protocol === 'https:' && port === '443') || (u.protocol === 'http:' && port === '80')
    return `${u.protocol}//${u.hostname.toLowerCase()}${defaultPort ? '' : port ? `:${port}` : ''}`
  } catch {
    return null
  }
}

export function isSecureOrigin(originOrUrl) {
  const n = normalizeOrigin(originOrUrl)
  return !!n && (n.startsWith('https://') || n.startsWith('http://localhost') || n.startsWith('http://127.0.0.1'))
}

export function originsMatch(a, b) {
  const na = normalizeOrigin(a)
  const nb = normalizeOrigin(b)
  return !!na && !!nb && na === nb
}

// ─── Desktop application identity matching ─────────────────────────────────
// Equally strict, and equally deliberate: a process name alone ("chrome.exe"
// exists on every Windows machine and proves nothing) is NEVER sufficient.
// A match requires the strongest identity signal both records share.

export function appIdentityMatches(saved, observed) {
  if (!saved || !observed) return false
  if (saved.type !== observed.type) return false
  if (saved.packageFamilyId && observed.packageFamilyId) {
    return saved.packageFamilyId === observed.packageFamilyId
  }
  if (saved.executableHash && observed.executableHash) {
    return saved.executableHash === observed.executableHash
  }
  // No strong signal on either side (e.g. an unsigned, unpackaged exe with
  // hashing unavailable) — refuse the match rather than fall back to name.
  return false
}
