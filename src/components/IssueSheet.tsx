import { useEffect, useRef, useState } from 'react'
import { PRIORITIES, STATUSES, type Issue, type Priority, type Project, type Status } from '../lib/types'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { useScrollLock } from '../hooks/useScrollLock'
import { formatDate } from '../lib/date'
import { setImageWidth } from '../lib/images'
import { StatusIcon } from './StatusIcon'
import { AutoTextarea } from './AutoTextarea'
import { ResizableMarkdown } from './Markdown'
import { ModeSwitch, type Mode } from './Switch'
import { DictationButton } from './DictationButton'
import { PostProcessButton } from './PostProcessButton'
import { ChevronIcon } from './icons'
import { IssueLinks, type LinkPick } from './IssueLinks'
import { SearchPalette } from './SearchPalette'
import { blockerCandidates, parentCandidates, type IssueIndex } from '../lib/dependencies'

interface Props {
  issue: Issue
  /** Every issue the board knows, for the links. */
  index: IssueIndex
  onOpenIssue: (id: string) => void
  /** Sets or clears the parent of `id`. */
  onLink: (id: string, parent: string | null) => void
  onAddBlocker: (title: string) => void
  onSave: (patch: { title?: string; body?: string }) => void
  onStatus: (s: Status) => void
  onPriority: (p: Priority | null) => void
  /** Gets the latest text, for the undo: it may not have been saved yet. */
  onDelete: (text: { title: string; body: string }) => void
  onClose: () => void
  /** Previous / next issue of the same column (Alt + ↑ / ↓), absent at the ends. Alt + ← / → calls onStatus. */
  onPrev?: () => void
  onNext?: () => void
  /** Reached from a neighbour: no opening animation. */
  instant?: boolean
  /** Targets of "Copy to…", which gets the latest text. */
  projects?: Project[] | null
  onCopy?: (projectId: string, text: { title: string; body: string }) => void
}

