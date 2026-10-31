import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { renderMarkdown, type DiagramMode } from '../lib/format'
import { imageUrl } from '../lib/images'
import { useTheme } from '../lib/theme'

/** Rendered Markdown; MathJax and Mermaid are fetched the first time a text needs them. */
export function Markdown({
  text,
  diagrams = 'hidden',
  className = '',
  ...rest
}: { text: string; diagrams?: DiagramMode } & Omit<ComponentProps<'div'>, 'children'>) {
  const html = useMemo(() => renderMarkdown(text, diagrams), [text, diagrams])
  const ref = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  useEffect(() => {
    const el = ref.current
    if (!el?.querySelector('.math')) return
    // Offline before the chunk was cached: the TeX source stays readable as is.
    import('../lib/mathjax').then(({ typeset }) => typeset(el)).catch((err) => console.warn(err))
  }, [html])
  useEffect(() => {
    const el = ref.current
    if (!el?.querySelector('.mermaid-diagram')) return
    // Offline before the chunks were cached: the diagram source stays readable as is.
    import('../lib/mermaid').then(({ drawDiagrams }) => drawDiagrams(el, theme)).catch((err) => console.warn(err))
  }, [html, theme])
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLImageElement>('img[data-note-image]').forEach((img) => {
      // Unreachable, or another user's image in a shared issue: the alt text stays.
      imageUrl(img.dataset.noteImage!)
        .then((url) => {
          if (img.getAttribute('src') !== url) img.src = url
        })
        .catch((err) => console.warn(err))
    })
  }, [html])
  return <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} {...rest} />
}

/** Smallest width an image can be dragged to, so its grip stays reachable. */
const MIN_IMAGE_WIDTH = 64

/** Keys of a full-screen view. Capture phase, and stopped there: the sheet underneath neither closes nor reacts. */
function useCloseKeys(onClose: () => void, closing = ['Escape', 'Enter']) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      if (closing.includes(e.key)) onClose()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose, closing])
}

/** The image alone over the whole screen; a click or Escape brings the note back. */
function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  useCloseKeys(onClose)
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 flex animate-fade cursor-zoom-out items-center justify-center bg-black/85 p-4">
      <img src={src} alt="Image" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>,
    document.body,
  )
}

const MAX_DIAGRAM_SCALE = 12
const ESCAPE_ONLY = ['Escape']

/**
 * The diagram over the whole screen: wheel or pinch to zoom, drag to pan, Escape to leave.
 * A click does nothing, so a short drag cannot close it. Touch screens have no Escape key: they get a button.
 */
function DiagramZoom({ svg, onClose }: { svg: string; onClose: () => void }) {
  useCloseKeys(onClose, ESCAPE_ONLY)
  const overlay = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  // Written directly: re-rendering would rebuild the SVG on every pointer move.
  const update = (x: number, y: number, scale: number) => {
    view.current = { x, y, scale }
    content.current!.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  /** Keeps the point under (cx, cy) in place while scaling by factor. */
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const { x, y, scale } = view.current
    const next = Math.min(MAX_DIAGRAM_SCALE, Math.max(1, scale * factor))
    const f = next / scale
    update(cx - f * (cx - x), cy - f * (cy - y), next)
  }

  useEffect(() => {
    const el = overlay.current!
    // Not React's onWheel, which is passive: ctrl+wheel would zoom the whole page.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY / 300))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return createPortal(
    <div
      ref={overlay}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }}
      onPointerMove={(e) => {
        const before = pointers.current.get(e.pointerId)
        if (!before) return
        const after = { x: e.clientX, y: e.clientY }
        const dx = after.x - before.x
        const dy = after.y - before.y
        const other = [...pointers.current].find(([id]) => id !== e.pointerId)?.[1]
        pointers.current.set(e.pointerId, after)
        const { x, y, scale } = view.current
        if (!other) return update(x + dx, y + dy, scale)
        const spread = Math.hypot(before.x - other.x, before.y - other.y)
        // The two fingers each carry half of the pan.
        update(x + dx / 2, y + dy / 2, scale)
        if (spread) zoomAt((after.x + other.x) / 2, (after.y + other.y) / 2, Math.hypot(after.x - other.x, after.y - other.y) / spread)
      }}
      onPointerUp={(e) => pointers.current.delete(e.pointerId)}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      className="fixed inset-0 z-50 animate-fade cursor-grab touch-none overflow-hidden bg-white select-none active:cursor-grabbing dark:bg-neutral-900"
    >
      <div
        ref={content}
        className="mermaid-zoom absolute inset-0 origin-top-left p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <button
        type="button"
        aria-label="Close diagram"
        // The overlay would capture the pointer, and the click with it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClose}
        className="absolute top-3 right-3 hidden size-10 cursor-pointer items-center justify-center rounded-full bg-neutral-500/20 text-lg text-neutral-700 pointer-coarse:flex dark:text-neutral-200"
      >
        ✕
      </button>
    </div>,
    document.body,
  )
}

/** The markup of the diagram under a click, null elsewhere. */
const diagramAt = (target: HTMLElement) => target.closest('.mermaid-diagram svg')?.outerHTML ?? null

/**
 * Rendered Markdown whose images and diagrams open full screen on a click. Images resize from a grip
 * in their corner, where a double-click resets them. With onEditLine, diagrams get a pencil towards their source.
 */
export function ResizableMarkdown({
  text,
  className,
  onImageWidth,
  onEditLine,
}: {
  text: string
  className: string
  onImageWidth: (path: string, width: number | null) => void
  onEditLine?: (line: number) => void
}) {
  const drag = useRef<{ x: number; width: number; limit: number; frame: HTMLElement; moved: boolean }>(undefined)
  const [zoom, setZoom] = useState<string | null>(null)
  const [diagram, setDiagram] = useState<string | null>(null)
  const grip = (e: { target: EventTarget }) => (e.target as Element).closest<HTMLElement>('[data-grip]')
  const pathOf = (frame: HTMLElement) => frame.querySelector('img')!.dataset.noteImage!
  return (
    <>
      {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
      {diagram && <DiagramZoom svg={diagram} onClose={() => setDiagram(null)} />}
      <Markdown
        text={text}
        diagrams={onEditLine ? 'editable' : 'shown'}
        className={`resizable ${className}`}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('.mermaid-edit')) {
            return onEditLine?.(Number(target.closest<HTMLElement>('[data-line]')!.dataset.line))
          }
          const src = target.matches('.note-image img') && target.getAttribute('src')
          if (src) setZoom(src)
          setDiagram(diagramAt(target))
        }}
        onPointerDown={(e) => {
          const handle = grip(e)
          if (!handle) return
          e.preventDefault()
          handle.setPointerCapture(e.pointerId)
          const frame = handle.parentElement!
          drag.current = { x: e.clientX, width: frame.offsetWidth, limit: frame.parentElement!.clientWidth, frame, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          d.moved = true
          // Centered, the image grows on both sides: twice the pointer move keeps the corner under it.
        // Moved directly: the text only changes once, on release.
          d.frame.style.width = `${Math.min(d.limit, Math.max(MIN_IMAGE_WIDTH, Math.round(d.width + 2 * (e.clientX - d.x))))}px`
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = undefined
          if (d?.moved) onImageWidth(pathOf(d.frame), parseInt(d.frame.style.width))
        }}
        onDoubleClick={(e) => {
          const handle = grip(e)
          if (handle) onImageWidth(pathOf(handle.parentElement!), null)
        }}
      />
    </>
  )
}
