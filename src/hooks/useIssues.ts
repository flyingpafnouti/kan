import { useCallback, useEffect, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { hasSession, supabase } from '../lib/supabase'
import { doneAtFor, type Issue, type Status } from '../lib/types'
import { between, byPosition } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { readCache, writeCache } from '../lib/cache'
import { enqueue, onReject, overlay, overlayRow } from '../lib/outbox'
import { reloadOnRejoin, useRefetchOnFocus } from './useRefetchOnFocus'

const COLUMNS = 'id, project_id, title, body, status, priority, position, created_at, updated_at, done_at'
const POLL_MS = 30_000

/** Position on top of the project's "To do", from what this device has cached (0 when nothing is). */
export function topOfTodo(projectId: string) {
  const known = [...(readCache<Issue[]>(`issues:${projectId}`) ?? []), ...(readCache<Issue[]>('issues:all') ?? [])]
  const positions = overlay('issues', known)
    .filter((x) => x.project_id === projectId && x.status === 'todo')
    .map((x) => x.position)
  return between(undefined, positions.length ? Math.min(...positions) : undefined)
}

/** Issues of one project, or of all projects when projectId is null. */
export function useIssues(projectId: string | null) {
  const cacheKey = `issues:${projectId ?? 'all'}`
  const belongs = useCallback((r: Record<string, unknown>) => !projectId || r.project_id === projectId, [projectId])
  const [issues, setIssues] = useState<Issue[] | null>(() => {
    const cached = readCache<Issue[]>(cacheKey)
    return cached && overlay('issues', cached, belongs)
  })

  const load = useCallback(async () => {
    const query = supabase.from('issues').select(COLUMNS)
    const { data, error } = (await hasSession())
      ? await (projectId ? query.eq('project_id', projectId) : query)
      : { data: null, error: true }
    // Offline: keep the cached state (or show an empty board if there is none).
    if (error || !data) return setIssues((list) => list ?? overlay('issues', [], belongs))
    setIssues(overlay('issues', data as Issue[], belongs))
  }, [projectId, belongs])

  useEffect(() => {
    if (issues) writeCache(cacheKey, issues)
  }, [cacheKey, issues])

  useEffect(() => {
    load()
    const upsert = (p: RealtimePostgresChangesPayload<Issue>) => {
      const row = overlayRow('issues', p.new as Issue)
      setIssues((list) => {
        if (!list) return list
        if (!row) return list.filter((x) => x.id !== (p.new as Issue).id)
        const i = list.findIndex((x) => x.id === row.id)
        if (i < 0) return [...list, row]
        const next = list.slice()
        next[i] = row
        return next
      })
    }
    const filter = projectId ? { filter: `project_id=eq.${projectId}` } : {}
    const channel = supabase
      .channel(`issues:${projectId ?? 'all'}:${uuid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'issues', ...filter }, upsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'issues', ...filter }, upsert)
      // DELETE events cannot be filtered; removing an unknown id is a no-op.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'issues' }, (p) => {
        const id = (p.old as Partial<Issue>).id
        setIssues((list) => list?.filter((x) => x.id !== id) ?? null)
      })
      .subscribe(reloadOnRejoin(load))
    const offReject = onReject(load)
    return () => {
      offReject()
      supabase.removeChannel(channel)
    }
  }, [projectId, load])

  // Boards stay open for long on a desktop: poll as a fallback when realtime drops without notice.
  useRefetchOnFocus(load, POLL_MS)

  const column = useCallback(
    (status: Status) => (issues ?? []).filter((x) => x.status === status).sort(byPosition),
    [issues],
  )

  const add = useCallback(
    (title: string) => {
      if (!projectId) return
      const now = new Date().toISOString()
      const row: Issue = {
        id: uuid(),
        project_id: projectId,
        title,
        body: '',
        status: 'todo',
        priority: null,
        position: between(undefined, column('todo')[0]?.position),
        created_at: now,
        updated_at: now,
        done_at: null,
      }
      setIssues((list) => [...(list ?? []), row])
      enqueue({ table: 'issues', id: row.id, kind: 'upsert', data: { ...row } })
    },
    [projectId, column],
  )

  const update = useCallback((id: string, patch: Partial<Pick<Issue, 'title' | 'body' | 'status' | 'priority' | 'position'>>) => {
    const updated_at = new Date().toISOString()
    setIssues(
      (list) =>
        list?.map((x) =>
          x.id === id
            ? { ...x, ...patch, updated_at, done_at: patch.status ? doneAtFor(x, patch.status) : x.done_at }
            : x,
        ) ?? null,
    )
    enqueue({ table: 'issues', id, kind: 'update', data: patch })
  }, [])

  /** Change status and put the issue on top of its new column, within its own project. */
  const setStatus = useCallback(
    (id: string, status: Status) => {
      const project = issues?.find((x) => x.id === id)?.project_id
      const top = column(status).find((x) => x.id !== id && x.project_id === project)
      update(id, { status, position: between(undefined, top?.position) })
    },
    [update, column, issues],
  )

  /** New issue on top of `target`'s "To do" with the same title, notes and priority; `text` is the latest text. */
  const copyTo = useCallback(
    (issue: Issue, target: string, text: Pick<Issue, 'title' | 'body'> = issue) => {
      const now = new Date().toISOString()
      const row: Issue = {
        id: uuid(),
        project_id: target,
        ...text,
        status: 'todo',
        priority: issue.priority ?? null,
        position: topOfTodo(target),
        created_at: now,
        updated_at: now,
        done_at: null,
      }
      // Shown here when copied into this same board (or on All issues).
      if (!projectId || projectId === target) setIssues((list) => [...(list ?? []), row])
      enqueue({ table: 'issues', id: row.id, kind: 'upsert', data: { ...row } })
    },
    [projectId],
  )

  /** Put a deleted issue back as it was (same id, position and dates). */
  const restore = useCallback((issue: Issue) => {
    setIssues((list) => (list && !list.some((x) => x.id === issue.id) ? [...list, issue] : list))
    enqueue({ table: 'issues', id: issue.id, kind: 'upsert', data: { ...issue } })
  }, [])

  const remove = useCallback(
    (issue: Issue) => {
      setIssues((list) => list?.filter((x) => x.id !== issue.id) ?? null)
      enqueue({ table: 'issues', id: issue.id, kind: 'delete' })
      toast('Issue deleted', { duration: 10_000, action: { label: 'Undo', run: () => restore(issue) } })
    },
    [restore],
  )

  return { issues, setIssues, column, add, update, setStatus, remove, copyTo }
}
