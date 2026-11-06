import type { Issue } from './types'

export type Sort = 'priority' | 'recent'

export const SORTS: { id: Sort; label: string }[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'recent', label: 'Recent' },
]

export const readSort = (saved: unknown): Sort => (saved === 'recent' ? 'recent' : 'priority')

/** Highest priority first; issues without one go last. Ties keep the stored position. */
export const byPriority = (a: Issue, b: Issue) => (a.priority ?? 4) - (b.priority ?? 4) || a.position - b.position

/** Last edit first. By instant: the dates written here and those sent by the server differ in format. */
export const byRecent = (a: Issue, b: Issue) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
