import { sev } from '../lib/config'

export function Card({ title, right, className = '', children }) {
  return (
    <div className={`rounded-xl border border-[#1e293b] bg-[#0d1424]/80 backdrop-blur ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between border-b border-[#1e293b] px-4 py-3">
          <h3 className="text-[13px] font-semibold tracking-wide text-[#e8eefc]">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function Kpi({ icon: Icon, label, value, sub, tone = 'accent' }) {
  const tones = {
    accent: 'text-sky-400 bg-sky-400/10',
    danger: 'text-rose-400 bg-rose-400/10',
    good: 'text-emerald-400 bg-emerald-400/10',
    warn: 'text-amber-400 bg-amber-400/10',
  }
  return (
    <div className="fade-up rounded-xl border border-[#1e293b] bg-[#0d1424]/80 p-4 backdrop-blur transition hover:border-[#2b3b57]">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#7b8aa5]">{label}</span>
        {Icon && (
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>
            <Icon size={15} />
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#e8eefc]">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[#7b8aa5]">{sub}</div>}
    </div>
  )
}

export function SeverityBadge({ level, size = 'sm' }) {
  const s = sev(level)
  const pad = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border font-mono font-semibold tracking-wider ${pad} ${s.bg} ${s.text} ${s.border}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  )
}

// Radial risk-score gauge — the visual centrepiece of the Analyze page.
export function ScoreGauge({ score = 0, level = 'safe', size = 168 }) {
  const s = sev(level)
  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={s.color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (score / 100) * c}
          style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 8px ${s.color}66)` }}
        />
      </svg>
      <div className="absolute grid place-items-center">
        <div className="font-mono text-4xl font-bold tabular-nums" style={{ color: s.color }}>{score}</div>
        <div className="text-[10px] uppercase tracking-widest text-[#7b8aa5]">risk score</div>
      </div>
    </div>
  )
}

export function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="grid place-items-center py-14 text-center">
      {Icon && <Icon size={30} className="mb-3 text-[#334660]" />}
      <p className="text-sm text-[#7b8aa5]">{title}</p>
      {sub && <p className="mt-1 text-xs text-[#4d5f7a]">{sub}</p>}
    </div>
  )
}
