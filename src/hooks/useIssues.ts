import { useCallback, useEffect, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { hasSession, supabase } from '../lib/supabase'
import { doneAtFor, type Issue, type Status } from '../lib/types'
import { between, byPosition } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { readCache, writeCache } from '../lib/cache'
import { enqueue, onReject, overlay, overlayRow } from '../lib/outbox'
import { useRefetchOnFocus } from './useRefetchOnFocus'

const COLUMNS = 'id, project_id, title, body, status, priority, position, created_at, updated_at, done_at'

export function useIssues(projectId: string) {
  const cacheKey = `issues:${projectId}`
  const [issues, setIssues] = useState<Issue[] | null>(() => {
    const cached = readCache<Issue[]>(cacheKey)
    return cached && overlay('issues', cached, (r) => r.project_id === projectId)
  })

  const load = useCallback(async () => {
    const { data, error } = (await hasSession())
      ? await supabase.from('issues').select(COLUMNS).eq('project_id', projectId)
      : { data: null, error: true }
    // Offline: keep the cached state (or show an empty board if there is none).
    if (error || !data) return setIssues((list) => list ?? overlay('issues', [], (r) => r.project_id === projectId))
    setIssues(overlay('issues', data as Issue[], (r) => r.project_id === projectId))
  }, [projectId])

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
    const channel = supabase
      .channel(`issues:${projectId}:${uuid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'issues', filter: `project_id=eq.${projectId}` }, upsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'issues', filter: `project_id=eq.${projectId}` }, upsert)
      // DELETE events cannot be filtered; removing an unknown id is a no-op.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'issues' }, (p) => {
        const id = (p.old as Partial<Issue>).id
        setIssues((list) => list?.filter((x) => x.id !== id) ?? null)
      })
      .subscribe()
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

  /** Change status and put the issue on top of its new column. */
  const setStatus = useCallback(
    (id: string, status: Status) =>
      update(id, { status, position: between(undefined, column(status).find((x) => x.id !== id)?.position) }),
    [update, column],
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
      toast('Issue supprimée', { duration: 10_000, action: { label: 'Annuler', run: () => restore(issue) } })
    },
    [restore],
  )

  return { issues, setIssues, column, add, update, setStatus, remove }
}
