import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { renderMarkdown } from '../lib/format'
import { imageUrl } from '../lib/images'
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
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLImageElement>('img[data-note-image]').forEach((img) => {
      // Unreachable, or another user's image in a shared issue: the alt text stays.
      imageUrl(img.dataset.noteImage!)
        .then((url) => {
          if (img.getAttribute('src') !== url) img.src = url
        })
        .catch((err) => console.warn(err))
    })
  }, [html])
  return <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} {...rest} />
}

/** Smallest width an image can be dragged to, so its grip stays reachable. */
const MIN_IMAGE_WIDTH = 64

/** The image alone over the whole screen; a click or Escape brings the note back. */
function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      // Capture phase, and stopped there: the sheet underneath stays open.
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 flex animate-fade cursor-zoom-out items-center justify-center bg-black/85 p-4">
      <img src={src} alt="Image" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>,
    document.body,
  )
}

/**
 * Rendered Markdown whose images open full screen on a click and resize from a grip in their corner,
 * where a double-click resets them.
 */
export function ResizableMarkdown({
  text,
  className,
  onImageWidth,
}: {
  text: string
  className: string
  onImageWidth: (path: string, width: number | null) => void
}) {
  const drag = useRef<{ x: number; width: number; limit: number; frame: HTMLElement; moved: boolean }>(undefined)
  const [zoom, setZoom] = useState<string | null>(null)
  const grip = (e: { target: EventTarget }) => (e.target as Element).closest<HTMLElement>('[data-grip]')
  const pathOf = (frame: HTMLElement) => frame.querySelector('img')!.dataset.noteImage!
  return (
    <>
      {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
      <Markdown
        text={text}
        className={`resizable ${className}`}
        onClick={(e) => {
          const target = e.target as HTMLElement
          const src = target.matches('.note-image img') && target.getAttribute('src')
          if (src) setZoom(src)
        }}
        onPointerDown={(e) => {
          const handle = grip(e)
          if (!handle) return
          e.preventDefault()
          handle.setPointerCapture(e.pointerId)
          const frame = handle.parentElement!
          drag.current = { x: e.clientX, width: frame.offsetWidth, limit: frame.parentElement!.clientWidth, frame, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          d.moved = true
          // Centered, the image grows on both sides: twice the pointer move keeps the corner under it.
        // Moved directly: the text only changes once, on release.
          d.frame.style.width = `${Math.min(d.limit, Math.max(MIN_IMAGE_WIDTH, Math.round(d.width + 2 * (e.clientX - d.x))))}px`
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = undefined
          if (d?.moved) onImageWidth(pathOf(d.frame), parseInt(d.frame.style.width))
        }}
        onDoubleClick={(e) => {
          const handle = grip(e)
          if (handle) onImageWidth(pathOf(handle.parentElement!), null)
        }}
      />
    </>
  )
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
