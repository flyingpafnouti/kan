import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { askKey, useDictation } from '../hooks/useDictation'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { MissingKeyError, getGroqKey, postProcess, setGroqKey, setPostPrompt, watchPostPrompt } from '../lib/transcribe'
import { toast } from '../lib/toast'
import { DictationButton } from './DictationButton'
import { SendIcon, SparkleIcon } from './icons'

/** The prompt travels in the session token, so it has to stay short. */
const MAX_LENGTH = 2000
/** Width of the bubble (w-80), the room kept beside the screen edges and the gap to the button. */
const WIDTH = 320
const MARGIN = 16
const GAP = 8

type Placement = { right: number; maxHeight: number; top?: number; bottom?: number }

/**
 * Opens a bubble holding a prompt, sent on demand to rewrite the whole text. The prompt is saved for the next time.
 * The bubble goes to the body: inside a sheet, the scrolling panel would cut it.
 */
export function PostProcessButton({ text, onResult }: { text: string; onResult: (text: string) => void }) {
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [at, setAt] = useState<Placement | null>(null)
  const [busy, setBusy] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const inset = useKeyboardInset()
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  /** What the dictation erased, put back if it brings nothing to replace it. */
  const erased = useRef<string | null>(null)
  const dictation = useDictation((prompt) => {
    erased.current = null
    setDraft(prompt)
  })
  const recording = dictation.state === 'recording'
  const locked = busy || dictation.state === 'transcribing'
  const ready = Boolean(draft.trim() && text.trim()) && dictation.state === 'idle'

  useEffect(() => watchPostPrompt(setSaved), [])

  useEffect(() => {
    if (dictation.state !== 'idle' || erased.current === null) return
    setDraft(erased.current)
    erased.current = null
  }, [dictation.state])

  function dictate() {
    if (dictation.state === 'idle') {
      erased.current = draft
      setDraft('')
    }
    dictation.toggle()
  }

  /** On the side of the button with the most room, and never taller than that room. */
  function place(): Placement {
    const r = button.current!.getBoundingClientRect()
    // clientWidth leaves out the scrollbar gutter, which fixed elements do not count either.
    const width = document.documentElement.clientWidth
    // Lined up with the button, as far as both edges of the screen allow.
    const right = Math.max(MARGIN, Math.min(width - r.right, width - WIDTH - MARGIN))
    const visible = innerHeight - inset
    const edge = Math.min(r.top, visible)
    const above = edge - GAP - MARGIN
    const below = visible - r.bottom - GAP - MARGIN
    return above >= below
      ? { right, maxHeight: above, bottom: innerHeight - edge + GAP }
      : { right, maxHeight: below, top: r.bottom + GAP }
  }

  function open() {
    setAt(place())
    setDraft(saved)
  }

  // The on-screen keyboard or a resized window can change which side has the most room.
  useEffect(() => {
    if (at) setAt(place())
  }, [inset])

  function save() {
    const prompt = draft.trim()
    if (prompt === saved) return
    setSaved(prompt)
    setPostPrompt(prompt).catch(() => {
      setSaved(saved)
      toast('Could not save the prompt (offline?)')
    })
  }

  function close() {
    setAt(null)
    // The field is empty or partial until the dictation ends: there is nothing to save yet.
    if (dictation.state === 'idle') save()
    else dictation.cancel()
  }

  async function send() {
    if (!ready || busy) return
    save()
    if (!(await getGroqKey()) && !(await askKey())) return
    setBusy(true)
    const before = text
    try {
      onResultRef.current(await postProcess(before, draft.trim()))
      setAt(null)
      // Long enough to read the result before deciding.
      toast('Note rewritten', { duration: 10000, action: { label: 'Undo', run: () => onResultRef.current(before) } })
    } catch (e) {
      if (e instanceof MissingKeyError) {
        await setGroqKey(null).catch(() => {})
        toast('Groq key rejected, it will be asked again')
      } else toast(navigator.onLine ? 'Post-processing failed' : 'Post-processing unavailable offline')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent) => {
      const submit = e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing
      if (!locked && e.key !== 'Escape' && !submit) return
      // Capture phase, and stopped there: the sheet underneath stays open.
      e.preventDefault()
      e.stopPropagation()
      if (locked) return
      if (submit && recording) dictate()
      else if (submit && ready) void send()
      else close()
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!locked && !bubble.current?.contains(target) && !button.current?.contains(target)) close()
    }
    const onResize = () => setAt(place())
    addEventListener('keydown', onKey, true)
    addEventListener('pointerdown', onDown)
    addEventListener('resize', onResize)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('pointerdown', onDown)
      removeEventListener('resize', onResize)
    }
  })

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label="Post-processing prompt"
        aria-expanded={Boolean(at)}
        title="Post-processing prompt"
        onClick={() => (at ? close() : open())}
        className="rounded-full p-1.5 text-neutral-300 transition hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400"
      >
        <SparkleIcon width={16} height={16} />
      </button>
      {at &&
        createPortal(
          <>
            {/* The result replaces the text: nothing is edited or closed under it while it comes. */}
            {locked && <div className="fixed inset-0 z-50" />}
            <div
              ref={bubble}
              style={at}
              className="fixed z-50 flex w-80 max-w-[calc(100vw-2rem)] animate-sheet flex-col rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800"
            >
              <label className="flex min-h-0 flex-1 flex-col">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Post-processing prompt
                </span>
                <textarea
                  autoFocus
                  rows={5}
                  maxLength={MAX_LENGTH}
                  value={draft}
                  readOnly={locked || recording}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    recording
                      ? 'Speak…'
                      : dictation.state === 'transcribing'
                        ? 'Transcribing…'
                        : 'Fix the punctuation and turn it into a bullet list…'
                  }
                  className="block min-h-0 w-full flex-1 resize-none rounded-xl bg-neutral-100 px-3 py-2 text-base outline-none placeholder:text-neutral-400 md:text-sm dark:bg-neutral-800"
                />
              </label>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className={`text-xs text-neutral-400 ${locked ? 'animate-pulse' : ''}`}>
                  {busy
                    ? 'Rewriting…'
                    : dictation.state === 'transcribing'
                      ? 'Transcribing…'
                      : recording
                        ? ''
                        : 'Rewrites the whole note.'}
                </p>
                <div className="flex items-center gap-2">
                  <DictationButton dictation={{ ...dictation, toggle: dictate }} label="Dictate the prompt" />
                  <button
                    type="button"
                    aria-label="Send"
                    title="Send (Ctrl ↵)"
                    onClick={() => void send()}
                    disabled={!ready || busy}
                    className="rounded-xl bg-accent p-2 text-white transition disabled:opacity-30"
                  >
                    <SendIcon width={16} height={16} />
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
