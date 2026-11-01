import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'

/* highlight.js, loaded only once a text contains Python (see Markdown.tsx). The colors are in index.css. */
hljs.registerLanguage('python', python)

export function highlightCode(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('code.language-python:not([data-highlighted])').forEach((el) => hljs.highlightElement(el))
}
