import type { DiagramLink } from './mermaid'

/** Mermaid names a node `<svg id>-flowchart-<node id>-<counter>`. */
const nodeId = (g: Element, svg: Element) => g.id.slice(`${svg.id}-flowchart-`.length).replace(/-\d+$/, '')

/** The id of the flowchart node under target, null elsewhere. */
export function nodeAt(target: Element) {
  const g = target.closest('g.node')
  const svg = g?.closest('svg.flowchart')
  return g && svg ? nodeId(g, svg) : null
}

/** Dims everything but node, its neighbours and the edges that reach them. With null, shows everything again. */
export function focusNode(svg: Element, links: DiagramLink[], node: string | null) {
  svg.classList.toggle('diagram-focus', node !== null)
  const around = links.filter((link) => link.start === node || link.end === node)
  const nodes = new Set([node, ...around.flatMap((link) => [link.start, link.end])])
  const edges = new Set(around.map((link) => link.id))
  svg.querySelectorAll('g.node').forEach((g) => g.classList.toggle('focused', nodes.has(nodeId(g, svg))))
  svg.querySelectorAll('path[data-edge]').forEach((path) => {
    path.classList.toggle('focused', edges.has(path.getAttribute('data-id')!))
  })
  svg.querySelectorAll('.edgeLabels > .edgeLabel > .label[data-id]').forEach((label) => {
    label.parentElement!.classList.toggle('focused', edges.has(label.getAttribute('data-id')!))
  })
}
