import MiniSearch from 'minisearch'
import { search } from './fuzzy'
import { stripImages } from './images'
import type { DateQuery } from './dateQuery'

const RRF_K = 60
const LIST_SIZE = 40
const RESULTS = 50
/**
 * Lowest cosine accepted from the embeddings. On a French sample, good matches had a median of 0.53 and unrelated
 * queries never passed 0.41: every text gets a neighbour, so without this bound the list would fill with noise.
 */
export const MIN_SIMILARITY = 0.42
/** A finished item stays findable but gives way to an open one of equal relevance. */
const DONE_WEIGHT = 0.8

const STOP_WORDS = new Set(
  `a au aux avec ce ces cette d de des du elle en et il j je l la le les leur lui ma mes moi mon n ne nos notre nous on ou
  par pas pour qu que qui s sa se ses si son sur t ta te tes toi ton tu un une vos votre vous y truc chose machin ticket
  issue note bug`.split(/\s+/),
)

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export interface HybridItem {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  done?: boolean
}

/** Word index: BM25 with prefixes and typos allowed. */
export function buildWordIndex<T extends HybridItem>(items: T[]) {
  const index = new MiniSearch<T>({
    fields: ['title', 'text'],
    storeFields: [],
    extractField: (item, field) => (field === 'text' ? stripImages(item.body) : (item as unknown as Record<string, string>)[field]),
    processTerm: (term) => {
      const word = fold(term)
      return STOP_WORDS.has(word) ? false : word
    },
  })
  index.addAll(items)
  return index
}

/** Each list votes 1 / (RRF_K + rank): an item well placed in several lists beats the first of a single one. */
export function fuseRanks(lists: string[][]) {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
  }
  return scores
}

interface RankInput<T extends HybridItem> {
  items: T[]
  index: MiniSearch<T>
  /** The query without its date. */
  text: string
  date: DateQuery | null
  /** Cosine of each item with the query, when the embeddings are ready. */
  similarity: Map<string, number> | null
}

/** Merges three rankings: letters in order (the plain search, also the source of highlights), BM25 and embeddings. */
export function rankHybrid<T extends HybridItem>({ items, index, text, date, similarity }: RankInput<T>) {
  const inRange = (item: T) => {
    if (!date) return true
    const created = Date.parse(item.created_at)
    return created >= date.from && created < date.to
  }
  const candidates = items.filter(inRange)
  const plain = (item: T) => ({ item, title: [] as number[], body: [] as number[] })
  if (!text.trim()) {
    return [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, RESULTS).map(plain)
  }

  const allowed = new Set(candidates.map((item) => item.id))
  const letters = search(candidates, text, true)
  const words = index
    .search(text, {
      boost: { title: 2 },
      combineWith: 'OR',
      prefix: (term) => term.length >= 3,
      fuzzy: (term) => (term.length >= 8 ? 2 : term.length >= 5 ? 1 : false),
    })
    .map((hit) => String(hit.id))
    .filter((id) => allowed.has(id))
    .slice(0, LIST_SIZE)
  const meaning = [...(similarity ?? [])]
    .filter(([id, cosine]) => cosine >= MIN_SIMILARITY && allowed.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIST_SIZE)
    .map(([id]) => id)

  const scores = fuseRanks([letters.slice(0, LIST_SIZE).map((hit) => hit.item.id), words, meaning])
  // "Bug du mois dernier": nothing but the date carries any meaning.
  if (!scores.size && date) {
    return [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, RESULTS).map(plain)
  }
  const byId = new Map(candidates.map((item) => [item.id, item]))
  const marks = new Map(letters.map((hit) => [hit.item.id, hit]))
  return [...scores]
    .map(([id, score]) => ({ id, score: score * (byId.get(id)?.done ? DONE_WEIGHT : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULTS)
    .map(({ id }) => {
      const hit = marks.get(id)
      return { item: byId.get(id)!, title: hit?.title ?? [], body: hit?.body ?? [] }
    })
}

/** How a hybrid search reads a recent list: open items first. */
export function recentItems<T extends HybridItem>(items: T[]) {
  return items
    .filter((item) => !item.done)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, RESULTS)
    .map((item) => ({ item, title: [] as number[], body: [] as number[] }))
}
