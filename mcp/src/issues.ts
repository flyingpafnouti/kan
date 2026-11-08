import type { PostgrestError } from '@supabase/supabase-js'
import type { Session } from './client'
import type { Issue, Priority, Project, Status } from '../../src/lib/types'
import { between } from '../../src/lib/position'

/** A failure to report to the agent as is, as opposed to a bug. */
export class UserError extends Error {}

// Same columns as the app (src/hooks/useIssues.ts).
const COLUMNS = 'id, project_id, title, body, status, priority, position, created_at, updated_at, updated_by, done_at, parent_id'

const STATUS_ORDER: Record<Status, number> = { todo: 0, doing: 1, done: 2 }

function explain(error: PostgrestError) {
  // 42501: row-level security, here mostly the restrictions of migration 013 on agent accounts.
  if (error.code === '42501') return `Forbidden for the agent account (${error.message})`
  return error.message
}

function check<T>({ data, error }: { data: T | null; error: PostgrestError | null }): T {
  if (error) throw new UserError(explain(error))
  return data as T
}

export const shortId = (id: string) => id.slice(0, 8)

// ---------- Projects

export async function listProjects({ db }: Session): Promise<Project[]> {
  return check(
    await db.from('projects').select('id, name, position, created_at, updated_at').order('updated_at', { ascending: false }),
  )
}

/** By name (case-insensitive), id or id prefix. */
export async function resolveProject(session: Session, ref: string): Promise<Project> {
  const projects = await listProjects(session)
  const r = ref.trim().toLowerCase()
  const exact = projects.filter((p) => p.id === r || p.name.trim().toLowerCase() === r)
  if (exact.length === 1) return exact[0]
  const prefix = r.length >= 4 ? projects.filter((p) => p.id.startsWith(r)) : []
  if (!exact.length && prefix.length === 1) return prefix[0]
  const names = projects.map((p) => `"${p.name}"`).join(', ')
  if (exact.length > 1) throw new UserError(`Several projects are named "${ref}": use the id (list_projects)`)
  throw new UserError(`No project "${ref}". Joined projects: ${names || 'none yet (npm run join -- <invite link>)'}`)
}

// ---------- Issues

