import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** KEY=VALUE lines; a missing file reads as empty. */
function readEnvFile(path: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

/** The process environment wins over the files, so another project or account can be used without editing them. */
function config() {
  const app = readEnvFile(new URL('../../.env', import.meta.url).pathname)
  const agentFile = process.env.KAN_AGENT_ENV ?? join(homedir(), '.config/kan-mcp/agent.env')
  const agent = readEnvFile(agentFile)
  const get = (key: string, ...sources: Record<string, string>[]) =>
    process.env[key] ?? sources.find((s) => s[key])?.[key]
  const values = {
    url: get('VITE_SUPABASE_URL', app),
    key: get('VITE_SUPABASE_PUBLISHABLE_KEY', app),
    email: get('KAN_AGENT_EMAIL', agent),
    password: get('KAN_AGENT_PASSWORD', agent),
  }
  const missing = Object.entries(values).filter(([, v]) => !v)
  if (missing.length) {
    throw new Error(
      `Missing ${missing.map(([k]) => k).join(', ')}: Supabase URL and key come from kan/.env, ` +
        `the agent's credentials from ${agentFile} (KAN_AGENT_EMAIL, KAN_AGENT_PASSWORD)`,
    )
  }
  return values as Record<keyof typeof values, string>
}

export interface Session {
  db: SupabaseClient
  userId: string
  /** The agent's pseudo, used to sign what it appends to an issue. */
  name: string
}

/** Signs the agent in. `keepAlive` refreshes the token in the background, which keeps the process running. */
export async function signIn({ keepAlive = true } = {}): Promise<Session> {
  const { url, key, email, password } = config()
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: keepAlive } })
  const { data, error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in of ${email} failed: ${error.message}`)
  const userId = data.user.id
  if (!data.user.app_metadata?.agent) {
    throw new Error(`${email} is not flagged as an agent account: refusing to act with unrestricted rights`)
  }
  const { data: profile } = await db.from('profiles').select('pseudo').eq('user_id', userId).maybeSingle()
  return { db, userId, name: profile?.pseudo ?? 'Claude' }
}
