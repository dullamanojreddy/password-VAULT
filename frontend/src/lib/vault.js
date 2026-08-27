// ─── Vault store ──────────────────────────────────────────────────────────
// Holds the encrypted database + the in-memory session. Deliberately plain:
// a module-level store with a subscribe hook, no state library needed.
//
// What is persisted:  ciphertext, salts, verifiers, non-reversible metadata.
// What is NEVER persisted: the master password, the derived AES key, plaintext.

import { deriveKey, encryptField, decryptField, b64, randomBytes, DEMO_BREACHED_PASSWORDS } from './crypto'
import { DEFAULT_POLICY } from './config'
import { analyze } from './strength'
import { sendBreachAlert } from './alerts'

const DB_KEY = 'aegis.db.v1'

// ─── Reactive store plumbing ──────────────────────────────────────────────
const listeners = new Set()
let state = {
  db: load(),
  session: null,   // { userId, username, name, role, key, unlockedAt }
  locked: true,
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const getState = () => state

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((f) => f(state))
}

function persist() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(state.db)) } catch { /* quota / private mode */ }
  set({ db: { ...state.db } })
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* corrupt or unavailable — fall through to a fresh db */ }
  return { users: [], items: [], audit: [], policy: { ...DEFAULT_POLICY }, seeded: false }
}

const uid = () => b64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
const now = () => new Date().toISOString()

// ─── Audit log ────────────────────────────────────────────────────────────
export function audit(action, detail = '', severity = 'info') {
  state.db.audit.unshift({
    id: uid(),
    ts: now(),
    actor: state.session?.username ?? 'anonymous',
    role: state.session?.role ?? '-',
    action,
    detail,
    severity,
    ip: '10.42.0.17',           // demo value; the backend fills this in for real
  })
  state.db.audit = state.db.audit.slice(0, 300)
  persist()
}

// ─── Account bootstrap ────────────────────────────────────────────────────
// Demo accounts are created lazily: we can only encrypt their seed data once
// we hold a key derived from the master password they just typed.

export const DEMO_ACCOUNTS = [
  { username: 'alice',  name: 'Alice Menon',  role: 'user',  master: 'Demo@Vault2026',  phone: '+919966007804' },
  { username: 'admin',  name: 'R. Krishnan',  role: 'admin', master: 'Admin@Vault2026', phone: '' },
]

const SEED_ITEMS = [
  { app: 'Gmail',            username: 'alice.menon@gmail.com', url: 'mail.google.com',   category: 'Email',     password: 'Tr0ub4dor&3xK!vp',        age: 40 },
  { app: 'HDFC NetBanking',  username: 'alicem94',              url: 'netbanking.hdfcbank.com', category: 'Banking', password: 'alice1994',           age: 420 },
  { app: 'Instagram',        username: '@alice.m',              url: 'instagram.com',     category: 'Social',    password: 'Sunshine2021!',           age: 190 },
  { app: 'GitHub',           username: 'alicemenon',            url: 'github.com',        category: 'Developer', password: 'kQ7#vLm2$pWx9!zRt4',      age: 12 },
  { app: 'Amazon',           username: 'alice.menon@gmail.com', url: 'amazon.in',         category: 'Shopping',  password: 'Sunshine2021!',           age: 220 },
  { app: 'Netflix',          username: 'alice.menon@gmail.com', url: 'netflix.com',       category: 'Other',     password: 'password123',             age: 500 },
  { app: 'Slack (Work)',     username: 'a.menon@corp.io',       url: 'corp.slack.com',    category: 'Work',      password: 'Wq3!nZ8@fJ6%rB1^tY',     age: 5 },
  { app: 'LinkedIn',         username: 'alice.menon@gmail.com', url: 'linkedin.com',      category: 'Social',    password: 'Qwerty@12345',            age: 310 },
]

async function seedFor(user, key) {
  const created = []
  for (const s of SEED_ITEMS) {
    const blob = await encryptField(key, s.password)
    const a = analyze(s.password)
    created.push({
      id: uid(),
      userId: user.id,
      app: s.app,
      username: s.username,
      url: s.url,
      category: s.category,
      password: blob,                      // ciphertext only
      strength: a.level,                   // non-reversible metadata for policy reporting
      entropy: a.entropy,
      createdAt: new Date(Date.now() - s.age * 864e5).toISOString(),
      updatedAt: new Date(Date.now() - s.age * 864e5).toISOString(),
      favorite: ['Gmail', 'HDFC NetBanking'].includes(s.app),
      locked: false, compromisedAt: null, compromiseReason: null, breachNotifiedAt: null,
    })
  }
  return created
}

