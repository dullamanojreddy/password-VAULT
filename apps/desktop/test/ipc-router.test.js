import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalVaultClient } from '@aegis/shared/vault-client'
import { createIpcRouter, RENDERER_ACTIONS, validateRendererMessage } from '../electron/main/ipc-router.js'
import { createPolicyStore } from '../electron/main/policy-store.js'
import { makeMemoryStorage } from './memory-storage.js'

let storage, vaultClient, policyStore, nativeHelper, clipboardSink, router

beforeEach(() => {
  storage = makeMemoryStorage()
  vaultClient = new LocalVaultClient(storage, { clientName: 'desktop-test' })
  policyStore = createPolicyStore(storage)
  nativeHelper = { requestInsert: vi.fn(async () => ({ ok: true })) }
  clipboardSink = { writeAndScheduleClear: vi.fn() }
  router = createIpcRouter({ vaultClient, policyStore, nativeHelper, clipboard: clipboardSink }).handle
})

describe('malformed / unauthorized messages', () => {
  it('rejects a message with no action', async () => {
    const res = await router({})
    expect(res.ok).toBe(false)
  })

  it('rejects an unknown action', async () => {
    const res = await router({ action: 'not-real' })
    expect(res.ok).toBe(false)
  })

  it('rejects UNLOCK with a missing masterPassword', async () => {
    const res = await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice' } })
    expect(res.ok).toBe(false)
  })

  it('validateRendererMessage is exported and usable standalone', () => {
    expect(validateRendererMessage({ action: RENDERER_ACTIONS.GET_STATUS }).ok).toBe(true)
    expect(validateRendererMessage(null).ok).toBe(false)
  })
})

describe('locked-vault behavior', () => {
  it('refuses LIST_CREDENTIALS, FIND_BY_APP_IDENTITY, CREATE_CREDENTIAL, REVEAL_AND_INSERT, COPY_CREDENTIAL while locked', async () => {
    for (const [action, payload] of [
      [RENDERER_ACTIONS.LIST_CREDENTIALS, {}],
      [RENDERER_ACTIONS.FIND_BY_APP_IDENTITY, { appIdentity: { type: 'win32' } }],
      [RENDERER_ACTIONS.CREATE_CREDENTIAL, { app: 'x', username: 'y', password: 'z' }],
      [RENDERER_ACTIONS.REVEAL_AND_INSERT, { id: 'abc' }],
      [RENDERER_ACTIONS.COPY_CREDENTIAL, { id: 'abc' }],
    ]) {
      const res = await router({ action, payload })
      expect(res).toEqual({ ok: false, error: 'locked' })
    }
  })
})

describe('process/executable identity mismatch', () => {
  beforeEach(() => router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }))

  it('refuses REVEAL_AND_INSERT when the observed identity does not match the saved credential', async () => {
    const create = await router({
      action: RENDERER_ACTIONS.CREATE_CREDENTIAL,
      payload: { app: 'Slack', username: 'alice', password: 'x', appIdentity: { type: 'win32', executableHash: 'saved-hash' } },
    })
    const res = await router({
      action: RENDERER_ACTIONS.REVEAL_AND_INSERT,
      payload: { id: create.id, observedIdentity: { type: 'win32', executableHash: 'DIFFERENT-hash' } },
    })
    expect(res).toEqual({ ok: false, error: 'identity-mismatch' })
    expect(nativeHelper.requestInsert).not.toHaveBeenCalled()
  })

  it('proceeds to the native helper when the observed identity matches', async () => {
    const create = await router({
      action: RENDERER_ACTIONS.CREATE_CREDENTIAL,
      payload: { app: 'Slack', username: 'alice', password: 'correct-horse', appIdentity: { type: 'win32', executableHash: 'saved-hash' } },
    })
    const res = await router({
      action: RENDERER_ACTIONS.REVEAL_AND_INSERT,
      payload: { id: create.id, observedIdentity: { type: 'win32', executableHash: 'saved-hash' }, expectedProcessId: 42, expectedAutomationId: 'pw1' },
    })
    expect(res).toEqual({ ok: true })
    expect(nativeHelper.requestInsert).toHaveBeenCalledWith(expect.objectContaining({
      password: 'correct-horse',
      expectedIdentity: expect.objectContaining({ executableHash: 'saved-hash' }),
      expectedProcessId: 42,
      expectedAutomationId: 'pw1',
    }))
  })
})

