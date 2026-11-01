import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { NOTE_KINDS, PRIORITIES, type Issue, type Note } from '../lib/types'
import { formatDay } from '../lib/date'
import { search } from '../lib/fuzzy'
import { stripImages } from '../lib/images'
import { RateLimitError, loadSmartSearch, saveSmartSearch, smartSearch } from '../lib/smartSearch'
import { toast } from '../lib/toast'
import { MissingKeyError, getGroqKey, setGroqKey } from '../lib/transcribe'
import { askKey } from '../hooks/useDictation'
import { issueFromNote } from '../hooks/useNotes'
import { useScrollLock } from '../hooks/useScrollLock'
import { StatusIcon } from './StatusIcon'
import { SearchIcon, SparkleIcon } from './icons'

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
      nouns="issues"
      onPick={onPick}
      onClose={onClose}
      icon={(issue) => <StatusIcon status={issue.status} size={16} />}
      describe={(issue) => [issue.status, PRIORITIES.find((p) => p.id === issue.priority)?.label].filter(Boolean).join(' ')}
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
  const items = useMemo(() => notes.map((note) => ({ ...note, ...issueFromNote(stripImages(note.body)), note })), [notes])
  return (
    <Palette
      items={items}
      nouns="notes"
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
  created_at: string
  updated_at: string
}

interface Hit<T> {
  item: T
  title: number[]
  body: number[]
}

interface PaletteProps<T extends Searchable> {
  items: T[]
  nouns: string
  onPick: (item: T) => void
  onClose: () => void
  icon?: (item: T) => ReactNode
  badge?: (item: T) => ReactNode
  muted?: (item: T) => boolean
  /** Short tags given to the smart search, such as the status. Without it, the palette has no smart search. */
  describe?: (item: T) => string
  /** Results computed by the caller from `onQuery`, in place of the fuzzy search. */
  ranked?: Hit<T>[]
  onQuery?: (query: string) => void
  /** Line under the results while the smart search has nothing to say. */
  status?: string | null
  /** What the smart search reads, when not all of `items`. */
  smartItems?: T[]
  /** The lighter sparkle, left of the one for Groq: search by meaning, with a local model. */
  meaning?: boolean
  onMeaning?: (on: boolean) => void
}

