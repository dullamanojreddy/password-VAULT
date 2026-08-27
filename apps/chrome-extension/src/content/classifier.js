// ─── Password field & form classification ──────────────────────────────────
// Pure functions over DOM elements — no chrome.* calls, no module-level
// state — so this file is unit-testable with jsdom and reusable from both
// the content script and its tests without mocking the extension runtime.

const NEW_PW_HINTS = /new.?password|create.?password|choose.?a.?password|confirm.?password|password.?confirm|repeat.?password|signup|sign.?up|emailsignup|register|create.?account|get.?started/i
const CURRENT_PW_HINTS = /current.?password|log.?in.?password|sign.?in/i
const RESET_HINTS = /reset.?password|forgot.?password|change.?password|update.?password|new.?password/i

const LOGIN_URL_HINTS = /(login|signin|log-in|sign-in|auth)/i
const SIGNUP_URL_HINTS = /(signup|sign-up|emailsignup|register|create-account|join|get-started|start|onboarding)/i
const RESET_URL_HINTS = /reset[-_]?password|forgot[-_]?password|change[-_]?password|update[-_]?password|reset|forgot/i

const PAYMENT_AUTOCOMPLETE = /^cc-|^cc$/i

// ── Field-level classification ──────────────────────────────────────────

export function isPasswordField(input) {
  if (!input || input.tagName !== 'INPUT') return false
  const type = (input.getAttribute('type') || 'text').toLowerCase()
  if (type === 'password') return true
  const ac = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase()
  return ac === 'new-password' || ac === 'current-password'
}

export function isPaymentField(input) {
  const ac = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase()
  return PAYMENT_AUTOCOMPLETE.test(ac)
}

function nearbyText(input) {
  const parts = []
  if (input.labels) for (const l of input.labels) parts.push(l.textContent || '')
  const aria = input.getAttribute('aria-label')
  if (aria) parts.push(aria)
  const placeholder = input.getAttribute('placeholder')
  if (placeholder) parts.push(placeholder)
  const describedBy = input.getAttribute('aria-describedby')
  if (describedBy) {
    const root = input.getRootNode?.() ?? document
    const el = root.getElementById?.(describedBy)
    if (el) parts.push(el.textContent || '')
  }
  parts.push(input.name || '', input.id || '')
  return parts.join(' ').toLowerCase()
}

/**
 * @returns {'new-password'|'current-password'|'password'}
 */
export function getFieldRole(input) {
  const ac = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase()
  if (ac === 'new-password') return 'new-password'
  if (ac === 'current-password') return 'current-password'

  const text = nearbyText(input)
  if (NEW_PW_HINTS.test(text)) return 'new-password'
  if (CURRENT_PW_HINTS.test(text)) return 'current-password'
  return 'password'
}

// ── Form-level classification ────────────────────────────────────────────

/**
 * @param {HTMLElement} container  a <form> or a form-like wrapper div
 * @param {string} [pageUrl]
 * @returns {{ kind: 'login'|'signup'|'password-change'|'unknown',
 *             confidence: number, fields: { current: HTMLInputElement|null,
 *             new: HTMLInputElement|null, confirm: HTMLInputElement|null },
 *             hasPaymentFields: boolean }}
 */
export function classifyForm(container, pageUrl = '') {
  const inputs = Array.from(container.querySelectorAll('input'))
  const pwFields = inputs.filter(isPasswordField)
  const hasPaymentFields = inputs.some(isPaymentField)

  if (pwFields.length === 0) {
    return { kind: 'unknown', confidence: 0, fields: { current: null, new: null, confirm: null }, hasPaymentFields }
  }

  const roled = pwFields.map((f) => ({ field: f, role: getFieldRole(f) }))
  const current = roled.find((r) => r.role === 'current-password')?.field ?? null
  const news = roled.filter((r) => r.role === 'new-password').map((r) => r.field)
  const unlabeled = roled.filter((r) => r.role === 'password').map((r) => r.field)

  const urlText = (pageUrl || location.href || '').toLowerCase()
  const formText = ((container.textContent || '') + ' ' + (document?.title || '')).slice(0, 3000).toLowerCase()

  if (current && news.length >= 1) {
    return { kind: 'password-change', confidence: 0.95, fields: { current, new: news[0], confirm: news[1] ?? null }, hasPaymentFields }
  }

  if (news.length >= 2) {
    const kind = RESET_URL_HINTS.test(urlText) || RESET_HINTS.test(formText) ? 'password-change' : 'signup'
    return { kind, confidence: 0.85, fields: { current: null, new: news[0], confirm: news[1] }, hasPaymentFields }
  }

  if (news.length === 1) {
    const kind = RESET_URL_HINTS.test(urlText) || RESET_HINTS.test(formText) ? 'password-change' : 'signup'
    return { kind, confidence: 0.75, fields: { current: null, new: news[0], confirm: unlabeled[0] ?? null }, hasPaymentFields }
  }

  if (current) {
    return { kind: 'login', confidence: 0.9, fields: { current, new: null, confirm: null }, hasPaymentFields }
  }

  if (unlabeled.length === 1) {
    if (SIGNUP_URL_HINTS.test(urlText) || /sign.?up|get.?started|create.?account|join|register|start/i.test(formText)) {
      return { kind: 'signup', confidence: 0.8, fields: { current: null, new: unlabeled[0], confirm: null }, hasPaymentFields }
    }
    if (LOGIN_URL_HINTS.test(urlText) || /log.?in|sign.?in/i.test(formText)) {
      return { kind: 'login', confidence: 0.6, fields: { current: unlabeled[0], new: null, confirm: null }, hasPaymentFields }
    }
    return { kind: 'signup', confidence: 0.5, fields: { current: null, new: unlabeled[0], confirm: null }, hasPaymentFields }
  }

  if (unlabeled.length >= 2) {
    if (SIGNUP_URL_HINTS.test(urlText) || /confirm|repeat|sign.?up/i.test(formText)) {
      return { kind: 'signup', confidence: 0.75, fields: { current: null, new: unlabeled[0], confirm: unlabeled[1] }, hasPaymentFields }
    }
    return { kind: 'password-change', confidence: 0.65, fields: { current: unlabeled[0], new: unlabeled[1], confirm: unlabeled[2] ?? null }, hasPaymentFields }
  }

  return { kind: 'unknown', confidence: 0.2, fields: { current: null, new: null, confirm: null }, hasPaymentFields }
}

/** Finds the nearest form-like ancestor for a field that isn't inside a real <form>. */
export function nearestFormLikeContainer(input) {
  const form = input.closest('form')
  if (form) return form
  let el = input.parentElement
  let best = el
  let hops = 0
  while (el && hops < 20 && el !== document.body && el !== document.documentElement) {
    if (el.querySelectorAll('input').length >= 1 && (el.querySelector('button, [role="button"], input[type="submit"]'))) {
      best = el
    }
    el = el.parentElement
    hops++
  }
  return best ?? input.parentElement ?? input
}
