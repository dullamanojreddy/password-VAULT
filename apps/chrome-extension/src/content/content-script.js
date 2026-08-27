// ─── AEGIS content script ──────────────────────────────────────────────────
// Runs isolated from the page's own JavaScript (standard content-script
// world) — page scripts cannot read this module's variables, messages, or
// call its functions. All privileged work (crypto, vault access, storage)
// happens in the background service worker; this file only observes the
// DOM, renders the UI, and forwards user-approved actions via
// chrome.runtime.sendMessage, which the background worker independently
// re-validates (see lib/messaging.js) rather than trusting anything claimed
// here.

import { createFieldWatcher } from './observer.js'
import { classifyForm, nearestFormLikeContainer, isPaymentField } from './classifier.js'
import { showSuggestionPanel, updateSuggestionPassword, hideSuggestionPanel, isPanelOpen, currentPanelTarget } from './panel.js'
import { ACTIONS } from '../lib/messaging.js'

const pageOrigin = location.origin
const isInsecure = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'

function send(action, payload) {
  return chrome.runtime.sendMessage({ action, payload, origin: pageOrigin })
}

function setNativeValue(input, value) {
  if (!input) return

  try {
    input.focus()
  } catch {}

  // 1. Call native prototype setter directly
  const prototype = window.HTMLInputElement?.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) {
    setter.call(input, value)
  } else {
    input.value = value
  }

  // 2. React 15/16/17/18/19 internal valueTracker
  if (input._valueTracker) {
    input._valueTracker.setValue(value)
  }

  // 3. Dispatch simulated typing events
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  try {
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }))
  } catch {}
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

async function handleNewOrChangeField(input) {
  if (isPaymentField(input)) return // never engage anywhere near a card field

  const tryOpen = async () => {
    const container = nearestFormLikeContainer(input)
    if (Array.from(container.querySelectorAll('input')).some(isPaymentField)) return
    const classification = classifyForm(container, location.href)
    if (classification.kind === 'login') return
    const targetField = classification.fields.new ?? input
    await openSuggestionFor(targetField, classification)
  }

  input.addEventListener('focus', tryOpen, { once: false })
  input.addEventListener('click', tryOpen, { once: false })

  if (document.activeElement === input) {
    await tryOpen()
  }
}

async function openSuggestionFor(field, classification) {
  const statusRes = await send(ACTIONS.GET_STATUS)
  if (!statusRes?.ok) return

  const genRes = await send(ACTIONS.GENERATE_PASSWORD, { length: 20 })
  if (!genRes?.ok) return
  const analyzeRes = await send(ACTIONS.ANALYZE_PASSWORD, { password: genRes.password })
  const analysis = analyzeRes?.ok ? analyzeRes.analysis : { level: 'strong', score: 0, crack: { human: 'unknown' } }

  let current = genRes.password
  const render = () => showSuggestionPanel(
    field,
    { origin: pageOrigin, insecure: isInsecure },
    { password: current, score: analysis.score ?? 0, level: analysis.level ?? 'strong', crackTime: analysis.crack?.human ?? 'unknown' },
    onPanelAction(field, classification, () => current, (v) => { current = v }),
  )
  render()

  send(ACTIONS.SUBMIT_AUDIT, { action: 'assistant.suggestion_shown', detail: `${classification.kind} form on ${pageOrigin}`, severity: 'info' })
}

function getCleanAppName() {
  const host = location.hostname.replace(/^www\./i, '')
  const parts = host.split('.')
  if (parts.length >= 2) {
    const brand = parts[parts.length - 2]
    if (brand && brand.length > 2) return brand.charAt(0).toUpperCase() + brand.slice(1)
  }
  return document.title?.split(/[-|•–]/)[0]?.trim() || host
}

function getFormUsername() {
  const selectors = [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[name*="user" i]',
    'input[name*="login" i]',
    'input[name*="phone" i]',
    'input[name*="mobile" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
    'input[placeholder*="mobile" i]',
    'input[type="text"]',
  ]
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.value && el.value.trim() && el.type !== 'password') {
        return el.value.trim()
      }
    }
  }
  return ''
}

