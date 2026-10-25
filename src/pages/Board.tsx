import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { STATUSES, type Issue, type Status } from '../lib/types'
import { between } from '../lib/position'
import { navigate, rememberProject } from '../lib/router'
import { useIssues } from '../hooks/useIssues'
import { useProject } from '../hooks/useProjects'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { Column } from '../components/Column'
import { IssueCard } from '../components/IssueCard'
import { IssueSheet } from '../components/IssueSheet'
import { StatusTabs } from '../components/StatusTabs'
import { QuickAddInline, QuickAddMobile } from '../components/QuickAdd'
import { BackIcon } from '../components/icons'

const isStatus = (id: UniqueIdentifier): id is Status => STATUSES.some((s) => s.id === id)

export function Board({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  const { issues, setIssues, column, add, update, setStatus, remove } = useIssues(projectId)
  const desktop = useMediaQuery('(min-width: 768px)')
  const [tab, setTab] = useState<Status>('todo')
  const [openId, setOpenId] = useState<string | null>(null)
  const [dragStart, setDragStart] = useState<Issue | null>(null)
  const quickAdd = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (project === null) {
      rememberProject(null)
      navigate({ name: 'projects' })
    } else if (project) rememberProject(projectId)
  }, [project, projectId])

  // "N" focuses the quick-add field on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea')
      if (e.key.toLowerCase() === 'n' && !typing && !openId && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        quickAdd.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [openId])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const find = (id: UniqueIdentifier) => issues?.find((x) => x.id === id)

  function onDragStart({ active }: DragStartEvent) {
    setDragStart(find(active.id) ?? null)
  }

  // Cross-column moves are applied locally while dragging so the target column makes room.
  function onDragOver({ active, over }: DragOverEvent) {
    const a = find(active.id)
    if (!a || !over) return
    const target = isStatus(over.id) ? over.id : find(over.id)?.status
    if (!target || target === a.status) return
    const col = column(target)
    const i = col.findIndex((x) => x.id === over.id)
    const position = i < 0 ? between(col.at(-1)?.position, undefined) : between(col[i - 1]?.position, col[i].position)
    setIssues((list) => list?.map((x) => (x.id === a.id ? { ...x, status: target, position } : x)) ?? null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const start = dragStart
    setDragStart(null)
    const a = find(active.id)
    if (!a || !start) return
    let position = a.position
    if (over && over.id !== active.id && !isStatus(over.id)) {
      const col = column(a.status)
      const from = col.findIndex((x) => x.id === a.id)
      const to = col.findIndex((x) => x.id === over.id)
      if (from >= 0 && to >= 0) {
        const moved = arrayMove(col, from, to)
        position = between(moved[to - 1]?.position, moved[to + 1]?.position)
      }
    }
    if (a.status !== start.status || position !== start.position) update(a.id, { status: a.status, position })
  }

  function onDragCancel() {
    const start = dragStart
    setDragStart(null)
    if (start) setIssues((list) => list?.map((x) => (x.id === start.id ? start : x)) ?? null)
  }

  function handleAdd(title: string) {
    add(title)
    setTab('todo')
  }

  const open = openId ? find(openId) : undefined
  const counts = { todo: column('todo').length, doing: column('doing').length, done: column('done').length }
  const columnProps = { onOpen: setOpenId, onStatus: setStatus }

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 pb-safe">
      <header className="sticky top-0 z-10 -mx-4 bg-neutral-50/90 px-4 pt-safe backdrop-blur dark:bg-neutral-950/90">
        <div className="flex items-center gap-2 py-4">
          <button
            onClick={() => {
              rememberProject(null)
              navigate({ name: 'projects' })
            }}
            aria-label="Projets"
            className="-ml-2 rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <BackIcon width={22} height={22} />
          </button>
          <h1 className="truncate text-xl font-semibold tracking-tight">{project?.name ?? ''}</h1>
        </div>
        {!desktop && (
          <div className="pb-3">
            <StatusTabs value={tab} counts={counts} onChange={setTab} />
          </div>
        )}
      </header>

      {issues && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          {desktop ? (
            <div className="grid grid-cols-3 gap-6 pt-2">
              {STATUSES.map(({ id, label }) => (
                <Column
                  key={id}
                  status={id}
                  title={label}
                  issues={column(id)}
                  header={id === 'todo' && <QuickAddInline ref={quickAdd} onAdd={handleAdd} />}
                  {...columnProps}
                />
              ))}
            </div>
          ) : (
            <div className="pt-1 pb-24">
              <Column
                status={tab}
                issues={column(tab)}
                empty={tab === 'todo' ? 'Rien à faire. Touche + pour noter une idée.' : 'Vide.'}
                {...columnProps}
              />
            </div>
          )}
          <DragOverlay>{dragStart && find(dragStart.id) && <IssueCard issue={find(dragStart.id)!} overlay />}</DragOverlay>
        </DndContext>
      )}

      {!desktop && !open && <QuickAddMobile onAdd={handleAdd} />}

      {open && (
        <IssueSheet
          key={open.id}
          issue={open}
          onSave={(patch) => update(open.id, patch)}
          onStatus={(s) => setStatus(open.id, s)}
          onDelete={() => {
            remove(open)
            setOpenId(null)
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  )
}
