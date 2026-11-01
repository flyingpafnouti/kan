import { useRef, useState } from 'react'
import type { Issue } from '../lib/types'
import { useSwipe } from './useSwipe'

/**
 * Swipe from an open issue to its neighbours in the column. `area` stays mounted around the sheet and `pane` passes
 * from one sheet to the next: each issue has its own, which would end a swipe living inside it halfway through.
 */
export function useIssueSwipe(enabled: boolean, prev: Issue | undefined, next: Issue | undefined, step: (id: string) => void) {
  const area = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  // Set by the sheet while a swipe would lose something: dictation, link palette.
  const [locked, setLocked] = useState(false)

  useSwipe(area, pane, {
    enabled: enabled && !locked,
    hasPrev: Boolean(prev),
    hasNext: Boolean(next),
    overFields: true,
    onSwipe: (dir) => {
      const target = dir < 0 ? prev : next
      if (target) step(target.id)
    },
  })

  return { area, pane, onLock: setLocked }
}
