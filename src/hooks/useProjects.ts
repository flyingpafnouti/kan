import { useCallback, useEffect, useRef, useState } from 'react'
import { hasSession, supabase } from '../lib/supabase'
import type { Issue, Project } from '../lib/types'
import { between } from '../lib/position'
import { uuid } from '../lib/id'
import { readCache, removeCache, writeCache } from '../lib/cache'
import { discard, enqueue, onReject, overlay, pendingCount } from '../lib/outbox'
import { toast } from '../lib/toast'
import { href } from '../lib/router'
import { reloadOnRejoin, useRefetchOnFocus } from './useRefetchOnFocus'

export interface ProjectRow extends Project {
  open: number
  /** More than one means the project is shared. */
  members: number
}

/** Rows cached before counts or sharing existed lack these fields. */
const withDefaults = (p: Project & Partial<ProjectRow>): ProjectRow => ({ ...p, open: p.open ?? 0, members: p.members ?? 1 })

/** Open issues and last issue change known locally, when this device has the project's issues cached. */
function localState(projectId: string) {
  const issues = readCache<Issue[]>(`issues:${projectId}`)
  if (!issues) return null
  const open = issues.filter((x) => x.status !== 'done').length
  const updated = issues.reduce<string | undefined>((m, x) => (!m || x.updated_at > m ? x.updated_at : m), undefined)
  return { open, updated }
}

function withLocalCounts(rows: ProjectRow[]): ProjectRow[] {
  return rows.map((p) => {
    const local = localState(p.id)
    if (!local) return p
    const updated_at = local.updated && (!p.updated_at || local.updated > p.updated_at) ? local.updated : p.updated_at
    return { ...p, open: local.open, updated_at }
  })
}

/** Most recently changed first; rows cached before updated_at existed fall back on their creation. */
export const byLastChange = (a: Project, b: Project) =>
  (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at)

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(() => {
    const cached = readCache<ProjectRow[]>('projects')
    return cached && withLocalCounts(overlay('projects', cached).map(withDefaults))
  })
  const timer = useRef<number>(undefined)

  const load = useCallback(async () => {
    if (!(await hasSession())) return setProjects((ps) => ps ?? [])
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, position, created_at, updated_at, invite_token, issues(count), project_members(count)')
      .neq('issues.status', 'done')
      .order('position')
    if (error) return setProjects((ps) => ps ?? [])
    const count = (x: unknown) => (x as { count: number }[])[0]?.count
    const rows = data.map(({ issues, project_members, ...p }) => ({
      ...p,
      open: count(issues) ?? 0,
      members: count(project_members) ?? 1,
    }))
    const merged = overlay('projects', rows).map(withDefaults)
    // Server counts are fresher, unless local edits are still waiting to be sent.
    setProjects(pendingCount() ? withLocalCounts(merged) : merged)
  }, [])

  useEffect(() => {
    if (projects) writeCache('projects', projects)
  }, [projects])

  useEffect(() => {
    load()
    // Any change to projects or members may alter names or counts: debounce a full reload. Issue changes need no
    // subscription of their own, since each one bumps its project's updated_at (issues_touch_project trigger).
    const reload = () => {
      clearTimeout(timer.current)
      timer.current = window.setTimeout(load, 300)
    }
    const channel = supabase
      .channel(`projects:${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, reload)
      .subscribe(reloadOnRejoin(load))
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
      setProjects([...list, { ...row, open: 0, members: 1 }])
      enqueue({ table: 'projects', id: row.id, kind: 'upsert', data: row })
      return row.id
    },
    [projects],
  )

  const rename = useCallback((id: string, name: string) => {
    // The server bumps updated_at on rename; mirror it so the list reorders at once.
    const updated_at = new Date().toISOString()
    setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, name, updated_at } : p)) ?? null)
    enqueue({ table: 'projects', id, kind: 'update', data: { name } })
  }, [])

  /** Drop a project from this device, once deleted or left. */
  const forget = useCallback((id: string) => {
    setProjects((ps) => ps?.filter((p) => p.id !== id) ?? null)
    // Issue writes for this project would fail once it is gone (the delete cascades on the server).
    discard((op) => op.table === 'issues' && op.data?.project_id === id)
    removeCache(`issues:${id}`)
  }, [])

  const remove = useCallback(
    (id: string) => {
      forget(id)
      enqueue({ table: 'projects', id, kind: 'delete' })
    },
    [forget],
  )

  /** Leaving needs the network: the project stays until the server confirms. */
  const leave = useCallback(
    async (id: string) => {
      const { error } = await supabase.rpc('leave_project', { pid: id })
      if (error) return toast('Could not leave the project')
      forget(id)
    },
    [forget],
  )

  /** Invite link of a project, made on first use; `reset` replaces it so older links stop working. */
  const inviteLink = useCallback(
    async (id: string, reset = false) => {
      let token = reset ? null : projects?.find((p) => p.id === id)?.invite_token
      if (!token) {
        const next = uuid()
        const { data, error } = await supabase.from('projects').update({ invite_token: next }).eq('id', id).select('id')
        // No row back: the project was created offline and has not reached the server yet.
        if (error || !data.length) return null
        token = next
        setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, invite_token: next } : p)) ?? null)
      }
      return `${location.origin}${location.pathname}${href({ name: 'join', token })}`
    },
    [projects],
  )

  return { projects, create, rename, remove, leave, inviteLink }
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
        if (!cached.some((p) => p.id === data.id)) writeCache('projects', [...cached, { ...data, open: 0, members: 1 }])
      }
      // A project created offline is not on the server yet.
      setProject(data ? (overlay('projects', [data])[0] ?? null) : (local() ?? null))
    })()
  }, [id])
  return project
}

const LIST_COLUMNS = 'id, name, position, created_at'

/**
 * Names and order of the projects, without the counts of useProjects: the cached list, fetched on mount and when
 * the app comes back, and kept current from realtime rows in between. useProjects reloads everything on each issue change, which pages
 * that only show project names do not need.
 */
export function useProjectList() {
  const [list, setList] = useState<Project[] | null>(() => {
    const cached = readCache<Project[]>('projects')
    return cached && overlay('projects', cached)
  })
  const load = useCallback(async () => {
    if (!(await hasSession())) return
    const { data, error } = await supabase.from('projects').select(LIST_COLUMNS).order('position')
    if (!error) setList(overlay('projects', data))
  }, [])

  useEffect(() => {
    load()
    // Each issue change bumps its project's updated_at, so events are frequent: apply them without a query.
    const channel = supabase
      .channel(`project-list:${uuid()}`)
      .on<Project>('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (p) => {
        if (p.eventType === 'DELETE') return setList((ps) => ps?.filter((x) => x.id !== p.old.id) ?? null)
        const { id, name, position, created_at } = p.new
        setList((ps) =>
          [...(ps ?? []).filter((x) => x.id !== id), { id, name, position, created_at }].sort((a, b) => a.position - b.position),
        )
      })
      .subscribe(reloadOnRejoin(load))
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  useRefetchOnFocus(load)

  return list
}
