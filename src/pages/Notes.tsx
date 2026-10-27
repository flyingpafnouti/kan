import { useEffect, useRef, useState, type FormEvent } from 'react'
import { navigate } from '../lib/router'
import { toast } from '../lib/toast'
import { useNotes } from '../hooks/useNotes'
import { useProjects } from '../hooks/useProjects'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { dictationSupported, useDictation } from '../hooks/useDictation'
import { HomeHeader } from '../components/HomeHeader'
import { AutoTextarea } from '../components/AutoTextarea'
import { DictationButton } from '../components/DictationButton'
import { NoteSheet } from '../components/NoteSheet'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { MicIcon, SendIcon, StopIcon } from '../components/icons'

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Loose ideas, newest first. Typed in the field on top, or dictated: each transcript becomes its own note.
 * A note can then be turned into an issue of a project.
 */
export function Notes() {
  const { notes, add, update, remove, toIssue } = useNotes()
  const { projects } = useProjects()
  const desktop = useMediaQuery('(pointer: fine)')
  const [draft, setDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation(add)
  const recording = dictation.state === 'recording'

  // ↑ / ↓ select a note, Enter opens it, any other printable key starts a new one; Escape or Backspace go back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || openId || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const ids = notes?.map((n) => n.id) ?? []
      const i = selected ? ids.indexOf(selected) : -1
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ids.length) {
        e.preventDefault()
        setSelected(ids[i < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))])
      } else if (e.key === 'Enter' && i >= 0) {
        e.preventDefault()
        setOpenId(selected)
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        if (i >= 0) setSelected(null)
        else navigate({ name: 'projects' })
      } else if (e.key.length === 1 && e.key !== ' ' && e.key !== '?') {
        // "?" toggles the shortcuts. Focusing before the default action lets the browser type the key into the field.
        composer.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [notes, selected, openId])

  useEffect(() => {
    if (selected) document.querySelector(`[data-nav-id="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const t = draft.trim()
    if (t) add(t)
    setDraft('')
  }

  const open = openId ? notes?.find((n) => n.id === openId) : undefined

  return (
    <main className={`mx-auto min-h-dvh max-w-xl px-4 pt-safe ${desktop ? 'pb-safe' : 'pb-28'}`}>
      <HomeHeader current="notes" keys={!open} />

      {notes && (
        <form
          onSubmit={submit}
          className="mb-4 flex items-end gap-2 rounded-2xl bg-white py-2 pr-2 pl-4 shadow-sm ring-1 ring-neutral-200/70 focus-within:ring-accent dark:bg-neutral-900 dark:ring-neutral-800"
        >
          <AutoTextarea
            ref={composer}
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') e.currentTarget.blur()
            }}
            placeholder="New note…"
            enterKeyHint="send"
            className="max-h-60 min-w-0 flex-1 overflow-y-auto py-1.5 text-[15px]"
          />
          {desktop && dictationSupported && (
            <div className="pb-1">
              <DictationButton dictation={dictation} label="Dictate a note" meter={false} />
            </div>
          )}
          <button
            aria-label="Add"
            disabled={!draft.trim()}
            className="rounded-xl bg-accent p-2 text-white transition disabled:opacity-30"
          >
            <SendIcon width={18} height={18} />
          </button>
        </form>
      )}

      <ul className="space-y-2">
        {(recording || dictation.state === 'transcribing') && (
          <li className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 px-4 py-3.5 text-sm text-neutral-500 dark:border-neutral-700">
            {recording ? (
              <>
                <span>Listening…</span>
                <div className="h-1 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div ref={dictation.meter} className="h-full origin-left scale-x-0 rounded-full bg-red-500/70" />
                </div>
              </>
            ) : (
              <span className="animate-pulse">Transcribing…</span>
            )}
          </li>
        )}
        {notes?.map((n) => (
          <li key={n.id} data-nav-id={n.id}>
            <button
              onClick={() => {
                setSelected(n.id)
                setOpenId(n.id)
              }}
              className={`w-full scroll-my-6 rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 dark:bg-neutral-900 ${
                selected === n.id ? 'ring-accent/50' : 'ring-neutral-200/70 dark:ring-neutral-800'
              }`}
            >
              <p className="line-clamp-5 text-[15px] leading-snug break-words whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1.5 text-xs text-neutral-400">{SHORT.format(new Date(n.created_at))}</p>
            </button>
          </li>
        ))}
      </ul>

      {notes?.length === 0 && dictation.state === 'idle' && (
        <p className="py-8 text-center text-neutral-500">
          {dictationSupported && !desktop ? 'No notes yet. Tap the mic and say your idea.' : 'No notes yet.'}
        </p>
      )}

      {/* Phone: one tap to start, one to stop, and the transcript lands as a new card. */}
      {!desktop && dictationSupported && !open && (
        <button
          aria-label={recording ? 'Stop dictation' : 'Dictate a note'}
          onClick={dictation.toggle}
          disabled={dictation.state === 'starting' || dictation.state === 'transcribing'}
          className={`fixed right-5 z-20 rounded-full p-4 text-white shadow-lg transition active:scale-95 disabled:opacity-50 ${
            recording ? 'bg-red-500 shadow-red-500/30' : 'bg-accent shadow-accent/30'
          }`}
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        >
          {recording ? <StopIcon width={24} height={24} /> : <MicIcon width={24} height={24} />}
        </button>
      )}

      {desktop && notes && <ShortcutsHelp />}

      {open && (
        <NoteSheet
          key={open.id}
          note={open}
          projects={projects}
          onSave={(body) => update(open.id, body)}
          onDelete={() => {
            remove(open)
            setOpenId(null)
          }}
          onToIssue={(projectId, body) => {
            toIssue(open, projectId, body)
            setOpenId(null)
            setSelected(null)
            const name = projects?.find((p) => p.id === projectId)?.name ?? 'the project'
            toast(`Added to ${name}`, { action: { label: 'Open', run: () => navigate({ name: 'board', projectId }) } })
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  )
}
