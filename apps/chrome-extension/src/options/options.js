import { DEFAULT_POLICY } from '@aegis/shared/config'

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function renderPolicy() {
  const stored = await chrome.storage.local.get('aegis.local.policy')
  const policy = stored['aegis.local.policy'] ?? DEFAULT_POLICY
  document.getElementById('policy').innerHTML = `
    <div class="row"><span>Minimum length</span><span>${policy.minLength}</span></div>
    <div class="row"><span>Minimum entropy</span><span>${policy.minEntropy} bits</span></div>
    <div class="row"><span>Block breached passwords</span><span>${policy.blockBreached ? 'Yes' : 'No'}</span></div>
    <div class="row"><span>Block reuse</span><span>${policy.blockReuse ? 'Yes' : 'No'}</span></div>
    <div class="row"><span>Rotation interval</span><span>${policy.rotationDays} days</span></div>
    <div class="row"><span>Clipboard auto-clear</span><span>${policy.clipboardClearSeconds}s</span></div>
  `
}

async function renderSites() {
  const stored = await chrome.storage.local.get('aegis.ext.site-policy')
  const map = stored['aegis.ext.site-policy'] ?? {}
  const entries = Object.entries(map)
  const el = document.getElementById('sites')
  if (!entries.length) {
    el.innerHTML = '<span class="muted">No per-site rules yet — every site is allowed by default until you deny one from the popup.</span>'
    return
  }
  el.innerHTML = `<table>${entries.map(([origin, rule]) => `
    <tr>
      <td>${escapeHtml(origin)}</td>
      <td style="text-align:right">${rule}</td>
      <td style="text-align:right"><button data-origin="${escapeHtml(origin)}">Remove</button></td>
    </tr>`).join('')}</table>`
  el.querySelectorAll('button[data-origin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cur = await chrome.storage.local.get('aegis.ext.site-policy')
      const m = cur['aegis.ext.site-policy'] ?? {}
      delete m[btn.dataset.origin]
      await chrome.storage.local.set({ 'aegis.ext.site-policy': m })
      renderSites()
    })
  })
}

async function renderAudit() {
  const stored = await chrome.storage.local.get('aegis.local.audit')
  const events = (stored['aegis.local.audit'] ?? []).slice(0, 15)
  const el = document.getElementById('audit')
  if (!events.length) { el.innerHTML = '<span class="muted">No activity recorded yet.</span>'; return }
  el.innerHTML = `<table>${events.map((e) => `
    <tr>
      <td>${new Date(e.ts).toLocaleTimeString()}</td>
      <td>${escapeHtml(e.action)}</td>
      <td class="muted">${escapeHtml(e.detail)}</td>
    </tr>`).join('')}</table>`
}

renderPolicy()
renderSites()
renderAudit()
