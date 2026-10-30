export type Status = 'todo' | 'doing' | 'done'

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
]

/** 0 is the most urgent, null means no priority. */
export type Priority = 0 | 1 | 2 | 3

// Full class names so Tailwind picks them up. Dark mode uses translucent bright tints, which stay clean on the
// blue-grey background where the -950 shades turned muddy; P3 is cyan there to stand out from the blue.
export const PRIORITIES: { id: Priority; label: string; card: string; chip: string }[] = [
  {
    id: 0,
    label: 'P0',
    card: 'bg-red-50 ring-red-200 dark:bg-red-400/15 dark:ring-red-400/40',
    chip: 'bg-red-100 text-red-700 ring-red-300 dark:bg-red-400/20 dark:text-red-200 dark:ring-red-400/50',
  },
  {
    id: 1,
    label: 'P1',
    card: 'bg-orange-50 ring-orange-200 dark:bg-orange-400/15 dark:ring-orange-400/40',
    chip: 'bg-orange-100 text-orange-700 ring-orange-300 dark:bg-orange-400/20 dark:text-orange-200 dark:ring-orange-400/50',
  },
  {
    id: 2,
    label: 'P2',
    card: 'bg-amber-50 ring-amber-200 dark:bg-amber-300/12 dark:ring-amber-300/35',
    chip: 'bg-amber-100 text-amber-700 ring-amber-300 dark:bg-amber-300/20 dark:text-amber-200 dark:ring-amber-300/50',
  },
  {
    id: 3,
    label: 'P3',
    card: 'bg-sky-50 ring-sky-200 dark:bg-cyan-300/12 dark:ring-cyan-300/35',
    chip: 'bg-sky-100 text-sky-700 ring-sky-300 dark:bg-cyan-300/20 dark:text-cyan-100 dark:ring-cyan-300/50',
  },
]

export interface Project {
  id: string
  name: string
  position: number
  created_at: string
  /** Last change to the project or its issues. Missing on rows cached before the column existed. */
  updated_at?: string
  /** Secret of the invite link, null until shared. Missing on rows cached before sharing existed. */
  invite_token?: string | null
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
  /** When the issue entered "done". Missing on rows cached before the column existed. */
  done_at?: string | null
}

/** Loose idea, not tied to a project; can become an issue. */
export type NoteKind = 'pro' | 'perso'

export const NOTE_KINDS: { id: NoteKind; label: string }[] = [
  { id: 'pro', label: 'Pro' },
  { id: 'perso', label: 'Perso' },
]

export interface Note {
  id: string
  body: string
  kind: NoteKind
  created_at: string
  updated_at: string
}

/** Done issues leave the "Done" column for its archive drawer after this long. */
const ARCHIVE_AFTER_MS = 7 * 24 * 3600 * 1000

/** done_at after moving `issue` to `status`; mirrors the issues_done_at trigger. */
export const doneAtFor = (issue: Issue, status: Status) =>
  status === 'done' ? (issue.done_at ?? new Date().toISOString()) : null

/** Rows done before done_at existed fall back on their last change. */
export const doneSince = (issue: Issue) => issue.done_at ?? issue.updated_at

export const isArchived = (issue: Issue, now = Date.now()) =>
  issue.status === 'done' && now - Date.parse(doneSince(issue)) > ARCHIVE_AFTER_MS
