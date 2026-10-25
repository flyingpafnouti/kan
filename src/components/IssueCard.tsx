import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PRIORITIES, type Issue, type Status } from '../lib/types'
import { StatusIcon } from './StatusIcon'

const NEXT: Record<Status, Status> = { todo: 'doing', doing: 'done', done: 'todo' }

interface Props {
  issue: Issue
  onOpen?: () => void
  onStatus?: (s: Status) => void
  overlay?: boolean
}

export function IssueCard({ issue, onOpen, onStatus, overlay }: Props) {
  const done = issue.status === 'done'
  const priority = PRIORITIES.find((p) => p.id === issue.priority)
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl px-3 py-3 ring-1 ${
        priority?.card ?? 'bg-white ring-neutral-200/80 dark:bg-neutral-900 dark:ring-neutral-800'
      } ${overlay ? 'rotate-1 shadow-xl' : 'shadow-sm'}`}
    >
      <button
        aria-label="Changer le statut"
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
        {issue.body && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{issue.body}</p>}
      </button>
    </div>
  )
}

export function SortableIssueCard(props: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: props.issue.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`touch-manipulation ${isDragging ? 'opacity-40' : ''}`}
      {...attributes}
      {...listeners}
    >
      <IssueCard {...props} />
    </li>
  )
}
