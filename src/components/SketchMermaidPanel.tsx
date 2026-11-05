import { useEffect, useState } from 'react'
import { draw } from '../lib/mermaid'
import { MissingKeyError, setGroqKey } from '../lib/transcribe'
import { sketchToMermaid, type SketchResult } from '../lib/sketchToMermaid'
import { useTheme } from '../lib/theme'
import { toast } from '../lib/toast'
import { askKey } from '../hooks/useDictation'

/*
 * Experimental, dev only: the sketch converted to Mermaid, drawn beside its editable source.
 * Nothing is saved: the code is copied by hand, or drawn back on the pad to edit it there.
 * Without a sketch to convert, the panel opens empty, for a pasted diagram.
 */

export type SketchInput = { image: string; description: string }

export default function SketchMermaidPanel({
  input,
  onClose,
  onDraw,
}: {
  input: SketchInput | null
  onClose: () => void
  /** Draws the code on the pad; throws if it cannot. */
  onDraw: (code: string) => Promise<void>
}) {
  const theme = useTheme()
  const [result, setResult] = useState<SketchResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [svg, setSvg] = useState('')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const [details, setDetails] = useState(false)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    if (!input) return
    let live = true
    setResult(null)
    setFailure(null)
    ;(async () => {
      try {
        const r = await sketchToMermaid(input.image, input.description)
        if (!live) return
        setResult(r)
        setCode(r.code)
      } catch (e) {
        if (!live) return
        if (e instanceof MissingKeyError) {
          await setGroqKey(null).catch(() => {})
          if (await askKey()) return setRun((n) => n + 1)
          setFailure('No Groq key')
        } else setFailure(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      live = false
    }
  }, [input, run])

  // Drawn again as the source is edited.
  useEffect(() => {
    if (!code.trim()) return setSvg('')
    let live = true
    const timer = setTimeout(() => {
      draw(code, theme).then(
        (s) => live && (setSvg(s), setRenderError(null)),
        (e) => live && setRenderError(e instanceof Error ? e.message : String(e)),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [code, theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])

  const copy = () =>
    navigator.clipboard.writeText('```mermaid\n' + code.trim() + '\n```\n').then(
      () => toast('Mermaid block copied'),
      () => toast('Could not copy'),
    )

  const busy = Boolean(input) && !result && !failure

  const drawOnPad = async () => {
    setDrawing(true)
    try {
      await onDraw(code)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not draw this diagram')
    } finally {
      setDrawing(false)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white md:flex-row dark:bg-neutral-950">
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        {busy && <p className="animate-pulse text-sm text-neutral-500">Converting the sketch…</p>}
        {failure && <p className="text-sm text-red-600">{failure}</p>}
        {svg && <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />}
        {renderError && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {renderError}
          </pre>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-neutral-200 p-3 md:max-w-md md:border-t-0 md:border-l dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Mermaid (experimental)</span>
          {result && (
            <span className="truncate text-xs text-neutral-400" title={result.model}>
              {result.model.split('/').pop()} · {result.attempts} {result.attempts > 1 ? 'tries' : 'try'}
              {result.error ? ' · still invalid' : ''}
            </span>
          )}
          <div className="ml-auto flex shrink-0 gap-1">
            {input && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setRun((n) => n + 1)}
                className="rounded-lg px-2 py-1 text-sm text-neutral-500 disabled:opacity-30"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              disabled={!code.trim() || !svg || Boolean(renderError) || drawing}
              onClick={() => void drawOnPad()}
              title="Draw this flowchart on the pad, to edit it"
              className="rounded-lg px-2 py-1 text-sm text-neutral-500 disabled:opacity-30"
            >
              Draw
            </button>
            <button
              type="button"
              disabled={!code.trim()}
              onClick={() => void copy()}
              className="rounded-lg px-2 py-1 text-sm text-neutral-500 disabled:opacity-30"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-neutral-900 px-3 py-1 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Close
            </button>
          </div>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          readOnly={busy}
          autoFocus={!input}
          placeholder={busy ? '…' : 'Paste a Mermaid flowchart to draw it on the pad'}
          className="min-h-40 flex-1 resize-none rounded-xl bg-neutral-100 p-2 font-mono text-xs outline-none dark:bg-neutral-900"
        />
        {input && (
          <button type="button" onClick={() => setDetails(!details)} className="self-start text-xs text-neutral-400">
            {details ? 'Hide' : 'Show'} what the model got
          </button>
        )}
        {input && details && (
          <div className="max-h-64 overflow-auto rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-900">
            <img src={input.image} alt="Sent image" className="mb-2 max-h-32 border border-neutral-300" />
            <pre className="whitespace-pre-wrap">{input.description}</pre>
            {result?.plan && <pre className="mt-2 whitespace-pre-wrap text-neutral-500">PLAN{'\n'}{result.plan}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
