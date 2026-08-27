import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFieldWatcher } from '../src/content/observer.js'

beforeEach(() => { document.body.innerHTML = '' })

function tick(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('createFieldWatcher — initial scan', () => {
  it('finds password fields already present at start()', async () => {
    document.body.innerHTML = `<input type="password" />`
    const found = []
    const watcher = createFieldWatcher({ onPasswordField: (el) => found.push(el) })
    watcher.start()
    expect(found).toHaveLength(1)
    watcher.stop()
  })
})

describe('createFieldWatcher — dynamically inserted forms (SPA behavior)', () => {
  it('detects a password field added to the DOM after start(), once debounced', async () => {
    const found = []
    const watcher = createFieldWatcher({ onPasswordField: (el) => found.push(el), debounceMs: 20 })
    watcher.start()
    expect(found).toHaveLength(0)

    const div = document.createElement('div')
    div.innerHTML = `<input type="password" id="dyn" />`
    document.body.appendChild(div)

    await tick(50)
    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('dyn')
    watcher.stop()
  })

  it('does not re-report the same element twice even if it is observed via multiple mutation batches', async () => {
    const found = []
    const watcher = createFieldWatcher({ onPasswordField: (el) => found.push(el), debounceMs: 10 })
    watcher.start()

    const input = document.createElement('input')
    input.type = 'password'
    document.body.appendChild(input)
    await tick(30)

    // Simulate a framework re-render that moves the SAME element node.
    document.body.appendChild(input) // re-append (no-op position-wise, but triggers mutation)
    await tick(30)

    expect(found).toHaveLength(1)
    watcher.stop()
  })

  it('only scans the newly added subtree, not the whole document, on each batch', async () => {
    document.body.innerHTML = `<input type="password" id="already-seen" />`
    let calls = 0
    const watcher = createFieldWatcher({ onPasswordField: () => { calls++ }, debounceMs: 10 })
    watcher.start()
    expect(calls).toBe(1) // the initial scan found it once

    const unrelated = document.createElement('div')
    unrelated.textContent = 'no password fields here'
    document.body.appendChild(unrelated)
    await tick(30)

    // The pre-existing field must not be re-reported just because an
    // unrelated sibling was added elsewhere in the document.
    expect(calls).toBe(1)
    watcher.stop()
  })
})

describe('createFieldWatcher — stop()', () => {
  it('stops reporting new fields after stop()', async () => {
    const found = []
    const watcher = createFieldWatcher({ onPasswordField: (el) => found.push(el), debounceMs: 10 })
    watcher.start()
    watcher.stop()

    const input = document.createElement('input')
    input.type = 'password'
    document.body.appendChild(input)
    await tick(30)

    expect(found).toHaveLength(0)
  })
})
