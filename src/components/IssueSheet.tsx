import { useEffect, useRef, useState } from 'react'
import { PRIORITIES, STATUSES, type Issue, type Priority, type Status } from '../lib/types'
import { StatusIcon } from './StatusIcon'

interface Props {
  issue: Issue
  onSave: (patch: { title?: string; body?: string }) => void
  onStatus: (s: Status) => void
  onPriority: (p: Priority | null) => void
  onDelete: () => void
  onClose: () => void
}

const SAVE_DELAY = 600

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const formatDate = (iso: string) => `${DAY.format(new Date(iso))} à ${TIME.format(new Date(iso))}`

export function IssueSheet({ issue, onSave, onStatus, onPriority, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef({ title: issue.title, body: issue.body })
  const timer = useRef<number>(undefined)

  // Commit pending text, debounced while typing and immediately on close.
  const flush = (t = title, b = body) => {
    clearTimeout(timer.current)
    const patch: { title?: string; body?: string } = {}
    if (t.trim() && t.trim() !== saved.current.title) patch.title = t.trim()
    if (b !== saved.current.body) patch.body = b
    if (Object.keys(patch).length) {
      saved.current = { title: patch.title ?? saved.current.title, body: patch.body ?? saved.current.body }
      onSave(patch)
    }
  }
  const schedule = (t: string, b: string) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => flush(t, b), SAVE_DELAY)
  }
  const close = () => {
    flush()
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={close} />
      <div className="animate-sheet relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <AutoTextarea
            value={title}
            onChange={(v) => {
              const t = v.replace(/\n/g, ' ')
              setTitle(t)
              schedule(t, body)
            }}
            className="text-lg font-semibold"
            placeholder="Titre"
          />
          <AutoTextarea
            value={body}
            onChange={(v) => {
              setBody(v)
              schedule(title, v)
            }}
            className="mt-2 min-h-28 text-[15px] text-neutral-700 dark:text-neutral-300"
            placeholder="Notes…"
          />
          <p className="pt-3 pb-3 text-xs text-neutral-400">Modifié le {formatDate(issue.updated_at)}</p>
        </div>
        <div className="space-y-3 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <div className="grid grid-cols-4 gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                aria-pressed={issue.priority === p.id}
                // Tapping the active priority clears it.
                onClick={() => onPriority(issue.priority === p.id ? null : p.id)}
                className={`rounded-xl py-1.5 text-sm font-medium ring-1 transition ${
                  issue.priority === p.id ? p.chip : 'text-neutral-500 ring-neutral-200 dark:ring-neutral-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {STATUSES.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onStatus(id)}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium ring-1 transition ${
                  issue.status === id
                    ? 'bg-accent/10 text-accent ring-accent'
                    : 'text-neutral-500 ring-neutral-200 dark:ring-neutral-800'
                }`}
              >
                <StatusIcon status={id} size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
              className="rounded-lg py-1 text-sm text-red-500"
            >
              {confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}
            </button>
            <button onClick={close} className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  className: string
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`block w-full resize-none bg-transparent outline-none placeholder:text-neutral-400 ${className}`}
    />
  )
}
