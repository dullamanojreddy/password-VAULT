// A static guardrail, not a runtime test: greps this app's own source for
// patterns that would indicate global keyboard hooking, screenshotting/OCR,
// or clipboard polling — all explicitly out of scope per the desktop spec
// (UI Automation ValuePattern only, focus-change events only). Also checks
// that no source file logs a variable plausibly holding a decrypted secret.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, exts, out)
    else if (exts.includes(extname(entry))) out.push(full)
  }
  return out
}

const ROOT = join(import.meta.dirname, '..')
const JS_FILES = [
  ...walk(join(ROOT, 'electron'), ['.js', '.cjs']),
  ...walk(join(ROOT, 'src'), ['.jsx', '.js']),
]

const BANNED_PATTERNS = [
  /iohook/i,
  /SetWindowsHookEx/,
  /GetAsyncKeyState/,
  /GetKeyboardState/,
  /robotjs/i, // a common global-input-simulation package — insertion must go through UIA ValuePattern instead
  /screenshot/i,
  /captureScreen/i,
  /clipboard\.on\(/, // no clipboard *polling/watching* — the guard only writes+clears, never observes
]

describe('desktop app source contains no keylogging / screen-capture / clipboard-watching code', () => {
  it.each(JS_FILES.map((f) => [f]))('%s', (file) => {
    const text = readFileSync(file, 'utf8')
    for (const pattern of BANNED_PATTERNS) {
      expect(pattern.test(text), `${file} matched banned pattern ${pattern}`).toBe(false)
    }
  })
})

const SECRET_VAR_NAMES = ['password', 'plaintext', 'masterpassword', 'derivedkey', 'cryptokey']

describe('no console.log/console.error call plausibly logs a secret variable', () => {
  it.each(JS_FILES.map((f) => [f]))('%s', (file) => {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (!/console\.(log|error|warn|info|debug)\(/.test(line)) return
      const lower = line.toLowerCase()
      for (const name of SECRET_VAR_NAMES) {
        // Flag only if the secret-sounding identifier appears INSIDE the
        // console call's arguments, not merely mentioned in a comment on
        // the same line.
        const codePart = line.split('//')[0]
        if (codePart.toLowerCase().includes(name)) {
          throw new Error(`${file}:${i + 1} logs a variable named like a secret ("${name}"): ${line.trim()}`)
        }
      }
    })
  })
})
