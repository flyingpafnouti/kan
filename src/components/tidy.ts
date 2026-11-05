import { Ellipse, FabricText, Point, Textbox, type Canvas, type FabricObject } from 'fabric'
import { follow, isClosed, isLabel, labelFor, labelOf, placeLabel } from './drawingLinks'

/*
 * Tidies a hand placed diagram: what is nearly equal becomes equal.
 * Close sizes take their mean, close centers line up, close spacings between rows and columns even out,
 * the boxes that overlap move apart, and the texts of the shapes shrink until they fit. Only closed shapes move, and what hangs on them follows.
 */

/** Two sizes this close, relative to the larger, are meant to be equal. */
const SIZE_TOLERANCE = 0.2
/** Two spacings this close, relative to the larger, are meant to be equal. */
const GAP_TOLERANCE = 0.25
/** Two centers closer than this share of the shapes' typical size, and at least MIN_ALIGN, are meant to line up. */
const ALIGN_SHARE = 0.35
const MIN_ALIGN = 16
/** Room kept between a label and its shape's border, as in placeLabel; and the smallest size a text shrinks to. */
const LABEL_MARGIN = 12
const MIN_FONT = 10

type Box = { shape: FabricObject; x: number; y: number; w: number; h: number }

/**
 * Groups of values meant to be the same, each value's group index in the input order.
 * A value joins the group of its sorted predecessor when close to the group's first value: no drift along a chain.
 */
function cluster(values: number[], close: (first: number, v: number) => boolean) {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const group = new Array<number>(values.length)
  let first = NaN
  let g = -1
  for (const i of order) {
    if (g < 0 || !close(first, values[i])) {
      g++
      first = values[i]
    }
    group[i] = g
  }
  return group
}

/** Each value replaced by the mean of its group. */
function evenOut(values: number[], close: (first: number, v: number) => boolean) {
  const group = cluster(values, close)
  const sums = new Map<number, { s: number; n: number }>()
  values.forEach((v, i) => {
    const m = sums.get(group[i]) ?? { s: 0, n: 0 }
    sums.set(group[i], { s: m.s + v, n: m.n + 1 })
  })
  return values.map((_, i) => {
    const m = sums.get(group[i])!
    return m.s / m.n
  })
}

const relative = (tolerance: number) => (a: number, b: number) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b))
const absolute = (tolerance: number) => (a: number, b: number) => Math.abs(a - b) <= tolerance

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Centers lined up, then the spacings between the lines evened out, the lines keeping their mean place.
 * Returns each shape's new center on this axis.
 */
function arrange(centers: number[], sizes: number[]) {
  const tolerance = Math.max(MIN_ALIGN, ALIGN_SHARE * median(sizes))
  const aligned = evenOut(centers, absolute(tolerance))
  const lines = [...new Set(aligned)].sort((a, b) => a - b)
  if (lines.length < 3) return aligned
  const gaps = lines.slice(1).map((v, i) => v - lines[i])
  const even = evenOut(gaps, relative(GAP_TOLERANCE))
  const placed = [lines[0]]
  for (const gap of even) placed.push(placed.at(-1)! + gap)
  const shift = lines.reduce((s, v) => s + v, 0) / lines.length - placed.reduce((s, v) => s + v, 0) / placed.length
  const moved = new Map(lines.map((v, i) => [v, placed[i] + shift]))
  return aligned.map((v) => moved.get(v)!)
}

/** Space kept between two boxes pushed apart. */
const SEPARATION = 24
/** Rounds of pushing: each one settles the overlaps the previous one made. */
const SEPARATION_ROUNDS = 60

/**
 * Overlapping boxes pushed apart, half each, along the axis where they overlap least: the smallest move.
 * Boxes on one row or column overlap only across it, so they stay lined up.
 */
