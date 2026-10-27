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
import { useProject, useProjectList } from '../hooks/useProjects'
import { toast } from '../lib/toast'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipe } from '../hooks/useSwipe'
import { useIssueKeys } from '../hooks/useIssueKeys'
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
  const { issues, setIssues, column, add, update, setStatus, remove, copyTo } = useIssues(projectId)
  const projects = useProjectList()
  // Touch screens, tablets included, get one column at a time with tabs and swipes.
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [tab, setTab] = useState<Status>('todo')
  const [openId, setOpenId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  // Issue reached with the sheet's previous / next: shown without the opening animation.
  const [steppedTo, setSteppedTo] = useState<string | null>(null)
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

  // Escape or Backspace goes back to the projects, "/" opens the search, any other printable key starts a new issue title on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || openId || searching || dragStart || e.defaultPrevented || e.isComposing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || e.key === 'Backspace') {
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

  function reorder(id: string, dir: -1 | 1) {
    const a = find(id)
    if (!a) return
    const col = visible(a.status)
    const i = col.findIndex((x) => x.id === id)
    const neighbor = col[i + dir]
    if (!neighbor) return
    const beyond = col[i + 2 * dir]
    update(id, {
      position: dir < 0 ? between(beyond?.position, neighbor.position) : between(neighbor.position, beyond?.position),
    })
  }

  const { selected, setSelected, sibling } = useIssueKeys({
    enabled: !openId && !searching && !dragStart,
    column: visible,
    tab: desktop ? undefined : tab,
    setTab: desktop ? undefined : setTab,
    onOpen: setOpenId,
    onStatus: setStatus,
    onReorder: reorder,
  })
  const columnProps = {
    onOpen: (id: string) => {
      setSelected(id)
      setOpenId(id)
    },
    onStatus: setStatus,
    selected,
  }

  const prev = open && sibling(open.id, -1)
  const next = open && sibling(open.id, 1)
  function step(id: string) {
    setSteppedTo(id)
    setSelected(id)
    setOpenId(id)
  }

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
            aria-label="Projects"
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
                aria-label="Search"
                title="Search (/)"
                className="rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <SearchIcon />
              </button>
            )}
            {project && issues && (
              <button
                onClick={() => downloadMarkdown(project.name, boardToMarkdown(project.name, column))}
                aria-label="Download as Markdown"
                title="Download as Markdown"
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
                empty={tab === 'todo' ? 'Nothing to do. Tap + to jot down an idea.' : 'Empty.'}
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
          onPrev={prev && (() => step(prev.id))}
          onNext={next && (() => step(next.id))}
          instant={open.id === steppedTo}
          projects={projects}
          onCopy={(target, text) => {
            copyTo(open, target, text)
            const name = projects?.find((p) => p.id === target)?.name ?? 'the project'
            toast(target === projectId ? 'Copy added on top of To do' : `Copied to ${name}`, {
              action: target === projectId ? undefined : { label: 'Open', run: () => navigate({ name: 'board', projectId: target }) },
            })
          }}
        />
      )}
    </main>
  )
}
