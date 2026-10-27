import { useEffect, useRef, useState } from 'react'
import type { Note } from '../lib/types'
import type { ProjectRow } from '../hooks/useProjects'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { formatDate } from '../lib/date'
import { AutoTextarea } from './AutoTextarea'
import { DictationButton } from './DictationButton'

interface Props {
  note: Note
  projects: ProjectRow[] | null
  onSave: (body: string) => void
  onDelete: () => void
  /** Turns the note, with its latest text, into an issue of that project. */
  onToIssue: (projectId: string, body: string) => void
  onClose: () => void
}

const SAVE_DELAY = 600

export function NoteSheet({ note, projects, onSave, onDelete, onToIssue, onClose }: Props) {
  const [body, setBody] = useState(note.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef(note.body)
  const timer = useRef<number>(undefined)

  // An emptied note is not saved (the server refuses it) and goes away on close.
  const flush = (b = body) => {
    clearTimeout(timer.current)
    if (!b.trim() || b === saved.current) return
    saved.current = b
    onSave(b)
  }
  const schedule = (b: string) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => flush(b), SAVE_DELAY)
  }
  const close = () => {
    if (!body.trim()) return onDelete()
    flush()
    onClose()
  }

  const dictation = useDictation((text) => {
    const b = body.trim() ? `${body.trimEnd()}${body.endsWith('\n') ? '' : ' '}${text}` : text
    setBody(b)
    schedule(b)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade bg-black/40" onClick={close} />
      <div className="relative flex max-h-[85dvh] w-full max-w-lg animate-sheet flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <AutoTextarea
            value={body}
            onChange={(v) => {
              setBody(v)
              schedule(v)
            }}
            className="min-h-32 text-[15px] leading-relaxed"
            placeholder={
              dictation.state === 'recording' ? 'Speak…' : dictation.state === 'transcribing' ? 'Transcribing…' : 'Idea…'
            }
          />
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-xs text-neutral-400">
              {dictation.state === 'transcribing' ? 'Transcribing…' : `Edited ${formatDate(note.updated_at)}`}
            </p>
            {dictationSupported && <DictationButton dictation={dictation} label="Dictate" />}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <button
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className="rounded-lg py-1 text-sm text-red-500"
          >
            {confirmDelete ? 'Confirm deletion' : 'Delete'}
          </button>
          {projects && projects.length > 0 && (
            <select
              value=""
              disabled={!body.trim()}
              onChange={(e) => {
                clearTimeout(timer.current)
                onToIssue(e.target.value, body)
              }}
              aria-label="Make it an issue"
              className="ml-auto min-w-0 max-w-44 truncate rounded-xl bg-transparent py-1.5 pr-2 pl-3 font-medium text-accent ring-1 ring-accent/40 outline-none disabled:opacity-30"
            >
              <option value="" disabled>
                To issue…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={close}
            className={`${projects?.length ? '' : 'ml-auto'} shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
