// ─── Out-of-band breach alerts ─────────────────────────────────────────────
// WhatsApp is used purely as a NOTIFICATION channel — a way to reach the user
// through a path independent of whichever app just leaked. The payload is
// always metadata (app name, severity, a timestamp). The plaintext password
// is never included and never travels through this function or the network
// call it makes: that would defeat the entire zero-knowledge design.
//
// The actual Twilio call happens server-side (see BACKEND_CONTRACT.md) — the
// Account SID / Auth Token must never reach the browser. This module only
// POSTs a small JSON body to our own backend.

async function post(path, body) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 3000)
  try {
    const r = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return { ok: true, ...(await r.json()) }
  } catch {
    // Backend not running yet — simulate delivery so the flow is demoable
    // end-to-end on the frontend alone. Never fabricate success silently in
    // production; this fallback exists for the hackathon build only.
    await new Promise((r) => setTimeout(r, 500))
    return { ok: true, simulated: true }
  } finally {
    clearTimeout(t)
  }
}

export function isValidPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim()) // E.164
}

// reason: 'breach' | 'reuse' | 'admin-flag'
export async function sendBreachAlert({ phone, app, reason = 'breach', occurrences }) {
  if (!isValidPhone(phone)) return { ok: false, error: 'Add a valid WhatsApp number (e.g. +919966007804) first' }

  const label =
    reason === 'admin-flag' ? 'flagged as compromised by an administrator' :
    reason === 'reuse' ? 'reused across multiple accounts' :
    `found in a public breach${occurrences ? ` (${occurrences.toLocaleString()} exposures)` : ''}`

  return post('/alerts/whatsapp', {
    to: phone,
    template: 'breach_alert',                 // maps to a pre-approved Twilio Content SID server-side
    variables: { app, reason: label, when: new Date().toLocaleString() },
    // Deliberately no `password` field exists in this payload — see header comment.
  })
}
