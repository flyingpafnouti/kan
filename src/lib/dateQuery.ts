import { parse } from 'chrono-node/fr'

const DAY_MS = 24 * 3600 * 1000
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** A month needs one of these before it: alone, "mars" or "mai" are more often plain words. */
const MONTH = new RegExp(
  `(?:^|\\s)(?:(début|fin)\\s+(?:de\\s+|du mois de\\s+|d')?|(?:en|de|du mois de|au mois de)\\s+|d')(${MONTHS.join('|')}|fevrier|aout|decembre)(?:\\s+(20\\d\\d))?(?=\\s|$)`,
  'i',
)
const LAST_YEAR = /(?:^|\s)(?:de |depuis )?l['’](?:an|ann[ée]e)\s+(?:derni[èe]re?|pass[ée]e?)(?=\s|$)/i
const THIS_YEAR = /(?:^|\s)cette ann[ée]e(?=\s|$)/i
const YEAR = /(?:^|\s)en (20\d\d)(?=\s|$)/i
const THIS_MONTH = /(?:^|\s)ce mois(?:-ci)?(?=\s|$)/i
const LAST_WEEK = /(?:^|\s)(?:de )?la semaine (?:derni[èe]re|pass[ée]e)(?=\s|$)/i
const THIS_WEEK = /(?:^|\s)cette semaine(?=\s|$)/i
/** chrono-node also takes "jeu", "mer" or "mar" for days, and they are more often plain words. */
const DAY_NAME = /(?:lun|mar|mercre|jeu|vendre|same)di|dimanche/i

export interface DateQuery {
  /** The query without its date. */
  text: string
  from: number
  to: number
}

const plain = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const startOfWeek = (d: Date) => startOfDay(d) - ((d.getDay() + 6) % 7) * DAY_MS

function monthRange(match: RegExpMatchArray, now: Date) {
  const name = plain(match[2])
  const month = MONTHS.findIndex((m) => plain(m) === name)
  // Without a year, the last time that month came.
  const year = match[3] ? Number(match[3]) : now.getFullYear() - (month > now.getMonth() ? 1 : 0)
  const from = new Date(year, month, 1).getTime()
  const to = new Date(year, month + 1, 1).getTime()
  const edge = match[1]?.toLowerCase()
  if (edge === 'début') return { from, to: from + 10 * DAY_MS }
  if (edge === 'fin') return { from: to - 10 * DAY_MS, to }
  return { from, to }
}

/** Periods chrono-node does not read in French, or reads as a single day. */
function period(query: string, now: Date): { match: RegExpMatchArray; from: number; to: number } | null {
  const year = now.getFullYear()
  const match = (re: RegExp) => query.match(re)
  let m: RegExpMatchArray | null
  if ((m = match(MONTH))) return { match: m, ...monthRange(m, now) }
  if ((m = match(LAST_YEAR))) return { match: m, from: new Date(year - 1, 0, 1).getTime(), to: new Date(year, 0, 1).getTime() }
  if ((m = match(THIS_YEAR))) return { match: m, from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime() }
  if ((m = match(YEAR))) {
    const y = Number(m[1])
    return { match: m, from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() }
  }
  if ((m = match(THIS_MONTH))) {
    return { match: m, from: new Date(year, now.getMonth(), 1).getTime(), to: new Date(year, now.getMonth() + 1, 1).getTime() }
  }
  if ((m = match(LAST_WEEK))) {
    const monday = startOfWeek(now)
    return { match: m, from: monday - 7 * DAY_MS, to: monday }
  }
  if ((m = match(THIS_WEEK))) {
    const monday = startOfWeek(now)
    return { match: m, from: monday, to: monday + 7 * DAY_MS }
  }
  return null
}

/**
 * Finds the time expression of a French query. Memory is approximate: a period keeps two days of margin on each side,
 * and a day a margin growing with its age.
 */
export function parseDateQuery(query: string, now = new Date()): DateQuery | null {
  const found = period(query, now)
  if (found) {
    const text = query.replace(found.match[0], ' ').trim()
    return { text, from: found.from - 2 * DAY_MS, to: Math.min(found.to + 2 * DAY_MS, now.getTime() + DAY_MS) }
  }
  const result = parse(query, now, { forwardDate: false }).find((r) => {
    // "14h" alone says nothing about when an item was created.
    return r.start.isCertain('day') || r.start.isCertain('month') || (r.start.isCertain('weekday') && DAY_NAME.test(r.text))
  })
  if (!result) return null
  const text = (query.slice(0, result.index) + ' ' + query.slice(result.index + result.text.length)).trim()
  const date = result.start.date()
  if (result.start.isCertain('month') && !result.start.isCertain('day')) {
    const from = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
    const to = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
    return { text, from: from - 2 * DAY_MS, to: to + 2 * DAY_MS }
  }
  const day = startOfDay(date)
  const age = Math.max(0, (now.getTime() - day) / DAY_MS)
  const margin = (1 + Math.round(age * 0.2)) * DAY_MS
  return { text, from: day - margin, to: day + DAY_MS + margin }
}
