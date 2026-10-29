import { useEffect } from 'react'

let locks = 0

/**
 * Freezes the page behind an open sheet or palette: otherwise the wheel (or a swipe) over the backdrop scrolls the
 * list underneath. The scrollbar keeps its room (scrollbar-gutter in index.css), so the page does not shift.
 */
export function useScrollLock() {
  useEffect(() => {
    if (locks++ === 0) document.documentElement.style.overflow = 'hidden'
    return () => {
      if (--locks === 0) document.documentElement.style.overflow = ''
    }
  }, [])
}
