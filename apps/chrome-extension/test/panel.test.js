import { describe, it, expect, beforeEach } from 'vitest'
import { showSuggestionPanel, hideSuggestionPanel, isPanelOpen, currentPanelTarget } from '../src/content/panel.js'

beforeEach(() => {
  document.body.innerHTML = ''
  document.querySelectorAll('#aegis-assistant-host').forEach((el) => el.remove())
  hideSuggestionPanel()
})

function makeInput() {
  const input = document.createElement('input')
  input.type = 'password'
  document.body.appendChild(input)
  return input
}

describe('suggestion panel singleton — duplicate prevention', () => {
  it('never creates more than one host element even across repeated show() calls', () => {
    const a = makeInput()
    const b = makeInput()
    showSuggestionPanel(a, { origin: 'https://example.com', insecure: false }, { password: 'x', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    showSuggestionPanel(b, { origin: 'https://example.com', insecure: false }, { password: 'y', score: 90, level: 'elite', crackTime: '10 years' }, () => {})
    showSuggestionPanel(a, { origin: 'https://example.com', insecure: false }, { password: 'z', score: 70, level: 'fair', crackTime: '1 month' }, () => {})

    expect(document.querySelectorAll('#aegis-assistant-host').length).toBe(1)
  })

  it('re-targeting show() at a different field updates the panel instead of adding a second one', () => {
    const a = makeInput()
    const b = makeInput()
    showSuggestionPanel(a, { origin: 'https://example.com', insecure: false }, { password: 'x', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    expect(currentPanelTarget()).toBe(a)

    showSuggestionPanel(b, { origin: 'https://example.com', insecure: false }, { password: 'y', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    expect(currentPanelTarget()).toBe(b)
    expect(isPanelOpen()).toBe(true)

    const host = document.querySelector('#aegis-assistant-host')
    expect(host.shadowRoot.querySelectorAll('.card').length).toBe(1)
  })

  it('renders inside a shadow root so page CSS cannot leak in or out', () => {
    const a = makeInput()
    showSuggestionPanel(a, { origin: 'https://example.com', insecure: false }, { password: 'x', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    const host = document.querySelector('#aegis-assistant-host')
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot.querySelector('.card')).not.toBeNull()
  })

  it('hide() removes the card and clears the current target', () => {
    const a = makeInput()
    showSuggestionPanel(a, { origin: 'https://example.com', insecure: false }, { password: 'x', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    hideSuggestionPanel()
    expect(isPanelOpen()).toBe(false)
    expect(currentPanelTarget()).toBeNull()
  })
})

describe('suggestion panel — insecure origin', () => {
  it('renders a warning and disables use/save actions on an insecure origin', () => {
    const a = makeInput()
    showSuggestionPanel(a, { origin: 'http://example.com', insecure: true }, { password: 'x', score: 80, level: 'strong', crackTime: '1 year' }, () => {})
    const host = document.querySelector('#aegis-assistant-host')
    const card = host.shadowRoot.querySelector('.card')
    expect(card.textContent).toMatch(/not served over HTTPS/i)
    expect(card.querySelector('[data-act="use"]').disabled).toBe(true)
    expect(card.querySelector('[data-act="save"]').disabled).toBe(true)
  })
})
