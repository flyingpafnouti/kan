import { supabase } from './supabase'
import { rememberProject } from './router'
import { clear as clearOutbox, pendingCount } from './outbox'
import { clearCache } from './cache'
import { clearImages } from './images'

export async function signOut() {
  const n = pendingCount()
  if (n && !confirm(`${n} unsynced change(s) will be lost. Sign out?`)) return
  await supabase.auth.signOut()
  clearOutbox()
  clearCache()
  await clearImages()
  rememberProject(null)
}
