import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Copy, Check, Wand2, Dices, Loader2, Cpu, Eye, EyeOff } from 'lucide-react'
import { generatePassword, generatePassphrase, checkBreached } from '../lib/crypto'
import { analyze } from '../lib/strength'
import { getPolicy } from '../lib/vault'
import { useSecureClipboard, useTemporaryReveal } from '../lib/hooks'
import { Card } from '../components/ui'
import { StrengthReport } from '../components/StrengthMeter'

export default function Generator() {
  const [mode, setMode] = useState('random')
  const [length, setLength] = useState(20)
  const [words, setWords] = useState(5)
  const [opts, setOpts] = useState({ upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: true })
  const [value, setValue] = useState('')
  const [breached, setBreached] = useState(null)
  const [checking, setChecking] = useState(false)
  const { copy, copiedId, remaining } = useSecureClipboard()
  const { revealedId, toggleReveal, hideRevealed } = useTemporaryReveal()
  const isRevealed = revealedId === 'generator'

  const regenerate = useCallback(() => {
    hideRevealed()
    setValue(mode === 'random' ? generatePassword({ length, ...opts }) : generatePassphrase({ words }))
  }, [hideRevealed, mode, length, words, opts])

  useEffect(() => { regenerate() }, [regenerate])

  useEffect(() => {
    if (!value) return
    setChecking(true)
    const t = setTimeout(async () => { setBreached(await checkBreached(value)); setChecking(false) }, 400)
    return () => { clearTimeout(t); setChecking(false) }
  }, [value])

  const analysis = analyze(value, { policy: getPolicy(), breached })
  const toggle = (k) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Card>
        <div className="mb-4 flex gap-1.5">
          {[
            { id: 'random', label: 'Random string', icon: Wand2 },
            { id: 'passphrase', label: 'Passphrase', icon: Dices },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
                mode === m.id
                  ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
                  : 'border-[#1e293b] text-[#7b8aa5] hover:text-[#e8eefc]'
              }`}
            >
              <m.icon size={14} /> {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#1e293b] bg-[#070b14] p-4">
          <code className="min-w-0 flex-1 break-all font-mono text-[15px] leading-relaxed text-[#e8eefc]">
            {isRevealed ? value : '•'.repeat(value.length)}
          </code>
          <button
            onClick={() => toggleReveal('generator')}
            title={isRevealed ? 'Hide generated password' : 'Reveal generated password for 10 seconds'}
            aria-label={isRevealed ? 'Hide generated password' : 'Reveal generated password for 10 seconds'}
            aria-pressed={isRevealed}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#1e293b] text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300"
          >
            {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button
            onClick={regenerate}
            title="Regenerate"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#1e293b] text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => copy(value, 'gen', 'Generated password')}
            title="Copy (auto-clears)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-300 transition hover:bg-sky-400/25"
          >
            {copiedId === 'gen' ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
        </div>

        {copiedId === 'gen' && (
          <p className="mt-2 text-[11.5px] text-amber-300">
            Copied — clipboard clears in <strong className="tabular-nums">{remaining}s</strong>
          </p>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#4d5f7a]">
          <Cpu size={12} className="mt-px shrink-0" />
          Generated with <code className="text-[#7b8aa5]">crypto.getRandomValues</code> using rejection
          sampling — never <code className="text-[#7b8aa5]">Math.random</code>, which is predictable and
          would let an attacker reconstruct the output.
        </p>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Options">
          {mode === 'random' ? (
            <div className="space-y-4">
              <Slider label="Length" value={length} min={8} max={64} onChange={setLength} />
              <div className="space-y-2">
                {[
                  ['upper', 'Uppercase (A–Z)'],
                  ['lower', 'Lowercase (a–z)'],
                  ['digits', 'Digits (0–9)'],
                  ['symbols', 'Symbols (!@#$)'],
                  ['avoidAmbiguous', 'Avoid ambiguous (l, 1, O, 0)'],
                ].map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-[#e8eefc]">
                    <input
                      type="checkbox"
                      checked={opts[k]}
                      onChange={() => toggle(k)}
                      className="h-4 w-4 rounded border-[#1e293b] bg-[#070b14] accent-sky-400"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Slider label="Words" value={words} min={3} max={10} onChange={setWords} />
              <p className="text-[11.5px] leading-relaxed text-[#7b8aa5]">
                Passphrases trade character complexity for length. They are far easier to type and recall
                on devices where you cannot autofill — a TV, a console, a locked workstation.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="Analysis"
          right={checking ? <Loader2 size={13} className="animate-spin text-sky-400" /> : null}
        >
          <StrengthReport analysis={analysis} breached={breached} dense />
        </Card>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[#7b8aa5]">{label}</span>
        <span className="font-mono text-[13px] font-semibold text-sky-300">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-400"
      />
    </label>
  )
}
