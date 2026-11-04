import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { hasSession, storedUserId, supabase } from '../lib/supabase'
import { doneAtFor, type Issue, type Status } from '../lib/types'
import { between, byPosition } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { readCache, writeCache } from '../lib/cache'
import { enqueue, onReject, overlay, overlayRow } from '../lib/outbox'
import { reloadOnRejoin, useRefetchOnFocus } from './useRefetchOnFocus'

const COLUMNS = 'id, project_id, title, body, status, priority, position, created_at, updated_at, updated_by, done_at, parent_id'

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
  // For the undo callbacks, which outlive the render that created them.
  const current = useRef(issues)
  current.current = issues

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

  useRefetchOnFocus(load)

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

  /** New issue on top of the project's "To do", which `parent` then waits for. Works on All issues, unlike add. */
  const addBlocker = useCallback((parent: Issue, title: string) => {
    const now = new Date().toISOString()
    const row: Issue = {
      id: uuid(),
      project_id: parent.project_id,
      title,
      body: '',
      status: 'todo',
      priority: null,
      position: topOfTodo(parent.project_id),
      created_at: now,
      updated_at: now,
      done_at: null,
      parent_id: parent.id,
    }
    setIssues((list) => [...(list ?? []), row])
    enqueue({ table: 'issues', id: row.id, kind: 'upsert', data: { ...row } })
  }, [])

  const update = useCallback((id: string, patch: Partial<Pick<Issue, 'title' | 'body' | 'status' | 'priority' | 'position' | 'parent_id'>>) => {
    const updated_at = new Date().toISOString()
    setIssues(
      (list) =>
        list?.map((x) =>
          x.id === id
            ? { ...x, ...patch, updated_at, updated_by: storedUserId(), done_at: patch.status ? doneAtFor(x, patch.status) : x.done_at }
            : x,
        ) ?? null,
    )
    enqueue({ table: 'issues', id, kind: 'update', data: patch })
  }, [])

  /** To call when `id` has just entered "done": says so if that was the last issue its parent waited for. */
  const announceUnblocked = useCallback((id: string) => {
    const list = current.current ?? []
    const parentId = list.find((x) => x.id === id)?.parent_id
    const parent = parentId ? list.find((x) => x.id === parentId) : undefined
    if (!parent || parent.status === 'done') return
    if (list.some((x) => x.parent_id === parent.id && x.id !== id && x.status !== 'done')) return
    toast(`${parent.title} is unblocked`)
  }, [])

  /** Change status and put the issue on top of its new column, within its own project. */
  const setStatus = useCallback(
    (id: string, status: Status) => {
      const issue = issues?.find((x) => x.id === id)
      const top = column(status).find((x) => x.id !== id && x.project_id === issue?.project_id)
      update(id, { status, position: between(undefined, top?.position) })
      if (status === 'done' && issue?.status !== 'done') announceUnblocked(id)
    },
    [update, column, issues, announceUnblocked],
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

  /** Put a deleted issue back as it was (same id, position and dates), unless its parent is gone: the server would refuse it. */
  const restore = useCallback((issue: Issue) => {
    const orphan = issue.parent_id && !current.current?.some((x) => x.id === issue.parent_id)
    const row = orphan ? { ...issue, parent_id: null } : issue
    setIssues((list) => (list && !list.some((x) => x.id === row.id) ? [...list, row] : list))
    enqueue({ table: 'issues', id: row.id, kind: 'upsert', data: { ...row } })
  }, [])

  const remove = useCallback(
    (issue: Issue) => {
      // The foreign key unlinks them on the server: mirrored here, and undone with the deletion.
      const blockers = (current.current ?? []).filter((x) => x.parent_id === issue.id).map((x) => x.id)
      setIssues(
        (list) =>
          list?.filter((x) => x.id !== issue.id).map((x) => (x.parent_id === issue.id ? { ...x, parent_id: null } : x)) ?? null,
      )
      enqueue({ table: 'issues', id: issue.id, kind: 'delete' })
      toast('Issue deleted', {
        duration: 10_000,
        action: {
          label: 'Undo',
          run: () => {
            restore(issue)
            blockers.forEach((id) => update(id, { parent_id: issue.id }))
          },
        },
      })
    },
    [restore, update],
  )

  return { issues, setIssues, column, add, addBlocker, update, setStatus, announceUnblocked, remove, copyTo }
}
