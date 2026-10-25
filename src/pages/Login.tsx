import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError('Wrong email or password')
  }

  const field =
    'w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 outline-none transition focus:border-accent dark:border-neutral-800 dark:bg-neutral-900'

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <img src="icons/icon.svg" alt="" className="mb-6 h-12 w-12" />
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Issues</h1>
        <input
          className={field}
          type="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={field}
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    </main>
  )
}
