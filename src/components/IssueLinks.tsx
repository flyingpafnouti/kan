import { forwardRef } from 'react'
import { dependencyTree, type IssueIndex } from '../lib/dependencies'
import type { Issue } from '../lib/types'
import { CloseIcon } from './icons'
import { QuickAddInline } from './QuickAdd'
import { StatusIcon } from './StatusIcon'

export type LinkPick = 'blocker' | 'parent'

interface Props {
  issue: Issue
  index: IssueIndex
  onOpen: (id: string) => void
  /** Clears the parent of `id`. */
  onUnlink: (id: string) => void
  onAddBlocker: (title: string) => void
  onPick: (kind: LinkPick) => void
}

/** What the issue unblocks and what it waits for, the blockers ready to be done being marked. */
export const IssueLinks = forwardRef<HTMLElement, Props>(function IssueLinks(
  { issue, index, onOpen, onUnlink, onAddBlocker, onPick },
  ref,
) {
  const parent = issue.parent_id ? index.byId.get(issue.parent_id) : undefined
  const rows = dependencyTree(issue.id, index)
  const direct = rows.filter((row) => row.depth === 0)
  const done = direct.filter((row) => row.issue.status === 'done').length
  return (
    <section ref={ref} className="space-y-3 border-t border-neutral-100 py-3 dark:border-neutral-800">
      <div>
        <h3 className="mb-1 text-xs font-medium text-neutral-500">Unblocks</h3>
        {parent ? (
          <ul>
            <LinkRow issue={parent} onOpen={onOpen} onUnlink={() => onUnlink(issue.id)} />
          </ul>
        ) : (
          <PickButton onClick={() => onPick('parent')} />
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-medium text-neutral-500">
          Blocked by
          {direct.length > 0 && (
            <span className="ml-2 tabular-nums text-neutral-400">
              {done}/{direct.length}
            </span>
          )}
        </h3>
        {rows.length > 0 && (
          <ul className="mb-2">
            {rows.map(({ issue: row, depth, ready }) => (
              <LinkRow
                key={row.id}
                issue={row}
                depth={depth}
                ready={ready}
                onOpen={onOpen}
                // Only direct blockers: a deeper link belongs to the issue in between.
                onUnlink={depth === 0 ? () => onUnlink(row.id) : undefined}
              />
            ))}
          </ul>
        )}
        <QuickAddInline onAdd={onAddBlocker} placeholder="New blocker…" />
        <PickButton onClick={() => onPick('blocker')} />
      </div>
    </section>
  )
})

function PickButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="py-1 text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
      Link existing issue
    </button>
  )
}

function LinkRow({
  issue,
  depth = 0,
  ready,
  onOpen,
  onUnlink,
}: {
  issue: Issue
  depth?: number
  ready?: boolean
  onOpen: (id: string) => void
  onUnlink?: () => void
}) {
  const done = issue.status === 'done'
  return (
    <li className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
      <button onClick={() => onOpen(issue.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm">
        <StatusIcon status={issue.status} size={14} />
        <span className={`truncate ${done ? 'text-neutral-400 line-through' : ''}`}>{issue.title}</span>
      </button>
      {ready && <span className="shrink-0 text-xs font-medium text-accent">Ready</span>}
      {onUnlink && (
        <button
          onClick={onUnlink}
          aria-label={`Remove link with ${issue.title}`}
          title="Remove link"
          className="-my-1 shrink-0 rounded-lg p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <CloseIcon width={14} height={14} />
        </button>
      )}
    </li>
  )
}
