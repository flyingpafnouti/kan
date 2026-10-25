import { useCallback, useEffect, useRef, useState } from 'react'
import { hasSession, supabase } from '../lib/supabase'
import type { Issue, Project } from '../lib/types'
import { between } from '../lib/position'
import { uuid } from '../lib/id'
import { readCache, removeCache, writeCache } from '../lib/cache'
import { discard, enqueue, onReject, overlay, pendingCount } from '../lib/outbox'
import { useRefetchOnFocus } from './useRefetchOnFocus'

export interface ProjectRow extends Project {
  open: number
}

/** Open issues known locally, when this device has the project's issues cached. */
function localOpenCount(projectId: string): number | undefined {
  const issues = readCache<Issue[]>(`issues:${projectId}`)
  return issues?.filter((x) => x.status !== 'done').length
}

function withLocalCounts(rows: ProjectRow[]): ProjectRow[] {
  return rows.map((p) => ({ ...p, open: localOpenCount(p.id) ?? p.open }))
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(() => {
    const cached = readCache<ProjectRow[]>('projects')
    return cached && withLocalCounts(overlay('projects', cached).map((p) => ({ ...p, open: p.open ?? 0 })))
  })
  const timer = useRef<number>(undefined)

  const load = useCallback(async () => {
    if (!(await hasSession())) return setProjects((ps) => ps ?? [])
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, position, created_at, issues(count)')
      .neq('issues.status', 'done')
      .order('position')
    if (error) return setProjects((ps) => ps ?? [])
    const rows = data.map(({ issues, ...p }) => ({ ...p, open: (issues as { count: number }[])[0]?.count ?? 0 }))
    const merged = overlay('projects', rows).map((p) => ({ ...p, open: p.open ?? 0 }))
    // Server counts are fresher, unless local edits are still waiting to be sent.
    setProjects(pendingCount() ? withLocalCounts(merged) : merged)
  }, [])

  useEffect(() => {
    if (projects) writeCache('projects', projects)
  }, [projects])

  useEffect(() => {
    load()
    // Any change to projects or issues may alter names or open counts: debounce a full reload.
    const reload = () => {
      clearTimeout(timer.current)
      timer.current = window.setTimeout(load, 300)
    }
    const channel = supabase
      .channel(`projects:${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, reload)
      .subscribe()
    const offReject = onReject(load)
    return () => {
      clearTimeout(timer.current)
      offReject()
      supabase.removeChannel(channel)
    }
  }, [load])

  useRefetchOnFocus(load)

  const create = useCallback(
    (name: string) => {
      const list = projects ?? []
      const row = { id: uuid(), name, position: between(list.at(-1)?.position, undefined), created_at: new Date().toISOString() }
      setProjects([...list, { ...row, open: 0 }])
      enqueue({ table: 'projects', id: row.id, kind: 'upsert', data: row })
      return row.id
    },
    [projects],
  )

  const rename = useCallback((id: string, name: string) => {
    setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, name } : p)) ?? null)
    enqueue({ table: 'projects', id, kind: 'update', data: { name } })
  }, [])

  const remove = useCallback((id: string) => {
    setProjects((ps) => ps?.filter((p) => p.id !== id) ?? null)
    // Issue writes for this project would fail once it is gone (the delete cascades on the server).
    discard((op) => op.table === 'issues' && op.data?.project_id === id)
    removeCache(`issues:${id}`)
    enqueue({ table: 'projects', id, kind: 'delete' })
  }, [])

  return { projects, create, rename, remove }
}

/** Project header info: cached or pending locally first, then confirmed by the server. */
export function useProject(id: string) {
  const local = () => overlay('projects', readCache<Project[]>('projects') ?? []).find((p) => p.id === id)
  const [project, setProject] = useState<Project | null | undefined>(local)
  useEffect(() => {
    ;(async () => {
      if (!(await hasSession())) return // offline: keep what we have
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, position, created_at')
        .eq('id', id)
        .maybeSingle()
      if (error) return
      if (data) {
        // Remember it so the header still shows its name offline.
        const cached = readCache<ProjectRow[]>('projects') ?? []
        if (!cached.some((p) => p.id === data.id)) writeCache('projects', [...cached, { ...data, open: 0 }])
      }
      // A project created offline is not on the server yet.
      setProject(data ? (overlay('projects', [data])[0] ?? null) : (local() ?? null))
    })()
  }, [id])
  return project
}
