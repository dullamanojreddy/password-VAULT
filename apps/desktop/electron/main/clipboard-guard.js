// ─── Self-clearing clipboard ────────────────────────────────────────────
// Same policy as the web app's useSecureClipboard: write the secret, start
// a countdown, and wipe it automatically — but only if the clipboard still
// holds exactly what we put there (never clobber something the user copied
// themselves in the meantime). Parameterized over a `{ writeText, readText }`
// sink and a `setTimeout`-like scheduler so this is unit-testable without a
// real OS clipboard or real timers.
export function createClipboardGuard(sink, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let pendingClearTimer = null
  let lastWritten = null
  let onCountdown = null // (secondsRemaining) => void, optional UI hook

  function writeAndScheduleClear(text, seconds, onTick) {
    if (pendingClearTimer) clearTimeoutFn(pendingClearTimer)
    sink.writeText(text)
    lastWritten = text
    onCountdown = onTick ?? null

    let remaining = seconds
    onCountdown?.(remaining)
    const tick = () => {
      remaining -= 1
      onCountdown?.(remaining)
      if (remaining <= 0) {
        if (sink.readText() === lastWritten) sink.writeText('')
        lastWritten = null
        pendingClearTimer = null
        return
      }
      pendingClearTimer = setTimeoutFn(tick, 1000)
    }
    pendingClearTimer = setTimeoutFn(tick, 1000)
  }

  function clearNow() {
    if (pendingClearTimer) { clearTimeoutFn(pendingClearTimer); pendingClearTimer = null }
    if (lastWritten != null && sink.readText() === lastWritten) sink.writeText('')
    lastWritten = null
  }

  return { writeAndScheduleClear, clearNow }
}
