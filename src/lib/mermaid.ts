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

function draw(source: string, theme: Theme): Promise<string> {
  const key = `${theme}\n${source}`
  let svg = cache.get(key)
  if (!svg) {
    if (configured !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: theme === 'dark' ? 'dark' : 'default',
      })
      configured = theme
    }
    svg = mermaid.render(`mermaid-${nextId++}`, source).then((r) => r.svg)
    cache.set(key, svg)
  }
  return svg
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
