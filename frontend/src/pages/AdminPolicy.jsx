import { SlidersHorizontal, Save, RotateCcw, ShieldCheck } from 'lucide-react'
import { DEFAULT_POLICY } from '../lib/config'
import { getPolicy, updatePolicy } from '../lib/vault'
import { useVault } from '../lib/hooks'
import { analyze } from '../lib/strength'
import { Card } from '../components/ui'
import { StrengthBar } from '../components/StrengthMeter'

const TOGGLES = [
  ['requireUpper',  'Require uppercase',       'At least one A–Z character.'],
  ['requireLower',  'Require lowercase',       'At least one a–z character.'],
  ['requireDigit',  'Require digit',           'At least one 0–9 character.'],
  ['requireSymbol', 'Require symbol',          'At least one non-alphanumeric character.'],
  ['blockBreached', 'Block breached passwords','Reject anything found in public breach corpora.'],
  ['blockReuse',    'Block reuse',             'Reject a password already stored for another account.'],
]

const SLIDERS = [
  ['minLength',             'Minimum length',        8,  32,  'characters'],
  ['minEntropy',            'Minimum entropy',       20, 100, 'bits'],
  ['rotationDays',          'Rotation interval',     30, 365, 'days'],
  ['autoLockMinutes',       'Auto-lock after',       1,  30,  'minutes idle'],
  ['clipboardClearSeconds', 'Clipboard auto-clear',  5,  60,  'seconds'],
]

export default function AdminPolicy() {
  const { db } = useVault()
  const policy = getPolicy()

  // Show the policy's real-world effect using a password that only just passes.
  const sample = 'Xk7#mQp2$vRn9!Lz'
  const sampleAnalysis = analyze(sample, { policy })

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-[#1e293b] bg-[#0d1424]/70 p-4">
        <SlidersHorizontal size={17} className="mt-0.5 shrink-0 text-sky-400" />
        <p className="text-[12.5px] leading-relaxed text-[#e8eefc]">
          Policy is enforced in the client at the moment of entry — a non-compliant password is rejected before
          it is ever encrypted or stored. Changes apply to every account immediately and are written to the
          audit log.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Complexity Requirements">
          <div className="space-y-2.5">
            {TOGGLES.map(([key, label, hint]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#1e293b] bg-[#131c30]/40 p-2.5 transition hover:border-[#2b3b57]"
              >
                <input
                  type="checkbox"
                  checked={policy[key]}
                  onChange={(e) => updatePolicy({ [key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-sky-400"
                />
                <div>
                  <div className="text-[12.5px] font-medium text-[#e8eefc]">{label}</div>
                  <div className="text-[11px] leading-relaxed text-[#7b8aa5]">{hint}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>

        <Card title="Thresholds">
          <div className="space-y-4">
            {SLIDERS.map(([key, label, min, max, unit]) => (
              <label key={key} className="block">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11.5px] text-[#e8eefc]">{label}</span>
                  <span className="font-mono text-[12px] font-semibold text-sky-300">
                    {policy[key]} <span className="text-[10px] text-[#7b8aa5]">{unit}</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={policy[key]}
                  onChange={(e) => updatePolicy({ [key]: Number(e.target.value) })}
                  className="w-full accent-sky-400"
                />
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Policy Preview">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[200px] flex-1">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[#7b8aa5]">
              A password that satisfies this policy
            </div>
            <code className="block break-all rounded-lg border border-[#1e293b] bg-[#070b14] px-3 py-2 font-mono text-[13px] text-[#e8eefc]">
              {sample}
            </code>
          </div>
          <div className="min-w-[200px] flex-1">
            <StrengthBar level={sampleAnalysis.level} entropy={sampleAnalysis.entropy} />
            <p className="mt-2 text-[11.5px] text-[#7b8aa5]">
              Resists an offline GPU attack for{' '}
              <strong className="text-emerald-300">{sampleAnalysis.crack.human}</strong>.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between rounded-xl border border-[#1e293b] bg-[#0d1424]/70 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[12px] text-emerald-300">
          <ShieldCheck size={14} /> Changes save automatically and are recorded in the audit log
        </span>
        <button
          onClick={() => updatePolicy({ ...DEFAULT_POLICY })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e293b] px-3 py-1.5 text-[12px] text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300"
        >
          <RotateCcw size={13} /> Reset to defaults
        </button>
      </div>
    </div>
  )
}
