import { useEffect, useState } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { configured, hasStoredSession, supabase } from './lib/supabase'
import { useRoute } from './lib/router'
import { Login } from './pages/Login'
import { Projects } from './pages/Projects'
import { Board } from './pages/Board'
import { AllIssues } from './pages/AllIssues'
import { Notes } from './pages/Notes'
import { Toaster } from './components/Toaster'

export function App() {
  // A stored session renders the app at once: getSession can take ~30 s offline while it retries the refresh.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(() => (hasStoredSession() ? true : undefined))
  const route = useRoute()

  useEffect(() => {
    // Offline with an expired access token, getSession fails to refresh and reports no session,
    // although the stored refresh token is still valid: stay signed in and refresh once back online.
    supabase.auth
      .getSession()
      .then(({ data, error }) =>
        setSignedIn(Boolean(data.session) || (isAuthRetryableFetchError(error) && hasStoredSession())),
      )
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') setSignedIn(false)
      else if (s) setSignedIn(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-neutral-500">
        Missing <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> variables. See the
        README.
      </main>
    )
  }
  if (signedIn === undefined) return null

  return (
    <>
      {!signedIn ? (
        <Login />
      ) : route.name === 'board' ? (
        <Board key={route.projectId} projectId={route.projectId} />
      ) : route.name === 'all' ? (
        <AllIssues />
      ) : route.name === 'notes' ? (
        <Notes />
      ) : (
        <Projects />
      )}
      <Toaster />
    </>
  )
}
