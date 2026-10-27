import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { renderMarkdown } from '../lib/format'
import { AutoTextarea } from './AutoTextarea'

/** Rendered Markdown; MathJax is fetched the first time a text contains math. */
export function Markdown({ text, className = '', ...rest }: { text: string } & Omit<ComponentProps<'div'>, 'children'>) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.querySelector('.math')) return
    // Offline before the chunk was cached: the TeX source stays readable as is.
    import('../lib/mathjax').then(({ typeset }) => typeset(el)).catch((err) => console.warn(err))
  }, [html])
  return <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} {...rest} />
}

type FieldProps = Omit<ComponentProps<typeof AutoTextarea>, 'onFocus' | 'onBlur'>

/** Text shown rendered, edited as source: a click puts the caret on the clicked block, leaving the field renders it again. */
export function MarkdownField({ value, className, ...rest }: FieldProps) {
  const [editing, setEditing] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number>(undefined)

  useEffect(() => {
    if (!editing || caret.current === undefined) return
    textarea.current?.focus()
    textarea.current?.setSelectionRange(caret.current, caret.current)
    caret.current = undefined
  }, [editing])

  const edit = (line?: number) => {
    caret.current = line === undefined ? value.length : value.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0)
    setEditing(true)
  }

  if (editing || !value.trim()) {
    return (
      <AutoTextarea
        ref={textarea}
        value={value}
        className={className}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        {...rest}
      />
    )
  }
  return (
    <Markdown
      text={value}
      tabIndex={0}
      className={`cursor-text ${className}`}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('a') || getSelection()?.toString()) return
        const block = target.closest<HTMLElement>('[data-line]')
        edit(block ? Number(block.dataset.line) : undefined)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.target !== e.currentTarget) return
        e.preventDefault()
        edit()
      }}
    />
  )
}
