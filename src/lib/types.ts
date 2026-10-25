export type Status = 'todo' | 'doing' | 'done'

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Fait' },
]

export interface Project {
  id: string
  name: string
  position: number
  created_at: string
}

export interface Issue {
  id: string
  project_id: string
  title: string
  body: string
  status: Status
  position: number
  created_at: string
  updated_at: string
}
