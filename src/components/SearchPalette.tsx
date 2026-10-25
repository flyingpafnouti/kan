import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { PRIORITIES, type Issue } from '../lib/types'
import { search } from '../lib/fuzzy'
import { StatusIcon } from './StatusIcon'
import { SearchIcon } from './icons'

const LIMIT = 50
const CONTEXT = 24 // characters of body shown before the first match

interface Props {
  issues: Issue[]
  onPick: (issue: Issue) => void
  onClose: () => void
}

/** Fuzzy search over the board's issues, opened with "/". */
export function SearchPalette({ issues, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // An empty query lists the most recently modified issues.
  const hits = useMemo(
    () =>
      query.trim()
        ? search(issues, query).slice(0, LIMIT)
        : [...issues]
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, LIMIT)
            .map((item) => ({ item, title: [] as number[], body: [] as number[] })),
    [issues, query],
  )

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Keeps the board from also handling this Escape as "back to projects".
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
            placeholder="Rechercher une issue…"
            enterKeyHint="go"
            aria-label="Rechercher une issue"
            className="min-w-0 flex-1 bg-transparent py-3.5 outline-none placeholder:text-neutral-400"
          />
        </div>
        <ul ref={list} className="overflow-y-auto p-1.5">
          {hits.length === 0 && <li className="py-8 text-center text-sm text-neutral-400">Aucune issue trouvée.</li>}
          {hits.map(({ item, title, body }, i) => {
            const priority = PRIORITIES.find((p) => p.id === item.priority)
            return (
              <li key={item.id}>
                <button
                  onClick={() => onPick(item)}
                  onMouseMove={() => setActive(i)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                    i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={item.status} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] ${item.status === 'done' ? 'text-neutral-400' : ''}`}>
                      <Highlight text={Array.from(item.title)} indices={title} />
                    </span>
                    {body.length > 0 && <Snippet body={item.body} indices={body} />}
                  </span>
                  {priority && (
                    <span className={`mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-medium ring-1 ${priority.chip}`}>
                      {priority.label}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
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
