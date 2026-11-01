import mermaid from 'mermaid'
import type { Theme } from './theme'

/*
 * Mermaid, loaded only once an opened text contains a diagram (see Markdown.tsx).
 * Strict level: issues are shared, and a diagram's source may come from another user.
 */

let configured: Theme | undefined
let nextId = 0

// Each edit renders the whole text again: keep each diagram's SVG.
const cache = new Map<string, Promise<string>>()

function render(source: string, theme: Theme) {
  if (configured !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: theme === 'dark' ? 'dark' : 'default',
    })
    configured = theme
  }
  return mermaid.render(`mermaid-${nextId++}`, source).then((r) => r.svg)
}

function draw(source: string, theme: Theme): Promise<string> {
  const key = `${theme}\n${source}`
  let svg = cache.get(key)
  if (!svg) {
    svg = render(source, theme)
    cache.set(key, svg)
  }
  return svg
}

/** Both from -1 to 1. shape: portrait to landscape. density: boxes close together to far apart. */
export type DiagramLayout = { shape: number; density: number }

/** Mermaid's default, at the middle of both ranges. */
const BASE_SPACING = 50
/** How far each end of the density multiplies or divides the spacing. */
const DENSITY_RANGE = 5
/** Added at each end of the shape, whatever the density: a multiple of a tight spacing would change nothing. */
const SHAPE_SPACING = 150

/**
 * A flowchart laid out again at another shape and density. Stretching the drawing would distort its text.
 * With Dagre whatever the source asks for: ELK ignores these spacings.
 * An init directive wins over the front matter, and the text of the note stays as it is.
 */
export function drawShaped(source: string, theme: Theme, { shape, density }: DiagramLayout) {
  const base = BASE_SPACING * DENSITY_RANGE ** density
  const across = base + SHAPE_SPACING * Math.max(shape, 0)
  const along = base + SHAPE_SPACING * Math.max(-shape, 0)
  const horizontal = /^\s*(?:flowchart|graph)\s+(?:LR|RL)\b/m.test(source)
  const [nodeSpacing, rankSpacing] = horizontal ? [along, across] : [across, along]
  const directive = `%%{init: ${JSON.stringify({ layout: 'dagre', flowchart: { nodeSpacing, rankSpacing } })}}%%\n`
  const frontMatter = source.match(/^\s*---\n[\s\S]*?\n---[ \t]*\n/)?.[0].length ?? 0
  return render(source.slice(0, frontMatter) + directive + source.slice(frontMatter), theme)
}

/** Replaces the source of each .mermaid-diagram under root by its drawing, or adds the error beside the source. */
export async function drawDiagrams(root: HTMLElement, theme: Theme) {
  for (const el of root.querySelectorAll<HTMLElement>('.mermaid-diagram')) {
    const source = (el.dataset.source ??= el.textContent ?? '')
    if (el.dataset.drawn === theme) continue
    el.dataset.drawn = theme
    try {
      const svg = await draw(source, theme)
      // The theme changed meanwhile: a later call owns this element.
      if (el.dataset.drawn !== theme) continue
      el.innerHTML = svg
      delete el.dataset.error
    } catch (err) {
      if (el.dataset.drawn !== theme) continue
      el.textContent = source
      el.dataset.error = err instanceof Error ? err.message : String(err)
    }
  }
}
