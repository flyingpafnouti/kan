import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/signOut'

interface Enrollment {
  qr: string
  secret: string
}

/** Asks for a code of the authenticator app, after adding the app to the account the first time. */
export function MfaGate() {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function prepare() {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      const verified = data.totp[0]
      if (verified) return setFactorId(verified.id)
      // A QR code left unconfirmed by an earlier visit is replaced.
      for (const factor of data.all) await supabase.auth.mfa.unenroll({ factorId: factor.id })
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (enrolled.error) throw enrolled.error
      setEnrollment({ qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret })
      setFactorId(enrolled.data.id)
    }

    prepare().catch(() => setError('Could not reach the server'))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) {
      setError(error.code === 'mfa_verification_failed' ? 'Wrong code' : 'Could not verify the code')
      setCode('')
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <img src="icons/icon.svg" alt="" className="mb-6 h-12 w-12" />
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="text-sm text-neutral-500">
          {enrollment
            ? 'Scan this QR code with your authenticator app, then enter the code it shows.'
            : 'Enter the code shown by your authenticator app.'}
        </p>
        {enrollment && (
          <>
            <img src={enrollment.qr} alt="QR code" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />
            <p className="break-all text-center font-mono text-xs select-all text-neutral-500">{enrollment.secret}</p>
          </>
        )}
        <input
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-center tracking-widest outline-none transition focus:border-accent dark:border-neutral-800 dark:bg-neutral-900"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          pattern="[0-9]{6}"
          placeholder="000000"
          aria-label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={busy || !factorId}
          className="w-full rounded-xl bg-accent py-3 font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          Verify
        </button>
        <button
          type="button"
          onClick={signOut}
          className="w-full py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}
