import { between, byPosition } from './position'
import type { Issue } from './types'

/**
 * A parent is a real piece of work that its children unblock. Links only inform: they never restrict a status.
 * Two offline edits can still form a cycle, so every walk below keeps track of what it has seen.
 */
export interface IssueIndex {
  byId: Map<string, Issue>
  /** Open issues first, then in board order. */
  children: Map<string, Issue[]>
}

/** What a card tells about its links. */
export interface CardLinks {
  /** Title of the issue this one unblocks. */
  parent?: string
  done: number
  total: number
}

export interface TreeRow {
  issue: Issue
  depth: number
  /** Open with nothing left to wait for: the one to do first. */
  ready: boolean
}

/** A card in a column: under its parent when both share the column, whatever their positions. */
export interface ColumnRow {
  issue: Issue
  /** The parent this card sits under, null at the top level. */
  parent: string | null
  level: number
  /** Indentation, capped: past it a card lines up with its parent. */
  depth: number
}

/** Three levels of cards. */
const MAX_DEPTH = 2

const isDone = (issue: Issue) => issue.status === 'done'

export function indexIssues(issues: Issue[]): IssueIndex {
  const byId = new Map(issues.map((x) => [x.id, x]))
  const children = new Map<string, Issue[]>()
  for (const issue of issues) {
    if (!issue.parent_id || !byId.has(issue.parent_id)) continue
    const siblings = children.get(issue.parent_id)
    if (siblings) siblings.push(issue)
    else children.set(issue.parent_id, [issue])
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || byPosition(a, b))
  }
  return { byId, children }
}

/** Undefined when the card has nothing to add: no links, or a finished issue. */
export function linksOf(issue: Issue, { byId, children }: IssueIndex): CardLinks | undefined {
  if (isDone(issue)) return undefined
  const parent = issue.parent_id ? byId.get(issue.parent_id)?.title : undefined
  const blockers = children.get(issue.id) ?? []
  if (!parent && !blockers.length) return undefined
  return { parent, done: blockers.filter(isDone).length, total: blockers.length }
}

/** Everything `id` waits for, depth first. */
export function dependencyTree(id: string, { children }: IssueIndex): TreeRow[] {
  const rows: TreeRow[] = []
  const seen = new Set([id])
  const walk = (parent: string, depth: number) => {
    for (const issue of children.get(parent) ?? []) {
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      const waiting = (children.get(issue.id) ?? []).some((x) => !isDone(x))
      rows.push({ issue, depth, ready: !isDone(issue) && !waiting })
      walk(issue.id, depth + 1)
    }
  }
  walk(id, 0)
  return rows
}

/** Groups a column displayed in the given order. A parent elsewhere leaves its child at the top level. */
export function nestColumn(issues: Issue[]): ColumnRow[] {
  const here = new Set(issues.map((x) => x.id))
  const underParent = (x: Issue) => x.parent_id && x.parent_id !== x.id && here.has(x.parent_id)
  const children = new Map<string, Issue[]>()
  for (const issue of issues) {
    if (!underParent(issue)) continue
    const siblings = children.get(issue.parent_id!)
    if (siblings) siblings.push(issue)
    else children.set(issue.parent_id!, [issue])
  }
  const rows: ColumnRow[] = []
  const seen = new Set<string>()
  const walk = (issue: Issue, parent: string | null, level: number) => {
    if (seen.has(issue.id)) return
    seen.add(issue.id)
    rows.push({ issue, parent, level, depth: Math.min(level, MAX_DEPTH) })
    for (const child of children.get(issue.id) ?? []) walk(child, issue.id, level + 1)
  }
  for (const issue of issues) if (!underParent(issue)) walk(issue, null, 0)
  // Only a cycle has no top: it starts at its first issue.
  for (const issue of issues) walk(issue, null, 0)
  return rows
}

/** The column in its displayed order. */
export const nestedOrder = (issues: Issue[]) => nestColumn(issues).map((row) => row.issue)

/** Issues `id` can be reordered against in this column: the rest of its group, or the other top-level issues. */
export function siblingsIn(column: Issue[], id: string) {
  const rows = nestColumn(column)
  const parent = rows.find((row) => row.issue.id === id)?.parent
  return rows.filter((row) => row.parent === parent).map((row) => row.issue)
}

/**
 * Position of `issue` once dropped at index `to` of a displayed column. Only its siblings count, so a group follows
 * its parent and a child dropped elsewhere goes back under its own.
 */
export function positionAt(column: Issue[], issue: Issue, to: number) {
  const others = column.filter((x) => x.id !== issue.id)
  const order = siblingsIn([...others.slice(0, to), issue, ...others.slice(to)], issue.id)
  const i = order.findIndex((x) => x.id === issue.id)
  if (column.some((x) => x.id === issue.id)) {
    const before = siblingsIn(column, issue.id)
    if (before[before.findIndex((x) => x.id === issue.id) - 1]?.id === order[i - 1]?.id) return issue.position
  }
  return between(order[i - 1]?.position, order[i + 1]?.position)
}

function ancestors(issue: Issue, { byId }: IssueIndex) {
  const seen = new Set<string>()
  for (let at = issue.parent_id; at && !seen.has(at); at = byId.get(at)?.parent_id) seen.add(at)
  return seen
}

/** Issues that can become a blocker of `issue`. One already blocking something has to be unlinked there first. */
export function blockerCandidates(issue: Issue, index: IssueIndex) {
  const above = ancestors(issue, index)
  return [...index.byId.values()].filter(
    (x) => x.project_id === issue.project_id && !isDone(x) && !x.parent_id && x.id !== issue.id && !above.has(x.id),
  )
}

/** Issues `issue` can unblock. */
export function parentCandidates(issue: Issue, index: IssueIndex) {
  const below = new Set(dependencyTree(issue.id, index).map((row) => row.issue.id))
  return [...index.byId.values()].filter(
    (x) => x.project_id === issue.project_id && !isDone(x) && x.id !== issue.id && !below.has(x.id),
  )
}
