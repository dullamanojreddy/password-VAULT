import { describe, it, expect } from 'vitest'
import { normalizeOrigin, originsMatch, isSecureOrigin, appIdentityMatches, validateCredentialDraft } from '../src/credential-schema.js'

describe('normalizeOrigin', () => {
  it('normalizes scheme, host case, and default ports', () => {
    expect(normalizeOrigin('https://Example.com:443/login?x=1')).toBe('https://example.com')
    expect(normalizeOrigin('http://EXAMPLE.com:80/')).toBe('http://example.com')
    expect(normalizeOrigin('example.com')).toBe('https://example.com')
  })

  it('preserves a non-default port', () => {
    expect(normalizeOrigin('https://example.com:8443')).toBe('https://example.com:8443')
  })

  it('returns null for garbage input', () => {
    expect(normalizeOrigin('not a url at all ###')).toBeNull()
  })
})

describe('originsMatch — phishing resistance', () => {
  it('matches identical origins regardless of path/query', () => {
    expect(originsMatch('https://bank.com/login', 'https://bank.com/account?ref=x')).toBe(true)
  })

  it('rejects a lookalike subdomain (classic phishing pattern)', () => {
    expect(originsMatch('https://bank.com', 'https://bank.com.evil.tld')).toBe(false)
    expect(originsMatch('https://bank.com', 'https://secure-bank.com')).toBe(false)
    expect(originsMatch('https://bank.com', 'https://accounts.bank.com')).toBe(false)
  })

  it('rejects a scheme downgrade (https saved, http observed)', () => {
    expect(originsMatch('https://bank.com', 'http://bank.com')).toBe(false)
  })

  it('rejects a different port on the same host', () => {
    expect(originsMatch('https://bank.com', 'https://bank.com:8080')).toBe(false)
  })
})

describe('isSecureOrigin', () => {
  it('treats https as secure and plain http as insecure', () => {
    expect(isSecureOrigin('https://bank.com')).toBe(true)
    expect(isSecureOrigin('http://bank.com')).toBe(false)
  })

  it('allows http on localhost for local development', () => {
    expect(isSecureOrigin('http://localhost:5173')).toBe(true)
    expect(isSecureOrigin('http://127.0.0.1:8000')).toBe(true)
  })
})

describe('appIdentityMatches — desktop identity binding', () => {
  it('matches on packageFamilyId when both sides have one', () => {
    const saved = { type: 'uwp', packageFamilyId: 'Contoso.App_8wekyb3d8bbwe' }
    const observed = { type: 'uwp', packageFamilyId: 'Contoso.App_8wekyb3d8bbwe' }
    expect(appIdentityMatches(saved, observed)).toBe(true)
  })

  it('matches on executableHash for traditional apps', () => {
    const saved = { type: 'win32', executableHash: 'abc123' }
    const observed = { type: 'win32', executableHash: 'abc123' }
    expect(appIdentityMatches(saved, observed)).toBe(true)
  })

  it('refuses to match on process name alone (no strong signal)', () => {
    const saved = { type: 'win32', processName: 'chrome.exe' }
    const observed = { type: 'win32', processName: 'chrome.exe' }
    expect(appIdentityMatches(saved, observed)).toBe(false)
  })

  it('refuses a mismatched hash even with the same process name', () => {
    const saved = { type: 'win32', executableHash: 'abc123', processName: 'app.exe' }
    const observed = { type: 'win32', executableHash: 'DIFFERENT', processName: 'app.exe' }
    expect(appIdentityMatches(saved, observed)).toBe(false)
  })
})

describe('validateCredentialDraft', () => {
  it('accepts a minimal valid draft', () => {
    expect(validateCredentialDraft({ app: 'GitHub', username: 'me', password: 'x' }).ok).toBe(true)
  })

  it('rejects a draft missing required fields', () => {
    const { ok, errors } = validateCredentialDraft({ app: 'GitHub' })
    expect(ok).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})
