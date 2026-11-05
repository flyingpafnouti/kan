import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActiveSelection,
  cache,
  Canvas,
  Ellipse,
  FabricImage,
  Group,
  IText,
  PencilBrush,
  Point as FabricPoint,
  Rect,
  util,
  type FabricObject,
  type TPointerEventInfo,
} from 'fabric'
import type { DrawingData } from '../lib/drawings'
import { MAX_SIDE } from '../lib/images'
import { toast } from '../lib/toast'
import { uuid } from '../lib/id'
import handwritingUrl from '../assets/fonts/Excalifont-Latin.woff2?url'
import {
  ANCHOR_HIT,
  anchorAt,
  connectorEnd,
  describeDrawing,
  drawAnchors,
  ensureId,
  follow,
  hoveredAnchorable,
  isConnector,
  isClosed,
  isLabel,
  labelFor,
  labelOf,
  LINK_PROPS,
  makeConnector,
  releaseMoved,
  restoreLinks,
  withDependents,
  type Side,
} from './drawingLinks'
import type { SketchInput } from './SketchMermaidPanel'
import { tidy } from './tidy'
import { spread } from './spread'

/** Experimental, dev only: Mermaid and its panel load on the first conversion. */
const SketchMermaidPanel = lazy(() => import('./SketchMermaidPanel'))
/** Longest side of the image sent to the vision model. */
const VISION_SIDE = 1536

/*
 * Full screen sketch pad for the notes, loaded on demand with fabric. Shapes, text and free hand lines,
 * in a few colors, on a white sheet. Saving gives a preview cropped to the drawing and its objects to edit it again.
 */

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pencil' | 'text' | 'math'
type Point = { x: number; y: number }

const COLORS = ['#1e1e1e', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#7048e8']
const WIDTHS = [2, 5]
/** Text sizes, as in Excalidraw: S, M, L, XL. M is the default. */
const SIZES = [
  { label: 'S', name: 'Small', size: 16 },
  { label: 'M', name: 'Medium', size: 24 },
  { label: 'L', name: 'Large', size: 36 },
  { label: 'XL', name: 'Extra large', size: 56 },
]
/** Excalidraw's handwriting (OFL, see assets/fonts/OFL.txt), its Latin subset: 25 kB, French included. */
const HANDWRITING = 'Excalifont'
const FONT = `${HANDWRITING}, ui-sans-serif, system-ui, sans-serif`

/** Loaded with the editor, once. Unreachable, the text falls back to the system font. */
const fontReady = new FontFace(HANDWRITING, `url(${handwritingUrl})`)
  .load()
  .then((face) => {
    document.fonts.add(face)
    // Widths measured with the fallback would leave the cursor and the boxes off.
    cache.clearFontCache(FONT)
  })
  .catch((err) => console.warn(err))
/** Margin around the drawing in its preview, and around a reopened drawing on the sheet. */
const PAD = 16
/** A shape smaller than this was a click, not a drag. */
const MIN_DRAG = 4

/** One key per tool, as in Excalidraw where they exist there. */
const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pencil', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', t: 'text', m: 'math' }
const keyOf = (tool: Tool) => Object.keys(TOOL_KEYS).find((k) => TOOL_KEYS[k] === tool)!.toUpperCase()

/** With Shift, a square or a circle: the longer side for both, towards where the pointer went. */
function perfect(a: Point, b: Point): Point {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  return { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side }
}

function makeShape(tool: Tool, a: Point, end: Point, color: string, width: number, shift = false): FabricObject | null {
  const b = shift && (tool === 'rect' || tool === 'ellipse') ? perfect(a, end) : end
  const stroke = { stroke: color, strokeWidth: width, strokeUniform: true, strokeLineCap: 'round', strokeLineJoin: 'round' } as const
  const box = {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    originX: 'left',
    originY: 'top',
    fill: 'transparent',
    ...stroke,
  } as const
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  if (tool === 'rect') return new Rect({ ...box, width: w, height: h, rx: 4, ry: 4 })
  if (tool === 'ellipse') return new Ellipse({ ...box, rx: w / 2, ry: h / 2 })
  if (tool === 'line' || tool === 'arrow') return makeConnector(tool, a, b, color, width)
  return null
}

