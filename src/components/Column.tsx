import { useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Issue, Status } from '../lib/types'
import { IssueCard, SortableIssueCard } from './IssueCard'
import { ChevronIcon } from './icons'

interface Props {
  status: Status
  issues: Issue[]
  title?: string
  header?: ReactNode
  empty?: string
  /** Old done issues, listed in a drawer that starts collapsed. */
  archived?: Issue[]
  onOpen: (id: string) => void
  onStatus: (id: string, s: Status) => void
}

export function Column({ status, issues, title, header, empty, archived, onOpen, onStatus }: Props) {
  const { setNodeRef } = useDroppable({ id: status })
  const [showArchived, setShowArchived] = useState(false)
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
          {archived && (
            // Inside the list so the drawer follows the cards instead of the bottom of the drop zone.
            <li className="pt-2">
              <button
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="flex w-full items-center gap-1.5 px-1 py-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <ChevronIcon width={16} height={16} className={`transition-transform ${showArchived ? 'rotate-90' : ''}`} />
                Terminées il y a plus de 7 jours
                <span className="tabular-nums text-neutral-400">{archived.length}</span>
              </button>
              {showArchived && archived.length === 0 && (
                <p className="py-6 text-center text-sm text-neutral-400">Rien de plus ancien.</p>
              )}
              {showArchived && archived.length > 0 && (
                <ul className="mt-2 flex flex-col gap-2 opacity-70">
                  {archived.map((issue) => (
                    <li key={issue.id}>
                      <IssueCard issue={issue} onOpen={() => onOpen(issue.id)} onStatus={(s) => onStatus(issue.id, s)} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  )
}
