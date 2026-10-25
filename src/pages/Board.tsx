import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { STATUSES, doneAtFor, doneSince, isArchived, type Issue, type Status } from '../lib/types'
import { between } from '../lib/position'
import { navigate, rememberProject } from '../lib/router'
import { useIssues } from '../hooks/useIssues'
import { useProject } from '../hooks/useProjects'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipe } from '../hooks/useSwipe'
import { Column } from '../components/Column'
import { IssueCard } from '../components/IssueCard'
import { IssueSheet } from '../components/IssueSheet'
import { StatusTabs } from '../components/StatusTabs'
import { QuickAddInline, QuickAddMobile } from '../components/QuickAdd'
import { BackIcon, DownloadIcon, SearchIcon } from '../components/icons'
import { SearchPalette } from '../components/SearchPalette'
import { boardToMarkdown, downloadMarkdown } from '../lib/markdown'
import { SyncBadge } from '../components/SyncBadge'

const isStatus = (id: UniqueIdentifier): id is Status => STATUSES.some((s) => s.id === id)

export function Board({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  const { issues, setIssues, column, add, update, setStatus, remove } = useIssues(projectId)
  // Touch screens, tablets included, get one column at a time with tabs and swipes.
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [tab, setTab] = useState<Status>('todo')
  const [openId, setOpenId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [dragStart, setDragStart] = useState<Issue | null>(null)
  const quickAdd = useRef<HTMLInputElement>(null)
  const page = useRef<HTMLElement>(null)
  const pane = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (project === null) {
      rememberProject(null)
      navigate({ name: 'projects' })
    } else if (project) rememberProject(projectId)
  }, [project, projectId])

  // Escape goes back to the projects, "/" opens the search, any other printable key starts a new issue title on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || openId || searching || dragStart || e.defaultPrevented || e.isComposing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        e.preventDefault()
        rememberProject(null)
        navigate({ name: 'projects' })
      } else if (e.key === '/') {
        e.preventDefault()
        setSearching(true)
      } else if (e.key.length === 1 && e.key !== ' ') {
        // Focusing before the default action lets the browser type the key into the field.
        quickAdd.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [openId, searching, dragStart])

  const tabIndex = STATUSES.findIndex((s) => s.id === tab)
  useSwipe(page, pane, {
    enabled: !desktop && !openId && !searching && !dragStart,
    hasPrev: tabIndex > 0,
    hasNext: tabIndex < STATUSES.length - 1,
    onSwipe: (dir) => setTab(STATUSES[tabIndex + dir].id),
  })

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
    setIssues(
      (list) =>
        list?.map((x) => (x.id === a.id ? { ...x, status: target, position, done_at: doneAtFor(x, target) } : x)) ?? null,
    )
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
  // Issues done more than a week ago are tucked into a collapsed drawer under "Fait".
  const now = Date.now()
  const archived = column('done')
    .filter((x) => isArchived(x, now))
    .sort((a, b) => doneSince(b).localeCompare(doneSince(a)))
  const visible = (status: Status) => (status === 'done' ? column('done').filter((x) => !isArchived(x, now)) : column(status))
  const counts = { todo: column('todo').length, doing: column('doing').length, done: visible('done').length }
  const columnProps = { onOpen: setOpenId, onStatus: setStatus }

  return (
    <main
      ref={page}
      className={`mx-auto min-h-dvh overflow-x-clip px-4 pb-safe ${desktop ? 'max-w-6xl' : 'max-w-2xl touch-pan-y touch-pinch-zoom'}`}
    >
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
          <div className="ml-auto flex items-center gap-1">
            <SyncBadge />
            {issues && (
              <button
                // Mounting the field inside the tap lets iOS open the keyboard.
                onClick={() => flushSync(() => setSearching(true))}
                aria-label="Rechercher"
                title="Rechercher (/)"
                className="rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <SearchIcon />
              </button>
            )}
            {project && issues && (
              <button
                onClick={() => downloadMarkdown(project.name, boardToMarkdown(project.name, column))}
                aria-label="Télécharger en Markdown"
                title="Télécharger en Markdown"
                className="-mr-1.5 rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <DownloadIcon />
              </button>
            )}
          </div>
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
                  issues={visible(id)}
                  archived={id === 'done' ? archived : undefined}
                  header={id === 'todo' && <QuickAddInline ref={quickAdd} onAdd={handleAdd} />}
                  {...columnProps}
                />
              ))}
            </div>
          ) : (
            <div ref={pane} className="pt-1 pb-24">
              <Column
                status={tab}
                issues={visible(tab)}
                archived={tab === 'done' ? archived : undefined}
                empty={tab === 'todo' ? 'Rien à faire. Touche + pour noter une idée.' : 'Vide.'}
                {...columnProps}
              />
            </div>
          )}
          <DragOverlay>{dragStart && find(dragStart.id) && <IssueCard issue={find(dragStart.id)!} overlay />}</DragOverlay>
        </DndContext>
      )}

      {!desktop && !open && !searching && <QuickAddMobile onAdd={handleAdd} />}

      {searching && issues && (
        <SearchPalette
          // Done issues stay out of the search.
          issues={issues.filter((i) => i.status !== 'done')}
          onPick={(issue) => {
            setSearching(false)
            setTab(issue.status)
            setOpenId(issue.id)
          }}
          onClose={() => setSearching(false)}
        />
      )}

      {open && (
        <IssueSheet
          key={open.id}
          issue={open}
          onSave={(patch) => update(open.id, patch)}
          onStatus={(s) => setStatus(open.id, s)}
          onPriority={(priority) => update(open.id, { priority })}
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
