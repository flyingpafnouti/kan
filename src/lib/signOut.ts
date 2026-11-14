import { supabase } from './supabase'
import { rememberProject } from './router'
import { clear as clearOutbox, pendingCount } from './outbox'
import { clearCache } from './cache'
import { dropVectors } from './desktopSearch'
import { clearImages } from './images'

export async function signOut() {
  const n = pendingCount()
  if (n && !confirm(`${n} unsynced change(s) will be lost. Sign out?`)) return
  // The default scope revokes every session of the account, on all devices.
  await supabase.auth.signOut({ scope: 'local' })
  clearOutbox()
  clearCache()
  await clearImages()
  await dropVectors()
  rememberProject(null)
}
