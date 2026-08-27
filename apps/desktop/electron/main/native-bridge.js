// ─── Named-pipe client for the .NET UI Automation helper ───────────────────
// Connects to \\.\pipe\aegis-native-helper, which AegisNativeHelper.exe
// hosts with a PipeSecurity ACL restricted to the current Windows user (see
// native-helper/AegisNativeHelper/PipeServer.cs) — that ACL is the auth
// boundary, not a shared-secret token. Messages are newline-delimited JSON,
// validated against native-protocol.js before anything touches application
// state.
//
// NOTE ON VERIFICATION: this file is written against the documented Node
// `net` module Windows named-pipe support and the protocol this repo also
// defines server-side in C#. It has not been exercised against a running
// AegisNativeHelper.exe in this environment (no interactive Windows GUI
// session was available while building this) — see docs/desktop-README.md
// "Known limitations" for exactly what that means for verification status.
import { connect } from 'node:net'
import { EventEmitter } from 'node:events'
import { validateHelperMessage, ELECTRON_MESSAGE_TYPES } from './native-protocol.js'

const PIPE_PATH = '\\\\.\\pipe\\aegis-native-helper'
const RECONNECT_DELAY_MS = 2000

/** Splits a newline-delimited JSON buffer into complete lines + leftover. */
export function splitFrames(buffer) {
  const parts = buffer.split('\n')
  const leftover = parts.pop() ?? ''
  return { lines: parts.filter((l) => l.length > 0), leftover }
}

export class NativeHelperBridge extends EventEmitter {
  constructor({ pipePath = PIPE_PATH, autoReconnect = true } = {}) {
    super()
    this._pipePath = pipePath
    this._autoReconnect = autoReconnect
    this._socket = null
    this._recvBuffer = ''
    this._pendingInserts = new Map() // requestId -> { resolve, reject, timer }
    this._connected = false
  }

  connect() {
    const socket = connect(this._pipePath)
    this._socket = socket

    socket.on('connect', () => { this._connected = true; this.emit('connected') })
    socket.on('data', (chunk) => this._onData(chunk))
    socket.on('error', (err) => this.emit('error', err))
    socket.on('close', () => {
      this._connected = false
      this.emit('disconnected')
      this._rejectAllPending(new Error('native helper disconnected'))
      if (this._autoReconnect) setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
    })
  }

  isConnected() { return this._connected }

  disconnect() {
    this._autoReconnect = false
    this._socket?.destroy()
  }

  _onData(chunk) {
    this._recvBuffer += chunk.toString('utf8')
    const { lines, leftover } = splitFrames(this._recvBuffer)
    this._recvBuffer = leftover
    for (const line of lines) {
      let msg
      try { msg = JSON.parse(line) } catch { this.emit('protocol-error', 'invalid JSON frame'); continue }
      const v = validateHelperMessage(msg)
      if (!v.ok) { this.emit('protocol-error', v.error); continue }
      this._onMessage(msg)
    }
  }

  _onMessage(msg) {
    if (msg.type === 'insert-result') {
      const pending = this._pendingInserts.get(msg.payload.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this._pendingInserts.delete(msg.payload.requestId)
        pending.resolve(msg.payload)
      }
      return
    }
    // field-detected / field-lost / unsupported-target / hello — relayed
    // upward for main/index.js to forward to the renderer after applying
    // the policy-store's global/paused/per-app checks.
    this.emit(msg.type, msg.payload)
  }

  _rejectAllPending(err) {
    for (const [, pending] of this._pendingInserts) { clearTimeout(pending.timer); pending.reject(err) }
    this._pendingInserts.clear()
  }

  _send(msg) {
    if (!this._connected || !this._socket) throw new Error('native helper not connected')
    this._socket.write(JSON.stringify(msg) + '\n')
  }

  /**
   * Asks the helper to re-validate the target and insert the password.
   * Resolves with { ok, error? } — never throws for a refused insert, only
   * for a genuine transport failure (helper not connected / timed out).
   */
  requestInsert({ password, expectedIdentity, expectedProcessId, expectedAutomationId }, { timeoutMs = 5000 } = {}) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingInserts.delete(requestId)
        reject(new Error('native helper insert request timed out'))
      }, timeoutMs)
      this._pendingInserts.set(requestId, { resolve, reject, timer })
      try {
        this._send({
          type: ELECTRON_MESSAGE_TYPES.INSERT_REQUEST,
          payload: { requestId, password, expectedIdentity, expectedProcessId, expectedAutomationId },
        })
      } catch (err) {
        clearTimeout(timer)
        this._pendingInserts.delete(requestId)
        reject(err)
      }
    })
  }

  setPaused(paused) {
    this._send({ type: ELECTRON_MESSAGE_TYPES.SET_PAUSED, payload: { paused } })
  }
}
