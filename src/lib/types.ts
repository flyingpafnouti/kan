export type Status = 'todo' | 'doing' | 'done'

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Fait' },
]

/** 0 is the most urgent, null means no priority. */
export type Priority = 0 | 1 | 2 | 3

// Full class names so Tailwind picks them up.
export const PRIORITIES: { id: Priority; label: string; card: string; chip: string }[] = [
  {
    id: 0,
    label: 'P0',
    card: 'bg-red-50 ring-red-200 dark:bg-red-950/40 dark:ring-red-900/60',
    chip: 'bg-red-100 text-red-700 ring-red-300 dark:bg-red-900/50 dark:text-red-300 dark:ring-red-800',
  },
  {
    id: 1,
    label: 'P1',
    card: 'bg-orange-50 ring-orange-200 dark:bg-orange-950/40 dark:ring-orange-900/60',
    chip: 'bg-orange-100 text-orange-700 ring-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:ring-orange-800',
  },
  {
    id: 2,
    label: 'P2',
    card: 'bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900/50',
    chip: 'bg-amber-100 text-amber-700 ring-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:ring-amber-800',
  },
  {
    id: 3,
    label: 'P3',
    card: 'bg-sky-50 ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-900/60',
    chip: 'bg-sky-100 text-sky-700 ring-sky-300 dark:bg-sky-900/50 dark:text-sky-300 dark:ring-sky-800',
  },
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
  /** Missing on rows cached before priorities existed. */
  priority?: Priority | null
  position: number
  created_at: string
  updated_at: string
}
