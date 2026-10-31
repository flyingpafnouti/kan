import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configured = Boolean(url && key)

const storageKey = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : 'sb-auth-token'

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey },
})

export function hasStoredSession() {
  try {
    return Boolean(JSON.parse(localStorage.getItem(storageKey) ?? 'null')?.refresh_token)
  } catch {
    return false
  }
}

export function storedAccessToken(): string | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? 'null')?.access_token ?? null
  } catch {
    return null
  }
}

/** False while the session cannot be confirmed (offline with an expired token): requests would go out anonymously. */
export async function hasSession() {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}
