import { useEffect, useState } from 'react'
import { hasSession, supabase } from '../lib/supabase'
import { readCache, writeCache } from '../lib/cache'

type Pseudos = Record<string, string>

/** Shared by every sheet: fetched once per page load, cached for offline use. */
let pseudos: Pseudos = readCache<Pseudos>('pseudos') ?? {}
let loading: Promise<void> | null = null
const listeners = new Set<(p: Pseudos) => void>()

function load() {
  loading ??= (async () => {
    if (!(await hasSession())) return
    const { data, error } = await supabase.from('profiles').select('user_id, pseudo')
    if (error) return
    pseudos = Object.fromEntries(data.map((r) => [r.user_id, r.pseudo]))
    writeCache('pseudos', pseudos)
    listeners.forEach((f) => f(pseudos))
  })()
  return loading
}

/** Pseudo of each account sharing a project with the signed-in user, themselves included. */
export function usePseudos() {
  const [state, setState] = useState(pseudos)
  useEffect(() => {
    listeners.add(setState)
    load()
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}
