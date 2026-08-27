import { describe, it, expect } from 'vitest'
import { deriveKey, encryptField, decryptField, generatePassword } from '../src/crypto.js'

describe('crypto: key derivation', () => {
  it('derives the same key/verifier from the same password+salt, and a different verifier for a wrong password', async () => {
    const a = await deriveKey('Correct Horse Battery Staple')
    const b = await deriveKey('Correct Horse Battery Staple', a.salt)
    const wrong = await deriveKey('wrong password', a.salt)
    expect(b.verifier).toBe(a.verifier)
    expect(wrong.verifier).not.toBe(a.verifier)
  })
})

describe('crypto: AES-256-GCM field encryption', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const { key } = await deriveKey('master-pw-1')
    const blob = await encryptField(key, 'hunter2-super-secret')
    const pt = await decryptField(key, blob)
    expect(pt).toBe('hunter2-super-secret')
  })

  it('produces different ciphertext for identical plaintext (fresh random IV every time)', async () => {
    const { key } = await deriveKey('master-pw-2')
    const a = await encryptField(key, 'same-password-123')
    const b = await encryptField(key, 'same-password-123')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })

  it('fails safely (returns null, does not throw) when decrypting with the wrong key', async () => {
    const { key: keyA } = await deriveKey('owner-password')
    const { key: keyB } = await deriveKey('attacker-password')
    const blob = await encryptField(keyA, 'top secret')
    const result = await decryptField(keyB, blob)
    expect(result).toBeNull()
  })

  it('fails safely when the ciphertext has been tampered with (GCM tag check)', async () => {
    const { key } = await deriveKey('owner-password-2')
    const blob = await encryptField(key, 'top secret')
    const tampered = { ...blob, ct: blob.ct.slice(0, -4) + 'AAAA' }
    const result = await decryptField(key, tampered)
    expect(result).toBeNull()
  })
})

describe('crypto: password generation', () => {
  it('uses only crypto.getRandomValues (never Math.random) and respects length/charset options', () => {
    const spy = { calls: 0 }
    const original = Math.random
    Math.random = () => { spy.calls++; return original() }
    try {
      const pw = generatePassword({ length: 24, upper: true, lower: true, digits: true, symbols: true })
      expect(pw).toHaveLength(24)
      expect(spy.calls).toBe(0)
    } finally {
      Math.random = original
    }
  })

  it('can generate symbol-free, digit-only-safe passwords when requested', () => {
    const pw = generatePassword({ length: 16, upper: false, lower: false, digits: true, symbols: false })
    expect(pw).toMatch(/^[0-9]+$/)
  })
})
