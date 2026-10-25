import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Issue, Status } from '../lib/types'
import { between, byPosition } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { useRefetchOnFocus } from './useRefetchOnFocus'

const COLUMNS = 'id, project_id, title, body, status, position, created_at, updated_at'

export function useIssues(projectId: string) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  // Inserts not yet confirmed by the server, kept when a reload response would drop them.
  const pending = useRef(new Set<string>())

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('issues').select(COLUMNS).eq('project_id', projectId)
    if (error) return toast('Chargement impossible')
    const server = data as Issue[]
    setIssues((list) => {
      const ids = new Set(server.map((x) => x.id))
      return [...server, ...(list ?? []).filter((x) => pending.current.has(x.id) && !ids.has(x.id))]
    })
  }, [projectId])

  useEffect(() => {
    setIssues(null)
    load()
    const upsert = (p: RealtimePostgresChangesPayload<Issue>) => {
      const row = p.new as Issue
      setIssues((list) => {
        if (!list) return list
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
    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId, load])

  useRefetchOnFocus(load)

  const fail = useCallback(
    (msg: string) => {
      toast(msg)
      load()
    },
    [load],
  )

  const column = useCallback(
    (status: Status) => (issues ?? []).filter((x) => x.status === status).sort(byPosition),
    [issues],
  )

  const add = useCallback(
    async (title: string) => {
      const now = new Date().toISOString()
      const row: Issue = {
        id: uuid(),
        project_id: projectId,
        title,
        body: '',
        status: 'todo',
        position: between(undefined, column('todo')[0]?.position),
        created_at: now,
        updated_at: now,
      }
      setIssues((list) => [...(list ?? []), row])
      pending.current.add(row.id)
      const { error } = await supabase
        .from('issues')
        .insert({ id: row.id, project_id: projectId, title, status: row.status, position: row.position })
      pending.current.delete(row.id)
      if (error) fail('Création impossible')
    },
    [projectId, column, fail],
  )

  const update = useCallback(
    async (id: string, patch: Partial<Pick<Issue, 'title' | 'body' | 'status' | 'position'>>) => {
      const updated_at = new Date().toISOString()
      setIssues((list) => list?.map((x) => (x.id === id ? { ...x, ...patch, updated_at } : x)) ?? null)
      const { error } = await supabase.from('issues').update(patch).eq('id', id)
      if (error) fail('Enregistrement impossible')
    },
    [fail],
  )

  /** Change status and put the issue on top of its new column. */
  const setStatus = useCallback(
    (id: string, status: Status) =>
      update(id, { status, position: between(undefined, column(status).find((x) => x.id !== id)?.position) }),
    [update, column],
  )

  /** Re-insert a deleted issue as it was (same id, position and dates). */
  const restore = useCallback(
    async (issue: Issue) => {
      setIssues((list) => (list && !list.some((x) => x.id === issue.id) ? [...list, issue] : list))
      pending.current.add(issue.id)
      const { project_id, title, body, status, position, created_at, updated_at } = issue
      const { error } = await supabase
        .from('issues')
        .insert({ id: issue.id, project_id, title, body, status, position, created_at, updated_at })
      pending.current.delete(issue.id)
      if (error) fail('Restauration impossible')
    },
    [fail],
  )

  const remove = useCallback(
    (issue: Issue) => {
      setIssues((list) => list?.filter((x) => x.id !== issue.id) ?? null)
      const deleted = supabase
        .from('issues')
        .delete()
        .eq('id', issue.id)
        .then(({ error }) => {
          if (error) fail('Suppression impossible')
          return !error
        })
      toast('Issue supprimée', {
        duration: 10_000,
        // Wait for the delete to land so the re-insert cannot hit a duplicate key.
        action: { label: 'Annuler', run: () => void deleted.then((ok) => { if (ok) restore(issue) }) },
      })
    },
    [fail, restore],
  )

  return { issues, setIssues, column, add, update, setStatus, remove }
}