/** Bounds of the uuids starting with `ref` (dashes optional, 6 hex characters at least). */
export function idRange(ref: string): [string, string] | null {
  const hex = ref.trim().toLowerCase().replace(/^#/, '').replaceAll('-', '')
  if (!/^[0-9a-f]{6,32}$/.test(hex)) return null
  const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  return [uuid(hex.padEnd(32, '0')), uuid(hex.padEnd(32, 'f'))]
}

/** By full id or prefix, among the issues the agent can see. Postgres orders uuids by their bytes, as the hex text. */
export async function resolveIssue({ db }: Session, ref: string): Promise<Issue> {
  const range = idRange(ref)
  if (!range) throw new UserError(`"${ref}" is not an issue id: give at least 6 hex characters, e.g. the 8 of #a1b2c3d4`)
  const rows = check(await db.from('issues').select(COLUMNS).gte('id', range[0]).lte('id', range[1]).limit(2)) as Issue[]
  if (!rows.length) throw new UserError(`No issue #${ref} in the projects the agent has joined`)
  if (rows.length > 1) throw new UserError(`#${ref} matches several issues: give more characters`)
  return rows[0]
}

/** Position on top of a column, as the app does (topOfTodo), from the server instead of a cache. */
async function topOf({ db }: Session, projectId: string, status: Status, except?: string) {
  let query = db.from('issues').select('position').eq('project_id', projectId).eq('status', status)
  if (except) query = query.neq('id', except)
  const rows = check(await query.order('position').limit(1)) as { position: number }[]
  return between(undefined, rows[0]?.position)
}

type Brief = Pick<Issue, 'id' | 'title' | 'status' | 'priority' | 'position' | 'parent_id' | 'updated_at'>

export interface ListedIssue extends Brief {
  /** Its children not done yet: the issues it waits for. */
  openBlockers: number
}

async function projectIssues({ db }: Session, projectId: string): Promise<Brief[]> {
  return check(
    await db.from('issues').select('id, title, status, priority, position, parent_id, updated_at').eq('project_id', projectId),
  ) as Brief[]
}

export interface ListFilter {
  status?: Status
  priority?: Priority | null
  updatedSince?: string
}

/** Without a status, done issues are left out and only counted. */
export async function listIssues(session: Session, projectRef: string, filter: ListFilter) {
  const project = await resolveProject(session, projectRef)
  const all = await projectIssues(session, project.id)
  const open = new Map<string, number>()
  for (const x of all) if (x.parent_id && x.status !== 'done') open.set(x.parent_id, (open.get(x.parent_id) ?? 0) + 1)
  let since: number | undefined
  if (filter.updatedSince !== undefined) {
    since = Date.parse(filter.updatedSince)
    if (Number.isNaN(since)) throw new UserError(`updated_since: "${filter.updatedSince}" is not a date (ISO 8601)`)
  }
  const issues: ListedIssue[] = all
    .filter((x) => (filter.status ? x.status === filter.status : x.status !== 'done'))
    .filter((x) => filter.priority === undefined || (x.priority ?? null) === filter.priority)
    .filter((x) => since === undefined || Date.parse(x.updated_at) >= since)
    .map((x) => ({ ...x, openBlockers: open.get(x.id) ?? 0 }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.position - b.position)
  const hiddenDone = filter.status ? 0 : all.filter((x) => x.status === 'done').length
  return { project, issues, hiddenDone }
}

export interface IssueDetail {
  issue: Issue
  project: Project
  parent: Brief | null
  blockers: Brief[]
  editor: string | null
}

export async function getIssue(session: Session, ref: string): Promise<IssueDetail> {
  const { db } = session
  const issue = await resolveIssue(session, ref)
  const [project, parent, blockers, editor] = await Promise.all([
    db.from('projects').select('id, name, position, created_at').eq('id', issue.project_id).single(),
    issue.parent_id
      ? db.from('issues').select('id, title, status, priority, position, parent_id, updated_at').eq('id', issue.parent_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('issues').select('id, title, status, priority, position, parent_id, updated_at').eq('parent_id', issue.id).order('position'),
    issue.updated_by
      ? db.from('profiles').select('pseudo').eq('user_id', issue.updated_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  return {
    issue,
    project: check(project) as Project,
    parent: check(parent) as Brief | null,
    blockers: (check(blockers) as Brief[]).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')),
    editor: (check(editor) as { pseudo: string } | null)?.pseudo ?? null,
  }
}

/** `%` and `_` are wildcards for ilike. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function searchIssues(session: Session, query: string, projectRef?: string, includeDone = false) {
  const q = query.trim()
  if (!q) throw new UserError('Empty query')
  const project = projectRef ? await resolveProject(session, projectRef) : null
  const search = (column: 'title' | 'body') => {
    let request = session.db.from('issues').select('id, project_id, title, status, priority, position, parent_id, updated_at')
    if (project) request = request.eq('project_id', project.id)
    if (!includeDone) request = request.neq('status', 'done')
    return request.ilike(column, `%${escapeLike(q)}%`).order('updated_at', { ascending: false }).limit(50)
  }
  const [byTitle, byBody] = await Promise.all([search('title'), search('body')])
  const found = new Map<string, Brief & { project_id: string }>()
  // Title matches first.
  for (const x of [...(check(byTitle) as (Brief & { project_id: string })[]), ...(check(byBody) as (Brief & { project_id: string })[])]) {
    if (!found.has(x.id)) found.set(x.id, x)
  }
  const projects = new Map((await listProjects(session)).map((p) => [p.id, p.name]))
  return [...found.values()].slice(0, 50).map((x) => ({ ...x, project: projects.get(x.project_id) ?? '?' }))
}

function checkTitle(title: string) {
  const t = title.trim()
  if (t.length < 1 || t.length > 500) throw new UserError('The title must have 1 to 500 characters')
  return t
}

/**
 * A parent is the larger issue that its children unblock (src/lib/dependencies.ts). Same rules as the app's pickers:
 * same project, not done, and not the issue itself or one of the issues it waits for.
 */
async function checkParent(session: Session, issue: Pick<Issue, 'id' | 'project_id'> | null, projectId: string, ref: string) {
  const parent = await resolveIssue(session, ref)
  if (parent.project_id !== projectId) throw new UserError(`#${shortId(parent.id)} is in another project`)
  if (parent.status === 'done') throw new UserError(`#${shortId(parent.id)} is done: it cannot wait for anything`)
  if (issue) {
    if (parent.id === issue.id) throw new UserError('An issue cannot be its own parent')
    const byId = new Map((await projectIssues(session, projectId)).map((x) => [x.id, x]))
    const seen = new Set<string>()
    for (let at: string | null | undefined = parent.id; at && !seen.has(at); at = byId.get(at)?.parent_id) {
      if (at === issue.id) throw new UserError(`#${shortId(parent.id)} already waits for this issue: that would make a cycle`)
      seen.add(at)
    }
  }
  return parent.id
}

export interface NewIssue {
  title: string
  body?: string
  priority?: Priority | null
  parentId?: string
}

/** On top of the project's To do. */
export async function createIssue(session: Session, projectRef: string, input: NewIssue): Promise<Issue> {
  const project = await resolveProject(session, projectRef)
  const row = {
    project_id: project.id,
    title: checkTitle(input.title),
    body: input.body ?? '',
    priority: input.priority ?? null,
    parent_id: input.parentId ? await checkParent(session, null, project.id, input.parentId) : null,
    status: 'todo' as Status,
    position: await topOf(session, project.id, 'todo'),
  }
  return check(await session.db.from('issues').insert(row).select(COLUMNS).single()) as Issue
}

export interface IssuePatch {
  status?: Status
  priority?: Priority | null
  title?: string
  /** null unlinks the issue from its parent. */
  parentId?: string | null
}

/** Never touches the body: append_to_issue does, without losing a concurrent edit. */
export async function updateIssue(session: Session, ref: string, patch: IssuePatch): Promise<Issue> {
  const issue = await resolveIssue(session, ref)
  const row: Partial<Issue> = {}
  if (patch.title !== undefined) row.title = checkTitle(patch.title)
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.parentId !== undefined) {
    row.parent_id = patch.parentId === null ? null : await checkParent(session, issue, issue.project_id, patch.parentId)
  }
  if (patch.status !== undefined && patch.status !== issue.status) {
    row.status = patch.status
    row.position = await topOf(session, issue.project_id, patch.status, issue.id)
  }
  if (!Object.keys(row).length) throw new UserError('Nothing to change')
  const rows = check(await session.db.from('issues').update(row).eq('id', issue.id).select(COLUMNS)) as Issue[]
  if (!rows.length) throw new UserError(`#${shortId(issue.id)} could not be changed (deleted meanwhile, or forbidden)`)
  return rows[0]
}

/** Local time, e.g. 2026-11-08 14:05. */
const stamp = () => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())

/**
 * Adds a signed section at the end of the body. The write only applies if nobody changed the issue since it was read
 * (same updated_at); otherwise it reads again and retries once.
 */
export async function appendToIssue(session: Session, ref: string, text: string): Promise<Issue> {
  const t = text.trim()
  if (!t) throw new UserError('Nothing to append')
  for (let attempt = 0; attempt < 2; attempt++) {
    const issue = await resolveIssue(session, ref)
    const body = issue.body.trimEnd()
    const next = `${body ? `${body}\n\n` : ''}---\n${session.name}, ${stamp()} :\n${t}`
    const rows = check(
      await session.db
        .from('issues')
        .update({ body: next })
        .eq('id', issue.id)
        .eq('updated_at', issue.updated_at)
        .select(COLUMNS),
    ) as Issue[]
    if (rows.length) return rows[0]
  }
  throw new UserError('The issue keeps changing while appending: try again later')
}

/** To do → In progress, only if it is still in To do: of two agents claiming it at once, one gets it. */
export async function claimIssue(session: Session, ref: string) {
  const issue = await resolveIssue(session, ref)
  if (issue.status !== 'todo') throw new UserError(`#${shortId(issue.id)} is not in To do (${issue.status}): already taken`)
  const position = await topOf(session, issue.project_id, 'doing')
  const rows = check(
    await session.db
      .from('issues')
      .update({ status: 'doing', position })
      .eq('id', issue.id)
      .eq('status', 'todo')
      .select(COLUMNS),
  ) as Issue[]
  if (!rows.length) throw new UserError(`#${shortId(issue.id)} left To do meanwhile: already taken`)
  const blockers = check(
    await session.db.from('issues').select('id').eq('parent_id', issue.id).neq('status', 'done'),
  ) as { id: string }[]
  return { issue: rows[0], openBlockers: blockers.length }
}
