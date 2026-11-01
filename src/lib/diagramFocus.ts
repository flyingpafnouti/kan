import type { DiagramLink } from './mermaid'

const NOTE_START = /^\s*%%\s*@([^\s:]+)\s*:\s*(.*)$/
/** Not a %%{…}%% directive. */
const COMMENT = /^\s*%%(?!\{)(.*)$/
/** Lines that Markdown needs to keep on their own. */
const BLOCK_LINE = /^(?:[-*+] |\d+\. |[|>#]|```)/

/**
 * The description of each node, written in the source as a `%% @id : text` comment, which Mermaid ignores. The next
 * comment lines carry on, a bare %% between paragraphs, and any other line ends it.
 * Lines are joined back: they are wrapped for the source, and our Markdown turns each line break into a visible one.
 */
export function nodeNotes(source: string) {
  const notes = new Map<string, string>()
  let id: string | undefined
  for (const line of source.split(/\r?\n/)) {
    const start = line.match(NOTE_START)
    if (start) {
      id = start[1]
      notes.set(id, start[2])
      continue
    }
    const text = line.match(COMMENT)?.[1].trim()
    if (text === undefined) id = undefined
    if (text === undefined || !id) continue
    const note = notes.get(id)!
    const gap = !text ? '\n\n' : note.endsWith('\n') ? '' : BLOCK_LINE.test(text) ? '\n' : ' '
    notes.set(id, note + gap + text)
  }
  return notes
}

/** Mermaid names a node `<svg id>-flowchart-<node id>-<counter>`. */
const nodeId = (g: Element, svg: Element) => g.id.slice(`${svg.id}-flowchart-`.length).replace(/-\d+$/, '')

/** The flowchart node under target, null elsewhere. Its title is what comes first in its label. */
export function nodeAt(target: Element) {
  const g = target.closest('g.node')
  const svg = g?.closest('svg.flowchart')
  if (!g || !svg) return null
  return { id: nodeId(g, svg), title: g.querySelector('.nodeLabel p')?.firstChild?.textContent ?? '' }
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
