import { mathjax } from '@mathjax/src/mjs/mathjax.js'
import { TeX } from '@mathjax/src/mjs/input/tex.js'
import { SVG } from '@mathjax/src/mjs/output/svg.js'
import { browserAdaptor } from '@mathjax/src/mjs/adaptors/browserAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js'
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/mjs/svg.js'
import '@mathjax/src/mjs/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js'
import '@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import '@mathjax/src/mjs/input/tex/braket/BraketConfiguration.js'
import '@mathjax/src/mjs/input/tex/cancel/CancelConfiguration.js'
import '@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js'
import '@mathjax/src/mjs/input/tex/physics/PhysicsConfiguration.js'

/*
 * MathJax 4 in direct mode, loaded only once a body contains math (see Markdown.tsx).
 * SVG output: no web font to fetch, and the glyphs take the text colour in both themes.
 */

// The font loads its rarer glyph ranges (double-struck, calligraphic, …) on demand: serve them as Vite chunks.
const ranges = import.meta.glob('/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js')
mathjax.asyncLoad = (name: string) => {
  const load = ranges[`/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${name.split('/').pop()}`]
  return load ? load() : Promise.reject(new Error(`MathJax: no module for ${name}`))
}

RegisterHTMLHandler(browserAdaptor())
// No automatic breaks in inline math: a formula stays in one piece, like in LaTeX.
const svg = new SVG({ fontData: MathJaxNewcmFont, fontCache: 'local', linebreaks: { inline: false } })
const doc = mathjax.document(document, {
  InputJax: new TeX({
    packages: ['base', 'ams', 'newcommand', 'noundefined', 'boldsymbol', 'braket', 'cancel', 'mathtools', 'physics'],
  }),
  OutputJax: svg,
})
document.head.append(svg.styleSheet(doc) as HTMLStyleElement)

// Rendering is redone on every edit of the text: keep each formula's SVG.
const cache = new Map<string, Element>()

async function convert(tex: string, display: boolean): Promise<Element> {
  const key = `${display ? 'D' : 'I'}${tex}`
  let node = cache.get(key)
  if (!node) {
    node = (await doc.convertPromise(tex, { display })) as Element
    cache.set(key, node)
  }
  return node.cloneNode(true) as Element
}

/** Replaces the TeX source of each .math element under root by its rendering. */
export async function typeset(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('.math:not([data-typeset])')) {
    el.dataset.typeset = ''
    el.replaceChildren(await convert(el.textContent ?? '', el.classList.contains('math-display')))
  }
}

/**
 * A formula as a standalone SVG data URL, for the drawings: its glyphs in the given color,
 * its size in pixels for that font size. Throws with MathJax's message on a TeX error.
 */
export async function texToSvg(tex: string, color: string, fontSize: number) {
  const svg = (await convert(tex, true)).querySelector('svg')
  if (!svg) throw new Error('No formula')
  const error = svg.querySelector('[data-mjx-error]')
  if (error) throw new Error(error.getAttribute('data-mjx-error') || 'TeX error')
  // The view box is in thousandths of an em.
  const [, , w, h] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
  const width = Math.ceil((w / 1000) * fontSize)
  const height = Math.ceil((h / 1000) * fontSize)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.removeAttribute('style')
  const text = new XMLSerializer().serializeToString(svg).replaceAll('currentColor', color)
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, width, height }
}
