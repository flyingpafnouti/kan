import { Ellipse, FabricImage, FabricText, Group, Path, Point, Rect, Textbox, util, type Canvas, type FabricObject } from 'fabric'
import { uuid } from '../lib/id'

/*
 * What ties the objects of a drawing together, kept as properties saved with them:
 * - a shape's label, a Textbox centered on it, `labelOf` the shape's id;
 * - a connector (line or arrow), `from` and `to` an anchor of a shape: it follows the shape.
 * Anchors are the middles of the four sides of an object's box, in its own frame, so they turn with it.
 */

export type Side = 0 | 1 | 2 | 3
export type Binding = { id: string; side: Side }
export type Linked = FabricObject & {
  id?: string
  labelOf?: string
  connector?: 'line' | 'arrow'
  from?: Binding
  to?: Binding
}

/** Saved with the objects, beside fabric's own properties. */
export const LINK_PROPS = ['id', 'labelOf', 'connector', 'from', 'to']

/** Distance at which the pointer catches an anchor, and at which a connector's end snaps to one. */
export const ANCHOR_HIT = 10
export const SNAP = 24
const LABEL_MARGIN = 12

const linked = (o: FabricObject) => o as Linked

export function ensureId(o: FabricObject) {
  const l = linked(o)
  l.id ??= uuid()
  return l.id
}

export const isLabel = (o: FabricObject) => !!linked(o).labelOf
export const isConnector = (o: FabricObject) => !!linked(o).connector
/** Shapes that take a label: the closed ones. */
export const isClosed = (o: FabricObject) => o instanceof Rect || o instanceof Ellipse

/** What connectors can hang on: everything but free hand lines, connectors and labels. */
export function isAnchorable(o: FabricObject) {
  if (isLabel(o) || isConnector(o)) return false
  return o instanceof Rect || o instanceof Ellipse || o instanceof FabricImage || o instanceof Group || o instanceof FabricText
}

/** Inside groups too: a connector keeps hold of a shape that was grouped. */
const byId = (c: Canvas, id: string) => c.getObjects().flatMap(withDescendants).find((o) => linked(o).id === id)

/** Anchor in scene coordinates, through the object's whole transform (group and selection included). */
export function anchorPoint(o: FabricObject, side: Side) {
  const w = o.width / 2
  const h = o.height / 2
  const local = [new Point(0, -h), new Point(w, 0), new Point(0, h), new Point(-w, 0)][side]
  return util.transformPoint(local, o.calcTransformMatrix())
}

export const anchors = (o: FabricObject) => ([0, 1, 2, 3] as Side[]).map((side) => ({ side, point: anchorPoint(o, side) }))

/** The anchorable objects on top first, as the pointer meets them. */
const anchorables = (c: Canvas) => c.getObjects().filter(isAnchorable).reverse()

/** The anchor of an object within distance of the point, if any. */
export function anchorAt(c: Canvas, p: Point, distance: number, except?: FabricObject) {
  let best: { object: FabricObject; side: Side; point: Point; d: number } | null = null
  for (const object of anchorables(c)) {
    if (object === except) continue
    for (const { side, point } of anchors(object)) {
      const d = point.distanceFrom(p)
      if (d <= distance && (!best || d < best.d)) best = { object, side, point, d }
    }
  }
  return best
}

/** The object whose box, a little enlarged, holds the point: its anchors show. */
export function hoveredAnchorable(c: Canvas, p: Point) {
  return anchorables(c).find((o) => {
    const r = o.getBoundingRect()
    return p.x >= r.left - ANCHOR_HIT && p.x <= r.left + r.width + ANCHOR_HIT && p.y >= r.top - ANCHOR_HIT && p.y <= r.top + r.height + ANCHOR_HIT
  })
}

/** Where a connector's end goes: an anchor near the pointer, else the nearest anchor of the object under it. */
export function snapEnd(c: Canvas, p: Point, except?: FabricObject) {
  const near = anchorAt(c, p, SNAP, except)
  if (near) return near
  const inside = anchorables(c).find((o) => o !== except && o.containsPoint(p))
  if (!inside) return null
  const nearest = anchors(inside).reduce((a, b) => (a.point.distanceFrom(p) <= b.point.distanceFrom(p) ? a : b))
  return { object: inside, side: nearest.side, point: nearest.point, d: 0 }
}

