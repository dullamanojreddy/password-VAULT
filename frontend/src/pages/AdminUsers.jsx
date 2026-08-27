import { useState } from 'react'
import { Users, ShieldCheck, ShieldOff, RotateCw, KeyRound, UserCheck, Fingerprint } from 'lucide-react'
import { allUsers, allItemsMeta, setUserStatus, forceRotation } from '../lib/vault'
import { useVault } from '../lib/hooks'
import { Card, Kpi, Empty } from '../components/ui'
import { StrengthBadge } from '../components/StrengthMeter'

export default function AdminUsers() {
  const { db } = useVault()
  const users = allUsers()
  const meta = allItemsMeta()
  const [open, setOpen] = useState(null)

  const active = users.filter((u) => u.status === 'active').length
  const atRisk = meta.filter((m) => ['critical', 'weak'].includes(m.strength)).length

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users}       label="Accounts"        value={users.length} sub={`${active} active`} />
        <Kpi icon={KeyRound}    label="Credentials"     value={meta.length}  sub="encrypted at rest" />
        <Kpi icon={ShieldOff}   label="Below Policy"    value={atRisk}       sub="weak or critical" tone="danger" />
        <Kpi icon={Fingerprint} label="MFA Enrolled"    value={`${users.filter((u) => u.mfa).length}/${users.length}`} sub="second factor" tone="good" />
      </div>

      <Card title={`Managed Accounts (${users.length})`}>
        {users.length === 0 ? (
          <Empty icon={Users} title="No accounts provisioned" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-[#1e293b] text-[10px] uppercase tracking-wider text-[#7b8aa5]">
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Items</th>
                  <th className="py-2 pr-3 font-medium">MFA</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {users.map((u) => {
                  const mine = meta.filter((m) => m.owner === u.username)
                  return (
                    <tr key={u.id} className="transition hover:bg-white/[0.03]">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                            u.role === 'admin' ? 'bg-indigo-400/15 text-indigo-300' : 'bg-sky-400/15 text-sky-300'
                          }`}>
                            {u.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                          </div>
                          <div className="leading-tight">
                            <div className="font-medium text-[#e8eefc]">{u.name}</div>
                            <div className="font-mono text-[10.5px] text-[#7b8aa5]">{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                          u.role === 'admin' ? 'bg-indigo-400/10 text-indigo-300' : 'bg-sky-400/10 text-sky-300'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 pr-3 font-mono text-[#e8eefc]">{mine.length}</td>
                      <td className="py-3 pr-3">
                        {u.mfa
                          ? <ShieldCheck size={14} className="text-emerald-400" />
                          : <ShieldOff size={14} className="text-rose-400" />}
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                          u.status === 'active'
                            ? 'bg-emerald-400/10 text-emerald-300'
                            : 'bg-rose-400/10 text-rose-300'
                        }`}>
                          {u.status}
                        </span>
                        {u.rotationRequired && (
                          <span className="ml-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                            rotation due
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-[10.5px] text-[#7b8aa5]">
                        {new Date(u.lastSeen ?? u.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setUserStatus(u.id, u.status === 'active' ? 'suspended' : 'active')}
                            className="rounded-md border border-[#1e293b] px-2 py-1 text-[11px] text-[#7b8aa5] transition hover:border-rose-400/40 hover:text-rose-300"
                          >
                            {u.status === 'active' ? 'Suspend' : 'Restore'}
                          </button>
                          <button
                            onClick={() => forceRotation(u.id)}
                            title="Require password rotation at next unlock"
                            className="inline-flex items-center gap-1 rounded-md border border-[#1e293b] px-2 py-1 text-[11px] text-[#7b8aa5] transition hover:border-amber-400/40 hover:text-amber-300"
                          >
                            <RotateCw size={11} /> Rotate
                          </button>
                          <button
                            onClick={() => setOpen(open === u.id ? null : u.id)}
                            className="rounded-md border border-[#1e293b] px-2 py-1 text-[11px] text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300"
                          >
                            {open === u.id ? 'Hide' : 'Inspect'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {open && (
          <div className="mt-4 rounded-lg border border-[#1e293b] bg-[#070b14] p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#7b8aa5]">
              <UserCheck size={12} /> Credential metadata — no plaintext is available to administrators
            </div>
            <div className="flex flex-wrap gap-2">
              {allItemsMeta()
                .filter((m) => m.owner === users.find((u) => u.id === open)?.username)
                .map((m) => (
                  <div key={m.id} className="rounded-lg border border-[#1e293b] bg-[#131c30] px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#e8eefc]">{m.app}</span>
                      <StrengthBadge level={m.strength} />
                    </div>
                    <div className="font-mono text-[10px] text-[#4d5f7a]">{m.entropy} bits · {m.category}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