export function IssueSheet({
  issue,
  index,
  onOpenIssue,
  onLink,
  onAddBlocker,
  onSave,
  onStatus,
  onPriority,
  onDelete,
  onClose,
  onPrev,
  onNext,
  instant,
  projects,
  onCopy,
}: Props) {
  useScrollLock()
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mode, setMode] = useState<Mode>('edit')
  const [linking, setLinking] = useState(false)
  const [picking, setPicking] = useState<LinkPick | null>(null)
  const links = useRef<HTMLElement>(null)
  const linked = (issue.parent_id && index.byId.has(issue.parent_id)) || index.children.has(issue.id)
  const field = useRef<HTMLTextAreaElement>(null)
  /** Where the caret goes on the way to Edit. Unset when the sheet opens: no keyboard popping up on a phone. */
  const caret = useRef<number>(undefined)
  const saved = useRef({ title: issue.title, body: issue.body })
  const latest = useRef({ title, body })
  latest.current = { title, body }
  /** Deleted: nothing left to save. */
  const ended = useRef(false)
  const unmounted = useRef(false)

  // Saved once, on close or on the way to a neighbour, rather than while typing.
  const flush = () => {
    if (ended.current) return
    const { title: t, body: b } = latest.current
    const patch: { title?: string; body?: string } = {}
    if (t.trim() && t.trim() !== saved.current.title) patch.title = t.trim()
    if (b !== saved.current.body) patch.body = b
    if (Object.keys(patch).length) {
      saved.current = { title: patch.title ?? saved.current.title, body: patch.body ?? saved.current.body }
      onSave(patch)
    }
  }
  const close = () => {
    flush()
    onClose()
  }
  const step = (go?: () => void) => {
    if (!go) return
    flush()
    go()
  }

  // Safety net for edits that never reach close: the app sent to the background (and maybe killed),
  // or the sheet unmounted by a navigation.
  useEffect(() => {
    unmounted.current = false
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unmounted.current = true
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])

  /** For a transcript or a rewrite's undo: both can land once the sheet is closed, with no later close to save them. */
  const receive = (b: string) => {
    setBody(b)
    if (!unmounted.current) return
    latest.current = { ...latest.current, body: b }
    flush()
  }

  // The transcript is appended to the notes.
  const dictation = useDictation((text) => {
    receive(body.trim() ? `${body.trimEnd()}${body.endsWith('\n') ? '' : ' '}${text}` : text)
  })

  const changeMode = (next: Mode, at = body.length) => {
    if (next === 'edit') caret.current = at
    setMode(next)
  }
  useEffect(() => {
    if (mode !== 'edit' || caret.current === undefined) return
    field.current?.focus()
    field.current?.setSelectionRange(caret.current, caret.current)
    caret.current = undefined
  }, [mode])

  useEffect(() => {
    if (linking) links.current?.scrollIntoView({ block: 'nearest' })
  }, [linking])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The link palette, or a field of the sheet, has already dealt with this key.
      if (picking || e.defaultPrevented) return
      // By key position: Alt + E types a dead key on a Mac.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyE') {
        e.preventDefault()
        return changeMode(mode === 'read' ? 'edit' : 'read')
      }
      // Alt + ↑ / ↓ has no use in a text field on Linux and Windows, so it works with the cursor in the notes.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.isComposing) {
        e.preventDefault()
        return step(e.key === 'ArrowUp' ? onPrev : onNext)
      }
      // Alt + ← / → moves the issue to the neighbouring column, like on the board.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.isComposing) {
        e.preventDefault()
        const target = STATUSES[STATUSES.findIndex((s) => s.id === issue.status) + (e.key === 'ArrowLeft' ? -1 : 1)]
        if (target) onStatus(target.id)
        return
      }
      // Escape, or Ctrl / ⌘ + Enter from the text fields.
      if (e.key !== 'Escape' && !(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing)) return
      // Keeps the board from also handling this Escape as "back to projects".
      e.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className={`absolute inset-0 bg-black/40 ${instant ? '' : 'animate-fade'}`} onClick={close} />
      <div
        className={`relative ${instant ? '' : 'animate-sheet'} flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white pb-safe shadow-2xl md:rounded-2xl dark:bg-neutral-900`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <AutoTextarea
                value={title}
                onChange={(v) => setTitle(v.replace(/\n/g, ' '))}
                className="text-lg font-semibold"
                placeholder="Title"
              />
            </div>
            {(onPrev || onNext) && (
              <div className="-mr-2 flex shrink-0">
                <button
                  onClick={() => step(onPrev)}
                  disabled={!onPrev}
                  aria-label="Previous issue"
                  title="Previous issue (Alt ↑)"
                  className="rounded-lg p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronIcon width={18} height={18} className="-rotate-90" />
                </button>
                <button
                  onClick={() => step(onNext)}
                  disabled={!onNext}
                  aria-label="Next issue"
                  title="Next issue (Alt ↓)"
                  className="rounded-lg p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronIcon width={18} height={18} className="rotate-90" />
                </button>
              </div>
            )}
          </div>
          {mode === 'read' && body.trim() ? (
            <ResizableMarkdown
              text={body}
              className="mt-2 min-h-28 text-[15px] text-neutral-700 dark:text-neutral-300"
              onImageWidth={(path, width) => setBody((b) => setImageWidth(b, path, width))}
              onEditLine={(line) => changeMode('edit', body.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0))}
            />
          ) : (
            <AutoTextarea
              ref={field}
              value={body}
              onChange={setBody}
              className="mt-2 min-h-28 text-[15px] text-neutral-700 dark:text-neutral-300"
              placeholder={
                dictation.state === 'recording'
                  ? 'Speak…'
                  : dictation.state === 'transcribing'
                    ? 'Transcribing…'
                    : 'Notes…'
              }
            />
          )}
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-xs text-neutral-400">
              {dictation.state === 'transcribing' ? 'Transcribing…' : `Edited ${formatDate(issue.updated_at)}`}
            </p>
            <div className="flex items-center gap-2">
              <ModeSwitch label="Issue mode" value={mode} onChange={(m) => changeMode(m)} />
              {dictationSupported && (
                <DictationButton dictation={dictation} label="Dictate notes">
                  <PostProcessButton text={body} onResult={receive} />
                </DictationButton>
              )}
            </div>
          </div>
          {(linked || linking) && (
            <IssueLinks
              ref={links}
              issue={issue}
              index={index}
              onOpen={(id) => step(() => onOpenIssue(id))}
              onUnlink={(id) => onLink(id, null)}
              onAddBlocker={onAddBlocker}
              onPick={setPicking}
            />
          )}
        </div>
        <div className="space-y-3 border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <div className="grid grid-cols-4 gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                aria-pressed={issue.priority === p.id}
                // Tapping the active priority clears it.
                onClick={() => onPriority(issue.priority === p.id ? null : p.id)}
                className={`rounded-xl py-1.5 text-sm font-medium ring-1 transition ${
                  issue.priority === p.id ? p.chip : 'text-neutral-500 ring-neutral-200 dark:ring-neutral-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {STATUSES.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onStatus(id)}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium ring-1 transition ${
                  issue.status === id
                    ? 'bg-accent/10 text-accent ring-accent'
                    : 'text-neutral-500 ring-neutral-200 dark:ring-neutral-800'
                }`}
              >
                <StatusIcon status={id} size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true)
                ended.current = true
                onDelete({ title: title.trim() || issue.title, body })
              }}
              className="rounded-lg py-1 text-sm text-red-500"
            >
              {confirmDelete ? 'Confirm deletion' : 'Delete'}
            </button>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {!linked && !linking && (
                <button
                  onClick={() => setLinking(true)}
                  className="shrink-0 py-1 text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  Link…
                </button>
              )}
              {onCopy && projects && projects.length > 0 && (
                // Kept quiet on purpose: a plain grey label that opens the native project picker.
                <select
                  value=""
                  onChange={(e) => onCopy(e.target.value, { title: title.trim() || issue.title, body })}
                  aria-label="Copy to another project"
                  className="min-w-0 max-w-36 truncate bg-transparent py-1 text-right text-sm text-neutral-400 outline-none hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <option value="" disabled>
                    Copy to…
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === issue.project_id ? `${p.name} (here)` : p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={close}
                className="shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    {picking && (
      // Beside the sheet: its opening animation would otherwise position the palette.
      <SearchPalette
        issues={picking === 'blocker' ? blockerCandidates(issue, index) : parentCandidates(issue, index)}
        onPick={(picked) => {
          setPicking(null)
          if (picking === 'blocker') onLink(picked.id, issue.id)
          else onLink(issue.id, picked.id)
        }}
        onClose={() => setPicking(null)}
      />
    )}
    </>
  )
}
