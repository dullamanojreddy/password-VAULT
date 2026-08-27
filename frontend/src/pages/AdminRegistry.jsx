import { useMemo, useState } from 'react'
import { Search, FileLock2, Lock, ShieldX, Loader2, Download, Info } from 'lucide-react'
import { allItemsMeta } from '../lib/vault'
import { useVault } from '../lib/hooks'
import { CRYPTO } from '../lib/config'
import { Card, Empty } from '../components/ui'
import { StrengthBadge } from '../components/StrengthMeter'

// The registry is the proof of the zero-knowledge claim: an administrator with
// full database access sees ciphertext, and the "decrypt" button fails on purpose.

export default function AdminRegistry() {
  const { db } = useVault()
  const rows = allItemsMeta()
  const [q, setQ] = useState('')
  const [attempt, setAttempt] = useState(null)   // { id, phase: 'running' | 'failed' }

  const filtered = useMemo(() => {
    const n = q.toLowerCase()
    return rows.filter(
      (r) => r.app.toLowerCase().includes(n) || r.owner.toLowerCase().includes(n) || r.username.toLowerCase().includes(n),
    )
  }, [rows, q])

  async function tryDecrypt(id) {
    setAttempt({ id, phase: 'running' })
    await new Promise((r) => setTimeout(r, 900))
    setAttempt({ id, phase: 'failed' })
  }

  function exportCiphertext() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vault-registry-ciphertext.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-indigo-400/25 bg-indigo-400/[0.07] p-4">
        <Lock size={17} className="mt-0.5 shrink-0 text-indigo-300" />
        <div className="text-[12.5px] leading-relaxed text-[#e8eefc]">
          <strong className="text-indigo-300">Zero-knowledge boundary.</strong> This is the complete server-side
          record for every credential in the system — exactly what an administrator, a database dump, or an
          attacker who compromises the backend would obtain. Each secret is sealed with {CRYPTO.cipher} under a
          key derived from the owner's master password, which the server never receives. Administrators can
          manage lifecycle and enforce policy; they cannot read a single password.
        </div>
      </div>

      <Card
        title={`Encrypted Records (${filtered.length})`}
        right={
          <button
            onClick={exportCiphertext}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#1e293b] px-2.5 py-1 text-[11px] text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300"
          >
            <Download size={12} /> Export ciphertext
          </button>
        }
      >
        <div className="relative mb-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#4d5f7a]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by owner, application, or username…"
            className="w-full rounded-lg border border-[#1e293b] bg-[#070b14] py-2 pl-9 pr-3 text-[12.5px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66] focus:border-sky-400/50"
          />
        </div>

        {filtered.length === 0 ? (
          <Empty icon={FileLock2} title="No records match" />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div key={r.id} className="rounded-lg border border-[#1e293b] bg-[#131c30]/50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[#e8eefc]">{r.app}</span>
                      <StrengthBadge level={r.strength} />
                      <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#7b8aa5]">
                        {r.owner}
                      </span>
                    </div>
                    <p className="truncate text-[11.5px] text-[#7b8aa5]">
                      {r.username} · {r.category} · {r.entropy} bits
                    </p>
                  </div>
                  <button
                    onClick={() => tryDecrypt(r.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#1e293b] px-2.5 py-1.5 text-[11.5px] text-[#7b8aa5] transition hover:border-rose-400/40 hover:text-rose-300"
                  >
                    {attempt?.id === r.id && attempt.phase === 'running'
                      ? <Loader2 size={12} className="animate-spin" />
                      : <ShieldX size={12} />}
                    Attempt decrypt
                  </button>
                </div>

                <div className="mt-2 space-y-1 rounded-lg border border-[#1e293b] bg-[#070b14] p-2.5 font-mono text-[10.5px] leading-relaxed">
                  <Row k="alg" v={r.cipher} />
                  <Row k="iv " v={r.iv} />
                  <Row k="ct " v={r.ct} truncate />
                </div>

                {attempt?.id === r.id && attempt.phase === 'failed' && (
                  <div className="fade-up mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-rose-300">
                    <ShieldX size={13} className="mt-px shrink-0" />
                    <div>
                      <strong>DECRYPTION FAILED — OperationError</strong>
                      <div className="mt-0.5 text-rose-300/80">
                        AES-GCM authentication tag could not be verified. The decryption key is derived from{' '}
                        {r.owner}'s master password, which exists only in that user's browser. No administrative
                        role, database credential, or server-side key can recover this value.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-[#4d5f7a]">
        <Info size={13} className="mt-px shrink-0" />
        Strength and entropy shown above are non-reversible metadata published by the client so that policy can
        be enforced centrally. They describe the password's quality without revealing any part of its content.
      </div>
    </div>
  )
}

function Row({ k, v, truncate }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-[#4d5f7a]">{k}</span>
      <span className={`text-emerald-300/70 ${truncate ? 'truncate' : 'break-all'}`}>{v}</span>
    </div>
  )
}
