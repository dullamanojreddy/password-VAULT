import { ACTIONS } from '../lib/messaging.js'

const root = document.getElementById('root')

function send(action, payload) {
  return chrome.runtime.sendMessage({ action, payload })
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function render() {
  const status = await send(ACTIONS.GET_STATUS)
  const tab = await activeTab()
  const insecure = tab?.url && !/^https:|^http:\/\/localhost|^http:\/\/127\.0\.0\.1/.test(tab.url)

  if (status.locked) {
    root.innerHTML = `
      <h1>AEGIS</h1>
      <div class="status"><span class="dot locked"></span> Vault locked</div>
      <input class="field" id="u" placeholder="Account" autocomplete="off" />
      <input class="field" id="p" placeholder="Master password" type="password" autocomplete="off" />
      <div class="error" id="err"></div>
      <button class="primary" id="unlock">Unlock vault</button>
    `
    document.getElementById('unlock').addEventListener('click', async () => {
      const username = document.getElementById('u').value
      const masterPassword = document.getElementById('p').value
      const res = await send(ACTIONS.UNLOCK, { username, masterPassword })
      if (!res.ok) { document.getElementById('err').textContent = res.error; return }
      render()
    })
    return
  }

  let generatedPassword = ''
  const genRes = await send(ACTIONS.GENERATE_PASSWORD, { length: 20 })
  if (genRes?.ok) {
    generatedPassword = genRes.password
  }

  root.innerHTML = `
    <h1>AEGIS</h1>
    <div class="status"><span class="dot unlocked"></span> Unlocked as ${escapeHtml(status.username)}</div>
    ${insecure ? '<div class="error">This page is not served over HTTPS — autofill is disabled here.</div>' : ''}
    
    <div style="margin-bottom: 12px; padding: 10px; background: #0d1424; border: 1px solid #1e293b; border-radius: 8px;">
      <div style="font-size: 11px; font-weight: 600; color: #38bdf8; margin-bottom: 6px;">SUGGEST STRONG PASSWORD</div>
      <div id="gen-pw" style="font-family: monospace; font-size: 12px; background: #070b14; padding: 6px 8px; border-radius: 4px; border: 1px solid #1e293b; word-break: break-all; margin-bottom: 8px;">
        ${escapeHtml(generatedPassword)}
      </div>
      <div style="display: flex; gap: 6px;">
        <button id="btn-fill-gen" class="primary" style="flex: 1; padding: 6px 8px; font-size: 11.5px;">Fill on Page</button>
        <button id="btn-copy-gen" style="flex: 1; padding: 6px 8px; font-size: 11.5px;">Copy</button>
        <button id="btn-regen" style="width: auto; padding: 6px 8px; font-size: 11.5px;">↻</button>
      </div>
    </div>

    <div style="font-size: 11px; font-weight: 600; color: #7b8aa5; margin-bottom: 6px;">VAULT CREDENTIALS</div>
    <div id="creds"><span class="muted">Checking this site…</span></div>
    <button id="lock" style="margin-top:10px; background: transparent; border: 1px solid #1e293b; color: #7b8aa5;">Lock vault</button>
  `

  document.getElementById('btn-regen').addEventListener('click', async () => {
    const res = await send(ACTIONS.GENERATE_PASSWORD, { length: 20 })
    if (res?.ok) {
      generatedPassword = res.password
      document.getElementById('gen-pw').textContent = res.password
    }
  })

  document.getElementById('btn-copy-gen').addEventListener('click', async () => {
    await navigator.clipboard.writeText(generatedPassword)
    const btn = document.getElementById('btn-copy-gen')
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = 'Copy' }, 1500)
  })

  document.getElementById('btn-fill-gen').addEventListener('click', async () => {
    if (!tab?.id) return
    await chrome.tabs.sendMessage(tab.id, {
      action: 'aegis/fill-login',
      payload: { username: '', password: generatedPassword },
    })
    const btn = document.getElementById('btn-fill-gen')
    btn.textContent = 'Filled!'
    setTimeout(() => { window.close() }, 400)
  })

  document.getElementById('lock').addEventListener('click', async () => { await send(ACTIONS.LOCK); render() })

  const list = document.getElementById('creds')
  if (!tab?.url || tab.url.startsWith('chrome://')) {
    list.innerHTML = `<span class="muted">Open a website to check credentials.</span>`
    return
  }

  try {
    const origin = new URL(tab.url).origin
    const res = await send(ACTIONS.FIND_BY_ORIGIN, { origin })
    if (!res?.ok) {
      list.innerHTML = `<span class="muted">${escapeHtml(res?.error ?? 'Unavailable')}</span>`
      return
    }
    if (!res.matches?.length) {
      list.innerHTML = `<span class="muted">No saved credentials for this site.</span>`
      return
    }

    list.innerHTML = res.matches.map((m) => `
      <div class="cred">
        <div><strong>${escapeHtml(m.app)}</strong><small>${escapeHtml(m.username)}</small></div>
        <button data-id="${m.id}" style="width:auto">Fill</button>
      </div>
    `).join('')

    list.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const revealRes = await send(ACTIONS.REVEAL_CREDENTIAL, { id: btn.dataset.id, origin })
        if (!revealRes.ok) { btn.textContent = 'Blocked'; return }
        await chrome.tabs.sendMessage(tab.id, { action: 'aegis/fill-login', payload: { username: revealRes.username, password: revealRes.password } })
        window.close()
      })
    })
  } catch {
    list.innerHTML = `<span class="muted">No saved credentials for this site.</span>`
  }
}

render()
