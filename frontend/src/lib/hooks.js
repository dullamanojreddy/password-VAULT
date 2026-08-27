import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe, getState, lock, audit, getPolicy, decryptAll, myPhone, notifySelf, markBreachNotified } from './vault'
import { checkBreached } from './crypto'
import { isValidPhone } from './alerts'
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
//
// Also fires the out-of-band WhatsApp alert automatically the moment a
// breach is detected — no click required — and dedupes so the same
// compromised password doesn't re-alert on every scan. `db` (not
// `db.items.length`) is the dependency so a password ROTATION (same item
// count, new content) correctly triggers a fresh scan too.
export function useVaultScan() {
  const { db } = useVault()
  const [items, setItems] = useState([])
  const [breaches, setBreaches] = useState({})
  const [scanning, setScanning] = useState(true)
  const policy = getPolicy()
  const notifiedThisSession = useRef(new Set())

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
  }, [db])

  const report = useMemo(() => vaultReport(items, breaches, policy), [items, breaches, policy])

  useEffect(() => {
    const phone = myPhone()
    if (!isValidPhone(phone)) return
    report.breached.forEach((r) => {
      if (r.breachNotifiedAt || notifiedThisSession.current.has(r.id)) return
      notifiedThisSession.current.add(r.id)
      notifySelf(r, 'breach', r.breach?.count).then(() => markBreachNotified(r.id))
    })
  }, [report.breached])

  return { items, report, scanning, policy, rescan }
}

// Surfaces the most recent WhatsApp alert as a dismissible toast, wherever
// the user is in the app — so an automatic breach notification is visible
// live, not just a line buried in the audit log.
export function useAlertToast() {
  const { db } = useVault()
  const [toast, setToast] = useState(null)
  const seen = useRef(new Set())
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    const fresh = db.audit.find(
      (e) => (e.action === 'alert.whatsapp_sent' || e.action === 'alert.whatsapp_failed')
        && !seen.current.has(e.id)
        && new Date(e.ts).getTime() >= mountedAt.current - 2000,
    )
    if (!fresh) return
    seen.current.add(fresh.id)
    setToast(fresh)
    const t = setTimeout(() => setToast((cur) => (cur?.id === fresh.id ? null : cur)), 6000)
    return () => clearTimeout(t)
  }, [db.audit])

  return { toast, dismiss: () => setToast(null) }
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