describe('inserting a freshly generated password (no vault item exists yet)', () => {
  const target = { observedIdentity: { type: 'win32', executableHash: 'h' }, expectedProcessId: 42, expectedAutomationId: 'pw1' }

  it('is refused while the vault is locked', async () => {
    const res = await router({ action: RENDERER_ACTIONS.INSERT_GENERATED, payload: { password: 'gen-pw', ...target } })
    expect(res).toEqual({ ok: false, error: 'locked' })
    expect(nativeHelper.requestInsert).not.toHaveBeenCalled()
  })

  it('passes the observed identity through to the native helper for re-validation', async () => {
    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    const res = await router({ action: RENDERER_ACTIONS.INSERT_GENERATED, payload: { password: 'gen-pw', ...target } })
    expect(res).toEqual({ ok: true })
    expect(nativeHelper.requestInsert).toHaveBeenCalledWith({
      password: 'gen-pw',
      expectedIdentity: target.observedIdentity,
      expectedProcessId: 42,
      expectedAutomationId: 'pw1',
    })
  })

  it('surfaces a native-helper refusal instead of reporting success', async () => {
    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    nativeHelper.requestInsert.mockResolvedValueOnce({ ok: false, error: 'foreground process changed since detection' })
    const res = await router({ action: RENDERER_ACTIONS.INSERT_GENERATED, payload: { password: 'gen-pw', ...target } })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/process changed/)
  })

  it('rejects a payload missing the target descriptors', async () => {
    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    const res = await router({ action: RENDERER_ACTIONS.INSERT_GENERATED, payload: { password: 'gen-pw' } })
    expect(res.ok).toBe(false)
    expect(nativeHelper.requestInsert).not.toHaveBeenCalled()
  })
})

describe('copying a freshly generated password', () => {
  it('is refused while locked, and auto-clears when unlocked', async () => {
    const locked = await router({ action: RENDERER_ACTIONS.COPY_GENERATED, payload: { password: 'gen-pw' } })
    expect(locked).toEqual({ ok: false, error: 'locked' })

    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    const res = await router({ action: RENDERER_ACTIONS.COPY_GENERATED, payload: { password: 'gen-pw' } })
    expect(res.ok).toBe(true)
    expect(clipboardSink.writeAndScheduleClear).toHaveBeenCalledWith('gen-pw', expect.any(Number))
  })
})

describe('clipboard clearing wiring', () => {
  beforeEach(() => router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } }))

  it('COPY_CREDENTIAL reveals once and hands the plaintext to the clipboard guard with the policy countdown', async () => {
    const create = await router({ action: RENDERER_ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'copy-me-secret' } })
    const res = await router({ action: RENDERER_ACTIONS.COPY_CREDENTIAL, payload: { id: create.id } })
    expect(res.ok).toBe(true)
    expect(clipboardSink.writeAndScheduleClear).toHaveBeenCalledWith('copy-me-secret', expect.any(Number))
  })
})

describe('no plaintext persistence / no plaintext logging surface', () => {
  it('storage never contains the plaintext password', async () => {
    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    await router({ action: RENDERER_ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'UniqueDesktopPlaintext999' } })
    expect(JSON.stringify(storage._dump())).not.toContain('UniqueDesktopPlaintext999')
  })

  it('every router response for CREATE_CREDENTIAL omits the plaintext password field', async () => {
    await router({ action: RENDERER_ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'Demo@Vault2026' } })
    const res = await router({ action: RENDERER_ACTIONS.CREATE_CREDENTIAL, payload: { app: 'x', username: 'y', password: 'SomeSecret' } })
    expect(JSON.stringify(res)).not.toContain('SomeSecret')
  })
})
