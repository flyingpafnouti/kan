import { storedAccessToken } from './supabase'

const TOTP_LIFETIME_S = 90 * 24 * 3600

interface Claims {
  app_metadata?: { mfa_required?: boolean }
  amr?: ({ method: string; timestamp: number } | string)[]
}

function claims(token: string): Claims | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

/**
 * True when a flagged account has no TOTP code of less than 90 days. Read synchronously from the token the server
 * judges by, so nothing can load before the gate shows: the policies would answer with empty lists and ignored writes.
 */
export function mfaPending() {
  const token = storedAccessToken()
  const jwt = token && claims(token)
  if (!jwt || !jwt.app_metadata?.mfa_required) return false
  const verified = jwt.amr?.some(
    (e) => typeof e === 'object' && e.method === 'totp' && Date.now() / 1000 - e.timestamp < TOTP_LIFETIME_S,
  )
  return !verified
}