// ─── Unlock / lock ────────────────────────────────────────────────────────

export async function unlock(username, masterPassword) {
  const uname = username.trim().toLowerCase()
  let user = state.db.users.find((u) => u.username === uname)

  const demo = DEMO_ACCOUNTS.find((d) => d.username === uname)

  // First-ever unlock of a demo account: provision it now.
  if (!user && demo) {
    if (masterPassword !== demo.master) {
      audit('auth.failed', `Unknown account or wrong master password for "${uname}"`, 'warn')
      return { ok: false, error: 'Invalid credentials' }
    }
    const { key, salt, verifier } = await deriveKey(masterPassword)
    user = {
      id: uid(), username: demo.username, name: demo.name, role: demo.role,
      salt, verifier, createdAt: now(), status: 'active', mfa: true, lastSeen: now(),
      phone: demo.phone ?? '',
    }
    state.db.users.push(user)

    if (demo.role === 'user' && !state.db.seeded) {
      state.db.items.push(...(await seedFor(user, key)))
      state.db.seeded = true
    }
    persist()
    set({ session: { userId: user.id, username: user.username, name: user.name, role: user.role, key, unlockedAt: Date.now() }, locked: false })
    audit('vault.unlocked', `Key derived — PBKDF2 600k iterations`, 'info')
    return { ok: true, user }
  }

  if (!user) {
    audit('auth.failed', `No such account "${uname}"`, 'warn')
    return { ok: false, error: 'Invalid credentials' }
  }

  const { key, verifier } = await deriveKey(masterPassword, user.salt)
  if (verifier !== user.verifier) {
    audit('auth.failed', `Wrong master password for "${uname}"`, 'warn')
    return { ok: false, error: 'Invalid credentials' }
  }

  user.lastSeen = now()
  persist()
  set({ session: { userId: user.id, username: user.username, name: user.name, role: user.role, key, unlockedAt: Date.now() }, locked: false })
  audit('vault.unlocked', 'Key derived — PBKDF2 600k iterations', 'info')
  return { ok: true, user }
}

export async function registerAccount({ username, name, masterPassword, phone = '' }) {
  const uname = username.trim().toLowerCase()
  if (!uname) return { ok: false, error: 'Account username is required' }
  if (uname.length < 3) return { ok: false, error: 'Username must be at least 3 characters' }
  if (!masterPassword || masterPassword.length < 8) {
    return { ok: false, error: 'Master password must be at least 8 characters' }
  }

  const existing = state.db.users.find((u) => u.username === uname)
  const isDemo = DEMO_ACCOUNTS.some((d) => d.username === uname)
  if (existing || isDemo) {
    return { ok: false, error: 'Account already exists. Please choose a different username.' }
  }

  const { key, salt, verifier } = await deriveKey(masterPassword)
  const user = {
    id: uid(),
    username: uname,
    name: name?.trim() || uname,
    role: 'user',
    salt,
    verifier,
    createdAt: now(),
    status: 'active',
    mfa: true,
    lastSeen: now(),
    phone: phone?.trim() || '',
  }

  state.db.users.push(user)
  persist()
  set({ session: { userId: user.id, username: user.username, name: user.name, role: user.role, key, unlockedAt: Date.now() }, locked: false })
  audit('vault.registered', `New account created: "${uname}"`, 'info')
  return { ok: true, user }
}

export function lock(reason = 'manual') {
  if (state.session) audit('vault.locked', `Session ended (${reason}) — key zeroed from memory`, 'info')
  set({ session: null, locked: true })   // dropping the reference discards the CryptoKey
}

// ─── Item access ──────────────────────────────────────────────────────────

export const itemsForCurrentUser = () =>
  state.db.items.filter((i) => i.userId === state.session?.userId)

export async function revealPassword(itemId) {
  const item = state.db.items.find((i) => i.id === itemId)
  if (!item || !state.session) return null
  const pt = await decryptField(state.session.key, item.password)
  audit('item.revealed', `${item.app} (${item.username})`, 'warn')
  return pt
}

