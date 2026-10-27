import { useEffect, useRef, useState } from 'react'
import { PRIORITIES, STATUSES, type Issue, type Priority, type Status } from '../lib/types'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { formatDate } from '../lib/date'
import { StatusIcon } from './StatusIcon'
import { AutoTextarea } from './AutoTextarea'
import { MarkdownField } from './Markdown'
import { DictationButton } from './DictationButton'
import { ChevronIcon } from './icons'
import type { ProjectRow } from '../hooks/useProjects'

interface Props {
  issue: Issue
  onSave: (patch: { title?: string; body?: string }) => void
  onStatus: (s: Status) => void
  onPriority: (p: Priority | null) => void
  onDelete: () => void
  onClose: () => void
  /** Previous / next issue of the same column (Alt + ↑ / ↓), absent at the ends. Alt + ← / → calls onStatus. */
  onPrev?: () => void
  onNext?: () => void
  /** Reached from a neighbour: no opening animation. */
  instant?: boolean
  /** Targets of "Copy to…", which gets the latest text. */
  projects?: ProjectRow[] | null
  onCopy?: (projectId: string, text: { title: string; body: string }) => void
}

const SAVE_DELAY = 600

export function IssueSheet({
  issue,
  onSave,
  onStatus,
  onPriority,
  onDelete,
  onClose,
  onPrev,
  onNext,
  instant,
  projects,
  onCopy,
}: Props) {
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
  const step = (go?: () => void) => {
    if (!go) return
    flush()
    go()
  }

  // The transcript is appended to the notes; a result landing after close is still saved by the pending timer.
  const dictation = useDictation((text) => {
    const b = body.trim() ? `${body.trimEnd()}${body.endsWith('\n') ? '' : ' '}${text}` : text
    setBody(b)
    schedule(title, b)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt + ↑ / ↓ has no use in a text field on Linux and Windows, so it works with the cursor in the notes.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.isComposing) {
        e.preventDefault()
        return step(e.key === 'ArrowUp' ? onPrev : onNext)
      }
      // Alt + ← / → moves the issue to the neighbouring column, like on the board.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.isComposing) {
        e.preventDefault()
        const target = STATUSES[STATUSES.findIndex((s) => s.id === issue.status) + (e.key === 'ArrowLeft' ? -1 : 1)]
        if (target) onStatus(target.id)
        return
      }
      if (e.key !== 'Escape') return
      // Keeps the board from also handling this Escape as "back to projects".
      e.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className={`absolute inset-0 bg-black/40 ${instant ? '' : 'animate-fade'}`} onClick={close} />
      <div
        className={`relative ${instant ? '' : 'animate-sheet'} flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <AutoTextarea
                value={title}
                onChange={(v) => {
                  const t = v.replace(/\n/g, ' ')
                  setTitle(t)
                  schedule(t, body)
                }}
                className="text-lg font-semibold"
                placeholder="Title"
              />
            </div>
            {(onPrev || onNext) && (
              <div className="-mr-2 flex shrink-0">
                <button
                  onClick={() => step(onPrev)}
                  disabled={!onPrev}
                  aria-label="Previous issue"
                  title="Previous issue (Alt ↑)"
                  className="rounded-lg p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronIcon width={18} height={18} className="-rotate-90" />
                </button>
                <button
                  onClick={() => step(onNext)}
                  disabled={!onNext}
                  aria-label="Next issue"
                  title="Next issue (Alt ↓)"
                  className="rounded-lg p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronIcon width={18} height={18} className="rotate-90" />
                </button>
              </div>
            )}
          </div>
          <MarkdownField
            value={body}
            onChange={(v) => {
              setBody(v)
              schedule(title, v)
            }}
            className="mt-2 min-h-28 text-[15px] text-neutral-700 dark:text-neutral-300"
            placeholder={
              dictation.state === 'recording'
                ? 'Speak…'
                : dictation.state === 'transcribing'
                  ? 'Transcribing…'
                  : 'Notes…'
            }
          />
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-xs text-neutral-400">
              {dictation.state === 'transcribing' ? 'Transcribing…' : `Edited ${formatDate(issue.updated_at)}`}
            </p>
            {dictationSupported && <DictationButton dictation={dictation} label="Dictate notes" />}
          </div>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
              className="rounded-lg py-1 text-sm text-red-500"
            >
              {confirmDelete ? 'Confirm deletion' : 'Delete'}
            </button>
            {onCopy && projects && projects.length > 0 && (
              // Kept quiet on purpose: a plain grey label that opens the native project picker.
              <select
                value=""
                onChange={(e) => {
                  flush()
                  onCopy(e.target.value, { title: title.trim() || issue.title, body })
                }}
                aria-label="Copy to another project"
                className="ml-auto min-w-0 max-w-36 truncate bg-transparent py-1 text-right text-sm text-neutral-400 outline-none hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <option value="" disabled>
                  Copy to…
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === issue.project_id ? `${p.name} (here)` : p.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={close}
              className={`${onCopy && projects?.length ? '' : 'ml-auto'} shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
