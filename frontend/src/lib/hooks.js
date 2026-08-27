import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe, getState, lock, audit, getPolicy, decryptAll } from './vault'
import { checkBreached } from './crypto'
import { vaultReport } from './strength'

export function useVault() {
  return useSyncExternalStore(subscribe, getState, getState)
}

// Clipboard that clears itself. Leaving a password on the clipboard is one of
// the most common real-world leaks from password managers.
export function useSecureClipboard() {
  const [copiedId, setCopiedId] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const timers = useRef([])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => clearTimers, [])

  const copy = useCallback(async (text, id = 'x', label = '') => {
    const secs = getPolicy().clipboardClearSeconds
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false // insecure context or permission denied
    }
    audit('clipboard.copy', `${label} — auto-clear in ${secs}s`, 'warn')
    setCopiedId(id)
    setRemaining(secs)
    clearTimers()

    for (let s = 1; s <= secs; s++) {
      timers.current.push(setTimeout(() => setRemaining(secs - s), s * 1000))
    }
    timers.current.push(
      setTimeout(async () => {
        try {
          // Only wipe if our value is still there — never clobber the user's own copy.
          const cur = await navigator.clipboard.readText().catch(() => null)
          if (cur === null || cur === text) await navigator.clipboard.writeText('')
        } catch { /* readText unsupported — overwrite blindly is worse, so skip */ }
        setCopiedId(null)
        audit('clipboard.cleared', 'Clipboard wiped automatically', 'info')
      }, secs * 1000),
    )
    return true
  }, [])

  return { copy, copiedId, remaining }
}

// Decrypts the vault, runs a k-anonymous breach check on every distinct
// password, and folds the result through vaultReport(). Shared by Dashboard
// and Security Health so their numbers are always identical.
export function useVaultScan() {
  const { db } = useVault()
  const [items, setItems] = useState([])
  const [breaches, setBreaches] = useState({})
  const [scanning, setScanning] = useState(true)
  const policy = getPolicy()

  const rescan = useCallback(() => setBreaches({}), [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setScanning(true)
      const decrypted = await decryptAll()
      if (!alive) return
      setItems(decrypted)

      const seen = {}
      for (const it of decrypted) {
        if (!it.plaintext || seen[it.plaintext] !== undefined) continue
        seen[it.plaintext] = await checkBreached(it.plaintext)
        if (!alive) return
        setBreaches({ ...seen })
      }
      if (alive) setScanning(false)
    })()
    return () => { alive = false }
  }, [db.items.length])

  const report = vaultReport(items, breaches, policy)
  return { items, report, scanning, policy, rescan }
}

// Auto-lock on inactivity — the key is dropped, not just the UI hidden.
export function useAutoLock() {
  const { session } = useVault()
  const [idleFor, setIdleFor] = useState(0)
  const last = useRef(Date.now())

  useEffect(() => {
    if (!session) return
    const bump = () => { last.current = Date.now(); setIdleFor(0) }
    const evts = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }))

    const id = setInterval(() => {
      const idle = (Date.now() - last.current) / 1000
      setIdleFor(idle)
      if (idle > getPolicy().autoLockMinutes * 60) lock('idle timeout')
    }, 1000)

    return () => { evts.forEach((e) => window.removeEventListener(e, bump)); clearInterval(id) }
  }, [session])

  const limit = getPolicy().autoLockMinutes * 60
  return { idleFor, remaining: Math.max(0, limit - idleFor), limit }
}