/** With Shift, a connector keeps to a multiple of 45°: horizontal, vertical or diagonal. */
const STEP = Math.PI / 4

function constrain(a: Point, p: Point) {
  const angle = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / STEP) * STEP
  const u = new Point(Math.cos(angle), Math.sin(angle))
  // The pointer's projection on that direction.
  const d = (p.x - a.x) * u.x + (p.y - a.y) * u.y
  return new Point(a.x + u.x * d, a.y + u.y * d)
}

/**
 * Where a connector drawn from a ends for the pointer at p, and the anchor it ties to.
 * With Shift the direction comes first: an anchor ties only if it lies on it, so the line stays straight.
 */
export function connectorEnd(c: Canvas, a: Point, p: Point, shift: boolean, except?: FabricObject) {
  const target = shift ? constrain(a, p) : p
  const snap = snapEnd(c, target, except)
  if (!snap) return { point: target, bind: null }
  if (!shift) return { point: snap.point, bind: snap }
  const along = target.subtract(a)
  const length = Math.hypot(along.x, along.y) || 1
  const off = Math.abs((snap.point.x - a.x) * along.y - (snap.point.y - a.y) * along.x) / length
  return off <= 1.5 ? { point: snap.point, bind: snap } : { point: target, bind: null }
}

/** Line, with its head for an arrow: one path, so it moves and scales as one object. */
export function linePath(a: Point | { x: number; y: number }, b: Point | { x: number; y: number }, arrow: boolean, width: number) {
  let d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (arrow) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const head = 10 + 2 * width
    const wing = (side: number) => {
      const t = angle + Math.PI - side * (Math.PI / 7)
      return `${b.x + head * Math.cos(t)} ${b.y + head * Math.sin(t)}`
    }
    d += ` M ${wing(1)} L ${b.x} ${b.y} L ${wing(-1)}`
  }
  return d
}

export function makeConnector(kind: 'line' | 'arrow', a: Point | { x: number; y: number }, b: Point | { x: number; y: number }, stroke: string, strokeWidth: number) {
  const path = new Path(linePath(a, b, kind === 'arrow', strokeWidth), {
    fill: '',
    stroke,
    strokeWidth,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  })
  linked(path).connector = kind
  return path
}

/** Both ends of a connector in scene coordinates, read from its path: right after any move or scale. */
function connectorEnds(o: Path) {
  const [m, l] = o.path as unknown as [string, number, number][]
  const matrix = o.calcTransformMatrix()
  const at = (x: number, y: number) => util.transformPoint(new Point(x - o.pathOffset.x, y - o.pathOffset.y), matrix)
  return [at(m[1], m[2]), at(l[1], l[2])]
}

/** Draws the connector again between its anchors, in place of the old one, at the same depth. */
function redrawConnector(c: Canvas, old: Path) {
  const l = linked(old)
  let [a, b] = connectorEnds(old)
  const from = l.from && byId(c, l.from.id)
  const to = l.to && byId(c, l.to.id)
  if (from) a = anchorPoint(from, l.from!.side)
  if (to) b = anchorPoint(to, l.to!.side)
  const next = makeConnector(l.connector!, a, b, old.stroke as string, old.strokeWidth)
  Object.assign(next, { id: l.id, from: from ? l.from : undefined, to: to ? l.to : undefined })
  const index = c.getObjects().indexOf(old)
  c.remove(old)
  c.insertAt(index, next)
}

/** The object and, for a group or a selection, everything inside it. */
function withDescendants(o: FabricObject): FabricObject[] {
  return o instanceof Group ? [o, ...o.getObjects().flatMap(withDescendants)] : [o]
}

/** The label sits on its shape's center, as wide as the shape, at its angle. */
export function placeLabel(label: Textbox, shape: FabricObject) {
  const d = util.qrDecompose(shape.calcTransformMatrix())
  label.set({
    left: d.translateX,
    top: d.translateY,
    angle: d.angle,
    width: Math.max(40, shape.width * Math.abs(d.scaleX) - 2 * LABEL_MARGIN),
  })
  label.setCoords()
}

export const labelOf = (c: Canvas, shape: FabricObject) =>
  c.getObjects().find((o): o is Textbox => o instanceof Textbox && linked(o).labelOf === linked(shape).id)

