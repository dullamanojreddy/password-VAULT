import { useState } from 'react'
import { ShieldCheck, Lock, User, KeyRound, Loader2, AlertCircle, Cpu } from 'lucide-react'
import { APP, CRYPTO } from '../lib/config'
import { unlock, DEMO_ACCOUNTS } from '../lib/vault'

export default function Login() {
  const [username, setUsername] = useState('')
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e?.preventDefault()
    if (busy || !username || !master) return
    setBusy(true)
    setError('')
    // Yield a frame so the "deriving key" state paints before PBKDF2 blocks.
    await new Promise((r) => setTimeout(r, 60))
    const res = await unlock(username, master)
    if (!res.ok) { setError(res.error); setBusy(false) }
  }

  function fill(acct) {
    setUsername(acct.username)
    setMaster(acct.master)
    setError('')
  }

  return (
    <div className="relative z-10 grid min-h-full place-items-center p-6">
      <div className="fade-up w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-xl shadow-sky-500/25">
            <ShieldCheck size={28} className="text-[#070b14]" />
          </div>
          <h1 className="text-xl font-bold tracking-[0.2em] text-[#e8eefc]">{APP.name}</h1>
          <p className="mt-1 text-[12px] text-[#7b8aa5]">{APP.tagline}</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-[#1e293b] bg-[#0d1424]/85 p-6 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <Field icon={User} label="Account">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="alice"
              className="w-full bg-transparent text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
            />
          </Field>

          <Field icon={KeyRound} label="Master password">
            <input
              type="password"
              value={master}
              onChange={(e) => setMaster(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="w-full bg-transparent font-mono text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
            />
          </Field>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !master}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-500 py-2.5 text-[13px] font-semibold text-[#061019] shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={14} />}
            {busy ? `Deriving key — ${CRYPTO.iterations.toLocaleString()} iterations…` : 'Unlock vault'}
          </button>

          <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[#4d5f7a]">
            <Cpu size={12} className="mt-px shrink-0" />
            Your master password never leaves this device. It is stretched with{' '}
            {CRYPTO.kdf} into an {CRYPTO.cipher} key held only in memory.
          </p>
        </form>

        <div className="mt-5 rounded-xl border border-[#1e293b] bg-[#0d1424]/60 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-[#4d5f7a]">Demo accounts</div>
          <div className="flex gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.username}
                type="button"
                onClick={() => fill(a)}
                className="flex-1 rounded-lg border border-[#1e293b] bg-[#131c30] px-3 py-2 text-left transition hover:border-sky-400/40"
              >
                <div className="text-[12px] font-medium text-[#e8eefc]">{a.username}</div>
                <div className="text-[10px] uppercase tracking-wider text-[#7b8aa5]">{a.role}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ icon: Icon, label, children }) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[#7b8aa5]">
        {label}
      </span>
      <div className="flex items-center gap-2.5 rounded-lg border border-[#1e293b] bg-[#070b14] px-3 py-2.5 transition focus-within:border-sky-400/50 focus-within:ring-2 focus-within:ring-sky-400/15">
        <Icon size={15} className="shrink-0 text-[#4d5f7a]" />
        {children}
      </div>
    </label>
  )
}
