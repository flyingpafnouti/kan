import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { NOTE_KINDS, PRIORITIES, type Issue, type Note } from '../lib/types'
import { search } from '../lib/fuzzy'
import { issueFromNote } from '../hooks/useNotes'
import { useScrollLock } from '../hooks/useScrollLock'
import { StatusIcon } from './StatusIcon'
import { SearchIcon } from './icons'

const LIMIT = 50
const CONTEXT = 24 // characters of body shown before the first match

/** Fuzzy search over the board's issues, opened with "/". */
export function SearchPalette({
  issues,
  onPick,
  onClose,
}: {
  issues: Issue[]
  onPick: (issue: Issue) => void
  onClose: () => void
}) {
  return (
    <Palette
      items={issues}
      noun="issue"
      onPick={onPick}
      onClose={onClose}
      icon={(issue) => <StatusIcon status={issue.status} size={16} />}
      muted={(issue) => issue.status === 'done'}
      badge={(issue) => {
        const priority = PRIORITIES.find((p) => p.id === issue.priority)
        return (
          priority && (
            <span className={`mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-medium ring-1 ${priority.chip}`}>
              {priority.label}
            </span>
          )
        )
      }}
    />
  )
}

/**
 * Fuzzy search over the notes, opened with "/". The first sentence plays the title, as when a note becomes an issue,
 * and each hit tells its type.
 */
export function NoteSearchPalette({
  notes,
  onPick,
  onClose,
}: {
  notes: Note[]
  onPick: (note: Note) => void
  onClose: () => void
}) {
  const items = useMemo(() => notes.map((note) => ({ ...note, ...issueFromNote(note.body), note })), [notes])
  return (
    <Palette
      items={items}
      noun="note"
      onPick={(item) => onPick(item.note)}
      onClose={onClose}
      badge={(item) => (
        <span className="mt-0.5 shrink-0 text-xs text-neutral-400">
          {NOTE_KINDS.find((k) => k.id === (item.kind ?? 'pro'))?.label}
        </span>
      )}
    />
  )
}

interface Searchable {
  id: string
  title: string
  body: string
  updated_at: string
}

interface PaletteProps<T extends Searchable> {
  items: T[]
  noun: string
  onPick: (item: T) => void
  onClose: () => void
  icon?: (item: T) => ReactNode
  badge?: (item: T) => ReactNode
  muted?: (item: T) => boolean
}

function Palette<T extends Searchable>({ items, noun, onPick, onClose, icon, badge, muted }: PaletteProps<T>) {
  useScrollLock()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // An empty query lists the most recently modified items.
  const hits = useMemo(
    () =>
      query.trim()
        ? search(items, query).slice(0, LIMIT)
        : [...items]
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, LIMIT)
            .map((item) => ({ item, title: [] as number[], body: [] as number[] })),
    [items, query],
  )

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Keeps the page from also handling this Escape as "back".
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = hits.length
      if (n) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (hits[active]) onPick(hits[active].item)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-safe md:p-6 md:pt-[12vh]">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-2xl bg-white shadow-2xl md:rounded-2xl dark:bg-neutral-900">
        <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 dark:border-neutral-800">
          <SearchIcon className="shrink-0 text-neutral-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={`Search ${noun}s…`}
            enterKeyHint="go"
            aria-label={`Search ${noun}s`}
            className="min-w-0 flex-1 bg-transparent py-3.5 outline-none placeholder:text-neutral-400"
          />
        </div>
        <ul ref={list} className="overflow-y-auto p-1.5">
          {hits.length === 0 && <li className="py-8 text-center text-sm text-neutral-400">No {noun} found.</li>}
          {hits.map(({ item, title, body }, i) => (
            <li key={item.id}>
              <button
                onClick={() => onPick(item)}
                onMouseMove={() => setActive(i)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                  i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                }`}
              >
                {icon && <span className="mt-0.5 shrink-0">{icon(item)}</span>}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[15px] ${muted?.(item) ? 'text-neutral-400' : ''}`}>
                    <Highlight text={Array.from(item.title)} indices={title} />
                  </span>
                  {body.length > 0 && <Snippet body={item.body} indices={body} />}
                </span>
                {badge?.(item)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** One line of the body starting a little before the first match. */
function Snippet({ body, indices }: { body: string; indices: number[] }) {
  const from = Math.max(0, Math.min(...indices) - CONTEXT)
  const chars = Array.from(body.replace(/\s/g, ' ')).slice(from)
  return (
    <span className="mt-0.5 block truncate text-xs text-neutral-500">
      {from > 0 && '…'}
      <Highlight text={chars} indices={indices.map((i) => i - from)} />
    </span>
  )
}

/** `text` is split into characters so indices match those of the search. */
function Highlight({ text, indices }: { text: string[]; indices: number[] }) {
  if (!indices.length) return text.join('')
  const marked = new Set(indices)
  return text.map((c, i) =>
    marked.has(i) ? (
      <mark key={i} className="bg-transparent font-semibold text-accent">
        {c}
      </mark>
    ) : (
      c
    ),
  )
}
