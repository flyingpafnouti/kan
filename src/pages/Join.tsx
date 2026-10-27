import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { href, navigate } from '../lib/router'

/** Opened from an invite link: join the project, then show its board. */
export function Join({ token }: { token: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    supabase.rpc('join_project', { token }).then(({ data, error }) => {
      if (!live) return
      if (error || !data) return setFailed(true)
      // Replace the invite in history so Back does not land on it again.
      location.replace(href({ name: 'board', projectId: data as string }))
    })
    return () => {
      live = false
    }
  }, [token])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 pt-safe pb-safe text-center">
      {failed ? (
        <>
          <p className="text-neutral-500">
            Could not join this project. The link may have been reset, or you are offline.
          </p>
          <button
            onClick={() => navigate({ name: 'projects' })}
            className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-800"
          >
            Back to projects
          </button>
        </>
      ) : (
        <p className="text-neutral-500">Joining project…</p>
      )}
    </main>
  )
}
