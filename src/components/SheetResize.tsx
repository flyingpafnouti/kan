import { useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { GripIcon } from './icons'

type Size = { w: number; h: number }

const MIN_W = 320
const MIN_H = 240
/** Room kept around the panel, matches md:p-6. */
const GUTTER = 48

/** Size the user dragged a sheet to, kept on this device for the next ones. */
function storedSize(key: string): Size | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null')
    return typeof s?.w === 'number' && typeof s?.h === 'number' ? s : null
  } catch {
    return null
  }
}

function storeSize(key: string, s: Size | null) {
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s))
    else localStorage.removeItem(key)
  } catch {
    /* storage unavailable: the size lasts until the sheet closes */
  }
}

/**
 * Size of a centered sheet, dragged from its bottom right corner on a desktop and kept under `key`.
 * `style` goes on the panel, `grip` on the SheetGrip; on a phone both are inert.
 */
export function useSheetSize(key: string, panel: RefObject<HTMLDivElement | null>) {
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [size, setSize] = useState(() => storedSize(key))
  const drag = useRef<{ x: number; y: number } & Size>(undefined)
  // The panel is centered: it grows on both sides, hence twice the pointer move to keep the corner under it.
  const grip = {
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = panel.current!.getBoundingClientRect()
      drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      setSize({
        w: Math.min(innerWidth - GUTTER, Math.max(MIN_W, d.w + 2 * (e.clientX - d.x))),
        h: Math.min(innerHeight - GUTTER, Math.max(MIN_H, d.h + 2 * (e.clientY - d.y))),
      })
    },
    onPointerUp: () => {
      drag.current = undefined
      const r = panel.current!.getBoundingClientRect()
      storeSize(key, { w: Math.round(r.width), h: Math.round(r.height) })
    },
    onDoubleClick: () => {
      setSize(null)
      storeSize(key, null)
    },
  }
  const style: CSSProperties | undefined =
    desktop && size
      ? { width: size.w, height: size.h, maxWidth: `calc(100vw - ${GUTTER}px)`, maxHeight: `calc(100dvh - ${GUTTER}px)` }
      : undefined
  return { desktop, style, grip }
}

/** Corner handle of a resizable sheet, desktop only. */
export function SheetGrip({ desktop, grip }: Pick<ReturnType<typeof useSheetSize>, 'desktop' | 'grip'>) {
  if (!desktop) return null
  return (
    <div
      {...grip}
      title="Drag to resize, double-click to reset"
      className="absolute right-0 bottom-0 cursor-nwse-resize touch-none p-1 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400"
    >
      <GripIcon width={14} height={14} />
    </div>
  )
}