function showInPageNotification(msg) {
  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
    background: #0d1424; color: #38bdf8; border: 1px solid #38bdf8;
    border-radius: 8px; padding: 12px 18px; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 10px 30px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 10px;
    animation: fadeIn 0.2s ease-in;
  `
  toast.innerHTML = `<span style="font-size: 16px;">🛡️</span> <span>${msg}</span>`
  document.documentElement.appendChild(toast)
  setTimeout(() => { toast.remove() }, 3500)
}

function onPanelAction(field, classification, getCurrent, setCurrent) {
  return async (act) => {
    if (act === 'dismiss') {
      hideSuggestionPanel()
      send(ACTIONS.SUBMIT_AUDIT, { action: 'assistant.suggestion_dismissed', detail: pageOrigin, severity: 'info' })
      return
    }

    if (act === 'regenerate') {
      const genRes = await send(ACTIONS.GENERATE_PASSWORD, { length: 20 })
      if (!genRes?.ok) return
      const analyzeRes = await send(ACTIONS.ANALYZE_PASSWORD, { password: genRes.password })
      setCurrent(genRes.password)
      updateSuggestionPassword({
        password: genRes.password,
        level: analyzeRes?.ok ? analyzeRes.analysis.level : 'strong',
      })
      return
    }

    if (isInsecure) return // 'use' and 'save' are disabled in the panel UI on insecure origins; enforce it here too

    if (act === 'use' || act === 'save') {
      const password = getCurrent()
      const appName = getCleanAppName()
      const username = getFormUsername() || `account@${location.hostname.replace(/^www\./i, '')}`

      // 1. Fill input immediately
      const targetInputs = [field]
      if (classification.fields.confirm && classification.fields.confirm !== field) {
        targetInputs.push(classification.fields.confirm)
      }
      const allPwInputs = Array.from(document.querySelectorAll('input[type="password"]'))
      for (const el of allPwInputs) {
        if (!targetInputs.includes(el)) targetInputs.push(el)
      }

      for (const inp of targetInputs) {
        setNativeValue(inp, password)
      }

      // 2. Copy to clipboard
      try {
        await navigator.clipboard.writeText(password)
      } catch { /* clipboard */ }

      // 3. Hide suggestion panel
      hideSuggestionPanel()

      // 4. Save encrypted in AEGIS vault asynchronously
      send(ACTIONS.CREATE_CREDENTIAL, {
        app: appName,
        username,
        password,
        url: pageOrigin,
      }).then((res) => {
        if (res?.ok) {
          showInPageNotification(`Encrypted & saved as <strong>${appName}</strong> (${username}) in your AEGIS Vault!`)
        } else {
          showInPageNotification(`Password filled & copied to clipboard! (Unlock AEGIS extension to sync)`)
        }
      }).catch(() => {
        showInPageNotification(`Password filled & copied to clipboard!`)
      })

      send(ACTIONS.SUBMIT_AUDIT, {
        action: 'assistant.autofill_saved',
        detail: `Generated password for ${appName} (${username}) filled and encrypted into vault`,
        severity: 'info',
      })
      return
    }
  }
}

// ── Saved-credential offer on login forms ──────────────────────────────────

async function handleLoginField(input) {
  const container = nearestFormLikeContainer(input)
  const classification = classifyForm(container, location.href)
  if (classification.kind !== 'login') return
  if (classification.fields.current !== input) return

  input.addEventListener('focus', async () => {
    if (isInsecure) {
      send(ACTIONS.SUBMIT_AUDIT, { action: 'assistant.insecure_origin_blocked', detail: `Login autofill offer suppressed on insecure ${pageOrigin}`, severity: 'critical' })
      return
    }
    const res = await send(ACTIONS.FIND_BY_ORIGIN, { origin: pageOrigin })
    if (!res?.ok || !res.matches?.length) return
    // Credentials are never filled from here directly — this only lets the
    // background worker badge the toolbar icon. The actual fill happens
    // through the popup's explicit-approval picker (REVEAL_CREDENTIAL),
    // which re-validates origin match before returning any plaintext.
    send(ACTIONS.OFFER_CREDENTIALS_FOR_TAB, { origin: pageOrigin, matches: res.matches })
  })
}

// ── Wiring ─────────────────────────────────────────────────────────────────

const watcher = createFieldWatcher({
  onPasswordField(input) {
    handleNewOrChangeField(input)
    handleLoginField(input)
  },
})

watcher.start()

// ── Popup-triggered login fill ──────────────────────────────────────────────
// The popup already made the user pick a specific saved credential and the
// background worker already re-verified the origin match before returning
// any plaintext (see ACTIONS.REVEAL_CREDENTIAL in the service worker) — this
// listener's job is purely mechanical: find the login field and insert.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return undefined // ignore anything not from this extension
  if (msg?.action !== 'aegis/fill-login') return undefined

  if (isInsecure) {
    send(ACTIONS.SUBMIT_AUDIT, { action: 'assistant.insecure_origin_blocked', detail: `Fill blocked on insecure ${pageOrigin}`, severity: 'critical' })
    sendResponse({ ok: false, error: 'insecure-origin' })
    return true
  }

  const pwField = document.querySelector('input[type="password"], input[autocomplete="current-password"]')
  if (!pwField) {
    sendResponse({ ok: false, error: 'no-password-field-found' })
    return true
  }
  const container = nearestFormLikeContainer(pwField)
  const classification = classifyForm(container, location.href)
  const targetPw = classification.fields.current ?? pwField
  const userField = container.querySelector('input[autocomplete="username"], input[type="email"], input[name*="user" i]')

  setNativeValue(targetPw, msg.payload.password)
  if (userField && msg.payload.username) setNativeValue(userField, msg.payload.username)

  send(ACTIONS.SUBMIT_AUDIT, { action: 'assistant.autofill_filled', detail: `Saved credential filled on ${pageOrigin} via popup`, severity: 'warn' })
  sendResponse({ ok: true })
  return true
})

// If the page itself blurs/removes the panel's target field, hide the panel
// rather than leaving it pointed at a stale element.
document.addEventListener('focusout', (e) => {
  if (isPanelOpen() && e.target === currentPanelTarget()) {
    setTimeout(() => {
      if (document.activeElement !== currentPanelTarget()) hideSuggestionPanel()
    }, 150)
  }
}, true)