export function Palette<T extends Searchable>({
  items,
  nouns,
  onPick,
  onClose,
  icon,
  badge,
  muted,
  describe,
  ranked,
  onQuery,
  status,
  smartItems = items,
  meaning = false,
  onMeaning,
}: PaletteProps<T>) {
  useScrollLock()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // With `ranked`, the sparkle is a one-off: left on, it would send Enter to Groq instead of opening a local result.
  const [smart, setSmart] = useState(() => Boolean(describe) && !ranked && loadSmartSearch())
  /** The query being sent to the model, and the answer to the last one. */
  const [asking, setAsking] = useState<string | null>(null)
  const [found, setFound] = useState<{ query: string; ids: string[]; read: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const request = useRef<AbortController | null>(null)
  const text = query.trim()
  const shown = smart && text && (!ranked || found?.query === text) ? found : null

  // An empty query lists the most recently modified items. The smart search keeps this list until it has an answer,
  // then that answer until the next one, so results do not vanish while the query is edited.
  const hits = useMemo((): Hit<T>[] => {
    const plain = (item: T) => ({ item, title: [] as number[], body: [] as number[] })
    if (shown && (shown.ids.length || !ranked)) {
      const byId = new Map(items.map((item) => [item.id, item]))
      return shown.ids.flatMap((id) => byId.get(id) ?? []).map(plain)
    }
    if (ranked) return ranked
    if (text && !smart) return search(items, query).slice(0, LIMIT)
    return [...items]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, LIMIT)
      .map(plain)
  }, [items, query, text, smart, shown, ranked])

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => () => request.current?.abort(), [])

  function cancel() {
    request.current?.abort()
    request.current = null
    setAsking(null)
  }

  function toggle() {
    cancel()
    if (!ranked) saveSmartSearch(!smart)
    setSmart(!smart)
    setActive(0)
    input.current?.focus()
  }

  function setMeaning(on: boolean) {
    onMeaning?.(on)
    input.current?.focus()
  }

  /** Tab walks the power up: none, meaning, Groq, then back to none. */
  function nextLevel() {
    if (!onMeaning) toggle()
    else if (!meaning) setMeaning(true)
    else if (describe && !smart) toggle()
    else {
      if (smart) toggle()
      setMeaning(false)
    }
  }

  async function ask() {
    if (!describe) return
    cancel()
    const controller = new AbortController()
    request.current = controller
    setAsking(text)
    try {
      if (!(await getGroqKey()) && !(await askKey())) return
      const answer = await smartSearch(smartItems, text, describe, controller.signal)
      if (controller.signal.aborted) return
      setFound({ query: text, ...answer })
      setActive(0)
    } catch (e) {
      if (controller.signal.aborted) return
      if (e instanceof MissingKeyError) {
        await setGroqKey(null).catch(() => {})
        toast('Groq key rejected, it will be asked again')
      } else if (e instanceof RateLimitError) toast('Groq rate limit reached, try again later')
      else toast(navigator.onLine ? 'Smart search failed' : 'Smart search unavailable offline')
    } finally {
      if (request.current === controller) {
        request.current = null
        setAsking(null)
      }
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Keeps the page from also handling this Escape as "back".
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab' && !e.shiftKey && (describe || onMeaning)) {
      e.preventDefault()
      nextLevel()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = hits.length
      if (n) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      // Enter sends a new query, then opens the selected result.
      if (smart && text && found?.query !== text) {
        if (asking !== text) void ask()
      } else if (hits[active]) onPick(hits[active].item)
    }
  }

  const hint = !smart
    ? status
    : asking !== null
      ? 'Searching…'
      : text && found?.query !== text
        ? ranked
          ? 'Press Enter to ask Groq (open issues only)'
          : 'Press Enter to search'
        : ranked && found?.ids.length === 0
          ? 'Groq found nothing in the open issues.'
        : found && text && found.read < smartItems.length
          ? `Read the ${found.read} most recently modified of ${smartItems.length} issues.`
          : null

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-safe md:p-6 md:pt-[12vh]">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-2xl bg-white shadow-2xl md:rounded-2xl dark:bg-neutral-900">
        <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 dark:border-neutral-800">
          <SearchIcon className="shrink-0 text-neutral-400" />
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              onQuery?.(e.target.value)
              setActive(0)
              if (!e.target.value.trim()) {
                cancel()
                setFound(null)
              }
            }}
            onKeyDown={onKeyDown}
            placeholder={smart && !ranked ? 'Describe it in your own words…' : `Search ${nouns}…`}
            enterKeyHint={smart ? 'search' : 'go'}
            aria-label={`Search ${nouns}`}
            className="min-w-0 flex-1 bg-transparent py-3.5 outline-none placeholder:text-neutral-400"
          />
          {onMeaning && (
            <button
              type="button"
              aria-label="Search by meaning"
              aria-pressed={meaning}
              title="Search by meaning, on this device (Tab)"
              onClick={() => setMeaning(!meaning)}
              className={`shrink-0 rounded-full p-1 transition ${
                meaning
                  ? 'text-accent'
                  : 'text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400'
              }`}
            >
              <SparkleIcon width={14} height={14} />
            </button>
          )}
          {describe && (
            <button
              type="button"
              aria-label="Smart search"
              aria-pressed={smart}
              title="Smart search (Tab)"
              onClick={toggle}
              className={`-mr-1.5 shrink-0 rounded-full p-1.5 transition ${
                smart
                  ? 'text-accent'
                  : 'text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400'
              }`}
            >
              <SparkleIcon width={18} height={18} className={asking !== null ? 'animate-pulse' : ''} />
            </button>
          )}
        </div>
        <ul ref={list} className="overflow-y-auto p-1.5">
          {hits.length === 0 && <li className="py-8 text-center text-sm text-neutral-400">Nothing found.</li>}
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
                  {(shown || ranked) && body.length === 0 && (
                    <span className="mt-0.5 block truncate text-xs text-neutral-500">
                      {[formatDay(item.created_at), stripImages(item.body).replace(/\s+/g, ' ').trim()]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                {badge?.(item)}
              </button>
            </li>
          ))}
        </ul>
        {hint && (
          <p
            role="status"
            className={`border-t border-neutral-100 px-4 py-2 text-xs text-neutral-400 dark:border-neutral-800 ${
              asking !== null ? 'animate-pulse' : ''
            }`}
          >
            {hint}
          </p>
        )}
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
