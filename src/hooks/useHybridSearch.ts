import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { parseDateQuery } from '../lib/dateQuery'
import { embedQuery, indexState, similarities, stopModel, syncIndex, watchIndex } from '../lib/embeddings'
import { buildWordIndex, rankHybrid, recentItems, type HybridItem } from '../lib/hybrid'

const DEBOUNCE_MS = 120
const MIN_LENGTH = 3
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Ranks `items` at each keystroke with letters, words and dates. With `meaning` on, embeddings join in when ready, the
 * index covers `all` so it survives a change of page, and the model runs. With it off, the model is never loaded and
 * one already running is freed at once. `all` is null until everything is loaded.
 */
export function useHybridSearch<T extends HybridItem>(all: T[] | null, items: T[], query: string, meaning: boolean) {
  const index = useMemo(() => buildWordIndex(items), [items])
  const state = useSyncExternalStore(watchIndex, indexState)
  const date = useMemo(() => (query.trim() ? parseDateQuery(query) : null), [query])
  const text = (date ? date.text : query).trim()
  const [vector, setVector] = useState<{ text: string; values: Float32Array } | null>(null)

  useEffect(() => {
    if (!meaning) stopModel()
    else if (all) void syncIndex(all)
  }, [all, meaning])

  useEffect(() => {
    if (!meaning || text.length < MIN_LENGTH) return
    let stale = false
    const timer = setTimeout(() => {
      embedQuery(text).then(
        (values) => {
          if (!stale) setVector({ text, values })
        },
        () => {},
      )
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [text, meaning])

  // `state` changes as the index fills, which brings the new vectors into the results.
  const similarity = useMemo(
    () => (meaning && vector?.text === text ? similarities(vector.values) : null),
    [vector, text, state, meaning],
  )

  const hits = useMemo(
    () => (query.trim() ? rankHybrid({ items, index, text, date, similarity }) : recentItems(items)),
    [items, index, query, text, date, similarity],
  )

  const status =
    state.phase === 'download'
      ? `Loading the search model (279 MB): ${state.percent}%`
      : state.phase === 'index'
        ? `Indexing ${state.done} of ${state.total}…`
        : state.phase === 'busy'
          ? 'Search by meaning is running in another tab.'
        : state.phase === 'failed'
          ? 'Search by meaning unavailable, searching by words.'
          : date
            ? `Created ${DAY.format(date.from)} – ${DAY.format(date.to)}`
            : null
  return { hits, status }
}
