import mermaid from 'mermaid'
import { Ellipse, IText, Point, Rect, type Canvas, type FabricObject } from 'fabric'
import { draw } from '../lib/mermaid'
import { anchorPoint, ensureId, labelFor, makeConnector } from './drawingLinks'
import { fit, separate } from './tidy'
import { SEPARATION, sides, spreadBoxes, type Room } from './spread'

/*
 * Experimental, dev only: a Mermaid flowchart drawn on the sketch pad, to edit it by hand.
 * The parser gives the nodes, their shapes, their styles and the edges. Mermaid's own drawing gives the geometry:
 * where each box goes and how large. The pad does not scroll: the arrangement is stretched to it, the boxes make room.
 */

export type Pen = { font: string; fontSize: number; color: string; width: number }

/** Room kept from the pad's edges and from what is already drawn. */
const MARGIN = 24
const GAP = 60
/** Below this, a diagram drawn beside the others would be too small to read: it goes over them. */
const MIN_SCALE = 0.6
/** The other direction is taken when the diagram comes this much larger in it. */
const TURN_GAIN = 1.2
/** The smallest text a fitted diagram keeps. */
const MIN_FONT = 8
/** Boxes keep Mermaid's size at least: the diagram is zoomed out as a whole, once untangled, only if it must. */
const MIN_BOX_SCALE = 1
/** How far the arrangement may stretch beyond Mermaid's, to fill the pad. */
const MAX_SPREAD = 1.3

const ELLIPSES = new Set(['circle', 'doublecircle', 'ellipse', 'circ', 'dbl-circ', 'f-circ', 'sm-circ'])
const PILLS = new Set(['stadium', 'pill', 'terminal'])
const ROUNDED = new Set(['round', 'roundedRect', 'rounded'])
const DIAMONDS = new Set(['diamond', 'question', 'diam', 'decision'])

type FlowNode = { id: string; label?: string; shape?: string; isGroup?: boolean; domId?: string; cssStyles?: string[]; cssCompiledStyles?: string[] }
type FlowEdge = {
  id: string
  start: string
  end: string
  label?: string
  type?: string
  arrowTypeEnd?: string
  thickness?: string
  style?: string[]
}
type Box = { x: number; y: number; w: number; h: number }
type Layout = { horizontal: boolean; nodes: Map<string, Box>; font: number; bounds: Box }

/** Comment lines go: the parser takes a lone `%%` for a node. Directives (`%%{...}%%`) stay. */
const withoutComments = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*%%(?!\{)/.test(line))
    .join('\n')

const DIRECTION = /^(\s*(?:flowchart|graph)\s+)(TB|TD|BT|LR|RL)\b/m

/** The same flowchart, top to bottom turned left to right and back. */
function turned(source: string) {
  const m = source.match(DIRECTION)
  if (!m) return source.replace(/^(\s*(?:flowchart|graph))[ \t]*$/m, '$1 LR')
  const next = ({ TB: 'LR', TD: 'LR', BT: 'RL', LR: 'TB', RL: 'BT' } as Record<string, string>)[m[2]]
  return source.replace(DIRECTION, `$1${next}`)
}

const isHorizontal = (source: string) => /^(?:LR|RL)$/.test(source.match(DIRECTION)?.[2] ?? '')

