import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PRIORITIES, type Issue, type Status } from '../lib/types'
import { StatusIcon } from './StatusIcon'
import { hideDiagrams } from '../lib/format'
import type { CardLinks } from '../lib/dependencies'

const NEXT: Record<Status, Status> = { todo: 'doing', doing: 'done', done: 'todo' }

interface Props {
  issue: Issue
  onOpen?: () => void
  onStatus?: (s: Status) => void
  overlay?: boolean
  /** Project name, shown on the cross-project view. */
  project?: string
  /** Keyboard selection. */
  selected?: boolean
  /** Blockers and parent, absent on an issue without links. */
  links?: CardLinks
  /** Levels of indentation under the parent, in a column. */
  depth?: number
}

const INDENT_PX = 16

export function IssueCard({ issue, onOpen, onStatus, overlay, project, selected, links }: Props) {
  const done = issue.status === 'done'
  const priority = PRIORITIES.find((p) => p.id === issue.priority)
  return (
    <div
      data-issue-id={overlay ? undefined : issue.id}
      className={`flex scroll-my-24 items-start gap-2.5 rounded-xl px-3 py-3 ring-1 ${
        priority?.card ?? 'bg-white ring-neutral-200/80 dark:bg-neutral-900 dark:ring-neutral-800'
      } ${overlay ? 'rotate-1 shadow-xl' : 'shadow-sm'} ${selected ? 'ring-accent/50!' : ''}`}
    >
      <button
        aria-label="Change status"
        onClick={(e) => {
          e.stopPropagation()
          onStatus?.(NEXT[issue.status])
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="-m-1.5 shrink-0 p-1.5"
      >
        <StatusIcon status={issue.status} />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className={`text-[15px] leading-snug break-words ${done ? 'text-neutral-400 line-through' : ''}`}>
          {issue.title}
        </p>
        {issue.body && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{hideDiagrams(issue.body)}</p>}
        {project && <p className="mt-1.5 truncate text-xs font-medium text-accent/80">{project}</p>}
        {links && links.total > 0 && (
          <p className={`mt-1.5 text-xs font-medium tabular-nums ${links.done < links.total ? 'text-neutral-500' : 'text-accent'}`}>
            {links.done < links.total ? 'Blocked' : 'Ready'} {links.done}/{links.total}
          </p>
        )}
        {links?.parent && <p className="mt-1.5 truncate text-xs text-neutral-500">Unblocks {links.parent}</p>}
      </button>
    </div>
  )
}

export function SortableIssueCard(props: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: props.issue.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, marginLeft: (props.depth ?? 0) * INDENT_PX }}
      className={`touch-manipulation ${isDragging ? 'opacity-40' : ''}`}
      {...attributes}
      {...listeners}
    >
      <IssueCard {...props} />
    </li>
  )
}
