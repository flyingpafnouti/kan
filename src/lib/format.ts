import MarkdownIt, { type StateBlock, type StateInline } from 'markdown-it'

/*
 * Markdown for the issue and note bodies. Raw HTML is escaped, so the output is safe to inject.
 * Math is kept verbatim in .math elements and typeset afterwards by src/lib/mathjax.ts:
 * $…$ and \(…\) inline, $$…$$ and \[…\] displayed.
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

export function renderMarkdown(src: string): string {
  return md.render(src)
}
