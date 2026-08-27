import { describe, it, expect, beforeEach } from 'vitest'
import { createPolicyStore } from '../electron/main/policy-store.js'
import { makeMemoryStorage } from './memory-storage.js'

let store
beforeEach(() => { store = createPolicyStore(makeMemoryStorage()) })

describe('policy store defaults', () => {
  it('starts globally enabled, not paused, no per-app rules', async () => {
    const s = await store.getState()
    expect(s.globallyEnabled).toBe(true)
    expect(s.paused).toBe(false)
    expect(s.perAppRules).toEqual({})
  })
})

describe('pause and global enable', () => {
  it('shouldEngage is false when paused, even if globally enabled', async () => {
    await store.setPaused(true)
    expect(await store.shouldEngage('notepad.exe')).toBe(false)
  })

  it('shouldEngage is false when globally disabled', async () => {
    await store.setGloballyEnabled(false)
    expect(await store.shouldEngage('notepad.exe')).toBe(false)
  })

  it('shouldEngage is true by default for an app with no explicit rule', async () => {
    expect(await store.shouldEngage('notepad.exe')).toBe(true)
  })
})

describe('per-application allow/deny rules', () => {
  it('a denied app never engages, even while globally enabled and unpaused', async () => {
    await store.setAppRule('malicious.exe', 'deny')
    expect(await store.shouldEngage('malicious.exe')).toBe(false)
    expect(await store.shouldEngage('other.exe')).toBe(true)
  })

  it('an explicit allow rule engages (equivalent to default, but explicit)', async () => {
    await store.setAppRule('trusted.exe', 'allow')
    expect(await store.shouldEngage('trusted.exe')).toBe(true)
  })

  it('clearing a rule reverts to default-allow behavior', async () => {
    await store.setAppRule('app.exe', 'deny')
    await store.clearAppRule('app.exe')
    expect(await store.shouldEngage('app.exe')).toBe(true)
  })

  it('rejects an invalid rule value', async () => {
    await expect(store.setAppRule('app.exe', 'maybe')).rejects.toThrow()
  })
})
