import { useState } from 'react'
import { ShieldCheck, Lock, User, KeyRound, Loader2, AlertCircle, Cpu, UserPlus, Phone, Sparkles } from 'lucide-react'
import { APP, CRYPTO } from '../lib/config'
import { unlock, registerAccount, DEMO_ACCOUNTS } from '../lib/vault'

export default function Login() {
  const [tab, setTab] = useState('login') // 'login' | 'register'
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [master, setMaster] = useState('')
  const [confirmMaster, setConfirmMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e?.preventDefault()
    setError('')

    if (tab === 'login') {
      if (busy || !username || !master) return
      setBusy(true)
      await new Promise((r) => setTimeout(r, 60))
      const res = await unlock(username, master)
      if (!res.ok) { setError(res.error); setBusy(false) }
    } else {
      if (busy || !username || !master) return
      if (master !== confirmMaster) {
        setError('Master passwords do not match')
        return
      }
      setBusy(true)
      await new Promise((r) => setTimeout(r, 60))
      const res = await registerAccount({ username, name, masterPassword: master, phone })
      if (!res.ok) { setError(res.error); setBusy(false) }
    }
  }

  function fill(acct) {
    setTab('login')
    setUsername(acct.username)
    setMaster(acct.master)
    setError('')
  }

  return (
    <div className="relative z-10 grid min-h-full place-items-center p-6">
      <div className="fade-up w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-xl shadow-sky-500/25">
            <ShieldCheck size={28} className="text-[#070b14]" />
          </div>
          <h1 className="text-xl font-bold tracking-[0.2em] text-[#e8eefc]">{APP.name}</h1>
          <p className="mt-1 text-[12px] text-[#7b8aa5]">{APP.tagline}</p>
        </div>

        <div className="mb-4 flex rounded-xl border border-[#1e293b] bg-[#0a0f1c] p-1">
          <button
            type="button"
            onClick={() => { setTab('login'); setError('') }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium transition ${
              tab === 'login'
                ? 'bg-sky-400/15 text-sky-300 shadow ring-1 ring-sky-400/30'
                : 'text-[#7b8aa5] hover:text-[#e8eefc]'
            }`}
          >
            <Lock size={13} /> Unlock Vault
          </button>
          <button
            type="button"
            onClick={() => { setTab('register'); setError('') }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium transition ${
              tab === 'register'
                ? 'bg-sky-400/15 text-sky-300 shadow ring-1 ring-sky-400/30'
                : 'text-[#7b8aa5] hover:text-[#e8eefc]'
            }`}
          >
            <UserPlus size={13} /> Create Account
          </button>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-[#1e293b] bg-[#0d1424]/85 p-6 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <Field icon={User} label="Username">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder={tab === 'login' ? 'alice or your username' : 'e.g. manoj'}
              className="w-full bg-transparent text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
            />
          </Field>

          {tab === 'register' && (
            <>
              <Field icon={Sparkles} label="Display Name (optional)">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Manoj Reddy"
                  className="w-full bg-transparent text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
                />
              </Field>

              <Field icon={Phone} label="WhatsApp Phone (optional for breach alerts)">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full bg-transparent font-mono text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
                />
              </Field>
            </>
          )}

          <Field icon={KeyRound} label="Master password">
            <input
              type="password"
              value={master}
              onChange={(e) => setMaster(e.target.value)}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••••••"
              className="w-full bg-transparent font-mono text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
            />
          </Field>

          {tab === 'register' && (
            <Field icon={KeyRound} label="Confirm Master password">
              <input
                type="password"
                value={confirmMaster}
                onChange={(e) => setConfirmMaster(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••••••"
                className="w-full bg-transparent font-mono text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
              />
            </Field>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !master || (tab === 'register' && !confirmMaster)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-500 py-2.5 text-[13px] font-semibold text-[#061019] shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : tab === 'login' ? (
              <Lock size={14} />
            ) : (
              <UserPlus size={14} />
            )}
            {busy
              ? `Deriving zero-knowledge key — ${CRYPTO.iterations.toLocaleString()} iterations…`
              : tab === 'login'
              ? 'Unlock vault'
              : 'Create Zero-Knowledge Vault'}
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
