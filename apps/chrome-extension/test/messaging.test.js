import { describe, it, expect, beforeEach } from 'vitest'
import { installChromeMock, EXTENSION_ID, makeSender } from './chrome-mock.js'
import { validateMessage, ACTIONS } from '../src/lib/messaging.js'

beforeEach(() => installChromeMock())

describe('validateMessage — sender authorization', () => {
  it('rejects a message whose sender.id does not match this extension', () => {
    const res = validateMessage({ action: ACTIONS.GET_STATUS }, { id: 'some-other-extension' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/did not originate/)
  })

  it('accepts a message from this extension itself', () => {
    const res = validateMessage({ action: ACTIONS.GET_STATUS }, makeSender())
    expect(res.ok).toBe(true)
  })
})

describe('validateMessage — malformed envelopes', () => {
  it('rejects a non-object message', () => {
    expect(validateMessage('not an object', makeSender()).ok).toBe(false)
    expect(validateMessage(null, makeSender()).ok).toBe(false)
  })

  it('rejects a message with no action field', () => {
    expect(validateMessage({ payload: {} }, makeSender()).ok).toBe(false)
  })

  it('rejects an unknown action name', () => {
    const res = validateMessage({ action: 'totally-made-up-action' }, makeSender())
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unknown action/)
  })
})

describe('validateMessage — payload schemas', () => {
  it('rejects UNLOCK with a missing masterPassword', () => {
    const res = validateMessage({ action: ACTIONS.UNLOCK, payload: { username: 'alice' } }, makeSender())
    expect(res.ok).toBe(false)
  })

  it('accepts a well-formed UNLOCK payload', () => {
    const res = validateMessage({ action: ACTIONS.UNLOCK, payload: { username: 'alice', masterPassword: 'x' } }, makeSender())
    expect(res.ok).toBe(true)
  })

  it('rejects CREATE_CREDENTIAL missing required fields', () => {
    const res = validateMessage({ action: ACTIONS.CREATE_CREDENTIAL, payload: { app: 'GitHub' } }, makeSender())
    expect(res.ok).toBe(false)
  })

  it('rejects ANALYZE_PASSWORD when password is not a string', () => {
    const res = validateMessage({ action: ACTIONS.ANALYZE_PASSWORD, payload: { password: 12345 } }, makeSender())
    expect(res.ok).toBe(false)
  })
})

describe('validateMessage — sender URL requirement for tab-originated messages', () => {
  it('rejects a tab-sourced message with no sender.url', () => {
    const res = validateMessage({ action: ACTIONS.GET_STATUS }, { id: EXTENSION_ID, tab: { id: 1 } })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/missing sender URL/)
  })
})
