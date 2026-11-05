import { Point, type Canvas, type FabricObject } from 'fabric'
import { fit, separate } from './tidy'
import { follow, isClosed, isConnector, labelOf, type Linked, type Side } from './drawingLinks'

/*
 * Spreads a diagram over the pad: boxes pushed off the lines that cross them, then the arrangement stretched to the
 * whole pad, untangled again in that room, and zoomed out only if it outgrew it. The opposite of tidying up.
 */

export type Room = { left: number; top: number; width: number; height: number }

/** Space kept between boxes. */
export const SEPARATION = 40
/** How far the boxes' centers may spread apart to fill the pad: further, a small diagram looks scattered. */
const MAX_STRETCH = 2
/** Room kept from the pad's edges. */
const MARGIN = 24

export type Placed = { x: number; y: number; w: number; h: number }

/** Room kept between a line and a box it passes by. */
const CLEARANCE = 10
const UNTANGLE_ROUNDS = 120

/** Whether the segment from a to b crosses the box, enlarged by the margin: Liang-Barsky clipping. */
function crosses(a: Placed, b: Placed, box: Placed, margin: number) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const hw = box.w / 2 + margin
  const hh = box.h / 2 + margin
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a.x - (box.x - hw)],
    [dx, box.x + hw - a.x],
    [-dy, a.y - (box.y - hh)],
    [dy, box.y + hh - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/** The pairs of a line and a box it crosses, other than its own ends. */
export function crossings(boxes: Placed[], links: readonly (readonly [number, number])[]) {
  const out: [number, number, number][] = []
  for (const [u, v] of links) {
    boxes.forEach((box, i) => {
      if (i !== u && i !== v && crosses(boxes[u], boxes[v], box, CLEARANCE)) out.push([u, v, i])
    })
  }
  return out
}

/**
 * Boxes pushed off the lines that cross them, the line's ends moved a little the other way, overlaps settled each round.
 * Keeps the arrangement with the fewest crossings: the diagram grows, the pad then shows it smaller.
 */
function untangle(start: Placed[], links: readonly (readonly [number, number])[]) {
  const boxes = start.map((b) => ({ ...b }))
  let best = boxes.map((b) => ({ ...b }))
  let fewest = crossings(boxes, links).length
  for (let round = 0; round < UNTANGLE_ROUNDS && fewest > 0; round++) {
    for (const [u, v, i] of crossings(boxes, links)) {
      const a = boxes[u]
      const b = boxes[v]
      const box = boxes[i]
      // The point of the line nearest the box's center, and the way out from it.
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((box.x - a.x) * dx + (box.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
      let nx = box.x - (a.x + t * dx)
      let ny = box.y - (a.y + t * dy)
      let d = Math.hypot(nx, ny)
      if (d < 1e-6) {
        // Right on the line: out along its normal.
        const length = Math.hypot(dx, dy) || 1
        ;[nx, ny, d] = [-dy / length, dx / length, 0]
      } else {
        nx /= d
        ny /= d
      }
      // How far the center must be from the line for the box to clear it.
      const need = Math.abs(nx) * (box.w / 2 + CLEARANCE) + Math.abs(ny) * (box.h / 2 + CLEARANCE) - d
      if (need <= 0) continue
      box.x += nx * need * 0.6
      box.y += ny * need * 0.6
      for (const end of [a, b]) {
        end.x -= nx * need * 0.2
        end.y -= ny * need * 0.2
      }
    }
    separate(boxes, SEPARATION)
    const count = crossings(boxes, links).length
    if (count < fewest) {
      fewest = count
      best = boxes.map((b) => ({ ...b }))
    }
  }
  return best
}

/**
 * Fits the boxes to the room: shrunk as a whole if they outgrew it, then their centers spread along the axis with room left,
 * so the diagram takes the whole pad. Spreading the centers and not the boxes only opens room between lines and boxes.
 * Moves the boxes to the room's frame, from its top left corner, and returns the zoom to apply to them.
 */
function fill(boxes: Placed[], room: Room) {
  const extent = (axis: 'x' | 'y', size: 'w' | 'h') => {
    const low = Math.min(...boxes.map((b) => b[axis] - b[size] / 2))
    const high = Math.max(...boxes.map((b) => b[axis] + b[size] / 2))
    const centers = boxes.map((b) => b[axis])
    return { low, total: high - low, span: Math.max(...centers) - Math.min(...centers), min: Math.min(...centers) }
  }
  const x = extent('x', 'w')
  const y = extent('y', 'h')
  const f = Math.min(1, room.width / x.total, room.height / y.total)
  // In the zoomed frame, the room each axis has, less the boxes sticking out of the outer centers.
  const sx = x.span ? Math.min(MAX_STRETCH, Math.max(1, (room.width / f - (x.total - x.span)) / x.span)) : 1
  const sy = y.span ? Math.min(MAX_STRETCH, Math.max(1, (room.height / f - (y.total - y.span)) / y.span)) : 1
  // A small diagram, stretched as far as it may, sits in the middle of the width.
  const dx = (room.width / f - (x.total + x.span * (sx - 1))) / 2
  for (const b of boxes) {
    b.x = dx + x.min - x.low + (b.x - x.min) * sx
    b.y = y.min - y.low + (b.y - y.min) * sy
  }
  return f
}


/**
 * The sides an edge joins: across the flow's direction only when the boxes overlap along it, as in Mermaid's drawing.
 * Top to bottom, an edge leaves by the bottom whenever the next box lies lower.
 */
export function sides(from: FabricObject, to: FabricObject, horizontal: boolean): [Side, Side] {
  const a = from.getBoundingRect()
  const b = to.getBoundingRect()
  const below = b.top >= a.top + a.height ? 1 : a.top >= b.top + b.height ? -1 : 0
  const after = b.left >= a.left + a.width ? 1 : a.left >= b.left + b.width ? -1 : 0
  const vertical = horizontal ? !after && below : below || !after
  if (vertical) return below >= 0 ? [2, 0] : [0, 2]
  return after >= 0 ? [1, 3] : [3, 1]
}

/**
 * Untangled, spread to the room, which opens space between lines and boxes, then untangled again in that space.
 * Moves the boxes to the room's frame, from its top left corner, and returns the zoom to apply to them.
 */
export function spreadBoxes(boxes: Placed[], links: readonly (readonly [number, number])[], room: Room) {
  boxes.splice(0, boxes.length, ...untangle(boxes, links))
  fill(boxes, room)
  boxes.splice(0, boxes.length, ...untangle(boxes, links))
  return fill(boxes, room)
}

/**
 * Spreads the closed shapes of the drawing over the whole pad, upright ones only, with as few lines across them as it can.
 * Their labels and connectors follow. Returns whether there was anything to spread.
 */
export function spread(c: Canvas) {
  const shapes = c.getObjects().filter((o) => isClosed(o) && Math.abs(o.angle % 360) < 0.5)
  if (shapes.length < 2) return false
  const index = new Map(shapes.map((o, i) => [(o as Linked).id, i]))
  const links = c.getObjects().flatMap((o) => {
    const { from, to } = o as Linked
    const u = from && index.get(from.id)
    const v = to && index.get(to.id)
    return u !== undefined && v !== undefined && u !== v ? [[u, v] as const] : []
  })
  const size = (o: FabricObject) => ({ w: o.width * Math.abs(o.scaleX), h: o.height * Math.abs(o.scaleY) })
  const boxes = shapes.map((o) => ({ ...o.getCenterPoint(), ...size(o) })).map(({ x, y, w, h }) => ({ x, y, w, h }))
  separate(boxes, SEPARATION)
  const room = { left: MARGIN, top: MARGIN, width: c.width - 2 * MARGIN, height: c.height - 2 * MARGIN }
  const f = spreadBoxes(boxes, links, room)
  shapes.forEach((o, i) => {
    const b = boxes[i]
    if (f < 1) {
      // Zoomed out: the box and its text shrink together.
      o.set({ scaleX: o.scaleX * f, scaleY: o.scaleY * f })
      const label = labelOf(c, o)
      if (label) label.set({ fontSize: Math.max(8, label.fontSize * f) })
    }
    o.setPositionByOrigin(new Point(room.left + b.x * f, room.top + b.y * f), 'center', 'center')
    o.setCoords()
  })
  // The boxes moved around each other: each connector leaves and reaches them by the sides now facing.
  for (const o of c.getObjects().filter(isConnector)) {
    const l = o as Linked
    const u = l.from && index.get(l.from.id)
    const v = l.to && index.get(l.to.id)
    if (u === undefined || v === undefined || u === v) continue
    const [a, b]: [Side, Side] = sides(shapes[u], shapes[v], false)
    l.from = { ...l.from!, side: a }
    l.to = { ...l.to!, side: b }
  }
  for (const o of shapes) {
    follow(c, o)
    const label = labelOf(c, o)
    if (label) fit(label, o)
  }
  c.requestRenderAll()
  return true
}
