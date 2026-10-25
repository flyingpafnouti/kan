import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { navigate, rememberProject } from '../lib/router'
import { clear as clearOutbox, pendingCount } from '../lib/outbox'
import { clearCache } from '../lib/cache'
import { SyncBadge } from '../components/SyncBadge'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useProjects, type ProjectRow } from '../hooks/useProjects'
import { ChevronIcon, MoonIcon, MoreIcon, PlusIcon, SunIcon } from '../components/icons'
import { toggleTheme, useTheme } from '../lib/theme'

export function Projects() {
  const { projects, create, rename, remove } = useProjects()
  const theme = useTheme()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // Keyboard selection: 'all' or a project id.
  const [selected, setSelected] = useState<string | null>(null)
  // Shortcuts only matter with a keyboard and a mouse.
  const desktop = useMediaQuery('(pointer: fine)')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || !projects?.length || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const items = ['all', ...projects.map((p) => p.id)]
      const i = selected ? items.indexOf(selected) : -1
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = i < 0 ? 0 : Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
        setSelected(items[next])
      } else if (e.key === 'Enter' && i >= 0) {
        e.preventDefault()
        navigate(selected === 'all' ? { name: 'all' } : { name: 'board', projectId: selected! })
      } else if (e.key === 'Escape' && i >= 0) {
        setSelected(null)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [projects, selected])

  useEffect(() => {
    if (selected) document.querySelector(`[data-nav-id="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  async function signOut() {
    const n = pendingCount()
    if (n && !confirm(`${n} unsynced change(s) will be lost. Sign out?`)) return
    await supabase.auth.signOut()
    clearOutbox()
    clearCache()
    rememberProject(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    create(n)
    setName('')
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pt-safe pb-safe">
      <header className="flex items-center justify-between py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <div className="ml-auto mr-2">
          <SyncBadge />
        </div>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="mr-1 rounded-lg p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {theme === 'dark' ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
        </button>
        <button
          onClick={signOut}
          className="rounded-lg px-2 py-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Sign out
        </button>
      </header>

      {projects && projects.length > 0 && (
        <button
          data-nav-id="all"
          onClick={() => navigate({ name: 'all' })}
          className={`mb-3 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-neutral-600 transition ${
            selected === 'all' ? 'ring-1 ring-accent/50' : 'ring-1 ring-neutral-200/70 dark:ring-neutral-800'
          } hover:bg-white dark:text-neutral-400 dark:hover:bg-neutral-900`}
        >
          <span className="text-[15px] font-medium">All issues</span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs tabular-nums text-neutral-500 dark:bg-neutral-800">
            {projects.reduce((n, p) => n + p.open, 0)}
          </span>
          <ChevronIcon className="ml-auto shrink-0 text-neutral-300 dark:text-neutral-700" />
        </button>
      )}

      <ul className="space-y-2">
        {projects?.map((p) =>
          editing === p.id ? (
            <EditRow
              key={p.id}
              project={p}
              onDone={(n) => {
                if (n && n !== p.name) rename(p.id, n)
                setEditing(null)
              }}
              onDelete={() => {
                if (confirm(`Delete "${p.name}" and all its issues?`)) remove(p.id)
                setEditing(null)
              }}
            />
          ) : (
            <li
              key={p.id}
              data-nav-id={p.id}
              className={`flex items-center rounded-2xl bg-white shadow-sm dark:bg-neutral-900 ${
                selected === p.id ? 'ring-1 ring-accent/50' : 'ring-1 ring-neutral-200/70 dark:ring-neutral-800'
              }`}
            >
              <button
                onClick={() => navigate({ name: 'board', projectId: p.id })}
                className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-4 text-left"
              >
                <span className="truncate text-[17px] font-medium">{p.name}</span>
                {p.open > 0 && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs tabular-nums text-neutral-500 dark:bg-neutral-800">
                    {p.open}
                  </span>
                )}
                <ChevronIcon className="ml-auto shrink-0 text-neutral-300 dark:text-neutral-700" />
              </button>
              <button
                onClick={() => setEditing(p.id)}
                aria-label="Options"
                className="px-4 py-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <MoreIcon />
              </button>
            </li>
          ),
        )}
      </ul>

      {projects?.length === 0 && <p className="py-8 text-center text-neutral-500">No projects yet.</p>}

      {projects && (
        <form onSubmit={submit} className="mt-4 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project"
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-2xl border border-dashed border-neutral-300 bg-transparent px-4 py-3.5 outline-none focus:border-accent focus:border-solid dark:border-neutral-700"
          />
          <button
            aria-label="Create"
            disabled={!name.trim()}
            className="rounded-2xl bg-accent p-3.5 text-white transition disabled:opacity-30"
          >
            <PlusIcon />
          </button>
        </form>
      )}

      {desktop && projects && <ShortcutsHelp />}
    </main>
  )
}

function EditRow({
  project,
  onDone,
  onDelete,
}: {
  project: ProjectRow
  onDone: (name: string) => void
  onDelete: () => void
}) {
  const [value, setValue] = useState(project.name)
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-accent dark:bg-neutral-900">
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          onDone(value.trim())
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onDone('')}
          enterKeyHint="done"
          className="w-full bg-transparent px-2 py-2 text-[17px] font-medium outline-none"
        />
      </form>
      <button onClick={onDelete} className="rounded-xl px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
        Delete
      </button>
      <button
        onClick={() => onDone(value.trim())}
        className="rounded-xl bg-neutral-100 px-3 py-2 text-sm font-medium dark:bg-neutral-800"
      >
        OK
      </button>
    </li>
  )
}
