import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import {
  HeartPulse, ShieldAlert, Repeat2, Clock3, ShieldCheck, Loader2, ArrowRight, Wand2,
  MessageCircle, Check, Phone, FlaskConical, Shuffle,
} from 'lucide-react'
import { STRENGTH, sev } from '../lib/config'
import { DEMO_BREACHED_PASSWORDS } from '../lib/crypto'
import { useVaultScan } from '../lib/hooks'
import { isValidPhone } from '../lib/alerts'
import { myPhone, setPhone as savePhone, notifySelf, simulateBreach } from '../lib/vault'
import { Card, Kpi, ScoreGauge, Empty } from '../components/ui'
import { StrengthBadge } from '../components/StrengthMeter'
import ItemModal from '../components/ItemModal'

const timeAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export default function Health() {
  const { items, report, scanning, policy, rescan } = useVaultScan()
  const [editing, setEditing] = useState(null)
  const [phone, setPhoneField] = useState(myPhone())
  const [notifying, setNotifying] = useState(null)
  const [simTarget, setSimTarget] = useState('')
  const [simulating, setSimulating] = useState(false)

  if (!items.length) {
    return <Card><Empty icon={HeartPulse} title="Nothing to scan yet" sub="Add credentials to your vault first" /></Card>
  }

  const pie = Object.entries(report.bySeverity)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: STRENGTH[k].label, value: v, color: STRENGTH[k].color }))

  const phoneReady = isValidPhone(phone)
  const phoneSaved = phone === myPhone() && phoneReady

  async function notify(r) {
    if (!phoneSaved) return
    setNotifying(r.id)
    const reason = r.breach?.breached ? 'breach' : r.reused ? 'reuse' : 'breach'
    await notifySelf(r, reason, r.breach?.count)
    setNotifying(null)
  }

  async function runSimulation() {
    if (!simTarget) return
    setSimulating(true)
    await simulateBreach(simTarget)
    setSimulating(false)
    setSimTarget('')
  }

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

      <Card
        title="Breach Alerts"
        right={<span className="inline-flex items-center gap-1 text-[10px] text-[#4d5f7a]"><MessageCircle size={11} /> via WhatsApp</span>}
      >
        <p className="mb-3 text-[11.5px] leading-relaxed text-[#7b8aa5]">
          We notify this number when a stored password shows up in a breach — a channel independent of
          whichever app just leaked. Only the app name and severity are sent, never the password itself.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Phone size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#4d5f7a]" />
            <input
              value={phone}
              onChange={(e) => setPhoneField(e.target.value)}
              placeholder="+919966007804"
              className="w-full rounded-lg border border-[#1e293b] bg-[#070b14] py-2 pl-9 pr-3 font-mono text-[12.5px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66] focus:border-sky-400/50"
            />
          </div>
          <button
            onClick={() => savePhone(phone)}
            disabled={!phoneReady || phoneSaved}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[12px] font-medium text-sky-300 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phoneSaved ? <Check size={13} /> : null} {phoneSaved ? 'Saved' : 'Save number'}
          </button>
        </div>
        {phone && !phoneReady && (
          <p className="mt-1.5 text-[11px] text-rose-300">Use E.164 format, e.g. +919966007804</p>
        )}
        {phoneSaved && (
          <p className="mt-1.5 text-[11px] text-emerald-300">
            Breaches now alert automatically — no click needed once one is detected.
          </p>
        )}
      </Card>

      <Card
        title="Demo: Simulate a Breach"
        className="border-dashed border-amber-400/25 bg-amber-400/[0.03]"
        right={<span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9.5px] text-amber-300">FOR PRESENTATION</span>}
      >
        <p className="mb-3 text-[11.5px] leading-relaxed text-[#7b8aa5]">
          Swaps a real credential's password for one guaranteed to match our offline breach corpus — no
          network dependency, so this works even without conference wifi. Everything downstream (detection,
          the lock, the WhatsApp alert) runs through the exact same code a real breach would trigger.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={simTarget}
            onChange={(e) => setSimTarget(e.target.value)}
            className="flex-1 rounded-lg border border-[#1e293b] bg-[#070b14] px-3 py-2 text-[12.5px] text-[#e8eefc] outline-none focus:border-amber-400/50"
          >
            <option value="">Choose a credential to compromise…</option>
            {items.filter((i) => !i.locked).map((i) => (
              <option key={i.id} value={i.id}>{i.app} ({i.username})</option>
            ))}
          </select>
          <button
            onClick={runSimulation}
            disabled={!simTarget || simulating}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-amber-400 to-amber-500 px-3 py-2 text-[12px] font-semibold text-[#1a1206] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {simulating ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
            {simulating ? 'Simulating…' : 'Trigger breach'}
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-[#4d5f7a]">
          <Shuffle size={11} /> Picks randomly from {DEMO_BREACHED_PASSWORDS.length} known-breached demo values
        </p>
      </Card>

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
                    {r.breachNotifiedAt && (
                      <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        Auto-alerted {timeAgo(r.breachNotifiedAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#4d5f7a]">cracks in</div>
                  <div className="font-mono text-[12px]" style={{ color: sev(r.analysis.level).color }}>
                    {r.analysis.crack.human}
                  </div>
                </div>
                {(r.breach?.breached || r.reused) && (
                  <button
                    onClick={() => notify(r)}
                    disabled={!phoneSaved || notifying === r.id}
                    title={phoneSaved ? 'Send a WhatsApp alert to yourself' : 'Save a WhatsApp number above first'}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {notifying === r.id ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                    {r.breachNotifiedAt ? 'Resend' : 'Notify'}
                  </button>
                )}
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
