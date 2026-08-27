import { describe, it, expect } from 'vitest'
import { classifyForm, getFieldRole, isPasswordField, isPaymentField, nearestFormLikeContainer } from '../src/content/classifier.js'

function setForm(html) {
  document.body.innerHTML = html
  return document.querySelector('form') ?? document.body
}

describe('classifyForm — login', () => {
  it('classifies a standard login form via autocomplete attributes', () => {
    const form = setForm(`
      <form>
        <input type="email" autocomplete="username" />
        <input type="password" autocomplete="current-password" name="password" />
        <button type="submit">Log in</button>
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/login')
    expect(r.kind).toBe('login')
    expect(r.fields.current).not.toBeNull()
    expect(r.fields.new).toBeNull()
  })

  it('falls back to URL context when there is no autocomplete/label signal', () => {
    const form = setForm(`
      <form>
        <input type="text" name="e" />
        <input type="password" name="p" />
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/signin')
    expect(r.kind).toBe('login')
  })
})

describe('classifyForm — signup', () => {
  it('classifies a signup form with password + confirm-password fields', () => {
    const form = setForm(`
      <form>
        <input type="email" autocomplete="email" />
        <input type="password" autocomplete="new-password" name="password" />
        <input type="password" autocomplete="new-password" name="confirm_password" />
        <button type="submit">Create account</button>
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/signup')
    expect(r.kind).toBe('signup')
    expect(r.fields.new).not.toBeNull()
    expect(r.fields.confirm).not.toBeNull()
  })

  it('classifies a lone new-password field by autocomplete alone', () => {
    const form = setForm(`
      <form><input type="password" autocomplete="new-password" /></form>
    `)
    const r = classifyForm(form, 'https://example.com/register')
    expect(r.kind).toBe('signup')
  })
})

describe('classifyForm — password change / reset', () => {
  it('classifies current+new password fields as a change form', () => {
    const form = setForm(`
      <form>
        <input type="password" autocomplete="current-password" name="old_password" />
        <input type="password" autocomplete="new-password" name="new_password" />
        <button type="submit">Update password</button>
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/account/security')
    expect(r.kind).toBe('password-change')
  })

  it('classifies a token-based reset form (two new-password fields, reset URL) as password-change, not signup', () => {
    const form = setForm(`
      <form>
        <input type="password" autocomplete="new-password" name="p1" />
        <input type="password" autocomplete="new-password" name="p2" />
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/reset-password?token=abc')
    expect(r.kind).toBe('password-change')
  })
})

describe('classifyForm — unknown', () => {
  it('returns unknown for a form with no password field at all', () => {
    const form = setForm(`<form><input type="text" name="q" /></form>`)
    const r = classifyForm(form, 'https://example.com/search')
    expect(r.kind).toBe('unknown')
    expect(r.confidence).toBe(0)
  })
})

describe('payment field detection', () => {
  it('recognizes cc-number/cc-csc autocomplete values as payment fields', () => {
    document.body.innerHTML = `<input autocomplete="cc-number" /><input autocomplete="cc-csc" />`
    const [num, csc] = document.querySelectorAll('input')
    expect(isPaymentField(num)).toBe(true)
    expect(isPaymentField(csc)).toBe(true)
  })

  it('flags a form containing a payment field via hasPaymentFields', () => {
    const form = setForm(`
      <form>
        <input type="password" autocomplete="new-password" />
        <input autocomplete="cc-number" />
      </form>
    `)
    const r = classifyForm(form, 'https://example.com/checkout')
    expect(r.hasPaymentFields).toBe(true)
  })
})

describe('getFieldRole', () => {
  it('trusts the site-declared autocomplete value over any heuristic', () => {
    document.body.innerHTML = `<input type="password" autocomplete="current-password" name="new_password_but_actually_login" />`
    const input = document.querySelector('input')
    expect(getFieldRole(input)).toBe('current-password')
  })

  it('falls back to label/name heuristics when autocomplete is absent', () => {
    document.body.innerHTML = `<input type="password" name="confirm_new_password" />`
    expect(getFieldRole(document.querySelector('input'))).toBe('new-password')
  })
})

describe('isPasswordField', () => {
  it('recognizes type=password and autocomplete-declared password fields', () => {
    document.body.innerHTML = `
      <input type="password" />
      <input type="text" autocomplete="new-password" />
      <input type="text" />
    `
    const [pw, textNew, plain] = document.querySelectorAll('input')
    expect(isPasswordField(pw)).toBe(true)
    expect(isPasswordField(textNew)).toBe(true)
    expect(isPasswordField(plain)).toBe(false)
  })
})

describe('nearestFormLikeContainer', () => {
  it('finds a real <form> ancestor when one exists', () => {
    const form = setForm(`<form><div><input type="password" id="p" /></div></form>`)
    const input = document.getElementById('p')
    expect(nearestFormLikeContainer(input)).toBe(form)
  })

  it('finds an SPA form-like wrapper div (with a submit button) when there is no real <form>', () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <input type="text" />
        <input type="password" id="p" />
        <button>Continue</button>
      </div>
    `
    const input = document.getElementById('p')
    const container = nearestFormLikeContainer(input)
    expect(container.id).toBe('wrapper')
  })
})
