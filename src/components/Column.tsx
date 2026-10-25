import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Issue, Status } from '../lib/types'
import { SortableIssueCard } from './IssueCard'

interface Props {
  status: Status
  issues: Issue[]
  title?: string
  header?: ReactNode
  empty?: string
  onOpen: (id: string) => void
  onStatus: (id: string, s: Status) => void
}

export function Column({ status, issues, title, header, empty, onOpen, onStatus }: Props) {
  const { setNodeRef } = useDroppable({ id: status })
  return (
    <section className="flex min-w-0 flex-col">
      {title && (
        <h2 className="mb-3 flex items-baseline gap-2 px-1 text-sm font-medium text-neutral-500">
          {title}
          <span className="tabular-nums text-neutral-400">{issues.length}</span>
        </h2>
      )}
      {header}
      <SortableContext id={status} items={issues.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 pb-4">
          {issues.length === 0 && empty && <li className="py-12 text-center text-sm text-neutral-400">{empty}</li>}
          {issues.map((issue) => (
            <SortableIssueCard
              key={issue.id}
              issue={issue}
              onOpen={() => onOpen(issue.id)}
              onStatus={(s) => onStatus(issue.id, s)}
            />
          ))}
        </ul>
      </SortableContext>
    </section>
  )
}