/**
 * After a move, a scale or a turn: the labels and the connectors of what moved follow it.
 * What moves along in the same selection or group is left alone.
 */
export function follow(c: Canvas, target: FabricObject) {
  const moved = withDescendants(target)
  const ids = new Set(moved.map((o) => linked(o).id).filter(Boolean))
  if (!ids.size) return
  for (const o of [...c.getObjects()]) {
    const l = linked(o)
    if (moved.includes(o)) continue
    if (o instanceof Textbox && l.labelOf && ids.has(l.labelOf)) {
      const shape = moved.find((m) => linked(m).id === l.labelOf)
      if (shape) placeLabel(o, shape)
    } else if (o instanceof Path && l.connector && ((l.from && ids.has(l.from.id)) || (l.to && ids.has(l.to.id)))) {
      redrawConnector(c, o)
    }
  }
}

/** A connector moved on its own lets go of the shapes that stayed. */
export function releaseMoved(target: FabricObject) {
  const moved = withDescendants(target)
  const ids = new Set(moved.map((o) => linked(o).id))
  for (const o of moved) {
    const l = linked(o)
    if (!l.connector) continue
    if (l.from && !ids.has(l.from.id)) l.from = undefined
    if (l.to && !ids.has(l.to.id)) l.to = undefined
  }
}

/** The label of a closed shape, made the first time; returned ready to edit. */
export function labelFor(c: Canvas, shape: FabricObject, font: string, fontSize: number) {
  const existing = labelOf(c, shape)
  if (existing) return existing
  const label = new Textbox('', {
    originX: 'center',
    originY: 'center',
    textAlign: 'center',
    fontFamily: font,
    fontSize,
    fill: (shape.stroke as string) || '#1e1e1e',
    // Reached through its shape, with a double-click: a click on the shape's middle still takes the shape.
    selectable: false,
    evented: false,
  })
  Object.assign(label, { id: uuid(), labelOf: ensureId(shape) })
  placeLabel(label, shape)
  c.insertAt(c.getObjects().indexOf(shape) + 1, label)
  return label
}

/** Labels are not selectable on their own; fabric does not save that, so it is set again after a load. */
export function restoreLinks(objects: FabricObject[]) {
  for (const o of objects) {
    if (o instanceof Group) restoreLinks(o.getObjects())
    if (isLabel(o)) o.set({ selectable: false, evented: false })
  }
}

/**
 * Removing objects takes their labels with them, and lets go of the connectors that hung on them.
 * Returns everything to remove.
 */
export function withDependents(c: Canvas, objects: FabricObject[]) {
  const ids = new Set(objects.flatMap(withDescendants).map((o) => linked(o).id).filter(Boolean))
  const labels = c.getObjects().filter((o) => ids.has(linked(o).labelOf!))
  for (const o of c.getObjects()) {
    const l = linked(o)
    if (l.from && ids.has(l.from.id)) l.from = undefined
    if (l.to && ids.has(l.to.id)) l.to = undefined
  }
  return [...objects, ...labels]
}

/** Draws the anchors of an object, the caught one filled. */
export function drawAnchors(ctx: CanvasRenderingContext2D, o: FabricObject, hot: Side | null, vpt: number[]) {
  ctx.save()
  ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5])
  for (const { side, point } of anchors(o)) {
    ctx.beginPath()
    ctx.arc(point.x, point.y, side === hot ? 6 : 4.5, 0, 2 * Math.PI)
    ctx.fillStyle = side === hot ? '#6965db' : 'white'
    ctx.strokeStyle = '#6965db'
    ctx.lineWidth = 1.5
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** Distance under which a loose connector end or a free text is taken to belong to a shape. */
const NEAR = 60

function boxDistance(o: FabricObject, p: Point) {
  const r = o.getBoundingRect()
  const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width))
  const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height))
  return Math.hypot(dx, dy)
}

const textOf = (o: FabricObject) => ((o as FabricText).text ?? '').replace(/\s+/g, ' ').trim()

/**
 * The drawing as a graph, in plain text, for a model that reads it beside the image: shapes and their labels,
 * connectors and the shapes they join, free texts. Exact where the editor knows the links, guessed by distance elsewhere.
 */