export async function decryptWithMasterKey(itemId, masterPassword) {
  if (!state.session) return { ok: false, error: 'Vault is locked. Please log in first.' }
  const user = state.db.users.find((u) => u.id === state.session.userId)
  if (!user) return { ok: false, error: 'User session not found.' }

  const item = state.db.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, error: 'Credential not found.' }

  // Verify master password cryptographically against user salt and verifier
  const { key, verifier } = await deriveKey(masterPassword, user.salt)
  if (verifier !== user.verifier) {
    audit('item.decrypt_failed', `Incorrect master key attempted for ${item.app}`, 'warn')
    return { ok: false, error: 'Incorrect master key. Decryption denied.' }
  }

  try {
    const plaintext = await decryptField(key, item.password)
    audit('item.decrypted_with_key', `Plaintext decrypted with master key for ${item.app}`, 'info')
    return { ok: true, plaintext }
  } catch (err) {
    return { ok: false, error: 'Decryption failed: ' + (err?.message || 'Invalid key') }
  }
}

// Decrypt every item once — used by the health scan and reuse detection.
export async function decryptAll() {
  if (!state.session) return []
  const mine = itemsForCurrentUser()
  const out = []
  for (const it of mine) {
    out.push({ ...it, plaintext: await decryptField(state.session.key, it.password) })
  }
  return out
}

export async function saveItem(draft) {
  if (!state.session) return { ok: false, error: 'Vault locked' }
  const blob = await encryptField(state.session.key, draft.password)
  const a = analyze(draft.password)

  if (draft.id) {
    const item = state.db.items.find((i) => i.id === draft.id)
    if (!item) return { ok: false, error: 'Not found' }
    const wasLocked = item.locked
    Object.assign(item, {
      app: draft.app, username: draft.username, url: draft.url, category: draft.category,
      password: blob, strength: a.level, entropy: a.entropy, updatedAt: now(),
      // Setting a new password IS the rotation — clear any compromise lock
      // and let a genuinely new breach re-alert instead of staying suppressed.
      locked: false, compromisedAt: null, compromiseReason: null, breachNotifiedAt: null,
    })
    audit('item.updated', `${draft.app} — re-encrypted with a fresh IV${wasLocked ? ' (rotation cleared the compromise lock)' : ''}`, 'info')
  } else {
    state.db.items.push({
      id: uid(), userId: state.session.userId,
      app: draft.app, username: draft.username, url: draft.url, category: draft.category,
      password: blob, strength: a.level, entropy: a.entropy,
      createdAt: now(), updatedAt: now(), favorite: false,
      locked: false, compromisedAt: null, compromiseReason: null, breachNotifiedAt: null,
    })
    audit('item.created', `${draft.app} (${draft.username})`, 'info')
  }
  persist()
  return { ok: true }
}

// ─── Demo tooling ───────────────────────────────────────────────────────
// For live presentations: swaps one item's password for a value guaranteed
// to be in the LOCAL breach corpus (see lib/crypto.js), so the detection →
// lock → auto-alert pipeline fires deterministically and offline, without
// depending on venue wifi reaching the real HIBP API. Runs through the exact
// same saveItem() path a real password edit would — nothing here is faked,
// only the input password is chosen to guarantee a breach hit.
export async function simulateBreach(itemId) {
  const item = state.db.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, error: 'Not found' }
  const demoPassword = DEMO_BREACHED_PASSWORDS[Math.floor(Math.random() * DEMO_BREACHED_PASSWORDS.length)]
  const res = await saveItem({
    id: item.id, app: item.app, username: item.username, url: item.url,
    category: item.category, password: demoPassword,
  })
  if (res.ok) audit('demo.breach_simulated', `${item.app} password set to a known-breached demo value`, 'warn')
  return res
}

export function deleteItem(id) {
  const item = state.db.items.find((i) => i.id === id)
  state.db.items = state.db.items.filter((i) => i.id !== id)
  audit('item.deleted', item ? `${item.app} (${item.username})` : id, 'warn')
  persist()
}

export function toggleFavorite(id) {
  const item = state.db.items.find((i) => i.id === id)
  if (item) { item.favorite = !item.favorite; persist() }
}

// ─── Admin operations (metadata only — no plaintext access, by design) ─────

export function allUsers() { return state.db.users }

