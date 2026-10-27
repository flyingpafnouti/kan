import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { navigate } from '../lib/router'
import { toast } from '../lib/toast'
import { search } from '../lib/fuzzy'
import { HomeHeader } from '../components/HomeHeader'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { byLastChange, useProjects, type ProjectRow } from '../hooks/useProjects'
import { ChevronIcon, MoreIcon, PlusIcon } from '../components/icons'

export function Projects() {
  const { projects: stored, create, rename, remove, leave, inviteLink } = useProjects()
  // Listed by last change; other pages keep the creation order of useProjects.
  const projects = useMemo(() => stored && [...stored].sort(byLastChange), [stored])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // Keyboard selection: 'all' or a project id.
  const [selected, setSelected] = useState<string | null>(null)
  // Shortcuts only matter with a keyboard and a mouse.
  const desktop = useMediaQuery('(pointer: fine)')
  // Type-ahead: letters typed in a row select the best matching project, then fade out.
  const [typed, setTyped] = useState('')
  const typedTimer = useRef<number>(undefined)

  function typeAhead(s: string) {
    clearTimeout(typedTimer.current)
    setTyped(s)
    if (!s) return
    typedTimer.current = window.setTimeout(() => setTyped(''), 2000)
    const hit = search(projects!.map((p) => ({ id: p.id, title: p.name, body: '' })), s)[0]
    if (hit) setSelected(hit.item.id)
  }

  useEffect(() => () => clearTimeout(typedTimer.current), [])

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
      } else if (e.key === 'Escape' && (i >= 0 || typed)) {
        setSelected(null)
        typeAhead('')
      } else if (e.key === 'Backspace' && typed) {
        e.preventDefault()
        typeAhead(typed.slice(0, -1))
      } else if ((e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) || (e.key === ' ' && typed)) {
        e.preventDefault()
        typeAhead(typed + e.key)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [projects, selected, typed])

  useEffect(() => {
    if (selected) document.querySelector(`[data-nav-id="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  async function share(p: ProjectRow, reset: boolean) {
    const link = await inviteLink(p.id, reset)
    if (!link) return toast('Sharing needs a connection')
    try {
      await navigator.clipboard.writeText(link)
      toast(reset ? 'New link copied, the old one no longer works' : 'Invite link copied')
    } catch {
      // Clipboard needs HTTPS (missing on the LAN dev server): let the user copy it by hand.
      prompt('Invite link', link)
    }
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
      <HomeHeader current="projects" />

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
              onShare={(reset) => share(p, reset)}
              onLeave={() => {
                if (confirm(`Leave "${p.name}"? The other members keep it.`)) leave(p.id)
                setEditing(null)
              }}
              onDelete={() => {
                const question =
                  p.members > 1
                    ? `Delete "${p.name}" and all its issues for all ${p.members} members?`
                    : `Delete "${p.name}" and all its issues?`
                if (confirm(question)) remove(p.id)
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
                {p.members > 1 && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">Shared</span>
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

      {typed && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 flex justify-center pb-safe">
          <span className="rounded-full bg-neutral-900/80 px-3 py-1 text-sm text-white shadow dark:bg-neutral-100/90 dark:text-neutral-900">
            {typed}
          </span>
        </div>
      )}

      {desktop && projects && <ShortcutsHelp />}
    </main>
  )
}

function EditRow({
  project,
  onDone,
  onShare,
  onLeave,
  onDelete,
}: {
  project: ProjectRow
  onDone: (name: string) => void
  onShare: (reset: boolean) => void
  onLeave: () => void
  onDelete: () => void
}) {
  const [value, setValue] = useState(project.name)
  const action = 'rounded-xl px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
  return (
    <li className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-accent dark:bg-neutral-900">
      <div className="flex items-center gap-2">
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
        <button
          onClick={() => onDone(value.trim())}
          className="rounded-xl bg-neutral-100 px-3 py-2 text-sm font-medium dark:bg-neutral-800"
        >
          OK
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 pt-1">
        <button onClick={() => onShare(false)} className={action}>
          Share link
        </button>
        {project.invite_token && (
          <button onClick={() => onShare(true)} className={action}>
            Reset link
          </button>
        )}
        {project.members > 1 && (
          <button onClick={onLeave} className={action}>
            Leave
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto rounded-xl px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
        >
          Delete
        </button>
      </div>
    </li>
  )
}
