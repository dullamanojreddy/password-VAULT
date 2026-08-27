import { useState, useRef, useEffect } from 'react'
import {
  KeyRound, ShieldCheck, ShieldX, Eye, EyeOff, Copy, Check, Loader2, X, Lock,
} from 'lucide-react'
import { decryptWithMasterKey } from '../lib/vault'
import { useSecureClipboard } from '../lib/hooks'

export default function MasterKeyModal({ item, onClose, onRevealed }) {
  const [masterKey, setMasterKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [decryptedPlaintext, setDecryptedPlaintext] = useState(null)
  const [copiedCiphertext, setCopiedCiphertext] = useState(false)
  const { copy, copiedId, remaining } = useSecureClipboard()
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleDecrypt(mode = 'copy') {
    if (!masterKey || loading) return
    setError('')
    setLoading(true)

    const res = await decryptWithMasterKey(item.id, masterKey)
    setLoading(false)

    if (!res.ok) {
      setError(res.error || 'Decryption failed')
      return
    }

    setDecryptedPlaintext(res.plaintext)

    if (mode === 'copy') {
      await copy(res.plaintext, `plain-${item.id}`, item.app)
      setTimeout(() => {
        onClose()
      }, 800)
    } else if (mode === 'reveal') {
      onRevealed?.(res.plaintext)
    }
  }

  async function handleCopyCiphertext() {
    const rawCiphertext = item.password?.ct || item.ct || (typeof item.password === 'string' ? item.password : '')
    if (rawCiphertext) {
      await navigator.clipboard.writeText(rawCiphertext)
      setCopiedCiphertext(true)
      setTimeout(() => setCopiedCiphertext(false), 2000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-[480px] rounded-2xl border border-[#1e293b] bg-[#0d1424] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
              <KeyRound size={16} />
            </span>
            <div>
              <h3 className="text-[14px] font-semibold text-[#e8eefc]">Master Key Decryption</h3>
              <p className="text-[11px] text-[#7b8aa5]">
                Authorizing decryption for <strong>{item.app}</strong> ({item.username})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#7b8aa5] transition hover:text-[#e8eefc]">
            <X size={17} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-[#1e293b] bg-[#070b14] p-3 text-[11.5px] leading-relaxed text-[#7b8aa5]">
            <span className="font-semibold text-sky-300">Zero-Knowledge Protection:</span> This password is stored as an encrypted AES-256-GCM blob. Enter your master key to derive the secret decryption key locally in your browser.
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[#7b8aa5]">
              Master Password / Key
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#070b14] px-3 py-2.5 focus-within:border-sky-400/50">
              <input
                ref={inputRef}
                type={showKey ? 'text' : 'password'}
                value={masterKey}
                onChange={(e) => { setMasterKey(e.target.value); setError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDecrypt('copy') }}
                placeholder="Enter your master password"
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[#e8eefc] outline-none placeholder:text-[#3d4d66]"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="shrink-0 text-[#4d5f7a] transition hover:text-sky-300"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {error && (
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-rose-400">
                <ShieldX size={13} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {decryptedPlaintext && (
            <div className="fade-up space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-300">
                  Decrypted Password
                </span>
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <ShieldCheck size={13} /> Authenticated
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded border border-emerald-500/20 bg-[#070b14] px-2.5 py-1.5">
                <code className="truncate font-mono text-[13px] text-[#e8eefc]">{decryptedPlaintext}</code>
                <button
                  onClick={() => copy(decryptedPlaintext, `plain-${item.id}`, item.app)}
                  className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-300 transition hover:text-emerald-200"
                >
                  {copiedId === `plain-${item.id}` ? <Check size={12} /> : <Copy size={12} />}
                  {copiedId === `plain-${item.id}` ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <div className="flex gap-2">
              <button
                onClick={() => handleDecrypt('copy')}
                disabled={!masterKey || loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-500 py-2.5 text-[12.5px] font-semibold text-[#061019] shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                {copiedId === `plain-${item.id}` ? 'Decrypted & Copied!' : 'Decrypt & Copy Plaintext'}
              </button>
              <button
                onClick={() => handleDecrypt('reveal')}
                disabled={!masterKey || loading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#1e293b] px-3.5 py-2.5 text-[12px] font-medium text-[#7b8aa5] transition hover:border-sky-400/40 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Eye size={14} /> Reveal
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleCopyCiphertext}
                type="button"
                className="text-[11px] text-[#4d5f7a] transition hover:text-[#7b8aa5]"
              >
                {copiedCiphertext ? '✓ Encrypted blob copied' : 'Copy raw encrypted ciphertext instead'}
              </button>
              <button
                onClick={onClose}
                type="button"
                className="text-[11px] text-[#7b8aa5] transition hover:text-[#e8eefc]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
