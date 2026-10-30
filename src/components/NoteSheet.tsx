import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Note, NoteKind, Project } from '../lib/types'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useScrollLock } from '../hooks/useScrollLock'
import { formatDate } from '../lib/date'
import { MarkdownField } from './Markdown'
import { DictationButton } from './DictationButton'
import { PostProcessButton } from './PostProcessButton'
import { GripIcon } from './icons'
import { KindSwitch } from './KindSwitch'

interface Props {
  note: Note
  projects: Project[] | null
  onSave: (body: string) => void
  onKind: (kind: NoteKind) => void
  onDelete: () => void
  /** Turns the note, with its latest text, into an issue of that project. */
  onToIssue: (projectId: string, body: string) => void
  onClose: () => void
}

type Size = { w: number; h: number }

const SIZE_KEY = 'note-size'
const MIN_W = 320
const MIN_H = 240
/** Room kept around the panel, matches md:p-6. */
const GUTTER = 48

/** Size the user dragged the panel to, kept on this device for the next notes. */
function storedSize(): Size | null {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null')
    return typeof s?.w === 'number' && typeof s?.h === 'number' ? s : null
  } catch {
    return null
  }
}

function storeSize(s: Size | null) {
  try {
    if (s) localStorage.setItem(SIZE_KEY, JSON.stringify(s))
    else localStorage.removeItem(SIZE_KEY)
  } catch {
    /* storage unavailable: the size lasts until the sheet closes */
  }
}

export function NoteSheet({ note, projects, onSave, onKind, onDelete, onToIssue, onClose }: Props) {
  const [body, setBody] = useState(note.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef(note.body)
  const latest = useRef(body)
  latest.current = body
  /** Deleted or turned into an issue: nothing left to save. */
  const ended = useRef(false)
  useScrollLock()
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [size, setSize] = useState(storedSize)
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } & Size>(undefined)

  // Saved once, on close, rather than while typing. An emptied note is not saved (the server refuses it)
  // and goes away on close.
  const flush = () => {
    const b = latest.current
    if (ended.current || !b.trim() || b === saved.current) return
    saved.current = b
    onSave(b)
  }
  const end = () => {
    ended.current = true
  }
  const close = () => {
    if (!body.trim()) {
      end()
      return onDelete()
    }
    flush()
    onClose()
  }

  // Safety net for edits that never reach close: the app sent to the background (and maybe killed),
  // or the sheet unmounted by a navigation.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])

  const dictation = useDictation((text) => {
    setBody(body.trim() ? `${body.trimEnd()}${body.endsWith('\n') ? '' : ' '}${text}` : text)
  })

  // The panel is centered: it grows on both sides, hence twice the pointer move to keep the corner under it.
  const resize = {
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = panel.current!.getBoundingClientRect()
      drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      setSize({
        w: Math.min(innerWidth - GUTTER, Math.max(MIN_W, d.w + 2 * (e.clientX - d.x))),
        h: Math.min(innerHeight - GUTTER, Math.max(MIN_H, d.h + 2 * (e.clientY - d.y))),
      })
    },
    onPointerUp: () => {
      drag.current = undefined
      const r = panel.current!.getBoundingClientRect()
      storeSize({ w: Math.round(r.width), h: Math.round(r.height) })
    },
    onDoubleClick: () => {
      setSize(null)
      storeSize(null)
    },
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape, or Ctrl / ⌘ + Enter from the text.
      if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing)) return
      e.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade bg-black/40" onClick={close} />
      <div
        ref={panel}
        style={
          desktop && size
            ? { width: size.w, height: size.h, maxWidth: `calc(100vw - ${GUTTER}px)`, maxHeight: `calc(100dvh - ${GUTTER}px)` }
            : undefined
        }
        className="relative flex max-h-[85dvh] w-full max-w-lg animate-sheet flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <MarkdownField
            value={body}
            onChange={setBody}
            className="min-h-32 text-[15px] leading-relaxed"
            placeholder={
              dictation.state === 'recording' ? 'Speak…' : dictation.state === 'transcribing' ? 'Transcribing…' : 'Idea…'
            }
          />
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-xs text-neutral-400">
              {dictation.state === 'transcribing' ? 'Transcribing…' : `Edited ${formatDate(note.updated_at)}`}
            </p>
            {dictationSupported && (
              <DictationButton dictation={dictation} label="Dictate">
                <PostProcessButton text={body} onResult={setBody} />
              </DictationButton>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <button
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true)
              end()
              onDelete()
            }}
            className="rounded-lg py-1 text-sm text-red-500"
          >
            {confirmDelete ? 'Confirm deletion' : 'Delete'}
          </button>
          <KindSwitch value={note.kind ?? 'pro'} onChange={onKind} />
          {projects && projects.length > 0 && (
            <select
              value=""
              disabled={!body.trim()}
              onChange={(e) => {
                end()
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
        {desktop && (
          <div
            {...resize}
            title="Drag to resize, double-click to reset"
            className="absolute right-0 bottom-0 cursor-nwse-resize touch-none p-1 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400"
          >
            <GripIcon width={14} height={14} />
          </div>
        )}
      </div>
    </div>
  )
}
