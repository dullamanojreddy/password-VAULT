import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClipboardGuard } from '../electron/main/clipboard-guard.js'

let sink, guard

beforeEach(() => {
  vi.useFakeTimers()
  let value = ''
  sink = {
    writeText: vi.fn((t) => { value = t }),
    readText: vi.fn(() => value),
  }
  guard = createClipboardGuard(sink)
})

afterEach(() => vi.useRealTimers())

describe('clipboard auto-clear', () => {
  it('writes the text immediately', () => {
    guard.writeAndScheduleClear('secret-pw', 5)
    expect(sink.writeText).toHaveBeenCalledWith('secret-pw')
  })

  it('clears the clipboard after the countdown elapses', () => {
    guard.writeAndScheduleClear('secret-pw', 3)
    vi.advanceTimersByTime(3100)
    expect(sink.readText()).toBe('')
  })

  it('does NOT clear early, before the countdown elapses', () => {
    guard.writeAndScheduleClear('secret-pw', 5)
    vi.advanceTimersByTime(2000)
    expect(sink.readText()).toBe('secret-pw')
  })

  it('reports countdown ticks to the provided callback', () => {
    const ticks = []
    guard.writeAndScheduleClear('secret-pw', 3, (remaining) => ticks.push(remaining))
    vi.advanceTimersByTime(3100)
    expect(ticks).toEqual([3, 2, 1, 0])
  })

  it('does NOT clobber a value the user copied themselves after the AEGIS write', () => {
    guard.writeAndScheduleClear('secret-pw', 2)
    sink.writeText('user copied this instead')
    vi.advanceTimersByTime(2100)
    expect(sink.readText()).toBe('user copied this instead')
  })

  it('a second write cancels the first pending clear timer', () => {
    guard.writeAndScheduleClear('first-secret', 5)
    vi.advanceTimersByTime(2000)
    guard.writeAndScheduleClear('second-secret', 5)
    vi.advanceTimersByTime(2000) // 4s total from first write, but first timer was cancelled
    expect(sink.readText()).toBe('second-secret')
    vi.advanceTimersByTime(3100)
    expect(sink.readText()).toBe('')
  })

  it('clearNow() wipes immediately regardless of the countdown', () => {
    guard.writeAndScheduleClear('secret-pw', 30)
    guard.clearNow()
    expect(sink.readText()).toBe('')
  })
})
