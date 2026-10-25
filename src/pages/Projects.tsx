import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { navigate } from '../lib/router'
import { useProjects, type ProjectRow } from '../hooks/useProjects'
import { ChevronIcon, MoreIcon, PlusIcon } from '../components/icons'

export function Projects() {
  const { projects, create, rename, remove } = useProjects()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

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
        <h1 className="text-2xl font-semibold tracking-tight">Projets</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-lg px-2 py-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Déconnexion
        </button>
      </header>

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
                if (confirm(`Supprimer « ${p.name} » et toutes ses issues ?`)) remove(p.id)
                setEditing(null)
              }}
            />
          ) : (
            <li key={p.id} className="flex items-center rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800">
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

      {projects?.length === 0 && <p className="py-8 text-center text-neutral-500">Aucun projet pour l'instant.</p>}

      {projects && (
        <form onSubmit={submit} className="mt-4 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nouveau projet"
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-2xl border border-dashed border-neutral-300 bg-transparent px-4 py-3.5 outline-none focus:border-accent focus:border-solid dark:border-neutral-700"
          />
          <button
            aria-label="Créer"
            disabled={!name.trim()}
            className="rounded-2xl bg-accent p-3.5 text-white transition disabled:opacity-30"
          >
            <PlusIcon />
          </button>
        </form>
      )}
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
        Supprimer
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
