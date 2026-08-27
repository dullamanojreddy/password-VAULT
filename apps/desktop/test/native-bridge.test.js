import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { splitFrames } from '../electron/main/native-bridge.js'

describe('splitFrames — newline-delimited JSON framing', () => {
  it('splits complete lines and keeps a partial trailing line as leftover', () => {
    const { lines, leftover } = splitFrames('{"a":1}\n{"b":2}\n{"c":3')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(leftover).toBe('{"c":3')
  })

  it('returns no lines and the whole buffer as leftover when there is no newline yet', () => {
    const { lines, leftover } = splitFrames('{"partial":')
    expect(lines).toEqual([])
    expect(leftover).toBe('{"partial":')
  })

  it('ignores blank lines from consecutive newlines', () => {
    const { lines } = splitFrames('{"a":1}\n\n{"b":2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })
})

// The full socket lifecycle (connect/data/insert-request round trip) against
// a fake in-memory duplex stream — real net.Socket framing/backpressure
// behavior isn't exercised (that would need a real named pipe, which this
// sandboxed environment cannot provide — see docs/desktop-README.md), but
// the message assembly, validation, and request/response correlation logic
// this file owns is fully exercised here.
vi.mock('node:net', () => {
  return {
    connect: vi.fn(() => {
      const sock = new EventEmitter()
      sock.written = []
      sock.write = (data) => sock.written.push(data)
      sock.destroy = () => sock.emit('close')
      return sock
    }),
  }
})

describe('NativeHelperBridge', () => {
  let NativeHelperBridge, bridge, socket

  beforeEach(async () => {
    ;({ NativeHelperBridge } = await import('../electron/main/native-bridge.js'))
    const net = await import('node:net')
    bridge = new NativeHelperBridge({ autoReconnect: false })
    bridge.connect()
    socket = net.connect.mock.results.at(-1).value
    socket.emit('connect')
  })

  it('emits field-detected after receiving and validating a well-formed frame', () => {
    const handler = vi.fn()
    bridge.on('field-detected', handler)
    const msg = { type: 'field-detected', payload: { classification: 'login', confidence: 0.9, control: { automationId: 'a' }, process: { pid: 1 }, appIdentity: { type: 'win32' } } }
    socket.emit('data', Buffer.from(JSON.stringify(msg) + '\n'))
    expect(handler).toHaveBeenCalledWith(msg.payload)
  })

  it('drops a malformed frame and emits protocol-error instead of crashing', () => {
    const err = vi.fn()
    bridge.on('protocol-error', err)
    socket.emit('data', Buffer.from('{"type":"field-detected","payload":{}}\n'))
    expect(err).toHaveBeenCalled()
  })

  it('drops invalid JSON without throwing', () => {
    const err = vi.fn()
    bridge.on('protocol-error', err)
    expect(() => socket.emit('data', Buffer.from('not json at all\n'))).not.toThrow()
    expect(err).toHaveBeenCalled()
  })

  it('resolves requestInsert when a matching insert-result arrives', async () => {
    const promise = bridge.requestInsert({ password: 'x', expectedIdentity: { type: 'win32' }, expectedProcessId: 1, expectedAutomationId: 'a' })
    const sentFrame = JSON.parse(socket.written[0])
    expect(sentFrame.type).toBe('insert-request')
    const requestId = sentFrame.payload.requestId

    socket.emit('data', Buffer.from(JSON.stringify({ type: 'insert-result', payload: { requestId, ok: true } }) + '\n'))
    await expect(promise).resolves.toEqual({ requestId, ok: true })
  })

  it('rejects requestInsert if the helper disconnects before responding', async () => {
    const promise = bridge.requestInsert({ password: 'x', expectedIdentity: { type: 'win32' }, expectedProcessId: 1, expectedAutomationId: 'a' })
    socket.emit('close')
    await expect(promise).rejects.toThrow(/disconnected/)
  })
})
