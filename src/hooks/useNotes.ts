import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { hasSession, supabase } from '../lib/supabase'
import type { Issue, Note } from '../lib/types'
import { between } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { readCache, writeCache } from '../lib/cache'
import { enqueue, onReject, overlay, overlayRow } from '../lib/outbox'
import { useRefetchOnFocus } from './useRefetchOnFocus'

const COLUMNS = 'id, body, created_at, updated_at'

/**
 * Issue drafted from a note: the first line, or the first sentence of a dictated paragraph, becomes the title
 * and the rest the notes.
 */
export function issueFromNote(text: string) {
  const t = text.trim()
  const line = t.split('\n', 1)[0]
  const sentence = line.match(/^.+?[.!?](?=\s)/)?.[0] ?? line
  const cut = Math.min(sentence.length, 500)
  return { title: t.slice(0, cut).trim().replace(/\.$/, '') || 'Idea', body: t.slice(cut).trim() }
}

/** Position on top of the project's "To do", from what this device has cached (0 when nothing is). */
function topOfTodo(projectId: string) {
  const known = [...(readCache<Issue[]>(`issues:${projectId}`) ?? []), ...(readCache<Issue[]>('issues:all') ?? [])]
  const positions = overlay('issues', known)
    .filter((x) => x.project_id === projectId && x.status === 'todo')
    .map((x) => x.position)
  return between(undefined, positions.length ? Math.min(...positions) : undefined)
}

/** The user's notes, newest first. */
export function useNotes() {
  const [list, setList] = useState<Note[] | null>(() => {
    const cached = readCache<Note[]>('notes')
    return cached && overlay('notes', cached)
  })

  const load = useCallback(async () => {
    const { data, error } = (await hasSession())
      ? await supabase.from('notes').select(COLUMNS)
      : { data: null, error: true }
    // Offline: keep the cached state.
    if (error || !data) return setList((l) => l ?? overlay('notes', []))
    setList(overlay('notes', data as Note[]))
  }, [])

  useEffect(() => {
    if (list) writeCache('notes', list)
  }, [list])

  useEffect(() => {
    load()
    const upsert = (p: RealtimePostgresChangesPayload<Note>) => {
      const row = overlayRow('notes', p.new as Note)
      setList((l) => {
        if (!l) return l
        if (!row) return l.filter((x) => x.id !== (p.new as Note).id)
        const i = l.findIndex((x) => x.id === row.id)
        if (i < 0) return [...l, row]
        const next = l.slice()
        next[i] = row
        return next
      })
    }
    const channel = supabase
      .channel(`notes:${uuid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, upsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' }, upsert)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, (p) => {
        const id = (p.old as Partial<Note>).id
        setList((l) => l?.filter((x) => x.id !== id) ?? null)
      })
      .subscribe()
    const offReject = onReject(load)
    return () => {
      offReject()
      supabase.removeChannel(channel)
    }
  }, [load])

  useRefetchOnFocus(load)

  const notes = useMemo(() => list && [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)), [list])

  const add = useCallback((body: string) => {
    const now = new Date().toISOString()
    const row: Note = { id: uuid(), body, created_at: now, updated_at: now }
    setList((l) => [...(l ?? []), row])
    enqueue({ table: 'notes', id: row.id, kind: 'upsert', data: { ...row } })
  }, [])

  const update = useCallback((id: string, body: string) => {
    const updated_at = new Date().toISOString()
    setList((l) => l?.map((x) => (x.id === id ? { ...x, body, updated_at } : x)) ?? null)
    enqueue({ table: 'notes', id, kind: 'update', data: { body } })
  }, [])

  const drop = useCallback((id: string) => {
    setList((l) => l?.filter((x) => x.id !== id) ?? null)
    enqueue({ table: 'notes', id, kind: 'delete' })
  }, [])

  const restore = useCallback((note: Note) => {
    setList((l) => (l && !l.some((x) => x.id === note.id) ? [...l, note] : l))
    enqueue({ table: 'notes', id: note.id, kind: 'upsert', data: { ...note } })
  }, [])

  const remove = useCallback(
    (note: Note) => {
      drop(note.id)
      toast('Note deleted', { duration: 10_000, action: { label: 'Undo', run: () => restore(note) } })
    },
    [drop, restore],
  )

  /** Moves the note to the top of the project's "To do" as a new issue; `text` is the note's latest text. */
  const toIssue = useCallback(
    (note: Note, projectId: string, text = note.body) => {
      const now = new Date().toISOString()
      const issue: Issue = {
        id: uuid(),
        project_id: projectId,
        ...issueFromNote(text),
        status: 'todo',
        priority: null,
        position: topOfTodo(projectId),
        created_at: now,
        updated_at: now,
        done_at: null,
      }
      enqueue({ table: 'issues', id: issue.id, kind: 'upsert', data: { ...issue } })
      drop(note.id)
    },
    [drop],
  )

  return { notes, add, update, remove, toIssue }
}
