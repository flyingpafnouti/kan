import { useEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'

const EDGE = 24 // px left to the system back gesture
const LOCK = 10 // px of travel before choosing between a swipe and a vertical scroll
const SLIDE_MS = 180

interface Options {
  enabled: boolean
  hasPrev: boolean
  hasNext: boolean
  /** -1 goes to the previous page, 1 to the next. */
  onSwipe: (dir: -1 | 1) => void
}

/** Horizontal swipe anywhere on `area`: `content` follows the finger, then slides to the next page or back. */
export function useSwipe(area: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, options: Options) {
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })

  useEffect(() => {
    const el = area.current
    if (!el) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let start: { x: number; y: number; t: number } | null = null
    let axis: 'x' | 'y' | null = null
    let dx = 0
    let busy = false
    let timer: number | undefined

    const move = (x: number, ms = 0) => {
      const c = content.current
      if (!c) return
      c.style.transition = ms && !reduced ? `transform ${ms}ms ease-out` : ''
      c.style.transform = x ? `translateX(${x}px)` : ''
    }
    const reset = () => {
      if (axis === 'x') move(0, SLIDE_MS)
      start = null
    }

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      const skip =
        busy ||
        e.touches.length > 1 ||
        !opts.current.enabled ||
        t.clientX < EDGE ||
        t.clientX > innerWidth - EDGE ||
        (e.target instanceof Element && e.target.closest('input, textarea, form'))
      start = skip ? null : { x: t.clientX, y: t.clientY, t: e.timeStamp }
      axis = null
      dx = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!start) return
      // A card drag may have started meanwhile.
      if (!opts.current.enabled || e.touches.length > 1) return reset()
      const x = e.touches[0].clientX - start.x
      const y = e.touches[0].clientY - start.y
      if (!axis) {
        if (Math.max(Math.abs(x), Math.abs(y)) < LOCK) return
        axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y'
      }
      if (axis === 'y') return
      const blocked = x > 0 ? !opts.current.hasPrev : !opts.current.hasNext
      dx = blocked ? x / 4 : x
      move(dx)
    }

    const onEnd = (e: TouchEvent) => {
      if (!start || axis !== 'x') return void (start = null)
      const dir = dx < 0 ? 1 : -1
      const fast = Math.abs(dx) > 30 && Math.abs(dx) / (e.timeStamp - start.t) > 0.4
      const far = Math.abs(dx) > innerWidth / 4
      const allowed = dir === 1 ? opts.current.hasNext : opts.current.hasPrev
      if (!(fast || far) || !allowed) return reset()
      start = null
      if (reduced) return opts.current.onSwipe(dir)
      busy = true
      move(-dir * innerWidth, SLIDE_MS)
      timer = window.setTimeout(() => {
        // Render the new page synchronously so the old one never shows on the incoming side.
        flushSync(() => opts.current.onSwipe(dir))
        move(dir * innerWidth)
        content.current?.getBoundingClientRect() // commit the jump before sliding back in
        move(0, SLIDE_MS)
        timer = window.setTimeout(() => (busy = false), SLIDE_MS)
      }, SLIDE_MS)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', reset)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', reset)
      move(0)
    }
  }, [area, content])
}