/** Union of the bounding boxes, in scene coordinates. */
function bounds(objects: FabricObject[]) {
  const boxes = objects.map((o) => o.getBoundingRect())
  const left = Math.min(...boxes.map((b) => b.left))
  const top = Math.min(...boxes.map((b) => b.top))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

const isText = (o: FabricObject): o is IText => o instanceof IText

type Serialized = Record<string, unknown> & { objects?: Serialized[] }

/** Copied objects, kept for the session: they paste in this drawing or in another. */
let clipboard: { objects: Serialized[]; pastes: number } | null = null

/**
 * Copies get new ids. Links inside the copy (a shape's label, a connector between two copied shapes)
 * point to the copies; a connector's end tied to a shape left behind lets go.
 */
function renewIds(objects: Serialized[]) {
  const ids = new Map<string, string>()
  const collect = (o: Serialized) => {
    if (typeof o.id === 'string') ids.set(o.id, uuid())
    o.objects?.forEach(collect)
  }
  const relink = (o: Serialized): Serialized => {
    const next: Serialized = { ...o }
    if (typeof o.id === 'string') next.id = ids.get(o.id)
    if (typeof o.labelOf === 'string') next.labelOf = ids.get(o.labelOf)
    // A connector's label copied without it becomes a free text.
    if (typeof o.edgeOf === 'string') next.edgeOf = ids.get(o.edgeOf)
    for (const end of ['from', 'to'] as const) {
      const bound = o[end] as { id: string; side: number } | undefined
      if (bound) next[end] = ids.has(bound.id) ? { ...bound, id: ids.get(bound.id) } : undefined
    }
    if (o.objects) next.objects = o.objects.map(relink)
    return next
  }
  objects.forEach(collect)
  return objects.map(relink)
}

/** What a drag does with each tool; the anchors under the pointer change it for a while. */
function applyTool(c: Canvas, tool: Tool) {
  const select = tool === 'select' || tool === 'text' || tool === 'math'
  c.selection = tool === 'select'
  c.skipTargetFind = !select
  c.defaultCursor = select ? 'default' : 'crosshair'
}

/** Tools whose drag can start from, or end on, an anchor. */
const usesAnchors = (tool: Tool) => tool === 'select' || tool === 'line' || tool === 'arrow'

/** A formula: the SVG MathJax drew, with its TeX source and color to draw it again. */
type MathImage = FabricImage & { tex: string; texColor: string }
const isMath = (o: FabricObject): o is MathImage => o instanceof FabricImage && typeof (o as MathImage).tex === 'string'
/** Saved with the objects. */
const EXTRA_PROPS = ['tex', 'texColor', ...LINK_PROPS]
/** A formula at size M, as tall as the text around it. */
const MATH_SIZE = 24
/** Formulas are drawn this many times larger, then scaled down: sharp when enlarged and in the preview. */
const MATH_SCALE = 4

/** MathJax comes only with the first formula. */
async function mathUrl(tex: string, color: string) {
  const { texToSvg } = await import('../lib/mathjax')
  return (await texToSvg(tex, color, MATH_SIZE * MATH_SCALE)).url
}

/** A saved image is only ever a formula: anything else in the source is dropped. */
const safeObjects = (objects: object[]) =>
  objects.filter((o) => {
    const { type, src } = o as { type?: string; src?: unknown }
    return type?.toLowerCase() !== 'image' || (typeof src === 'string' && src.startsWith('data:image/svg+xml'))
  })

export default function DrawingEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: DrawingData
  /** The preview, cropped to the drawing; its width in CSS pixels; the objects to edit it again. */
  onSave: (preview: HTMLCanvasElement, width: number, data: DrawingData) => void
  onCancel: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<Canvas>(undefined)
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[0])
  const [fontSize, setFontSize] = useState(SIZES[1].size)
  const [empty, setEmpty] = useState(!initial?.objects.length)
  const [canUndo, setCanUndo] = useState(false)
  /** The TeX field: where it shows, and the formula it edits, if any. */
  const [math, setMath] = useState<{ x: number; y: number; tex: string; target?: MathImage } | null>(null)
  /** The Mermaid panel, open with the sketch to convert, or null to paste a diagram. */
  const [sketch, setSketch] = useState<{ input: SketchInput | null } | null>(null)
  // Read by the canvas handlers, registered once.
  const current = useRef({ tool, color, width, fontSize })
  current.current = { tool, color, width, fontSize }
  const history = useRef<string[]>([])

  const snapshot = () => JSON.stringify(canvas.current!.toObject(EXTRA_PROPS).objects)

  /** Records the state after a change, for undo. */
  const commit = () => {
    const c = canvas.current!
    // Connectors go under everything, in their order: a box over an arrow can still be grabbed, and its arrows follow it.
    for (const o of c.getObjects().filter(isConnector).reverse()) c.sendObjectToBack(o)
    const s = snapshot()
    if (s !== history.current.at(-1)) history.current.push(s)
    setCanUndo(history.current.length > 1)
    setEmpty(c.getObjects().length === 0)
  }

  const replaceObjects = (c: Canvas, live: FabricObject[]) => {
    restoreLinks(live)
    c.discardActiveObject()
    c.remove(...c.getObjects())
    c.add(...live)
    c.requestRenderAll()
    setEmpty(live.length === 0)
  }

  const undo = async () => {
    if (history.current.length < 2) return
    history.current.pop()
    replaceObjects(canvas.current!, await util.enlivenObjects<FabricObject>(JSON.parse(history.current.at(-1)!)))
    setCanUndo(history.current.length > 1)
  }

  /** Draws the formula: a new one at its point, or again in place of the one edited. */
  const placeMath = async ({ x, y, tex, target }: { x: number; y: number; tex: string; target?: MathImage }) => {
    const c = canvas.current!
    const color = target?.texColor ?? current.current.color
    try {
      const url = await mathUrl(tex, color)
      if (target) {
        await target.setSrc(url)
        Object.assign(target, { tex })
        target.setCoords()
      } else {
        const image = await FabricImage.fromURL(url)
        const scale = current.current.fontSize / MATH_SIZE / MATH_SCALE
        image.set({ left: x, top: y, originX: 'left', originY: 'top', scaleX: scale, scaleY: scale })
        Object.assign(image, { tex, texColor: color })
        c.add(image)
        c.setActiveObject(image)
      }
      c.requestRenderAll()
      commit()
    } catch (e) {
      // Back to the field, with the source to fix.
      toast(e instanceof Error ? e.message : 'Could not draw the formula')
      setMath({ x, y, tex, target })
    }
  }

  const openMath = (target: FabricObject | undefined, at: Point) => {
    if (target && isMath(target)) {
      const r = target.getBoundingRect()
      return setMath({ x: r.left, y: r.top, tex: target.tex, target })
    }
    setMath({ x: at.x, y: at.y, tex: '' })
  }

  const removeSelection = () => {
    const c = canvas.current!
    const selected = c.getActiveObjects()
    if (!selected.length) return
    c.discardActiveObject()
    c.remove(...withDependents(c, selected))
    c.requestRenderAll()
    commit()
  }

  /** Ctrl+C: the selection, with the labels of its shapes, in scene coordinates. */
  const copy = () => {
    const c = canvas.current!
    const active = c.getActiveObject()
    const selected = c.getActiveObjects()
    if (!active || !selected.length) return false
    const ids = new Set(selected.map(ensureId))
    const members = c.getObjects().filter((o) => selected.includes(o) || ids.has((o as { labelOf?: string }).labelOf!))
    // Out of the selection, whose frame its objects are otherwise saved in.
    c.discardActiveObject()
    clipboard = { objects: members.map((o) => o.toObject(EXTRA_PROPS)), pastes: 0 }
    c.setActiveObject(selected.length > 1 ? new ActiveSelection(selected, { canvas: c }) : selected[0])
    c.requestRenderAll()
    return true
  }

  /** Ctrl+V: the copy again, a little lower on each paste, selected. */
  const paste = async () => {
    const c = canvas.current!
    if (!clipboard) return
    const offset = 20 * ++clipboard.pastes
    const objects = renewIds(clipboard.objects).map((o) => ({ ...o, left: (o.left as number) + offset, top: (o.top as number) + offset }))
    const live = await util.enlivenObjects<FabricObject>(safeObjects(objects))
    restoreLinks(live)
    c.discardActiveObject()
    c.add(...live)
    const selectable = live.filter((o) => !isLabel(o))
    if (selectable.length) c.setActiveObject(selectable.length > 1 ? new ActiveSelection(selectable, { canvas: c }) : selectable[0])
    c.requestRenderAll()
    commit()
  }

  /** Ctrl+G: the selection becomes one object, with the labels of its shapes. */
  const group = () => {
    const c = canvas.current!
    const selected = c.getActiveObjects()
    if (selected.length < 2) return
    const ids = new Set(selected.map(ensureId))
    const objects = c.getObjects()
    const members = objects.filter((o) => selected.includes(o) || ids.has((o as { labelOf?: string }).labelOf!))
    const index = objects.indexOf(members[0])
    c.discardActiveObject()
    c.remove(...members)
    const g = new Group(members)
    ensureId(g)
    c.insertAt(index, g)
    c.setActiveObject(g)
    c.requestRenderAll()
    commit()
  }

  /** Ctrl+Shift+G: the group gives its objects back, where they are, selected. */
  const ungroup = () => {
    const c = canvas.current!
    const g = c.getActiveObject()
    if (!(g instanceof Group) || g instanceof ActiveSelection) return
    const items = g.getObjects()
    const matrices = items.map((o) => o.calcTransformMatrix())
    const index = c.getObjects().indexOf(g)
    c.discardActiveObject()
    g.removeAll()
    items.forEach((o, i) => {
      util.applyTransformToObject(o, matrices[i])
      o.setCoords()
    })
    c.remove(g)
    c.insertAt(index, ...items)
    const selectable = items.filter((o) => !isLabel(o))
    if (selectable.length) c.setActiveObject(new ActiveSelection(selectable, { canvas: c }))
    c.requestRenderAll()
    commit()
  }

  // The canvas, its size following the window, and the reopened drawing.
  useEffect(() => {
    // Made here rather than by React: fabric wraps the element, and StrictMode mounts twice.
    const element = host.current!.appendChild(document.createElement('canvas'))
    const c = new Canvas(element, { backgroundColor: 'white', preserveObjectStacking: true })
    canvas.current = c
    const fit = () => c.setDimensions({ width: host.current!.clientWidth, height: host.current!.clientHeight })
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(host.current!)

    let start: Point | null = null
    let draft: FabricObject | null = null
    /** The drag runs from an anchor, or ends near one: it draws a connector tied to the shapes. */
    let link: { kind: 'line' | 'arrow'; from?: { object: FabricObject; side: Side } } | null = null
    /** The object whose anchors show, and the anchor the pointer is on. */
    let hover: { object: FabricObject; hot: Side | null } | null = null
    let pressed = false
    /** Opened on release: on press, the focus the click then gives the page would close the field at once. */
    let mathAt: { target?: FabricObject; point: Point } | null = null

    const setHover = (next: typeof hover) => {
      if (next?.object === hover?.object && next?.hot === hover?.hot) return
      hover = next
      const { tool } = current.current
      // On an anchor, a drag draws a connector rather than moving or selecting.
      if (tool === 'select') {
        if (next?.hot != null) {
          c.selection = false
          c.skipTargetFind = true
          c.setCursor('crosshair')
        } else applyTool(c, tool)
      }
      c.requestRenderAll()
    }

    c.on('after:render', ({ ctx }) => {
      // Not in the preview, which renders on a canvas of its own.
      if (ctx !== c.getContext() || !hover || !c.getObjects().includes(hover.object)) return
      drawAnchors(ctx, hover.object, hover.hot, c.viewportTransform)
    })

    c.on('mouse:down', ({ scenePoint, target }: TPointerEventInfo) => {
      pressed = true
      const { tool, color, fontSize } = current.current
      if (usesAnchors(tool) && hover?.hot != null) {
        const from = { object: hover.object, side: hover.hot }
        link = { kind: tool === 'line' ? 'line' : 'arrow', from }
        const a = anchorAt(c, scenePoint, ANCHOR_HIT)
        start = a ? { x: a.point.x, y: a.point.y } : { x: scenePoint.x, y: scenePoint.y }
        return
      }
      if (tool === 'text') {
        // On a text: fabric edits it.
        if (target && isText(target)) return
        const text = new IText('', { left: scenePoint.x, top: scenePoint.y, originX: 'left', originY: 'top', fontFamily: FONT, fontSize, fill: color })
        c.add(text)
        c.setActiveObject(text)
        text.enterEditing()
        setTool('select')
        return
      }
      if (tool === 'math') {
        mathAt = { target, point: { x: scenePoint.x, y: scenePoint.y } }
        return
      }
      if (tool === 'select' || tool === 'pencil') return
      if (tool === 'line' || tool === 'arrow') link = { kind: tool }
      start = { x: scenePoint.x, y: scenePoint.y }
    })
    c.on('mouse:move', ({ scenePoint, e }: TPointerEventInfo) => {
      const { tool, color, width } = current.current
      if (!start) {
        if (pressed || !usesAnchors(tool)) return
        const near = anchorAt(c, scenePoint, ANCHOR_HIT)
        const over = near?.object ?? hoveredAnchorable(c, scenePoint)
        setHover(over ? { object: over, hot: near ? near.side : null } : null)
        return
      }
      if (draft) c.remove(draft)
      if (link) {
        const end = connectorEnd(c, new FabricPoint(start.x, start.y), scenePoint, e.shiftKey, link.from?.object)
        draft = makeConnector(link.kind, start, end.point, color, width)
        hover = end.bind ? { object: end.bind.object, hot: end.bind.side } : null
      } else draft = makeShape(tool, start, scenePoint, color, width, e.shiftKey)
      if (draft) c.add(draft)
      c.requestRenderAll()
    })
    c.on('mouse:up', ({ scenePoint, e }: TPointerEventInfo) => {
      pressed = false
      if (mathAt) {
        openMath(mathAt.target, mathAt.point)
        mathAt = null
        setTool('select')
        return
      }
      if (!start) return
      const small = Math.hypot(scenePoint.x - start.x, scenePoint.y - start.y) < MIN_DRAG
      const origin = new FabricPoint(start.x, start.y)
      start = null
      const made = draft
      const ends = link
      draft = null
      link = null
      hover = null
      applyTool(c, current.current.tool)
      if (!made) return
      if (small) c.remove(made)
      else {
        made.setCoords()
        if (ends) {
          ensureId(made)
          const end = connectorEnd(c, origin, scenePoint, e.shiftKey, ends.from?.object).bind
          Object.assign(made, {
            from: ends.from ? { id: ensureId(ends.from.object), side: ends.from.side } : undefined,
            to: end ? { id: ensureId(end.object), side: end.side } : undefined,
          })
        }
      }
      c.requestRenderAll()
      commit()
    })
    c.on('mouse:out', () => setHover(null))
    c.on('mouse:dblclick', ({ target, scenePoint }: TPointerEventInfo) => {
      if (!target) return
      if (isMath(target)) return openMath(target, scenePoint)
      // A closed shape takes a text in its middle.
      if (isClosed(target)) {
        const label = labelFor(c, target, FONT, current.current.fontSize)
        c.setActiveObject(label)
        label.enterEditing()
        label.selectAll()
        c.requestRenderAll()
      }
    })
    // Labels and connectors follow what they belong to, while it moves.
    for (const event of ['object:moving', 'object:scaling', 'object:rotating'] as const) {
      c.on(event, ({ target }) => follow(c, target))
    }
    c.on('path:created', commit)
    // The size buttons show the size of the selected text.
    const showSize = () => {
      const text = c.getActiveObjects().find(isText)
      if (text) setFontSize(text.fontSize)
    }
    c.on('selection:created', showSize)
    c.on('selection:updated', showSize)
    c.on('object:modified', ({ target }) => {
      releaseMoved(target)
      follow(c, target)
      commit()
    })
    c.on('text:editing:exited', ({ target }) => {
      // A text left empty goes away.
      if (!target.text.trim()) c.remove(target)
      commit()
    })

    let cancelled = false
    void (async () => {
      // Before the texts of a reopened drawing are measured.
      await fontReady
      if (cancelled) return
      c.requestRenderAll()
      if (initial?.objects.length) {
        const live = await util.enlivenObjects<FabricObject>(safeObjects(initial.objects))
        if (cancelled) return
        // Back near the corner: it may have been drawn on a wider screen.
        const box = bounds(live)
        for (const o of live) o.set({ left: o.left - box.left + PAD, top: o.top - box.top + PAD })
        replaceObjects(c, live)
        for (const o of live) o.setCoords()
      }
      if (!cancelled) history.current = [snapshot()]
    })()

    return () => {
      cancelled = true
      observer.disconnect()
      const wrapper = c.wrapperEl
      void c.dispose().finally(() => {
        wrapper.remove()
        element.remove()
      })
    }
  }, [])

  // The tool sets what a drag does: draw, or select and move.
  useEffect(() => {
    const c = canvas.current!
    c.isDrawingMode = tool === 'pencil'
    if (tool === 'pencil') {
      const brush = new PencilBrush(c)
      brush.color = color
      brush.width = width
      c.freeDrawingBrush = brush
    }
    applyTool(c, tool)
    if (tool !== 'select' && tool !== 'text' && tool !== 'math') c.discardActiveObject()
    c.requestRenderAll()
  }, [tool, color, width])

  /** The color, or the width, also goes to what is selected. */
  const restyle = (next: { color?: string; width?: number }) => {
    const c = canvas.current!
    const selected = c.getActiveObjects()
    if (!selected.length) return
    for (const o of selected) {
      if (isMath(o)) {
        if (next.color) {
          const color = next.color
          void mathUrl(o.tex, color)
            .then((url) => o.setSrc(url))
            .then(() => {
              Object.assign(o, { texColor: color })
              c.requestRenderAll()
              commit()
            })
            .catch((err) => console.warn(err))
        }
      } else if (isText(o)) {
        if (next.color) o.set({ fill: next.color })
      } else {
        if (next.color) o.set({ stroke: next.color })
        if (next.width) o.set({ strokeWidth: next.width })
      }
    }
    c.requestRenderAll()
    commit()
  }

  /**
   * The size goes to the selected texts, to the labels of the selected shapes and to the formulas;
   * new texts take it too.
   */
  const resize = (size: number) => {
    setFontSize(size)
    const c = canvas.current!
    const selected = c.getActiveObjects()
    if (!selected.length) return
    const labels = selected.filter(isClosed).map((shape) => labelOf(c, shape))
    for (const o of [...selected, ...labels]) {
      if (!o) continue
      if (isMath(o)) {
        const scale = size / MATH_SIZE / MATH_SCALE
        o.set({ scaleX: scale, scaleY: scale })
      } else if (isText(o)) o.set({ fontSize: size })
      else continue
      o.setCoords()
      follow(c, o)
    }
    // The selection's frame fits the new sizes.
    const active = c.getActiveObject()
    if (active instanceof ActiveSelection) active.setCoords()
    // A text being typed keeps the keyboard.
    if (active && isText(active) && active.isEditing) active.hiddenTextarea?.focus()
    c.requestRenderAll()
    commit()
  }

  /** One size up or down from the current one. */
  const stepSize = (step: 1 | -1) => {
    const i = SIZES.findIndex((s) => s.size === current.current.fontSize)
    const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i === -1 ? 1 : i) + step))]
    resize(next.size)
  }

  const save = () => {
    const c = canvas.current!
    c.discardActiveObject()
    const objects = c.getObjects()
    if (!objects.length) return onCancel()
    const box = bounds(objects)
    const left = Math.floor(box.left - PAD)
    const top = Math.floor(box.top - PAD)
    const w = Math.ceil(box.width + 2 * PAD)
    const h = Math.ceil(box.height + 2 * PAD)
    // Sharp on a high density screen, within the size of the other note images.
    const multiplier = Math.min(Math.max(devicePixelRatio || 1, 1), 2, MAX_SIDE / Math.max(w, h))
    const preview = c.toCanvasElement(multiplier, { left, top, width: w, height: h })
    onSave(preview, w, { v: 1, objects: c.toObject(EXTRA_PROPS).objects })
  }

  /** Ctrl+A: everything one can select, with the selection tool. Labels follow their shapes. */
  const selectAll = () => {
    const c = canvas.current!
    const objects = c.getObjects().filter((o) => o.selectable)
    if (!objects.length) return
    setTool('select')
    c.discardActiveObject()
    c.setActiveObject(objects.length === 1 ? objects[0] : new ActiveSelection(objects, { canvas: c }))
    c.requestRenderAll()
  }

  /** Evens out sizes, alignments and spacings of the selected shapes, or of all if fewer than two are selected. */
  const tidyUp = () => {
    const c = canvas.current!
    const selected = c.getActiveObjects()
    const scope = selected.length > 1 ? selected : undefined
    // Out of the selection first: inside it, positions are relative to it.
    c.discardActiveObject()
    if (!tidy(c, scope)) return toast('Nothing to tidy: only rectangles and ellipses are arranged')
    commit()
  }

  /** The opposite of tidying: the whole drawing spread over the pad, with as few lines across boxes as it can. */
  const spreadOut = () => {
    const c = canvas.current!
    c.discardActiveObject()
    if (!spread(c)) return toast('Nothing to spread: it takes at least two rectangles or ellipses')
    commit()
  }

  /** The drawing as an image and as a graph, for the Mermaid conversion. */
  const toMermaid = () => {
    const c = canvas.current!
    c.discardActiveObject()
    const objects = c.getObjects()
    // An empty pad: the panel waits for a diagram to draw.
    if (!objects.length) return setSketch({ input: null })
    const box = bounds(objects)
    const w = Math.ceil(box.width + 2 * PAD)
    const h = Math.ceil(box.height + 2 * PAD)
    const multiplier = Math.min(2, VISION_SIDE / Math.max(w, h))
    const image = c
      .toCanvasElement(multiplier, { left: Math.floor(box.left - PAD), top: Math.floor(box.top - PAD), width: w, height: h })
      .toDataURL('image/jpeg', 0.9)
    setSketch({ input: { image, description: describeDrawing(c) } })
  }

  /** A Mermaid flowchart drawn on the pad beside the drawing, selected, the panel closed. */
  const drawMermaid = async (code: string) => {
    const c = canvas.current!
    const { mermaidToSketch } = await import('./mermaidToSketch')
    c.discardActiveObject()
    const { fontSize } = current.current
    const added = await mermaidToSketch(c, code, { font: FONT, fontSize, color: current.current.color, width: current.current.width })
    commit()
    setSketch(null)
    setTool('select')
    const shapes = added.filter((o) => o.selectable)
    if (shapes.length) c.setActiveObject(new ActiveSelection(shapes, { canvas: c }))
    // The selection holds the smaller edge labels: the pen keeps its size.
    setFontSize(fontSize)
    c.requestRenderAll()
  }

  // Delete, undo, and Escape to leave the selection; the note behind does not see these keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The TeX field and the Mermaid panel handle their own keys.
      if (e.target instanceof HTMLInputElement || sketch) return
      const active = canvas.current?.getActiveObject()
      const editing = active && isText(active) && active.isEditing
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing) active.exitEditing()
        canvas.current?.discardActiveObject()
        canvas.current?.requestRenderAll()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '>' || e.key === '<')) {
        // Ctrl+Shift+> and Ctrl+Shift+< on QWERTY; on AZERTY, Ctrl+Shift+< gives > and Ctrl+< gives <.
        e.preventDefault()
        stepSize(e.key === '>' ? 1 : -1)
      } else if (editing) {
        return
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        tidyUp()
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        spreadOut()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
        e.preventDefault()
        setTool(TOOL_KEYS[e.key.toLowerCase()])
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelection()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (copy()) e.preventDefault()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!clipboard) return
        e.preventDefault()
        void paste()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (e.shiftKey) ungroup()
        else group()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        save()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const toolButton = (t: Tool, label: string, icon: ReactNode) => (
    <IconButton key={t} label={label} shortcut={keyOf(t)} active={tool === t} onClick={() => setTool(t)}>
      {icon}
    </IconButton>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-100 dark:bg-neutral-950">
      <div
        // A click on the toolbar leaves the focus where it is: in the text being typed, fabric's hidden field.
        onMouseDown={(e) => e.preventDefault()}
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-2 py-1.5 pt-safe dark:border-neutral-800 dark:bg-neutral-900">
        {toolButton('select', 'Select', <path d="M5 3l14 8-6 2-3 6z" />)}
        {toolButton('pencil', 'Pencil', <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />)}
        {toolButton('rect', 'Rectangle', <rect x="4" y="5" width="16" height="14" rx="2" />)}
        {toolButton('ellipse', 'Ellipse', <ellipse cx="12" cy="12" rx="9" ry="7" />)}
        {toolButton('line', 'Line', <path d="M5 19 19 5" />)}
        {toolButton('arrow', 'Arrow', <path d="M5 19 19 5M10 5h9v9" />)}
        {toolButton('text', 'Text', <path d="M5 6V4h14v2M12 4v16M9 20h6" />)}
        {toolButton('math', 'Formula (TeX)', <path d="M18 5H6l6 7-6 7h12" />)}
        <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => {
              setColor(c)
              restyle({ color: c })
            }}
            className={`size-7 shrink-0 rounded-full p-1 ${color === c ? 'ring-2 ring-accent' : ''}`}
          >
            <span className="block size-full rounded-full" style={{ background: c }} />
          </button>
        ))}
        <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" />
        {WIDTHS.map((w) => (
          <IconButton
            key={w}
            label={w === WIDTHS[0] ? 'Thin' : 'Thick'}
            active={width === w}
            onClick={() => {
              setWidth(w)
              restyle({ width: w })
            }}
          >
            <path d="M5 12h14" strokeWidth={w === WIDTHS[0] ? 1.5 : 4} />
          </IconButton>
        ))}
        <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" />
        {SIZES.map((s) => (
          <button
            key={s.size}
            type="button"
            aria-label={`Text size ${s.name}`}
            aria-keyshortcuts="Control+Shift+> Control+Shift+<"
            aria-pressed={fontSize === s.size}
            onClick={() => resize(s.size)}
            className={`group relative h-8 min-w-8 shrink-0 rounded-lg px-1 text-xs font-semibold transition ${
              fontSize === s.size
                ? 'bg-accent/15 text-accent'
                : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
          >
            {s.label}
            <Tip label={`${s.name} text`} keys="Ctrl+Shift+> / <" />
          </button>
        ))}
        <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" />
        <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => void undo()}>
          <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
        </IconButton>
        <IconButton label="Group" shortcut="Ctrl+G" onClick={group}>
          <path d="M4 4h6v6H4zM14 14h6v6h-6zM10 7h4v7M7 10v4h7" />
        </IconButton>
        <IconButton label="Ungroup" shortcut="Ctrl+Shift+G" onClick={ungroup}>
          <path d="M4 4h6v6H4zM14 14h6v6h-6z" />
        </IconButton>
        <IconButton label="Tidy up" shortcut="Alt+A" onClick={tidyUp}>
          <path d="M4 5h6v5H4zM14 5h6v5h-6zM4 14h6v5H4zM14 14h6v5h-6z" />
        </IconButton>
        <IconButton label="Spread out" shortcut="Alt+E" onClick={spreadOut}>
          <path d="M9 9 4 4M4 8V4h4M15 9l5-5M16 4h4v4M9 15l-5 5M4 16v4h4M15 15l5 5M20 16v4h-4" />
        </IconButton>
        <IconButton label="Delete selection" shortcut="Del" onClick={removeSelection}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </IconButton>
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={toMermaid}
              className="group relative rounded-lg px-3 py-1.5 text-sm text-neutral-500 disabled:opacity-30"
            >
              Mermaid
              <Tip label={empty ? 'Draw a Mermaid diagram (experimental)' : 'Convert to Mermaid (experimental)'} align="end" />
            </button>
          )}
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={empty}
            aria-keyshortcuts="Control+Enter"
            className="group relative rounded-xl bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-30 dark:bg-white dark:text-neutral-900"
          >
            Save
            <Tip label="Save" keys="Ctrl+Enter" align="end" />
          </button>
        </div>
      </div>
      <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
        {sketch && (
          <Suspense fallback={null}>
            <SketchMermaidPanel input={sketch.input} onClose={() => setSketch(null)} onDraw={drawMermaid} />
          </Suspense>
        )}
        {math && (
          <MathField
            key={`${math.x},${math.y}`}
            {...math}
            onDone={(tex) => {
              setMath(null)
              if (tex.trim()) void placeMath({ ...math, tex: tex.trim() })
            }}
          />
        )}
      </div>
    </div>
  )
}

function IconButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`group relative shrink-0 rounded-lg p-1.5 transition disabled:opacity-30 ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
      }`}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      <Tip label={label} keys={shortcut} />
    </button>
  )
}

/**
 * Name and shortcut of a toolbar button, under it, as soon as the pointer is on it.
 * Hover only: touch screens have none, and the label is in aria-label anyway.
 */
function Tip({ label, keys, align = 'start' }: { label: string; keys?: string; align?: 'start' | 'end' }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute top-full z-20 mt-1.5 flex items-center gap-1.5 rounded-md bg-neutral-900 px-2 py-1 text-xs font-normal whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-hover:delay-200 dark:bg-neutral-700 ${
        align === 'end' ? 'right-0' : 'left-0'
      }`}
    >
      {label}
      {keys && <kbd className="rounded bg-white/15 px-1 font-mono text-[11px]">{keys}</kbd>}
    </span>
  )
}

/** TeX source of a formula, typed over the sheet: Enter or leaving it draws, Escape gives up. */
function MathField({ x, y, tex, onDone }: { x: number; y: number; tex: string; onDone: (tex: string) => void }) {
  const done = useRef(false)
  const finish = (value: string) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      autoFocus
      defaultValue={tex}
      placeholder="TeX, e.g. \dot x = f(x, u)"
      aria-label="Formula in TeX"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish('')
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      style={{ left: `max(0.5rem, min(${x}px, calc(100% - 20.5rem)))`, top: y }}
      className="absolute z-10 w-80 max-w-[calc(100%-1rem)] rounded-lg border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm text-neutral-900 shadow-lg outline-none focus:border-accent"
    />
  )
}
