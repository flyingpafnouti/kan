import MarkdownIt, { type StateBlock, type StateInline } from 'markdown-it'
import { imagePath, readyImageUrl } from './images'

/*
 * Markdown for the issue and note bodies. Raw HTML is escaped, so the output is safe to inject.
 * Math is kept verbatim in .math elements and typeset afterwards by src/lib/mathjax.ts:
 * $…$ and \(…\) inline, $$…$$ and \[…\] displayed.
 * ```mermaid fences are kept the same way for src/lib/mermaid.ts, in the views that show diagrams.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const DELIMITERS = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
  { open: '$', close: '$', display: false },
]

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  const d = DELIMITERS.find((d) => src.startsWith(d.open, pos))
  if (!d) return false
  const start = pos + d.open.length
  let end = src.indexOf(d.close, start)
  if (d.open === '$') {
    // Pandoc rule, so prices stay text: no space after the opening $, none before the closing one, no digit after it.
    if (/\s/.test(src[start] ?? ' ')) return false
    while (end !== -1 && (/\s/.test(src[end - 1]) || src[end - 1] === '\\' || /\d/.test(src[end + 1] ?? ''))) {
      end = src.indexOf('$', end + 1)
    }
  }
  if (end === -1 || end === start) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = src.slice(start, end)
    token.markup = d.open
    token.meta = { display: d.display }
  }
  state.pos = end + d.close.length
  return true
}

/** $$ or \[ opening a line, closed on the same line or a later one. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n])
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const first = lineText(startLine)
  const d = DELIMITERS.find((d) => d.display && first.startsWith(d.open))
  if (!d) return false
  let rest = first.slice(d.open.length)
  let line = startLine
  const body: string[] = []
  for (;;) {
    const close = rest.indexOf(d.close)
    if (close !== -1) {
      // Text after the closing delimiter would be lost: leave the line to the inline rule.
      if (rest.slice(close + d.close.length).trim()) return false
      body.push(rest.slice(0, close))
      break
    }
    body.push(rest)
    if (++line >= endLine) return false
    rest = lineText(line)
  }
  if (silent) return true
  const token = state.push('math_block', 'math', 0)
  token.content = body.join('\n').trim()
  token.markup = d.open
  token.block = true
  token.map = [startLine, line + 1]
  state.line = line + 1
  return true
}

md.inline.ruler.before('escape', 'math_inline', mathInline)
md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

const escape = md.utils.escapeHtml
md.renderer.rules.math_inline = (tokens, i) =>
  `<span class="math${tokens[i].meta?.display ? ' math-display' : ''}">${escape(tokens[i].content)}</span>`
md.renderer.rules.math_block = (tokens, i) =>
  `<div class="math math-display" data-line="${tokens[i].map![0]}">${escape(tokens[i].content)}</div>\n`

/** hidden: a label stands for the diagram (note list). editable: it gets a button to its source. */
export type DiagramMode = 'hidden' | 'shown' | 'editable'

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>'

const fence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, i, options, env, self) => {
  const token = tokens[i]
  if (token.info.trim().split(/\s+/)[0] !== 'mermaid') return fence(tokens, i, options, env, self)
  const line = `data-line="${token.map![0]}"`
  const { diagrams } = env as { diagrams: DiagramMode }
  if (diagrams === 'hidden') return `<div class="mermaid-placeholder" ${line}>Diagram</div>\n`
  const edit =
    diagrams === 'editable'
      ? `<button type="button" class="mermaid-edit" title="Edit diagram" aria-label="Edit diagram">${PENCIL}</button>`
      : ''
  return `<div class="mermaid-block" ${line}><div class="mermaid-diagram">${escape(token.content)}</div>${edit}</div>\n`
}

// Source line of each top-level block, so a click on the preview puts the caret on that line.
md.core.ruler.push('source_line', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1 && token.level === 0) token.attrSet('data-line', String(token.map[0]))
  }
})

// Links open outside the app.
const linkOpen = md.renderer.rules.link_open ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options))
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i].attrSet('target', '_blank')
  tokens[i].attrSet('rel', 'noopener noreferrer')
  return linkOpen(tokens, i, options, env, self)
}

// Note images have no public URL: the Markdown component fills in their src once it has the file.
const image = md.renderer.rules.image!
md.renderer.rules.image = (tokens, i, options, env, self) => {
  const path = imagePath(String(tokens[i].attrGet('src')))
  if (!path) return image(tokens, i, options, env, self)
  const width = tokens[i].content.match(/\|(\d{1,4})$/)?.[1]
  const url = readyImageUrl(path)
  return (
    `<span class="note-image"${width ? ` style="width:${width}px"` : ''}>` +
    `<img data-note-image="${escape(path)}"${url ? ` src="${escape(url)}"` : ''} alt="Image" loading="lazy">` +
    '<span class="image-grip" data-grip title="Drag to resize, double-click to reset"></span></span>'
  )
}

/** Plain body for a card: each diagram's source gives way to a label. A fence left open runs to the end, as when rendered. */
export function hideDiagrams(body: string): string {
  return body.replace(/^[ \t]*(`{3,}|~{3,})[ \t]*mermaid\b.*(?:\n[\s\S]*?(?:^[ \t]*\1[`~]*[ \t]*$|$(?![\s\S]))|$)/gm, 'Diagram')
}

export function renderMarkdown(src: string, diagrams: DiagramMode): string {
  return md.render(src, { diagrams })
}
