import { useEffect, useMemo, useState } from 'react'
import {
  KeySquare, ShieldAlert, Repeat2, Wand2, RefreshCw, Copy, Check, Eye, EyeOff,
  ArrowRight, Search, Plus, ShieldCheck, Lock, Clock3, CircleCheck, TriangleAlert,
} from 'lucide-react'
import { generatePassword } from '../lib/crypto'
import { analyze } from '../lib/strength'
import { getPolicy } from '../lib/vault'
import { useVault, useVaultScan, useSecureClipboard } from '../lib/hooks'
import { Card, Empty } from '../components/ui'
import { StrengthBadge, StrengthBar } from '../components/StrengthMeter'
import AppLogo from '../components/AppLogo'
import ItemModal from '../components/ItemModal'

const timeAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const ACTIVITY_LABEL = {
  'vault.unlocked': 'Vault unlocked',
  'vault.locked': 'Vault locked',
  'item.created': 'Password added',
  'item.updated': 'Password updated',
  'item.deleted': 'Password deleted',
  'item.revealed': 'Password revealed',
  'clipboard.copy': 'Password copied',
  'clipboard.cleared': 'Clipboard cleared',
}

export default function Dashboard({ onNavigate }) {
  const { db, session } = useVault()
  const { items, report, scanning } = useVaultScan()
  const { copy, copiedId, remaining } = useSecureClipboard()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [genPassword, setGenPassword] = useState(() => generatePassword({ length: 18 }))
  const [revealed, setRevealed] = useState({})

  const quick = useMemo(() => {
    const needle = q.toLowerCase()
    return items
      .filter((i) => !q || i.app.toLowerCase().includes(needle) || i.username.toLowerCase().includes(needle))
      .sort((a, b) => (b.favorite === a.favorite ? new Date(b.updatedAt) - new Date(a.updatedAt) : b.favorite - a.favorite))
      .slice(0, 5)
  }, [items, q])

  const myActivity = db.audit.filter((e) => e.actor === session?.username).slice(0, 5)

  const genAnalysis = analyze(genPassword)

  const categoryCount = new Set(items.map((i) => i.category)).size

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <VaultStrengthTile score={report.score} level={report.level} loading={scanning && !items.length} />
        <StatTile
          icon={KeySquare} tone="accent" label="Passwords Stored"
          value={items.length} sub={`across ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`}
        />
        <StatTile
          icon={ShieldAlert} tone="danger" label="Weak Passwords"
          value={report.weak.length} sub={report.weak.length ? 'update recommended' : 'none — nice work'}
          action={report.weak.length ? { label: 'Review now', onClick: () => onNavigate?.('health') } : null}
        />
        <StatTile
          icon={Repeat2} tone={report.reused.length ? 'warn' : 'good'} label="Reused Passwords"
          value={report.reused.length} sub={report.reused.length ? 'shared across accounts' : 'no reuse detected'}
          action={{ label: 'View details', onClick: () => onNavigate?.('health') }}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card
          title="Quick Access"
          right={
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-sky-400 to-sky-500 px-3 py-1.5 text-[12px] font-semibold text-[#061019] shadow shadow-sky-500/20 transition hover:brightness-110"
            >
              <Plus size={13} /> Add New
            </button>
          }
        >
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#4d5f7a]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search applications…"
              className="w-full rounded-lg border border-[#1e293b] bg-[#070b14] py-2 pl-9 pr-3 text-[12.5px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66] focus:border-sky-400/50"
            />
          </div>

          {quick.length === 0 ? (
            <Empty icon={KeySquare} title={items.length === 0 ? 'Your vault is empty' : 'No matches'} />
          ) : (
            <ul className="space-y-1.5">
              {quick.map((item) => {
                const isRevealed = revealed[item.id]
                const a = analyze(item.plaintext ?? '')
                return (
                  <li
                    key={item.id}
                    className="group flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-[#1e293b] hover:bg-white/[0.02]"
                  >
                    <AppLogo name={item.app} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[#e8eefc]">{item.app}</div>
                      <div className="truncate text-[11px] text-[#7b8aa5]">{item.username}</div>
                    </div>
                    <span className="hidden font-mono text-[12px] text-[#4d5f7a] sm:block">
                      {isRevealed ? item.plaintext : '•'.repeat(10)}
                    </span>
                    <StrengthBadge level={a.level} />
                    <button
                      onClick={() => setRevealed((r) => ({ ...r, [item.id]: !r[item.id] }))}
                      className="text-[#4d5f7a] transition hover:text-sky-300"
                      title={isRevealed ? 'Hide' : 'Reveal'}
                    >
                      {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => copy(item.plaintext, item.id, item.app)}
                      className="text-[#4d5f7a] transition hover:text-sky-300"
                      title="Copy (auto-clears)"
                    >
                      {copiedId === item.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {copiedId && (
            <p className="mt-2 text-[11px] text-amber-300">
              Copied — clipboard clears in <strong className="tabular-nums">{remaining}s</strong>
            </p>
          )}

          {items.length > 5 && (
            <button
              onClick={() => onNavigate?.('vault')}
              className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12px] font-medium text-sky-300 transition hover:text-sky-200"
            >
              View all passwords <ArrowRight size={13} />
            </button>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Generate Strong Password">
            <div className="flex items-center gap-1.5 rounded-lg border border-[#1e293b] bg-[#070b14] p-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[#e8eefc]">{genPassword}</code>
              <button
                onClick={() => setGenPassword(generatePassword({ length: 18 }))}
                title="Regenerate"
                className="shrink-0 text-[#4d5f7a] transition hover:text-sky-300"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => copy(genPassword, 'dash-gen', 'Generated password')}
                title="Copy"
                className="shrink-0 text-[#4d5f7a] transition hover:text-sky-300"
              >
                {copiedId === 'dash-gen' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
            </div>
            <div className="mt-2.5">
              <StrengthBar level={genAnalysis.level} entropy={genAnalysis.entropy} compact />
            </div>
            <button
              onClick={() => setAdding('generated')}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 py-2 text-[12.5px] font-medium text-sky-300 transition hover:bg-sky-400/15"
            >
              <Wand2 size={13} /> Use this password
            </button>
          </Card>

          <Card title="Security Recommendations">
            <ul className="space-y-2">
              <Rec ok label="Zero-knowledge encryption" detail="AES-256-GCM key never leaves your browser" />
              <Rec ok label="Auto-lock enabled" detail={`Locks after ${getPolicy().autoLockMinutes} min idle`} />
              <Rec
                ok={report.breached.length === 0}
                label={report.breached.length ? `${report.breached.length} breached password${report.breached.length > 1 ? 's' : ''}` : 'No breached passwords'}
                detail={report.breached.length ? 'Found in public leak data — rotate now' : 'None found in public breach data'}
                action={report.breached.length ? { label: 'Fix', onClick: () => onNavigate?.('health') } : null}
              />
              <Rec
                ok={report.reused.length === 0}
                label={report.reused.length ? `${report.reused.length} reused password${report.reused.length > 1 ? 's' : ''}` : 'No reused passwords'}
                detail={report.reused.length ? 'Shared across multiple accounts' : "You're not reusing any passwords"}
                action={report.reused.length ? { label: 'Fix', onClick: () => onNavigate?.('health') } : null}
              />
            </ul>
          </Card>

          <Card title="Recent Activity">
            {myActivity.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-[#4d5f7a]">No activity yet</p>
            ) : (
              <ul className="space-y-3">
                {myActivity.map((e) => (
                  <li key={e.id} className="flex items-start gap-2.5">
                    <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-400/10 text-sky-300">
                      {e.action === 'vault.unlocked' ? <Lock size={11} /> : e.action.startsWith('clipboard') ? <Copy size={11} /> : <Clock3 size={11} />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12px] text-[#e8eefc]">{ACTIVITY_LABEL[e.action] ?? e.action}</div>
                      <div className="truncate text-[10.5px] text-[#4d5f7a]">{e.detail} · {timeAgo(e.ts)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {adding && (
        <ItemModal
          initialPassword={adding === 'generated' ? genPassword : ''}
          existingPasswords={items}
          onClose={() => setAdding(false)}
          onSaved={() => setGenPassword(generatePassword({ length: 18 }))}
        />
      )}
    </div>
  )
}

function VaultStrengthTile({ score, level, loading }) {
  const color = { critical: '#f43f5e', weak: '#fb7185', fair: '#f59e0b', strong: '#38bdf8', elite: '#34d399' }[level] ?? '#38bdf8'
  const label = { critical: 'Critical', weak: 'Weak', fair: 'Fair', strong: 'Strong', elite: 'Excellent' }[level] ?? '—'
  return (
    <div className="fade-up rounded-xl border border-[#1e293b] bg-[#0d1424]/80 p-4 backdrop-blur">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#7b8aa5]">Vault Strength</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: color + '1a', color }}>
          <ShieldCheck size={15} />
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold" style={{ color }}>
        {loading ? '…' : label}
      </div>
      <div className="mt-1 mb-1.5 text-[11px] text-[#7b8aa5]">
        {loading ? 'Scanning vault…' : 'Overall vault health'}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#1e293b]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="mt-1 text-right font-mono text-[10.5px] text-[#7b8aa5]">{loading ? '' : `${score}%`}</div>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, sub, tone = 'accent', action }) {
  const tones = {
    accent: 'text-sky-400 bg-sky-400/10',
    danger: 'text-rose-400 bg-rose-400/10',
    good: 'text-emerald-400 bg-emerald-400/10',
    warn: 'text-amber-400 bg-amber-400/10',
  }
  return (
    <div className="fade-up flex flex-col rounded-xl border border-[#1e293b] bg-[#0d1424]/80 p-4 backdrop-blur transition hover:border-[#2b3b57]">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#7b8aa5]">{label}</span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#e8eefc]">{value}</div>
      <div className="mt-1 flex flex-1 items-end justify-between gap-2">
        <span className="text-[11px] text-[#7b8aa5]">{sub}</span>
        {action && (
          <button onClick={action.onClick} className="shrink-0 text-[11px] font-medium text-sky-300 transition hover:text-sky-200">
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

function Rec({ ok, label, detail, action }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-[#1e293b] bg-[#131c30]/40 p-2.5">
      {ok
        ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-emerald-400" />
        : <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[#e8eefc]">{label}</div>
        <div className="text-[11px] leading-relaxed text-[#7b8aa5]">{detail}</div>
      </div>
      {action && (
        <button onClick={action.onClick} className="shrink-0 self-center rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10.5px] font-medium text-amber-300 transition hover:bg-amber-400/20">
          {action.label}
        </button>
      )}
    </li>
  )
}
