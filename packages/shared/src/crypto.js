// ─── Real client-side cryptography (WebCrypto). No library, no hand-rolled maths.
//
// Threat model: the server is UNTRUSTED. It stores ciphertext it cannot read.
// The master password never leaves this file's scope and is never transmitted.
// The derived key lives only in memory and dies on lock / refresh.
//
// PROVENANCE: this is the canonical AEGIS crypto module, kept byte-identical
// with frontend/src/lib/crypto.js. It is duplicated here — not re-exported —
// so the existing, already-verified web app has zero build/import coupling
// to this new package. If you change the algorithm here, port the same
// change to frontend/src/lib/crypto.js (or vice versa) so every AEGIS
// client stays cryptographically interoperable. Works unmodified in a web
// page, an extension content script, an MV3 service worker, and Electron's
// renderer/main — all of those expose WebCrypto (`crypto.subtle`) and the
// Base64 utility globals (`atob`/`btoa`) this file relies on.

import { CRYPTO } from './config.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

// ─── base64 <-> bytes ─────────────────────────────────────────────────────
export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))

// ─── Key derivation ───────────────────────────────────────────────────────
// PBKDF2 is deliberately slow: it makes offline brute force of the master
// password ~600,000x more expensive than a single hash.

export async function deriveKey(masterPassword, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : randomBytes(CRYPTO.saltBits / 8)

  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(masterPassword), 'PBKDF2', false, ['deriveKey', 'deriveBits'],
  )

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: CRYPTO.iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,                       // non-extractable: the key cannot be read back out
    ['encrypt', 'decrypt'],
  )

  // Separate, non-reversible verifier so we can check "is this the right master
  // password?" without ever storing the password or the encryption key itself.
  const verifierBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
    baseKey,
    256,
  )

  return { key, salt: b64(salt), verifier: b64(verifierBits) }
}

// ─── Authenticated encryption ─────────────────────────────────────────────
// AES-GCM gives confidentiality AND integrity: a tampered blob fails to decrypt
// rather than silently returning garbage. Fresh random IV on every write.

export async function encryptField(key, plaintext) {
  const iv = randomBytes(CRYPTO.ivBits / 8)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return { iv: b64(iv), ct: b64(ct), alg: CRYPTO.cipher }
}

export async function decryptField(key, blob) {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct),
    )
    return dec.decode(pt)
  } catch {
    return null // wrong key or tampered ciphertext — GCM tag check failed
  }
}

// ─── Hashing helpers ──────────────────────────────────────────────────────

