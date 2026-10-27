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
