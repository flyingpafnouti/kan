import { useEffect, useState } from 'react'
import { STATUSES, type Issue, type Status } from '../lib/types'

interface Options {
  enabled: boolean
  /** Issues of a column, as displayed. */
  column: (s: Status) => Issue[]
  /** Touch layout: the only column shown, kept in sync with the selection. */
  tab?: Status
  setTab?: (s: Status) => void
  onOpen: (id: string) => void
  onStatus: (id: string, s: Status) => void
  /** Moves the issue one slot up (-1) or down (1) in its column; absent where the order is computed. */
  onReorder?: (id: string, dir: -1 | 1) => void
}

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/**
 * Keyboard selection on a board: arrows move it between issues and columns, Enter opens the issue,
 * Alt + ↑/↓ reorders it and Alt + ←/→ changes its status. Escape or Backspace clears the selection first.
 */
export function useIssueKeys({ enabled, column, tab, setTab, onOpen, onStatus, onReorder }: Options) {
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (selected) document.querySelector(`[data-issue-id="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, tab])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.isComposing) return

      const current = STATUSES.map((s) => s.id).find((s) => column(s).some((x) => x.id === selected))
      if ((e.key === 'Escape' || e.key === 'Backspace') && current) {
        e.preventDefault()
        return setSelected(null)
      }
      if (e.key === 'Enter' && current && !e.altKey) {
        e.preventDefault()
        return onOpen(selected!)
      }
      if (!ARROWS.includes(e.key) || (e.altKey && !current)) return
      // Also keeps Alt + ← from going back in the browser history.
      e.preventDefault()

      if (!current) {
        const start = tab ?? STATUSES.map((s) => s.id).find((s) => column(s).length) ?? 'todo'
        const first = column(start)[0]
        if (first) setSelected(first.id)
        return
      }

      const col = column(current)
      const i = col.findIndex((x) => x.id === selected)
      const ci = STATUSES.findIndex((s) => s.id === current)
      const vertical = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      const horizontal = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0

      if (e.altKey) {
        if (vertical) onReorder?.(selected!, vertical)
        else if (STATUSES[ci + horizontal]) {
          const target = STATUSES[ci + horizontal].id
          onStatus(selected!, target)
          setTab?.(target)
        }
        return
      }

      if (vertical) {
        const next = col[i + vertical]
        if (next) setSelected(next.id)
        return
      }
      // Next non-empty column in that direction, at the same height when possible.
      for (let c = ci + horizontal; c >= 0 && c < STATUSES.length; c += horizontal) {
        const target = column(STATUSES[c].id)
        if (!target.length) continue
        setSelected(target[Math.min(i, target.length - 1)].id)
        setTab?.(STATUSES[c].id)
        return
      }
    }
    // Capture phase: runs before the page's own Escape handler, so Escape clears the selection first.
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  })

  /** Issue above (-1) or below (1) `id` in its displayed column. */
  function sibling(id: string, dir: -1 | 1): Issue | undefined {
    for (const { id: s } of STATUSES) {
      const col = column(s)
      const i = col.findIndex((x) => x.id === id)
      if (i >= 0) return col[i + dir]
    }
  }

  return { selected, setSelected, sibling }
}
