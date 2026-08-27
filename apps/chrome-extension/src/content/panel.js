// ─── The in-page suggestion panel ──────────────────────────────────────────
// A SINGLE, module-level singleton element. This is the actual mechanism
// that prevents duplicate assistants when a framework rerenders a form:
// there is structurally only ever one panel node in the whole page, so a
// remount that produces a brand-new <input> object (invisible to identity-
// based dedup) still can't spawn a second panel — show() just re-targets
// the one panel that exists.
//
// Rendered inside a closed... no: an OPEN shadow root, attached directly to
// document.documentElement rather than document.body, so host-page CSS can
// never bleed in (isolated styling) and the panel keeps working even on
// pages that replace document.body wholesale (some SPA frameworks do this).

let hostEl = null
let shadow = null
let currentTarget = null
let onAction = null

const STYLE = `
  :host { all: initial; }
  .card {
    position: fixed; z-index: 2147483647; width: 300px;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0d1424; color: #e8eefc; border: 1px solid #1e293b;
    border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45);
    padding: 12px; box-sizing: border-box;
  }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .brand { font-weight: 700; letter-spacing: .08em; font-size: 11px; color: #38bdf8; }
  .origin { font-size: 10.5px; color: #7b8aa5; word-break: break-all; }
  .pw { font: 12px/1.3 ui-monospace, monospace; background: #070b14; border: 1px solid #1e293b;
        border-radius: 6px; padding: 8px; word-break: break-all; margin-bottom: 8px; }
  .meta { display: flex; justify-content: space-between; font-size: 10.5px; color: #7b8aa5; margin-bottom: 8px; }
  .badge { font-weight: 700; letter-spacing: .04em; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; cursor: pointer; border-radius: 6px; padding: 6px 9px; font-size: 11.5px; border: 1px solid #1e293b; background: #131c30; color: #e8eefc; }
  button.primary { background: linear-gradient(#38bdf8,#0ea5e9); color: #061019; font-weight: 600; border: none; }
  button.ghost { background: transparent; color: #7b8aa5; }
  button:hover { filter: brightness(1.1); }
  .warn { color: #fbbf24; font-size: 10.5px; margin-bottom: 8px; }
`

function ensureHost() {
  // Re-create if we've never made one, OR if it was made but has since been
  // detached (e.g. a page/framework that wholesale-replaces documentElement,
  // or — in tests — a previous test tearing down the DOM between runs).
  // Checking truthiness of `hostEl` alone isn't enough: a stale, detached
  // reference would silently make every subsequent show() a no-op.
  if (hostEl && document.documentElement.contains(hostEl)) return
  hostEl = document.createElement('div')
  hostEl.id = 'aegis-assistant-host'
  shadow = hostEl.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE
  shadow.appendChild(style)
  document.documentElement.appendChild(hostEl)
}

function positionNear(target) {
  const r = target.getBoundingClientRect()
  const card = shadow.querySelector('.card')
  if (!card) return
  const top = r.bottom + 6
  const left = Math.min(r.left, window.innerWidth - 316)
  card.style.top = `${Math.max(6, top)}px`
  card.style.left = `${Math.max(6, left)}px`
}

/**
 * @param {HTMLInputElement} target
 * @param {{ origin: string, insecure: boolean }} ctx
 * @param {{ password: string, score: number, level: string, crackTime: string }} state
 * @param {(action: 'regenerate'|'use'|'save'|'dismiss') => void} handler
 */
export function showSuggestionPanel(target, ctx, state, handler) {
  ensureHost()
  currentTarget = target
  onAction = handler

  const old = shadow.querySelector('.card')
  if (old) old.remove()

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <div class="row"><span class="brand">AEGIS</span><span>Suggested password</span></div>
    <div class="origin">for ${escapeHtml(ctx.origin)}</div>
    ${ctx.insecure ? '<div class="warn">⚠ This page is not served over HTTPS — filling is disabled.</div>' : ''}
    <div class="pw" id="pw-text">${escapeHtml(state.password)}</div>
    <div class="meta"><span class="badge" style="color:${levelColor(state.level)}">${state.level.toUpperCase()}</span><span>score ${state.score}/100 · cracks in ${escapeHtml(state.crackTime)}</span></div>
    <div class="actions">
      <button data-act="regenerate">Generate Again</button>
      <button data-act="use" class="primary" ${ctx.insecure ? 'disabled' : ''}>Use Password</button>
      <button data-act="save" ${ctx.insecure ? 'disabled' : ''}>Save to Vault</button>
      <button data-act="dismiss" class="ghost">Dismiss</button>
    </div>
  `
  shadow.appendChild(card)
  positionNear(target)

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]')
    if (!btn) return
    onAction?.(btn.dataset.act)
  })

  const reposition = () => currentTarget && positionNear(currentTarget)
  window.addEventListener('scroll', reposition, { passive: true, capture: true })
  window.addEventListener('resize', reposition, { passive: true })
}

export function updateSuggestionPassword(state) {
  const el = shadow?.querySelector('#pw-text')
  if (el) el.textContent = state.password
  const badge = shadow?.querySelector('.badge')
  if (badge) { badge.textContent = state.level.toUpperCase(); badge.style.color = levelColor(state.level) }
}

export function hideSuggestionPanel() {
  const card = shadow?.querySelector('.card')
  if (card) card.remove()
  currentTarget = null
  onAction = null
}

export function isPanelOpen() {
  return !!shadow?.querySelector('.card')
}

export function currentPanelTarget() {
  return currentTarget
}

function levelColor(level) {
  return { critical: '#f43f5e', weak: '#fb7185', fair: '#f59e0b', strong: '#38bdf8', elite: '#34d399' }[level] ?? '#38bdf8'
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
