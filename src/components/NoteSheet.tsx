import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { noteTooLong, type Note, type NoteKind, type Project } from '../lib/types'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { useScrollLock } from '../hooks/useScrollLock'
import { formatDate } from '../lib/date'
import { imageFiles, prepareImage, removeImageLink, replaceImagePath, setImageWidth } from '../lib/images'
import { loadDrawing, prepareDrawing, type DrawingData } from '../lib/drawings'
import { toast } from '../lib/toast'
import { ResizableMarkdown } from './Markdown'
import { AutoTextarea, placeCaret, type Caret } from './AutoTextarea'
import { ModeSwitch, type Mode } from './Switch'
import { DictationButton } from './DictationButton'
import { PostProcessButton } from './PostProcessButton'
import { DrawIcon } from './icons'
import { SheetGrip, useSheetSize } from './SheetResize'
import { KindSwitch } from './KindSwitch'

interface Props {
  note: Note
  /** Opens on the text, ready to type, rather than on the rendered note. */
  startEditing?: boolean
  projects: Project[] | null
  onSave: (body: string) => void
  onKind: (kind: NoteKind) => void
  onDelete: () => void
  /** Turns the note, with its latest text, into an issue of that project. */
  onToIssue: (projectId: string, body: string) => void
  onClose: () => void
}

/** fabric comes with the editor, only once a drawing is opened. */
const DrawingEditor = lazy(() => import('./DrawingEditor'))