export function describeDrawing(c: Canvas) {
  const all = c.getObjects().flatMap(withDescendants).filter((o) => !(o instanceof Group))
  const shapes = all.filter((o) => isClosed(o) || (o instanceof FabricImage && typeof (o as { tex?: unknown }).tex === 'string'))
  const names = new Map<FabricObject, string>(shapes.map((o, i) => [o, `n${i + 1}`]))
  const labels = new Map<string, string>()
  for (const o of all) {
    const of = linked(o).labelOf
    if (of && textOf(o)) labels.set(of, textOf(o))
  }
  const loose = all.filter((o) => o instanceof FabricText && !isLabel(o) && textOf(o))
  const connectors = all.filter((o): o is Path => isConnector(o) && o instanceof Path)
  const used = new Set<FabricObject>()

  // A free text inside a shape without label is its label.
  for (const shape of shapes) {
    if (labels.has(linked(shape).id ?? '') || !isClosed(shape)) continue
    const inside = loose.find((t) => !used.has(t) && boxDistance(shape, t.getCenterPoint()) === 0)
    if (inside) {
      labels.set(ensureId(shape), textOf(inside))
      used.add(inside)
    }
  }

  const nearestShape = (p: Point) => {
    let best: FabricObject | null = null
    let d = NEAR
    for (const s of shapes) {
      const e = boxDistance(s, p)
      if (e < d) [best, d] = [s, e]
    }
    return best
  }
  const shapeName = (o: FabricObject | null | undefined) => (o ? names.get(o) : undefined)

  const edges = connectors.map((o) => {
    const l = linked(o)
    const [a, b] = connectorEnds(o)
    const bound = (end?: Binding) => (end ? shapes.find((s) => linked(s).id === end.id) : undefined)
    const from = bound(l.from) ?? nearestShape(a)
    const to = bound(l.to) ?? nearestShape(b)
    const exact = Boolean(l.from && bound(l.from) && l.to && bound(l.to))
    return { o, from: shapeName(from), to: shapeName(to), mid: new Point((a.x + b.x) / 2, (a.y + b.y) / 2), exact, kind: l.connector! }
  })

  // A free text near the middle of a connector, and nearer to it than to any shape, is its label.
  const edgeLabels = new Map<number, string>()
  for (const t of loose) {
    if (used.has(t)) continue
    const p = t.getCenterPoint()
    let best = -1
    let d = NEAR
    edges.forEach((e, i) => {
      const dist = e.mid.distanceFrom(p)
      if (dist < d && !edgeLabels.has(i)) [best, d] = [i, dist]
    })
    const shape = nearestShape(p)
    if (best >= 0 && (!shape || boxDistance(shape, p) > d)) {
      edgeLabels.set(best, textOf(t))
      used.add(t)
    }
  }

  const round = (p: Point) => `(${Math.round(p.x)}, ${Math.round(p.y)})`
  const lines = ['SHAPES (id, kind, center x y in pixels, label):']
  for (const s of shapes) {
    const kind = s instanceof Rect ? 'rectangle' : s instanceof Ellipse ? 'ellipse' : 'formula'
    const label = s instanceof FabricImage ? `TeX ${(s as unknown as { tex: string }).tex}` : labels.get(linked(s).id ?? '') ?? ''
    lines.push(`- ${names.get(s)} ${kind} ${round(s.getCenterPoint())} label: ${JSON.stringify(label)}`)
  }
  if (!shapes.length) lines.push('- none')
  lines.push('', 'CONNECTORS (from -> to, "?" = end not on a shape):')
  edges.forEach((e, i) => {
    const label = edgeLabels.get(i)
    const how = e.exact ? 'attached' : 'guessed from position'
    lines.push(`- ${e.kind} ${e.from ?? '?'} -> ${e.to ?? '?'} (${how})${label ? ` label: ${JSON.stringify(label)}` : ''}`)
  })
  if (!edges.length) lines.push('- none')
  const rest = loose.filter((t) => !used.has(t))
  lines.push('', 'OTHER TEXTS (center x y, text):')
  for (const t of rest) lines.push(`- ${round(t.getCenterPoint())} ${JSON.stringify(textOf(t))}`)
  if (!rest.length) lines.push('- none')
  const strokes = all.filter((o) => o instanceof Path && !isConnector(o)).length
  if (strokes) lines.push('', `${strokes} free hand strokes: only visible in the image (they may be shapes, arrows or handwriting).`)
  return lines.join('\n')
}