export function allItemsMeta() {
  // Exactly what an admin is permitted to see: identity + ciphertext + strength.
  return state.db.items.map((i) => {
    const owner = state.db.users.find((u) => u.id === i.userId)
    return {
      id: i.id, owner: owner?.username ?? 'unknown', ownerPhone: owner?.phone ?? '', app: i.app, username: i.username,
      category: i.category, strength: i.strength, entropy: i.entropy,
      updatedAt: i.updatedAt, createdAt: i.createdAt,
      cipher: i.password.alg, iv: i.password.iv, ct: i.password.ct,
      locked: !!i.locked, compromisedAt: i.compromisedAt ?? null,
    }
  })
}

export function setUserStatus(userId, status) {
  const u = state.db.users.find((x) => x.id === userId)
  if (!u) return
  u.status = status
  audit('user.status', `${u.username} → ${status}`, status === 'suspended' ? 'warn' : 'info')
  persist()
}

export function forceRotation(userId) {
  const u = state.db.users.find((x) => x.id === userId)
  if (!u) return
  u.rotationRequired = true
  audit('user.rotation', `Rotation enforced for ${u.username}`, 'warn')
  persist()
}

// ─── Breach response: out-of-band alert + item lockdown ───────────────────
// Deliberately NOT "delete the account, email the old passwords." Deleting
// destroys every unrelated credential in the vault over a single leaked app;
// mailing/WhatsApp-ing the password would ship plaintext through a third
// party, which is exactly what the zero-knowledge design exists to prevent.
// Instead: lock only the affected item, force its rotation, and notify the
// user on a channel independent of whichever app just leaked — never the
// secret itself, only metadata (see lib/alerts.js).

const maskPhone = (p) => (p ? p.slice(0, 3) + '•'.repeat(Math.max(0, p.length - 6)) + p.slice(-3) : '')

export function setPhone(phone) {
  if (!state.session) return
  const u = state.db.users.find((x) => x.id === state.session.userId)
  if (!u) return
  u.phone = phone
  audit('user.phone_set', `WhatsApp alert number set to ${maskPhone(phone)}`, 'info')
  persist()
}

export const myPhone = () => state.db.users.find((u) => u.id === state.session?.userId)?.phone ?? ''

// Marks a breach as already alerted so useVaultScan's auto-notify effect
// doesn't re-fire on every subsequent scan of the same compromised password.
export function markBreachNotified(itemId) {
  const item = state.db.items.find((i) => i.id === itemId)
  if (!item || item.breachNotifiedAt) return
  item.breachNotifiedAt = now()
  persist()
}

// Self-service reminder — the user notifies themselves, nothing is locked.
export async function notifySelf(item, reason, occurrences) {
  const phone = myPhone()
  const res = await sendBreachAlert({ phone, app: item.app, reason, occurrences })
  audit(
    res.ok ? 'alert.whatsapp_sent' : 'alert.whatsapp_failed',
    res.ok ? `Breach alert sent for ${item.app} to ${maskPhone(phone)}${res.simulated ? ' (simulated — backend offline)' : ''}` : res.error,
    res.ok ? 'warn' : 'critical',
  )
  return res
}

// Admin response to a confirmed compromise: lock the one item, force
// rotation on the account, and notify the owner. Never touches the other
// items in that vault, and never suspends or deletes the account.
export async function flagCompromised(itemId, { reason = 'admin-flag', occurrences } = {}) {
  const item = state.db.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, error: 'Not found' }
  const owner = state.db.users.find((u) => u.id === item.userId)

  item.locked = true
  item.compromisedAt = now()
  item.compromiseReason = reason
  if (owner) owner.rotationRequired = true
  audit('item.locked', `${item.app} (${owner?.username ?? 'unknown'}) locked — mandatory rotation required`, 'critical')
  persist()

  const res = await sendBreachAlert({ phone: owner?.phone, app: item.app, reason, occurrences })
  audit(
    res.ok ? 'alert.whatsapp_sent' : 'alert.whatsapp_failed',
    res.ok
      ? `Breach alert sent to ${owner?.username} (${maskPhone(owner?.phone)})${res.simulated ? ' (simulated — backend offline)' : ''}`
      : (res.error ?? `${owner?.username} has no WhatsApp number on file`),
    res.ok ? 'warn' : 'critical',
  )
  return res
}

export function updatePolicy(patch) {
  state.db.policy = { ...state.db.policy, ...patch }
  audit('policy.updated', Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', '), 'warn')
  persist()
}

export const getPolicy = () => state.db.policy
export const getAudit = () => state.db.audit

export function resetDemo() {
  localStorage.removeItem(DB_KEY)
  state = { db: load(), session: null, locked: true }
  listeners.forEach((f) => f(state))
}
