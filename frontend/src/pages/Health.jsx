import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import {
  HeartPulse, ShieldAlert, Repeat2, Clock3, ShieldCheck, Loader2, ArrowRight, Wand2,
} from 'lucide-react'
import { STRENGTH, sev } from '../lib/config'
import { useVaultScan } from '../lib/hooks'
import { Card, Kpi, ScoreGauge, Empty } from '../components/ui'
import { StrengthBadge } from '../components/StrengthMeter'
import ItemModal from '../components/ItemModal'

export default function Health() {
  const { items, report, scanning, policy, rescan } = useVaultScan()
  const [editing, setEditing] = useState(null)

  if (!items.length) {
    return <Card><Empty icon={HeartPulse} title="Nothing to scan yet" sub="Add credentials to your vault first" /></Card>
  }

  const pie = Object.entries(report.bySeverity)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: STRENGTH[k].label, value: v, color: STRENGTH[k].color }))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={ShieldAlert} label="Breached"  value={report.breached.length} sub="found in public dumps" tone="danger" />
        <Kpi icon={Repeat2}     label="Reused"    value={report.reused.length}   sub="shared across accounts" tone="warn" />
        <Kpi icon={ShieldCheck} label="Weak"      value={report.weak.length}     sub="below policy strength" tone="danger" />
        <Kpi icon={Clock3}      label="Stale"     value={report.stale.length}    sub={`older than ${policy.rotationDays}d`} tone="warn" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card title="Vault Score">
          <div className="flex flex-col items-center gap-3 py-2">
            <ScoreGauge score={report.score} level={report.level} />
            <p className="text-center text-[12px] leading-relaxed text-[#7b8aa5]">
              {report.score >= 85
                ? 'Excellent. Keep rotation reminders on.'
                : report.score >= 50
                ? 'Reasonable, but reused and breached passwords remain your biggest exposure.'
                : 'High risk. Rotate every breached and reused credential before anything else.'}
            </p>
            {scanning && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-300">
                <Loader2 size={12} className="animate-spin" /> Breach scan in progress…
              </span>
            )}
          </div>
        </Card>

        <Card title="Strength Distribution">
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-[200px] min-w-[180px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3} stroke="none">
                    {pie.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0d1424', border: '1px solid #1e293b', borderRadius: 10, fontSize: 12, color: '#e8eefc' }}
                    cursor={false}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="min-w-[150px] flex-1 space-y-1.5">
              {pie.map((d) => (
                <li key={d.name} className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-2 text-[#7b8aa5]">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                    {d.name}
                  </span>
                  <span className="font-mono text-[#e8eefc]">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card title={`Action Queue (${report.atRisk.length})`}>
        {report.atRisk.length === 0 ? (
          <Empty icon={ShieldCheck} title="No issues found" sub="Every credential passes policy" />
        ) : (
          <ul className="space-y-2">
            {report.atRisk.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[#1e293b] bg-[#131c30]/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[#e8eefc]">{r.app}</span>
                    <StrengthBadge level={r.analysis.level} />
                  </div>
                  <p className="truncate text-[11.5px] text-[#7b8aa5]">{r.username}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.breach?.breached && <Tag tone="critical">Breached ×{r.breach.count.toLocaleString()}</Tag>}
                    {r.reused && <Tag tone="weak">Reused ×{r.reuseCount}</Tag>}
                    {['critical', 'weak'].includes(r.analysis.level) && <Tag tone="weak">Weak — {r.analysis.entropy} bits</Tag>}
                    {r.stale && <Tag tone="fair">{r.ageDays}d old</Tag>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#4d5f7a]">cracks in</div>
                  <div className="font-mono text-[12px]" style={{ color: sev(r.analysis.level).color }}>
                    {r.analysis.crack.human}
                  </div>
                </div>
                <button
                  onClick={() => setEditing(r)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-[12px] font-medium text-sky-300 transition hover:bg-sky-400/20"
                >
                  <Wand2 size={13} /> Fix <ArrowRight size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <ItemModal
          item={editing}
          existingPasswords={items}
          onClose={() => setEditing(null)}
          onSaved={rescan}
        />
      )}
    </div>
  )
}

function Tag({ tone, children }) {
  const s = sev(tone)
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${s.bg} ${s.text} ${s.border}`}>
      {children}
    </span>
  )
}
