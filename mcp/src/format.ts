import type { Issue, Priority, Project } from '../../src/lib/types'
import { STATUSES } from '../../src/lib/types'
import { shortId, type IssueDetail, type ListedIssue } from './issues'

const priority = (p?: Priority | null) => (p === null || p === undefined ? '[--]' : `[P${p}]`)
const statusLabel = (s: Issue['status']) => STATUSES.find((x) => x.id === s)?.label ?? s

type Line = Pick<Issue, 'id' | 'title' | 'status' | 'priority' | 'parent_id'>

/** `#a1b2c3d4 [P1] (todo) Title · waits for 2 · unblocks #e5f6a7b8` */
export function issueLine(issue: Line & { openBlockers?: number }, extra = '') {
  const parts = [`#${shortId(issue.id)} ${priority(issue.priority)} (${issue.status}) ${issue.title}`]
  if (issue.openBlockers) parts.push(`waits for ${issue.openBlockers}`)
  if (issue.parent_id) parts.push(`unblocks #${shortId(issue.parent_id)}`)
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

export function projectList(projects: Project[]) {
  if (!projects.length) return 'No project joined yet. Share one in the app, then: npm run join -- <invite link>'
  return projects.map((p) => `${p.name} (id ${shortId(p.id)})`).join('\n')
}

export function issueList(project: Project, issues: ListedIssue[], hiddenDone: number) {
  const lines = issues.map((x) => issueLine(x))
  const head = `${project.name}: ${issues.length} issue${issues.length === 1 ? '' : 's'}`
  const tail = hiddenDone ? `\n(${hiddenDone} done, not listed: status "done" lists them)` : ''
  return `${head}\n${lines.join('\n')}${tail}`.trimEnd()
}

export function issueDetail({ issue, project, parent, blockers, editor }: IssueDetail) {
  const lines = [
    `# ${issue.title}`,
    `id: ${issue.id}`,
    `project: ${project.name}`,
    `status: ${statusLabel(issue.status)} · priority: ${priority(issue.priority)}`,
    `created: ${issue.created_at} · updated: ${issue.updated_at}${editor ? ` by ${editor}` : ''}${issue.done_at ? ` · done: ${issue.done_at}` : ''}`,
  ]
  if (parent) lines.push(`unblocks: ${issueLine(parent)}`)
  if (blockers.length) {
    const open = blockers.filter((x) => x.status !== 'done').length
    lines.push(`waits for (${open} open of ${blockers.length}):`, ...blockers.map((x) => `  ${issueLine(x)}`))
  }
  lines.push('', issue.body.trim() || '(empty body)')
  return lines.join('\n')
}