/** Mermaid labels allow a few tags and entities; the pad shows plain text with line breaks. */
function plain(label = '') {
  const html = label.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  const text = new DOMParser().parseFromString(html.replace(/#quot;/g, '"').replace(/#(\d+);/g, '&#$1;'), 'text/html').body.textContent ?? ''
  return text.replace(/[ \t]+/g, ' ').trim()
}

/** CSS declarations, the last one winning, as Mermaid applies them. */
function styles(list: string[] = []) {
  const out: Record<string, string> = {}
  for (const item of list) {
    const i = item.indexOf(':')
    if (i > 0) out[item.slice(0, i).trim()] = item.slice(i + 1).trim().replace(/\s*!important$/, '')
  }
  return out
}

const color = (value: string | undefined, fallback: string) => (value && value !== 'none' ? value : fallback)
const px = (value: string | undefined) => (value ? parseFloat(value) : NaN)
/** Mermaid's widths are thin for the pad's lines. */
const width = (value: string | undefined, fallback: number) => (Number.isFinite(px(value)) ? Math.max(1, px(value) * 1.3) : fallback)
/** A dash pattern, a little longer than Mermaid's: the pad's lines are thicker. */
const dashes = (value: string | undefined) => {
  const parts = (value ?? '').split(/[\s,]+/).map(Number).filter((n) => n > 0)
  return parts.length ? parts.map((n) => n * 1.5) : undefined
}

/** Where Mermaid drew each node, in the diagram's frame, and the size of its text. */
async function layout(source: string, nodes: FlowNode[]): Promise<Layout> {
  const host = document.body.appendChild(document.createElement('div'))
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden'
  try {
    host.innerHTML = await draw(source, 'light')
    const svg = host.querySelector('svg')!
    const root = svg.getScreenCTM()!.inverse()
    const center = (el: SVGGraphicsElement) => {
      const m = root.multiply(el.getScreenCTM()!)
      const b = el.getBBox()
      // The box's middle, through the element's own offset.
      return new Point(m.e + m.a * (b.x + b.width / 2), m.f + m.d * (b.y + b.height / 2))
    }
    const boxes = new Map<string, Box>()
    for (const n of nodes) {
      const g = n.domId && host.querySelector<SVGGraphicsElement>(`g.node[id$="-${CSS.escape(n.domId)}"]`)
      if (!g) continue
      const { width, height } = g.getBBox()
      const p = center(g)
      // The pad has no diamond: a box the size of what a diamond holds.
      const [w, h] = DIAMONDS.has(n.shape ?? '') ? [width * 0.62, height * 0.5] : [width, height]
      boxes.set(n.id, { x: p.x, y: p.y, w, h })
    }
    const label = host.querySelector('g.node .nodeLabel, g.node text')
    const font = (label && parseFloat(getComputedStyle(label).fontSize)) || 16
    const all = [...boxes.values()]
    const left = Math.min(...all.map((b) => b.x - b.w / 2))
    const top = Math.min(...all.map((b) => b.y - b.h / 2))
    const right = Math.max(...all.map((b) => b.x + b.w / 2))
    const bottom = Math.max(...all.map((b) => b.y + b.h / 2))
    return { horizontal: isHorizontal(source), nodes: boxes, font, bounds: { x: left, y: top, w: right - left, h: bottom - top } }
  } finally {
    host.remove()
  }
}

/** Where along its line a label overlaps nothing, the middle first; the middle when it is crowded everywhere. */
function freeSpot(label: FabricObject, a: Point, b: Point, others: FabricObject[]) {
  const w = label.width / 2 + 4
  const h = label.height / 2 + 2
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const p = new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    const hit = others.some((o) => {
      const r = o.getBoundingRect()
      return p.x + w > r.left && p.x - w < r.left + r.width && p.y + h > r.top && p.y - h < r.top + r.height
    })
    if (!hit) return p
  }
  return a.midPointFrom(b)
}


/**
 * Where a new diagram goes: the whole pad when empty, else the free band, right of the drawing or below it,
 * where it shrinks least. Shrunk too much there, it goes over the drawing, selected, ready to be moved.
 */
function freeRoom(c: Canvas, width: number, height: number) {
  const pad = { left: MARGIN, top: MARGIN, width: c.width - 2 * MARGIN, height: c.height - 2 * MARGIN }
  const scale = (r: Room) => Math.min(1, r.width / width, r.height / height)
  const objects = c.getObjects()
  if (!objects.length) return { room: pad, k: scale(pad) }
  const boxes = objects.map((o) => o.getBoundingRect())
  const right = Math.max(...boxes.map((b) => b.left + b.width)) + GAP
  const bottom = Math.max(...boxes.map((b) => b.top + b.height)) + GAP
  const bands = [
    { ...pad, left: right, width: c.width - MARGIN - right },
    { ...pad, top: bottom, height: c.height - MARGIN - bottom },
  ].filter((r) => r.width > 0 && r.height > 0)
  const best = bands.map((room) => ({ room, k: scale(room) })).sort((a, b) => b.k - a.k)[0]
  return best && best.k >= MIN_SCALE ? best : { room: pad, k: scale(pad) }
}


/** Draws the flowchart on the pad, beside what is there, and returns the new objects. Throws on other diagram types. */
export async function mermaidToSketch(c: Canvas, text: string, pen: Pen) {
  const source = withoutComments(text)
  // Drawn first: Mermaid registers its diagram types, the ELK layout among them, on its first drawing.
  await draw(source, 'light')
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
  if (!/^flowchart/.test(diagram.type)) throw new Error(`Only flowcharts can be drawn, not ${diagram.type}`)
  const data = (diagram.db as unknown as { getData(): { nodes: FlowNode[]; edges: FlowEdge[] } }).getData()
  const nodes = data.nodes.filter((n) => !n.isGroup)
  const edges = data.edges.filter((e) => e.thickness !== 'invisible' && e.start !== e.end)
  if (!nodes.length) throw new Error('No node to draw')

  // The direction where the diagram is drawn largest: the source's own, unless the other one is clearly better.
  const fitted = async (s: string) => {
    const l = await layout(s, nodes)
    return { l, ...freeRoom(c, l.bounds.w, l.bounds.h) }
  }
  let best = await fitted(source)
  if (best.k < 1) {
    const other = await fitted(turned(source))
    if (other.k > best.k * TURN_GAIN) best = other
  }
  const { l, room, k } = best

  // Mermaid spreads its diagrams wide: scaled as a whole to the pad, a large one would be unreadable.
  // Its boxes keep a readable size, its arrangement is stretched to the pad along each axis, then the boxes make room.
  const size = Math.max(k, MIN_BOX_SCALE)
  const spread = Math.min(1, size) * MAX_SPREAD
  const kx = Math.min(spread, room.width / l.bounds.w)
  const ky = Math.min(spread, room.height / l.bounds.h)
  const ids = [...l.nodes.keys()]
  const boxes = ids.map((id) => {
    const b = l.nodes.get(id)!
    return { x: (b.x - l.bounds.x) * kx, y: (b.y - l.bounds.y) * ky, w: b.w * size, h: b.h * size }
  })
  separate(boxes, SEPARATION)
  const index = new Map(ids.map((id, i) => [id, i]))
  const links = edges.flatMap((e) => (index.has(e.start) && index.has(e.end) ? [[index.get(e.start)!, index.get(e.end)!] as const] : []))
  // Untangled, spread to the pad, which opens room, then untangled again in that room.
  const f = spreadBoxes(boxes, links, room)
  const ox = room.left
  const oy = room.top
  const placed = new Map(ids.map((id, i) => [id, { x: ox + boxes[i].x * f, y: oy + boxes[i].y * f, w: boxes[i].w * f, h: boxes[i].h * f }]))
  const fontSize = Math.max(MIN_FONT, Math.round(l.font * size * f))

  const added: FabricObject[] = []
  const shapes = new Map<string, FabricObject>()
  for (const n of nodes) {
    const b = placed.get(n.id)
    if (!b) continue
    const css = styles([...(n.cssCompiledStyles ?? []), ...(n.cssStyles ?? [])])
    const { w, h } = b
    const p = new Point(b.x, b.y)
    const shape = n.shape ?? ''
    const look = {
      left: p.x - w / 2,
      top: p.y - h / 2,
      originX: 'left',
      originY: 'top',
      fill: color(css.fill, 'transparent'),
      stroke: color(css.stroke, pen.color),
      strokeWidth: width(css['stroke-width'], pen.width),
      strokeDashArray: dashes(css['stroke-dasharray']),
      strokeUniform: true,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    } as const
    const radius = PILLS.has(shape) ? h / 2 : ROUNDED.has(shape) ? Math.min(12, h / 4) : 4
    const o = ELLIPSES.has(shape) ? new Ellipse({ ...look, rx: w / 2, ry: h / 2 }) : new Rect({ ...look, width: w, height: h, rx: radius, ry: radius })
    ensureId(o)
    o.setCoords()
    c.add(o)
    added.push(o)
    shapes.set(n.id, o)
    const label = plain(n.label ?? n.id)
    if (label) {
      const t = labelFor(c, o, pen.font, fontSize)
      t.set({ text: label, fill: color(css.color, pen.color) })
      // Mermaid measured its own font: the pad's is wider, the text shrinks where it must.
      fit(t, o)
      added.push(t)
    }
  }

  const edgeLabels: FabricObject[] = []
  for (const e of edges) {
    const from = shapes.get(e.start)
    const to = shapes.get(e.end)
    if (!from || !to) continue
    const css = styles(e.style)
    const [a, b] = sides(from, to, l.horizontal)
    const head = e.arrowTypeEnd && e.arrowTypeEnd !== 'none' && e.type !== 'arrow_open'
    const thickness = width(css['stroke-width'], e.thickness === 'thick' ? pen.width * 1.75 : pen.width)
    const link = makeConnector(head ? 'arrow' : 'line', anchorPoint(from, a), anchorPoint(to, b), color(css.stroke, pen.color), thickness)
    link.set({ strokeDashArray: dashes(css['stroke-dasharray']) ?? (e.thickness === 'dotted' ? [6, 6] : undefined) })
    Object.assign(link, { from: { id: ensureId(from), side: a }, to: { id: ensureId(to), side: b } })
    const id = ensureId(link)
    c.add(link)
    added.push(link)
    const text = plain(e.label)
    if (!text) continue
    // On its line, tied to its connector: it moves with it, and the conversion reads it back as its label.
    const label = new IText(text, {
      originX: 'center',
      originY: 'center',
      fontFamily: pen.font,
      fontSize: Math.max(MIN_FONT, Math.round(fontSize * 0.85)),
      fill: pen.color,
      textBackgroundColor: 'white',
    })
    Object.assign(label, { edgeOf: id })
    const spot = freeSpot(label, anchorPoint(from, a), anchorPoint(to, b), [...shapes.values(), ...edgeLabels])
    label.set({ left: spot.x, top: spot.y })
    label.setCoords()
    edgeLabels.push(label)
  }
  // Above every connector.
  if (edgeLabels.length) c.add(...edgeLabels)
  added.push(...edgeLabels)
  c.requestRenderAll()
  return added
}