export function NoteSheet({ note, startEditing, projects, onSave, onKind, onDelete, onToIssue, onClose }: Props) {
  const [body, setBody] = useState(note.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef(note.body)
  const latest = useRef(body)
  latest.current = body
  /** Deleted or turned into an issue: nothing left to save. */
  const ended = useRef(false)
  useScrollLock()
  const panel = useRef<HTMLDivElement>(null)
  const sheetSize = useSheetSize('note-size', panel)
  const [uploading, setUploading] = useState(0)
  const [mode, setMode] = useState<Mode>(startEditing ? 'edit' : 'read')
  const field = useRef<HTMLTextAreaElement>(null)
  /** Where a double-click on the rendered note puts the caret; the end of the text otherwise. */
  const caret = useRef<Caret>(undefined)
  /** Links of the images on their way to the server. */
  const pending = useRef(new Set<string>())
  /** The drawing being edited: a new one, or the path of the one it replaces. */
  const [drawing, setDrawing] = useState<{ path?: string; data?: DrawingData } | null>(null)

  // Saved once, on close, rather than while typing. An emptied note is not saved (the server refuses it)
  // and goes away on close.
  // An image still uploading is left out: its link only goes to the server once the file is there.
  const flush = () => {
    const b = [...pending.current].reduce(removeImageLink, latest.current)
    if (ended.current || !b.trim() || b === saved.current || noteTooLong(b)) return
    saved.current = b
    onSave(b)
  }
  const end = () => {
    ended.current = true
  }
  const close = () => {
    if (uploading) return toast('Image still uploading')
    // Kept open so the text is not lost: the server would reject it.
    if (noteTooLong(body)) return
    if (!body.trim()) {
      end()
      return onDelete()
    }
    flush()
    onClose()
  }

  // Safety net for edits that never reach close: the app sent to the background (and maybe killed),
  // or the sheet unmounted by a navigation.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])

  const dictation = useDictation((text) => {
    setBody(body.trim() ? `${body.trimEnd()}${body.endsWith('\n') ? '' : ' '}${text}` : text)
  })

  /** At the caret when the text is being edited, at the end otherwise, on its own paragraph. */
  const insertImage = (link: string) => {
    const area = field.current
    const text = latest.current
    const at = area && document.activeElement === area ? area.selectionStart : text.length
    const before = text.slice(0, at)
    const after = text.slice(at)
    const head = `${before}${before && !before.endsWith('\n') ? '\n\n' : ''}${link}`
    setBody(`${head}${after && !after.startsWith('\n') ? '\n\n' : ''}${after}`)
    requestAnimationFrame(() => area?.setSelectionRange(head.length, head.length))
  }

  const attachImage = async (file: File) => {
    if (!navigator.onLine) return toast('Images need a connection')
    setUploading((n) => n + 1)
    let link: string | undefined
    try {
      const image = await prepareImage(file)
      link = image.link
      pending.current.add(link)
      insertImage(link)
      await image.send()
    } catch (e) {
      console.warn(e)
      if (link) setBody((b) => removeImageLink(b, link!))
      toast('Could not add the image')
    } finally {
      if (link) pending.current.delete(link)
      setUploading((n) => n - 1)
    }
  }
  const attachImages = async (files: File[]) => {
    for (const file of files) await attachImage(file)
  }

  const openDrawing = async (path?: string) => {
    if (!path) return setDrawing({})
    if (!navigator.onLine) return toast('Drawings need a connection')
    try {
      setDrawing({ path, data: await loadDrawing(path) })
    } catch (e) {
      console.warn(e)
      toast('Could not open the drawing')
    }
  }

  /**
   * A new drawing goes in like an image. An edited one keeps its old link, which still shows,
   * until the new files are on the server: the link then points to them, with the same width.
   */
  const saveDrawing = async (preview: HTMLCanvasElement, width: number, data: DrawingData) => {
    const replaced = drawing?.path
    setDrawing(null)
    if (!navigator.onLine) return toast('Drawings need a connection')
    setUploading((n) => n + 1)
    let link: string | undefined
    try {
      const prepared = await prepareDrawing(preview, width, data)
      if (replaced) {
        await prepared.send()
        setBody((b) => replaceImagePath(b, replaced, prepared.path))
        return
      }
      link = prepared.link
      pending.current.add(link)
      insertImage(link)
      await prepared.send()
    } catch (e) {
      console.warn(e)
      if (link) setBody((b) => removeImageLink(b, link!))
      toast('Could not save the drawing')
    } finally {
      if (link) pending.current.delete(link)
      setUploading((n) => n - 1)
    }
  }

  useEffect(() => {
    if (mode !== 'edit') return
    if (field.current) placeCaret(field.current, caret.current ?? { start: body.length })
    caret.current = undefined
  }, [mode])

  // On the document: nothing has the focus when the sheet just opened on a rendered note.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (drawing) return
      const files = imageFiles(e.clipboardData)
      // Word and Excel also copy a picture of the text: the text is what was meant.
      if (!files.length || e.clipboardData?.getData('text/plain').trim()) return
      e.preventDefault()
      void attachImages(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The drawing editor has its own keys.
      if (drawing) return
      // By key position: Alt + E types a dead key on a Mac.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyE') {
        e.preventDefault()
        return setMode((m) => (m === 'read' ? 'edit' : 'read'))
      }
      // Escape, or Ctrl / ⌘ + Enter from the text.
      if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing)) return
      e.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      {drawing && (
        <Suspense fallback={null}>
          <DrawingEditor initial={drawing.data} onSave={saveDrawing} onCancel={() => setDrawing(null)} />
        </Suspense>
      )}
      <div className="absolute inset-0 animate-fade bg-black/40" onClick={close} />
      <div
        ref={panel}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer)
          if (!files.length) return
          e.preventDefault()
          void attachImages(files)
        }}
        style={sheetSize.style}
        className="relative flex max-h-[85dvh] w-full max-w-lg animate-sheet flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          {mode === 'read' && body.trim() ? (
            <ResizableMarkdown
              text={body}
              className="min-h-32 text-[15px] leading-relaxed"
              // The link changes with the width: not while the upload still expects it.
              onImageWidth={(path, width) => {
                if (uploading) return toast('Image still uploading')
                setBody((b) => setImageWidth(b, path, width))
              }}
              onEditDrawing={(path) => {
                if (uploading) return toast('Image still uploading')
                void openDrawing(path)
              }}
              onEditAt={(at) => {
                caret.current = at
                setMode('edit')
              }}
            />
          ) : (
            <AutoTextarea
              ref={field}
              commands
              value={body}
              onChange={setBody}
              className="min-h-32 text-[15px] leading-relaxed"
              placeholder={
                dictation.state === 'recording' ? 'Speak…' : dictation.state === 'transcribing' ? 'Transcribing…' : 'Idea…'
              }
            />
          )}
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-xs text-neutral-400">
              {uploading
                ? 'Uploading image…'
                : dictation.state === 'transcribing'
                  ? 'Transcribing…'
                  : `Edited ${formatDate(note.updated_at)}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Draw"
                title="Draw"
                onClick={() => void openDrawing()}
                className="rounded-full p-1.5 text-neutral-300 transition hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400"
              >
                <DrawIcon width={16} height={16} />
              </button>
              <ModeSwitch label="Note mode" value={mode} onChange={setMode} />
              {dictationSupported && (
                <DictationButton dictation={dictation} label="Dictate">
                  <PostProcessButton text={body} onResult={setBody} />
                </DictationButton>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <button
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true)
              end()
              onDelete()
            }}
            className="rounded-lg py-1 text-sm text-red-500"
          >
            {confirmDelete ? 'Confirm deletion' : 'Delete'}
          </button>
          <KindSwitch value={note.kind ?? 'pro'} onChange={onKind} />
          {projects && projects.length > 0 && (
            <select
              value=""
              disabled={!body.trim() || uploading > 0}
              onChange={(e) => {
                end()
                onToIssue(e.target.value, body)
              }}
              aria-label="Make it an issue"
              className="ml-auto min-w-0 max-w-44 truncate rounded-xl bg-transparent py-1.5 pr-2 pl-3 font-medium text-accent ring-1 ring-accent/40 outline-none disabled:opacity-30"
            >
              <option value="" disabled>
                To issue…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={close}
            className={`${projects?.length ? '' : 'ml-auto'} shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900`}
          >
            Close
          </button>
        </div>
        <SheetGrip {...sheetSize} />
      </div>
    </div>
  )
}
