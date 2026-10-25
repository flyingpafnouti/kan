import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/types'
import { between } from '../lib/position'
import { uuid } from '../lib/id'
import { toast } from '../lib/toast'
import { useRefetchOnFocus } from './useRefetchOnFocus'

export interface ProjectRow extends Project {
  open: number
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const timer = useRef<number>(undefined)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, position, created_at, issues(count)')
      .neq('issues.status', 'done')
      .order('position')
    if (error) return toast('Chargement impossible')
    setProjects(
      data.map(({ issues, ...p }) => ({ ...p, open: (issues as { count: number }[])[0]?.count ?? 0 })),
    )
  }, [])

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
    return () => {
      clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [load])

  useRefetchOnFocus(load)

  const create = useCallback(
    async (name: string) => {
      const list = projects ?? []
      const row: ProjectRow = {
        id: uuid(),
        name,
        position: between(list.at(-1)?.position, undefined),
        created_at: new Date().toISOString(),
        open: 0,
      }
      setProjects([...list, row])
      const { error } = await supabase.from('projects').insert({ id: row.id, name, position: row.position })
      if (error) {
        toast('Création impossible')
        load()
      }
      return row.id
    },
    [projects, load],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, name } : p)) ?? null)
      const { error } = await supabase.from('projects').update({ name }).eq('id', id)
      if (error) {
        toast('Renommage impossible')
        load()
      }
    },
    [load],
  )

  const remove = useCallback(
    async (id: string) => {
      setProjects((ps) => ps?.filter((p) => p.id !== id) ?? null)
      const { error } = await supabase.from('projects').delete().eq('id', id)
      if (error) {
        toast('Suppression impossible')
        load()
      }
    },
    [load],
  )

  return { projects, create, rename, remove }
}

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name, position, created_at')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setProject(data))
  }, [id])
  return project
}
