import { describe, it, expect, beforeEach } from 'vitest'
import { LocalVaultClient } from '@aegis/shared/vault-client'
import { createRouter } from '../src/background/router.js'
import { ACTIONS } from '../src/lib/messaging.js'
import { makeMemoryStorage } from './memory-storage.js'
import { makeSender } from './chrome-mock.js'

function makeRouter(storage) {
  const sitePolicy = {}
  const vaultClient = new LocalVaultClient(storage, { clientName: 'test' })
  const router = createRouter({
    vaultClient,
    async getSitePolicy(origin) { return sitePolicy[origin] },
    async setSitePolicy(origin, allow) { sitePolicy[origin] = allow ? 'allow' : 'deny' },
    onCredentialsOffered() {},
  })
  return { router, vaultClient, sitePolicy }
}

let storage, router, vaultClient

beforeEach(() => {
  storage = makeMemoryStorage()
  ;({ router, vaultClient } = makeRouter(storage))
})

describe('locked-vault behavior', () => {
  it('refuses FIND_BY_ORIGIN, REVEAL_CREDENTIAL, and CREATE_CREDENTIAL while locked', async () => {
    const find = await router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'https://example.com' } }, makeSender())
    const reveal = await router.handle({ action: ACTIONS.REVEAL_CREDENTIAL, payload: { id: 'x', origin: 'https://example.com' } }, makeSender())
    const create = await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'z' } }, makeSender())
    expect(find).toEqual({ ok: false, error: 'locked' })
    expect(reveal).toEqual({ ok: false, error: 'locked' })
    expect(create).toEqual({ ok: false, error: 'locked' })
  })

  it('GET_STATUS reports locked:true before any unlock', async () => {
    const res = await router.handle({ action: ACTIONS.GET_STATUS }, makeSender())
    expect(res).toEqual({ ok: true, locked: true })
  })
})

describe('service-worker restart behavior', () => {
  it('a freshly constructed router (simulating an MV3 SW restart) starts locked even though data was already persisted', async () => {
    await router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender())
    await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'GitHub', username: 'alice', password: 'x', url: 'https://github.com' } }, makeSender())
    expect((await router.handle({ action: ACTIONS.GET_STATUS }, makeSender())).locked).toBe(false)

    // Simulate the service worker being terminated and restarted: brand new
    // in-memory vaultClient/router over the SAME persisted storage.
    const fresh = makeRouter(storage)
    const status = await fresh.router.handle({ action: ACTIONS.GET_STATUS }, makeSender())
    expect(status).toEqual({ ok: true, locked: true })

    // But the previously-saved credential is still there once re-unlocked.
    await fresh.router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender())
    const found = await fresh.router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'https://github.com' } }, makeSender())
    expect(found.matches).toHaveLength(1)
  })
})

describe('origin matching — phishing rejection', () => {
  beforeEach(() => router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender()))

  it('offers a credential only from the tab whose URL matches the saved origin exactly', async () => {
    await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'Bank', username: 'alice', password: 'x', url: 'https://bank.com' } }, makeSender())
    const real = await router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'https://bank.com' } }, makeSender({ tab: { id: 1, url: 'https://bank.com/login' } }))
    const phish = await router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'https://bank.com.evil.tld' } }, makeSender({ tab: { id: 1, url: 'https://bank.com.evil.tld/login' } }))
    expect(real.matches).toHaveLength(1)
    expect(phish.matches).toHaveLength(0)
  })

  it('rejects REVEAL_CREDENTIAL when the requesting tab is on a different origin than the saved credential', async () => {
    const { id } = await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'Bank', username: 'alice', password: 'x', url: 'https://bank.com' } }, makeSender())
    const res = await router.handle(
      { action: ACTIONS.REVEAL_CREDENTIAL, payload: { id, origin: 'https://bank.com' } },
      makeSender({ tab: { id: 1, url: 'https://bank.com.evil.tld/login' } }),
    )
    expect(res.ok).toBe(false)
    expect(res.password).toBeUndefined()
  })

  it('a legitimate matching tab CAN reveal the credential', async () => {
    const { id } = await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'Bank', username: 'alice', password: 'correct-horse', url: 'https://bank.com' } }, makeSender())
    const res = await router.handle(
      { action: ACTIONS.REVEAL_CREDENTIAL, payload: { id, origin: 'https://bank.com' } },
      makeSender({ tab: { id: 1, url: 'https://bank.com/login' } }),
    )
    expect(res.ok).toBe(true)
    expect(res.password).toBe('correct-horse')
  })
})

describe('HTTP-page rejection', () => {
  beforeEach(() => router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender()))

  it('refuses FIND_BY_ORIGIN on a plain-http origin', async () => {
    const res = await router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'http://bank.com' } }, makeSender())
    expect(res).toEqual({ ok: false, error: 'insecure-origin' })
  })

  it('refuses CREATE_CREDENTIAL when the target url is plain-http', async () => {
    const res = await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'z', url: 'http://bank.com' } }, makeSender())
    expect(res).toEqual({ ok: false, error: 'insecure-origin' })
  })

  it('allows http://localhost for local development', async () => {
    const res = await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'z', url: 'http://localhost:3000' } }, makeSender())
    expect(res.ok).toBe(true)
  })
})

describe('per-site deny policy', () => {
  beforeEach(() => router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender()))

  it('a denied origin returns zero matches even though a credential exists', async () => {
    await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'z', url: 'https://denied.com' } }, makeSender())
    await router.handle({ action: ACTIONS.SET_SITE_POLICY, payload: { origin: 'https://denied.com', allow: false } }, makeSender())
    const res = await router.handle({ action: ACTIONS.FIND_BY_ORIGIN, payload: { origin: 'https://denied.com' } }, makeSender())
    expect(res.matches).toHaveLength(0)
  })
})

describe('no plaintext persistence', () => {
  it('storage never contains the plaintext password after create/update', async () => {
    await router.handle({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }, makeSender())
    await router.handle({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'ExtremelyUniquePlaintext123' } }, makeSender())
    const raw = JSON.stringify(storage._dump())
    expect(raw).not.toContain('ExtremelyUniquePlaintext123')
  })
})

describe('malformed / unauthorized message handling at the router level', () => {
  it('returns an "unhandled action" result for an action the router does not recognize (defense in depth below messaging.js)', async () => {
    const res = await router.handle({ action: 'not-a-real-action', payload: {} }, makeSender())
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unhandled action/)
  })
})
