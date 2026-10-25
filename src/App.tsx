import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { useRoute } from './lib/router'
import { Login } from './pages/Login'
import { Projects } from './pages/Projects'
import { Board } from './pages/Board'
import { Toaster } from './components/Toaster'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-neutral-500">
        Variables <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> manquantes. Voir le
        README.
      </main>
    )
  }
  if (session === undefined) return null

  return (
    <>
      {!session ? (
        <Login />
      ) : route.name === 'board' ? (
        <Board key={route.projectId} projectId={route.projectId} />
      ) : (
        <Projects />
      )}
      <Toaster />
    </>
  )
}
