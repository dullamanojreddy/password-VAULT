// ─── App identity + shared scales ─────────────────────────────────────────

export const APP = {
  name: 'AEGIS',
  tagline: 'Zero-Knowledge Credential Vault',
  team: 'Team <YOUR TEAM NAME>',
}

// Crypto parameters — surfaced in the UI so judges can see the hardening.
export const CRYPTO = {
  kdf: 'PBKDF2-HMAC-SHA256',
  iterations: 600_000,        // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
  cipher: 'AES-256-GCM',
  saltBits: 128,
  ivBits: 96,
}

// Password strength scale. Reused by badges, gauges, charts.
export const STRENGTH = {
  critical: { label: 'CRITICAL', color: '#f43f5e', bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30' },
  weak:     { label: 'WEAK',     color: '#fb7185', bg: 'bg-rose-400/10',    text: 'text-rose-300',    border: 'border-rose-400/30' },
  fair:     { label: 'FAIR',     color: '#f59e0b', bg: 'bg-amber-400/10',   text: 'text-amber-300',   border: 'border-amber-400/30' },
  strong:   { label: 'STRONG',   color: '#38bdf8', bg: 'bg-sky-400/10',     text: 'text-sky-300',     border: 'border-sky-400/30' },
  elite:    { label: 'ELITE',    color: '#34d399', bg: 'bg-emerald-400/10', text: 'text-emerald-300', border: 'border-emerald-400/30' },
}

export const sev = (k) => STRENGTH[k] ?? STRENGTH.fair

// Security policy defaults — admin can edit these at runtime.
export const DEFAULT_POLICY = {
  minLength: 14,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
  minEntropy: 60,
  blockBreached: true,
  blockReuse: true,
  rotationDays: 90,
  autoLockMinutes: 5,
  clipboardClearSeconds: 15,
}

// Categories for vault items.
export const CATEGORIES = ['Banking', 'Email', 'Social', 'Work', 'Shopping', 'Developer', 'Other']

// Deterministic accent colour per app name — avoids shipping brand logos.
export function appColor(name = '') {
  const palette = ['#38bdf8', '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
