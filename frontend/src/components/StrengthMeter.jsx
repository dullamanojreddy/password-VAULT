import { AlertTriangle, Check, Clock, Hash, ShieldAlert } from 'lucide-react'
import { sev, STRENGTH } from '../lib/config'

const ORDER = ['critical', 'weak', 'fair', 'strong', 'elite']

export function StrengthBar({ level, entropy, compact = false }) {
  const idx = ORDER.indexOf(level)
  const s = sev(level)
  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      <div className="flex gap-1">
        {ORDER.map((l, i) => (
          <div
            key={l}
            className="h-1.5 flex-1 rounded-full transition-colors duration-500"
            style={{ background: i <= idx ? s.color : '#1e293b' }}
          />
        ))}
      </div>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider" style={{ color: s.color }}>
            {s.label}
          </span>
          {entropy != null && (
            <span className="font-mono text-[10.5px] text-[#7b8aa5]">{entropy} bits entropy</span>
          )}
        </div>
      )}
    </div>
  )
}

export function StrengthBadge({ level, size = 'sm' }) {
  const s = sev(level)
  const pad = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border font-mono font-semibold tracking-wider ${pad} ${s.bg} ${s.text} ${s.border}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  )
}

// Full analysis panel — used on the Generator page and inside the item editor.
export function StrengthReport({ analysis, breached, dense = false }) {
  if (!analysis) return null
  const s = sev(analysis.level)

  return (
    <div className={dense ? 'space-y-2.5' : 'space-y-3'}>
      <StrengthBar level={analysis.level} entropy={analysis.entropy} />

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={Hash}  label="Length"  value={analysis.length} />
        <Stat icon={Hash}  label="Classes" value={`${analysis.classes}/4`} />
        <Stat icon={Clock} label="Offline crack" value={analysis.crack.human} accent={s.color} />
      </div>

      {breached?.breached && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5">
          <ShieldAlert size={14} className="mt-px shrink-0 text-rose-400" />
          <div className="text-[11.5px] leading-relaxed text-rose-300">
            <strong>Exposed in a public breach</strong> — seen {breached.count.toLocaleString()} times.
            Attackers try these first. Do not use this password anywhere.
          </div>
        </div>
      )}

      {analysis.issues.length > 0 && (
        <ul className="space-y-1.5">
          {analysis.issues.map((i) => (
            <li key={i.id} className="flex items-start gap-2 rounded-lg border border-[#1e293b] bg-[#131c30]/60 px-2.5 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#e8eefc]">{i.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-rose-300">−{i.cost} bits</span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#7b8aa5]">{i.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {analysis.suggestions.length > 0 && (
        <div className="rounded-lg border border-[#1e293b] bg-[#070b14] p-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#7b8aa5]">Recommendations</div>
          <ul className="space-y-1">
            {analysis.suggestions.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[#e8eefc]">
                <Check size={12} className="mt-0.5 shrink-0 text-sky-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-lg border border-[#1e293b] bg-[#070b14] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-[#7b8aa5]">
        <Icon size={10} /> {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-[12px] font-semibold" style={{ color: accent ?? '#e8eefc' }}>
        {value}
      </div>
    </div>
  )
}

export { STRENGTH }
