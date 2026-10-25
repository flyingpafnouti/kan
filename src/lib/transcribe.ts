import { supabase } from './supabase'

const KEY_FIELD = 'groq_api_key'

export class MissingKeyError extends Error {}

/** The Groq key lives in the account's user_metadata, so it follows the user on every device. */
export async function getGroqKey() {
  const { data } = await supabase.auth.getSession()
  return (data.session?.user.user_metadata?.[KEY_FIELD] as string | undefined) || null
}

export async function setGroqKey(key: string | null) {
  const { error } = await supabase.auth.updateUser({ data: { [KEY_FIELD]: key } })
  if (error) throw error
}

const extensions: Record<string, string> = { webm: 'webm', ogg: 'ogg', mp4: 'm4a', mpeg: 'mp3', wav: 'wav' }

/** Groq picks the decoder from the file name, so the extension must match the recorder's container. */
function fileName(type: string) {
  const sub = type.split(';')[0].split('/')[1] ?? ''
  return `audio.${extensions[sub] ?? 'webm'}`
}

export async function transcribe(audio: Blob) {
  const key = await getGroqKey()
  if (!key) throw new MissingKeyError()
  const form = new FormData()
  form.append('file', audio, fileName(audio.type))
  form.append('model', 'whisper-large-v3')
  form.append('language', 'fr')
  form.append('temperature', '0')
  form.append('response_format', 'json')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  if (res.status === 401) throw new MissingKeyError()
  if (!res.ok) throw new Error(`Groq ${res.status}`)
  const { text } = (await res.json()) as { text: string }
  return text.trim()
}
