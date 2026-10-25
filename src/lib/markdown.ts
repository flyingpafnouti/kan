import { PRIORITIES, STATUSES, type Issue, type Status } from './types'

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/** Whole board as Markdown: one section per column, in board order, notes indented under each issue. */
export function boardToMarkdown(name: string, column: (s: Status) => Issue[]): string {
  const lines = [`# ${name}`, '', `Exported on ${DAY.format(new Date())}`]
  for (const { id, label } of STATUSES) {
    const issues = column(id)
    lines.push('', `## ${label} (${issues.length})`, '')
    if (!issues.length) lines.push('Empty.')
    for (const issue of issues) {
      const priority = PRIORITIES.find((p) => p.id === issue.priority)
      lines.push(`- [${id === 'done' ? 'x' : ' '}] ${priority ? `**${priority.label}** ` : ''}${issue.title}`)
      const body = issue.body.trim()
      if (body) lines.push('', ...body.split('\n').map((l) => (l ? `  ${l}` : '')), '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

export function downloadMarkdown(name: string, markdown: string) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const date = new Date().toISOString().slice(0, 10)
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${slug || 'board'}-${date}.md` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
