// Lightweight structural validator for the C# sources in this folder.
// NOT a substitute for `dotnet build` — it only verifies brace/paren balance
// (ignoring comments, string literals, char literals, and verbatim strings)
// so that obvious structural mistakes are caught in environments without a
// .NET SDK installed. Run `dotnet build` for real compilation.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'bin' || entry === 'obj' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (extname(entry) === '.cs') out.push(full)
  }
  return out
}

const BACKSLASH = String.fromCharCode(92)
const QUOTE = String.fromCharCode(34)
const APOS = String.fromCharCode(39)

function analyze(src) {
  let brace = 0, paren = 0
  let inLine = false, inBlock = false, inStr = false, inChar = false, inVerbatim = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]

    if (inLine) { if (c === '\n') inLine = false; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } continue }
    if (inVerbatim) {
      // In a verbatim string (@"..."), "" is an escaped quote.
      if (c === QUOTE && n === QUOTE) { i++; continue }
      if (c === QUOTE) inVerbatim = false
      continue
    }
    if (inStr) {
      if (c === BACKSLASH) { i++; continue }
      if (c === QUOTE) inStr = false
      continue
    }
    if (inChar) {
      if (c === BACKSLASH) { i++; continue }
      if (c === APOS) inChar = false
      continue
    }

    if (c === '/' && n === '/') { inLine = true; i++; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    if (c === '@' && n === QUOTE) { inVerbatim = true; i++; continue }
    if (c === QUOTE) { inStr = true; continue }
    if (c === APOS) { inChar = true; continue }

    if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '(') paren++
    else if (c === ')') paren--
  }
  return { brace, paren }
}

const files = walk(process.argv[2] ?? '.')
let failures = 0
for (const f of files) {
  const { brace, paren } = analyze(readFileSync(f, 'utf8'))
  const ok = brace === 0 && paren === 0
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f}  braces:${brace} parens:${paren}`)
}
console.log(`\n${files.length} file(s) checked, ${failures} structural failure(s)`)
process.exit(failures ? 1 : 0)