export function separate(boxes: { x: number; y: number; w: number; h: number }[], gap = SEPARATION) {
  for (let round = 0; round < SEPARATION_ROUNDS; round++) {
    let moved = false
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx)
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy)
        if (ox <= 0.5 || oy <= 0.5) continue
        moved = true
        if (ox < oy) {
          const s = (dx >= 0 ? 1 : -1) * (ox / 2)
          a.x -= s
          b.x += s
        } else {
          const s = (dy >= 0 ? 1 : -1) * (oy / 2)
          a.y -= s
          b.y += s
        }
      }
    }
    if (!moved) return
  }
}

/** Room for a label: the box less its margins; in an ellipse, the rectangle it holds. */
function room(shape: FabricObject) {
  const w = shape.width * Math.abs(shape.scaleX)
  const h = shape.height * Math.abs(shape.scaleY)
  const inner = shape instanceof Ellipse ? Math.SQRT1_2 : 1
  return { w: Math.max(40, w * inner - 2 * LABEL_MARGIN), h: Math.max(10, h * inner - LABEL_MARGIN) }
}

/** Shrinks the label until it fits its shape: a word wider than the box widens a Textbox, more lines make it taller. */
export function fit(label: Textbox, shape: FabricObject) {
  const { w, h } = room(shape)
  const overflows = () => {
    // Wrapped at the room's width: in an ellipse, narrower than placeLabel's.
    label.set({ width: w })
    label.initDimensions()
    return label.width > w + 0.5 || label.height > h + 0.5
  }
  while (label.fontSize > MIN_FONT && overflows()) label.set({ fontSize: label.fontSize - 1 })
  placeLabel(label, shape)
  label.setCoords()
}

/** A free text lying on a shape without label becomes its label, so it stays inside and follows it. */
function adoptTexts(c: Canvas, shapes: FabricObject[]) {
  const free = c.getObjects().filter((o): o is FabricText => o instanceof FabricText && !isLabel(o) && !!o.text.trim())
  for (const shape of shapes) {
    if (labelOf(c, shape)) continue
    const text = free.find((t) => c.contains(t) && shape.containsPoint(t.getCenterPoint()))
    if (!text) continue
    const label = labelFor(c, shape, text.fontFamily, text.fontSize)
    label.set({ text: text.text.replace(/\s+/g, ' ').trim(), fill: text.fill })
    c.remove(text)
  }
}

/**
 * Tidies the closed shapes among the given objects, or all of them, upright ones only.
 * Returns whether anything was there to tidy.
 */
export function tidy(c: Canvas, scope?: FabricObject[]) {
  const shapes = (scope ?? c.getObjects()).filter((o) => isClosed(o) && !o.group && Math.abs(o.angle % 360) < 0.5)
  if (!shapes.length) return false
  adoptTexts(c, shapes)

  const boxes: Box[] = shapes.map((shape) => {
    const center = shape.getCenterPoint()
    return { shape, x: center.x, y: center.y, w: shape.width * Math.abs(shape.scaleX), h: shape.height * Math.abs(shape.scaleY) }
  })
  if (boxes.length > 1) {
    const ws = evenOut(boxes.map((b) => b.w), relative(SIZE_TOLERANCE))
    const hs = evenOut(boxes.map((b) => b.h), relative(SIZE_TOLERANCE))
    const xs = arrange(boxes.map((b) => b.x), ws)
    const ys = arrange(boxes.map((b) => b.y), hs)
    boxes.forEach((b, i) => Object.assign(b, { w: ws[i], h: hs[i], x: xs[i], y: ys[i] }))
    // Larger boxes, or boxes drawn over each other, make room.
    separate(boxes)
  }

  for (const { shape, x, y, w, h } of boxes) {
    shape.set({ scaleX: (w / shape.width) * Math.sign(shape.scaleX || 1), scaleY: (h / shape.height) * Math.sign(shape.scaleY || 1) })
    shape.setPositionByOrigin(new Point(x, y), 'center', 'center')
    shape.setCoords()
    follow(c, shape)
    const label = labelOf(c, shape)
    if (label) fit(label, shape)
  }
  c.requestRenderAll()
  return true
}
