import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { STATUSES, doneSince, isArchived, type Issue, type Status } from '../lib/types'
import { navigate } from '../lib/router'
import { useIssues } from '../hooks/useIssues'
import { useProjects } from '../hooks/useProjects'
import { toast } from '../lib/toast'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipe } from '../hooks/useSwipe'
import { useIssueKeys } from '../hooks/useIssueKeys'
import { Column } from '../components/Column'
import { IssueSheet } from '../components/IssueSheet'
import { StatusTabs } from '../components/StatusTabs'
import { BackIcon, SearchIcon } from '../components/icons'
import { SearchPalette } from '../components/SearchPalette'
import { SyncBadge } from '../components/SyncBadge'

/**
 * Read-mostly board of every project's issues: no drag and drop nor quick add, since positions and
 * new issues belong to a project. Cards are sorted by priority, then project order, then position.
 */
export function AllIssues() {
  const { issues, column, update, setStatus, remove, copyTo } = useIssues(null)
  const { projects } = useProjects()
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [tab, setTab] = useState<Status>('todo')
  const [openId, setOpenId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  // Issue reached with the sheet's previous / next: shown without the opening animation.
  const [steppedTo, setSteppedTo] = useState<string | null>(null)
  const page = useRef<HTMLElement>(null)
  const pane = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || openId || searching || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        navigate({ name: 'projects' })
      } else if (e.key === '/') {
        e.preventDefault()
        setSearching(true)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [openId, searching])

  const tabIndex = STATUSES.findIndex((s) => s.id === tab)
  useSwipe(page, pane, {
    enabled: !desktop && !openId && !searching,
    hasPrev: tabIndex > 0,
    hasNext: tabIndex < STATUSES.length - 1,
    onSwipe: (dir) => setTab(STATUSES[tabIndex + dir].id),
  })

  // Issues of projects deleted elsewhere can linger in the cache until the next load.
  const rank = new Map(projects?.map((p, i) => [p.id, i]))
  const name = (issue: Issue) => projects?.find((p) => p.id === issue.project_id)?.name
  const known = (issue: Issue) => !projects || rank.has(issue.project_id)
  const byPriority = (a: Issue, b: Issue) =>
    (a.priority ?? 4) - (b.priority ?? 4) ||
    (rank.get(a.project_id) ?? 0) - (rank.get(b.project_id) ?? 0) ||
    a.position - b.position
  const all = (status: Status) => column(status).filter(known)

  const now = Date.now()
  const archived = all('done')
    .filter((x) => isArchived(x, now))
    .sort((a, b) => doneSince(b).localeCompare(doneSince(a)))
  const visible = (status: Status) =>
    (status === 'done' ? all('done').filter((x) => !isArchived(x, now)) : all(status)).sort(byPriority)
  const counts = { todo: all('todo').length, doing: all('doing').length, done: visible('done').length }
  // No reordering here: the order is computed.
  const { selected, setSelected, sibling } = useIssueKeys({
    enabled: !openId && !searching,
    column: visible,
    tab: desktop ? undefined : tab,
    setTab: desktop ? undefined : setTab,
    onOpen: setOpenId,
    onStatus: setStatus,
  })
  const columnProps = {
    onOpen: (id: string) => {
      setSelected(id)
      setOpenId(id)
    },
    onStatus: setStatus,
    projectName: name,
    selected,
  }

  const open = openId ? issues?.find((x) => x.id === openId) : undefined

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
            onClick={() => navigate({ name: 'projects' })}
            aria-label="Projects"
            className="-ml-2 rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <BackIcon width={22} height={22} />
          </button>
          <h1 className="truncate text-xl font-semibold tracking-tight">All issues</h1>
          <div className="ml-auto flex items-center gap-1">
            <SyncBadge />
            {issues && (
              <button
                // Mounting the field inside the tap lets iOS open the keyboard.
                onClick={() => flushSync(() => setSearching(true))}
                aria-label="Search"
                title="Search (/)"
                className="-mr-1.5 rounded-lg p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <SearchIcon />
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

      {issues &&
        (desktop ? (
          <div className="grid grid-cols-3 gap-6 pt-2">
            {STATUSES.map(({ id, label }) => (
              <Column
                key={id}
                status={id}
                title={label}
                issues={visible(id)}
                archived={id === 'done' ? archived : undefined}
                empty="Empty."
                {...columnProps}
              />
            ))}
          </div>
        ) : (
          <div ref={pane} className="pt-1 pb-8">
            <Column
              status={tab}
              issues={visible(tab)}
              archived={tab === 'done' ? archived : undefined}
              empty="Empty."
              {...columnProps}
            />
          </div>
        ))}

      {searching && issues && (
        <SearchPalette
          issues={issues.filter((i) => i.status !== 'done' && known(i))}
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
            toast(target === open.project_id ? 'Copy added on top of To do' : `Copied to ${name}`, {
              action: target === open.project_id ? undefined : { label: 'Open', run: () => navigate({ name: 'board', projectId: target }) },
            })
          }}
        />
      )}
    </main>
  )
}
