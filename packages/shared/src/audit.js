// ─── Metadata-only audit events ────────────────────────────────────────────
// Same shape frontend/src/lib/vault.js already writes: { id, ts, actor, role,
// action, detail, severity, ip }. `detail` must NEVER contain a password,
// key material, a decrypted payload, or a full auth token — every call site
// in this repo is expected to pass only names, counts, masked identifiers,
// and durations. There is no code path in this module that accepts a field
// named "password" — that's intentional, not an oversight.

const FORBIDDEN_DETAIL_KEYS = new Set(['password', 'plaintext', 'key', 'masterPassword', 'token', 'secret'])

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
}

/**
 * @param {string} action    e.g. 'extension.suggestion_accepted', 'desktop.fill_blocked'
 * @param {string} detail    human-readable, metadata-only
 * @param {'info'|'warn'|'critical'} severity
 * @param {{actor?: string, role?: string, ip?: string}} [ctx]
 */
export function makeAuditEvent(action, detail = '', severity = 'info', ctx = {}) {
  if (detail && typeof detail === 'object') {
    for (const k of Object.keys(detail)) {
      if (FORBIDDEN_DETAIL_KEYS.has(k.toLowerCase())) {
        throw new Error(`audit event detail must not carry a "${k}" field — pass metadata only`)
      }
    }
  }
  return {
    id: randomId(),
    ts: new Date().toISOString(),
    actor: ctx.actor ?? 'unknown',
    role: ctx.role ?? '-',
    action,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    severity,
    ip: ctx.ip ?? 'local',
  }
}

// Canonical action names both new clients emit — kept centralized so the
// admin Audit Log page and any future backend consumer can rely on a fixed
// vocabulary instead of ad hoc strings scattered across two codebases.
export const AUDIT_ACTIONS = Object.freeze({
  SUGGESTION_SHOWN: 'assistant.suggestion_shown',
  SUGGESTION_ACCEPTED: 'assistant.suggestion_accepted',
  SUGGESTION_DISMISSED: 'assistant.suggestion_dismissed',
  AUTOFILL_FILLED: 'assistant.autofill_filled',
  AUTOFILL_BLOCKED: 'assistant.autofill_blocked',
  COPY: 'assistant.copy',
  SAVE: 'assistant.save',
  UNLOCK_FAILED: 'assistant.unlock_failed',
  ORIGIN_MISMATCH_BLOCKED: 'assistant.origin_mismatch_blocked',
  INSECURE_ORIGIN_BLOCKED: 'assistant.insecure_origin_blocked',
  IDENTITY_MISMATCH_BLOCKED: 'assistant.identity_mismatch_blocked',
})
