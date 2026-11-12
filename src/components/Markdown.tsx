import { Fragment, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { focusNode, nodeAt, nodeNotes } from '../lib/diagramFocus'
import { renderMarkdown, type DiagramMode, type IssueRefLookup } from '../lib/format'
import { imageUrl } from '../lib/images'
import type { DiagramLayout, DiagramLink } from '../lib/mermaid'
import { useTheme } from '../lib/theme'
import { toast } from '../lib/toast'

async function copyCode(button: Element) {
  try {
    const code = button.parentElement!.querySelector('code')!.textContent!
    await navigator.clipboard.writeText(code.replace(/\n$/, ''))
    toast('Code copied')
  } catch {
    // No clipboard outside secure contexts, such as the dev server opened from the phone.
    toast('Copy failed')
  }
}

/** Shows or hides an exercise's hint or solution; opening the hint unlocks the solution. */
function toggleExercisePane(button: HTMLButtonElement) {
  const box = button.closest('.exercise')!
  const pane = button.dataset.pane!
  const el = box.querySelector<HTMLElement>(`:scope > .ex-${pane}`)
  if (!el) return
  el.hidden = !el.hidden
  button.classList.toggle('open', !el.hidden)
  if (pane === 'hint') {
    const solution = box.querySelector<HTMLButtonElement>(':scope > .ex-actions > [data-pane="solution"]')
    if (solution) solution.disabled = false
  }
}

/** Rendered Markdown; MathJax, Mermaid and highlight.js are fetched the first time a text needs them. */
export function Markdown({
  text,
  diagrams = 'hidden',
  issueRef,
  className = '',
  onClick,
  ...rest
}: { text: string; diagrams?: DiagramMode; issueRef?: IssueRefLookup } & Omit<ComponentProps<'div'>, 'children'>) {
  const html = useMemo(() => renderMarkdown(text, diagrams, issueRef), [text, diagrams, issueRef])
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
    const el = ref.current
    if (!el?.querySelector('code.language-python')) return
    // Offline before the chunk was cached: the code stays readable, uncolored.
    import('../lib/highlight').then(({ highlightCode }) => highlightCode(el)).catch((err) => console.warn(err))
  }, [html])
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
  return (
    <div
      ref={ref}
      className={`md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const exercise = (e.target as Element).closest<HTMLButtonElement>('.ex-btn')
        if (exercise) {
          // Not a click on what holds the text: in the list, that would open the note.
          e.stopPropagation()
          return toggleExercisePane(exercise)
        }
        const copy = (e.target as Element).closest('.code-copy')
        if (!copy) return onClick?.(e)
        // Not a click on what holds the text: in the list, that would open the note.
        e.stopPropagation()
        void copyCode(copy)
      }}
      {...rest}
    />
  )
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
const DIAGRAM_ZOOM_STEP = 1.5
const FLOWCHART = /^\s*(?:flowchart|graph)\b/m
/** Pixels moved by an arrow key press, which repeats while held. */
const ARROW_STEP = 80
/** Pixels per line of a wheel event counted in lines, as Firefox does for a mouse wheel. */
const WHEEL_LINE = 16
/** Pixels moved per pixel of wheel event: a two-finger scroll is too fast at full speed. */
const WHEEL_PAN = 0.25
/** Pixels a pointer can move and still count as a click rather than a drag. */
const CLICK_SLOP = 4
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}
/** Matches the p-4 of .mermaid-zoom. */
const ZOOM_PADDING = 16
/** Offset of a side of the diagram: centered when it fits on screen, otherwise with no blank space before or after. */
const inView = (offset: number, size: number, screen: number) =>
  size < screen ? (screen - size) / 2 : Math.min(0, Math.max(screen - size, offset))
const DIAGRAM_SLIDERS = [
  { key: 'density', label: 'Diagram density', low: 'Dense', high: 'Airy' },
  { key: 'shape', label: 'Diagram shape', low: 'Portrait', high: 'Landscape' },
] as const
const ESCAPE_ONLY = ['Escape']

/**
 * The diagram over the whole screen: Ctrl + wheel, pinch, double-click or Ctrl + and − to zoom, two-finger scroll,
 * wheel, drag or arrow keys to pan, Escape to leave.
 * A click on a flowchart node dims all but its neighbours and their edges, and shows its description if the source
 * has one, on the side away from the click; elsewhere, or with Escape, it brings everything back. No other click does
 * anything, so a short drag cannot close it. Touch screens have no Escape key: they get a button.
 * Other screens get + and − buttons, for a mouse or a touchpad that zooms poorly.
 * A flowchart also gets sliders for its shape and density, for this view only: the note keeps its layout.
 * Once laid out that way it shows at its real size, to pan around, rather than shrunk to fit the screen.
 */
function DiagramZoom({ svg, source, onClose }: { svg: string; source: string; onClose: () => void }) {
  const theme = useTheme()
  const overlay = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const minScale = useRef(1)
  const realSize = useRef(false)
  const layout = useRef<DiagramLayout>({ shape: 0, density: 0 })
  const stale = useRef(false)
  const shaping = useRef(false)
  const links = useRef<DiagramLink[]>([])
  const focused = useRef<string | null>(null)
  const press = useRef<{ x: number; y: number; node: ReturnType<typeof nodeAt> }>(undefined)
  const notes = useMemo(() => nodeNotes(source), [source])
  // React leaves the drawing alone here: its props do not change.
  const [note, setNote] = useState<{ title: string; text: string; left: boolean } | null>(null)

  const focus = (node: ReturnType<typeof nodeAt>, x = 0) => {
    focused.current = node?.id ?? null
    focusNode(content.current!.querySelector('svg')!, links.current, focused.current)
    const text = node && notes.get(node.id)
    setNote(text ? { title: node.title, text, left: x > innerWidth / 2 } : null)
  }
  useCloseKeys(() => (focused.current === null ? onClose() : focus(null)), ESCAPE_ONLY)

  // Written directly: re-rendering would rebuild the SVG on every pointer move.
  const update = (x: number, y: number, scale: number) => {
    view.current = { x, y, scale }
    content.current!.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  /** Keeps the point under (cx, cy) in place while scaling by factor. */
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const { x, y, scale } = view.current
    const next = Math.min(MAX_DIAGRAM_SCALE, Math.max(minScale.current, scale * factor))
    const f = next / scale
    update(cx - f * (cx - x), cy - f * (cy - y), next)
  }
  const zoomCenter = (factor: number) => zoomAt(innerWidth / 2, innerHeight / 2, factor)

  /**
   * Swaps the drawing at its real size, the part at the middle of the screen staying there.
   * The first time, the top of the diagram instead: a long one would otherwise open somewhere in its middle.
   */
  const place = (drawn: string) => {
    const el = content.current
    if (!el) return
    const before = el.querySelector('svg')!.getBoundingClientRect()
    const first = !realSize.current
    const fx = first ? 0.5 : (innerWidth / 2 - before.left) / before.width
    const fy = first ? 0 : (innerHeight / 2 - before.top) / before.height
    el.innerHTML = drawn
    const svg = el.querySelector('svg')!
    const { width, height } = svg.viewBox.baseVal
    svg.style.width = `${width}px`
    svg.style.height = `${height}px`
    focusNode(svg, links.current, focused.current)
    minScale.current = Math.min(1, (innerWidth - 2 * ZOOM_PADDING) / width, (innerHeight - 2 * ZOOM_PADDING) / height)
    const scale = first ? 1 : view.current.scale
    update(
      inView(innerWidth / 2 - (fx * width + ZOOM_PADDING) * scale, (width + 2 * ZOOM_PADDING) * scale, innerWidth),
      inView(innerHeight / 2 - (fy * height + ZOOM_PADDING) * scale, (height + 2 * ZOOM_PADDING) * scale, innerHeight),
      scale,
    )
    realSize.current = true
  }

  /** One drawing at a time, then the latest position: a fast slider would otherwise queue them all. */
  const reshape = async (change: Partial<DiagramLayout>) => {
    layout.current = { ...layout.current, ...change }
    stale.current = true
    if (shaping.current) return
    shaping.current = true
    const { drawShaped } = await import('../lib/mermaid')
    while (stale.current) {
      stale.current = false
      await drawShaped(source, theme, layout.current)
        // Written directly as well, and the diagram in place stays if this drawing fails.
        .then(place)
        .catch((err) => console.warn(err))
    }
    shaping.current = false
  }

  useEffect(() => {
    if (!FLOWCHART.test(source)) return
    import('../lib/mermaid')
      .then(({ flowchartLinks }) => flowchartLinks(source))
      .then((all) => {
        links.current = all
      })
      .catch((err) => console.warn(err))
  }, [source])

  useEffect(() => {
    const el = overlay.current!
    // Not React's onWheel, which is passive: ctrl+wheel would zoom the whole page.
    const onWheel = (e: WheelEvent) => {
      const scrolled = (e.target as Element).closest('[data-node-note]')
      if (scrolled && scrolled.scrollHeight > scrolled.clientHeight && !e.ctrlKey) return
      e.preventDefault()
      // A touchpad pinch also arrives as a wheel event with ctrlKey set.
      if (e.ctrlKey) return zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY / 300))
      const { x, y, scale } = view.current
      const unit = WHEEL_PAN * (e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1)
      update(x - e.deltaX * unit, y - e.deltaY * unit, scale)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    // Capture phase, and stopped there, like the other keys of this view. A focused slider keeps its arrows.
    const onKey = (e: KeyboardEvent) => {
      // Not the browser's own zoom of the page. "=" is + without Shift on a QWERTY keyboard.
      const zoom = !(e.ctrlKey || e.metaKey) ? 0 : e.key === '+' || e.key === '=' ? DIAGRAM_ZOOM_STEP : e.key === '-' ? 1 / DIAGRAM_ZOOM_STEP : 0
      if (zoom) {
        e.preventDefault()
        e.stopPropagation()
        return zoomCenter(zoom)
      }
      const arrow = ARROWS[e.key]
      if (!arrow || e.target instanceof HTMLInputElement) return
      e.preventDefault()
      e.stopPropagation()
      const { x, y, scale } = view.current
      update(x - arrow[0] * ARROW_STEP, y - arrow[1] * ARROW_STEP, scale)
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [])

  return createPortal(
    <div
      ref={overlay}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        // Read here: once captured, the click itself lands on the overlay. A second finger makes it a pinch.
        press.current = e.button === 0 && pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, node: nodeAt(e.target as Element) } : undefined
      }}
      onPointerMove={(e) => {
        const before = pointers.current.get(e.pointerId)
        if (!before) return
        const after = { x: e.clientX, y: e.clientY }
        if (press.current && Math.hypot(after.x - press.current.x, after.y - press.current.y) > CLICK_SLOP) press.current = undefined
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
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        if (press.current) focus(press.current.node, press.current.x)
        press.current = undefined
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        press.current = undefined
      }}
      onDoubleClick={(e) => {
        // Two quick clicks on + already zoom twice.
        if (!(e.target as Element).closest('button, input')) zoomAt(e.clientX, e.clientY, DIAGRAM_ZOOM_STEP)
      }}
      className="fixed inset-0 z-50 animate-fade cursor-grab touch-none overflow-hidden bg-white select-none active:cursor-grabbing dark:bg-neutral-900"
    >
      <div
        ref={content}
        className="mermaid-zoom absolute inset-0 origin-top-left p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div
        // The overlay would capture the pointer, and the click with it.
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-3 bottom-3 flex flex-col gap-1 pointer-coarse:hidden"
      >
        {[
          { label: 'Zoom in', sign: '+', factor: DIAGRAM_ZOOM_STEP },
          { label: 'Zoom out', sign: '−', factor: 1 / DIAGRAM_ZOOM_STEP },
        ].map(({ label, sign, factor }) => (
          <button
            key={sign}
            type="button"
            aria-label={label}
            onClick={() => zoomCenter(factor)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md bg-neutral-500/15 text-neutral-600 hover:bg-neutral-500/25 dark:text-neutral-300"
          >
            {sign}
          </button>
        ))}
      </div>
      {FLOWCHART.test(source) && (
        <div
          // Same as the buttons: the overlay would capture the pointer.
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 left-1/2 grid -translate-x-1/2 cursor-default grid-cols-[auto_7rem_auto] items-center gap-x-2 gap-y-1 rounded-md bg-white/90 px-2.5 py-1.5 text-xs text-neutral-600 ring-1 ring-neutral-500/20 dark:bg-neutral-900/90 dark:text-neutral-300"
        >
          {DIAGRAM_SLIDERS.map(({ key, label, low, high }) => (
            <Fragment key={key}>
              <span className="text-right">{low}</span>
              <input
                type="range"
                aria-label={label}
                min={-1}
                max={1}
                step={0.05}
                defaultValue={0}
                onChange={(e) => void reshape({ [key]: Number(e.target.value) })}
                className="w-full cursor-pointer accent-neutral-500"
              />
              <span>{high}</span>
            </Fragment>
          ))}
        </div>
      )}
      {note && (
        <aside
          data-node-note
          // The overlay would capture the pointer, and take a selection of the text for a pan.
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`absolute top-3 ${note.left ? 'left-3' : 'right-3'} max-h-[calc(100%-7rem)] w-96 max-w-[calc(100%-1.5rem)] cursor-auto touch-pan-y overflow-y-auto overscroll-contain rounded-lg bg-white p-4 text-sm text-neutral-800 shadow-lg ring-1 ring-neutral-500/20 select-text pointer-coarse:inset-x-0 pointer-coarse:top-auto pointer-coarse:bottom-0 pointer-coarse:max-h-[45%] pointer-coarse:w-auto pointer-coarse:max-w-none pointer-coarse:rounded-b-none dark:bg-neutral-800 dark:text-neutral-200`}
        >
          {note.title && <h2 className="mb-2 font-semibold">{note.title}</h2>}
          <Markdown text={note.text} />
        </aside>
      )}
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

/** The diagram under a click, null elsewhere. */
function diagramAt(target: HTMLElement) {
  const svg = target.closest('.mermaid-diagram svg')
  return svg && { svg: svg.outerHTML, source: svg.closest<HTMLElement>('.mermaid-diagram')!.dataset.source! }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where a double-click on the rendered text points in the source: the word it selected, found again among
 * the source lines of its block, the same number of times over; the start of the block when that fails.
 */
function sourceSelection(text: string, root: HTMLElement, target: HTMLElement) {
  const block = target.closest<HTMLElement>('[data-line]')
  if (!block || !root.contains(block)) return undefined
  const lines = text.split('\n')
  const first = Number(block.dataset.line)
  const next = Math.min(
    lines.length,
    ...[...root.querySelectorAll<HTMLElement>('[data-line]')].map((x) => Number(x.dataset.line)).filter((n) => n > first),
  )
  const blockStart = lines.slice(0, first).join('\n').length + (first ? 1 : 0)
  const source = lines.slice(first, next).join('\n')
  const selection = getSelection()
  const word = selection?.toString().trim()
  if (!selection?.rangeCount || !word || /\s/.test(word)) return { start: blockStart }
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
  const pattern = `(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`
  const nth = before.toString().match(new RegExp(pattern, 'gu'))?.length ?? 0
  const found = [...source.matchAll(new RegExp(pattern, 'gu'))]
  const match = found[nth] ?? found[0]
  if (!match) return { start: blockStart }
  return { start: blockStart + match.index, end: blockStart + match.index + word.length }
}

/**
 * Rendered Markdown whose images and diagrams open full screen on a click. Images resize from a grip
 * in their corner, where a double-click resets them. With onEditLine, diagrams get a pencil towards their source,
 * and with onEditDrawing, drawings get a pencil that opens them in the editor. With onEditAt, a double-click
 * on the text gives the selection it points to in the source, and its height in the viewport.
 */
export function ResizableMarkdown({
  text,
  className,
  onImageWidth,
  onEditLine,
  onEditDrawing,
  onEditAt,
  issueRef,
  onOpenIssue,
}: {
  text: string
  className: string
  onImageWidth: (path: string, width: number | null) => void
  onEditLine?: (line: number) => void
  onEditDrawing?: (path: string) => void
  onEditAt?: (caret: { start: number; end?: number; y: number }) => void
  /** Shows `#a1b2c3d4` references as their issue's title, which opens it through onOpenIssue. */
  issueRef?: IssueRefLookup
  onOpenIssue?: (id: string) => void
}) {
  const drag = useRef<{ x: number; width: number; limit: number; frame: HTMLElement; moved: boolean }>(undefined)
  const [zoom, setZoom] = useState<string | null>(null)
  const [diagram, setDiagram] = useState<ReturnType<typeof diagramAt>>(null)
  const grip = (e: { target: EventTarget }) => (e.target as Element).closest<HTMLElement>('[data-grip]')
  const pathOf = (frame: HTMLElement) => frame.querySelector('img')!.dataset.noteImage!
  return (
    <>
      {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
      {diagram && <DiagramZoom {...diagram} onClose={() => setDiagram(null)} />}
      <Markdown
        text={text}
        diagrams={onEditLine ? 'editable' : 'shown'}
        issueRef={issueRef}
        className={`resizable ${onEditDrawing ? 'drawings-editable ' : ''}${className}`}
        onClick={(e) => {
          const target = e.target as HTMLElement
          const ref = target.closest<HTMLElement>('.issue-ref')
          if (ref) return onOpenIssue?.(ref.dataset.issue!)
          if (target.closest('.mermaid-edit')) {
            return onEditLine?.(Number(target.closest<HTMLElement>('[data-line]')!.dataset.line))
          }
          const drawing = target.closest<HTMLElement>('.drawing-edit')
          if (drawing) return onEditDrawing?.(pathOf(drawing.parentElement!))
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
          if (handle) return onImageWidth(pathOf(handle.parentElement!), null)
          const target = e.target as HTMLElement
          // These already do something on a click.
          if (!onEditAt || target.closest('a, button, .ex-actions, .note-image, .mermaid-block, .mermaid-placeholder')) return
          const at = sourceSelection(text, e.currentTarget, target)
          if (at) onEditAt({ ...at, y: e.clientY })
        }}
      />
    </>
  )
}