export async function sha256Hex(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// SHA-1 is used ONLY as the lookup key for the k-anonymity breach API below,
// never for storing or protecting anything.
export async function sha1Hex(text) {
  const h = await crypto.subtle.digest('SHA-1', enc.encode(text))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ─── Cryptographically secure password generation ─────────────────────────
// Uses crypto.getRandomValues, never Math.random. Rejection sampling avoids
// the modulo bias that would otherwise skew the character distribution.

export const CHARSETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',      // no 'l'
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',       // no 'I', 'O'
  digits: '23456789',                      // no '0', '1'
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
  lowerFull: 'abcdefghijklmnopqrstuvwxyz',
  upperFull: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digitsFull: '0123456789',
}

function pick(alphabet) {
  const max = 256 - (256 % alphabet.length)
  let v
  do { v = randomBytes(1)[0] } while (v >= max)   // reject to kill modulo bias
  return alphabet[v % alphabet.length]
}

export function generatePassword({
  length = 20, upper = true, lower = true, digits = true, symbols = true, avoidAmbiguous = true,
} = {}) {
  const sets = []
  if (lower) sets.push(avoidAmbiguous ? CHARSETS.lower : CHARSETS.lowerFull)
  if (upper) sets.push(avoidAmbiguous ? CHARSETS.upper : CHARSETS.upperFull)
  if (digits) sets.push(avoidAmbiguous ? CHARSETS.digits : CHARSETS.digitsFull)
  if (symbols) sets.push(CHARSETS.symbols)
  if (!sets.length) sets.push(CHARSETS.lowerFull)

  // Guarantee at least one character from each selected class...
  const out = sets.map((s) => pick(s))
  const all = sets.join('')
  while (out.length < length) out.push(pick(all))

  // ...then shuffle so the guaranteed chars aren't always at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randIndex(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

const WORDS = [
  'anchor','basalt','cinder','dagger','ember','fjord','granite','harbor','iris','jasper',
  'kelvin','lantern','marble','nimbus','onyx','pewter','quartz','ripple','saffron','tundra',
  'umber','vellum','walnut','xenon','yarrow','zephyr','cobalt','driftwood','eclipse','falcon',
  'gossamer','hollow','ivory','juniper','krypton','lichen','meridian','nectar','obsidian','plateau',
]

// Unbiased random index in [0, n) — same rejection-sampling trick as pick().
function randIndex(n) {
  const max = 256 - (256 % n)
  let v
  do { v = randomBytes(1)[0] } while (v >= max)
  return v % n
}

// Diceware-style passphrase — high entropy, actually memorable.
// 40 words => log2(40) ≈ 5.32 bits/word, so 5 words ≈ 27 bits from words alone;
// the appended digits and separators push it higher. Length does the heavy lifting.
export function generatePassphrase({ words = 5, separator = '-', capitalize = true, number = true } = {}) {
  const parts = Array.from({ length: words }, () => {
    const word = WORDS[randIndex(WORDS.length)]
    return capitalize ? word[0].toUpperCase() + word.slice(1) : word
  })
  if (number) parts.push(String(10 + randIndex(90)))
  return parts.join(separator)
}

// ─── Breach check (k-anonymity) ───────────────────────────────────────────
// Only the FIRST 5 characters of the SHA-1 hash ever leave the device. The
// remote service returns ~800 candidate suffixes; matching happens locally,
// so the service never learns which password was checked.
// Falls back to a local corpus when offline (venue wifi / air-gapped demo).

const LOCAL_BREACHED_LIST = [
  'password','123456','123456789','12345678','qwerty','abc123','password1','111111','iloveyou',
  'admin','welcome','monkey','letmein','dragon','sunshine','princess','football','charlie','aa123456',
  'donald','qwerty123','password123','1q2w3e4r','qwertyuiop','000000','654321','superman','asdfghjkl',
]
const LOCAL_BREACHED = new Set(LOCAL_BREACHED_LIST)

// Exposed so demo tooling (lib/vault.js simulateBreach) can pick a value that
// is GUARANTEED to hit the offline breach path — no network dependency, so a
// live demo never depends on venue wifi reaching the real HIBP API.
export const DEMO_BREACHED_PASSWORDS = ['password123', 'qwerty123', 'welcome', '111111', 'iloveyou', 'letmein']

export async function checkBreached(password, { allowNetwork = true, timeoutMs = 2500 } = {}) {
  if (LOCAL_BREACHED.has(password.toLowerCase())) {
    return { breached: true, count: 9_000_000, source: 'local-corpus' }
  }

  if (!allowNetwork) return { breached: false, count: 0, source: 'local-corpus' }

  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: ctrl.signal,
      headers: { 'Add-Padding': 'true' },   // pads the response to hide result size
    })
    clearTimeout(t)
    if (!res.ok) throw new Error('range lookup failed')

    const body = await res.text()
    for (const line of body.split('\n')) {
      const [suf, cnt] = line.trim().split(':')
      if (suf === suffix) return { breached: true, count: Number(cnt), source: 'hibp-k-anonymity' }
    }
    return { breached: false, count: 0, source: 'hibp-k-anonymity' }
  } catch {
    return { breached: false, count: 0, source: 'offline', degraded: true }
  }
}
