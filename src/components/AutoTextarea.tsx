import { useEffect, useImperativeHandle, useRef, type ComponentProps } from 'react'

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (v: string) => void
  /** Long texts: `/mermaid` or `/python` alone on its line opens a block. */
  commands?: boolean
}

const BLOCKS = ['mermaid', 'python']

/**
 * Swaps the command just typed for its block, the caret on the empty line. False when there is none.
 * Through execCommand, unlike a new value, so that Ctrl+Z gives the typed text back.
 */
function expandCommand(el: HTMLTextAreaElement) {
  const { value, selectionStart: end, selectionEnd } = el
  const start = value.lastIndexOf('\n', end - 1) + 1
  const command = value.slice(start, end)
  const language = command.slice(1)
  const atLineEnd = end === value.length || value[end] === '\n'
  if (selectionEnd !== end || !atLineEnd || command[0] !== '/' || !BLOCKS.includes(language)) return false
  const open = `\`\`\`${language}\n`
  el.setSelectionRange(start, end)
  if (!document.execCommand('insertText', false, `${open}\n\`\`\``)) {
    el.setSelectionRange(end, end)
    return false
  }
  el.setSelectionRange(start + open.length, start + open.length)
  return true
}

/**
 * Height matching the content. Collapsed to be measured, the field would shrink the sheet scrolling around it:
 * the sheet's scrollbar would vanish, the lines be measured at a wider width and the height come out short,
 * so a margin holds the room meanwhile. Its own scrollbar only once a max-height caps it.
 */
function fit(el: HTMLTextAreaElement) {
  el.style.marginBottom = `${el.offsetHeight}px`
  el.style.height = 'auto'
  const height = el.scrollHeight
  el.style.marginBottom = ''
  el.style.height = `${height}px`
  el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden'
}

/** Textarea that grows with its content. */
export function AutoTextarea({ value, onChange, commands, className, ref, ...rest }: Props) {
  const own = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => own.current!)
  useEffect(() => {
    if (own.current) fit(own.current)
  }, [value])
  // A width change (resized sheet or window) rewraps the lines.
  useEffect(() => {
    const el = own.current
    if (!el) return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <textarea
      ref={own}
      rows={1}
      value={value}
      onChange={(e) => {
        // Typing only: neither a paste nor a deletion that happens to leave the command.
        const typed = (e.nativeEvent as InputEvent).inputType === 'insertText'
        if (!(commands && typed && expandCommand(e.target))) onChange(e.target.value)
      }}
      className={`block w-full resize-none bg-transparent outline-none placeholder:text-neutral-400 ${className}`}
      {...rest}
    />
  )
}
