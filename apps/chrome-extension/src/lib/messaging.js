// ─── Privileged message schema + validation ────────────────────────────────
// Every message the background service worker accepts from a content script
// is validated here before it touches the vault client: sender must be this
// extension's own content script (not an injected page script pretending to
// be one), the action must be a known name, and the payload must match its
// declared shape. Unknown actions and malformed payloads are rejected with
// a structured error, never silently ignored (which would hide bugs) and
// never trusted-by-default (which would be a privilege-escalation hole).

export const ACTIONS = Object.freeze({
  GET_STATUS: 'aegis/get-status',
  UNLOCK: 'aegis/unlock',
  LOCK: 'aegis/lock',
  GENERATE_PASSWORD: 'aegis/generate-password',
  ANALYZE_PASSWORD: 'aegis/analyze-password',
  FIND_BY_ORIGIN: 'aegis/find-by-origin',
  REVEAL_CREDENTIAL: 'aegis/reveal-credential',
  CREATE_CREDENTIAL: 'aegis/create-credential',
  SUBMIT_AUDIT: 'aegis/submit-audit',
  GET_SITE_POLICY: 'aegis/get-site-policy',
  SET_SITE_POLICY: 'aegis/set-site-policy',
  OFFER_CREDENTIALS_FOR_TAB: 'aegis/offer-credentials-for-tab',
})

// { [action]: (payload) => string[] of validation errors, [] if valid }
const SCHEMAS = {
  [ACTIONS.GET_STATUS]: () => [],
  [ACTIONS.UNLOCK]: (p) => [
    ...(typeof p?.username === 'string' && p.username.length > 0 ? [] : ['username must be a non-empty string']),
    ...(typeof p?.masterPassword === 'string' && p.masterPassword.length > 0 ? [] : ['masterPassword must be a non-empty string']),
  ],
  [ACTIONS.LOCK]: () => [],
  [ACTIONS.GENERATE_PASSWORD]: (p) => (p == null || typeof p === 'object' ? [] : ['payload must be an object or omitted']),
  [ACTIONS.ANALYZE_PASSWORD]: (p) => (typeof p?.password === 'string' ? [] : ['password must be a string']),
  [ACTIONS.FIND_BY_ORIGIN]: (p) => (typeof p?.origin === 'string' && p.origin.length > 0 ? [] : ['origin must be a non-empty string']),
  [ACTIONS.REVEAL_CREDENTIAL]: (p) => (typeof p?.id === 'string' && typeof p?.origin === 'string' ? [] : ['id and origin are required']),
  [ACTIONS.CREATE_CREDENTIAL]: (p) => [
    ...(typeof p?.app === 'string' && p.app ? [] : ['app is required']),
    ...(typeof p?.username === 'string' && p.username ? [] : ['username is required']),
    ...(typeof p?.password === 'string' && p.password ? [] : ['password is required']),
    ...(p?.url == null || typeof p.url === 'string' ? [] : ['url must be a string when present']),
  ],
  [ACTIONS.SUBMIT_AUDIT]: (p) => (typeof p?.action === 'string' ? [] : ['action is required']),
  [ACTIONS.GET_SITE_POLICY]: (p) => (typeof p?.origin === 'string' ? [] : ['origin is required']),
  [ACTIONS.SET_SITE_POLICY]: (p) => (typeof p?.origin === 'string' && typeof p?.allow === 'boolean' ? [] : ['origin and allow are required']),
  [ACTIONS.OFFER_CREDENTIALS_FOR_TAB]: (p) => (typeof p?.origin === 'string' && Array.isArray(p?.matches) ? [] : ['origin and matches[] are required']),
}

/**
 * Validates an inbound runtime message + its sender before any privileged
 * work happens. Returns { ok: true } or { ok: false, error }.
 */
export function validateMessage(message, sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return { ok: false, error: 'rejected: message did not originate from this extension' }
  }
  if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
    return { ok: false, error: 'rejected: malformed message envelope' }
  }
  const schema = SCHEMAS[message.action]
  if (!schema) {
    return { ok: false, error: `rejected: unknown action "${message.action}"` }
  }
  // Content-script-originated messages must declare the page origin they
  // were sent from; the background worker treats sender.url/sender.tab as
  // the source of truth and ignores any origin claimed inside the payload
  // for security-relevant checks (origin matching is re-derived server-side
  // of this boundary, i.e. inside the service worker, from sender.url).
  if (sender.tab && typeof sender.url !== 'string') {
    return { ok: false, error: 'rejected: missing sender URL for tab-originated message' }
  }
  const errors = schema(message.payload)
  if (errors.length) {
    return { ok: false, error: `rejected: invalid payload — ${errors.join('; ')}` }
  }
  return { ok: true }
}
