import { mfaPending } from './mfa'
import { hasSession, supabase } from './supabase'
import { toast } from './toast'

/**
 * Persistent queue of writes. Every mutation is applied locally first, queued here, and sent in order
 * when the network allows. Operations are idempotent (upsert by id, update, delete) so a request that
 * reached the server but whose response was lost can safely be replayed.
 */

export type Table = 'projects' | 'issues' | 'notes'
type Row = Record<string, unknown>

export interface Op {
  table: Table
  id: string
  kind: 'upsert' | 'update' | 'delete'
  data?: Row
}

const KEY = 'outbox-v1'
const RETRY_MS = 15_000

let ops: Op[] = read()
let inflight: Op | null = null
let retryTimer: number | undefined
const listeners = new Set<() => void>()
const rejectListeners = new Set<() => void>()

function read(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops))
  } catch {
    /* storage unavailable: queue lives in memory only */
  }
  listeners.forEach((l) => l())
}

const same = (a: Op, table: Table, id: string) => a.table === table && a.id === id

export function enqueue(op: Op) {
  // Merge with ops still waiting for the same row; never touch the one being sent.
  const waiting = ops.filter((o) => o !== inflight && same(o, op.table, op.id))
  if (op.kind === 'update') {
    const target = waiting.find((o) => o.kind !== 'delete')
    if (target) target.data = { ...target.data, ...op.data }
    else if (!waiting.some((o) => o.kind === 'delete')) ops.push(op)
  } else {
    // upsert or delete supersedes anything queued before it for this row
    ops = ops.filter((o) => !waiting.includes(o))
    ops.push(op)
  }
  save()
  flush()
}

/** Drop queued ops matching a predicate (e.g. issues of a project being deleted). */
export function discard(pred: (op: Op) => boolean) {
  ops = ops.filter((o) => o === inflight || !pred(o))
  save()
}

export function clear() {
  ops = []
  save()
}

export const pendingCount = () => ops.length

export function onChange(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Called when the server refused an op, so local state should be reloaded. */
export function onReject(l: () => void) {
  rejectListeners.add(l)
  return () => void rejectListeners.delete(l)
}

/** Apply queued ops on top of rows coming from the server. */
export function overlay<T extends { id: string }>(table: Table, rows: T[], belongs: (r: Row) => boolean = () => true): T[] {
  let out = rows.slice()
  for (const op of ops) {
    if (op.table !== table) continue
    const i = out.findIndex((r) => r.id === op.id)
    if (op.kind === 'delete') {
      if (i >= 0) out.splice(i, 1)
    } else if (i >= 0) {
      out[i] = { ...out[i], ...op.data }
    } else if (op.kind === 'upsert' && belongs(op.data!)) {
      out = [...out, op.data as T]
    }
  }
  return out
}

/** Same as overlay for a single row from a realtime event; null when it is deleted locally. */
export function overlayRow<T extends { id: string }>(table: Table, row: T): T | null {
  return overlay(table, [row])[0] ?? null
}

function run(op: Op) {
  const q = supabase.from(op.table)
  if (op.kind === 'upsert') return q.upsert(op.data!)
  if (op.kind === 'update') return q.update(op.data!).eq('id', op.id)
  return q.delete().eq('id', op.id)
}

// Network failure (status 0), expired session (401) and server errors (5xx) are retried later;
// any other error means the server will never accept this op.
const retryable = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500

export async function flush() {
  if (inflight || !ops.length) return
  clearTimeout(retryTimer)
  // While a code is due the policies ignore updates without an error, which would lose them: wait for the verification.
  while (ops.length && !mfaPending()) {
    const op = (inflight = ops[0])
    const { error, status } = (await hasSession()) ? await run(op) : { error: true, status: 0 }
    inflight = null
    if (error && retryable(status)) {
      retryTimer = window.setTimeout(flush, RETRY_MS)
      return
    }
    ops = ops.filter((o) => o !== op)
    save()
    if (error) {
      toast('A change was rejected by the server')
      rejectListeners.forEach((l) => l())
    }
  }
}

addEventListener('online', () => flush())
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush())
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED') flush()
})
