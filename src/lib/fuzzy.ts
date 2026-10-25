/** Lowercase without accents, one entry per original character so match indices map back to the text. */
const fold = (s: string) => Array.from(s, (c) => c.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase())

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

interface Alignment {
  score: number
  indices: number[]
}

/**
 * Best subsequence alignment of `q` in `t`, rewarding consecutive letters and word starts.
 * `maxSpan` bounds how far apart the matched letters may lie.
 */
function align(q: string[], t: string[], maxSpan = Infinity): Alignment | null {
  let best: Alignment | null = null
  for (let start = t.indexOf(q[0]); start >= 0; start = t.indexOf(q[0], start + 1)) {
    const end = Math.min(t.length, start + maxSpan)
    const indices = [start]
    for (let i = start + 1; indices.length < q.length && i < end; i++) {
      if (t[i] === q[indices.length]) indices.push(i)
    }
    if (indices.length < q.length) {
      if (end === t.length) break // later starts cannot match either
      continue
    }
    let score = 0
    indices.forEach((i, k) => {
      score += 1
      if (k > 0 && i === indices[k - 1] + 1) score += 3
      else if (k > 0) score -= Math.min(i - indices[k - 1] - 1, 6) * 0.3
      if (!isWordChar(t[i - 1])) score += 2
    })
    score -= Math.min(start, 50) * 0.02
    if (!best || score > best.score) best = { score, indices }
  }
  return best
}

export interface SearchHit<T> {
  item: T
  score: number
  /** Matched character positions, for highlighting. */
  title: number[]
  body: number[]
}

/**
 * Every query word must match the title or the body with its letters in order.
 * In the body the letters must stay close together: a long text contains almost any scattered sequence.
 */
export function search<T extends { title: string; body: string }>(items: T[], query: string): SearchHit<T>[] {
  const words = query.trim().split(/\s+/).filter(Boolean).map(fold)
  const hits: SearchHit<T>[] = []
  for (const item of items) {
    const title = fold(item.title)
    const body = fold(item.body)
    const hit: SearchHit<T> = { item, score: 0, title: [], body: [] }
    const ok = words.every((w) => {
      const t = align(w, title)
      const b = align(w, body, w.length * 2 + 2)
      // Title matches weigh double.
      if (t && (!b || t.score * 2 >= b.score)) {
        hit.score += t.score * 2
        hit.title.push(...t.indices)
      } else if (b) {
        hit.score += b.score
        hit.body.push(...b.indices)
      }
      return Boolean(t || b)
    })
    if (ok) hits.push(hit)
  }
  return hits.sort((a, b) => b.score - a.score)
}
