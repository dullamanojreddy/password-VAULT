import { describe, it, expect } from 'vitest'
import { validateHelperMessage, validateElectronMessage, HELPER_MESSAGE_TYPES, ELECTRON_MESSAGE_TYPES } from '../electron/main/native-protocol.js'

describe('validateHelperMessage', () => {
  it('accepts a well-formed field-detected message', () => {
    const res = validateHelperMessage({
      type: HELPER_MESSAGE_TYPES.FIELD_DETECTED,
      payload: {
        classification: 'signup', confidence: 0.8,
        control: { automationId: 'pw1' },
        process: { pid: 1234 },
        appIdentity: { type: 'win32', executableHash: 'abc' },
      },
    })
    expect(res.ok).toBe(true)
  })

  it('rejects field-detected with an invalid classification value', () => {
    const res = validateHelperMessage({
      type: HELPER_MESSAGE_TYPES.FIELD_DETECTED,
      payload: { classification: 'not-a-real-kind', confidence: 0.8, control: { automationId: 'x' }, process: { pid: 1 }, appIdentity: { type: 'win32' } },
    })
    expect(res.ok).toBe(false)
  })

  it('rejects a message with an unknown type', () => {
    expect(validateHelperMessage({ type: 'made-up-type', payload: {} }).ok).toBe(false)
  })

  it('rejects a malformed envelope (no type)', () => {
    expect(validateHelperMessage({ payload: {} }).ok).toBe(false)
    expect(validateHelperMessage(null).ok).toBe(false)
  })

  it('accepts insert-result and field-lost', () => {
    expect(validateHelperMessage({ type: HELPER_MESSAGE_TYPES.INSERT_RESULT, payload: { requestId: 'r1', ok: true } }).ok).toBe(true)
    expect(validateHelperMessage({ type: HELPER_MESSAGE_TYPES.FIELD_LOST, payload: {} }).ok).toBe(true)
  })
})

describe('validateElectronMessage', () => {
  it('accepts a well-formed insert-request', () => {
    const res = validateElectronMessage({
      type: ELECTRON_MESSAGE_TYPES.INSERT_REQUEST,
      payload: {
        requestId: 'r1', password: 'x', expectedIdentity: { type: 'win32', executableHash: 'abc' },
        expectedProcessId: 42, expectedAutomationId: 'pw1',
      },
    })
    expect(res.ok).toBe(true)
  })

  it('rejects insert-request missing the process id', () => {
    const res = validateElectronMessage({
      type: ELECTRON_MESSAGE_TYPES.INSERT_REQUEST,
      payload: { requestId: 'r1', password: 'x', expectedIdentity: { type: 'win32' }, expectedAutomationId: 'pw1' },
    })
    expect(res.ok).toBe(false)
  })

  it('rejects an appIdentity with an invalid type value', () => {
    const res = validateElectronMessage({
      type: ELECTRON_MESSAGE_TYPES.INSERT_REQUEST,
      payload: { requestId: 'r1', password: 'x', expectedIdentity: { type: 'macos' }, expectedProcessId: 1, expectedAutomationId: 'a' },
    })
    expect(res.ok).toBe(false)
  })
})
